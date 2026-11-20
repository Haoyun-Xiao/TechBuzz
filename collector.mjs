/*
 * SocialData text and media handling adapted from AIHOT-trial (4c6e9e1).
 * MIT License, Copyright (c) 2026 数字生命卡兹克.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

import { createHash } from 'node:crypto';

export const handles = Object.freeze([
  'aleabitoreddit', 'SemiAnalysis_', 'Omercheema', 'OrnnExchange',
  'HedgeyeTech', 'RYANHINGSHING', 'FredaDuan', 'TMTLongShort',
]);

const canonicalHandles = new Map(handles.map(handle => [handle.toLowerCase(), handle]));
const dayMs = 86_400_000;
const overlapMs = 5 * 60_000;
const articleLink = /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/article\/\d+/i;
const missingKey = 'TECHBUZZ_SOCIALDATA_API_KEY is not configured';
const statusId = value => /^\d{1,20}$/.test(value ?? '') && (typeof value === 'string' || Number.isSafeInteger(value))
  ? String(value) : null;
const userHandle = value => typeof value === 'string' && /^[a-z0-9_]{1,15}$/i.test(value) ? value : null;
const canonical = value => canonicalHandles.get(value?.toLowerCase());
const timestamp = value => value == null || !Number.isFinite(new Date(value).getTime()) ? null : new Date(value).toISOString();
const postUrl = (id, handle) => `https://x.com/${userHandle(handle) ?? 'i'}/status/${id}`;
const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>' };
const decode = value => value.replace(/&(?:amp|lt|gt);/g, entity => entities[entity]);

export function initCollector(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS x_sources (
      handle TEXT PRIMARY KEY COLLATE NOCASE,
      coverage_start TEXT,
      coverage_end TEXT,
      last_success TEXT,
      last_attempt TEXT,
      error TEXT,
      last_count INTEGER,
      pending TEXT
    );
    CREATE TABLE IF NOT EXISTS x_posts (
      id TEXT PRIMARY KEY,
      handle TEXT NOT NULL REFERENCES x_sources(handle),
      published_at TEXT NOT NULL,
      sample INTEGER NOT NULL CHECK (sample IN (0, 1)),
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS x_posts_handle_date ON x_posts (handle, published_at DESC);
  `);
  const statement = db.prepare('INSERT OR IGNORE INTO x_sources (handle) VALUES (?)');
  for (const handle of handles) statement.run(handle);
}

function atomic(db, callback) {
  db.exec('SAVEPOINT x_ingest');
  try {
    const result = callback();
    db.exec('RELEASE x_ingest');
    return result;
  } catch (error) {
    db.exec('ROLLBACK TO x_ingest');
    db.exec('RELEASE x_ingest');
    throw error;
  }
}

function httpUrl(value) {
  if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) return null;
  return value;
}

function tweetText(tweet) {
  const note = tweet.note_tweet?.note_tweet_results?.result ?? tweet.note_tweet ?? tweet.noteTweet;
  const raw = note?.text ?? tweet.extended_tweet?.full_text ?? tweet.full_text ?? tweet.text ?? '';
  const urls = note?.entity_set?.urls ?? tweet.extended_tweet?.entities?.urls ?? tweet.entities?.urls ?? [];
  const media = tweet.extended_entities?.media ?? tweet.extended_tweet?.extended_entities?.media ?? tweet.entities?.media ?? [];
  let text = decode(typeof raw === 'string' ? raw : '');
  for (const item of media) {
    if (typeof item.url === 'string') text = text.replaceAll(item.url, '');
  }
  for (const item of urls) {
    if (item.url && item.expanded_url) text = text.replaceAll(item.url, item.expanded_url);
  }
  if (media.some(item => !item.url)) text = text.replace(/\s*https:\/\/t\.co\/\w+\s*$/, '');
  return text.trim();
}

function tweetMedia(tweet) {
  const media = tweet.extended_entities?.media ?? tweet.extended_tweet?.extended_entities?.media ?? tweet.entities?.media ?? [];
  return media.flatMap(item => {
    const kind = item.type === 'photo' ? 'image' : 'video';
    const poster = httpUrl(item.media_url_https);
    const playback = item.video_info?.variants?.filter(variant => variant.content_type === 'video/mp4' && httpUrl(variant.url))
      .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0))[0]?.url;
    const url = playback ?? poster;
    return url ? [{ kind, url, width: item.original_info?.width ?? null, height: item.original_info?.height ?? null,
      poster: kind === 'video' ? poster : null, alt: item.ext_alt_text ?? item.alt_text ?? null }] : [];
  });
}

function reference(id, handle) {
  return id ? { id, handle: handle ?? null, authorName: null, text: null, url: postUrl(id, handle), publishedAt: null, media: [] } : null;
}

function socialRef(tweet) {
  const id = statusId(tweet?.id_str ?? tweet?.id);
  const handle = userHandle(tweet?.user?.screen_name);
  if (!id || !handle) return null;
  return {
    ...reference(id, handle), authorName: tweet.user.name ?? handle, text: tweetText(tweet),
    publishedAt: timestamp(tweet.tweet_created_at ?? tweet.created_at), media: tweetMedia(tweet),
  };
}

function articleFromSocial(response, url) {
  const article = response?.article;
  const text = response?.markdown_source === 'article' && typeof response.markdown === 'string' ? response.markdown.trim() : '';
  if (!article || !text) return null;
  const cover = httpUrl(article.cover_url);
  return { title: article.title ?? '', text, url, media: cover ? [{ kind: 'image', url: cover, alt: null }] : [] };
}

function withoutQuotedLink(text, quotedId) {
  return quotedId
    ? text.replace(new RegExp(`\\s*https?://(?:www\\.)?(?:x|twitter)\\.com/[\\w]+/status/${quotedId}(?:\\?\\S*)?\\s*$`, 'i'), '').trim()
    : text;
}

/** Store normalized posts supplied by an explicitly verified source. No source cursor changes here. */
export function ingestPosts(db, input, { sample = false, collectedAt = new Date().toISOString() } = {}) {
  return atomic(db, () => {
    const existing = db.prepare('SELECT handle, sample, payload FROM x_posts WHERE id = ?');
    const write = db.prepare(`
      INSERT INTO x_posts (id, handle, published_at, sample, payload) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET handle = excluded.handle, published_at = excluded.published_at,
        sample = excluded.sample, payload = excluded.payload
    `);
    const result = { added: 0, updated: 0, promoted: 0 };
    for (const record of input) {
      const handle = canonical(userHandle(record.handle));
      const id = statusId(record.id);
      const publishedAt = timestamp(record.publishedAt);
      if (!handle || !id || !publishedAt) continue;
      const prior = existing.get(id);
      if (prior && (prior.handle !== handle || (!prior.sample && sample))) continue;
      const previous = prior ? JSON.parse(prior.payload) : null;
      const recordText = record.text ?? '';
      const post = {
        ...record, id, handle, publishedAt, sample, collectedAt: previous?.collectedAt ?? collectedAt, url: postUrl(id, handle),
        text: recordText, media: record.media ?? [], article: record.article ?? previous?.article ?? null,
        quoted: record.quoted ?? null, replyTo: record.replyTo ?? null, repostOf: record.repostOf ?? null,
        kind: record.kind ?? 'original', contextStatus: record.contextStatus ?? 'complete',
      };
      // A later lookup can be sparse. Keep previously observed context for the same target.
      for (const key of ['quoted', 'replyTo', 'repostOf']) {
        if (post[key]?.id === previous?.[key]?.id && post[key]?.text == null && previous?.[key]?.text != null) {
          post[key] = previous[key];
        }
      }
      if ((!post.article && articleLink.test(post.text)) || [post.quoted, post.replyTo, post.repostOf].some(item => item && item.text == null)) {
        post.contextStatus = record.contextStatus === 'unavailable' ? 'unavailable' : 'missing';
      } else if (post.contextStatus === 'missing') {
        post.contextStatus = 'complete';
      }
      post.originId = statusId(post.repostOf?.id ?? post.quoted?.id) ?? null;
      const payload = JSON.stringify(post);
      if (prior?.payload === payload) continue;
      write.run(id, handle, publishedAt, Number(sample), payload);
      if (!prior) result.added += 1;
      else if (prior.sample && !sample) result.promoted += 1;
      else result.updated += 1;
    }
    return result;
  });
}

