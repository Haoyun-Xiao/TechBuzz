import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from './db.mjs';
import { ingestPosts } from './collector.mjs';
import { sourceIds, syncResearch } from './bridge.mjs';

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
const query = (rows, sources = states) => (strings, ...values) => {
  if (!Object.hasOwn(strings, 'raw')) return strings;
  assert.deepEqual(values[0], sourceIds);
  return strings.join().includes('FROM articles') ? rows : sources;
};

test('the research cache takes engine revisions and references without polling or changing research state', async () => {
  const db = openDatabase(':memory:');
  try {
    const root = row('1', 'SemiAnalysis_', '2026-11-20T02:00:00Z');
    const reply = row('2', 'SemiAnalysis_', '2026-11-20T02:00:01Z', { replyTo: '1', replyToHandle: 'SemiAnalysis_' });
    const quoted = row('3', 'Omercheema', '2026-11-20T02:00:02Z', {
      quoted: { handle: 'someone', text: 'quoted context', url: 'https://x.com/someone/status/99' },
    });
    const sample = row('4', 'HedgeyeTech', '2026-11-20T02:00:03Z', { text: 'truncated' }, {
      kind: 'original', text: 'full verified text', article: { text: 'verified long article' },
    });
    ingestPosts(db, [{ id: '42', handle: 'OrnnExchange', publishedAt: '2026-11-20T02:01Z', text: 'SQLite-only' }]);
    db.prepare("UPDATE research_settings SET threshold = 82 WHERE id = 1").run();
    const bridged = await syncResearch(db, query([root, reply, quoted, sample]));
    assert.deepEqual(bridged.map(post => post.id), ['4', '3', '2', '1']);
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
