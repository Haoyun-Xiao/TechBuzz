import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/report-latest";
import { REPORT_NAMES, reportDateLabel, type ReportLatestPage } from "@techbuzz/contracts/site";
import { REPORTS, SEO_TITLES, subjectAfter, withSubject } from "@techbuzz/site";
import { cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { pageMeta, reportDescription, reportLd } from "../lib/seo";
import { beijingDate } from "@techbuzz/contracts/time";
import { EmptyState } from "../components/ui/Page";
import { ReportLayout } from "../features/report/ReportLayout";
import { ReportPaper, reportOutline } from "../features/report/ReportPaper";
import { KIND_PATH, feedLink, kindFromPath } from "../features/report/format";
import type { Screen } from "../components/shell/screens";

import { loadResearch, researchEnabled, researchPage } from "../features/research/load.server";
import { project, reportDate } from "../features/research/data";
import { dailyIndex, dailyPage, dailyWebSources, ResearchDaily } from "../features/research/ResearchDaily";

export const handle: Screen = { tab: "daily", name: "日报" };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const kind = kindFromPath(url.pathname);
  if (researchEnabled()) {
    if (kind !== "daily") throw redirect("/daily", 308);
    const date = url.searchParams.get("date");
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) throw redirect(`/daily/${date}`, 308);
    const dashboard = await loadResearch(request);
    const index = dailyIndex(dashboard.reports);
    const entry = dashboard.reports.find((report) => reportDate(report) === index[0]?.key);
    return researchPage({ research: { data: project(dashboard, {}), index, report: entry ? dailyPage(dashboard, index, entry) : null, asOf: entry?.asOf, coverage: entry?.coverage, webSources: dailyWebSources(entry), related: [...dashboard.ideas, ...dashboard.trends].filter(item => [...(entry?.ideaIds ?? []), ...(entry?.trendIds ?? [])].includes(item.id)).map(item => ({id:item.id,title:item.title})) } });
  }
  const { index, report } = await loadOr404<ReportLatestPage>(`/api/site/reports/${kind}/latest-page`, { signal: request.signal });
  return cachedPage(600, { kind, report, index, today: beijingDate(Date.now()) });
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (loaderData && "research" in loaderData) {
    const report = loaderData.research.report;
    return [...pageMeta({ title: report?.title ?? "日报", path: report ? `/daily/${report.key}` : "/daily" }), feedLink("daily")];
  }
  const kind = loaderData?.kind ?? "daily";
  const report = loaderData?.report;
  // What this issue says, so a search result shows today's date and news rather than what the page is.
  const description = (report && reportDescription(report)) ?? `${REPORTS.descriptions[kind]}。`;
  // One address however it was written (/daily/, a different case): the router matches them all.
  const path = KIND_PATH[kind];
  return [...pageMeta({
    title: report ? SEO_TITLES.latestReport(kind, reportDateLabel(kind, report.key)) : withSubject(REPORT_NAMES[kind]),
    description,
    path,
    image: `/og/pages/${kind}.png`,
    // The latest issue, described at this page's own address (its canonical).
    jsonLd: report ? reportLd(report, path, description) : undefined,
  }), feedLink(kind)];
}

export default function ReportLatestPage() {
  const result = useLoaderData<typeof loader>();
  if ("research" in result) return <ResearchDaily {...result.research} />;
  const { kind, report, index, today } = result;
  return (
    <ReportLayout kind={kind} index={index} current={report?.key ?? null} today={today} outline={report ? reportOutline(report) : []}>
      {report ? <ReportPaper report={report} index={index} /> : <EmptyState title={subjectAfter("还没有发布", REPORT_NAMES[kind])}>第一期发布后会出现在这里。</EmptyState>}
    </ReportLayout>
  );
}
