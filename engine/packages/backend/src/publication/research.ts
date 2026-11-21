// TechBuzz's SQLite service owns the public research projection. Every adapter reads this boundary.
import { CATEGORY_LABELS } from "@techbuzz/contracts/taxonomy";
import { beijingDate, beijingTime } from "@techbuzz/contracts/time";
import { config } from "../config.ts";
import { InvalidCursorError } from "../lib/cursor.ts";
import { SnapshotRequiredError } from "./v1.ts";

export const researchPublication = () => Boolean(process.env.TECHBUZZ_RESEARCH_URL);
export const RESEARCH_ITEM_QUERY = ["mode", "window", "by", "category", "kind", "type", "hide", "account", "source", "onlyFeatured", "q", "date", "period", "company", "topic", "tag", "sort", "limit", "cursor"] as const;
export const RESEARCH_REPEATED_QUERY = ["kind", "type", "hide"] as const;
export const RESEARCH_CATEGORY_KEYS = ["earnings", "markets", "supply-chain", "industry", "opinion"] as const;
export const RESEARCH_CATEGORY_INPUTS = [...RESEARCH_CATEGORY_KEYS, ...RESEARCH_CATEGORY_KEYS.map((key) => CATEGORY_LABELS[key])];
export const RESEARCH_KINDS = ["original", "reply", "quote", "repost", "unknown"] as const;
export const RESEARCH_WINDOWS = ["all", "24h", "48h", "7d", "30d"] as const;

export class ResearchQueryError extends Error {}

export async function researchRead<T>(path: string, params: Record<string, string | number | boolean | null | undefined> = {}): Promise<T | null> {
  const base = process.env.TECHBUZZ_RESEARCH_URL;
  if (!base) throw new Error("Research service unavailable");
  const url = new URL(path, base);
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: { "x-techbuzz-site": config.siteUrl }, signal: AbortSignal.timeout(8_000) });
  if (response.status === 404) return null;
  if (response.status === 400 || response.status === 409) {
    const problem = await response.json() as { code: string; error: string };
    if (problem.code === "invalid_cursor") throw new InvalidCursorError(problem.error);
    if (problem.code === "snapshot_required") throw new SnapshotRequiredError(problem.error);
    throw new ResearchQueryError(problem.error);
  }
  if (!response.ok) throw new Error(`Research service returned ${response.status}`);
  return response.json() as Promise<T>;
}

export async function researchRequired<T>(path: string, params?: Parameters<typeof researchRead>[1]): Promise<T> {
  const body = await researchRead<T>(path, params);
  if (body === null) throw new Error("Research response not found");
  return body;
}

export interface ResearchItem {
  id: string;
  postId: string;
  title: string;
  summary: string | null;
  handle: string;
  originalAuthor: string | null;
  publishedAt: string | null;
  activityAt: string | null;
  timeBasis: "published" | "exact" | "observed" | "unknown";
  kind: (typeof RESEARCH_KINDS)[number];
  category: string | null;
  links: { techbuzz: string; original: string | null };
}

export interface ResearchItems {
  schemaVersion: 1;
  query: { mode: "selected" | "all" };
  items: ResearchItem[];
  page: { count: number; hasMore: boolean; nextCursor: string | null };
}

interface ResearchEvent {
  id: string;
  title: string;
  rank: number;
  sourceCount: number;
  independentCount: number;
  updatedAt: string;
  links: { story: string; api: string };
}

export interface ResearchHot {
  schemaVersion: 1;
  window: "48h";
  count: number;
  items: ResearchEvent[];
  hot: ResearchEvent[];
  singleHot: ResearchEvent[];
}

export interface ResearchStory {
  schemaVersion: 1;
  story: ResearchEvent & { reports: ResearchItem[] };
}

interface ResearchReport {
  date: string;
  title: string;
  summary: string;
  updatedAt: string;
  sections: { title: string; summary: string; evidence: string[] }[];
  links: { techbuzz: string };
}

