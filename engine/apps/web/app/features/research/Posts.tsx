import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { FeedItemSummary, MediaView } from "@techbuzz/contracts/site";
import { beijingDate } from "@techbuzz/contracts/time";
import { IconBookmark, IconArrowUpRight } from "../../components/icons";
import { PhoneBar, type BackTarget } from "../../components/shell/PhoneBar";
import { Badge } from "../../components/ui/Badge";
import { EmptyState } from "../../components/ui/Page";
import { ScoreLabel } from "../../components/ui/Score";
import { SourceAvatar } from "../../components/ui/SourceAvatar";
import { FeedItem } from "../feed/FeedItem";
import { DayHeader, TimelineSlot } from "../feed/Timeline";
import { kindLabel, postLookup, postPath, postTitle, safeURL, stamp, type Activity, type Dashboard, type Media, type Post, type ReferencedPost } from "./data";
import { toggleSaved } from "./saved";

export function Heading({ title, back }: { title: string; back?: BackTarget }) {
  return <>
    <PhoneBar title={title} back={back} />
    <h1 data-page-title="" className="pb-4 pt-1 text-[30px] font-bold leading-[1.25] tracking-[-0.01em] text-ink lg:text-[24px] lg:font-semibold">{title}</h1>
  </>;
}

export function SaveButton({ entry, saved, data }: { entry: string; saved: string[]; data: Dashboard }) {
  const on = saved.includes(entry);
  return <button
    type="button"
    aria-pressed={on}
    aria-label={on ? "取消收藏" : "收藏"}
    title={on ? "取消收藏" : "收藏"}
    onClick={() => toggleSaved(entry, data)}
    className={`relative z-10 grid size-11 place-items-center rounded-full transition-colors hover:bg-bg-sunk lg:size-[28px] ${on ? "text-accent" : "text-ink-4"}`}
  >
    <IconBookmark size={18} filled={on} />
  </button>;
}

export function External({ url, children }: { url?: string | null; children: ReactNode }) {
  const href = safeURL(url);
  return href ? <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
    {children}<IconArrowUpRight size={12} />
  </a> : null;
}

const hasTranslation = (post: Post) => Boolean(
  (post.text && post.textZh && post.textZh !== post.text) || (post.quoted?.text && post.quotedTextZh && post.quotedTextZh !== post.quoted.text),
);

function LanguageButton({ original, onChange }: { original: boolean; onChange: () => void }) {
  return <button type="button" onClick={onChange} className="font-medium text-accent hover:underline">{original ? "查看译文" : "查看原文"}</button>;
}

function imagePreviews(media: Media[] = []): MediaView[] {
  return media.flatMap((item) => {
    const image = typeof item === "string" || item.kind === "image";
    const url = safeURL(typeof item === "string" ? item : item.previewUrl || item.preview_image_url || (image ? item.url : undefined));
    return url ? [{
      kind: image ? "image" : "video", url, width: null, height: null, poster: null,
      alt: typeof item === "string" ? null : item.alt ?? null,
    }] : [];
  });
}

