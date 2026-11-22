import { openDatabase } from './db.mjs';
import { activityView } from './activity.mjs';
import { replayTrend } from './research.mjs';

const [database, trendId, asOf, focus, earlier] = process.argv.slice(2);
if (!database || !trendId || !Number.isFinite(Date.parse(asOf)) || !focus || !earlier) {
  throw new Error('用法：node replay-trend.mjs <研究库副本> <趋势ID> <截止时间> <新帖ID,新帖ID> <旧帖ID,旧帖ID>');
}
const db = openDatabase(database);
try {
  const focusIds = focus.split(',');
  const postIds = [...new Set([...earlier.split(','), ...focusIds])];
  const query = db.prepare('SELECT value FROM research_trends WHERE id = ?');
  const before = JSON.parse(query.get(trendId).value);
  const posts = activityView(db).posts;
  const result = await replayTrend(db, posts, { trendId, postIds, focusIds, asOf });
  const after = JSON.parse(query.get(trendId).value);
  const job = db.prepare("SELECT status, error FROM research_jobs WHERE kind='trends' AND scope=?").get(`replay:${trendId}`);
  console.log(JSON.stringify({ ...result, job, revisionCount: after.history.length - before.history.length,
    trend: after.title, change: after.change, changeEvidence: after.changeEvidence }));
  if (!result.completed) process.exitCode = 1;
} finally {
  db.close();
}
