import { beijingStamp, beijingDate } from "@techbuzz/contracts/time";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import type { FeedItemSummary } from "@techbuzz/contracts/site";
import { FeedItem } from "../feed/FeedItem";
import { TimelineSlot } from "../feed/Timeline";
import { PhoneBar } from "../../components/shell/PhoneBar";

// The research service is read in the browser through the same-origin gateway.
type Row = Record<string, any>;
type Dashboard = {
  posts: Row[];
  scores: Record<string, Row>;
  sources: Row[];
  activity: Row[];
  ideas: Row[];
  trends: Row[];
  reports: Row[];
  hot: Row[];
  threshold: number;
  thresholdVersion?: number;
  generatedAt: string;
};
const names: Record<string, string> = {
  home: "投研看板",
  picks: "研究评分",
  feed: "全部动态",
  post: "帖子",
  ideas: "投资 Idea",
  trends: "趋势跟踪",
  reports: "研究日报",
  hot: "24 小时热点",
  topics: "研究主题",
  bookmarks: "研究收藏",
  saved: "研究收藏",
  sources: "关注来源",
  admin: "研究设置",
};
const list = (value: unknown): Row[] => (Array.isArray(value) ? value : []);
const stamp = (value: unknown) => {
  const s = String(value || "");
  const n = Date.parse(s);
  return Number.isFinite(n) && s.length > 10
    ? beijingStamp(n)
    : s || "时间未知";
};
const href = (page: string, id?: unknown) =>
  `/research/#${page}${id == null ? "" : `/${encodeURIComponent(String(id))}`}`;
const safeURL = (url: unknown) => {
  try {
    const u = new URL(String(url));
    return ["http:", "https:"].includes(u.protocol) ? u.href : undefined;
  } catch {
    return undefined;
  }
};
const statusNames: Record<string, string> = {
  unconfigured: "待配置",
  backfilling: "回补中",
  "catching-up": "补读中",
  empty: "已查无新增",
  ok: "读取成功",
  error: "读取失败",
  failed: "读取失败",
  partial: "部分读取",
  unavailable: "存在不可读记录",
  awaiting: "待补读",
};
const sourceStatus = (source: Row) =>
  statusNames[source.status] ||
  (source.error
    ? "读取失败"
    : source.lastSuccess || source.lastSuccessAt
      ? "已核对"
      : "待核对");
const savedKey = "techbuzz-saved:/research/";
function readSaved(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(savedKey) || "[]");
    return Array.isArray(value)
      ? value.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}
