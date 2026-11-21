import { setTimeout as delay } from 'node:timers/promises';
import { openDatabase } from './db.mjs';
import { closeDb, sql } from '@techbuzz/backend/db';
import { syncResearch } from './bridge.mjs';
import { analyze } from './research.mjs';

const db = openDatabase();
const controller = new AbortController();
for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => controller.abort());
async function loop(task, seconds) {
  while (!controller.signal.aborted) {
    const start = Date.now();
    try { await task(); }
    catch (error) { console.error(new Date().toISOString(),task.name,error.name,error.code || 'task failed'); }
    const remaining = Math.max(1000, start + seconds*1000 - Date.now());
    await delay(remaining, null, {signal:controller.signal}).catch(() => {});
  }
}
async function runResearch() {
  const posts = await syncResearch(db, sql);
  if (!process.env.TECHBUZZ_LLM_API_KEY || !process.env.TECHBUZZ_LLM_MODEL) return;
  await analyze(db, posts);
}
try {
  await loop(runResearch,60);
} finally {
  db.close();
  await closeDb();
}
