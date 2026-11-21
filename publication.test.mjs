import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readDailies, readHot, readItems, readStory } from './publication.mjs';
import { selectedSyncReader } from './selected-sync.mjs';

const now = '2026-11-22T01:00:00.000Z';
const earlier = '2026-11-21T16:30:00.000Z';
const moved = '2026-11-22T02:00:00.000Z';
const site = 'https://techbuzz.test';
function row(postId, activityAt, fields = {}) {
  const kind = fields.kind ?? 'original';
  const handle = fields.handle ?? 'SemiAnalysis_';
  const url = `https://x.com/SemiAnalysis_/status/${postId}`;
  return { id: kind === 'repost' ? `repost:${handle.toLowerCase()}:${postId}` : `post:${postId}`,
    postId, kind, handle, originalAuthor: 'SemiAnalysis_', url, activityAt, firstSeenAt: earlier,
    timeBasis: kind === 'repost' ? activityAt ? 'observed' : 'unknown' : 'published',
    post: { id: postId, url, handle: 'SemiAnalysis_', text: 'NVIDIA capacity as reported', publishedAt: earlier },
    score: 88, featured: true, distributors: [], category: '产业链', ...fields };
}
const original = row('100', earlier);
const repost = row('100', now, { kind: 'repost', handle: 'FredaDuan', distributors: ['FredaDuan'] });
const unknown = row('200', null, { kind: 'repost', handle: 'TMTLongShort', featured: false, score: null });
const quote = row('300', earlier, { kind: 'quote', category: '观点' });
const event = { id: 'post:100', title: 'GPU capacity', score: 88, sourceCount: 2, independentCount: 1, postCount: 2, evidence: ['100'], authors: ['SemiAnalysis_', 'FredaDuan'], updatedAt: now };
const report = { id: 'report-2026-11-20', date: '2026-11-20', title: '日报', sections: [], evidence: [] };
const fixture = { generatedAt: now, activities: [repost, original, quote, unknown], featured: [repost, quote], scores: {}, topics: [],
  hot: [event], singleHot: [{ ...event, id: 'post:300', sourceCount: 1, evidence: ['300'] }], reports: [report], generation: { report: { date: '2026-11-21', status: 'pending' } } };
const params = query => new URLSearchParams(query);

test('public activity filters distinguish attribution, preserve unknown times and follow Beijing dates', () => {
  const all = readItems(fixture, params('mode=all'), site);
  assert.deepEqual(all.items.map(item => item.id), [repost.id, quote.id, original.id, unknown.id]);
  assert.equal(all.items[0].timeBasis, 'observed');
  assert.equal(all.items[0].originalAuthor, original.originalAuthor);
  assert.equal(all.items[0].links.techbuzz, `${site}/research/posts/100`);
  assert.equal(all.items[0].post.text, undefined);
  const featured = readItems(fixture, params('kind=original,quote,repost'), site);
  assert.deepEqual(featured.items.map(item => item.postId), ['100', '300']);
  assert.equal(featured.items[0].id, 'post:100');
  assert.equal(featured.items[0].activityId, repost.id);
  const filtered = readItems(fixture, params('mode=all&kind=quote&kind=repost&account=FredaDuan&category=supply-chain&q=nvidia&onlyFeatured=1&date=2026-11-22'), site);
  assert.deepEqual(filtered.items.map(item => item.id), [repost.id]);
  assert.deepEqual(readItems(fixture, params('mode=all&window=24h&hide=original,quote'), site).items.map(item => item.id), [repost.id]);
  assert.throws(() => readItems(fixture, params('mode=all&category=paper'), site), { status: 400 });
});

test('a cursor carries its view and excludes newly discovered backfill on continuation', () => {
  const page1 = readItems(fixture, params('mode=all&limit=1'), site);
  const cursor = page1.page.nextCursor;
  const newRepost = row('400', null, { kind: 'repost', firstSeenAt: moved });
  const updated = { ...fixture, generatedAt: moved, activities: [newRepost, ...fixture.activities] };
  const next = readItems(updated, params({ limit: '5', cursor }), site);
  assert.deepEqual(next.items.map(item => item.id), [quote.id, original.id, unknown.id]);
  assert.equal(next.page.hasMore, false);
  assert.throws(() => readItems(updated, params({ cursor, category: 'opinion' }), site), { code: 'invalid_cursor' });
});

test('hot details preserve the columns and an older daily never substitutes for the scheduled date', () => {
  const body = readHot(fixture, site);
  assert.equal(body.window, '48h');
  assert.deepEqual([body.hot[0].column, body.singleHot[0].column], ['multi', 'single']);
  const detail = readStory(fixture, event.id, site);
  assert.deepEqual(detail.story.reports.map(item => item.postId), ['100']);
  assert.equal(readDailies(fixture, 'latest', 1, site), null);
  const current = readDailies(fixture, '2026-11-20', 1, site);
  assert.equal(current.report.links.techbuzz, `${site}/daily/2026-11-20`);
});

test('selected sync survives a reader restart and tracks revision, additions and removals', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const read = selectedSyncReader(db);
    const first = read(fixture, params('limit=1'), site, false);
    const next = read(fixture, params({ limit: '1', page: first.nextPage }), site, false);
    assert.equal(next.cursor, first.cursor);
    assert.deepEqual([first.items[0].id, next.items[0].id], ['post:100', 'post:300']);
    const updated = { ...fixture, generatedAt: moved, featured: [original, row('999', now)] };
    const afterRestart = selectedSyncReader(db);
    const delta = afterRestart(updated, params({ cursor: first.cursor }), site, true);
    assert.deepEqual(delta.changes.map(item => [item.op, item.item?.id ?? item.id]), [['upsert', 'post:100'], ['upsert', 'post:999'], ['remove', 'post:300']]);
    assert.deepEqual(afterRestart(updated, params({ cursor: delta.cursor }), site, true).changes, []);
    assert.throws(() => afterRestart(updated, params({ cursor: 'old' }), site, true), { code: 'snapshot_required' });
  } finally {
    db.close();
  }
});
