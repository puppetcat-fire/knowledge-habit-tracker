const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const port = Number(process.argv[2] || 3102);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid port');
const root = __dirname;
const projectFile = path.join(root, 'project.json');
const commentsFile = path.join(root, 'comments.json');
const COMMENTS_FORMAT = 'editable-prototype-comments/v1';
let writeQueue = Promise.resolve();
function valid(p) {
  if (!p || p.format !== 'editable-prototype/v1' || typeof p.id !== 'string' || !p.id || typeof p.title !== 'string' || !Array.isArray(p.screens) || !p.screens.length || p.screens.length > 40 || !Number.isFinite(p.width) || p.width < 240 || p.width > 1600 || !Number.isFinite(p.height) || p.height < 320 || p.height > 2400) return false;
  const ids = new Set();
  for (const s of p.screens) {
    if (typeof s.id !== 'string' || !s.id || ids.has(s.id) || typeof s.name !== 'string' || !Array.isArray(s.elements) || s.elements.length > 200) return false;
    ids.add(s.id); const elements = new Set();
    for (const e of s.elements) {
      if (typeof e.id !== 'string' || !e.id || elements.has(e.id) || !['text','button','input','card'].includes(e.type) || typeof e.text !== 'string' || e.text.length > 1000 || !['x','y','w','h'].every(k => Number.isFinite(e[k])) || e.x < 0 || e.y < 0 || e.w < 20 || e.h < 20 || e.x + e.w > p.width || e.y + e.h > p.height || (e.target && typeof e.target !== 'string')) return false;
      elements.add(e.id);
    }
  }
  return ids.has(p.startScreen) && !p.screens.some(s => s.elements.some(e => e.target && !ids.has(e.target)));
}
function validComments(payload) {
  if (!payload || payload.format !== COMMENTS_FORMAT || !Array.isArray(payload.comments) || payload.comments.length > 500) return false;
  return payload.comments.every(c => c && typeof c.id === 'string' && c.id
    && typeof c.screenId === 'string'
    && (c.elementId === null || typeof c.elementId === 'string')
    && typeof c.elementText === 'string'
    && typeof c.text === 'string' && c.text.trim().length > 0 && c.text.length <= 2000
    && typeof c.resolved === 'boolean' && Number.isFinite(c.createdAt) && typeof c.author === 'string');
}
function reply(res, status, body, type = 'application/json') { res.writeHead(status, {'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"}); res.end(typeof body === 'string' ? body : JSON.stringify(body)); }
function sameOrigin(req, expected) { return ['http://'+expected,'http://localhost:'+port].includes(req.headers.origin); }
async function readJsonBody(req) { let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 1048576) throw Error('Too large'); } return JSON.parse(body); }
function writeJson(file, value) { const job = writeQueue.catch(() => {}).then(async () => { const temp = file + '.tmp'; await fs.writeFile(temp, JSON.stringify(value, null, 2), 'utf8'); await fs.rename(temp, file); }); writeQueue = job; return job; }
http.createServer(async (req, res) => {
  try {
    const expected = '127.0.0.1:'+port;
    if (req.headers.host !== expected && req.headers.host !== 'localhost:'+port) return reply(res,403,{error:'Invalid host'});
    if (req.url === '/health' && req.method === 'GET') return reply(res,200,{ok:true,service:'editable-prototype'});
    if (req.url === '/' && req.method === 'GET') return reply(res,200,await fs.readFile(path.join(root,'index.html'),'utf8'),'text/html');
    if (req.url === '/api/prototype' && req.method === 'GET') return reply(res,200,await fs.readFile(projectFile,'utf8'));
    if (req.url === '/api/prototype' && req.method === 'PUT') {
      if (!sameOrigin(req, expected) || !String(req.headers['content-type']).startsWith('application/json')) return reply(res,403,{error:'Same origin JSON required'});
      const project = await readJsonBody(req); if(!valid(project)) return reply(res,400,{error:'Invalid prototype'});
      await writeJson(projectFile, project); return reply(res,200,{ok:true});
    }
    if (req.url === '/api/comments' && req.method === 'GET') {
      try { return reply(res,200,await fs.readFile(commentsFile,'utf8')); }
      catch { return reply(res,200,{format:COMMENTS_FORMAT,updatedAt:'',comments:[]}); }
    }
    if (req.url === '/api/comments' && req.method === 'PUT') {
      if (!sameOrigin(req, expected) || !String(req.headers['content-type']).startsWith('application/json')) return reply(res,403,{error:'Same origin JSON required'});
      const payload = await readJsonBody(req); if(!validComments(payload)) return reply(res,400,{error:'Invalid comments'});
      await writeJson(commentsFile, payload); return reply(res,200,{ok:true,count:payload.comments.length});
    }
    return reply(res,404,{error:'Not found'});
  } catch { return reply(res,500,{error:'Prototype operation failed; existing file retained'}); }
}).listen(port,'127.0.0.1',()=>process.stdout.write('Prototype: http://127.0.0.1:'+port+'/\n'));
