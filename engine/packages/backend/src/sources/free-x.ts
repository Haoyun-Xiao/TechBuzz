import { load } from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { tweetToCandidate, xArticleText, xArticleHtml } from "./x.ts";
import type { Candidate } from "./types.ts";
import type { SdTweet } from "../providers/socialdata.ts";

const MIRRORS = ["https://nitter.mie.foundation", "https://xitter.cf"];
const FX = "https://api.fxtwitter.com";
const MINUTE = 60_000;
const RESCAN_INTERVAL = 48 * 60 * MINUTE;
const cooldowns = new Map<string, number>();
type Found = { id: string; author: string; repost: boolean; pinned?: boolean; attempts?: number; retryAt?: number; missing?: number };
type Unavailable = Pick<Found, "id" | "author" | "repost"> & { reason: "not_found" | "no_public_content" };
type Activity = { tweetId: string; kind: "authored" | "repost"; author: string; url: string; publishedAt: string; text?: string };
const key = (f: Found) => `${f.repost ? "r" : "a"}:${f.id}`;
function status(url: string): { author: string; id: string } | null {
  const m = /(?:https?:\/\/[^/]+)?\/([a-z0-9_]{1,15})\/status\/(\d{1,20})/i.exec(url);
  return m ? { author: m[1]!, id: m[2]! } : null;
}
class UpstreamError extends Error {
  readonly status: number;
  constructor(origin: string, status: number) {
    super(`${new URL(origin).host}: HTTP ${status}`);
    this.status = status;
  }
}
async function get(url: string, timeout = 6000): Promise<string> {
  const { origin } = new URL(url);
  if ((cooldowns.get(origin) ?? 0) > Date.now()) throw new Error(`${new URL(origin).host}: waiting after upstream rate limit`);
  const response = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { "user-agent": "Mozilla/5.0", accept: "text/html, application/rss+xml, application/json" } });
  if (!response.ok) {
    if (response.status === 429) {
      const value = response.headers.get("retry-after");
      const delay = value && /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value ?? "") - Date.now();
      cooldowns.set(origin, Date.now() + (Number.isFinite(delay) && delay > 0 ? delay : MINUTE));
    }
    throw new UpstreamError(origin, response.status);
  }
  return response.text();
}
function parseHtml(html: string, handle: string): { found: Found[]; next: string | null } {
  const $ = load(html);
  if (!$(".timeline, .timeline-item, .timeline-none").length) throw new Error("Invalid Nitter timeline");
  const found: Found[] = [];
  $(".timeline-item").each((_i, el) => {
    const item = $(el), link = status(item.find("a.tweet-link").first().attr("href") ?? "");
    if (!link) return;
    const repost = item.find(".retweet-header").length > 0;
    if (link.author.toLowerCase() === handle.toLowerCase() || repost) found.push({ ...link, repost, pinned: item.find(".pinned").length > 0 || item.find(".pinned-header").length > 0 });
  });
  const href = $(".show-more a").last().attr("href") ?? "";
  return { found, next: /[?&]cursor=([^&]+)/.exec(href)?.[1] ? new URL(href, "https://example.com").searchParams.get("cursor") : null };
}
function parseRss(xml: string, handle: string): Found[] {
  const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml);
  if (parsed?.rss?.channel === undefined) throw new Error("Invalid Nitter RSS");
  const raw = parsed.rss.channel.item ?? [], entries = Array.isArray(raw) ? raw : [raw];
  return entries.flatMap((entry: any) => {
    const link = status(String(entry.link ?? entry.guid?.["#text"] ?? entry.guid ?? ""));
    if (!link) return [];
    return [{ ...link, repost: /^\s*RT by\b/i.test(String(entry.title ?? "")) || link.author.toLowerCase() !== handle.toLowerCase() }];
  });
}
async function nitter<T>(path: string, parse: (text: string) => T, alternate = false): Promise<T> {
  const errors: string[] = [];
  for (const mirror of alternate ? [...MIRRORS].reverse() : MIRRORS) try { return parse(await get(mirror + path)); } catch (e) { errors.push(`${new URL(mirror).host} ${e instanceof Error ? e.message : String(e)}`); }
  throw new Error(errors.join(" / "));
}
type Parent = { id: string; handle: string; authorName: string; url: string; text: string; publishedAt: string | null };
type Material = { tweet: SdTweet; article: ReturnType<typeof xArticleText>; parent?: Parent };
type Detail = { material: Material | null; continuations: Array<{ f: Found; material: Material | null }>; unavailable?: Unavailable["reason"] };
const matches = (t: any, f: Found) => t?.id === f.id && t.author?.screen_name?.toLowerCase() === f.author.toLowerCase() && Number.isFinite(Date.parse(t.created_at));
const hasContent = (m: Material | null) => !!(m?.article?.text || m?.tweet.full_text?.trim() || m?.tweet.extended_entities?.media?.length || m?.tweet.quoted_status);
const missing = (error: unknown) => error instanceof UpstreamError && [404, 410].includes(error.status);

