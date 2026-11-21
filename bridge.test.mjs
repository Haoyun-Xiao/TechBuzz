import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db.mjs';
import { ingestPosts } from './collector.mjs';
import { sourceIds, syncResearch } from './bridge.mjs';
import { setThreshold } from './research.mjs';
import { dashboard } from './dashboard.mjs';

const x = (id, handle, extra = {}) => ({
  tweetId: id, handle, authorName: handle, text: `original ${id}`, media: [], ...extra,
});
const row = (id, handle, time, extra = {}, verified = null, fetched = true) => ({
  source_id: `x-${handle.toLowerCase()}`,
  url: `https://x.com/${handle}/status/${id}`,
  published_at: new Date(time), discovered_at: new Date('2026-11-20T03:00Z'),
  x_post: x(id, handle, extra), x_article: null, verified, fetched,
});
const states = sourceIds.map(id => ({
  id, cursor: null, enabled: true, new_count: null, last_fetch_at: null, last_ok_at: null, last_error: null,
}));
const query = (rows, sources = states, activities = []) => (strings, ...values) => {
  if (!Object.hasOwn(strings, 'raw')) return strings;
  assert.deepEqual(values[0], sourceIds);
  return strings.join().includes('FROM articles') ? rows : strings.join().includes('FROM x_account_activity') ? activities : sources;
};

test('the research cache takes engine revisions and references without polling or changing research state', async () => {
  const db = openDatabase(':memory:');
  try {
    const root = row('1', 'SemiAnalysis_', '2026-11-20T02:00:00Z');
    Object.assign(root, { native_id: 'published-1', text_zh: '已发布原帖的中文译文', quoted_zh: null });
    const reply = row('2', 'SemiAnalysis_', '2026-11-20T02:00:01Z', { replyTo: '1', replyToHandle: 'SemiAnalysis_' });
    const quoted = row('3', 'Omercheema', '2026-11-20T02:00:02Z', {
      quoted: { handle: 'someone', text: 'quoted context', url: 'https://x.com/someone/status/99' },
    });
    const sample = row('4', 'HedgeyeTech', '2026-11-20T02:00:03Z', { text: 'truncated' }, {
      kind: 'original', text: 'full verified text', article: { text: 'verified long article' },
    });
    ingestPosts(db, [{ id: '42', handle: 'OrnnExchange', publishedAt: '2026-11-20T02:01Z', text: 'SQLite-only' }]);
    setThreshold(db,82);
    const bridged = await syncResearch(db, query([root, reply, quoted, sample]));
    assert.deepEqual(bridged.map(post => post.id), ['4', '3', '2', '1']);
    assert.equal(bridged.find(post => post.id === '1').textZh, '已发布原帖的中文译文');
    assert.equal(bridged.find(post => post.id === '1').nativeArticleId, 'published-1');
    assert.equal(bridged.find(post => post.id === '4').nativeArticleId, null);
    assert.equal(bridged.find(post => post.id === '4').text, 'full verified text');
    assert.equal(bridged.find(post => post.id === '3').evidenceKey, 'x:99');
    assert.deepEqual(bridged.find(post => post.id === '1').thread.map(post => post.id), ['2']);
    assert.equal(bridged.find(post => post.id === '2').threadRootId, '1');
    await assert.rejects(syncResearch(db, query([], states.slice(1))), /not seeded/);
    assert.equal(db.prepare('SELECT count(*) AS n FROM x_posts').get().n, 4);
    assert.equal(db.prepare('SELECT threshold FROM research_settings').get().threshold, 82);
  } finally {
    db.close();
  }
});

