import { data } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { entryCards, evidenceSubset, loadResearch, researchEnabled } from "../features/research/load.server";
import { reportDate, type Dashboard } from "../features/research/data";

export type SavedLookup = Pick<Dashboard, "posts" | "scores" | "ideas" | "trends" | "reports">;

export async function action({ request }: ActionFunctionArgs) {
  if (!researchEnabled()) return data(null, { status: 404 });
  const value: unknown = await request.json().catch(() => null);
  if (!Array.isArray(value) || value.length > 100 || value.some((entry) => typeof entry !== "string" || entry.length > 300)) {
    return data(null, { status: 400 });
  }
  const dashboard = await loadResearch(request);
  const keys = new Set<string>(value);
  const { posts, scores } = evidenceSubset(dashboard, value.filter((key) => key.startsWith("post/")).map((key) => key.slice(5)));
  return Response.json({
    posts: posts.map((post) => ({
      id: post.id, url: post.url, handle: post.handle, nativeArticleId: post.nativeArticleId, aliases:post.aliases, authorName: post.authorName,
      publishedAt: post.publishedAt, kind: post.kind, text: post.text?.slice(0, 500), textZh: post.textZh?.slice(0, 500),
      excerpt: post.excerpt?.slice(0, 500),
    })),
    scores,
    ideas: entryCards(dashboard.ideas.filter((entry) => keys.has(`ideas/${entry.id}`))),
    trends: entryCards(dashboard.trends.filter((entry) => keys.has(`trends/${entry.id}`))),
    reports: entryCards(dashboard.reports.filter((entry) => keys.has(`reports/${reportDate(entry)}`))),
  } satisfies SavedLookup, { headers: { "Cache-Control": "no-store" } });
}
