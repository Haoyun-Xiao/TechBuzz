import { Link } from "react-router";
import type { ReportCitation, ReportDetail, ReportNavigationEntry } from "@techbuzz/contracts/site";
import { beijingDate } from "@techbuzz/contracts/time";
import { EmptyState } from "../../components/ui/Page";
import { ReportLayout } from "../report/ReportLayout";
import { ReportPaper, reportOutline } from "../report/ReportPaper";
import { postLookup, postPath, postTitle, reportDate, safeURL, stamp, type Dashboard, type Generation, type ResearchEntry } from "./data";
import { Heading, SaveButton } from "./Posts";
import { GenerationStatus } from "./ResearchViews";
import { useSaved } from "./saved";

export function dailyIndex(reports: ResearchEntry[]): ReportNavigationEntry[] {
  const ordered = [...reports].sort((a, b) => reportDate(b).localeCompare(reportDate(a)));
  return ordered.map((entry, index) => ({
    key: reportDate(entry), issueNumber: ordered.length - index, title: entry.title, count: entry.evidence?.length ?? 0,
  }));
}

export function dailyPage(data: Dashboard, index: ReportNavigationEntry[], entry: ResearchEntry): ReportDetail {
  const key = reportDate(entry);
  const at = index.findIndex((issue) => issue.key === key);
  const posts = postLookup(data);
  const citation = (id: string): ReportCitation => {
    const post = posts.get(id);
    return {
      itemId: post?.id ?? id,
      title: post ? postTitle(post, data.scores[post.id]) : `证据 ${id}`,
      summary: post ? data.scores[post.id]?.summary || post.textZh || post.text || post.excerpt || null : null,
      sourceName: post ? `@${post.handle}` : "来源未收录",
      sourceUrl: safeURL(post?.url) ?? postPath(post?.id ?? id),
      sourceIconUrl: null,
      firstParty: false,
      publishedAt: post?.publishedAt ?? null,
      available: Boolean(post),
    };
  };
  const sections = (entry.sections ?? []).map((section) => ({
    label: section.title, summary: section.summary ?? null, items: (section.evidence ?? []).map(citation),
  }));
  const referenced = new Set((entry.sections ?? []).flatMap((section) => section.evidence ?? []));
  const remaining = (entry.evidence ?? []).filter((id) => !referenced.has(id));
  if (remaining.length) sections.push({ label: "关联证据", summary: null, items: remaining.map(citation) });
  return {
    kind: "daily",
    key,
    issueNumber: index[at]?.issueNumber ?? 1,
    title: entry.title,
    generatedAt: entry.generatedAt || entry.updatedAt || "",
    lead: { title: entry.title, leadParagraph: entry.summary ?? "" },
    leadItemId: null,
    overview: entry.summary ?? null,
    highlights: (entry.evidence ?? []).slice(0, 3).map(citation),
    sections,
    flashes: [],
    cover: null,
    metrics: { reportsCovered: entry.evidence?.length ?? 0 },
    readingMinutes: Math.max(1, Math.ceil(((entry.summary?.length ?? 0) + sections.reduce((sum, section) => sum + (section.summary?.length ?? 0) + section.items.reduce((total, item) => total + (item.summary?.length ?? 0), 0), 0)) / 450)),
    prev: index[at + 1]?.key ?? null,
    next: index[at - 1]?.key ?? null,
    mentions: [],
  };
}

export function ResearchDaily({ data, index, report, asOf }: { data: Dashboard; index: ReportNavigationEntry[]; report: ReportDetail | null; asOf?: string }) {
  const saved = useSaved(data);
  return <ReportLayout kind="daily" index={index} current={report?.key ?? null} today={beijingDate(data.generatedAt)} dailyOnly outline={report ? reportOutline(report, true) : []}>
    <GenerationStatus generation={data.generation.report} />
    {report ? <>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 text-[13px] text-ink-4">
        {asOf && <span>本期证据截至 {stamp(asOf)}</span>}
        <span>本期生成 {stamp(report.generatedAt)}</span>
        <span className="ml-auto"><SaveButton entry={`reports/${report.key}`} data={data} saved={saved} /></span>
      </div>
      <ReportPaper report={report} index={index} itemPath={postPath} keepSummary />
    </> : <EmptyState title="还没有发布日报" />}
  </ReportLayout>;
}

export function ResearchDailyArchive({ index, generation }: { index: ReportNavigationEntry[]; generation?: Generation }) {
  return <div className="mx-auto max-w-[var(--page-max-reading)] pb-8">
    <Heading title="日报合订本" back={{ to: "/daily", label: "日报" }} />
    <GenerationStatus generation={generation} />
    {index.length ? <ul className="card divide-y divide-line-soft px-4">
      {index.map((issue) => <li key={issue.key}>
        <Link to={`/daily/${issue.key}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-3 text-[14px] font-medium text-ink hover:text-accent">
          <time dateTime={issue.key} className="num text-[12px] font-normal text-ink-4">{issue.key}</time>
          <span>{issue.title || "日报"}</span>
        </Link>
      </li>)}
    </ul> : <EmptyState title="还没有发布日报" />}
  </div>;
}