const comparePublished = (a, b) => a.publishedAt.localeCompare(b.publishedAt)
  || (BigInt(a.id) < BigInt(b.id) ? -1 : Number(a.id !== b.id));

export function posts(db) {
  const all = db.prepare('SELECT payload FROM x_posts ORDER BY published_at DESC, length(id) DESC, id DESC')
    .all().map(row => JSON.parse(row.payload));
  const byId = new Map(all.map(post => [post.id, post]));
  const threads = new Map();
  for (const post of all) {
    let current = post;
    const visited = new Set([post.id]);
    while (current.replyTo) {
      const parent = byId.get(current.replyTo.id);
      if (!parent || parent.handle !== post.handle || visited.has(parent.id) || comparePublished(parent, current) >= 0) break;
      current = parent;
      visited.add(current.id);
    }
    post.threadRootId = current.id;
    if (post.id !== current.id) {
      if (!threads.has(current.id)) threads.set(current.id, []);
      threads.get(current.id).push(post);
    }
    // Preserve interpretations in posts while giving downstream counts the underlying evidence identity.
    post.evidenceKey = post.originId ? `x:${post.originId}` : post.propagationKey ?? `x:${current.originId ?? current.id}`;
  }
  for (const post of all) {
    post.thread = (threads.get(post.id) ?? []).sort(comparePublished).map(child => ({ ...child, thread: [] }));
  }
  return all;
}