function Save({ type, id }: { type: string; id: unknown }) {
  const key = `${type}/${id}`;
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(readSaved().includes(key)), [key]);
  return (
    <button
      type="button"
      aria-pressed={saved}
      className="text-[13px] text-accent hover:underline"
      onClick={() => {
        const entries = readSaved();
        const next = entries.includes(key)
          ? entries.filter((x) => x !== key)
          : [...entries, key];
        try {
          localStorage.setItem(savedKey, JSON.stringify(next));
          setSaved(next.includes(key));
        } catch {
          /* Storage can be unavailable. */
        }
      }}
    >
      {saved ? "已收藏" : "收藏"}
    </button>
  );
}
function External({
  url,
  children,
}: {
  url: unknown;
  children: React.ReactNode;
}) {
  const target = safeURL(url);
  return target ? (
    <a
      href={target}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent hover:underline"
    >
      {children}
    </a>
  ) : null;
}
function Post({
  post,
  data,
  detail = false,
}: {
  post: Row;
  data: Dashboard;
  detail?: boolean;
}) {
  const [original, setOriginal] = useState(false);
  const rating = data.scores?.[post.id] || {};
  const text = original
    ? post.text || post.excerpt
    : post.textZh || post.text || post.excerpt;
  const at = post.publishedAt || data.generatedAt;
  const item: FeedItemSummary = {
    id: String(post.nativeArticleId || post.id),
    title: rating.event || post.article?.title || String(post.text || "").split("\n")[0]?.slice(0, 100) || post.handle || "帖子",
    summary: text || null,
    reason: rating.reason || null,
    source: { name: post.authorName || `@${post.handle || "未知来源"}` },
    publishedAt: post.publishedAt || null,
    timelineAt: at,
    category: null,
    tags: Array.isArray(rating.topics) ? rating.topics : [],
    score: Number.isFinite(rating.score) ? rating.score : null,
    selected:
      Number.isFinite(rating.score) && rating.score >= (data.threshold ?? 70),
    channel: "x",
    x: {
      authorName: post.authorName || post.handle || "未知来源",
      handle: post.handle || "",
      avatarUrl: null,
      media: [],
      article: !!post.article?.text,
      quoted: post.quoted
        ? {
            authorName: post.quoted.authorName || post.quoted.handle || "",
            handle: post.quoted.handle || "",
            text: post.quoted.text || "",
            translation: post.quotedTextZh || null,
          }
        : null,
    },
  };
  const target = post.nativeArticleId
    ? `/items/${encodeURIComponent(post.nativeArticleId)}`
    : href("post", post.id);
  return (
    <div>
      <ol>
        <TimelineSlot at={at}>
          <FeedItem
            item={item}
            at={at}
            targetTo={target}
            scoreLabel="研究评分"
            reasonLabel="评分依据"
            star={<Save type="post" id={post.id} />}
          />
        </TimelineSlot>
      </ol>
      {!detail && post.nativeArticleId && (
        <Link to={href("post", post.id)} className="text-sm text-accent">研究详情与评分</Link>
      )}
      {detail && (
        <div className="pb-5 text-[14px] leading-relaxed text-ink-2">
          {post.textZh && (
            <button
              type="button"
              className="my-2 text-accent"
              onClick={() => setOriginal(!original)}
            >
              {original ? "查看翻译" : "查看原文"}
            </button>
          )}
          <p className="whitespace-pre-wrap">{text}</p>
          {["quoted", "replyTo", "repostOf"].map(
            (k) =>
              post[k] && (
                <div
                  key={k}
                  className="mt-3 rounded-control border border-line p-3 text-ink-3"
                >
                  {k === "quoted"
                    ? "引用"
                    : k === "replyTo"
                      ? "回复上文"
                      : "转发"}
                  ：{post[k].handle && `@${post[k].handle} `}
                  {k === "quoted" && !original && post.quotedTextZh
                    ? post.quotedTextZh
                    : post[k].text || post[k].excerpt || ""}{" "}
                  <External url={post[k].url}>原帖</External>
                </div>
              ),
          )}
          {post.article?.text && (
            <section className="mt-5">
              <h2 className="font-semibold text-ink">
                {post.article.title || "原帖附带长文"}
              </h2>
              <p className="mt-2 whitespace-pre-wrap">{post.article.text}</p>
              <External url={post.article.url}>查看原文附带文章</External>
            </section>
          )}
          {[...list(post.media), ...list(post.article?.media)].map(
            (media, index) => {
              const url = safeURL(
                typeof media === "string"
                  ? media
                  : media.url || media.previewUrl || media.preview_image_url,
              );
              return url ? (
                <div key={index} className="mt-3">
                  {(typeof media === "string" || media.kind === "image") && (
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      <img
                        loading="lazy"
                        className="max-h-[500px] max-w-full rounded-control object-contain"
                        src={url}
                        alt={media.alt || `附件 ${index + 1}`}
                      />
                    </a>
                  )}
                  <External url={url}>查看附件 {index + 1}</External>
                </div>
              ) : null;
            },
          )}
          {rating.breakdown && (
            <section className="mt-5">
              <h2 className="font-semibold text-ink">评分明细</h2>
              <p className="mt-2">
                影响 {rating.breakdown.impact ?? "—"}/35 · 信息增量{" "}
                {rating.breakdown.novelty ?? "—"}/25 · 可验证性{" "}
                {rating.breakdown.verification ?? "—"}/25 · 跟踪价值{" "}
                {rating.breakdown.followUp ?? "—"}/15
              </p>
              {rating.reason && <p className="mt-2">{rating.reason}</p>}
            </section>
          )}
          <div className="mt-3">
            <External url={post.url}>打开 X 原帖</External>
          </div>
        </div>
      )}
    </div>
  );
}
function Item({ item, type }: { item: Row; type: string }) {
  return (
    <article className="border-b border-line-soft py-4 last:border-0">
      <Link
        to={href(type, item.id)}
        className="font-semibold text-ink hover:text-accent"
      >
        {item.title || names[type]}
      </Link>
      {item.summary && (
        <p className="mt-2 text-[14px] leading-relaxed text-ink-3">
          {item.summary}
        </p>
      )}
      <div className="mt-2 text-[12px] text-ink-4">
        {stamp(item.date || item.asOf || item.updatedAt)} ·{" "}
        {list(item.evidence).length} 条证据
      </div>
    </article>
  );
}
function Threshold({
  data,
  update,
}: {
  data: Dashboard;
  update: (n: number) => void;
}) {
  const [value, setValue] = useState(String(data.threshold ?? 70));
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Section title="精选设置">
      <p className="text-sm text-ink-3">
        当前阈值 {data.threshold ?? 70} 分
        {data.thresholdVersion ? ` · 规则版本 ${data.thresholdVersion}` : ""}
        。调整阈值用于筛选精选及 Idea。
      </p>
      <form
        className="mt-3 flex flex-wrap items-end gap-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMessage("");
          try {
            const response = await fetch("/api/admin/threshold", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ threshold: Number(value) }),
            });
            if (!response.ok)
              throw new Error(
                response.status === 403 || response.status === 401
                  ? "管理令牌无效"
                  : `保存失败（HTTP ${response.status}）`,
              );
            const result = await response.json();
            update(result.threshold);
            setToken("");
            setMessage("阈值已保存，规则版本请刷新后查看。");
          } catch (error) {
            setMessage(error instanceof Error ? error.message : "保存失败");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="text-sm text-ink-3">
          评分阈值
          <input
            aria-label="评分阈值"
            type="number"
            min="0"
            max="100"
            step="1"
            required
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 block w-28 rounded-control border border-line bg-surface px-3 py-2 text-ink"
          />
        </label>
        <label className="text-sm text-ink-3">
          管理令牌
          <input
            aria-label="管理令牌"
            type="password"
            autoComplete="off"
            required
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="mt-1 block rounded-control border border-line bg-surface px-3 py-2 text-ink"
          />
        </label>
        <button
          disabled={busy}
          className="rounded-control bg-accent px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          保存阈值
        </button>
        <span role="status" className="text-sm text-ink-3">
          {message}
        </span>
      </form>
    </Section>
  );
}
function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-7">
      <h2 className="mb-2 text-[17px] font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}
