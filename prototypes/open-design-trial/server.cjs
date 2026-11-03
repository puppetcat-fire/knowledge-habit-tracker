// 「点亮」试作版静态服务：本机预览用，不做任何写操作。
// 运行：node prototypes/open-design-trial/server.cjs 3110
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = __dirname;
const port = Number(process.argv[2] || 3110);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid port');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2'
};

function send(res, status, body, type) {
  res.writeHead(status, {
    'Content-Type': type || 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  });
  res.end(body);
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1:' + port);
    if (url.pathname === '/health') return send(res, 200, JSON.stringify({ ok: true, service: 'dianliang-trial' }), 'application/json; charset=utf-8');
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
    const file = path.resolve(root, relative);
    if (!file.startsWith(root + path.sep)) return send(res, 403, 'Forbidden');
    const buffer = await fs.readFile(file);
    return send(res, 200, buffer, types[path.extname(file).toLowerCase()] || 'application/octet-stream');
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return send(res, 404, 'Not found');
    return send(res, 500, 'Server error');
  }
}).listen(port, '127.0.0.1', () => {
  process.stdout.write('点亮试作：http://127.0.0.1:' + port + '/\n');
});