export function sources(db) {
  const query = db.prepare(`
    SELECT x_sources.*,
      sum(CASE WHEN x_posts.sample = 0 THEN 1 ELSE 0 END) AS post_count,
      sum(CASE WHEN x_posts.sample = 1 THEN 1 ELSE 0 END) AS sample_count,
      max(x_posts.published_at) AS latest_post_at
    FROM x_sources LEFT JOIN x_posts USING (handle)
    WHERE x_sources.handle = ? GROUP BY x_sources.handle
  `);
  return handles.map(handle => {
    const row = query.get(handle);
    const pending = row.pending ? JSON.parse(row.pending) : null;
    let status = row.last_success ? row.last_count ? 'ok' : 'empty' : 'pending';
    if (pending) status = row.coverage_start ? 'catching-up' : 'backfilling';
    if (row.error) status = row.error === missingKey ? 'unconfigured' : 'error';
    return {
      handle, status, lastSuccess: row.last_success, lastAttempt: row.last_attempt, error: row.error,
      coverageStart: row.coverage_start, coverageEnd: row.coverage_end, backfillComplete: !!row.coverage_start,
      latestPostAt: row.latest_post_at, postCount: row.post_count, sampleCount: row.sample_count, lastCount: row.last_count,
    };
  });
}

class ProviderError extends Error {
  constructor(status) {
    super(`SocialData HTTP ${status}`);
    this.status = status;
  }
}

export async function fetchJson(url, { fetchImpl = fetch, timeoutMs = 30_000, headers = {}, missing = [] } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetchImpl(url, { signal, redirect: 'error', headers: { accept: 'application/json', ...headers } });
    if (missing.includes(response.status)) return null;
    if (!response.ok) throw new ProviderError(response.status);
    return await response.json();
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    throw error;
  }
}

function socialData(apiKey, options) {
  const request = (path, missing) => fetchJson(`https://api.socialdata.tools${path}`, {
    ...options, headers: { authorization: `Bearer ${apiKey}` }, missing,
  });
  const details = new Map();
  return {
    search: params => request(`/twitter/search?${params}`),
    tweet: id => {
      if (!details.has(id)) details.set(id, request(`/twitter/tweets/${id}`, [403, 404]));
      return details.get(id);
    },
    article: id => request(`/v2/twitter/article/${id}`, [403, 404]),
  };
}

