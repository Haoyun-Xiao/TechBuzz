import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { bootstrap } from './bootstrap.mjs';
import { collect, handles, ingestPosts, initCollector, posts, sources } from './collector.mjs';

const now = Date.parse('2026-11-20T14:00:00Z');
const minuteMs = 60_000;
const iso = time => new Date(time).toISOString();
const empty = { tweets: [], next_cursor: null };
const apiKey = 'test-token';
const [first, second, third] = handles;
const tweet = (id, handle = first, time = now - minuteMs, full_text = 'Own post', fields = {}) => ({
  id_str: id, user: { screen_name: handle, name: handle },
  tweet_created_at: iso(time), full_text, ...fields,
});
const provider = handler => async (address, options) => {
  const url = new URL(address);
  assert.equal(url.hostname, 'api.socialdata.tools');
  assert.equal(options.headers.authorization, `Bearer ${apiKey}`);
  const query = url.searchParams.get('query');
  const handle = query?.match(/from:(\w+)/)?.[1] ?? null;
  const response = await handler({ url, query, handle, cursor: url.searchParams.get('cursor'), signal: options.signal });
  return response instanceof Response ? response : Response.json(response);
};
const sourceFor = (db, handle = first) => sources(db).find(source => source.handle === handle);

function database(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  initCollector(db);
  return db;
}

test('sample posts remain distinct from the actual collection and a missing key does not invent coverage', async t => {
  const db = database(t);
  assert.deepEqual(sources(db).map(source => source.handle), handles);
  assert.equal(sourceFor(db).status, 'pending');
  assert.equal(ingestPosts(db, [
    { id: '25', handle: 'outside', publishedAt: iso(now), text: 'Out of scope' },
    { id: '26', handle: first.toUpperCase(), publishedAt: iso(now), text: 'Verified sample' },
  ], { sample: true }).added, 1);
  assert.equal(posts(db)[0].handle, first);
  assert.equal(sourceFor(db).sampleCount, 1);
  assert.equal(sourceFor(db).postCount, 0);
  const result = await collect(db, { apiKey: '', now, fetchImpl() { throw new Error('provider must not be called'); } });
  assert.equal(result.status, 'unconfigured');
  assert.equal(sourceFor(db).lastSuccess, null);
  assert.equal(sourceFor(db).coverageStart, null);
  assert.equal(posts(db).length, 1);
});

test('recent backfill checkpoints after a page, survives timeout, and an overlap-only poll is empty', async t => {
  const db = database(t);
  const id = '2123750000000000001';
  const saved = '2123740000000000000';
  const older = '2123730000000000000';
  ingestPosts(db, [{ id: saved, handle: first, publishedAt: iso(now - 2 * minuteMs), text: 'Verified sample' }], { sample: true });
  let initialQuery;
  const initial = await collect(db, { apiKey, now, timeoutMs: 10, fetchImpl: provider(async ({ handle, query, cursor, signal }) => {
    if (handle !== first) return empty;
    assert.equal(query.match(/since_time:(\d+)/)[1], String((now - 30 * 86_400_000) / 1000 - 1));
    assert.equal(query.match(/until_time:(\d+)/)[1], String(now / 1000));
    if (!cursor) {
      initialQuery = query;
      return { tweets: [tweet(id), tweet(saved, first, now - 2 * minuteMs), tweet('2123730010000000000', 'outsider')], next_cursor: 'second-page' };
    }
    await delay(40, null, { signal });
    assert.fail('the request should have timed out');
  }) });
  assert.equal(initial.status, 'error');
  assert.equal(initial.added, 2);
  assert.deepEqual(posts(db).map(post => post.id), [id, saved]);
  assert.equal(sourceFor(db).lastSuccess, null);
  assert.match(sourceFor(db).error, /request timed out/);
  assert.equal(sourceFor(db, second).status, 'empty');
  const resumedAt = now + minuteMs;
  const resumed = await collect(db, { apiKey, now: resumedAt, fetchImpl: provider(({ handle, query, cursor }) => {
    if (handle !== first) return empty;
    if (cursor) {
      assert.equal(cursor, 'second-page');
      assert.equal(query, initialQuery);
      return { tweets: [tweet(older, first, now - 4 * minuteMs)] };
    }
    assert.match(query, new RegExp(`max_id:${older}`));
    return empty;
  }) });
  assert.equal(resumed.status, 'ok');
  assert.equal(resumed.added, 1);
  assert.equal(sourceFor(db).lastCount, 3);
  assert.equal(sourceFor(db).coverageEnd, iso(now));
  assert.equal(sourceFor(db).coverageStart, iso(now - 30 * 86_400_000));
  assert.equal(sourceFor(db).sampleCount, 0);
  assert.equal(sourceFor(db).postCount, 3);

  await collect(db, { apiKey, now: now + 5 * minuteMs, fetchImpl: provider(({ handle, query }) => {
    if (handle !== first) return empty;
    assert.match(query, new RegExp(`since_time:${(now - 5 * minuteMs) / 1000 - 1}`));
    return query.includes('max_id:') ? empty : { tweets: [tweet(id)] };
  }) });
  assert.equal(sourceFor(db).status, 'empty');
  assert.equal(sourceFor(db).lastCount, 0);
  assert.equal(posts(db).length, 3);
});

