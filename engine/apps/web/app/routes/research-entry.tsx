import { data, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/research-entry";
import type { Screen } from "../components/shell/screens";
import { entryCards, entryEvidence, evidenceSubset, loadResearch, researchEnabled, researchPage } from "../features/research/load.server";
import { postLookup, postTitle, project, type Activity, type Dashboard, type Post } from "../features/research/data";
import { PostDetail } from "../features/research/Posts";
import { ResearchEntries, ResearchSources } from "../features/research/ResearchViews";
import { useSaved } from "../features/research/saved";
import { pageMeta } from "../lib/seo";

export const handle: Screen = { home: "all" };
export { pageHeaders as headers } from "../lib/api.server";

export async function loader({ request, params }: Route.LoaderArgs) {
  if (!researchEnabled()) throw data({ message: "not_found" }, { status: 404 });
  const url = new URL(request.url);
  const section = url.pathname.split("/")[1];
  const dashboard = await loadResearch(request);
  if (section === "sources") return researchPage({ section: "sources" as const, dashboard: project(dashboard, { sources: dashboard.sources }), path: "/sources" });
  if (section === "research") {
    const post = params.id ? postLookup(dashboard).get(params.id) : undefined;
    if (!post) throw data({ message: "not_found" }, { status: 404 });
    const activities = dashboard.activities.filter((row) => row.postId === post.id).map((row) => ({ ...row, post }));
    const root = dashboard.scores[post.id]?.scoredAs ?? post.id;
    const threadIds = [root, ...Object.keys(dashboard.scores).filter(id => dashboard.scores[id].scoredAs === root)];
    const activityId = url.searchParams.get("activity");
    const activity = activityId ? activities.find((row) => row.id === activityId) : activities.find((row) => row.kind !== "repost");
    return researchPage({ section: "research" as const, post, activity, path: url.pathname, dashboard: project(dashboard, {
      ...evidenceSubset(dashboard, threadIds), activities,
      featured: dashboard.featured.filter((row) => row.postId === post.id).map((row) => ({ ...row, post })),
    }) });
  }
  const type = section === "trends" ? "trends" : "ideas";
  const entry = params.id ? [...dashboard[type], ...(type === "trends" ? dashboard.archivedTrends ?? [] : [])].find((item) => item.id === params.id) : undefined;
  if (entry?.mergedInto) throw redirect("/trends/" + encodeURIComponent(entry.mergedInto), 302);
  if (params.id && !entry) throw data({ message: "not_found" }, { status: 404 });
  const related = new Set(entry?.relatedIds);
  return researchPage({ section: type as "ideas" | "trends", entry, path: url.pathname, dashboard: project(dashboard, {
    ...(entry ? evidenceSubset(dashboard, entryEvidence(entry)) : {}),
    ideas: entryCards(entry ? dashboard.ideas.filter((item) => related.has(item.id)) : type === "ideas" ? dashboard.ideas : []),
    trends: entryCards(entry ? dashboard.trends.filter((item) => related.has(item.id)) : type === "trends" ? dashboard.trends : []),
  }) });
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const title = loaderData.section === "research"
    ? postTitle(loaderData.post, loaderData.dashboard.scores[loaderData.post.id])
    : "entry" in loaderData && loaderData.entry ? loaderData.entry.title
      : loaderData.section === "sources" ? "关注来源" : loaderData.section === "trends" ? "趋势跟踪" : "Idea";
  return pageMeta({ title, path: loaderData.path });
}

function ResearchPost({ post, activity, dashboard }: { post: Post; activity?: Activity; dashboard: Dashboard }) {
  const saved = useSaved(dashboard);
  return <PostDetail post={post} activity={activity} data={dashboard} saved={saved} />;
}

export default function ResearchEntryRoute() {
  const result = useLoaderData<typeof loader>();
  if (result.section === "research") return <ResearchPost {...result} />;
  if (result.section === "sources") return <ResearchSources data={result.dashboard} />;
  return <ResearchEntries type={result.section === "trends" ? "trends" : "ideas"} data={result.dashboard} item={result.entry} />;
}
