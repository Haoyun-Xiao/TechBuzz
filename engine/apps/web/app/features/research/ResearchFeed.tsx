import { Form, Link, useLocation, useSearchParams } from "react-router";
import { beijingDate } from "@techbuzz/contracts/time";
import { IconSearch } from "../../components/icons";
import { EmptyState } from "../../components/ui/Page";
import { Pagination } from "../feed/DayList";
import { CATEGORIES, KINDS, previewPost, project, type Activity, type Dashboard, type Topic } from "./data";
import { Heading, PostList } from "./Posts";
import { useSaved } from "./saved";

export const PAGE_SIZE = 30;
export const UNKNOWN_PAGE_SIZE = 15;

const labels = { new: "最新时间", old: "最早时间", score: "研究评分" } as const;
const categories = new Map<string, string>(["earnings", "markets", "supply-chain", "industry", "opinion"].map((key, index) => [key, CATEGORIES[index]!]));
const handleName = (value: string | null) => (value ?? "").replace(/^@/, "").toLowerCase();
const instant = (date?: string | null) => {
  const time = date ? Date.parse(date) : NaN;
  return Number.isFinite(time) ? time : -Infinity;
};
const order = (a: Activity, b: Activity) => instant(b.activityAt) - instant(a.activityAt) || b.id.localeCompare(a.id);
const compareScore = (a: Activity, b: Activity) => (b.score ?? -1) - (a.score ?? -1) || order(a, b);
const topicIds = (data: Dashboard, name: string, group?: Topic["group"]) => new Set(data.topics.filter((x) => x.name === name && (!group || x.group === group)).flatMap((x) => x.postIds));

