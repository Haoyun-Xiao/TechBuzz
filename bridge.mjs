// PostgreSQL is the source of research material. SQLite keeps a local view for the
// existing research jobs and dashboard, along with their scores and receipts.
import { handles, ingestPosts, posts } from './collector.mjs';

const sourceHandles = new Map(handles.map(handle => [`x-${handle.toLowerCase()}`, handle]));
export const sourceIds = [...sourceHandles.keys()];
const articleLink = /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/article\/\d+/i;

function reference(ref) {
  const id = ref?.id ?? /\/status\/(\d+)/.exec(ref?.url ?? '')?.[1];
  if (!id) return null;
  return {
    ...ref, id, handle: ref.handle ?? null, authorName: ref.authorName ?? null,
    url: ref.url ?? `https://x.com/${ref.handle ?? 'i'}/status/${id}`,
    text: ref.text ?? null, publishedAt: ref.publishedAt ?? null, media: ref.media ?? [],
  };
}

function nativeReference(native, verified) {
  const current = reference(native);
  return current?.id === verified?.id && current?.text == null ? verified : current;
}

function fromMaterial(row) {
  const post = row.x_post;
  const verified = row.verified;
  // A rediscovered sample keeps richer verified context when the search response is partial.
  const native = !verified || row.fetched && post.text?.length >= (verified.text?.length ?? 0);
  const quoted = native ? nativeReference(post.quoted ?? { id: post.quoteId }, verified?.quoted) : verified.quoted;
  const replyTo = native ? nativeReference({ id: post.replyTo, handle: post.replyToHandle }, verified?.replyTo) : verified.replyTo;
  const repostOf = native ? nativeReference(post.repostOf, verified?.repostOf) : verified.repostOf;
  const storedArticle = row.x_article?.text ? { ...row.x_article, url: row.url } : null;
  const article = storedArticle ?? verified?.article ?? null;
  const text = native ? repostOf ? '' : post.text : verified.text;
  return {
    ...verified,
    id: post.tweetId, handle: sourceHandles.get(row.source_id), url: row.url,
    publishedAt: row.published_at.toISOString(), collectedAt: row.discovered_at.toISOString(),
    authorName: native ? post.authorName : verified.authorName,
    kind: native ? repostOf ? 'repost' : replyTo ? 'reply' : quoted ? 'quote' : 'original' : verified.kind,
    text, media: native ? repostOf ? [] : post.media : verified.media, quoted, replyTo, repostOf, article,
    sample: !row.fetched && !!verified,
    contextStatus: [quoted, replyTo, repostOf].some(item => item && item.text == null)
      || (!article && articleLink.test(text)) ? 'unavailable' : 'complete',
  };
}

export async function syncResearch(db, sql) {
  const [materials, sources] = await Promise.all([
    sql`
      SELECT a.source_id, a.url, a.published_at, a.discovered_at, a.x_post, a.x_article,
             a.raw->'techbuzzSample' AS verified,
             EXISTS (SELECT 1 FROM article_discoveries d
                     WHERE d.article_id = a.id AND d.source_id = a.source_id AND d.via = 'fetch') AS fetched
      FROM articles a JOIN sources s ON s.id = a.source_id
      WHERE s.kind = 'x_search' AND s.id IN ${sql(sourceIds)} AND a.published_at IS NOT NULL
        AND a.x_post IS NOT NULL
    `,
    sql`
      SELECT s.id, s.cursor, s.last_fetch_at, s.last_ok_at, s.last_error, s.enabled, run.new_count
      FROM sources s LEFT JOIN LATERAL (
        SELECT new_count FROM fetch_runs WHERE source_id = s.id AND status = 'ok' ORDER BY started_at DESC, id DESC LIMIT 1
      ) run ON true WHERE s.kind = 'x_search' AND s.id IN ${sql(sourceIds)}
    `,
  ]);
  // The research cache is only replaced after a successful read of the full source set.
  if (sources.length !== sourceIds.length) throw new Error('The eight engine X sources are not seeded');
  const projected = materials.map(fromMaterial);
  const present = new Set(projected.map(post => post.id));
  const remove = db.prepare('DELETE FROM x_posts WHERE id = ?');
  const writeSource = db.prepare(`
    UPDATE x_sources SET coverage_start = ?, coverage_end = ?, last_success = ?,
      last_attempt = ?, error = ?, last_count = ?, pending = ? WHERE handle = ?
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of db.prepare('SELECT id FROM x_posts').all()) {
      if (!present.has(row.id)) remove.run(row.id);
    }
    for (const sample of [true, false]) {
      ingestPosts(db, projected.filter(post => post.sample === sample), { sample, retainEvidence: true });
    }
    for (const source of sources) {
      writeSource.run(
        source.cursor?.xCoverageStart ?? null, source.cursor?.xCoverageEnd ?? null,
        source.last_ok_at?.toISOString() ?? null, source.last_fetch_at?.toISOString() ?? null,
        source.enabled ? source.last_error : '来源已暂停',
        source.cursor?.xLastCount ?? source.new_count ?? null, source.cursor?.xWindow ? JSON.stringify(source.cursor.xWindow) : null,
        sourceHandles.get(source.id),
      );
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return posts(db);
}
