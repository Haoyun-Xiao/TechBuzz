import { useEffect, useState } from "react";
import { Link } from "react-router";
import { IconClose } from "../../components/icons";
import { EmptyState } from "../../components/ui/Page";
import { useStarred } from "../../lib/local-state";
import type { SavedLookup } from "../../routes/starred-lookup";
import { postLookup, type Dashboard } from "./data";
import { Heading, PostCard } from "./Posts";
import { EntryCard } from "./ResearchViews";
import { getSavedEntry, mergeSaved, removeSaved, useSaved } from "./saved";

const BATCH = 100;

export function ResearchStarred({ base }: { base: Dashboard }) {
  const [mounted, setMounted] = useState(false);
  const [request, setRequest] = useState<{ key: string; data?: Dashboard; error?: boolean }>();
  const native = useStarred();
  const keys = useSaved(base);
  const key = JSON.stringify(keys);
  useEffect(() => setMounted(true), []);
  useEffect(() => {
    if (key === "[]") return;
    const controller = new AbortController();
    const ids: string[] = JSON.parse(key);
    const batches: string[][] = [];
    for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH).filter((id) => id.length <= 300));
    Promise.all(batches.filter((batch) => batch.length > 0).map(async (batch) => {
      const response = await fetch("/starred/lookup", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(batch), signal: controller.signal,
      });
      if (!response.ok) throw new Error("收藏查找失败");
      return response.json() as Promise<SavedLookup>;
    })).then((results) => {
      if (!controller.signal.aborted) setRequest({ key, data: {
        ...base,
        posts: results.flatMap((result) => result.posts),
        scores: Object.assign({}, ...results.map((result) => result.scores)),
        ideas: results.flatMap((result) => result.ideas),
        trends: results.flatMap((result) => result.trends),
        reports: results.flatMap((result) => result.reports),
      } });
    }).catch(() => { if (!controller.signal.aborted) setRequest({ key, error: true }); });
    return () => controller.abort();
  }, [base, key]);
  const data = request?.data ?? base;
  const saved = mergeSaved(data, keys);
  const lookup = postLookup(data);
  return <div className="mx-auto max-w-[var(--page-max-reading)] pb-8">
    <Heading title="收藏" />
    <p className="mb-4 rounded-tile border border-line bg-surface px-4 py-2.5 text-[13px] text-ink-3">收藏保存在当前浏览器。</p>
    {mounted && (keys.length === 0 ? <EmptyState title="还没有收藏" action={<Link className="text-accent hover:underline" to="/featured">浏览精选</Link>} /> : (
      <>
        {request?.key !== key && !request?.data && <p role="status" className="py-3 text-sm text-ink-4">正在查找收藏…</p>}
        {request?.key === key && request.error && <p role="status" className="py-3 text-sm text-hot">暂时无法查找收藏。刷新页面后重试。</p>}
        {(request?.data || request?.key === key) && <ul className="space-y-2">
          {[...saved].reverse().map((entry) => {
            const result = getSavedEntry(entry, data, lookup);
            if (result?.kind === "post") {
              return <li key={entry}><PostCard post={result.item} data={data} saved={saved} fullTime /></li>;
            }
            if (result) return <li key={entry}><EntryCard type={result.kind} item={result.item} data={data} saved={saved} /></li>;
            const old = entry.startsWith("post/") ? native.find((item) => item.id === entry.slice(5)) : undefined;
            return <li key={entry} className="card flex items-start gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 className="break-words text-sm font-medium text-ink">{old?.title || entry}</h2>
                {old?.summary && <p className="mt-1 line-clamp-2 text-sm text-ink-3">{old.summary}</p>}
                {request?.key === key && !request.error && <p className="mt-1 text-[12px] text-ink-4">未收录于当前数据</p>}
              </div>
              <button aria-label="取消收藏" type="button" onClick={() => removeSaved(entry, data)} className="grid size-9 shrink-0 place-items-center rounded-full text-ink-4 hover:bg-bg-sunk hover:text-ink"><IconClose size={15} /></button>
            </li>;
          })}
        </ul>}
      </>
    ))}
  </div>;
}
