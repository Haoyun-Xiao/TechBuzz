// Worker process: queues and schedules for collection, processing, events, reports and ops, and the site's
// modules (site/modules/server.ts).
import { assertProductionSecrets } from "@techbuzz/backend/config";
import { closeDb } from "@techbuzz/backend/db";
import { getBoss, stopBoss, workModuleQueues } from "@techbuzz/backend/jobs/queue";
import { installModules } from "@techbuzz/backend/modules";
import { SERVER_MODULES } from "@techbuzz/site/modules/server";
import { registerContentJobs } from "@techbuzz/backend/jobs/content";
import { registerSourceJobs } from "@techbuzz/backend/jobs/sources";
import { registerEventJobs } from "@techbuzz/backend/jobs/events";
import { registerNotifyJobs } from "@techbuzz/backend/jobs/notify";
import { registerPublicationJobs } from "@techbuzz/backend/jobs/publication";
import { registerSchedules } from "./schedules.ts";
import { ensureContentTargets } from "@techbuzz/backend/notify/deliver";
import { startHeartbeat } from "@techbuzz/backend/operations/heartbeat";
import { closeInterruptedRuns } from "@techbuzz/backend/jobs/runs";

installModules(SERVER_MODULES);
assertProductionSecrets([["auth", "IMG_PROXY_SIGN_SECRET"]]);

await ensureContentTargets();
await closeInterruptedRuns();
const boss = await getBoss({ supervise: true });
await registerContentJobs(boss);
if (process.env.COLLECT_ENABLED === "true") await registerSourceJobs(boss);
await registerEventJobs(boss);
await registerNotifyJobs(boss);
await registerPublicationJobs(boss);
await workModuleQueues(boss);
await registerSchedules(boss);
const heartbeat = startHeartbeat("worker");
console.log(JSON.stringify({ level: "info", msg: "worker started", pid: process.pid }));

let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  const started = performance.now();
  console.log(JSON.stringify({ level: "info", msg: "worker stopping" }));
  clearInterval(heartbeat);
  await stopBoss();
  const closing = performance.now();
  await closeDb();
  console.log(JSON.stringify({ level: "info", msg: "worker stopped", elapsedMs: Math.round(performance.now() - started),
    databaseCloseMs: Math.round(performance.now() - closing) }));
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