export function PostCard({ post, activity, data, saved, at, fullTime }: {
  post: Post; activity?: Activity; data: Dashboard; saved: string[]; at?: string; fullTime?: boolean;
}) {
  const [original, setOriginal] = useState(false);
  const score = data.scores[post.id];
  const kind = activity?.kind ?? post.kind ?? "original";
  const handle = activity?.handle || post.handle;
  const name = activity?.kind === "repost" ? handle : post.authorName || handle;
  const author = activity?.originalAuthor || post.repostOf?.handle || post.quoted?.handle;
  const distributors = activity?.distributors ?? data.featured.find((row) => row.postId === post.id)?.distributors ?? [];
  const item: FeedItemSummary = {
    id: post.id,
    title: postTitle(post, score),
    summary: (original ? post.text : post.textZh) || post.text || post.excerpt || post.article?.title || null,
    reason: score?.reason ?? null,
    source: { name },
    publishedAt: post.publishedAt ?? null,
    timelineAt: activity?.activityAt || post.publishedAt || "",
    category: null,
    tags: [],
    score: activity ? activity.score : score?.score ?? null,
    selected: activity?.featured ?? data.featured.some((row) => row.postId === post.id),
    channel: "x",
    x: {
      authorName: name,
      handle,
      avatarUrl: activity?.kind === "repost" ? null : safeURL(post.avatarUrl) ?? null,
      media: imagePreviews(post.media),
      article: !!post.article?.text,
      quoted: post.quoted ? {
        authorName: post.quoted.authorName || post.quoted.handle || "",
        handle: post.quoted.handle || "",
        text: post.quoted.text || "",
        translation: original ? null : post.quotedTextZh ?? null,
      } : null,
    },
  };
  const details = (
    <div className="relative z-10 mt-2 flex w-fit max-w-full flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-ink-4">
      <Badge>{kindLabel(kind)}</Badge>
      {activity?.category && <Link to={`/all?category=${encodeURIComponent(activity.category)}`} className="hover:text-accent">{activity.category}</Link>}
      {activity?.timeBasis === "unknown" && kind === "repost" && <span>转发时间未知</span>}
      {activity?.timeBasis === "observed" && <span title="增量采集时首次观察到的时间">首次观察{fullTime ? ` ${stamp(activity.activityAt)}` : "时间"}</span>}
      {fullTime && activity?.timeBasis !== "observed" && (activity?.activityAt || post.publishedAt) && (
        <span>{activity?.timeBasis === "unknown" && "原帖发布 "}{stamp(activity?.activityAt || post.publishedAt)}</span>
      )}
      {author && author.toLowerCase() !== handle.toLowerCase() && <span>原作者 @{author}</span>}
      {distributors.length > 0 && <span>传播账号 {distributors.map((name) => `@${name}`).join("、")}</span>}
      {hasTranslation(post) && <LanguageButton original={original} onChange={() => setOriginal(!original)} />}
    </div>
  );
  const activityQuery = activity?.kind === "repost" ? `?activity=${encodeURIComponent(activity.id)}` : "";
  return <FeedItem item={item} at={at} targetTo={postPath(post.id) + activityQuery}
    scoreLabel="研究评分" reasonLabel="评分依据" details={details}
    star={<SaveButton entry={`post/${post.id}`} data={data} saved={saved} />} />;
}

function ThreadReply({ post, index, total }: { post: Post; index: number; total: number }) {
  const [original, setOriginal] = useState(false);
  return <li className="px-4 py-3">
    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-ink-3"><span>{index}/{total}</span>
      <Link className="text-accent hover:underline" to={postPath(post.id)}>@{post.handle} · {stamp(post.publishedAt)}</Link>
      {hasTranslation(post) && <LanguageButton original={original} onChange={() => setOriginal(!original)} />}
    </div>
    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">{(!original && post.textZh) || post.text || post.article?.text || post.excerpt}</p>
    <Context label="引用" post={post.quoted} text={original ? undefined : post.quotedTextZh} />
  </li>;
}

function ThreadStack({ parts, data, saved }: { parts: Activity[]; data: Dashboard; saved: string[] }) {
  const [open, setOpen] = useState(false);
  const first = parts[0]!;
  return <div className="relative isolate mb-2">
    {!open && <div aria-hidden="true" className="pointer-events-none absolute inset-x-2 -bottom-1.5 top-2 -z-10 rounded-xl border border-line bg-surface shadow-sm after:absolute after:inset-x-2 after:-bottom-1 after:h-1 after:rounded-b-xl after:border after:border-line after:bg-surface" />}
    <div className="rounded-xl border border-line bg-surface">
      <PostCard activity={first} post={first.post} data={data} saved={saved} fullTime />
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="block w-full rounded-b-xl border-t border-line px-4 py-2.5 text-left text-sm font-medium text-accent hover:bg-bg-sunk">
        {open ? "收起串帖" : "展开串帖"} · {parts.length} 条 <span aria-hidden="true">{open ? "⌃" : "⌄"}</span>
      </button>
      {open && <ol start={2} className="divide-y divide-line border-t border-line">
        {parts.slice(1).map(({ post }, i) => <ThreadReply key={post.id} post={post} index={i + 2} total={parts.length} />)}
      </ol>}
    </div>
  </div>;
}

