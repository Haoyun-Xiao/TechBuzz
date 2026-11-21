import { setTimeout as delay } from 'node:timers/promises';
import { openDatabase } from './db.mjs';
import { closeDb, sql } from '@techbuzz/backend/db';
import { ENTITIES, ENTITY_TAGS, TOPIC_TAGS } from '@techbuzz/industry/taxonomy';
import { syncResearch } from './bridge.mjs';
import { analyze, enrichMaterials } from './research.mjs';

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
let latestPosts;
async function refreshSources() {
  latestPosts = await syncResearch(db, sql, { entities:ENTITIES,companyTags:ENTITY_TAGS,topicTags:TOPIC_TAGS });
}
async function runResearch() {
  if (!latestPosts) return;
  if (!process.env.TECHBUZZ_LLM_API_KEY || !process.env.TECHBUZZ_LLM_MODEL) return;
  await analyze(db, latestPosts);
}
async function runEnrichment() {
  if (latestPosts && process.env.TECHBUZZ_LLM_API_KEY && process.env.TECHBUZZ_LLM_MODEL) await enrichMaterials(db, latestPosts);
}
try {
  await Promise.all([loop(refreshSources, 60), loop(runResearch, 60), loop(runEnrichment, 60)]);
} finally {
  db.close();
  await closeDb();
}
