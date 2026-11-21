import { Link, useSearchParams } from "react-router";
import type { ReactNode } from "react";
import { Badge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/Page";
import { PillTabs } from "../../components/ui/Tabs";
import { IconChevronRight } from "../../components/icons";
import { Evidence, External, Heading, SaveButton } from "./Posts";
import { reportPath, stamp, topicPath, type Dashboard, type Generation, type HotEntry, type ResearchEntry, type Topic } from "./data";
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
      {generation.date && <span>目标日期 {generation.date}</span>}
      <span>证据截至 {stamp(generation.evidenceThrough)}</span>
      <span>最近成功 {stamp(generation.lastSuccessAt)}</span>
      <span>状态更新 {stamp(generation.updatedAt)}</span>
    </div>
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

const fields = [
  ["投资假设", "thesis"], ["已知事实", "facts"], ["作者观点", "authorView"], ["研究推断", "inference"],
  ["趋势阶段", "stage"], ["催化剂", "catalyst"], ["风险", "risk"], ["失效条件", "invalidation"], ["下一步核对", "watchNext"],
] as const;

export function ResearchEntries({ type, data, item }: { type: "ideas" | "trends"; data: Dashboard; item?: ResearchEntry }) {
  const saved = useSaved(data);
  return <div className="mx-auto max-w-[var(--page-max-reading)] pb-8">
    <Heading title={item?.title ?? nameOf[type]} back={item ? { to: `/${type}`, label: nameOf[type] } : undefined} />
    <GenerationStatus generation={data.generation[type]} />
    {item ? <>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-ink-4">
        <span>证据截至 {stamp(item.asOf)}</span>
        <span>本条更新 {stamp(item.updatedAt || item.generatedAt)}</span>
        <span className="ml-auto"><SaveButton entry={`${type}/${item.id}`} data={data} saved={saved} /></span>
      </div>
      {item.summary && <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{item.summary}</p>}
      {fields.some(([, key]) => item[key]?.length) && <Section title="研究要点">
        <dl className="grid gap-3 text-[14px] leading-relaxed text-ink-2">
          {fields.map(([label, key]) => {
            const value = item[key];
            return value?.length ? <div key={key}>
              <dt className="font-semibold text-ink">{label}</dt>
              <dd className="mt-1">{Array.isArray(value) ? value.join("、") : value}</dd>
            </div> : null;
          })}
        </dl>
      </Section>}
      <Section title="支持证据"><Evidence ids={item.evidence} data={data} /></Section>
      {!!item.counterEvidence?.length && <Section title="反证"><Evidence ids={item.counterEvidence} data={data} /></Section>}
      {item.timeline?.length ? <Section title="趋势演进">
        {item.timeline.map((entry, i) => <div key={i} className="border-b border-line-soft py-3">
          <p className="text-xs text-ink-4">{stamp(entry.date || entry.updatedAt)}</p>
          <p className="mt-2 text-sm text-ink-2">{entry.summary}</p>
          {!!entry.evidence?.length && <Evidence ids={entry.evidence} data={data} />}
        </div>)}
      </Section> : null}
      {item.history?.length ? <Section title="研究修订">
        {item.history.map((entry, i) => <div key={i} className="border-b border-line-soft py-3">
          <p className="text-xs text-ink-4">{stamp(entry.generatedAt || entry.date || entry.updatedAt)}</p>
          <p className="mt-2 text-sm text-ink-2">{entry.summary}</p>
          {!!entry.evidence?.length && <Evidence ids={entry.evidence} data={data} />}
          {!!entry.counterEvidence?.length && <Evidence ids={entry.counterEvidence} data={data} />}
        </div>)}
      </Section> : null}
      {item.relatedIds?.length ? <Section title="相关研究">
        <div className="space-y-2">{(["ideas", "trends"] as const).flatMap((group) => data[group]
          .filter((entry) => entry.id !== item.id && item.relatedIds?.includes(entry.id))
          .map((entry) => <EntryCard key={entry.id} item={entry} type={group} data={data} saved={saved} />))}</div>
      </Section> : null}
    </> : data[type].length ? <div className="space-y-2">
      {data[type].map((entry) => <EntryCard key={entry.id} item={entry} type={type} data={data} saved={saved} />)}
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