function researchFilters(data: Dashboard, entries: Activity[], params: URLSearchParams, topic?: Topic, asOf = data.generatedAt) {
  const account = handleName(params.get("account") || params.get("source"));
  const input = params.get("category");
  const category = input && (categories.get(input) ?? (input === "market" ? "市场与估值" : input));
  const hidden = new Set(params.getAll("hide").flatMap((value) => value.split(",")));
  const included = new Set(params.getAll("kind").flatMap((value) => value.split(",")).filter((kind) => Object.hasOwn(KINDS, kind)));
  const only = params.get("onlyFeatured") === "1" || params.get("onlyFeatured") === "true";
  const terms = (params.get("q") || "").trim().slice(0, 200).toLowerCase().split(/\s+/).filter(Boolean);
  const company = params.get("company");
  const tag = params.get("topic") || params.get("tag");
  const ids = topic ? new Set(topic.postIds) : company ? topicIds(data, company, "company") : tag ? topicIds(data, tag) : null;
  const after = params.get("period") === "24" ? instant(asOf) - 86_400_000 : null;
  const date = params.get("date");

  return entries.filter((row) => {
    if (instant(row.firstSeenAt) > instant(asOf) || instant(row.activityAt) > instant(asOf)) return false;
    if (account && handleName(row.handle) !== account) return false;
    if (category && CATEGORIES.some((name) => name === category) && row.category !== category) return false;
    if (hidden.has(row.kind) || (included.size && !included.has(row.kind))) return false;
    if (only && !row.featured) return false;
    if (ids && !ids.has(row.postId)) return false;
    if (after !== null && instant(row.activityAt) < after) return false;
    if (date && (!row.activityAt || beijingDate(row.activityAt) !== date)) return false;
    if (!terms.length) return true;
    const { post } = row;
    const score = data.scores[row.postId];
    const haystack = [row.handle, row.originalAuthor, ...row.distributors, row.category, post.text, post.textZh, post.excerpt,
      post.article?.title, post.article?.text, post.quoted?.text, post.quotedTextZh, score?.event, score?.summary, score?.reason,
      ...(score?.companies ?? []), ...(score?.topics ?? [])].join(" ").toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

export function researchRows(data: Dashboard, params: URLSearchParams, featured = false, topic?: Topic) {
  const requested = params.get("asOf");
  const asOf = requested && Number.isFinite(instant(requested)) && instant(requested) <= instant(data.generatedAt)
    ? new Date(requested).toISOString() : data.generatedAt;
  const eligible = (row: Activity) => instant(row.firstSeenAt) <= instant(asOf) && instant(row.activityAt) <= instant(asOf);
  let entries = featured ? data.featured : data.activities;
  if (featured && entries.some((row) => !eligible(row))) {
    const replacements = new Map<string, Activity>();
    for (const row of data.activities) {
      if (row.featured && eligible(row) && !replacements.has(row.postId)) replacements.set(row.postId, row);
    }
    entries = entries.flatMap((row) => eligible(row) ? [row] : replacements.has(row.postId) ? [replacements.get(row.postId)!] : []);
  }
  const filtered = researchFilters(data, entries, params, topic, asOf);
  if (featured) return { known: filtered.sort(compareScore), unknown: [], asOf };
  const known = filtered.filter((row) => row.timeBasis !== "unknown" && Number.isFinite(instant(row.activityAt)));
  const unknown = filtered.filter((row) => row.timeBasis === "unknown" || !Number.isFinite(instant(row.activityAt)));
  const sort = params.get("sort");
  known.sort(sort === "score" ? compareScore : sort === "old" ? (a, b) => order(b, a) : order);
  unknown.sort(sort === "score" ? compareScore : (a, b) => a.id.localeCompare(b.id));
  return { known, unknown, asOf };
}

const selectClass = "h-9 w-full min-w-0 rounded-control border border-line bg-surface px-2.5 text-[13px] text-ink sm:w-auto";
const chip = (active: boolean) => `inline-flex min-h-8 items-center whitespace-nowrap rounded-full border px-3 text-[13px] transition-colors ${active ? "border-accent/35 bg-accent-soft font-medium text-accent" : "border-line text-ink-3 hover:border-line-strong hover:text-ink"}`;

function pageOf(params: URLSearchParams, key: string, total: number, size: number) {
  const count = Math.max(1, Math.ceil(total / size));
  const page = Math.min(count, Math.max(1, Number.parseInt(params.get(key) ?? "1", 10) || 1));
  return { count, page, start: (page - 1) * size };
}

export function feedPage(data: Dashboard, params: URLSearchParams, featured = false, topic?: Topic) {
  const rows = researchRows(data, params, featured, topic);
  const known = pageOf(params, "page", rows.known.length, PAGE_SIZE);
  const unknown = pageOf(params, "unknownPage", rows.unknown.length, UNKNOWN_PAGE_SIZE);
  const knownRows = rows.known.slice(known.start, known.start + PAGE_SIZE);
  const unknownRows = rows.unknown.slice(unknown.start, unknown.start + UNKNOWN_PAGE_SIZE);
  const posts = new Map([...knownRows, ...unknownRows].map((row) => [row.postId, previewPost(row.post)]));
  const simplify = (row: Activity) => ({ ...row, post: posts.get(row.postId)! });
  return {
    asOf: rows.asOf,
    known: { ...known, total: rows.known.length, rows: knownRows.map(simplify) },
    unknown: { ...unknown, total: rows.unknown.length, rows: unknownRows.map(simplify) },
    accounts: [...new Set([...data.sources.map((source) => source.handle), ...data.activities.map((row) => row.handle)])].filter(Boolean).sort((a, b) => a.localeCompare(b, "en")),
    data: project(data, {
      posts: [...posts.values()],
      scores: Object.fromEntries([...posts.keys()].flatMap((id) => data.scores[id] ? [[id, data.scores[id]]] : [])),
    }),
    topic: topic ? { name: topic.name, group: topic.group } : null,
  };
}

export function ResearchFeed({ feed, featured = false }: { feed: ReturnType<typeof feedPage>; featured?: boolean }) {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const { data, accounts, topic, known, unknown, asOf } = feed;
  const saved = useSaved(data);
  const title = topic?.name ?? (featured ? "精选" : "全部动态");
  const account = handleName(params.get("account") || params.get("source"));
  const rawCategory = params.get("category") ?? "";
  const category = categories.get(rawCategory) ?? (rawCategory === "market" ? "市场与估值" : rawCategory);
  const only = ["1", "true"].includes(params.get("onlyFeatured") ?? "");
  const hidden = params.getAll("hide").flatMap((value) => value.split(","));
  const included = params.getAll("kind").flatMap((value) => value.split(",")).filter((kind) => Object.hasOwn(KINDS, kind));
  const sort = params.get("sort");
  const updated = (key: string, value: string | string[]) => {
    const next = new URLSearchParams(params);
    if (key !== "page" && key !== "unknownPage") {
      next.delete("page");
      next.delete("unknownPage");
      next.delete("asOf");
    }
    if (key === "account") next.delete("source");
    if (key === "hide") next.delete("kind");
    next.delete(key);
    if (Array.isArray(value)) value.forEach((entry) => next.append(key, entry));
    else if (value) next.set(key, value);
    return next;
  };
  const href = (url: URLSearchParams) => pathname + (url.size ? `?${url}` : "");
  const pagination = (key: "page" | "unknownPage") => (page: number) => {
    const next = updated(key, page > 1 ? String(page) : "");
    next.set("asOf", asOf);
    return href(next);
  };

  return <div className="pb-8">
    <Heading title={title} back={topic ? { to: "/topics", label: "主题" } : undefined} />
    {featured ? (
      <p className="mb-4 text-[13px] text-ink-3">研究评分达到 {data.threshold} 分的精选原帖，按评分、时间排列。</p>
    ) : (
      <div className="mb-5 space-y-3 border-b border-line-soft pb-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Form key={params.get("q") ?? ""} action={pathname} method="get" role="search" className="flex min-w-0 flex-1 items-center gap-2">
            {[...params].filter(([key]) => !["q", "page", "unknownPage", "search", "asOf"].includes(key)).map(([key, value], index) => <input type="hidden" key={`${key}-${index}`} name={key} value={value} />)}
            <input name="q" type="search" aria-label="搜索帖子" placeholder="搜索帖子、摘要或账号" maxLength={200}
              defaultValue={params.get("q") ?? ""} className="h-9 w-full min-w-0 rounded-control border border-line bg-surface px-3 text-[13px] text-ink" />
            <button type="submit" aria-label="搜索" className="grid size-9 shrink-0 place-items-center rounded-control border border-line text-ink-2 hover:bg-bg-sunk"><IconSearch size={16} /></button>
          </Form>
          <div className="grid grid-cols-3 gap-2 sm:flex sm:items-center">
            <select aria-label="关注账号" className={selectClass} value={account} onChange={(event) => setParams(updated("account", event.target.value))}>
              <option value="">全部账号</option>
              {account && !accounts.some((name) => handleName(name) === account) && <option value={account}>@{account}</option>}
              {accounts.map((name) => <option key={name} value={handleName(name)}>@{name}</option>)}
            </select>
            <select aria-label="内容类别" className={selectClass} value={category} onChange={(event) => setParams(updated("category", event.target.value))}>
              <option value="">全部类别</option>
              {CATEGORIES.map((name) => <option key={name}>{name}</option>)}
            </select>
            <select aria-label="排序" className={selectClass} value={sort === "old" || sort === "score" ? sort : "new"} onChange={(event) => setParams(updated("sort", event.target.value === "new" ? "" : event.target.value))}>
              {Object.entries(labels).map(([key, name]) => <option key={key} value={key}>{name}</option>)}
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2" aria-label="活动筛选">
          {Object.entries(KINDS).map(([key, label]) => {
            const inactive = hidden.includes(key) || (included.length > 0 && !included.includes(key));
            const current = Object.keys(KINDS).filter((kind) => hidden.includes(kind) || (included.length > 0 && !included.includes(kind)));
            const next = inactive ? current.filter((kind) => kind !== key) : [...current, key];
            return <Link key={key} to={href(updated("hide", next))} aria-label={inactive ? `显示${label}` : `隐藏${label}`} aria-current={inactive ? undefined : "true"} className={chip(!inactive)}>{label}</Link>;
          })}
          <Link to={href(updated("onlyFeatured", only ? "" : "1"))} aria-current={only ? "true" : undefined} className={chip(only)}>仅精选</Link>
          {topic && <Link to={`/topics?group=${topic.group}${only ? "&onlyFeatured=1" : ""}`} className="ml-auto text-[13px] text-accent hover:underline">全部主题</Link>}
        </div>
        <p className="text-[12px] text-ink-4">共 {known.total + unknown.total} 条动态{unknown.total > 0 && `，其中 ${unknown.total} 条活动时间未知`}</p>
      </div>
    )}
    {known.total > 0 && <PostList rows={known.rows} data={data} saved={saved} timeline={!featured && sort !== "score"} />}
    <Pagination page={known.page} pageCount={known.count} href={pagination("page")} />
    {unknown.total > 0 && <section className="mt-8 border-t border-line pt-4">
      <h2 className="mb-1 text-lg font-semibold text-ink">转发时间未知</h2>
      <p className="mb-3 text-[13px] text-ink-4">旧回填记录保留原帖和传播账号，单列于此。</p>
      <PostList rows={unknown.rows} data={data} saved={saved} timeline={false} />
      <Pagination page={unknown.page} pageCount={unknown.count} href={pagination("unknownPage")} />
    </section>}
    {known.total + unknown.total === 0 && <EmptyState title={featured ? "还没有精选内容" : "没有符合筛选条件的动态"} />}
  </div>;
}
