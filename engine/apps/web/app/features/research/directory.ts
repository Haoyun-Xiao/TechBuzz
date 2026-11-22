import catalogue from "../../../../../industry/topics.json";
import { ENTITIES } from "@techbuzz/industry/taxonomy";
import type { Dashboard } from "./data";

/** Present the configured directory. Free-form research labels still resolve on old detail links. */
export function directoryTopics(dashboard: Dashboard) {
  const normalize = (s: string) => s.normalize("NFKC").toLowerCase().replace(/^[\s$]+|\s+/g, "");
  const distributors = new Map(dashboard.activities.map(row => [row.postId, row.distributors.length]));
  return catalogue.topics.filter(t => t.group === "company" || t.group === "field").map(t => {
    const group = t.group === "company" ? "company" as const : "issue" as const;
    const entity = t.entityId ? ENTITIES[t.entityId] : undefined;
    const names = new Set([t.name, t.slug, ...(t.tags ?? []), ...(entity?.aliases ?? []), entity?.name ?? ""].filter(Boolean).map(normalize));
    const postIds = [...new Set(dashboard.topics.filter(x => x.group === group && names.has(normalize(x.name))).flatMap(x => x.postIds))];
    return { name: t.name, group, postIds, count: postIds.length, propagationCount: postIds.reduce((n, id) => n + (distributors.get(id) ?? 0), 0) };
  }).filter(t => t.count > 0);
}
