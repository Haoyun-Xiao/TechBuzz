// Runs collection for given sources now (development / operations helper).
// node --env-file=.env scripts/collect.ts rss-openai-news rss-hugging-face ...
import { closeDb } from "@techbuzz/backend/db";
import { stopBoss } from "@techbuzz/backend/jobs/queue";
import { installModules } from "@techbuzz/backend/modules";
import { collectSource } from "@techbuzz/backend/sources/collect";
import { SERVER_MODULES } from "@techbuzz/site/modules/server";

installModules(SERVER_MODULES);
try {
  for (const id of process.argv.slice(2)) {
    const started = performance.now();
    const r = await collectSource(id, { force: true });
    console.log(JSON.stringify({ ...r, ms: Math.round(performance.now() - started) }));
  }
} finally {
  await stopBoss();
  await closeDb();
}