test('a rejected cursor resumes from the lowest observed ID and a failure preserves confirmed coverage', async t => {
  const db = database(t);
  const id = '2123750000000000000';
  const firstPass = await collect(db, { apiKey, now, maxPages: 1, fetchImpl: provider(({ handle }) => {
    return handle === first ? { tweets: [tweet(id)], next_cursor: 'expired' } : empty;
  }) });
  assert.equal(firstPass.status, 'partial');
  assert.equal(sourceFor(db).status, 'backfilling');
  const resumedAt = now + 5 * minuteMs;
  await collect(db, { apiKey, now: resumedAt, fetchImpl: provider(({ handle, query, cursor }) => {
    if (handle !== first) return empty;
    if (cursor === 'expired') return new Response('Expired cursor', { status: 422 });
    assert.match(query, new RegExp(`max_id:${id}`));
    return { tweets: [tweet(id)] }; // Provider treated max_id as inclusive.
  }) });
  const successful = sourceFor(db);
  assert.equal(successful.lastCount, 1);
  assert.equal(successful.lastSuccess, iso(resumedAt));
  await collect(db, { apiKey, now: resumedAt + 5 * minuteMs, fetchImpl: provider(({ handle }) =>
    handle === first ? new Response('test-token must never reach the log', { status: 429 }) : empty) });
  assert.equal(sourceFor(db).error, 'SocialData HTTP 429');
  assert.equal(sourceFor(db).coverageEnd, successful.coverageEnd);
  assert.equal(sourceFor(db).lastSuccess, successful.lastSuccess);
  assert.equal(posts(db).length, 1);
});

test('a stale collector cannot overwrite a committed page from another SQLite connection', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'techbuzz-collect-'));
  const path = join(dir, 'posts.sqlite');
  const slow = new DatabaseSync(path);
  const quick = new DatabaseSync(path);
  t.after(() => {
    slow.close();
    quick.close();
    rmSync(dir, { recursive: true });
  });
  const waiting = Promise.withResolvers();
  const resume = Promise.withResolvers();
  const old = collect(slow, { apiKey, now, fetchImpl: provider(async ({ handle }) => {
    if (handle !== first) return empty;
    waiting.resolve();
    await resume.promise;
    return { tweets: [tweet('11')], next_cursor: 'stale' };
  }) });
  await waiting.promise;
  try {
    await collect(quick, { apiKey, now, fetchImpl: provider(({ handle, query }) => {
      return handle === first && !query.includes('max_id:') ? { tweets: [tweet('12')] } : empty;
    }) });
  } finally {
    resume.resolve();
    await old;
  }
  assert.deepEqual(posts(slow).map(post => post.id), ['12']);
  assert.equal(sourceFor(slow).status, 'ok');
  assert.equal(sourceFor(slow).lastCount, 1);
});

