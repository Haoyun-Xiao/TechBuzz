import { test } from "node:test";
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
    return new Response(page(item("Alice", old, '<div class="pinned"></div>') + item("Bob", old, '<div class="retweet-header"></div>') + item("Alice", recent), "next"));
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
