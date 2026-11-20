import { mkdirSync } from 'node:fs';
import http from 'node:http';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { fetchJson, handles, ingestPosts, initCollector } from './collector.mjs';

const sampleLinks = [
  'aleabitoreddit/2123762482280055255',
  'SemiAnalysis_/2123602894586818740',
  'HedgeyeTech/2123625335547998476',
  'Omercheema/2123487859201991037',
  'OrnnExchange/2123451571451167047',
  'FredaDuan/2123088477868736729',
  'TMTLongShort/2123554754832089364',
  'RYANHINGSHING/2123761251012804721',
];
const allowed = new Set(handles.map(handle => handle.toLowerCase()));
const baseUrl = 'https://api.fxtwitter.com';

function sampleTarget(value) {
  const match = /^(?:https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/)?@?([a-z0-9_]{1,15})(?:\/status\/|\/|:)(\d{1,20})(?:[?#].*)?$/i.exec(value);
  if (match && (allowed.has(match[1].toLowerCase()) || match[1].toLowerCase() === 'i')) {
    return { id: match[2], handle: match[1].toLowerCase() === 'i' ? null : match[1] };
  }
  if (/^\d{1,20}$/.test(value)) return { id: value, handle: null };
  throw new Error(`Invalid sample URL or author/post ID: ${value}`);
}

const postLink = (id, handle) => `https://x.com/${handle ?? 'i'}/status/${id}`;
const validId = id => typeof id === 'string' && /^\d{1,20}$/.test(id);
const validHandle = handle => typeof handle === 'string' && /^[a-z0-9_]{1,15}$/i.test(handle);

function media(item) {
  if (typeof item?.url !== 'string' || !item.url.startsWith('https://')) return [];
  const kind = item.type === 'video' || item.type === 'gif' ? 'video' : 'image';
  return [{
    kind, url: item.url, width: item.width ?? null, height: item.height ?? null,
    poster: item.thumbnail_url ?? null, alt: item.altText ?? null,
  }];
}

function article(tweet, url) {
  const entry = tweet.article;
  if (!entry) return null;
  const entities = new Map((entry.content?.entityMap ?? []).map(entity => [String(entity.key), entity.value]));
  const mediaInfo = [entry.cover_media, ...(entry.media_entities ?? [])].flatMap(item => {
    const info = item?.media_info;
    if (!info) return [];
    return media({ type: info.type, url: info.original_img_url ?? info.media_url_https,
      width: info.original_img_width ?? info.original_info?.width, height: info.original_img_height ?? info.original_info?.height,
      altText: info.ext_alt_text });
  });
  const marks = { 'header-one': '# ', 'header-two': '## ', 'header-three': '### ', blockquote: '> ',
    'unordered-list-item': '- ', 'ordered-list-item': '1. ' };
  const paragraphs = (entry.content?.blocks ?? []).flatMap(block => {
    if (block.type !== 'atomic') return block.text?.trim() ? [`${marks[block.type] ?? ''}${block.text.trim()}`] : [];
    return (block.entityRanges ?? []).flatMap(range => {
      const entity = entities.get(String(range.key));
      if (entity?.type === 'MARKDOWN' && entity.data.markdown) return [entity.data.markdown];
      if (entity?.type === 'TWEET' && validId(entity.data.tweetId)) return [postLink(entity.data.tweetId)];
      return [];
    });
  });
  const text = paragraphs.join('\n\n').trim();
  return text ? { title: entry.title ?? '', text, url, media: mediaInfo } : null;
}

function reference(tweet) {
  const handle = tweet?.author?.screen_name;
  if (!validId(tweet?.id) || !validHandle(handle)) return null;
  const date = new Date(tweet.created_at);
  const publishedAt = Number.isFinite(date.getTime()) ? date.toISOString() : null;
  const files = tweet.media?.all ?? [...(tweet.media?.photos ?? []), ...(tweet.media?.videos ?? [])];
  const url = postLink(tweet.id, handle);
  const quoted = tweet.quote;
  return {
    id: tweet.id, handle, authorName: tweet.author.name ?? handle, url, publishedAt,
    text: typeof tweet.text === 'string' ? tweet.text.trim() : files.length ? '' : null,
    media: files.flatMap(media), article: article(tweet, url),
    quoted: validId(quoted?.id) && validHandle(quoted?.author?.screen_name)
      ? { id: quoted.id, handle: quoted.author.screen_name, text: quoted.text ?? null,
        authorName: quoted.author.name ?? quoted.author.screen_name, url: postLink(quoted.id, quoted.author.screen_name),
        publishedAt: Number.isFinite(Date.parse(quoted.created_at)) ? new Date(quoted.created_at).toISOString() : null,
        media: (quoted.media?.all ?? []).flatMap(media), article: article(quoted, postLink(quoted.id, quoted.author.screen_name)) }
      : null,
  };
}

function replyTarget(tweet) {
  const id = tweet.replying_to?.status ?? tweet.replying_to_status;
  if (!validId(id)) return null;
  const author = tweet.replying_to?.screen_name ?? tweet.replying_to;
  const handle = validHandle(author) ? author : null;
  return { id, handle, authorName: null, text: null, url: postLink(id, handle), publishedAt: null, media: [] };
}

async function fetchSample(id, fetchImpl) {
  let latestError = 'request failed';
  for (const resource of ['/2/thread/', '/2/conversation/', '/status/', '/2/status/']) {
    try {
      const data = await fetchJson(`${baseUrl}${resource}${id}`, { fetchImpl, timeoutMs: 8_000 });
      const tweet = data?.status ?? data?.tweet;
      if (data?.code === 200 && tweet?.id === id) return { tweet, thread: data.thread ?? [] };
      latestError = 'the API returned no matching status';
    } catch (error) {
      latestError = error.status ? `HTTP ${error.status}` : error.name === 'TimeoutError' ? 'timeout' : 'request failed';
    }
  }
  throw new Error(`FxTwitter ${id}: ${latestError}`);
}

export async function bootstrap(db, inputs = [], { fetchImpl } = {}) {
  initCollector(db);
  const targets = new Map([...sampleLinks, ...inputs].map(sampleTarget).map(target => [target.id, target]));
  const failed = [];
  const result = { verified: 0, added: 0, updated: 0, failed };
  const cache = new Map();
  const read = id => {
    if (!cache.has(id)) cache.set(id, fetchSample(id, fetchImpl));
    return cache.get(id);
  };
  // Two bounded streams keep retries independent when a particular status is slow.
  const remaining = [...targets.values()];
  const worker = async () => {
    while (remaining.length) {
      const target = remaining.shift();
      try {
        const { tweet, thread } = await read(target.id);
        const known = new Map([...thread, tweet].filter(item => item && validId(item.id)).map(item => [item.id, item]));
        const primary = reference(tweet);
        if (!primary?.publishedAt || !allowed.has(primary.handle.toLowerCase())
          || (target.handle && primary.handle.toLowerCase() !== target.handle.toLowerCase())) {
          throw new Error(`FxTwitter ${target.id}: author or timestamp did not match`);
        }
        const records = [];
        for (const item of known.values()) {
          const post = reference(item);
          // Additional authors may appear as context but cannot enter the author feed.
          if (!post?.publishedAt || post.handle.toLowerCase() !== primary.handle.toLowerCase() || post.text == null) continue;
          let replyTo = replyTarget(item);
          if (replyTo) {
            const reply = known.get(replyTo.id) ?? (await read(replyTo.id).catch(() => null))?.tweet;
            replyTo = reference(reply) ?? replyTo;
          }
          records.push({
            ...post, replyTo, kind: replyTo ? 'reply' : post.quoted ? 'quote' : 'original',
            contextStatus: replyTo && replyTo.text == null || item.article && !post.article ? 'unavailable' : 'complete',
          });
        }
        if (!records.some(post => post.id === target.id)) throw new Error(`FxTwitter ${target.id}: no usable post body`);
        const counts = ingestPosts(db, records, { sample: true });
        result.verified++;
        result.added += counts.added;
        result.updated += counts.updated;
      } catch (error) {
        failed.push({ id: target.id, handle: target.handle, error: error.message });
      }
    }
  };
  await Promise.all([worker(), worker()]);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.HTTPS_PROXY || process.env.https_proxy) http.setGlobalProxyFromEnv?.();
  const path = process.env.TECHBUZZ_DB || '/data/techbuzz.sqlite';
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 15000');
  try {
    const result = await bootstrap(db, process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
    if (result.failed.length) process.exitCode = 1;
  } finally {
    db.close();
  }
}
