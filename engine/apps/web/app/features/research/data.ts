import { beijingStamp } from "@techbuzz/contracts/time";

export const CATEGORIES = ["业绩与指引", "市场与估值", "产业链", "行业", "观点"] as const;
export const KINDS = { original: "原帖", reply: "回复", quote: "引用", repost: "转发" } as const;

export type ActivityKind = keyof typeof KINDS | "unknown";
export const kindLabel = (kind: ActivityKind) => kind === "unknown" ? "发帖类型待确认" : KINDS[kind];

export interface ReferencedPost {
  id?: string;
  handle?: string;
  authorName?: string;
  url?: string;
  text?: string;
  excerpt?: string;
}

export interface Post extends ReferencedPost {
  id: string;
  handle: string;
  nativeArticleId?: string;
  aliases?: string[];
  avatarUrl?: string;
  originId?: string;
  threadRootId?: string;
  publishedAt?: string;
  kind?: ActivityKind;
  textZh?: string;
  quotedTextZh?: string;
  contextStatus?: string;
  quoted?: ReferencedPost;
  replyTo?: ReferencedPost;
  repostOf?: ReferencedPost;
  article?: { title?: string; url?: string; text?: string; media?: Media[] };
  media?: Media[];
}

export type Media = string | { url?: string; previewUrl?: string; preview_image_url?: string; kind?: string; alt?: string };

export interface Score {
  score?: number;
  event?: string;
  reason?: string;
  summary?: string;
  category?: string;
  companies?: string[];
  topics?: string[];
  scoredAs?: string;
  breakdown?: { impact?: number; novelty?: number; verification?: number; followUp?: number };
}

export interface Activity {
  id: string;
  postId: string;
  kind: ActivityKind;
  handle: string;
  originalAuthor: string | null;
  url: string;
  activityAt: string | null;
  firstSeenAt?: string | null;
  timeBasis: "published" | "exact" | "observed" | "unknown";
  post: Post;
  score: number | null;
  featured: boolean;
  distributors: string[];
  category: string | null;
}

export interface EvidenceEntry {
  previousJudgment?: string;
  newEvidence?: string;
  change?: string;
  remaining?: string;
  changeEvidence?: string[];
  maturity?: string;
  date?: string;
  updatedAt?: string;
  generatedAt?: string;
  summary?: string;
  evidence?: string[];
  counterEvidence?: string[];
}

export interface ResearchEntry extends EvidenceEntry {
  id: string;
  title: string;
  asOf?: string;
  status?: string;
  thesis?: string;
  facts?: string[];
  authorView?: string;
  inference?: string;
  stage?: string;
  catalyst?: string;
  risk?: string;
  invalidation?: string;
  watchNext?: string;
  relatedIds?: string[];
  timeline?: EvidenceEntry[];
  sections?: Array<EvidenceEntry & { title: string }>;
  history?: EvidenceEntry[];
  ideaIds?: string[];
  trendIds?: string[];
  coverage?: { cutoff: string; scheduledAt: string; laterCount: number } | null;
  inputCount?: number;
}

export interface Source {
  handle: string;
  status?: string;
  lastSuccess?: string;
  lastSuccessAt?: string;
  lastAttempt?: string;
  lastChecked?: string;
  checkedAt?: string;
  coverageStart?: string;
  coverageEnd?: string;
  postCount?: number;
  sampleCount?: number;
  pendingCount?: number;
  unavailableCount?: number;
  error?: string | { message?: string };
  message?: string;
  pageState?: string;
}

export interface HotEntry {
  id: string;
  title: string;
  independentCount: number;
  sourceCount: number;
  postCount: number;
  evidence: string[];
  updatedAt: string;
  score: number | null;
  authors: string[];
}

export interface Topic {
  name: string;
  group: "company" | "issue";
  postIds: string[];
  count: number;
  propagationCount: number;
}

export interface Generation {
  targetedCount?: number;
  targetedThrough?: string | null;
  status: string;
  evidenceThrough?: string | null;
  lastSuccessAt?: string | null;
  updatedAt?: string | null;
  error?: string | null;
  date?: string;
}

export interface Dashboard {
  posts: Post[];
  scores: Record<string, Score>;
  sources: Source[];
  activities: Activity[];
  featured: Activity[];
  ideas: ResearchEntry[];
  trends: ResearchEntry[];
  reports: ResearchEntry[];
  hot: HotEntry[];
  singleHot: HotEntry[];
  topics: Topic[];
  generation: Record<"ideas" | "trends" | "report", Generation>;
  threshold: number;
  thresholdVersion?: number;
  generatedAt: string;
}

export function stamp(value?: string | null) {
  if (!value) return "—";
  const n = Date.parse(value);
  return Number.isFinite(n) && value.length > 10 ? beijingStamp(n) : value;
}

export function safeURL(value?: string | null) {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export const postPath = (id: string) => `/research/posts/${encodeURIComponent(id)}`;
export const reportDate = (report: ResearchEntry) => report.date ?? report.id.replace(/^report-/, "");
export const reportPath = (report: ResearchEntry) => `/daily/${encodeURIComponent(reportDate(report))}`;
export const topicPath = (topic: Pick<Topic, "name" | "group">) => `/topics/${encodeURIComponent(topic.name)}?group=${topic.group}`;

export function postTitle(post: Post, score?: Score) {
  return score?.event || post.article?.title || (post.textZh || post.text || post.excerpt || "").split("\n")[0]?.slice(0, 100) || `@${post.handle}`;
}

export function postLookup(data: Dashboard) {
  const aliases = new Map<string, Post>();
  for (const post of data.posts) {
    aliases.set(post.id, post);
    if (post.nativeArticleId && !aliases.has(post.nativeArticleId)) aliases.set(post.nativeArticleId, post);
    for (const alias of post.aliases ?? []) if (!aliases.has(alias)) aliases.set(alias, post);
    const tweetId = post.url?.match(/\/status\/(\d+)/)?.[1];
    if (tweetId && !aliases.has(tweetId)) aliases.set(tweetId, post);
  }
  return aliases;
}

/** Lists show excerpts and keep the source ID needed by old browser bookmarks. */
export function previewPost(post: Post): Post {
  return {
    id: post.id, nativeArticleId: post.nativeArticleId, handle: post.handle, authorName: post.authorName,
    avatarUrl: post.avatarUrl, url: post.url, publishedAt: post.publishedAt, kind: post.kind,
    text: post.text?.slice(0, 1600), textZh: post.textZh?.slice(0, 1600), excerpt: post.excerpt?.slice(0, 1600),
    quoted: post.quoted ? { ...post.quoted, text: post.quoted.text?.slice(0, 500) } : undefined,
    quotedTextZh: post.quotedTextZh?.slice(0, 500),
    article: post.article?.title ? { title: post.article.title } : undefined,
    media: post.media?.slice(0, 4),
  };
}

/** Send only the records a route uses to the browser. */
export function project(data: Dashboard, subset: Partial<Dashboard>): Dashboard {
  return {
    generatedAt: data.generatedAt,
    threshold: data.threshold,
    thresholdVersion: data.thresholdVersion,
    posts: [],
    scores: {},
    sources: [],
    activities: [],
    featured: [],
    ideas: [],
    trends: [],
    reports: [],
    hot: [],
    singleHot: [],
    topics: [],
    generation: data.generation,
    ...subset,
  };
}