test('reposts remain separate observations with original attribution and timestamps', async () => {
  const db = openDatabase(':memory:');
  try {
    const activity = (author, source, id) => ({ source_id: source, tweet_id: id, kind: 'repost', author,
      url: `https://x.com/${author}/status/${id}`, published_at: new Date('2026-11-01T00:00Z'),
      first_seen_at: new Date('2026-11-20T00:00Z'), last_seen_at: new Date('2026-11-21T00:00Z'), body: 'original text' });
    const foreign = row('7', 'SemiAnalysis_', '2026-11-20T00:00Z', { handle: 'other' });
    await syncResearch(db, query([foreign], states, [activity('other', 'x-semianalysis_', '99'), activity('SemiAnalysis_', 'x-semianalysis_', '100')]));
    const result = dashboard(db);
    assert.equal(result.posts.length, 2);
    assert.deepEqual(result.activities.map(a=>a.timeBasis), ['unknown','unknown']);
    assert.equal(result.activity.length, 2);
    assert.deepEqual(result.activity.find(item => item.tweetId === '99'), {
      source: 'semianalysis_', tweetId: '99', kind: 'repost', author: 'other', url: 'https://x.com/other/status/99',
      publishedAt: '2026-11-01T00:00:00.000Z', firstSeenAt: '2026-11-20T00:00:00.000Z',
      lastSeenAt: '2026-11-21T00:00:00.000Z', body: 'original text',
    });
    await syncResearch(db, query([], states));
    assert.equal(dashboard(db).activity.length, 0);
  } finally { db.close(); }
});

test('free observation ranges do not claim complete history', async () => {
  const db = openDatabase(':memory:');
  try {
    const freeStates = states.map((state, index) => index ? state : { ...state,
      cursor: { freeX: { backfillComplete: true }, xCoverageStart: '2026-11-01T00:00:00Z', xCoverageEnd: '2026-11-20T00:00:00Z', xLastCount: 3 },
      last_ok_at: new Date('2026-11-21T00:00:00Z') });
    await syncResearch(db, query([], freeStates));
    const source = dashboard(db).sources.find(item => item.handle.toLowerCase() === sourceIds[0].slice(2));
    assert.equal(source.coverageMode, 'free');
    assert.equal(source.backfillComplete, false);
    assert.equal(source.pageState, '已到达公开分页边界');
    assert.equal(source.coverageStart, '2026-11-01T00:00:00Z');
    freeStates[0].cursor.freeX.backfillComplete = false;
    await syncResearch(db, query([], freeStates));
    const pending = dashboard(db).sources.find(item => item.handle === source.handle);
    assert.equal(pending.pageState, '分页进行中');
    assert.equal(pending.status, 'catching-up');
  } finally { db.close(); }
});

test('partial free reads expose failures and pending retries without discarding successful posts', async () => {
  const db = openDatabase(':memory:');
  try {
    const freeStates = states.map((state, index) => index ? state : { ...state,
      cursor: { freeX: { freeXBackfill: { errors: ['timeline failed'] }, freeXDetailFailures: 1,
        freeXPending: [{ id: '7' }, { id: '8' }] }, xLastCount: 0 },
      last_ok_at: new Date('2026-11-21T00:00:00Z') });
    await syncResearch(db, query([row('1', 'SemiAnalysis_', '2026-11-20T02:00:00Z')], freeStates));
    let result = dashboard(db);
    let source = result.sources.find(item => item.handle.toLowerCase() === sourceIds[0].slice(2));
    assert.equal(source.status, 'partial');
    assert.equal(source.partialRead, true);
    assert.equal(source.pendingCount, 2);
    assert.equal(result.posts.length, 1);
    freeStates[0].cursor.freeX.freeXBackfill.errors = [];
    freeStates[0].cursor.freeX.freeXDetailFailures = 0;
    await syncResearch(db, query([], freeStates));
    source = dashboard(db).sources.find(item => item.handle.toLowerCase() === sourceIds[0].slice(2));
    assert.equal(source.status, 'awaiting');
    assert.equal(source.partialRead, false);
    assert.equal(source.pendingCount, 2);
    freeStates[0].cursor.freeX.freeXPending = [];
    freeStates[0].cursor.freeX.freeXUnavailable = [{ id: '7' }];
    freeStates[0].cursor.freeX.backfillComplete = true;
    await syncResearch(db, query([], freeStates));
    source = dashboard(db).sources.find(item => item.handle.toLowerCase() === sourceIds[0].slice(2));
    assert.equal(source.status, 'unavailable');
    assert.equal(source.pendingCount, 0);
    assert.equal(source.unavailableCount, 1);
  } finally { db.close(); }
});