export function PostList({ rows, data, saved, timeline = true, threads = {} }: { rows: Activity[]; data: Dashboard; saved: string[]; timeline?: boolean; threads?: Record<string, Activity[]> }) {
  const card = (row: Activity) => threads[row.id]
    ? <ThreadStack parts={threads[row.id]!} data={data} saved={saved} />
    : <PostCard activity={row} post={row.post} data={data} saved={saved} at={timeline ? row.activityAt ?? undefined : undefined} fullTime={!timeline} />;
  if (!timeline) return <div className="divide-y divide-line-soft lg:space-y-3 lg:divide-y-0">{rows.map((row) => (
    <div key={row.id} className="py-3 lg:py-0">{card(row)}</div>
  ))}</div>;
  const days = new Map<string, Activity[]>();
  for (const row of rows) {
    const day = row.activityAt ? beijingDate(row.activityAt) : "";
    if (!day) continue;
    const matches = days.get(day) ?? [];
    matches.push(row);
    days.set(day, matches);
  }
  return <div className="space-y-4 lg:space-y-6">
    {[...days].map(([day, group]) => (
      <section key={day}>
        <DayHeader day={day} today={beijingDate(data.generatedAt)} count={group.length} />
        <ol>{group.map((row) => <TimelineSlot key={row.id} at={row.activityAt!} dataKey={row.id}>
          {card(row)}
        </TimelineSlot>)}</ol>
      </section>
    ))}
  </div>;
}

