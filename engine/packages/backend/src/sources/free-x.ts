import { load } from "cheerio";
import { XMLParser } from "fast-xml-parser";
import { tweetToCandidate, xArticleText, xArticleHtml } from "./x.ts";
import type { Candidate } from "./types.ts";
import type { SdTweet } from "../providers/socialdata.ts";

const MIRRORS = ["https://nitter.mie.foundation", "https://nitter.meowing.monster", "https://nitter.mizuki.st", "https://nitter.jaydenha.uk"];
type Found = { id: string; author: string; repost: boolean; pinned?: boolean };
type Activity = { tweetId: string; kind: "authored" | "repost"; author: string; url: string; publishedAt: string; text?: string };
const key = (f: Found) => `${f.repost ? "r" : "a"}:${f.id}`;
function status(url: string): { author: string; id: string } | null {
  const m = /(?:https?:\/\/[^/]+)?\/([a-z0-9_]{1,15})\/status\/(\d{1,20})/i.exec(url);
  return m ? { author: m[1]!, id: m[2]! } : null;
}
async function get(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { "user-agent": "Mozilla/5.0", accept: "text/html, application/rss+xml, application/json" } });
  if (!response.ok) throw new Error(`${new URL(url).host}: HTTP ${response.status}`);
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
async function nitter<T>(path: string, parse: (text: string) => T): Promise<T> {
  let last: unknown;
  for (const mirror of MIRRORS) try { return parse(await get(mirror + path)); } catch (e) { last = e; }
  throw last ?? new Error("Nitter unavailable");
}
type Parent = { id: string; handle: string; authorName: string; url: string; text: string; publishedAt: string | null };
async function detail(f: Found): Promise<{ tweet: SdTweet; article: ReturnType<typeof xArticleText>; thread: Found[]; parent?: Parent }> {
  let t: any, thread: Found[] = [], parent: Parent | undefined;
  try {
    const data = JSON.parse(await get(`https://api.fxtwitter.com/2/thread/${f.id}`));
    if (data.status?.id !== f.id || !Array.isArray(data.thread)) throw new Error("Invalid thread");
    t = data.status;
    const parentId = t.replying_to?.status ?? t.replying_to_status;
    const context = data.thread.find((row: any) => row.id === parentId);
    if (context && /^[a-z0-9_]{1,15}$/i.test(context.author?.screen_name ?? "") && typeof context.text === "string") {
      parent = { id: parentId, handle: context.author.screen_name, authorName: context.author.name ?? context.author.screen_name,
        url: `https://x.com/${context.author.screen_name}/status/${parentId}`, text: context.text,
        publishedAt: Number.isFinite(Date.parse(context.created_at)) ? new Date(context.created_at).toISOString() : null };
    }
    thread = data.thread.filter((v: any) => /^\d{1,20}$/.test(v?.id ?? "") && v.author?.screen_name?.toLowerCase() === f.author.toLowerCase()).map((v: any) => ({ id: v.id, author: v.author.screen_name, repost: false }));
    if (!t.text && !t.article && !t.media?.all?.length) t = null;
  } catch { /* Fall back to the individual status endpoint. */ }
  if (!t) t = JSON.parse(await get(`https://api.fxtwitter.com/${encodeURIComponent(f.author)}/status/${f.id}`)).tweet;
  if (t?.id !== f.id || t.author?.screen_name?.toLowerCase() !== f.author.toLowerCase() || !Number.isFinite(Date.parse(t.created_at))) throw new Error("Invalid FxTwitter detail");
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
  return { tweet, article, thread, parent };
}

// X snowflake ids encode original creation time. Only an unpinned own post is a paging anchor.
function isOldAnchor(f: Found, handle: string, cutoff: number): boolean {
  if (f.repost || f.pinned || f.author.toLowerCase() !== handle.toLowerCase() || f.id.length < 18) return false;
  return Number((BigInt(f.id) >> 22n) + 1288834974657n) < cutoff;
}
function lanesComplete(pages: Record<string, string | null>, errors: string[]): boolean {
  return errors.length === 0 && Object.keys(pages).length === 2 && Object.values(pages).every((p) => p === null);
}

