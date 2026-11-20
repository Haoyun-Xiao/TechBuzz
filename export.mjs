import { resolve, join } from 'node:path';
import { mkdir, cp, writeFile } from 'node:fs/promises';
import { openDatabase } from './db.mjs';
import { dashboard } from './dashboard.mjs';

// Export a separate, read-only site. Raw replies, media blobs, request logs and credentials stay local.
function excerpt(text) {
  const words = String(text || '').trim().split(/\s+/);
  return words.slice(0, 18).join(' ').slice(0,120) + (words.length > 18 ? '…' : '');
}
function verifyEvidence(value, ids) {
  if (Array.isArray(value)) {
    value.forEach(item => verifyEvidence(item, ids));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (['evidence', 'counterEvidence'].includes(key) && (!Array.isArray(item) || item.some(id => !ids.has(id)))) {
        throw new Error('演示数据含有无法回查的帖子引用');
      }
      verifyEvidence(item, ids);
    }
  }
}
const out = resolve(process.argv[2] || '.runtime/site');
if (out === resolve('public') || out === resolve('.')) throw new Error('请选择独立导出目录');
const db = openDatabase();
const data = dashboard(db);
db.close();
const ids = new Set(data.posts.map(post => post.id));
for (const section of [data.ideas, data.trends, data.reports]) verifyEvidence(section, ids);
for (const receipt of data.ideaReceipts || []) {
  if (receipt.posts.some(post => post.score < receipt.threshold || !ids.has(post.id))) {
    throw new Error('Idea 输入不符合当次阈值或缺少对应原帖');
  }
}
data.mode = 'snapshot';
data.posts = data.posts.map(p => ({
  id:p.id, handle:p.handle, url:p.url, publishedAt:p.publishedAt, text:excerpt(p.text),
  kind:p.kind, sample:p.sample, contextStatus:p.contextStatus, evidenceKey:p.evidenceKey,
  threadRootId:p.threadRootId, originId:p.originId,
  quoted:p.quoted ? {id:p.quoted.id,handle:p.quoted.handle,url:p.quoted.url}:null,
  replyTo:p.replyTo ? {id:p.replyTo.id,handle:p.replyTo.handle,url:p.replyTo.url}:null,
  repostOf:p.repostOf ? {id:p.repostOf.id,handle:p.repostOf.handle,url:p.repostOf.url}:null,
  article:p.article ? {title:p.article.title,url:p.article.url}:null,
  media:[], thread:(p.thread || []).map(item => ({id:item.id,url:item.url,handle:item.handle})),
}));
data.sources = data.sources.map(s => ({
  handle:s.handle,lastSuccess:s.lastSuccess,lastAttempt:s.lastAttempt,status:s.status,
  error:s.error ? '采集服务尚未就绪或上次检查失败' : null,
  coverageStart:s.coverageStart,coverageEnd:s.coverageEnd,backfillComplete:s.backfillComplete,
  latestPostAt:s.latestPostAt,postCount:s.postCount,sampleCount:s.sampleCount,lastCount:s.lastCount
}));
delete data.jobs;
await mkdir(out,{recursive:true});
await cp('public',out,{recursive:true});
await writeFile(join(out,'snapshot.json'),JSON.stringify(data));
await writeFile(join(out,'.nojekyll'),'');
console.log(JSON.stringify({out,posts:data.posts.length,ideas:data.ideas.length,trends:data.trends.length,reports:data.reports.length}));
