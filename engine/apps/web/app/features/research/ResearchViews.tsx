import { Link, useSearchParams } from "react-router";
import type { ReactNode } from "react";
import { Badge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/Page";
import { PillTabs } from "../../components/ui/Tabs";
import { IconChevronRight } from "../../components/icons";
import { Evidence, External, Heading, SaveButton, WebSources } from "./Posts";
import { postLookup, reportPath, stamp, topicPath, type Dashboard, type Generation, type HotEntry, type ResearchEntry, type Topic } from "./data";
import { useSaved } from "./saved";

const statuses: Record<string, string> = {
  unconfigured: "待配置", backfilling: "回补中", "catching-up": "补读中",
  empty: "已查无新增", ok: "已生成", completed: "已生成", complete: "已生成", done: "已生成", success: "已生成",
  error: "生成失败", failed: "生成失败", partial: "部分完成", unavailable: "不可用", awaiting: "待运行",
  ready: "已生成", running: "生成中", pending: "待运行", queued: "排队中", skipped: "已跳过",
  published: "已发布", scheduled: "等待定时生成", insufficient: "证据不足", stale: "显示上次成功结果", disabled: "未启用", idle: "等待运行",
};

export function GenerationStatus({ generation }: { generation?: Generation }) {
  if (!generation) return null;
  return <div className="mb-4 rounded-tile border border-line bg-surface px-4 py-3 text-[13px] text-ink-3">
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <Badge tone={generation.error ? "hot" : "accent"}>{statuses[generation.status] ?? generation.status}</Badge>
      {generation.targetedCount && <span>30 天全窗任务</span>}
      {generation.date && <span>目标日期 {generation.date}</span>}
      <span>证据截至 {stamp(generation.evidenceThrough)}</span>
      <span>最近成功 {stamp(generation.lastSuccessAt)}</span>
      <span>状态更新 {stamp(generation.updatedAt)}</span>
    </div>
    {generation.targetedCount && <p className="mt-2">另有 {generation.targetedCount} 条趋势已定向复核 · 引用原帖截至 {stamp(generation.targetedThrough)}</p>}
    {generation.error && <p role="status" className="mt-2 text-hot">{generation.error}</p>}
  </div>;
}

const nameOf = { ideas: "Idea", trends: "趋势跟踪", reports: "日报" } as const;
type ResearchGroup = keyof typeof nameOf;
export const entryPath = (type: ResearchGroup, item: ResearchEntry) => type === "reports" ? reportPath(item) : `/${type}/${encodeURIComponent(item.id)}`;

export function EntryCard({ item, type, data, saved }: { item: ResearchEntry; type: ResearchGroup; data: Dashboard; saved: string[] }) {
  const href = entryPath(type, item);
  const key = type === "reports" ? `reports/${href.split("/").at(-1)}` : `${type}/${item.id}`;
  return <article className="card px-4 py-3.5">
    <div className="flex items-start gap-3">
      <h2 className="min-w-0 flex-1 pt-1.5 text-[16px] font-semibold leading-normal text-ink"><Link to={href} className="hover:text-accent">{item.title || nameOf[type]}</Link></h2>
      <SaveButton entry={key} data={data} saved={saved} />
    </div>
    {item.stance && <p className="mt-2 text-xs text-accent">{item.stance}{item.horizon ? " · "+item.horizon : ""}</p>}
    {item.maturity && <div className="mt-2"><Badge>{item.maturity}</Badge></div>}
    {item.sourceIdeaId && item.stage && <div className="mt-2"><Badge tone="accent">{item.stage}</Badge></div>}
    {item.summary && <p className="mt-1.5 line-clamp-3 text-[14px] leading-relaxed text-ink-3">{item.summary}</p>}
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-4">
      {item.asOf && <span>证据截至 {stamp(item.asOf)}</span>}
      <span>更新 {stamp(item.updatedAt || item.generatedAt || item.date)}</span>
      <span>{item.evidence?.length ?? 0} 条证据</span>
    </div>
  </article>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section className="mt-6 border-t border-line pt-4">
    <h2 className="mb-2 text-[17px] font-semibold text-ink">{title}</h2>
    {children}
  </section>;
}

function prose(...values: unknown[]) {
  return values.flatMap(value => Array.isArray(value) ? value : [value]).filter(value => typeof value === "string" && value.trim()).join("\n\n");
}

function Paragraph({ children }: { children: string }) {
  return <p className="whitespace-pre-line text-[15px] leading-8 text-ink-2">{children}</p>;
}

function ResearchBody({ item, type, data }: { item: ResearchEntry; type: "ideas" | "trends"; data: Dashboard }) {
  const sourceLinks = <details className="mt-4 text-sm"><summary className="cursor-pointer text-accent">查看原帖与联网来源</summary>
    <Evidence ids={item.evidence} data={data} />
    {!!item.counterEvidence?.length && <Evidence ids={item.counterEvidence} data={data} />}
    <WebSources sources={item.webSources} />
  </details>;
  if (type === "ideas") {
    const blocks = item.pitch ? [
      ["核心下注", item.pitch], ["依据与预期差", item.variantView ?? ""],
      ["兑现与失效", item.catalystAndKillSwitch ?? ""], ["优先尽调", item.nextDD ?? ""],
    ] : [
      ["核心逻辑与标的", item.coreIdea || prose(item.thesis, item.change)],
      ["事实与分歧", item.evidenceBase || prose(item.facts, item.authorView, item.newEvidence)],
      ["产业背景推演", item.industryContext || prose(item.inference, item.remaining)],
      ["催化与核查", item.actionAndWatch || prose(item.catalyst, item.risk, item.invalidation, item.watchNext)],
    ];
    return <>{blocks.map(([title, text]) => text ? <Section key={title} title={title}><Paragraph>{text}</Paragraph>
      {(title === "事实与分歧" || title === "依据与预期差") && sourceLinks}</Section> : null)}</>;
  }
  return <>
    <Section title="趋势判断与投资关联"><Paragraph>{item.trendOverview || prose(item.summary, item.change)}</Paragraph></Section>
    <Section title="关键事件时间线">
      {(item.timeline ?? []).map((node, index) => <div key={index} className="relative ml-2 border-l-2 border-accent/30 pb-6 pl-5">
        <span className="absolute -left-[5px] top-1 size-2 rounded-full bg-accent" />
        <time className="text-sm font-semibold text-accent">{node.date}</time>
        <Paragraph>{node.summary ?? ""}</Paragraph>
        {!!node.evidence?.length && <details className="mt-1 text-sm"><summary className="cursor-pointer text-ink-4">查看当日依据</summary><Evidence ids={node.evidence} data={data} /></details>}
      </div>)}
    </Section>
    <Section title="核心证据与待验假设"><Paragraph>{item.evidenceAndHypotheses || prose(item.newEvidence,item.remaining,item.watchNext)}</Paragraph>{sourceLinks}</Section>
  </>;
}

export function ResearchEntries({ type, data, item }: { type: "ideas" | "trends"; data: Dashboard; item?: ResearchEntry }) {
  const saved = useSaved(data);
  const posts = postLookup(data);
  const [params] = useSearchParams();
  const ideaGroup = params.get("group") === "ideas";
  const visible = type === "trends" ? data.trends.filter(e => Boolean(e.sourceIdeaId) === ideaGroup) : data.ideas;
  const generation = type==="trends" && (ideaGroup || item?.sourceIdeaId) ? data.generation.ideaTrends : data.generation[type];
  const evidenceThrough = item && [...(item.evidence ?? []), ...(item.counterEvidence ?? []), ...(item.changeEvidence ?? [])]
    .map(id => posts.get(id)?.publishedAt).filter(Boolean).sort().at(-1);
  return <div className="mx-auto max-w-[var(--page-max-reading)] pb-8">
    <Heading title={item?.title ?? nameOf[type]} back={item ? { to: item.sourceIdeaId ? "/trends?group=ideas" : `/${type}`, label: nameOf[type] } : undefined} />
    {!item && <GenerationStatus generation={generation} />}
    {!item && type === "trends" && <nav className="mb-5 flex flex-wrap gap-2" aria-label="趋势分组">
      <Link to="/trends" className={`rounded-full px-4 py-2 text-sm ${!ideaGroup ? "bg-accent text-white" : "bg-surface text-ink-2"}`}>常规趋势跟踪（{data.trends.filter(e=>!e.sourceIdeaId).length}）</Link>
      <Link to="/trends?group=ideas" className={`rounded-full px-4 py-2 text-sm ${ideaGroup ? "bg-accent text-white" : "bg-surface text-ink-2"}`}>Idea 趋势跟踪（{data.trends.filter(e=>e.sourceIdeaId).length}）</Link>
    </nav>}
    {item ? <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink-4">
        <span>最近引用原帖 {stamp(evidenceThrough ?? item.asOf)}</span>
        <span>本条生成 {stamp(item.generatedAt || item.updatedAt)}</span>
        <span className="ml-auto"><SaveButton entry={`${type}/${item.id}`} data={data} saved={saved} /></span>
      </div>
      {item.status === "archived" && <p className="mt-3 text-sm text-ink-4">此趋势已移出当前跟踪，以下为历史判断。</p>}
      {item.maturity && <div className="mt-3"><Badge tone="accent">{item.maturity}</Badge></div>}
      {type === "ideas" && item.summary && <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{item.summary}</p>}
      {item.originalIdea && <section className="card mt-4 px-4 py-4"><p className="mb-2 text-sm font-medium text-ink-3">跟踪的原始 Idea · {stamp(item.originalIdea.asOf)}</p>
        <Link className="font-semibold text-accent" to={`/ideas/${item.sourceIdeaId}`}>{item.originalIdea.title}</Link>
        <Paragraph>{item.originalIdea.judgment}</Paragraph>
      </section>}
      {item.stance && <p className="mt-3 text-sm text-accent">{[item.stance,item.targetScope,item.horizon].filter(Boolean).join(" · ")}</p>}
      <ResearchBody item={item} type={type} data={data} />
      {!!item.watchVariables?.length && <details className="mt-4"><summary className="cursor-pointer text-sm text-accent">持续验证的变量</summary>
        {item.watchVariables.map(v=><div key={v.name} className="mt-3 text-sm"><strong>{v.name}</strong><p>支持判断 · {v.supportIf}</p><p>推翻判断 · {v.invalidateIf}</p></div>)}
      </details>}
      {item.history?.length ? <details className="mt-6 border-t border-line pt-4">
        <summary className="cursor-pointer font-medium">历史修订（{item.history.length}）</summary>
        {[...item.history].reverse().map((entry, i) => <div key={i} className="border-b border-line-soft py-3">
          <p className="text-xs text-ink-4">{stamp(entry.generatedAt || entry.date || entry.updatedAt)}</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-2">{entry.summary}</p>
        </div>)}
      </details> : null}
      {item.relatedIds?.length ? <Section title="相关研究">
        <div className="space-y-2">{(["ideas", "trends"] as const).flatMap((group) => data[group]
          .filter((entry) => entry.id !== item.id && item.relatedIds?.includes(entry.id))
          .map((entry) => <EntryCard key={entry.id} item={entry} type={group} data={data} saved={saved} />))}</div>
      </Section> : null}
      {generation?.status === "failed" && <Section title="本轮生成状态"><GenerationStatus generation={generation} /></Section>}
    </> : visible.length ? <div className="space-y-2">
      {visible.map((entry) => <EntryCard key={entry.id} item={entry} type={type} data={data} saved={saved} />)}
    </div> : <EmptyState title={`还没有${nameOf[type]}条目`} />}
  </div>;
}

function HotColumn({ title, empty, entries, data }: { title: string; empty: string; entries: HotEntry[]; data: Dashboard }) {
  return <section className="min-w-0">
    <h2 className="mb-3 text-[17px] font-semibold text-ink">{title}</h2>
    {entries.length ? <ol className="space-y-2">
      {entries.map((entry, index) => {
        return <li key={entry.id} className="card flex items-start gap-3 px-3.5 py-3">
          <span className={`num pt-0.5 text-[22px] font-black leading-none ${index < 3 ? `text-rank-${index + 1}` : "text-rank-rest"}`}>{String(index + 1).padStart(2, "0")}</span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-semibold leading-relaxed text-ink">
              <Link to={`/story/${encodeURIComponent(entry.id)}`} className="hover:text-accent">{entry.title}</Link>
            </h3>
            <p className="mt-1 text-[12px] text-ink-4">{entry.independentCount} 条独立证据 · {entry.sourceCount} 个账号 · {entry.postCount} 条证据{Number.isFinite(entry.score) && ` · ${entry.score} 分`}</p>
            <p className="mt-1 break-words text-[12px] text-ink-3">{entry.authors?.map((handle) => `@${handle}`).join("、")}</p>
            <details className="mt-2 text-[12px] text-ink-4">
              <summary className="cursor-pointer">传播证据 · {stamp(entry.updatedAt)}</summary>
              <Evidence ids={entry.evidence} data={data} />
            </details>
          </div>
        </li>;
      })}
    </ol> : <div className="card"><EmptyState title={empty} /></div>}
  </section>;
}

export function ResearchHot({ data }: { data: Dashboard }) {
  return <div className="pb-8">
    <Heading title="热点榜" />
    <p className="mb-5 text-[13px] text-ink-4">近 48 小时 · 数据读取 {stamp(data.generatedAt)}</p>
    <div className="grid gap-6 md:grid-cols-2">
      <HotColumn title="多账号关注" empty="暂无多账号关注的事件" entries={data.hot} data={data} />
      <HotColumn title="单源高分信号" empty="暂无单源高分信号" entries={data.singleHot} data={data} />
    </div>
  </div>;
}

export function ResearchTopics({ topics }: { topics: Topic[] }) {
  const [params] = useSearchParams();
  const group = params.get("group") === "issue" ? "issue" : "company";
  const only = ["1", "true"].includes(params.get("onlyFeatured") ?? "");
  const href = (group: string, only: boolean) => `/topics?group=${group}${only ? "&onlyFeatured=1" : ""}`;
  return <div className="pb-8">
    <Heading title="主题" />
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <PillTabs layoutId="research-topics" active={group} label="主题类别" items={[
        { key: "company", label: "公司与机构", to: href("company", only) },
        { key: "issue", label: "产业链与市场议题", to: href("issue", only) },
      ]} />
      <Link to={href(group, !only)} aria-current={only ? "true" : undefined} className={`rounded-full border px-3 py-1.5 text-[13px] ${only ? "border-accent/35 bg-accent-soft text-accent" : "border-line text-ink-3"}`}>仅精选</Link>
    </div>
    {topics.length ? <ul className="card grid divide-y divide-line-soft lg:grid-cols-2 lg:gap-3 lg:divide-y-0 lg:border-0 lg:bg-transparent lg:shadow-none wide:grid-cols-3">
      {topics.map((topic) => <li key={topic.name}>
        <Link to={topicPath(topic) + (only ? "&onlyFeatured=1" : "")} className="group flex items-center gap-3 px-4 py-3.5 lg:card lg:card-hover">
          <div className="min-w-0 flex-1">
            <h2 className="font-semibold text-ink group-hover:text-accent">{topic.name}</h2>
            <p className="mt-1 text-[12px] text-ink-4">{topic.count} 条原帖 · {topic.propagationCount} 次传播</p>
          </div>
          <IconChevronRight size={16} className="shrink-0 text-ink-4" />
        </Link>
      </li>)}
    </ul> : <EmptyState title="这个分组还没有主题" />}
  </div>;
}

const sourceStatuses: Record<string, string> = {
  unconfigured: "待配置", backfilling: "回补中", "catching-up": "补读中", empty: "已查无新增",
  ok: "读取成功", error: "读取失败", failed: "读取失败", partial: "部分读取", unavailable: "存在不可读记录", awaiting: "待补读",
};

export function ResearchSources({ data }: { data: Dashboard }) {
  return <div className="mx-auto max-w-[var(--page-max-reading)] pb-8">
    <Heading title="关注来源" back={{ to: "/more", label: "更多" }} />
    {data.sources.map((source) => <article key={source.handle} className="border-b border-line-soft py-3.5 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Link to={`/all?account=${encodeURIComponent(source.handle)}`} className="font-semibold text-accent hover:underline">@{source.handle}</Link>
        <External url={`https://x.com/${encodeURIComponent(source.handle)}`}>X 主页</External>
        {source.status && <Badge>{sourceStatuses[source.status] ?? source.status}</Badge>}
      </div>
      <p className="mt-1 text-[13px] text-ink-3">
        最近成功 {stamp(source.lastSuccess || source.lastSuccessAt)} · 最近尝试 {stamp(source.lastAttempt || source.lastChecked || source.checkedAt)}
      </p>
      <p className="mt-1 text-[13px] text-ink-4">
        覆盖 {stamp(source.coverageStart)} 至 {stamp(source.coverageEnd)} · 采集 {source.postCount ?? 0} 条 · 样本 {source.sampleCount ?? 0} 条 · 待处理 {source.pendingCount ?? 0} 条 · 不可读 {source.unavailableCount ?? 0} 条
      </p>
      {(source.error || source.message || source.pageState) && <p className="mt-1 text-[13px] text-ink-4">
        {(typeof source.error === "object" ? source.error?.message : source.error) || source.message || source.pageState}
      </p>}
    </article>)}
    {!data.sources.length && <EmptyState title="当前没有关注来源" />}
  </div>;
}

export function ResearchStory({ entry, data }: { entry: HotEntry; data: Dashboard }) {
  return <div className="mx-auto max-w-[var(--page-max-reading)] pb-8">
    <Heading title={entry.title} back={{ to: "/hot", label: "热点榜" }} />
    <p className="mb-3 text-[13px] text-ink-4">{entry.independentCount} 条独立证据 · {entry.sourceCount} 个传播账号 · {stamp(entry.updatedAt)} 更新</p>
    {entry.authors?.length > 0 && <p className="mb-3 text-sm text-ink-3">账号 {entry.authors.map((handle) => `@${handle}`).join("、")}</p>}
    <Section title="传播证据"><Evidence ids={entry.evidence} data={data} /></Section>
  </div>;
}
