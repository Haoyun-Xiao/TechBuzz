import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { fetchFreeX } from "../packages/backend/src/sources/free-x.ts";

test("free X keeps reposts separate, continues pages, expands threads and retains failures", async () => {
  const original = globalThis.fetch;
  const page = (body: string, next = "") => `<div class="timeline">${body}${next ? `<div class="show-more"><a href="?cursor=${next}">more</a></div>` : ""}</div>`;
  const item = (author: string, id: string, repost = false) => `<div class="timeline-item">${repost ? '<div class="retweet-header">reposted</div>' : ""}<a class="tweet-link" href="/${author}/status/${id}"></a></div>`;
  globalThis.fetch = (async (input: any) => {
    const url = new URL(String(input));
    if (url.hostname === "api.fxtwitter.com" && url.pathname.startsWith("/2/thread/")) {
      const id = url.pathname.split("/").at(-1)!;
      if (id === "4") return new Response("error", { status: 500 });
      const author = id === "2" ? "Bob" : "Alice";
      return Response.json({ status: { id, author: { screen_name: author }, text: `text ${id}`, created_at: id === "2" ? "2020-01-01T00:00:00Z" : new Date(Date.now() - 86_400_000).toISOString(), ...(id === "1" ? { replying_to: { screen_name: "Parent", status: "9" }, article: { title: "Article", content: { blocks: [{ type: "unstyled", text: "long body" }] } } } : {}) }, thread: id === "1" ? [{ id: "9", author: {screen_name: "Parent"}, text: "parent context" }, { id: "3", author: { screen_name: "Alice" } }] : [] });
    }
    if (url.hostname === "api.fxtwitter.com") {
      const [, author, , id] = url.pathname.split("/");
      if (id === "4") return new Response("error", { status: 500 });
      return Response.json({ tweet: { id, author: { screen_name: author, name: author }, text: `text ${id}`, created_at: id === "2" ? "2020-01-01T00:00:00Z" : new Date(Date.now() - 86_400_000).toISOString(), ...(id === "1" ? { replying_to: { screen_name: "Parent", status: "9" }, article: { title: "Article", content: { blocks: [{ type: "unstyled", text: "long body" }] } } } : {}) } });
    }
    if (url.pathname.endsWith("/rss")) return new Response("<rss><channel></channel></rss>");
    if (url.pathname.includes("/status/")) return new Response(page(item("Alice", "1") + item("Alice", "3")));
    if (url.search) return new Response(page(item("Alice", "4")));
    return new Response(page(item("Alice", "1") + item("Bob", "2", true) + item("Alice", "5", true), "next"));
  }) as typeof fetch;
  try {
    const first = await fetchFreeX("Alice", {});
    assert.deepEqual(first.items.map((x) => x.identityKey), ["x:1", "x:5"]);
    assert.equal(first.items[0]!.xPost?.replyContext?.text, "parent context");
    assert.equal(first.items[0]!.xPost?.replyTo, "9");
    assert.equal(first.items[0]!.bodyText, "long body");
    assert.equal((first.items[0]!.raw as any).freeXArticle.title, "Article");
    assert.deepEqual(first.activities.map((x) => x.kind), ["authored", "repost", "repost", "authored"]);
    assert.equal(first.activities[1]!.publishedAt, "2020-01-01T00:00:00.000Z");
    assert.equal(first.activities[1]!.text, "text 2");
    assert.equal(first.cursor.backfillComplete, true);
    assert.ok(first.cursor.freeXPending.some((x: any) => x.id === "3"));
    assert.ok(first.cursor.freeXPending.some((x: any) => x.id === "4"));
    const second = await fetchFreeX("Alice", first.cursor);
    assert.deepEqual(second.items.map((x) => x.identityKey), ["x:3"]);
    assert.ok(second.cursor.freeXPending.some((x: any) => x.id === "4"));
  } finally { globalThis.fetch = original; }
});

test("discovery outage throws instead of returning empty", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
  try { await assert.rejects(fetchFreeX("Alice", {}), /discovery failed/); } finally { globalThis.fetch = original; }
});