test('article, long post, reply media, attribution and repeated propagation survive normalization', async t => {
  const db = database(t);
  const root = '2123744000000000000';
  const child = '2123746000000000000';
  const repostA = '2123747000000000000';
  const repostB = '2123748000000000000';
  const external = '2123000000000000100';
  const missing = '2123000000000000000';
  const article = '2123745000000000000';
  const long = '2123749000000000000';
  const photo = { type: 'photo', url: 'https://t.co/media', media_url_https: 'https://pbs.twimg.com/media/photo.png', ext_alt_text: 'Memory demand chart' };
  const base = tweet(root, first, now - 3 * minuteMs, 'A &amp; B https://t.co/link https://t.co/media', {
    extended_entities: { media: [photo] }, entities: { urls: [{ url: 'https://t.co/link', expanded_url: 'https://example.org/?a=1&b=2' }] },
  });
  const foreign = tweet(external, 'outsider', now - 4 * minuteMs, 'Upstream claim', { extended_entities: { media: [photo] } });
  const firstPage = {
    [first]: [
      tweet(long, first, now - minuteMs, 'TRUNCATED', { note_tweet: { note_tweet_results: { result: { text: 'A long post'.repeat(120) } } } }),
      tweet(child, first, now - minuteMs, 'Follow-up', { in_reply_to_status_id_str: root }),
      tweet(article, first, now - minuteMs, 'https://x.com/i/article/2123333333333333333'),
      base,
    ],
    [second]: [tweet(repostA, second, now - minuteMs, 'RT @outsider: Upstream claim', { retweeted_status: foreign })],
    [third]: [
      tweet(repostB, third, now - minuteMs, 'Commentary https://x.com/outsider/status/' + external, {
        quoted_status_id_str: external, in_reply_to_screen_name: 'unavailable', in_reply_to_status_id_str: missing,
      }),
    ],
  };
  const requests = [];
  await collect(db, { apiKey, now, fetchImpl: provider(({ handle, query, url }) => {
    if (handle) return query.includes('max_id:') ? empty : { tweets: firstPage[handle] ?? [] };
    requests.push(url.pathname);
    if (url.pathname === `/v2/twitter/article/${article}`) {
      return { article: { title: 'The supply curve' }, markdown_source: 'article', markdown: 'Full article\n\n- First point' };
    }
    if (url.pathname === `/twitter/tweets/${root}`) return base;
    if (url.pathname === `/twitter/tweets/${external}`) return foreign;
    if (url.pathname === `/twitter/tweets/${missing}`) return new Response(null, { status: 404 });
    assert.fail('Unexpected path: ' + url.pathname);
  }) });
  const rows = new Map(posts(db).map(post => [post.id, post]));
  assert.equal(rows.size, 6);
  assert.equal(rows.get(root).text, 'A & B https://example.org/?a=1&b=2');
  assert.equal(rows.get(root).media[0].alt, 'Memory demand chart');
  assert.deepEqual(rows.get(root).thread.map(post => post.id), [child]);
  assert.equal(rows.get(child).replyTo.id, root);
  assert.equal(rows.get(child).threadRootId, root);
  assert.equal(rows.get(child).evidenceKey, rows.get(root).evidenceKey);
  assert.equal(rows.get(repostA).repostOf.handle, 'outsider');
  assert.equal(rows.get(repostA).text, '');
  assert.equal(rows.get(repostB).text, 'Commentary');
  assert.equal(rows.get(repostB).quoted.text, 'Upstream claim');
  assert.equal(rows.get(repostB).replyTo.url, `https://x.com/unavailable/status/${missing}`);
  assert.equal(rows.get(repostB).contextStatus, 'unavailable');
  assert.equal(rows.get(repostB).evidenceKey, rows.get(repostA).evidenceKey);
  assert.equal(rows.get(article).article.text, 'Full article\n\n- First point');
  assert.equal(rows.get(long).text.length, 1320);
  assert.ok(requests.includes(`/v2/twitter/article/${article}`));
});

test('bootstrap validates extra URLs and allows only tracked authors into the feed', async t => {
  const db = database(t);
  const extraId = '2123749000000000100';
  const extra = `https://x.com/${first}/status/${extraId}?s=20`;
  const contextId = '2123749000000000101';
  const verified = await bootstrap(db, [extra], { fetchImpl: async address => {
    const id = String(address).split('/').at(-1);
    const status = { id, author: { screen_name: first }, text: 'Public fixture body', created_at: iso(now) };
    if (id === extraId) {
      status.replying_to = { screen_name: 'outsider', status: contextId };
      return Response.json({ code: 200, status, thread: [
        { ...status, id: contextId, author: { screen_name: 'outsider' }, text: 'Verified upstream context' },
      ] });
    }
    return new Response('', { status: 404 });
  } });
  assert.equal(verified.verified, 1);
  assert.equal(posts(db).length, 1);
  assert.equal(posts(db)[0].replyTo.text, 'Verified upstream context');
  assert.equal(posts(db)[0].sample, true);
  assert.equal(sourceFor(db).lastSuccess, null);
  await assert.rejects(bootstrap(db, ['https://other.test/aleb/status/123']), /Invalid sample URL/);
});