/** Dates name original posts, including reposts; coverage is observed, not a completeness claim. */
export async function fetchFreeX(handle: string, cursor: Record<string, any>): Promise<{ items: Candidate[]; activities: Activity[]; cursor: Record<string, any> }> {
  handle = handle.replace(/^@/, "");
  if (!/^[a-z0-9_]{1,15}$/i.test(handle)) throw new Error("Invalid X handle");
  const cutoff = Date.now() - 30 * 86400_000;
  const previous = new Set<string>(Array.isArray(cursor.freeXSeen) ? cursor.freeXSeen.filter((x: unknown) => typeof x === "string") : []);
  const found = new Map<string, Found>();
  const add = (f: Found) => { if (/^\d{1,20}$/.test(f.id) && /^[a-z0-9_]{1,15}$/i.test(f.author) && !previous.has(key(f))) found.set(key(f), f); };
  const pending: Found[] = Array.isArray(cursor.freeXPending) ? cursor.freeXPending : [];
  const oldPages = cursor.freeXPages && typeof cursor.freeXPages === "object" ? cursor.freeXPages : {};
  const pages: Record<string, string | null> = {}, freshPages: Record<string, string | null> = {}, errors: string[] = [];
  const oldFresh = cursor.freeXFreshPages && typeof cursor.freeXFreshPages === "object" ? cursor.freeXFreshPages : {};
  let successes = 0;
  await Promise.all(["/rss", "/with_replies/rss"].map(async path => {
    try {
      const entries = await nitter(`/${handle}${path}`, xml => parseRss(xml, handle));
      successes++;
      entries.forEach(add);
    } catch (e) { errors.push(String(e)); }
  }));
  await Promise.all(["profile", "replies"].map(async (lane) => {
    const base = `/${handle}${lane === "replies" ? "/with_replies" : ""}`;
    let next: string | null = null, firstOk = false, hasNew = false;
    try { const first = await nitter(base, (x) => parseHtml(x, handle)); successes++; firstOk = true; hasNew = first.found.some((f) => !previous.has(key(f))); first.found.forEach(add); next = first.found.some((f) => isOldAnchor(f, handle, cutoff)) ? null : first.next; } catch (e) { errors.push(String(e)); }
    if (!firstOk && !Object.hasOwn(oldPages, lane)) return;
    let position: string | null = Object.hasOwn(oldPages, lane) ? (typeof oldPages[lane] === "string" ? oldPages[lane] : null) : next;
    for (let i = 0; position && i < 1; i++) {
      try {
        const page = await nitter(`${base}?cursor=${encodeURIComponent(position)}`, (x) => parseHtml(x, handle));
        successes++; page.found.forEach(add);
        if (page.next === position) { errors.push("Nitter cursor did not advance"); break; }
        position = page.found.some((f) => isOldAnchor(f, handle, cutoff)) ? null : page.next;
      } catch (e) { errors.push(String(e)); break; }
    }
    pages[lane] = position;
    // Continue a recent burst until a previously observed entry, independent of older backfill.
    let fresh = typeof oldFresh[lane] === "string" ? oldFresh[lane] : (previous.size && hasNew ? next : null);
    for (let i = 0; fresh && i < 1; i++) {
      try {
        const page = await nitter(`${base}?cursor=${encodeURIComponent(fresh)}`, (x) => parseHtml(x, handle));
        const reachedSeen = page.found.some((f) => previous.has(key(f)));
        page.found.forEach(add);
        if (page.next === fresh) { errors.push("Nitter fresh cursor did not advance"); break; }
        fresh = reachedSeen ? null : page.next;
      } catch (e) { errors.push(String(e)); break; }
    }
    freshPages[lane] = fresh;
  }));
  if (!successes) throw new Error(`Free X discovery failed: ${errors.join("; ")}`);
  const discovered = [...found.values()];
  found.clear();
  for (const f of pending) if (f && typeof f.id === "string" && typeof f.author === "string" && typeof f.repost === "boolean") add(f);
  const waiting = [...found.values()].filter((f) => !discovered.some((d) => key(d) === key(f)));
  const selected = [...discovered.slice(0, 40), ...waiting.slice(0, 40)];
  const retry = [...discovered.slice(40), ...waiting.slice(40)];
  const results: Array<{ f: Found; tweet: SdTweet | null; article: ReturnType<typeof xArticleText>; thread: Found[]; parent?: Parent }> = [];
  let index = 0;
  const detailDeadline = Date.now() + 30000;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (index < selected.length && Date.now() < detailDeadline) {
      const f = selected[index++]!;
      try { results.push({ f, ...(await detail(f)) }); }
      catch { results.push({ f, tweet: null, article: null, thread: [] }); }
    }
  }));
  retry.unshift(...selected.slice(index));
  const items: Candidate[] = [], activities: Activity[] = [], seen = new Set(previous), dates: number[] = [];
  for (const { f, tweet, article, thread, parent } of results) {
    if (!tweet) { retry.push(f); continue; }
    const own = tweet.user.screen_name.toLowerCase() === handle.toLowerCase(), text = article?.text || tweet.full_text || "";
    const publishedAt = new Date(tweet.tweet_created_at).toISOString(), url = `https://x.com/${tweet.user.screen_name}/status/${tweet.id_str}`;
    if (f.repost) activities.push({ tweetId: tweet.id_str, kind: "repost", author: tweet.user.screen_name, url, publishedAt, ...(text ? { text } : {}) });
    if (own && Date.parse(publishedAt) >= cutoff && (text.trim() || (tweet.extended_entities?.media?.length ?? 0) > 0) && !seen.has(`a:${f.id}`)) {
      const item = tweetToCandidate(tweet);
      if (parent && item.xPost) item.xPost.replyContext = parent;
      if (article) { item.bodyText = article.text; item.bodyStatus = "ok"; item.raw = { ...(item.raw as Record<string, unknown>), freeXArticle: article }; }
      dates.push(Date.parse(publishedAt));
      items.push(item); activities.push({ tweetId: tweet.id_str, kind: "authored", author: tweet.user.screen_name, url, publishedAt }); seen.add(`a:${f.id}`);
    }
    if (own) for (const continuation of thread) if (continuation.id !== f.id && !seen.has(key(continuation))) retry.push(continuation);
    if (!f.repost && own && Date.parse(publishedAt) >= cutoff && !text.trim() && !(tweet.extended_entities?.media?.length)) retry.push(f); else seen.add(key(f));
  }
  const outstanding = [...new Map(retry.filter(f => !seen.has(key(f))).map(f => [key(f), f])).values()];
  const start = [Date.parse(cursor.xCoverageStart ?? ""), ...dates].filter(Number.isFinite), end = [Date.parse(cursor.xCoverageEnd ?? ""), ...dates].filter(Number.isFinite);
  return { items, activities, cursor: { ...cursor, freeXSeen: [...seen], freeXPending: outstanding, freeXPages: pages, freeXFreshPages: freshPages, backfillComplete: lanesComplete(pages, errors), freeXDetailFailures: results.filter((r) => !r.tweet).length, freeXBackfill: { pending: Object.values(pages).some(Boolean) || Object.values(freshPages).some(Boolean) || outstanding.length > 0, errors }, xCoverageStart: start.length ? new Date(Math.min(...start)).toISOString() : null, xCoverageEnd: end.length ? new Date(Math.max(...end)).toISOString() : null } };
}
