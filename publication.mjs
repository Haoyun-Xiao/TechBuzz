import { createHash } from 'node:crypto';
import { CATEGORY_LABELS } from './activity.mjs';

const labelKeys = new Map(Object.entries(CATEGORY_LABELS).map(([key, label]) => [label, key]));
const sortWindow = { '24h': 24, '48h': 48, '7d': 168, '30d': 720 };
const normalize = value => String(value ?? '').normalize('NFKC').toLowerCase();
const parsedTime = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const beijingDate = time => new Date(time + 8 * 3600000).toISOString().slice(0, 10);
const signature = value => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');

export class PublicationError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function integer(value, name, min, max, fallback) {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) {
    throw new PublicationError(400, 'invalid_request', `${name} 必须在 ${min} 至 ${max} 之间。`);
  }
  return Number(value);
}

function oneOf(value, name, allowed, fallback = null) {
  if (value === null) return fallback;
  if (!allowed.includes(value)) throw new PublicationError(400, 'invalid_request', `${name} 必须是 ${allowed.join('、')}。`);
  return value;
}

export function readItems(snapshot, params, siteUrl) {
  const cursor = params.get('cursor');
  let after;
  if (cursor !== null) {
    try {
      if (!/^rx1\.[a-zA-Z0-9_-]{1,512}$/.test(cursor)) throw new Error('bad cursor');
      after = JSON.parse(Buffer.from(cursor.slice(4), 'base64url').toString());
      if (!['selected','all'].includes(after.mode) || !Number.isSafeInteger(after.asOf) || !Number.isSafeInteger(after.rank)
        || !Number.isSafeInteger(after.time) || typeof after.unknown !== 'boolean' || typeof after.sortId !== 'string'
        || !/^[a-zA-Z0-9:_-]{1,80}$/.test(after.sortId)) throw new Error('bad cursor');
    } catch {
      throw new PublicationError(400, 'invalid_cursor', '游标无效或筛选条件已改变。');
    }
  }
  const mode = oneOf(params.get('mode'), 'mode', ['selected', 'all'], after?.mode ?? 'selected');
  const window = oneOf(params.get('window') ?? (params.get('period') === '24' ? '24h' : null), 'window', ['all', ...Object.keys(sortWindow)], 'all');
  const by = oneOf(params.get('by'), 'by', ['timeline', 'published'], 'timeline');
  const categoryInput = params.get('category') === 'market' ? 'markets' : params.get('category');
  const category = oneOf(labelKeys.get(categoryInput) ?? categoryInput, 'category', Object.keys(CATEGORY_LABELS));
  const everyKind = ['original', 'reply', 'quote', 'repost', 'unknown'];
  const typeList = (values, key) => [...new Set(values.flatMap(value => value.split(',')).map(value => oneOf(value.trim(), key, everyKind)))].sort();
  const kinds = typeList(params.has('kind') ? params.getAll('kind') : params.getAll('type'), 'kind');
  const hidden = typeList(params.getAll('hide'), 'hide');
  const kind = kinds.length ? kinds.join(',') : null;
  const onlyFeatured = oneOf(params.get('onlyFeatured'), 'onlyFeatured', ['true', 'false', '1', '0'], 'false');
  const account = normalize(params.get('account') ?? params.get('source')).replace(/^@/, '') || null;
  if (account && !/^[a-z0-9_]{1,15}$/.test(account)) throw new PublicationError(400, 'invalid_request', '账号无效。');
  const q = params.get('q')?.trim() || null;
  if (q && ([...q].length > 200 || q.includes('\0'))) throw new PublicationError(400, 'invalid_request', '搜索词最多 200 个字符。');
  const terms = normalize(q).split(/\s+/u).filter(Boolean);
  const date = params.get('date');
  if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toJSON()?.slice(0, 10) !== date)) {
    throw new PublicationError(400, 'invalid_request', 'date 必须是 YYYY-MM-DD 格式的真实日期。');
  }
  const sort = oneOf(params.get('sort') === 'time' ? 'new' : params.get('sort'), 'sort', ['new', 'old', 'score'], 'new');
  const company = params.get('company') ?? null;
  const topic = params.get('topic') ?? params.get('tag');
  const topicPosts = company || topic ? new Set(snapshot.topics.filter(item => company ? item.name === company && item.group === 'company' : item.name === topic)
    .flatMap(item => item.postIds)) : null;
  const limit = integer(params.get('limit'), 'limit', 1, 100, 50);
  const ordering = sort === 'score' ? 'scoreDesc' : `${by === 'published' ? 'publishedAt' : 'activityAt'}${sort === 'old' ? 'Asc' : 'Desc'}`;
  const query = { mode, window, by, category, kind, hide: hidden.join(',') || null, account, onlyFeatured: onlyFeatured === 'true' || onlyFeatured === '1', q, date, company, topic, sort, ordering };
  const binding = signature(query);
  if (after && after.binding !== binding) throw new PublicationError(400, 'invalid_cursor', '游标无效或筛选条件已改变。');
  const asOf = after?.asOf ?? Date.parse(snapshot.generatedAt);
  const first = window === 'all' ? null : asOf - sortWindow[window] * 3600000;
  const knownAt = item => !(Date.parse(item.firstSeenAt) > asOf || Date.parse(item.activityAt) > asOf);
  let collection = mode === 'selected' ? snapshot.featured : snapshot.activities;
  if (after && mode === 'selected' && snapshot.featured.some(item => !knownAt(item))) {
    const selected = new Map();
    for (const item of snapshot.activities) if (item.featured && knownAt(item) && !selected.has(item.postId)) selected.set(item.postId, item);
    collection = [...selected.values()];
  }
  const rows = [];
  const compare = (a, b) => Number(a.unknown) - Number(b.unknown) || b.rank - a.rank || b.time - a.time
    || ((a.unknown && sort !== 'score') || sort === 'old' ? a.sortId.localeCompare(b.sortId) : b.sortId.localeCompare(a.sortId));
  for (const item of collection) {
    if (!knownAt(item) || topicPosts && !topicPosts.has(item.postId)) continue;
    if (category && item.category !== CATEGORY_LABELS[category]) continue;
    if (query.onlyFeatured && !item.featured) continue;
    if (hidden.includes(item.kind) || kind && !kinds.includes(item.kind) || account && normalize(item.handle) !== account) continue;
    const time = parsedTime(by === 'published' ? item.post.publishedAt : item.activityAt);
    if (time !== null && time > asOf || first !== null && (time === null || time < first)) continue;
    const activityTime = parsedTime(item.activityAt);
    if (date && (activityTime === null || beijingDate(activityTime) !== date)) continue;
    const assessment = snapshot.scores[item.postId];
    if (terms.length) {
      const text = normalize([item.handle, item.originalAuthor, ...item.distributors, item.category, item.post.text, item.post.textZh, item.post.excerpt, item.post.article?.text,
        item.post.article?.title, item.post.quoted?.text, item.post.quotedTextZh, assessment?.summary, assessment?.reason,
        assessment?.event, ...(assessment?.companies ?? []), ...(assessment?.topics ?? [])].filter(Boolean).join(' '));
      if (!terms.every(term => text.includes(term))) continue;
    }
    const id = mode === 'selected' ? `post:${item.postId}` : item.id;
    const entry = { item, assessment, id, sortId: item.id, unknown: mode === 'all' && time === null,
      time: time === null ? Number.MIN_SAFE_INTEGER : sort === 'old' ? -time : time,
      rank: sort === 'score' ? item.score ?? -1 : 0 };
    if (!after || compare(entry, after) > 0) rows.push(entry);
  }
  rows.sort(compare);
  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const last = page.at(-1);
  const nextCursor = hasMore ? 'rx1.' + encode({ binding, asOf, mode, rank: last.rank, time: last.time, sortId: last.sortId, unknown: last.unknown }) : null;
  return { schemaVersion: 1, query, items: page.map(({ item, assessment, id }) => ({ ...publicItem(item, assessment, siteUrl), activityId: item.id, id })),
    page: { count: page.length, hasMore, nextCursor } };
}

