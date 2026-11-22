import { data } from "react-router";
import { loadOr404 } from "../../lib/api.server";
import { postLookup, type Dashboard, type ResearchEntry } from "./data";

export const researchEnabled = () => Boolean(process.env.TECHBUZZ_RESEARCH_URL);

export const researchPage = <T extends object>(value: T) => data(value, { headers: { "Cache-Control": "no-store" } });

export const loadResearch = (request: Request) =>
  loadOr404<Dashboard>("/api/site/research", { signal: request.signal });


export function evidenceSubset(data: Dashboard, ids: string[]) {
  const lookup = postLookup(data);
  const posts = [...new Set(ids.flatMap((id) => {
    const post = lookup.get(id);
    return post ? [post] : [];
  }))];
  return { posts, scores: Object.fromEntries(posts.flatMap((post) => data.scores[post.id] ? [[post.id, data.scores[post.id]]] : [])) };
}

export function entryEvidence(entry: ResearchEntry) {
  return [
    ...(entry.changeEvidence ?? []),
    ...(entry.evidence ?? []),
    ...(entry.counterEvidence ?? []),
    ...([...(entry.sections ?? []), ...(entry.timeline ?? []), ...(entry.history ?? [])]).flatMap((row) => [...(row.evidence ?? []), ...(row.counterEvidence ?? [])]),
  ];
}

export function entryCards(entries: ResearchEntry[]) {
  return entries.map(({ id, title, summary, date, asOf, updatedAt, generatedAt, evidence, maturity, change, status, sourceIdeaId, stage }) => ({
    id, title, summary, date, asOf, updatedAt, generatedAt, evidence, maturity, change, status, sourceIdeaId, stage,
  }));
}

export { directoryTopics } from "./directory";