function Evidence({ ids, data }: { ids: unknown; data: Dashboard }) {
  return (
    <>
      {list(ids).map((value, i) => {
        const id = String(value?.id ?? value?.postId ?? value);
        const post = data.posts.find((p) => String(p.id) === id);
        return post ? (
          <Post key={`${id}-${i}`} post={post} data={data} />
        ) : (
          <p key={`${id}-${i}`} className="py-2 text-sm text-ink-4">
            证据 {id} 未收录
          </p>
        );
      })}
    </>
  );
}
function Detail({
  type,
  item,
  data,
}: {
  type: string;
  item: Row;
  data: Dashboard;
}) {
  const fields: [string, string][] = [
    ["投资假设", "thesis"],
    ["已知事实", "facts"],
    ["作者观点", "authorView"],
    ["研究推断", "inference"],
    ["趋势阶段", "stage"],
    ["催化剂", "catalyst"],
    ["风险", "risk"],
    ["失效条件", "invalidation"],
    ["下一步核对", "watchNext"],
  ];
  return (
    <>
      <p className="mt-2 text-sm text-ink-4">
        {stamp(item.date || item.updatedAt)}{" "}
        {item.asOf && `· 证据截至 ${stamp(item.asOf)}`}
      </p>
      {item.summary && (
        <p className="mt-4 leading-relaxed text-ink-2">{item.summary}</p>
      )}
      <div className="mt-4">
        <Save type={type} id={item.id} />
      </div>
      {fields.some(([, k]) => item[k]?.length) && (
        <Section title="研究要点">
          {fields.map(([label, key]) =>
            item[key]?.length ? (
              <p
                key={key}
                className="border-b border-line-soft py-3 text-[14px] leading-relaxed text-ink-2"
              >
                <strong>{label}：</strong>
                {Array.isArray(item[key]) ? item[key].join("、") : item[key]}
              </p>
            ) : null,
          )}
        </Section>
      )}
      {list(item.sections).map((s, i) => (
        <Section key={i} title={s.title || "研究摘要"}>
          <p className="leading-relaxed text-ink-2">{s.summary}</p>
          <Evidence ids={s.evidence} data={data} />
        </Section>
      ))}
      {list(item.timeline).length > 0 && (
        <Section title="趋势演进">
          {list(item.timeline).map((entry, i) => (
            <div key={i} className="border-b border-line-soft py-3">
              <p className="text-xs text-ink-4">
                {stamp(entry.date || entry.updatedAt)}
              </p>
              <p className="mt-2 text-sm text-ink-2">{entry.summary}</p>
              <Evidence ids={entry.evidence} data={data} />
            </div>
          ))}
        </Section>
      )}
      <Section title="支持证据">
        {list(item.evidence).length ? (
          <Evidence ids={item.evidence} data={data} />
        ) : (
          <p className="text-sm text-ink-4">暂无关联原帖。</p>
        )}
      </Section>
      {list(item.counterEvidence).length > 0 && (
        <Section title="反证">
          <Evidence ids={item.counterEvidence} data={data} />
        </Section>
      )}
      {list(item.history).length > 0 && (
        <Section title="研究修订">
          {list(item.history).map((entry, i) => (
            <div key={i} className="border-b border-line-soft py-3">
              <p className="text-xs text-ink-4">
                {stamp(entry.generatedAt || entry.date || entry.updatedAt)}
              </p>
              <p className="mt-2 text-sm text-ink-2">{entry.summary}</p>
              <Evidence ids={entry.evidence} data={data} />
              <Evidence ids={entry.counterEvidence} data={data} />
            </div>
          ))}
        </Section>
      )}
    </>
  );
}
export function Research({
  initial,
  embedded = false,
}: {
  initial?: "picks" | "feed";
  embedded?: boolean;
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState(false);
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const [limit, setLimit] = useState(30);
  const [activityLimit, setActivityLimit] = useState(30);
  useEffect(() => {
    const controller = new AbortController();
    let reading = false;
    async function refresh() {
      if (document.hidden || reading) return;
      reading = true;
      try {
        const response = await fetch("/api/dashboard", { signal: controller.signal });
        if (!response.ok) throw new Error("unavailable");
        const next = await response.json();
        if (!Array.isArray(next.posts)) throw new Error("invalid");
        if (!controller.signal.aborted) {
          setData(next);
          setError(false);
        }
      } catch {
        if (!controller.signal.aborted) setError(true);
      } finally {
        reading = false;
      }
    }
    void refresh();
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    setSaved(readSaved());
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      controller.abort();
    };
  }, []);
  const [hashPath, hashQuery = ""] = location.hash.slice(1).split("?");
  const [hashPage, encodedId] = (hashPath || "home").split("/");
  const page = initial || hashPage || "home";
  let id = "";
  try {
    id = decodeURIComponent(encodedId || "");
  } catch {
    /* malformed old link */
  }
  const params = new URLSearchParams(initial ? location.search : hashQuery);
  const selectedSource = params.get("source")?.replace(/^@/, "").toLowerCase();
  const needle = (query || params.get("q") || "").trim().toLowerCase();
  const topic = params.get("topic");
  const company = params.get("company");
  useEffect(() => {
    setLimit(30);
    setActivityLimit(30);
  }, [page, location.search, location.hash, query]);
  useEffect(() => {
    if (!initial && page === "feed" && !hashQuery) navigate("/all", { replace: true });
    if (!initial && page === "agent") navigate("/agent", { replace: true });
    if (!initial && page === "about") navigate("/about", { replace: true });
  }, [initial, page, hashQuery, navigate]);
  const title = names[page] || "投研看板";
  const rows = data
    ? list(data.posts)
        .filter(
          (p) =>
            (!selectedSource ||
              String(p.handle || "").toLowerCase() === selectedSource) &&
            (!params.get("date") || beijingDate(p.publishedAt) === params.get("date")) &&
            (params.get("period") !== "24" || Date.parse(p.publishedAt) >= Date.parse(data.generatedAt) - 86_400_000) &&
            (!topic || (data.scores?.[p.id]?.topics || []).includes(topic)) &&
            (!company ||
              (data.scores?.[p.id]?.companies || []).includes(company)) &&
            (!needle ||
              [p.text, p.textZh, p.article?.title, p.article?.text, p.excerpt, p.handle, data.scores?.[p.id]?.summary].some(
                (x) =>
                  String(x || "")
                    .toLowerCase()
                    .includes(needle),
              )) &&
            (page !== "picks" ||
              Number(data.scores?.[p.id]?.score) >= (data.threshold ?? 70)),
        )
        .sort((a, b) =>
          page === "picks"
            ? (data.scores?.[b.id]?.score || 0) -
              (data.scores?.[a.id]?.score || 0)
            : Date.parse(b.publishedAt || "") - Date.parse(a.publishedAt || ""),
        )
    : [];
  const group =
    data && ["ideas", "trends", "reports", "hot"].includes(page)
      ? list(data[page as "ideas" | "trends" | "reports" | "hot"])
      : [];
  const item = id ? group.find((x) => String(x.id) === id) : undefined;
  const post =
    id && data ? data.posts.find((p) => String(p.id) === id) : undefined;
  const heading = item?.title || (page === "post" ? "帖子摘录" : title);
  return (
    <div className="mx-auto max-w-[var(--page-max-reading)] pb-8">
      {!embedded && (
        <>
          <PhoneBar title={heading} large />
          <h1 className="hidden pb-3 pt-1 text-[24px] font-bold text-ink lg:block">
            {heading}
          </h1>
        </>
      )}
      {error && data && <p role="status" className="py-2 text-sm text-ink-3">刷新失败，当前显示上次成功读取的数据。</p>}
      {error && !data ? (
        <p className="py-8 text-ink-3">
          研究数据暂时无法加载，请稍后刷新重试。
        </p>
      ) : !data ? (
        <p className="py-8 text-ink-4">正在加载研究数据…</p>
      ) : (
        <>
          {(page === "picks" || page === "feed" || page === "topics") && (
            <>
              <p className="mb-3 text-sm text-ink-4">
                {page === "picks"
                  ? `研究评分达到 ${data.threshold ?? 70} 分的帖子`
                  : "关注账号的帖子，按发布时间排列"}
              </p>
              <div className="mb-3 flex flex-wrap gap-4 text-sm">
                <Link className="text-accent" to="/">
                  精选
                </Link>
                <Link className="text-accent" to="/all">
                  全部动态
                </Link>
                <Link className="text-accent" to={href("sources")}>
                  关注来源
                </Link>
              </div>
              <input
                aria-label="搜索帖子"
                placeholder="搜索帖子或来源"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink"
              />
              {rows.length ? (
                rows
                  .slice(0, limit)
                  .map((p) => <Post key={p.id} post={p} data={data} />)
              ) : (
                <p className="py-8 text-sm text-ink-4">暂无符合条件的帖子。</p>
              )}
              {rows.length > limit && (
                <button
                  type="button"
                  className="my-4 rounded-control border border-line px-4 py-2 text-sm text-accent"
                  onClick={() => setLimit((n) => n + 30)}
                >
                  加载更多（已显示 {limit} / {rows.length}）
                </button>
              )}
              {page === "feed" && list(data.activity).length > 0 && (
                <Section title="转发观察">
                  <p className="text-xs text-ink-4">
                    按首次观察时间记录，转发时间未知，不计入发帖时间线或研究评分。
                  </p>
                  {list(data.activity)
                    .filter(
                      (a) =>
                        !selectedSource ||
                        String(a.source).toLowerCase() === selectedSource,
                    )
                    .slice(0, activityLimit)
                    .map((a, i) => (
                      <article
                        key={i}
                        className="border-b border-line-soft py-4 text-sm"
                      >
                        <p className="font-semibold text-ink">
                          @{a.source} 转发 · 原作者 @{a.author || "未知"}
                        </p>
                        <p className="mt-1 text-xs text-ink-4">
                          原帖发布 {stamp(a.publishedAt)} · 首次观察{" "}
                          {stamp(a.firstSeenAt)}
                        </p>
                        <p className="mt-2 text-ink-3">{a.body}</p>
                        <External url={a.url}>查看原帖</External>
                      </article>
                    ))}
                  {list(data.activity).filter(
                    (a) =>
                      !selectedSource ||
                      String(a.source).toLowerCase() === selectedSource,
                  ).length > activityLimit && (
                    <button
                      type="button"
                      className="my-4 rounded-control border border-line px-4 py-2 text-sm text-accent"
                      onClick={() => setActivityLimit((n) => n + 30)}
                    >
                      加载更多转发
                    </button>
                  )}
                </Section>
              )}
            </>
          )}
          {page === "home" && (
            <>
              <p className="text-sm text-ink-4">
                跟踪关注账号的新信息、投资假设和产业变化。更新于{" "}
                {stamp(data.generatedAt)}
              </p>
              <Section title="最新研究日报">
                {list(data.reports).length ? (
                  <Item item={data.reports[0]} type="reports" />
                ) : (
                  <p className="text-sm text-ink-4">等待首期研究日报。</p>
                )}
              </Section>
              <Section title="最新研究">
                {[
                  ...list(data.ideas)
                    .slice(0, 3)
                    .map((item) => ({ item, type: "ideas" })),
                  ...list(data.trends)
                    .slice(0, 3)
                    .map((item) => ({ item, type: "trends" })),
                ].map(({ item, type }) => (
                  <Item key={`${type}-${item.id}`} item={item} type={type} />
                ))}
              </Section>
              <Section title="关注来源">
                {list(data.sources).map((s) => (
                  <p
                    key={s.handle}
                    className="border-b border-line-soft py-2 text-sm"
                  >
                    <Link
                      className="text-accent"
                      to={`${href("feed")}?source=${encodeURIComponent(s.handle)}`}
                    >
                      @{s.handle}
                    </Link>{" "}
                    <span className="text-ink-4">{sourceStatus(s)}</span>
                  </p>
                ))}
              </Section>
            </>
          )}
          {["ideas", "trends", "reports", "hot"].includes(page) &&
            (id ? (
              item ? (
                <Detail type={page} item={item} data={data} />
              ) : (
                <p className="py-6 text-ink-4">未找到该条目。</p>
              )
            ) : group.length ? (
              <>
                {group.slice(0, limit).map((x) => (
                  <Item key={x.id} item={x} type={page} />
                ))}
                {group.length > limit && (
                  <button
                    type="button"
                    className="my-4 rounded-control border border-line px-4 py-2 text-sm text-accent"
                    onClick={() => setLimit((n) => n + 30)}
                  >
                    加载更多（已显示 {limit} / {group.length}）
                  </button>
                )}
              </>
            ) : (
              <p className="py-6 text-ink-4">当前没有可查看的条目。</p>
            ))}
          {page === "post" &&
            (post ? (
              <Post post={post} data={data} detail />
            ) : (
              <p className="py-6 text-ink-4">未找到该帖子。</p>
            ))}
          {page === "admin" && (
            <Threshold
              data={data}
              update={(threshold) => setData({ ...data, threshold })}
            />
          )}
          {["sources", "admin"].includes(page) &&
            list(data.sources).map((s) => (
              <article
                key={s.handle}
                className="border-b border-line-soft py-4 text-sm"
              >
                <Link
                  to={`${href("feed")}?source=${encodeURIComponent(s.handle)}`}
                  className="font-semibold text-accent"
                >
                  @{s.handle}
                </Link>
                <p className="mt-1 text-ink-3">
                  {sourceStatus(s)} · 最近成功{" "}
                  {stamp(s.lastSuccess || s.lastSuccessAt)} · 最近尝试{" "}
                  {stamp(s.lastAttempt || s.lastChecked || s.checkedAt)}
                </p>
                <p className="mt-1 text-ink-4">
                  观察范围 {stamp(s.coverageStart)} 至 {stamp(s.coverageEnd)} ·
                  采集 {s.postCount || 0} 条 · 样本 {s.sampleCount || 0} 条 ·
                  待处理 {s.pendingCount || 0} 条 · 明确不可读{" "}
                  {s.unavailableCount || 0} 条
                </p>
                {(s.error || s.message || s.pageState) && (
                  <p className="mt-1 text-ink-4">
                    {String(
                      s.error?.message || s.error || s.message || s.pageState,
                    )}
                  </p>
                )}
              </article>
            ))}
          {["bookmarks", "saved"].includes(page) &&
            (saved.length ? (
              saved.map((key) => {
                const slash = key.indexOf("/");
                const type = key.slice(0, slash);
                const id = key.slice(slash + 1);
                const found =
                  type === "post"
                    ? data.posts.find((p) => String(p.id) === id)
                    : list(data[type as "ideas"]).find(
                        (p) => String(p.id) === id,
                      );
                return found ? (
                  type === "post" ? (
                    <Post key={key} post={found} data={data} />
                  ) : (
                    <Item key={key} item={found} type={type} />
                  )
                ) : (
                  <p key={key} className="py-3 text-sm text-ink-4">
                    {key} 未收录于当前数据。
                  </p>
                );
              })
            ) : (
              <p className="py-6 text-sm text-ink-4">
                你还没有收藏帖子或研究。
              </p>
            ))}
        </>
      )}
    </div>
  );
}
