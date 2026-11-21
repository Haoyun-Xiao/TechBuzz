import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { bootstrap } from './bootstrap.mjs';
import { initCollector } from './collector.mjs';
import { sourceIds } from './bridge.mjs';
import { closeDb, sql } from '@techbuzz/backend/db';
import { upsertMaterial } from '@techbuzz/backend/content/materials';
import { queueProcessing } from '@techbuzz/backend/jobs/content';
import { stopBoss } from '@techbuzz/backend/jobs/queue';

const snapshotPath = process.argv[2] ?? new URL('./demo/snapshot.json', import.meta.url);
const oldPath = process.env.TECHBUZZ_DB || '/data/techbuzz.sqlite';
const evidence = new Map();
const verifiedIds = new Set(JSON.parse(await readFile(snapshotPath, 'utf8')).posts.map(post => post.id));

try {
  const old = new DatabaseSync(oldPath, { readOnly: true });
  try {
    if (old.prepare("SELECT 1 FROM sqlite_schema WHERE name = 'x_posts' AND type = 'table'").get()) {
      for (const { payload } of old.prepare('SELECT payload FROM x_posts WHERE sample = 1').iterate()) {
        const post = JSON.parse(payload);
        if (verifiedIds.has(post.id)) evidence.set(post.id, post);
      }
    }
  } finally {
    old.close();
  }
} catch (error) {
  if (!['ENOENT', 14].includes(error.code) && error.errcode !== 14) throw error;
}

try {
  const configured = new Set((await sql`SELECT id FROM sources WHERE kind = 'x_search' AND id IN ${sql(sourceIds)}`).map(row => row.id));
  if (configured.size !== sourceIds.length) throw new Error('The eight engine X sources are not seeded');
  const alreadyImported = new Set((await sql`
    SELECT x_post->>'tweetId' AS id FROM articles WHERE source_id IN ${sql(sourceIds)} AND x_post IS NOT NULL
  `).map(row => row.id));
  const missing = [...verifiedIds].filter(id => !evidence.has(id) && !alreadyImported.has(id));
  if (missing.length) {
    // The exported snapshot carries excerpts. Fetch the underlying statuses before using them as evidence.
    if (process.env.HTTPS_PROXY || process.env.https_proxy) http.setGlobalProxyFromEnv?.();
    const db = new DatabaseSync(':memory:');
    try {
      initCollector(db);
      await bootstrap(db, missing);
      for (const { payload } of db.prepare('SELECT payload FROM x_posts WHERE sample = 1').iterate()) {
        const post = JSON.parse(payload);
        if (verifiedIds.has(post.id) && !evidence.has(post.id)) evidence.set(post.id, post);
      }
    } finally {
      db.close();
    }
  }
  let imported = 0;
  for (const post of evidence.values()) {
    if (alreadyImported.has(post.id)) continue;
    const media = [...(post.media ?? []), ...(post.article?.media ?? [])];
    const text = post.text ?? '';
    const title = post.article?.title || text.split('\n').find(line => line.trim())?.slice(0, 140) || post.url;
    const result = await sql.begin(async db => {
      const result = await upsertMaterial({
        sourceId: `x-${post.handle.toLowerCase()}`,
        url: post.url, title, author: post.handle,
        publishedAt: new Date(post.publishedAt), backfill: 'verified-sample', via: 'import',
        bodyText: [text, post.article?.text, post.quoted?.text].filter(Boolean).join('\n\n'),
        bodyStatus: 'ok', media,
        xPost: {
          tweetId: post.id, handle: post.handle, authorName: post.authorName ?? post.handle, text, media,
          replyTo: post.replyTo?.id ?? null,
          quoted: post.quoted?.handle && post.quoted.text != null ? {
            authorName: post.quoted.authorName ?? post.quoted.handle, handle: post.quoted.handle,
            text: post.quoted.text, url: post.quoted.url, media: post.quoted.media,
          } : null,
        },
        raw: { techbuzzSample: post },
      }, db);
      if (result.created || result.revised || result.processingNeeded) await queueProcessing(result.articleId, { db });
      return result;
    });
    if (result.created) imported += 1;
  }
  const unavailable = [...verifiedIds].filter(id => !evidence.has(id) && !alreadyImported.has(id));
  console.log(JSON.stringify({ imported, existing: [...verifiedIds].filter(id => alreadyImported.has(id)).length, unavailable }));
} finally {
  await stopBoss();
  await closeDb();
}