async function socialPost(tweet, client) {
  const id = statusId(tweet.id_str ?? tweet.id);
  if (tweet.truncated && !tweet.note_tweet && !tweet.extended_tweet) {
    const detail = await client.tweet(id);
    if (statusId(detail?.id_str ?? detail?.id) === id && detail.user?.screen_name?.toLowerCase() === tweet.user.screen_name.toLowerCase()) {
      tweet = detail;
    }
  }
  const post = socialRef(tweet);
  if (!post?.publishedAt) throw new Error('SocialData returned an invalid author, post ID or timestamp');
  const repostId = statusId(tweet.retweeted_status?.id_str ?? tweet.retweeted_status_id_str);
  const quoteId = statusId(tweet.quoted_status?.id_str ?? tweet.quoted_status_id_str);
  const replyId = statusId(tweet.in_reply_to_status_id_str);
  const isRepost = !!(repostId || tweet.retweeted_status || /^RT @[a-z0-9_]+:/i.test(post.text));
  const isQuote = !!(quoteId || tweet.is_quote_status);
  const propagationKey = isRepost && !repostId && post.text
    ? `repost:${createHash('sha256').update(post.text.toLowerCase().replace(/\s+/g, ' ')).digest('hex')}` : null;
  const getRef = async (embedded, id, handle) => {
    if (!id) return null;
    const inline = socialRef(embedded);
    const data = inline?.id === id && (inline.text || inline.media.length) && !embedded.truncated
      ? embedded : await client.tweet(id);
    const item = socialRef(data);
    if (item?.id !== id || !(item.text || item.media.length)) return reference(id, inline?.handle ?? userHandle(handle));
    const linkedQuote = socialRef(data.quoted_status);
    return linkedQuote ? { ...item, quoted: linkedQuote } : item;
  };
  const [quoted, replyTo, repostOf, article] = await Promise.all([
    getRef(tweet.quoted_status, quoteId),
    getRef(null, replyId, tweet.in_reply_to_screen_name),
    getRef(tweet.retweeted_status, repostId),
    !isRepost && articleLink.test(post.text) ? client.article(post.id).then(result => articleFromSocial(result, post.url)) : null,
  ]);
  const contextStatus = (isQuote && !quoted) || (isRepost && !repostOf)
    || [quoted, replyTo, repostOf].some(item => item && item.text == null)
    || (!isRepost && articleLink.test(post.text) && !article) ? 'unavailable' : 'complete';
  return {
    ...post, kind: isRepost ? 'repost' : replyId ? 'reply' : isQuote ? 'quote' : 'original',
    text: isRepost ? '' : withoutQuotedLink(post.text, quoteId),
    media: isRepost ? [] : post.media, quoted, replyTo, repostOf, article, propagationKey, contextStatus,
  };
}

function startWindow(row, now) {
  const from = row.coverage_end ? Date.parse(row.coverage_end) - overlapMs : now - 30 * dayMs;
  return { from, to: now, beforeId: null, cursor: null, lowestId: null, count: 0 };
}

function searchParameters(handle, pending) {
  const terms = [`from:${handle}`, 'include:nativeretweets',
    `since_time:${Math.floor(pending.from / 1000) - 1}`, `until_time:${Math.ceil(pending.to / 1000)}`];
  if (pending.beforeId) terms.push(`max_id:${pending.beforeId}`);
  const params = new URLSearchParams({ query: terms.join(' '), type: 'Latest' });
  if (pending.cursor) params.set('cursor', pending.cursor);
  return params;
}

