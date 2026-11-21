// Production SSR with a local health stub. Failure case: machine entry points for weekly and monthly
// reports exist but cannot be found from the access page.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import * as cheerio from 'cheerio';
import { MCP_TOOL_NAMES } from '@techbuzz/contracts/mcp';
import { fakeApi, startWebServer, type WebServer } from './web-server.ts';

let web: WebServer;
const api = fakeApi((url) => (url.pathname === '/api/health' ? { ok: true } : undefined));
before(async () => { web = await startWebServer(api); });
after(() => web.stop());

for (const [tab, names] of [
  ['rss', ['/feed/daily.xml', '/feed/weekly.xml', '/feed/monthly.xml']],
  ['api', ['/api/v1/dailies/latest', '/api/v1/weeklies/latest', '/api/v1/monthlies/latest']],
  ['mcp', [MCP_TOOL_NAMES.daily, MCP_TOOL_NAMES.weekly, MCP_TOOL_NAMES.monthly]],
] as const) {
  test(`the ${tab} panel exposes all report entry points`, async () => {
    const response = await fetch(`${web.origin}/agent?tab=${tab}`);
    assert.equal(response.status, 200, web.logs());
    const panel = cheerio.load(await response.text())('#agent-panel').text();
    for (const name of names) assert.ok(panel.includes(name), `${tab} panel omits ${name}`);
  });
}

test("research pages preserve the scored selection, frozen activity pages and single dated report", async () => {
  const before = "2026-11-20T08:00:00.000Z";
  const after = "2026-11-21T08:00:00.000Z";
  let refreshed = false;
  const make = (id: string, score: number | null, at: string | null, firstSeenAt = before) => {
    const kind = at ? "original" : "repost";
    const post = { id, nativeArticleId: `native-${id}`, handle: "Author", text: `原文 ${id}`, textZh: `译文 ${id}`, url: `https://x.com/Author/status/${id}`, publishedAt: before };
    return { id: `activity-${id}`, postId: id, handle: kind === "repost" ? "Curve" : "Author", originalAuthor: post.handle,
      kind, url: post.url, activityAt: at, timeBasis: at ? "published" : "unknown", firstSeenAt, score, featured: score !== null, post,
      distributors: kind === "repost" ? ["Curve"] : [], category: id === "ordinary-0" ? "行业" : "观点" };
  };
  const unknown = make("old-repost", 94, null);
  const base = [unknown, ...Array.from({ length: 31 }, (_, i) => make(`ordinary-${i}`, i === 0 ? 77 : null, new Date(Date.parse(before) - i * 60_000).toISOString()))];
  const late = make("arrived-late", 98, before, after);
  const reports = [{ id: "report-2026-11-20", date: "2026-11-20", title: "研究日报样例", summary: "日报导语", sections: [{ title: "板块判断", summary: "研究摘要", evidence: [] }], evidence: [unknown.postId] }];
  const researchApi = fakeApi((url) => {
    if (url.pathname !== "/api/site/research") return undefined;
    const activities = refreshed ? [late, ...base] : base;
    return { activities, featured: activities.filter((item) => item.featured), posts: activities.map((item) => item.post), ideas: [], trends: [], reports,
      scores: Object.fromEntries(activities.filter((item) => item.featured).map((item) => [item.postId, { score: item.score }])),
      hot: [], singleHot: [], topics: [], sources: [{ handle: "Author" }, { handle: "Curve" }], threshold: 70,
      generation: { ideas: { status: "completed" }, trends: { status: "running" }, report: { status: "completed" } }, generatedAt: refreshed ? after : before };
  });
  const live = await startWebServer(researchApi, { TECHBUZZ_RESEARCH_URL: "http://127.0.0.1:1" });
  try {
    const home = await fetch(live.origin);
    assert.equal(home.status, 200, live.logs());
    let $ = cheerio.load(await home.text());
    assert.deepEqual($("main article").map((_, article) => $(article).attr("data-item-id")).get(), ["old-repost", "ordinary-0"]);
    assert.equal($("main h2").filter((_, el) => $(el).text() === "转发时间未知").length, 0);

    const all = await fetch(`${live.origin}/all`);
    assert.equal(all.status, 200, live.logs());
    $ = cheerio.load(await all.text());
    assert.match($("main").text(), /转发时间未知/);
    assert.doesNotMatch($("main").text(), /译文 ordinary-30/);
    const next = $("main a").filter((_, link) => $(link).text().trim() === "下一页").first().attr("href");
    assert.ok(next);
    assert.equal(new URL(next, live.origin).searchParams.get("asOf"), before);
    refreshed = true;
    const second = await fetch(new URL(next, live.origin));
    assert.equal(second.status, 200, live.logs());
    $ = cheerio.load(await second.text());
    assert.deepEqual($("main article").map((_, article) => $(article).attr("data-item-id")).get(), ["ordinary-30", "old-repost"]);

    const daily = await fetch(`${live.origin}/daily/report-2026-11-20`);
    assert.equal(new URL(daily.url).pathname, "/daily/2026-11-20");
    $ = cheerio.load(await daily.text());
    const paper = $("main");
    assert.match(paper.text(), /研究日报样例/);
    assert.match(paper.text(), /研究摘要/);
    assert.doesNotMatch(paper.text(), /周报|月报/);
    assert.equal(paper.find('a[href="/research/posts/old-repost"]').length >= 1, true);

    const lookup = await fetch(`${live.origin}/starred/lookup`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(["post/native-old-repost", "reports/2026-11-20", "post/missing"]),
    });
    assert.equal(lookup.status, 200, live.logs());
    const result = await lookup.json() as { posts: Array<{ id: string }>; reports: Array<{ date: string }> };
    assert.deepEqual(result.posts.map((post) => post.id), ["old-repost"]);
    assert.deepEqual(result.reports.map((report) => report.date), ["2026-11-20"]);
  } finally {
    await live.stop();
  }
});
