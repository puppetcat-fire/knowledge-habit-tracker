const {searchTerms,matchesSearch}=require('./public-search-terms.cjs');
const crypto=require('node:crypto');
const {readFollowedAuthors}=require('./action-state.cjs');
const {readPublicTutorials}=require('./public-tutorial-search.cjs');
const {readPublicPractices}=require('./public-practices.cjs');
const {readPublicPaths}=require('./knowledge-path-publications.cjs');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function installFollowingFeed(app,{config,authenticate}){app.get(['/api/review-following-feed','/api/review-community-feed'],(req,res)=>{
 const scope=req.path==='/api/review-community-feed'?'community':'following',code=scope==='community'?'COMMUNITY_FEED':'FOLLOWING_FEED';
 const user=authenticate(req);if(!user)return res.status(401).json({ok:false,code:'UNAUTHENTICATED'});if(req.get('X-Action-Account')&&req.get('X-Action-Account')!==user.id)return res.status(409).json({ok:false,code:'ACTION_ACCOUNT_CHANGED'});
 const query=req.query.query??'',kind=req.query.kind??'all',order=req.query.order??'relevance',cursor=req.query.cursor??'',limit=req.query.limit===undefined?20:Number(req.query.limit);if(typeof query!=='string'||query.length>120||!['all','tutorial','practice','path'].includes(kind)||!['relevance','recent'].includes(order)||typeof cursor!=='string'||cursor.length>100||!Number.isInteger(limit)||limit<1||limit>50)return res.status(400).json({ok:false,code:code+'_INPUT'});
 try{
  const followed=scope==='following'?readFollowedAuthors(config.dataDir,user.id):[];
  const ids=new Set(followed.map(a=>a.id)),terms=searchTerms(query);let entries=[];
  if(scope==='community'||ids.size){for(const [type,read] of [['tutorial',readPublicTutorials],['practice',readPublicPractices],['path',readPublicPaths]]){if(kind!=='all'&&kind!==type)continue;for(const item of read(config)){if(scope==='following'&&!ids.has(item.authorId))continue;const title=type==='practice'?item.snapshot?.nodeTitle||(item.currentTarget?.title?'当前关联目标 · '+item.currentTarget.title:'公开行动记录'):item.title,summary=type==='tutorial'?item.method:type==='practice'?item.text:item.targets.map(t=>t.title).join(' / ');const goalFields=type==='tutorial'?[item.target.title,item.target.goal,item.startAction]:type==='practice'?[item.snapshot?.nodeGoal,item.currentTarget.title,item.currentTarget.goal,item.snapshot?.methodTitle,item.snapshot?.methodAuthor]:item.targets.flatMap(t=>[t.title,t.goal,t.five]);if(!matchesSearch([title,summary,item.authorName,...goalFields],terms))continue;entries.push({key:type+':'+item.id,type,authorId:item.authorId,authorName:item.authorName,title,publishedAt:typeof item.createdAt==='number'?item.createdAt:Date.parse(item.createdAt),item})}}}
  const titleRanks=new Map();
  if(order==='relevance'&&terms.length){
   const phrase=terms.join(' ');
   for(const entry of entries){
    const title=searchTerms(entry.title).join(' ');
    titleRanks.set(entry.key,title===phrase?2:terms.every(term=>title.includes(term))?1:0);
   }
  }
  entries.sort((a,b)=>(titleRanks.get(b.key)||0)-(titleRanks.get(a.key)||0)||b.publishedAt-a.publishedAt||a.key.localeCompare(b.key));const revision=hash({ownerId:user.id,scope,followed:[...ids].sort(),query,kind,order,limit,entries});let offset=0;if(cursor){const [v,p,...rest]=cursor.split(':');if(rest.length||v!==revision||!/^(0|[1-9][0-9]*)$/.test(p||''))return res.status(409).json({ok:false,code:code+'_CURSOR_CHANGED',message:scope==='community'?'公开内容已变化，请重新读取第一页。':'关注或公开内容已变化，请重新读取第一页。'});offset=Number(p);if(!Number.isSafeInteger(offset)||offset>entries.length)return res.status(400).json({ok:false,code:code+'_INPUT'})}
  const page=entries.slice(offset,offset+limit);return res.set('Cache-Control','no-store').json({ok:true,ownerId:user.id,scope,query,kind,order,followedCount:scope==='following'?ids.size:null,total:entries.length,entries:page,nextCursor:offset+page.length<entries.length?revision+':'+(offset+page.length):null});
 }catch{return res.status(503).json({ok:false,code:code+'_UNREADABLE',message:(scope==='community'?'公开内容':'关注内容')+'无法核对，原资料保留，请稍后重试。'})}
})}
module.exports={installFollowingFeed};
