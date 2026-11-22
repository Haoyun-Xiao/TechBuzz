import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { openDatabase } from './db.mjs';
import { activityView } from './activity.mjs';
import { replayReport } from './research.mjs';

const { positionals: [database, ...dates], values } = parseArgs({
  allowPositionals: true,
  options: { focus: { type: 'string' } },
});
if (!database || !dates.length || dates.some(date => !/^\d{4}-\d{2}-\d{2}$/.test(date)) || (values.focus && dates.length !== 1)) {
  throw new Error('用法：node replay-reports.mjs <研究库副本> <日期> [更多日期]，单期可加 --focus <原帖ID>');
}
const db = openDatabase(resolve(database));
try {
  for (const date of dates) {
    await replayReport(db, activityView(db).posts, date, { focusPostId: values.focus });
    const job = db.prepare("SELECT status,error FROM research_jobs WHERE kind='report' AND scope=?").get(date);
    if (job?.status !== 'completed') throw new Error(job?.error || '本期日报未完成');
    console.log(date, '已完成');
  }
} finally {
  db.close();
}
