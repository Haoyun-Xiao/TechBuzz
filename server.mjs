import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, timingSafeEqual } from 'node:crypto';
import { openDatabase } from './db.mjs';
import { dashboard } from './dashboard.mjs';
import { setThreshold } from './research.mjs';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml', '.png':'image/png', '.ico':'image/x-icon' };
const groups = ['sources', 'posts', 'ideas', 'trends', 'reports'];
const db = openDatabase();
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
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    res.setHeader('X-Content-Type-Options','nosniff');
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
      setThreshold(db,n);
      return json(res,200,{threshold:n});
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res,405,{error:'请求方法不受支持'});
    if (path === '/api/health') return json(res,200,{name:'TechBuzz',ok:db.prepare('SELECT 1 AS ok').get().ok===1});
    if (path.startsWith('/api/')) {
      const [group,id,...extra] = path.slice(5).split('/');
      if (path === '/api/dashboard') return json(res,200,dashboard(db));
      if (!groups.includes(group) || extra.length) return json(res,404,{error:'未找到接口'});
      const rows = dashboard(db)[group];
      const value = id ? rows.find(r => String(r.id ?? r.handle) === id) : rows;
      return value ? json(res,200,value) : json(res,404,{error:'未找到记录'});
    }
    const file = resolve(join(root,path === '/' ? 'index.html' : path));
    if (!file.startsWith(root) || !(await stat(file)).isFile()) return json(res,404,{error:'未找到页面'});
    const content = await readFile(file);
    res.writeHead(200,{'Content-Type':(types[extname(file)] || 'application/octet-stream') + '; charset=utf-8'});
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof URIError) return json(res,404,{error:'未找到页面'});
    console.error(error.name, error.code || 'request failed');
    json(res,500,{error:'请求失败'});
  }
});
server.listen(3000, '0.0.0.0');
