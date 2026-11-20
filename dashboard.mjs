import { posts, sources } from './collector.mjs';
import { research } from './research.mjs';

// Count a repeated quotation once, while preserving its different distributors.
export function rankEvents(rows, scores, now) {
  const groups = new Map();
  const dayAgo = now.valueOf() - 86400000;
  for (const post of rows) {
    const published = Date.parse(post.publishedAt);
    if (published < dayAgo || published > now.valueOf()) continue;
    const event = scores[post.id]?.event?.trim();
    if (!event) continue;
    const key = event.normalize('NFKC').toLowerCase();
    if (!groups.has(key)) groups.set(key, { id: key, title: event, authors: new Set(), origins: new Map(), evidence: [], updatedAt: post.publishedAt });
    const group = groups.get(key);
    group.authors.add(post.handle);
    const origin = post.evidenceKey || post.originId || post.id;
    if (!group.origins.has(origin)) group.origins.set(origin, post.quoted?.handle || post.handle);
    group.evidence.push(post.id);
    if (published > Date.parse(group.updatedAt)) group.updatedAt = post.publishedAt;
  }
  return [...groups.values()].filter(g => g.authors.size > 1).map(g => ({
    id: g.id, title: g.title, independentCount: new Set(g.origins.values()).size,
    sourceCount: g.authors.size, postCount: g.evidence.length, evidence: g.evidence, updatedAt: g.updatedAt
  })).sort((a,b) => b.independentCount - a.independentCount || b.updatedAt.localeCompare(a.updatedAt));
}

export function dashboard(db, now = new Date()) {
  db.exec('BEGIN');
  try {
    const rows = posts(db);
    const analysis = research(db);
    return { ...analysis, name: 'TechBuzz', mode: 'live', generatedAt: now.toISOString(),
      sources: sources(db), posts: rows, hot: rankEvents(rows, analysis.scores, now) };
  } finally {
    db.exec('COMMIT');
  }
}