async function readAccount(db, client, handle, now, maxPages) {
  let added = 0;
  const row = db.prepare('SELECT * FROM x_sources WHERE handle = ?').get(handle);
  if (row.coverage_end && Date.parse(row.coverage_end) >= now) return added;
  const pending = row.pending ? JSON.parse(row.pending) : startWindow(row, now);
  let saved = JSON.stringify(pending);
  const checkpoint = db.prepare(`
    UPDATE x_sources SET pending = ?, error = NULL, last_attempt = max(coalesce(last_attempt, ?), ?)
    WHERE handle = ? AND pending IS ? AND coverage_end IS ?
  `);
  const save = (next, expected) => checkpoint.run(next, timestamp(now), timestamp(now), handle, expected, row.coverage_end).changes > 0;
  if (!save(saved, row.pending)) return added;
  try {
    for (let page = 0; page < maxPages; page++) {
      let response;
      try {
        response = await client.search(searchParameters(handle, pending));
      } catch (error) {
        if (![400, 422].includes(error.status) || !pending.cursor || !pending.lowestId) throw error;
        pending.beforeId = pending.lowestId;
        pending.cursor = null;
        const next = JSON.stringify(pending);
        if (!save(next, saved)) return added;
        saved = next;
        continue;
      }
      if (!Array.isArray(response?.tweets) || (response.next_cursor != null && typeof response.next_cursor !== 'string')) {
        throw new Error('SocialData returned an invalid search response');
      }
      const pageIds = response.tweets.map(tweet => statusId(tweet.id_str ?? tweet.id));
      if (pageIds.some(id => !id)) throw new Error('SocialData returned an invalid post ID');
      const oldest = pageIds.reduce((low, id) => low == null || BigInt(id) < BigInt(low) ? id : low, null);
      const advances = oldest && (!pending.lowestId || BigInt(oldest) < BigInt(pending.lowestId));
      const cursor = response.next_cursor || null;
      const inWindow = response.tweets.filter(tweet => {
        if (!userHandle(tweet.user?.screen_name)) throw new Error('SocialData returned a post without a valid author');
        if (canonical(tweet.user.screen_name) !== handle) return false;
        const time = Date.parse(tweet.tweet_created_at ?? tweet.created_at);
        if (!Number.isFinite(time)) throw new Error('SocialData returned an invalid post timestamp');
        return time >= pending.from && time < pending.to;
      });
      const records = [];
      for (const tweet of inWindow) records.push(await socialPost(tweet, client));
      let completed = !oldest && !cursor;
      if (oldest && !advances && !cursor && pending.beforeId) {
        // Some searches treat max_id as inclusive. A boundary-only final page adds no older results.
        if (pageIds.some(id => BigInt(id) > BigInt(pending.beforeId))) throw new Error('SocialData did not honor the page boundary');
        completed = true;
      } else if (advances) {
        pending.lowestId = oldest;
      }
      if (!completed) {
        if (cursor && cursor !== pending.cursor && (advances || !oldest)) {
          pending.cursor = cursor;
        } else if (pending.lowestId && pending.lowestId !== pending.beforeId) {
          pending.beforeId = pending.lowestId;
          pending.cursor = null;
        } else {
          throw new Error('SocialData paging did not advance');
        }
      }
      const committed = atomic(db, () => {
        // Take the SQLite write lock and verify the checkpoint before applying the paid page.
        if (!save(saved, saved)) return false;
        const changes = ingestPosts(db, records, { collectedAt: timestamp(now) });
        const newPosts = changes.added + changes.promoted;
        pending.count += newPosts;
        if (completed) {
          db.prepare(`
            UPDATE x_sources SET pending = NULL, error = NULL, last_success = ?, last_count = ?,
              coverage_start = coalesce(coverage_start, ?), coverage_end = ? WHERE handle = ?
          `).run(timestamp(now), pending.count, timestamp(pending.from), timestamp(pending.to), handle);
        } else {
          const next = JSON.stringify(pending);
          save(next, saved);
          saved = next;
        }
        added += newPosts;
        return true;
      });
      if (!committed) return added;
      if (completed) break;
    }
  } catch (error) {
    const message = error instanceof ProviderError ? error.message
      : error.name === 'TimeoutError' || error.cause?.code === 'UND_ERR_CONNECT_TIMEOUT' ? 'SocialData request timed out'
        : error instanceof SyntaxError ? 'SocialData returned invalid JSON'
          : error.message?.startsWith('SocialData ') ? error.message : 'SocialData request failed';
    db.prepare('UPDATE x_sources SET error = ? WHERE handle = ? AND pending = ?').run(message, handle, saved);
  }
  return added;
}

const activeCollections = new WeakMap();

async function collectAccounts(db, { apiKey = process.env.TECHBUZZ_SOCIALDATA_API_KEY, fetchImpl, now = Date.now(), timeoutMs = 30_000, maxPages = 5 } = {}) {
  initCollector(db);
  now = new Date(now).getTime();
  if (!Number.isFinite(now)) throw new TypeError('Invalid collection time');
  if (!apiKey?.trim()) {
    db.prepare('UPDATE x_sources SET last_attempt = ?, error = ?').run(timestamp(now), missingKey);
    return { status: 'unconfigured', added: 0, sources: sources(db) };
  }
  const client = socialData(apiKey.trim(), { fetchImpl, timeoutMs });
  const totals = await Promise.all(handles.map(handle => readAccount(db, client, handle, now, maxPages)));
  const status = sources(db);
  return {
    status: status.some(source => source.error) ? 'error'
      : status.some(source => ['backfilling', 'catching-up'].includes(source.status)) ? 'partial' : 'ok',
    added: totals.reduce((sum, count) => sum + count, 0), sources: status,
  };
}

export function collect(db, options) {
  if (!activeCollections.has(db)) {
    activeCollections.set(db, collectAccounts(db, options).finally(() => activeCollections.delete(db)));
  }
  return activeCollections.get(db);
}
