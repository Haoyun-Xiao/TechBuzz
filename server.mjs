import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { openDatabase } from './db.mjs';
import { dashboard } from './dashboard.mjs';
import { setThreshold } from './research.mjs';
import { integer, PublicationError, readDailies, readHot, readItems, readStory } from './publication.mjs';
import { selectedSyncReader } from './selected-sync.mjs';

const groups = ['sources', 'posts', 'ideas', 'trends', 'reports'];
const db = openDatabase();
const readSelected = selectedSyncReader(db);
const dataVersion = db.prepare('PRAGMA data_version');
let cached;
function currentSnapshot() {
  const version = dataVersion.get().data_version;
  const now = Date.now();
  if (cached?.version === version && cached.until > now) return cached.snapshot;
  const snapshot = dashboard(db, new Date(now));
  cached = { version, until: now + 5000, snapshot };
  return snapshot;
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
  res.end(JSON.stringify(value));
}
function authorized(header) {
  const token = process.env.TECHBUZZ_ADMIN_TOKEN;
  if (!token || !header) return false;
  const digest = v => createHash('sha256').update(v).digest();
  return timingSafeEqual(digest(header), digest('Bearer ' + token));
}
const server = http.createServer(async (req,res) => {
  try {
    const address = new URL(req.url, 'http://localhost');
    const path = decodeURIComponent(address.pathname);
    res.setHeader('X-Content-Type-Options','nosniff');
    if (path === '/api/admin/threshold' && req.method === 'GET') {
      return json(res,200,db.prepare('SELECT threshold,version AS thresholdVersion FROM research_settings').get());
    }
    if (path === '/api/admin/threshold' && req.method === 'POST') {
      if (!authorized(req.headers.authorization)) return json(res,403,{error:'管理员凭据无效'});
      let body = '';
      for await (const part of req) {
        body += part;
        if (body.length > 1024) return json(res,413,{error:'请求过大'});
      }
      let n;
      try { n = JSON.parse(body).threshold; } catch { return json(res,400,{error:'无效 JSON'}); }
      if (!Number.isInteger(n) || n < 0 || n > 100) return json(res,400,{error:'阈值范围为 0 至 100 的整数'});
      const threshold = setThreshold(db,n);
      cached = undefined;
      return json(res,200,threshold);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res,405,{error:'请求方法不受支持'});
    if (path === '/api/health') return json(res,200,{name:'TechBuzz',ok:db.prepare('SELECT 1 AS ok').get().ok===1});
    if (path.startsWith('/api/public/')) {
      const params = address.searchParams;
      const siteUrl = req.headers['x-techbuzz-site'] ?? '';
      const snapshot = currentSnapshot();
      let value;
      if (path === '/api/public/stats') {
        const cutoff = Date.now() - 24 * 3600000;
        const recent = item => Date.parse(item.activityAt) >= cutoff;
        value = {
          sources:snapshot.sources.length,sourceKinds:{x_search:snapshot.sources.length},
          items:snapshot.activities.length,selected:snapshot.featured.length,dailies:snapshot.reports.length,
          day:{collected:snapshot.activities.filter(recent).length,selected:snapshot.featured.filter(recent).length},
          sampleSources:snapshot.sources.map(s=>({name:'@'+s.handle,kind:'x_search',heatOnly:false})),
          latest:snapshot.featured.slice().sort((a,b)=>(b.activityAt ?? '').localeCompare(a.activityAt ?? '')).slice(0,8)
            .map(a=>({id:a.postId,title:snapshot.scores[a.postId]?.summary || a.post.text.slice(0,120),source:'@'+a.originalAuthor,href:'/research/posts/'+a.postId})),
        };
      } else if (path === '/api/public/items') value = readItems(snapshot, params, siteUrl);
      else if (path === '/api/public/selected/snapshot' || path === '/api/public/selected/changes') {
        value = readSelected(snapshot, params, siteUrl, path.endsWith('/changes'));
      }
      else if (path === '/api/public/hot') value = readHot(snapshot, siteUrl);
      else if (path.startsWith('/api/public/stories/')) value = readStory(snapshot, path.slice('/api/public/stories/'.length), siteUrl);
      else if (path === '/api/public/topics') value = { schemaVersion: 1, items: snapshot.topics };
      else if (path === '/api/public/dailies') value = readDailies(snapshot, null, integer(params.get('limit'), 'limit', 1, 180, 30), siteUrl);
      else if (path.startsWith('/api/public/dailies/')) value = readDailies(snapshot, path.slice('/api/public/dailies/'.length), 1, siteUrl);
      return value ? json(res,200,value) : json(res,404,{error:'未找到记录'});
    }
    if (path.startsWith('/api/')) {
      const [group,id,...extra] = path.slice(5).split('/');
      if (path === '/api/dashboard') return json(res,200,currentSnapshot());
      if (!groups.includes(group) || extra.length) return json(res,404,{error:'未找到接口'});
      const rows = currentSnapshot()[group];
      const value = id ? rows.find(r => String(r.id ?? r.handle) === id || (group === 'posts' && (r.nativeArticleId === id || r.aliases?.includes(id)))) : rows;
      return value ? json(res,200,value) : json(res,404,{error:'未找到记录'});
    }
    return json(res,404,{error:'未找到接口'});
  } catch (error) {
    if (error instanceof PublicationError) return json(res,error.status,{code:error.code,error:error.message});
    if (error.code === 'ENOENT' || error instanceof URIError) return json(res,404,{error:'未找到页面'});
    console.error(error.name, error.code || 'request failed');
    json(res,500,{error:'请求失败'});
  }
});
server.listen(3000, '0.0.0.0');
