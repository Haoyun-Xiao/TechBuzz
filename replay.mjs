import {openDatabase} from './db.mjs';
import {posts} from './collector.mjs';
import {analyze} from './research.mjs';

const db = openDatabase();
const rows = posts(db);
if (!rows.length) throw new Error('没有已采集的帖子');
const plusEight = 8 * 3600000;
const dates = [...new Set(rows.map(p => new Date(Date.parse(p.publishedAt) + plusEight).toISOString().slice(0,10)))].sort();
const today = new Date();
db.exec('CREATE TABLE IF NOT EXISTS replay_progress (day TEXT PRIMARY KEY)');
for (const day of dates) {
  if (db.prepare('SELECT day FROM replay_progress WHERE day=?').get(day)) continue;
  const cutoff = new Date(Math.min(today.valueOf(), Date.parse(day + 'T23:59:59.999+08:00')));
  const visible = rows.filter(p => Date.parse(p.publishedAt) <= cutoff.valueOf());
  let failures = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await analyze(db, visible, {now:cutoff});
    failures = result.jobs.filter(job => job.status === 'failed');
    if (!failures.length) {
      db.prepare('INSERT INTO replay_progress(day) VALUES(?)').run(day);
      console.log(day,visible.length,result.ideas.length,result.trends.length,result.reports.length);
      break;
    }
  }
  if (failures.length) throw new Error('历史回放暂停：' + failures.map(job => job.kind + ' ' + job.error).join(' / '));
}
db.close();
