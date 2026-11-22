import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { activityView } from './activity.mjs';
import { openDatabase } from './db.mjs';
import { replayIdeas } from './research.mjs';

const { values: args } = parseArgs({ options: {
  db: { type: 'string' },
  target: { type: 'string' },
  posts: { type: 'string' },
  previous: { type: 'string' },
  at: { type: 'string' },
} });
if (!args.db) throw new Error('使用 --db 指定独立研究库副本');
if (args.target && !args.posts) throw new Error('定向回放需通过 --posts 列出证据帖 ID');
const db = openDatabase(resolve(args.db));
try {
  const ok = await replayIdeas(db, activityView(db).posts, {
    targetId: args.target, ids: args.posts ? new Set(args.posts.split(',')) : undefined,
    now: args.at, previousAt: args.previous === undefined ? undefined : Number(args.previous),
  });
  const scope = args.target ? `replay:${args.target}` : 'current';
  const job = db.prepare("SELECT status,error FROM research_jobs WHERE kind='ideas' AND scope=?").get(scope);
  if (!ok) throw new Error(job?.error ?? 'Idea 回放失败');
  if (args.target) {
    const entry = JSON.parse(db.prepare('SELECT value FROM research_ideas WHERE id=?').get(args.target).value);
    const found = args.posts.split(',').some(id => entry.changeEvidence?.includes(id));
    if (!found || !entry.previousJudgment || !entry.newEvidence || !entry.change || !entry.remaining || !entry.watchNext) {
      throw new Error('目标 Idea 未生成含可核验证据的完整修订');
    }
  }
  console.log('Idea 回放完成', scope);
} finally {
  db.close();
}