test("30-day boundary ignores pinned and repost anchors and falls back from challenge pages", async () => {
  const original = globalThis.fetch;
  const snowflake = (date: string) => String((BigInt(Date.parse(date)) - 1288834974657n) << 22n);
  const old = snowflake("2020-01-01T00:00:00Z"), recent = snowflake(new Date().toISOString());
  const item = (author: string, id: string, marker = "") => `<div class="timeline-item">${marker}<a class="tweet-link" href="/${author}/status/${id}"></a></div>`;
  const page = (s: string, more = "") => `<div class="timeline">${s}${more ? `<div class="show-more"><a href="?cursor=${more}">more</a></div>` : ""}</div>`;
  let continued = 0, fallback = 0;
  globalThis.fetch = (async (input: any) => {
    const u = new URL(String(input));
    if (u.hostname === "nitter.mie.foundation") return new Response("challenge");
    if (u.hostname === "api.fxtwitter.com" && u.pathname.startsWith("/2/thread/")) return Response.json({ status: {}, thread: [] });
    if (u.hostname === "api.fxtwitter.com") {
      const id = u.pathname.split("/").at(-1)!; const author = u.pathname.split("/")[1]!;
      return Response.json({ tweet: { id, author: { screen_name: author }, text: "", created_at: id === old ? "2020-01-01T00:00:00Z" : new Date().toISOString(), media: { all: [{ type: "photo", url: "https://pbs.twimg.com/a.jpg" }] } } });
    }
    fallback++;
    if (u.pathname.endsWith("/rss")) return new Response("<rss><channel></channel></rss>");
    if (u.search) { continued++; return new Response(page(item("Alice", old))); }
    return new Response(page(item("Alice", old, '<div class="pinned"></div>') + item("Bob", old, '<div class="retweet-header"></div>') + item("Alice", old) + item("Alice", recent), "next"));
  }) as typeof fetch;
  try {
    const r = await fetchFreeX("Alice", {});
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0]!.identityKey, `x:${recent}`);
    assert.equal(r.activities.filter((a) => a.kind === "repost").length, 1);
    assert.equal(r.cursor.backfillComplete, true);
    assert.equal(continued, 2);
    assert.ok(fallback > 0);
  } finally { globalThis.fetch = original; }
});

test("free detail retries preserve their schedule and use complete thread statuses directly", async (t) => {
  const created_at = new Date().toISOString();
  const tweet = (id: string, text: string) => ({ id, text, created_at, replies: 0, author: { screen_name: "Alice" } });
  const lookedUp: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input), id = url.pathname.split("/").at(-1)!;
    if (url.hostname === "api.fxtwitter.com") {
      if (url.pathname.startsWith("/2/thread/")) return Response.json({ status: tweet(id, "parent"), thread: [tweet("11", "public sibling")] });
      lookedUp.push(id);
      return Response.json({ tweet: { ...tweet(id, "parent"), replies: 1 } });
    }
    if (url.pathname.endsWith("/rss")) return new Response("unavailable", { status: 503 });
    return new Response('<div class="timeline"></div>');
  });
  const result = await fetchFreeX("Alice", { freeXPending: [
    { id: "10", author: "Alice", repost: false }, { id: "12", author: "Alice", repost: false, retryAt: Date.now() + 60_000 },
  ] });
  assert.deepEqual(lookedUp, ["10"]);
  assert.deepEqual(result.items.map((x) => x.identityKey), ["x:10", "x:11"]);
  assert.deepEqual(result.cursor.freeXPending.map((x: any) => x.id), ["12"]);
  assert.deepEqual(result.cursor.freeXBackfill.errors, []);
});

test("repeated missing statuses are counted separately from deferred or transient reads", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/status/20") || url.pathname.endsWith("/thread/20")) return new Response("missing", { status: 404 });
    if (url.hostname === "api.fxtwitter.com") return new Response("unavailable", { status: 503 });
    if (url.pathname.endsWith("/rss")) return new Response("<rss><channel></channel></rss>");
    return new Response('<div class="timeline"></div>');
  });
  const result = await fetchFreeX("Alice", { freeXPending: [
    { id: "20", author: "Alice", repost: false, attempts: 2, missing: 2 },
    { id: "21", author: "Alice", repost: false, attempts: 2, missing: 2 },
  ] });
  assert.deepEqual(result.cursor.freeXUnavailable, [{ id: "20", author: "Alice", repost: false, reason: "not_found" }]);
  assert.equal(result.cursor.freeXPending[0]?.id, "21");
  assert.equal(result.cursor.freeXPending[0]?.missing, 0);
  assert.equal(result.cursor.freeXDetailFailures, 1);
});