function Context({ label, post, text }: { label: string; post?: ReferencedPost; text?: string }) {
  if (!post) return null;
  return <section className="mt-4 rounded-tile border border-line bg-surface p-4">
    <h2 className="text-sm font-semibold">{label}{post.handle ? ` · @${post.handle}` : ""}</h2>
    {(text || post.text || post.excerpt) && <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-2">{text || post.text || post.excerpt}</p>}
    {post.url && <div className="mt-2 text-sm"><External url={post.url}>打开上文</External></div>}
  </section>;
}

export function PostDetail({ post, activity, data, saved }: { post: Post; activity?: Activity; data: Dashboard; saved: string[] }) {
  const [original, setOriginal] = useState(false);
  const score = data.scores[post.id];
  const relevant = data.activities.filter((row) => row.postId === post.id);
  const distributors = [...new Set([...relevant.flatMap((row) => row.distributors), ...(activity?.distributors ?? [])])];
  const published = post.publishedAt ? stamp(post.publishedAt) : "发布时间未知";
  const kind = activity?.kind ?? post.kind ?? "original";
  const text = (original ? post.text : post.textZh) || post.text || post.excerpt;
  return <div className="mx-auto max-w-[var(--page-max-reading)] pb-10">
    <Heading title={postTitle(post, score)} back={{ to: "/all", label: "全部动态" }} />
    <article className="mt-3 text-[15px] leading-[1.8] text-ink-2">
      <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3 text-[13px] text-ink-4">
        <SourceAvatar name={post.handle} iconUrl={null} size={24} />
        <Link to={`/all?account=${encodeURIComponent(post.handle)}`} className="font-medium text-ink hover:text-accent">@{post.handle}</Link>
        <span>{published}</span>
        <Badge>{kindLabel(kind)}</Badge>
        {score && <ScoreLabel score={score.score ?? null} label="研究评分" />}
        <span className="ml-auto"><SaveButton entry={`post/${post.id}`} data={data} saved={saved} /></span>
      </div>
      {activity?.kind === "repost" && <p className="mt-3 text-sm text-ink-3">
        @{activity.handle} 转发 · {activity.timeBasis === "unknown" ? "转发时间未知" : activity.timeBasis === "observed" ? `首次观察 ${stamp(activity.activityAt)}` : stamp(activity.activityAt)}
        {activity.originalAuthor && ` · 原作者 @${activity.originalAuthor}`}
      </p>}
      {distributors.length > 0 && <p className="mt-3 flex flex-wrap items-center gap-x-2 text-sm text-ink-3">
        传播账号 {distributors.map((handle) => <Link key={handle} to={`/all?account=${encodeURIComponent(handle)}`} className="text-accent hover:underline">@{handle}</Link>)}
      </p>}
      {hasTranslation(post) && <div className="mt-4 text-sm"><LanguageButton original={original} onChange={() => setOriginal(!original)} /></div>}
      {text ? <p className="mt-4 whitespace-pre-wrap break-words">{text}</p> : <p className="mt-4 text-sm text-ink-4">正文暂不可读</p>}
      {activity?.category && <p className="mt-2 text-sm"><Link to={`/all?category=${encodeURIComponent(activity.category)}`} className="text-accent hover:underline">{activity.category}</Link></p>}
      {data.posts.length > 1 && <details className="mt-4 rounded-tile border border-line p-4">
        <summary className="cursor-pointer font-semibold">同串帖子（{data.posts.length} 条，共用一次评分）</summary>
        <ol className="mt-2 space-y-3">{[...data.posts].sort((a,b) => (a.publishedAt ?? "").localeCompare(b.publishedAt ?? "") || a.id.localeCompare(b.id)).map(part =>
          <li key={part.id}><Link className="text-accent" to={postPath(part.id)}>@{part.handle} · {stamp(part.publishedAt)}</Link>
            <p className="whitespace-pre-wrap">{(!original && part.textZh) || part.text}</p></li>)}</ol>
      </details>}
      <Context label="引用" post={post.quoted} text={original ? undefined : post.quotedTextZh} />
      <Context label="回复上文" post={post.replyTo} />
      <Context label="转发原帖" post={post.repostOf} />
      {post.article?.text && <section className="mt-5">
        <h2 className="font-semibold text-ink">{post.article.title || "原帖附带长文"}</h2>
        <p className="mt-2 whitespace-pre-wrap">{post.article.text}</p>
        <External url={post.article.url}>打开附带长文</External>
      </section>}
      {[...(post.media ?? []), ...(post.article?.media ?? [])].map((media, index) => {
        const url = safeURL(typeof media === "string" ? media : media.url || media.previewUrl || media.preview_image_url);
        if (!url) return null;
        return <div key={`${url}-${index}`} className="mt-3">
          {(typeof media === "string" || media.kind === "image") && <a href={url} target="_blank" rel="noopener noreferrer">
            <img loading="lazy" className="max-h-[500px] max-w-full rounded-control object-contain" src={url} alt={typeof media === "string" ? `附件 ${index + 1}` : media.alt || `附件 ${index + 1}`} />
          </a>}
          <External url={url}>打开附件 {index + 1}</External>
        </div>;
      })}
      {score && <section className="mt-6 border-t border-line pt-4">
        <h2 className="font-semibold text-ink">研究评分</h2>
        {score.breakdown && <p className="mt-2 text-sm text-ink-3">
          影响 {score.breakdown.impact ?? "—"}/35 · 信息增量 {score.breakdown.novelty ?? "—"}/25 ·
          可验证性 {score.breakdown.verification ?? "—"}/25 · 跟踪价值 {score.breakdown.followUp ?? "—"}/15
        </p>}
        {score.reason && <p className="mt-2">{score.reason}</p>}
      </section>}
      {post.url && <div className="mt-5"><External url={post.url}>打开 X 原帖</External></div>}
    </article>
  </div>;
}

export function Evidence({ ids, data }: { ids?: string[]; data: Dashboard }) {
  const posts = postLookup(data);
  if (!ids?.length) return <EmptyState title="暂无关联原帖" />;
  return <ul className="mt-2 divide-y divide-line-soft">
    {ids.map((id, index) => {
      const post = posts.get(id);
      return <li key={`${id}-${index}`} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm text-ink-3">
        {post ? <>
          <Link to={postPath(post.id)} className="min-w-0 flex-1 font-medium text-ink hover:text-accent">{postTitle(post, data.scores[post.id])}</Link>
          <span className="shrink-0">@{post.handle}</span>
          <External url={post.url}>X 原帖</External>
          {post.quoted?.url && <External url={post.quoted.url}>被引原文{post.quoted.handle ? ` · @${post.quoted.handle}` : ""}</External>}
        </> : <span>证据 {id} 未收录</span>}
      </li>;
    })}
  </ul>;
}