function material(t: any, f: Found, siblings: any[] = []): Material | null {
  if (!matches(t, f)) return null;
  const parentId = t.replying_to?.status ?? t.replying_to_status;
  const context = siblings.find((row) => row.id === parentId);
  const parent = context && /^[a-z0-9_]{1,15}$/i.test(context.author?.screen_name ?? "") && typeof context.text === "string"
    ? { id: parentId, handle: context.author.screen_name, authorName: context.author.name ?? context.author.screen_name,
      url: `https://x.com/${context.author.screen_name}/status/${parentId}`, text: context.text,
      publishedAt: Number.isFinite(Date.parse(context.created_at)) ? new Date(context.created_at).toISOString() : null }
    : undefined;
  const media = (t.media?.all ?? []).flatMap((m: any) => ["photo", "video", "animated_gif"].includes(m.type) && typeof m.url === "string" ? [{ type: m.type, media_url_https: m.url, original_info: { width: m.width, height: m.height } }] : []);
  const tweet: SdTweet = { id_str: t.id, tweet_created_at: t.created_at, full_text: typeof t.text === "string" ? t.text : "", lang: t.lang, user: { screen_name: t.author.screen_name, name: t.author.name ?? t.author.screen_name, profile_image_url_https: t.author.avatar_url }, in_reply_to_status_id_str: t.replying_to?.status ?? t.replying_to_status ?? null, in_reply_to_screen_name: t.replying_to?.screen_name ?? (typeof t.replying_to === "string" ? t.replying_to : null), extended_entities: { media }, favorite_count: t.likes, retweet_count: t.reposts ?? t.retweets, views_count: t.views };
  const quote = t.quote ?? t.quoted_tweet;
  if (quote?.id && quote?.author?.screen_name) tweet.quoted_status = { id_str: String(quote.id), tweet_created_at: quote.created_at ?? t.created_at, full_text: quote.text ?? "", user: { screen_name: quote.author.screen_name, name: quote.author.name ?? quote.author.screen_name }, extended_entities: { media: (quote.media?.all ?? []).filter((m: any) => ["photo", "video", "animated_gif"].includes(m.type) && typeof m.url === "string").map((m: any) => ({ type: m.type, media_url_https: m.url })) } };
  const articleData = t.article?.content ? { title: t.article.title, content_state: t.article.content, cover_url: t.article.cover_media?.media_info?.original_img_url, media_entities: t.article.media_entities } : null;
  let article = articleData ? xArticleText(articleData, `https://x.com/${f.author}/status/${f.id}`) : null;
  if (articleData) {
    const map = t.article.content.entityMap ?? [];
    const entities = new Map<string, any>(Array.isArray(map) ? map.map((e: any) => [String(e.key), e.value]) : Object.entries(map));
    const lines: string[] = [];
    for (const block of t.article.content.blocks ?? []) {
      if (block.type === "atomic") for (const range of block.entityRanges ?? []) {
        const e = entities.get(String(range.key));
        if (e?.type === "MARKDOWN" && typeof e.data?.markdown === "string") lines.push(e.data.markdown);
        if (e?.type === "TWEET" && /^\d+$/.test(String(e.data?.tweetId ?? ""))) lines.push(`https://x.com/i/status/${e.data.tweetId}`);
      } else if (typeof block.text === "string" && block.text.trim()) {
        const mark: Record<string, string> = { "header-one": "# ", "header-two": "## ", "header-three": "### ", blockquote: "> ", "unordered-list-item": "- ", "ordered-list-item": "1. " };
        lines.push((mark[block.type] ?? "") + block.text.trim());
      }
    }
    if (lines.length) article = { title: String(t.article.title ?? "").trim(), text: lines.join("\n\n"), html: xArticleHtml(articleData, `https://x.com/${f.author}/status/${f.id}`) };
  }
  return { tweet, article, parent };
}