function brief(text, max) {
  const clean = text?.replace(/\s+/gu, ' ')?.trim();
  if (!clean) return null;
  const characters = [...clean];
  return characters.length <= max ? clean : characters.slice(0, max).join('') + '…';
}

export function publicItem(item, assessment, siteUrl) {
  const post = item.post;
  const source = { name: `@${item.handle}` };
  const links = { techbuzz: `${siteUrl}/research/posts/${encodeURIComponent(item.postId)}`, original: item.url ?? null };
  const title = assessment?.event || post.article?.title || (post.textZh || post.text || post.excerpt || '').split('\n')[0]?.slice(0, 100) || `@${post.handle}`;
  const material = { id: post.id, handle: post.handle, authorName: post.authorName, publishedAt: post.publishedAt,
    nativeArticleId: post.nativeArticleId, contextStatus: post.contextStatus, kind: post.kind, threadRootId: post.threadRootId };
  return { ...item, post: material, url: links.original, title, originalTitle: post.article?.title ?? null, summary: brief(assessment?.summary || post.textZh || post.text, 500),
    source, links, selected: item.featured, reason: item.featured ? assessment?.reason ?? null : null,
    categoryKey: labelKeys.get(item.category) ?? null, publishedAt: post.publishedAt ?? null,
    discoveredAt: item.firstSeenAt ?? null, attribution: { name: `@${item.originalAuthor ?? item.handle}`, url: links.original } };
}

export function readHot(snapshot, siteUrl) {
  const withLinks = (items, column) => items.map(({ heat, ...item }, index) => ({ ...item, column, rank: index + 1,
    links: { story: `${siteUrl}/story/${encodeURIComponent(item.id)}`, api: `${siteUrl}/api/v1/stories/${encodeURIComponent(item.id)}` } }));
  const hot = withLinks(snapshot.hot, 'multi');
  const singleHot = withLinks(snapshot.singleHot, 'single');
  return { schemaVersion: 1, window: '48h', count: hot.length, items: hot, hot, singleHot };
}

export function readStory(snapshot, id, siteUrl) {
  const { hot, singleHot } = readHot(snapshot, siteUrl);
  const event = [...hot, ...singleHot].find(item => item.id === id);
  if (!event) return null;
  const evidence = new Set(event.evidence);
  const seen = new Set();
  const reports = [];
  for (const item of snapshot.activities) {
    if (!evidence.has(item.postId) || seen.has(item.postId)) continue;
    seen.add(item.postId);
    reports.push(publicItem(item, snapshot.scores[item.postId], siteUrl));
  }
  return { schemaVersion: 1, story: { ...event, publicId: event.id, reports } };
}

export function readDailies(snapshot, key, limit, siteUrl) {
  const decorate = report => ({ ...report, links: { techbuzz: `${siteUrl}/daily/${report.date}` } });
  if (!key) return { schemaVersion: 1, items: snapshot.reports.slice(0, limit).map(decorate), generation: snapshot.generation.report };
  const date = key === 'latest' ? snapshot.generation.report.date : key;
  const report = snapshot.reports.find(report => report.date === date);
  return report ? { schemaVersion: 1, report: decorate(report), generation: snapshot.generation.report } : null;
}
