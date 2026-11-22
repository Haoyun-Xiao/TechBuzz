import { data, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/report-detail";
import { REPORT_NAMES, type ReportDetail, type ReportNavigationResponse, type ReportKind } from "@techbuzz/contracts/site";
import { SITE, subjectAfter } from "@techbuzz/site";
import { apiGet, cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { pageMeta, reportDescription, reportLd, reportTitle, titled } from "../lib/seo";
import { beijingDate } from "@techbuzz/contracts/time";
import { ReportLayout } from "../features/report/ReportLayout";
import { ReportPaper, reportOutline } from "../features/report/ReportPaper";
import { feedLink, kindFromPath } from "../features/report/format";
import type { Screen } from "../components/shell/screens";

import { loadResearch, researchEnabled, researchPage } from "../features/research/load.server";
import { project, reportDate } from "../features/research/data";
import { dailyIndex, dailyPage, dailyWebSources, ResearchDaily } from "../features/research/ResearchDaily";

export const handle: Screen = { tab: "daily", name: "日报" };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

const PATTERN: Record<ReportKind, RegExp> = {
  daily: /^\d{4}-\d{2}-\d{2}$/,
  weekly: /^\d{4}-W\d{2}$/,
  monthly: /^\d{4}-\d{2}$/,
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const kind = kindFromPath(new URL(request.url).pathname);
  const key = params.key ?? "";
  if (researchEnabled()) {
    if (kind !== "daily") throw redirect("/daily", 308);
    if (/^report-\d{4}-\d{2}-\d{2}$/.test(key)) throw redirect(`/daily/${key.slice(7)}`, 308);
    if (!PATTERN.daily.test(key)) throw data({ message: "not_found" }, { status: 404 });
    const dashboard = await loadResearch(request);
    const index = dailyIndex(dashboard.reports);
    const entry = dashboard.reports.find((report) => reportDate(report) === key);
    if (!entry) throw data({ message: "not_found" }, { status: 404 });
    return researchPage({ research: { data: project(dashboard, {}), index, report: dailyPage(dashboard, index, entry), asOf: entry.asOf, coverage: entry.coverage, webSources: dailyWebSources(entry), related: [...dashboard.ideas, ...dashboard.trends].filter(item => [...(entry.ideaIds ?? []), ...(entry.trendIds ?? [])].includes(item.id)).map(item => ({id:item.id,title:item.title})) } });
  }
  if (!PATTERN[kind].test(key)) throw data({ message: "not_found" }, { status: 404 });
  const [report, { items: index }] = await Promise.all([
    loadOr404<ReportDetail>(`/api/site/reports/${kind}/${key}`, { signal: request.signal }),
    apiGet<ReportNavigationResponse>(`/api/site/reports/${kind}/navigation/${key}`, { signal: request.signal }),
  ]);
  return cachedPage(3600, { report, index, today: beijingDate(Date.now()) });
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (loaderData && "research" in loaderData) {
    const report = loaderData.research.report;
    return [...pageMeta({ title: report?.title ?? "日报", path: report ? `/daily/${report.key}` : "/daily" }), feedLink("daily")];
  }
  if (!loaderData) return [{ title: titled("报告不存在") }, { name: "robots", content: "noindex" }];
  const r = loaderData.report;
  const description = reportDescription(r) ?? `${SITE.name} ${r.key} ${subjectAfter("的", REPORT_NAMES[r.kind])}。`;
  const path = `/${r.kind}/${r.key}`;
  return [...pageMeta({
    title: reportTitle(r),
    description,
    path,
    image: `/og/reports/${r.kind}/${r.key}.png`,
    type: "article",
    jsonLd: reportLd(r, path, description),
  }), feedLink(r.kind)];
}

export default function ReportDetailPage() {
  const result = useLoaderData<typeof loader>();
  if ("research" in result) return <ResearchDaily {...result.research} />;
  const { report, index, today } = result;
  return (
    <ReportLayout kind={report.kind} index={index} current={report.key} today={today} outline={reportOutline(report)}>
      <ReportPaper report={report} index={index} />
    </ReportLayout>
  );
}