const page = (ids: string[], next?: string) => new Response(`<div class="timeline">${ids.map((id) => `<div class="timeline-item"><a class="tweet-link" href="/Alice/status/${id}"></a></div>`).join("")}${next ? `<div class="show-more"><a href="?cursor=${next}">more</a></div>` : ""}</div>`);
const snowflake = (when: number) => String((BigInt(when) - 1288834974657n) << 22n);
const completed = { profile: null, replies: null };
const itemIds = (result: Awaited<ReturnType<typeof fetchFreeX>>) => result.items.map((item) => item.xPost!.tweetId);

function mockTimeline(t: TestContext, timeline: (url: URL) => Response) {
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input), id = url.pathname.split("/").at(-1)!;
    if (url.hostname === "api.fxtwitter.com") {
      const timestamp = id.length >= 18 ? Number((BigInt(id) >> 22n) + 1288834974657n) : Date.now();
      return Response.json({ tweet: { id, text: `post ${id}`, replies: 0, created_at: new Date(timestamp).toISOString(), author: { screen_name: "Alice" } } });
    }
    if (url.pathname.endsWith("/rss")) return new Response("<rss><channel></channel></rss>");
    return timeline(url);
  });
}

test("an old page followed by new posts does not stop history, and consecutive boundary pages survive a restart", async (t) => {
  const day = 86_400_000;
  const fresh = snowflake(Date.now() - day), missed = snowflake(Date.now() - 4 * day);
  const old = [31, 32, 33].map((days) => snowflake(Date.now() - days * day));
  const checked: string[] = [];
  mockTimeline(t, (url) => {
    const cursor = url.searchParams.get("cursor");
    if (cursor) checked.push(cursor);
    switch (cursor) {
      case null: return page([fresh], "out-of-order");
      case "out-of-order": return page([old[0]!], "gap");
      case "gap": return page([missed], "older");
      case "older": return page([old[1]!], "boundary");
      case "boundary": return page([old[2]!], "past-boundary");
      default: throw new Error(`Unexpected cursor ${cursor}`);
    }
  });
  const a = await fetchFreeX("Alice", {});
  assert.deepEqual(itemIds(a), [fresh, missed]);
  assert.deepEqual(a.cursor.freeXPages, { profile: "boundary", replies: "boundary" });
  const b = await fetchFreeX("Alice", JSON.parse(JSON.stringify(a.cursor)));
  assert.deepEqual(itemIds(b), []);
  assert.equal(b.cursor.backfillComplete, true);
  assert.equal(checked.filter((cursor) => cursor === "boundary").length, 2);
  assert.ok(!checked.includes("past-boundary"));
});

test("completed legacy cursors get a bounded alternate-mirror rescan, without delaying or duplicating new posts", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-21T00:00:00Z") });
  let live = ["101", "100"];
  const alternateReads: Array<string | null> = [];
  mockTimeline(t, (url) => {
    if (url.hostname !== "xitter.cf") return page(live, "live");
    const cursor = url.searchParams.get("cursor");
    alternateReads.push(cursor);
    if (!cursor) return page(["101", "100"], "cached-gap");
    if (cursor === "cached-gap") return page(["99", "98"], "verified-tail");
    return page(["97"]);
  });
  const old = { freeXSeen: ["a:101", "a:100", "a:99", "a:97"], freeXPages: completed, backfillComplete: true };
  const migrated = await fetchFreeX("Alice", old);
  assert.equal(migrated.cursor.backfillComplete, true);
  assert.equal(alternateReads.length, 0);
  t.mock.timers.tick(5 * 60_000);
  live = ["102", "101", "100"];
  const incremental = await fetchFreeX("Alice", migrated.cursor);
  assert.deepEqual(itemIds(incremental), ["102"]);
  assert.equal(alternateReads.length, 0);
  t.mock.timers.tick(6 * 60 * 60_000);
  live = ["103", "102", "101"];
  const repaired = await fetchFreeX("Alice", incremental.cursor);
  assert.deepEqual(itemIds(repaired), ["103", "98"]);
  assert.equal(repaired.cursor.backfillComplete, true);
  assert.equal(alternateReads.filter((cursor) => cursor === "cached-gap").length, 2);
  assert.ok(!alternateReads.includes("verified-tail"));
  t.mock.timers.tick(5 * 60_000);
  const continued = await fetchFreeX("Alice", repaired.cursor);
  assert.deepEqual(itemIds(continued), []);
  assert.equal(alternateReads.filter((cursor) => cursor === "verified-tail").length, 2);
  t.mock.timers.tick(5 * 60_000);
  await fetchFreeX("Alice", continued.cursor);
  assert.equal(alternateReads.length, 6);
});

