import { useMemo, useSyncExternalStore } from "react";
import { getStarred, KEYS, readJson, removeStar, watchStarred, writeRaw } from "../../lib/local-state";
import { postLookup, reportDate, type Dashboard } from "./data";

export const RESEARCH_SAVED = "techbuzz-research-saved";
const LEGACY_RESEARCH_SAVED = ["techbuzz-saved:/", "techbuzz-saved:/research/"];
const aliases: Record<string, string> = { posts: "post", item: "post", items: "post", idea: "ideas", trend: "trends", report: "reports", daily: "reports" };

const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
const empty: string[] = [];
let snapshot = empty;
const listeners = new Set<() => void>();

export function savedKey(raw: string, data: Dashboard, posts = postLookup(data)): string {
  const slash = raw.indexOf("/");
  if (slash === -1) return raw;
  const prefix = raw.slice(0, slash);
  const id = raw.slice(slash + 1);
  const kind = Object.hasOwn(aliases, prefix) ? aliases[prefix]! : prefix;
  if (kind === "post") return `post/${posts.get(id)?.id ?? id}`;
  if (kind === "reports") return `reports/${id.replace(/^report-/, "")}`;
  return `${kind}/${id}`;
}

export function mergeSaved(data: Dashboard, values: string[], nativeIds: string[] = []) {
  const posts = postLookup(data);
  return [...new Set([...values, ...nativeIds.map((id) => `post/${id}`)].map((key) => savedKey(key, data, posts)))];
}

function read() {
  const next = [
    ...strings(readJson(RESEARCH_SAVED)),
    ...LEGACY_RESEARCH_SAVED.flatMap((key) => strings(readJson(key))),
    ...getStarred().map(({ id }) => `post/${id}`),
  ];
  if (next.length !== snapshot.length || next.some((id, i) => id !== snapshot[i])) snapshot = next;
  return snapshot;
}

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const stop = watchStarred(listener);
  function onStorage(event: StorageEvent) {
    if (event.key === null || event.key === RESEARCH_SAVED || event.key === KEYS.starred || LEGACY_RESEARCH_SAVED.includes(event.key)) listener();
  }
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    stop();
    window.removeEventListener("storage", onStorage);
  };
}

/** Keep old keys readable. Copy their entries first, and clear an entry from every store only on removal. */
export function removeSaved(key: string, data: Dashboard) {
  const posts = postLookup(data);
  const matches = (raw: string) => savedKey(raw, data, posts) === key;
  for (const storageKey of [RESEARCH_SAVED, ...LEGACY_RESEARCH_SAVED]) {
    const current = strings(readJson(storageKey));
    const next = current.filter((raw) => !matches(raw));
    if (next.length !== current.length) writeRaw(storageKey, JSON.stringify(next));
  }
  for (const { id } of getStarred()) {
    if (matches(`post/${id}`)) removeStar(id);
  }
  notify();
}

export function toggleSaved(key: string, data: Dashboard) {
  const merged = mergeSaved(data, read());
  if (merged.includes(key)) removeSaved(key, data);
  else if (writeRaw(RESEARCH_SAVED, JSON.stringify([...merged, key]))) notify();
}

export function useSaved(data: Dashboard) {
  const entries = useSyncExternalStore(subscribe, read, () => empty);
  return useMemo(() => mergeSaved(data, entries), [data, entries]);
}

export function getSavedEntry(key: string, data: Dashboard, lookup = postLookup(data)) {
  const slash = key.indexOf("/");
  const kind = key.slice(0, slash);
  const id = key.slice(slash + 1);
  if (kind === "post") {
    const post = lookup.get(id);
    if (post) return { kind, item: post } as const;
  } else if (kind === "ideas" || kind === "trends" || kind === "reports") {
    const item = data[kind].find((item) => item.id === id || (kind === "reports" && reportDate(item) === id));
    if (item) return { kind, item } as const;
  }
  return null;
}