export interface ResearchDailies { items: ResearchReport[] }
export interface ResearchDaily { schemaVersion: 1; report: ResearchReport }

export async function researchSearch(params: Parameters<typeof researchRead>[1]) {
  const found = await researchRequired<ResearchItems>("/api/public/items", params);
  return found.items.length || params?.cursor || params?.mode || params?.onlyFeatured === "true" || params?.onlyFeatured === true || params?.onlyFeatured === "1"
    ? found
    : researchRequired<ResearchItems>("/api/public/items", { ...params, mode: "all" });
}

const safeMarkdown = (value: string) => value.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}\[\]<>#!|]/g, "\\$&");
const linked = (label: string, url: string) => `[${safeMarkdown(label)}](<${url.replace(/[<>\r\n]/g, encodeURIComponent)}>)`;
export const timing = { published: "原帖发布", exact: "活动时间", observed: "首次观察", unknown: "时间未知" };
export const kindLabel = { original: "原帖", reply: "回复", quote: "引用", repost: "转发", unknown: "待识别" };
export const researchTime = (value: string) => `${beijingDate(value)} ${beijingTime(value)}（北京时间）`;

function markdownItems(items: ResearchItem[]) {
  return items.map((item) => `- ${linked(item.title, item.links.techbuzz)} · @${safeMarkdown(item.handle)} · ${kindLabel[item.kind]} · ${timing[item.timeBasis]}`
    + (item.activityAt ? ` ${researchTime(item.activityAt)}` : "")
    + (item.originalAuthor && item.originalAuthor.toLowerCase() !== item.handle.toLowerCase() ? ` · 原作者 @${safeMarkdown(item.originalAuthor)}` : "")
    + (item.links.original ? ` · ${linked("X 原帖", item.links.original)}` : "")
    + (item.summary ? `\n  ${safeMarkdown(item.summary)}` : ""));
}

export function researchItemsAnswer(body: ResearchItems, search?: string) {
  const title = search ? `搜索 ${safeMarkdown(search)}` : body.query.mode === "selected" ? "精选" : "全部动态";
  const lines = markdownItems(body.items);
  return `# TechBuzz · ${title}\n\n${lines.length ? lines.join("\n\n") : "当前条件下没有动态。"}\n`;
}

export function researchHotAnswer(body: ResearchHot, next: "http" | "mcp") {
  const render = (items: ResearchEvent[]) => items.map((item) => {
    const detail = next === "http" ? linked("事件详情", `${config.siteUrl}/api/v1/agent/stories/${encodeURIComponent(item.id)}`)
      : `public_id: ${safeMarkdown(item.id)}`;
    return `${item.rank}. ${linked(item.title, item.links.story)} · ${item.sourceCount} 个账号 · ${item.independentCount} 个独立来源 · ${detail}`;
  }).join("\n") || "暂无符合条件的事件。";
  return `# TechBuzz · 过去 48 小时热点\n\n## 多源热点\n\n${render(body.hot)}\n\n## 单源高分\n\n${render(body.singleHot)}\n`;
}

export function researchStoryAnswer(body: ResearchStory) {
  return `# ${safeMarkdown(body.story.title)}\n\n${markdownItems(body.story.reports).join("\n\n")}\n`;
}

export function researchDailyAnswer(body: ResearchDaily) {
  const { report } = body;
  return [`# ${safeMarkdown(report.title)}`, linked(`${report.date} · 研究日报`, report.links.techbuzz), safeMarkdown(report.summary),
    ...report.sections.flatMap((section) => [`## ${safeMarkdown(section.title)}`, safeMarkdown(section.summary),
      section.evidence.map((id) => linked(`X 帖子 ${id}`, `https://x.com/i/web/status/${encodeURIComponent(id)}`)).join(" · ")])].filter(Boolean).join("\n\n") + "\n";
}

export function limitedHot(body: ResearchHot, limit: number): ResearchHot {
  const hot = body.hot.slice(0, limit);
  return { ...body, hot, items: hot, count: hot.length, singleHot: body.singleHot.slice(0, limit) };
}
