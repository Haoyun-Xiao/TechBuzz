import {openDatabase} from './db.mjs';
import {posts} from './collector.mjs';
import {analyze} from './research.mjs';

const db = openDatabase();
const rows = posts(db);
if (!rows.length) throw new Error('没有已采集的帖子');
const plusEight = 8 * 3600000;
const dates = [...new Set(rows.map(p => new Date(Date.parse(p.publishedAt) + plusEight).toISOString().slice(0,10)))].sort();
const today = new Date();
for (const day of dates) {
  const cutoff = new Date(Math.min(today.valueOf(), Date.parse(day + 'T23:59:59.999+08:00')));
  const visible = rows.filter(p => Date.parse(p.publishedAt) <= cutoff.valueOf());
  const result = await analyze(db, visible, {now:cutoff});
  console.log(day,visible.length,result.ideas.length,result.trends.length,result.reports.length);
}
db.close();