function nitterStatus(html: string, f: Found): Material | null {
  const $ = load(html), main = $(".main-tweet").first();
  const date = main.find(".tweet-date a").first();
  const link = status(date.attr("href") ?? "");
  if (link?.id !== f.id || link.author.toLowerCase() !== f.author.toLowerCase()) throw new Error("Invalid Nitter status");
  const content = main.find(".tweet-content").first();
  content.find("br").replaceWith("\n");
  content.find("a").each((_i, el) => {
    const a = $(el), href = a.attr("href") ?? "";
    if (/^https?:\/\//i.test(href)) a.text(href);
  });
  const photos = main.find(".attachments a.still-image").toArray().flatMap((el) => {
    const href = $(el).attr("href") ?? "";
    const path = /^\/pic\/(?:orig\/)?(media(?:%2F|\/).+)$/i.exec(href)?.[1];
    const url = path ? `https://pbs.twimg.com/${decodeURIComponent(path)}` : href;
    return /^https:\/\/pbs\.twimg\.com\/media\//i.test(url) ? [{ type: "photo", url }] : [];
  });
  const reply = status(main.find(".replying-to a[href*='/status/']").first().attr("href") ?? "");
  const quote = main.find(".quote").first(), quoteLink = status(quote.find("a.quote-link").first().attr("href") ?? "");
  return material({ id: link.id, created_at: date.attr("title")?.replace(" · ", " "), text: content.text(),
    author: { screen_name: link.author, name: main.find("a.fullname").first().text() || link.author }, media: { all: photos },
    replying_to_status: reply?.id, replying_to: reply?.author,
    quote: quoteLink && { id: quoteLink.id, author: { screen_name: quoteLink.author }, text: quote.find(".quote-text").text() },
  }, f);
}

async function detail(f: Found, handle: string): Promise<Detail> {
  let direct: any, directMissing = false, threadMissing = false;
  try { direct = JSON.parse(await get(`${FX}/${encodeURIComponent(f.author)}/status/${f.id}`)).tweet; }
  catch (e) { directMissing = missing(e); }
  const primary = material(direct, f);
  let enriched: Material | null = null;
  const continuations: Detail["continuations"] = [];
  // A status is enough for a standalone post. Replies and posts with responses may have a public thread.
  if (!hasContent(primary) || f.author.toLowerCase() === handle.toLowerCase() && (direct?.replies !== 0 || direct?.replying_to || direct?.replying_to_status)) {
    try {
      const data = JSON.parse(await get(`${FX}/2/thread/${f.id}`, 3000));
      if (!Array.isArray(data.thread) || !matches(data.status, f)) throw new Error("Invalid FxTwitter thread");
      const siblings = [data.status, ...data.thread];
      enriched = material(data.status, f, siblings);
      if (f.author.toLowerCase() === handle.toLowerCase()) for (const row of data.thread) {
        const author = row.author?.screen_name;
        if (row.id === f.id || !/^\d{1,20}$/.test(row.id ?? "") || author?.toLowerCase() !== handle.toLowerCase()) continue;
        const next = { id: row.id, author, repost: false };
        continuations.push({ f: next, material: material(row, next, siblings) });
      }
    } catch (e) { threadMissing = missing(e); }
  }
  if (hasContent(enriched) || hasContent(primary)) {
    const best = enriched?.article?.text || hasContent(enriched) && !primary?.article?.text ? enriched! : primary!;
    return { material: best, continuations };
  }
  if (directMissing || primary || f.attempts) {
    try {
      const fallback = await nitter(`/${f.author}/status/${f.id}`, (html) => nitterStatus(html, f));
      if (hasContent(fallback)) return { material: fallback, continuations };
    } catch { /* A missing or failed mirror read cannot establish that the original was deleted. */ }
  }
  // A related post can be listed without readable text or media. Retain that distinction from a transport error.
  return { material: null, continuations, unavailable: directMissing && threadMissing ? "not_found" : primary && enriched ? "no_public_content" : undefined };
}

// X snowflake ids encode original creation time. Only an unpinned own post is a paging anchor.
function isOldAnchor(f: Found, handle: string, cutoff: number): boolean {
  if (f.repost || f.pinned || f.author.toLowerCase() !== handle.toLowerCase() || f.id.length < 18) return false;
  return Number((BigInt(f.id) >> 22n) + 1288834974657n) < cutoff;
}
const validFound = (f: any): f is Found => !!f && typeof f.id === "string" && /^\d{1,20}$/.test(f.id)
  && typeof f.author === "string" && /^[a-z0-9_]{1,15}$/i.test(f.author) && typeof f.repost === "boolean";
const anchor = (f: Found, handle: string) => !f.repost && !f.pinned && f.author.toLowerCase() === handle.toLowerCase();
type Walk = { next: string | null; older: number; failures: number; alternate: boolean; previousIds: string[] };
type Recent = Pick<Walk, "older" | "failures" | "alternate"> & { next: string; overlapIds: string[] };
type Lane = { headIds: string[]; recent: Recent | null; history: Walk | null; rescan: { dueAt: number; walk: Walk | null } };
const startWalk = (alternate = false): Walk => ({ next: null, older: 0, failures: 0, alternate, previousIds: [] });
const startRecent = (next: string, overlapIds: string[], alternate = false): Recent => ({ next, overlapIds, older: 0, failures: 0, alternate });
function initialRescanDelay(handle: string, lane: string): number {
  // Spread existing accounts over six hours when upgrading an already completed cursor.
  const hash = [...`${handle.toLowerCase()}:${lane}`].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
  return MINUTE * (hash % 360);
}

/** Dates name original posts, including reposts; coverage is observed, not a completeness claim. */
export async function fetchFreeX(handle: string, cursor: Record<string, any>): Promise<{ items: Candidate[]; activities: Activity[]; cursor: Record<string, any> }> {
  handle = handle.replace(/^@/, "");
  if (!/^[a-z0-9_]{1,15}$/i.test(handle)) throw new Error("Invalid X handle");
  const now = Date.now();
  const cutoff = now - 30 * 86400_000;
  const seen = new Set<string>(Array.isArray(cursor.freeXSeen) ? cursor.freeXSeen.filter((x: unknown) => typeof x === "string") : []);
  const unavailable = new Map<string, Unavailable>((Array.isArray(cursor.freeXUnavailable) ? cursor.freeXUnavailable : [])
    .filter((f: any) => validFound(f) && "reason" in f && (f.reason === "not_found" || f.reason === "no_public_content"))
    .map((f: Unavailable) => [key(f), f]));
  const waiting = new Map<string, Found>((Array.isArray(cursor.freeXPending) ? cursor.freeXPending : [])
    .filter((f: unknown) => validFound(f) && !seen.has(key(f)) && !unavailable.has(key(f)))
    .map((f: Found) => [key(f), f]));
  const discovered = new Map<string, Found>();
  const add = (f: Found) => {
    const id = key(f);
    if (validFound(f) && !seen.has(id) && !waiting.has(id) && !unavailable.has(id)) discovered.set(id, f);
  };
  const oldPages = cursor.freeXPages && typeof cursor.freeXPages === "object" ? cursor.freeXPages : {};
  const oldFresh = cursor.freeXFreshPages && typeof cursor.freeXFreshPages === "object" ? cursor.freeXFreshPages : {};
  const oldLanes = (cursor.freeXLanes ?? {}) as Record<string, Lane | undefined>;
  const lanes: Record<string, Lane> = {};
  const pages: Record<string, string | null> = {}, freshPages: Record<string, string | null> = {}, errors: string[] = [];
  let successes = 0;
  await Promise.all(["profile", "replies"].map(async (lane) => {
    const base = `/${handle}${lane === "replies" ? "/with_replies" : ""}`;
    let first: ReturnType<typeof parseHtml> | undefined;
    const read = (position: string | null, alternate = false) => nitter(base + (position ? `?cursor=${encodeURIComponent(position)}` : ""), (html) => {
      const page = parseHtml(html, handle);
      if (position && page.next === position) throw new Error("Nitter cursor did not advance");
      return page;
    }, alternate);
    try {
      first = await read(null);
      successes++;
      first.found.forEach(add);
    } catch (error) { errors.push(`${lane} timeline: ${String(error)}`); }
    try {
      const entries = await nitter(`${base}/rss`, (xml) => parseRss(xml, handle));
      successes++;
      entries.forEach(add);
    } catch { /* HTML is the primary listing. A supplemental RSS failure does not erase it. */ }

    const readPages = new Map<string, ReturnType<typeof read>>();
    async function more(position: string | null, alternate = false) {
      const cacheKey = `${alternate}:${position ?? ""}`;
      const page = readPages.get(cacheKey) ?? read(position, alternate);
      readPages.set(cacheKey, page);
      const result = await page;
      successes++;
      result.found.forEach(add);
      return result;
    }
    const own = (page: ReturnType<typeof parseHtml>) => page.found.filter((f) => anchor(f, handle));
    const isOlder = (entries: Found[]) => entries.length > 0 && entries.every((f) => isOldAnchor(f, handle, cutoff));
    const overlap = (entries: Found[], ids: string[]) => ids.length
      ? ids.filter((id) => entries.some((f) => f.id === id)).length >= Math.min(ids.length, 2)
      : entries.some((f) => seen.has(key(f)));

    const saved = oldLanes[lane];
    const priorHead = saved?.headIds ?? [];
    const head = first ? own(first) : [];
    let recent = saved ? saved.recent : typeof oldFresh[lane] === "string" ? startRecent(oldFresh[lane], []) : null;
    const target = recent?.overlapIds.length ? recent.overlapIds : priorHead;
    // A fresh burst can arrive while a previous gap is being read. Restart from the new head and keep
    // the older overlap target, so the intervening pages still get read.
    if (first?.next && head.length && (priorHead.length || seen.size) && !overlap(head, priorHead) && first.next !== recent?.next) {
      recent = startRecent(first.next, target);
    }
    if (recent) {
      const current = recent;
      try {
        const page = await more(current.next, current.alternate), entries = own(page);
        const older = isOlder(entries) ? current.older + 1 : 0;
        recent = !page.next || overlap(entries, current.overlapIds) || older >= 2 ? null : { ...current, next: page.next, older, failures: 0 };
      } catch (error) {
        errors.push(`${lane} recent pages: ${String(error)}`);
        recent = { ...current, failures: current.failures + 1 };
        if (recent.failures >= 3) {
          const alternate = !current.alternate;
          const replacement = alternate ? await more(null, true).catch(() => null) : first;
          if (replacement?.next) recent = startRecent(replacement.next, current.overlapIds, alternate);
          else if (replacement && overlap(own(replacement), current.overlapIds)) recent = null;
        }
      }
    }

    async function walkHistory(walk: Walk | null, maxPages: number, label: string): Promise<Walk | null> {
      if (!walk) return null;
      const initial = walk.next ? null : walk.alternate ? await more(null, true).catch((error) => {
        errors.push(`${lane} ${label}: ${String(error)}`);
        return null;
      }) : first;
      const advance = (current: Walk, result: ReturnType<typeof parseHtml>): Walk | null => {
        const entries = own(result), ids = [...new Set(entries.map((f) => f.id))];
        if (ids.length && ids.length === current.previousIds.length && ids.every((id) => current.previousIds.includes(id))) {
          throw new Error("Nitter repeated the previous page");
        }
        const older = isOlder(entries) ? current.older + 1 : 0;
        return result.next && older < 2 ? { ...current, next: result.next, older, failures: 0, previousIds: ids } : null;
      };
      let progress = initial ? advance(walk, initial) : walk;
      for (let i = 0; progress?.next && i < maxPages; i++) {
        const current: Walk = progress;
        try {
          progress = advance(current, await more(current.next, current.alternate));
        } catch (error) {
          errors.push(`${lane} ${label}: ${String(error)}`);
          return current.failures >= 2 ? startWalk(!current.alternate) : { ...current, failures: current.failures + 1 };
        }
      }
      return progress;
    }

    const previousHistory = saved ? saved.history : oldPages[lane] === null ? null
      : { ...startWalk(), next: typeof oldPages[lane] === "string" ? oldPages[lane] : null };
    const history = await walkHistory(previousHistory, 3, "historical pages");
    let rescan = saved?.rescan ?? { dueAt: now + (previousHistory ? RESCAN_INTERVAL : initialRescanDelay(handle, lane)), walk: null };
    if (previousHistory && !history) rescan = { dueAt: now + RESCAN_INTERVAL, walk: null };
    if (!history && rescan.dueAt <= now) {
      // A bounded walk on the second mirror revisits already-seen pages without moving the live cursor.
      const walk = await walkHistory(rescan.walk ?? startWalk(true), 1, "historical rescan");
      rescan = walk ? { ...rescan, walk } : { dueAt: now + RESCAN_INTERVAL, walk: null };
    }
    lanes[lane] = { headIds: head.length ? [...new Set(head.map((f) => f.id))] : priorHead, recent, history, rescan };
    if (!history || history.next) pages[lane] = history?.next ?? null;
    freshPages[lane] = recent?.next ?? null;
  }));

  const due = [...waiting.values()].filter((f) => !(f.retryAt && f.retryAt > now));
  const selected = [...due.slice(0, 12), ...discovered.values(), ...due.slice(12)].slice(0, 60);
  for (const [id, f] of discovered) waiting.set(id, f);
  const results: Array<{ f: Found; result: Detail } | undefined> = [];
  let index = 0;
  const detailDeadline = Date.now() + 35_000;
  await Promise.all(Array.from({ length: 3 }, async () => {
    while (index < selected.length && Date.now() < detailDeadline) {
      const i = index++, f = selected[i]!;
      try { results[i] = { f, result: await detail(f, handle) }; }
      catch { results[i] = { f, result: { material: null, continuations: [] } }; }
    }
  }));
  const items: Candidate[] = [], activities: Activity[] = [], dates: number[] = [];
  function accept(f: Found, { tweet, article, parent }: Material) {
    const id = key(f);
    waiting.delete(id);
    unavailable.delete(id);
    if (seen.has(id)) return;
    const own = tweet.user.screen_name.toLowerCase() === handle.toLowerCase(), body = article?.text || tweet.full_text || "";
    const publishedAt = new Date(tweet.tweet_created_at).toISOString(), url = `https://x.com/${tweet.user.screen_name}/status/${tweet.id_str}`;
    if (f.repost) activities.push({ tweetId: tweet.id_str, kind: "repost", author: tweet.user.screen_name, url, publishedAt, ...(body ? { text: body } : {}) });
    if (own && Date.parse(publishedAt) >= cutoff && !seen.has(`a:${f.id}`)) {
      const item = tweetToCandidate(tweet);
      if (parent && item.xPost) item.xPost.replyContext = parent;
      if (article) { item.bodyText = article.text; item.bodyStatus = "ok"; item.raw = { ...(item.raw as Record<string, unknown>), freeXArticle: article }; }
      dates.push(Date.parse(publishedAt));
      items.push(item);
      activities.push({ tweetId: tweet.id_str, kind: "authored", author: tweet.user.screen_name, url, publishedAt });
      seen.add(`a:${f.id}`);
      waiting.delete(`a:${f.id}`);
      unavailable.delete(`a:${f.id}`);
    }
    seen.add(id);
  }
  // A thread already carries many full sibling statuses. Store those without scheduling another fetch.
  for (const entry of results) if (entry?.result.material) accept(entry.f, entry.result.material);
  for (const entry of results) for (const { f, material: sibling } of entry?.result.continuations ?? []) {
    const id = key(f);
    if (sibling && hasContent(sibling)) accept(f, sibling);
    else if (!seen.has(id) && !waiting.has(id) && !unavailable.has(id)) waiting.set(id, f);
  }
  let detailFailures = 0;
  for (const entry of results) {
    if (!entry || entry.result.material || seen.has(key(entry.f))) continue;
    const { f, result } = entry, id = key(f);
    const attempts = (f.attempts ?? 0) + 1;
    const misses = result.unavailable ? (f.missing ?? 0) + 1 : 0;
    if (result.unavailable && misses >= 3) {
      unavailable.set(id, { id: f.id, author: f.author, repost: f.repost, reason: result.unavailable });
      waiting.delete(id);
    } else {
      waiting.set(id, { ...f, attempts, missing: misses, retryAt: now + Math.min(120, 5 * 2 ** Math.min(attempts - 1, 5)) * MINUTE });
      detailFailures++;
    }
  }
  if (!successes && !results.some((entry) => entry?.result.material)) throw new Error(`Free X discovery failed: ${errors.join("; ")}`);
  const start = [Date.parse(cursor.xCoverageStart ?? ""), ...dates].filter(Number.isFinite), end = [Date.parse(cursor.xCoverageEnd ?? ""), ...dates].filter(Number.isFinite);
  const backfillComplete = Object.keys(pages).length === 2 && Object.values(pages).every((p) => p === null);
  return { items, activities, cursor: { ...cursor, freeXSeen: [...seen], freeXPending: [...waiting.values()], freeXUnavailable: [...unavailable.values()], freeXPages: pages, freeXFreshPages: freshPages, freeXLanes: lanes, backfillComplete, freeXDetailFailures: detailFailures, freeXBackfill: { pending: !backfillComplete || Object.values(freshPages).some(Boolean) || waiting.size > 0, errors }, xCoverageStart: start.length ? new Date(Math.min(...start)).toISOString() : null, xCoverageEnd: end.length ? new Date(Math.max(...end)).toISOString() : null } };
}