test("a stale historical cursor switches mirror and recovers without blocking incremental reads", async (t) => {
  let live = ["101", "100"];
  mockTimeline(t, (url) => {
    const cursor = url.searchParams.get("cursor");
    if (cursor === "obsolete") return new Response("cursor no longer usable", { status: 404 });
    if (cursor === "new-history") return page(["99", "98"]);
    return url.hostname === "xitter.cf" ? page(["101", "100"], "new-history") : page(live);
  });
  let cursor = { freeXSeen: ["a:101", "a:100", "a:99"], freeXPages: { profile: "obsolete", replies: "obsolete" } };
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt === 2) live = ["102", "101", "100"];
    const failed = await fetchFreeX("Alice", cursor);
    assert.deepEqual(itemIds(failed), attempt === 2 ? ["102"] : []);
    assert.equal(failed.cursor.backfillComplete, false);
    assert.equal(failed.cursor.freeXBackfill.errors.length, 2);
    cursor = failed.cursor as typeof cursor;
  }
  const recovered = await fetchFreeX("Alice", cursor);
  assert.deepEqual(itemIds(recovered), ["98"]);
  assert.equal(recovered.cursor.backfillComplete, true);
  assert.deepEqual(recovered.cursor.freeXBackfill.errors, []);
});

test("recent pagination passes arbitrary known IDs until it overlaps the previous live head", async (t) => {
  let burst = false;
  mockTimeline(t, (url) => {
    if (!burst) return page(["110", "109"], "ordinary");
    switch (url.searchParams.get("cursor")) {
      case "burst": return page(["112", "100"], "prior-head");
      case "prior-head": return page(["111", "110", "109"], "unneeded");
      default: return page(["114", "113", "100"], "burst");
    }
  });
  const initial = await fetchFreeX("Alice", { freeXSeen: ["a:110", "a:109", "a:100"], freeXPages: completed });
  burst = true;
  const first = await fetchFreeX("Alice", initial.cursor);
  assert.deepEqual(itemIds(first), ["114", "113", "112"]);
  assert.equal(first.cursor.freeXFreshPages.profile, "prior-head");
  const next = await fetchFreeX("Alice", first.cursor);
  assert.deepEqual(itemIds(next), ["111"]);
  assert.deepEqual(next.cursor.freeXFreshPages, completed);
});

test("unreadable own statuses become dated activities and existing terminal discoveries are seeded just once", async t => {
  const now = Date.now();
  const own = snowflake(now - 86_400_000), prior = snowflake(now - 2 * 86_400_000);
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.hostname === "api.fxtwitter.com" || url.pathname.includes("/status/")) return new Response("unavailable",{status:503});
    if (url.pathname.endsWith("/rss")) return new Response("<rss><channel></channel></rss>");
    return page([own]);
  });
  const first = await fetchFreeX("Alice", {freeXUnavailable:[{id:prior,author:"Alice",repost:false,reason:"not_found"}]});
  assert.equal(first.items.length,0);
  assert.deepEqual(first.activities.map(a=>[a.tweetId,a.kind,a.publishedAt,a.text]), [
    [own,"authored",new Date(now - 86_400_000).toISOString(),undefined],
    [prior,"authored",new Date(now - 2 * 86_400_000).toISOString(),undefined],
  ]);
  const second = await fetchFreeX("Alice",first.cursor);
  assert.equal(second.activities.length,0);
});
