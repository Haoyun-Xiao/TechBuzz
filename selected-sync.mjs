import { createHash, randomUUID } from 'node:crypto';
import { integer, PublicationError, publicItem } from './publication.mjs';

const MAX_TOKEN = 512;
const PREFIX = 'rs1.';
const projection = (item, fields) => fields === 'default' ? item : {
  id: item.id, postId: item.postId, title: item.title, source: item.source, publishedAt: item.publishedAt,
  discoveredAt: item.discoveredAt, activityAt: item.activityAt, timeBasis: item.timeBasis, category: item.category,
  score: item.score, selected: item.selected, links: { techbuzz: item.links.techbuzz },
};
const idOf = row => `post:${row.postId}`;
const token = value => PREFIX + Buffer.from(JSON.stringify(value)).toString('base64url');
const reset = () => new PublicationError(409, 'snapshot_required', '先从 /api/v1/selected/snapshot 重新获取精选快照。');

export function selectedSyncReader(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS research_public_sync_epoch (value TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS research_public_selected (id TEXT PRIMARY KEY, revision TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS research_public_changes (seq INTEGER PRIMARY KEY, id TEXT NOT NULL, op TEXT NOT NULL, changed_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS research_public_changes_id_seq ON research_public_changes (id, seq);`);
  db.prepare(`INSERT INTO research_public_sync_epoch(value)
    SELECT ? WHERE NOT EXISTS (SELECT 1 FROM research_public_sync_epoch)`).run(randomUUID());
  const epoch = db.prepare('SELECT value FROM research_public_sync_epoch').get().value;
  const state = db.prepare('SELECT id, revision FROM research_public_selected');
  const watermark = db.prepare('SELECT coalesce(max(seq), 0) AS seq FROM research_public_changes');
  const insert = db.prepare('INSERT INTO research_public_changes(id, op, changed_at) VALUES (?, ?, ?)');
  const remove = db.prepare('DELETE FROM research_public_selected WHERE id = ?');
  const write = db.prepare('INSERT INTO research_public_selected VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision');
  const snapshotPage = db.prepare(`SELECT id FROM research_public_changes AS old
    WHERE seq = (SELECT max(seq) FROM research_public_changes WHERE id = old.id AND seq <= ?)
      AND op = 'upsert' AND id > ? AND id IN (SELECT id FROM research_public_selected)
    ORDER BY id LIMIT ?`);
  const changePage = db.prepare('SELECT seq, id, op, changed_at FROM research_public_changes WHERE seq > ? ORDER BY seq LIMIT ?');

  function decode(value, kind, maxSeq) {
    try {
      if (value.length > MAX_TOKEN || !value.startsWith(PREFIX)) throw reset();
      const data = JSON.parse(Buffer.from(value.slice(PREFIX.length), 'base64url').toString());
      if (data.kind !== kind || data.epoch !== epoch || !Number.isSafeInteger(data.seq) || data.seq < 0 || data.seq > maxSeq
        || !['default','minimal'].includes(data.fields)) throw reset();
      return data;
    } catch {
      throw reset();
    }
  }

  return function readSelected(snapshot, params, siteUrl, changes) {
    const limit = integer(params.get('limit'), 'limit', 1, changes ? 100 : 1000, changes ? 100 : 500);
    const selected = new Map(snapshot.featured.map(row => {
      const id = idOf(row);
      return [id, { ...publicItem(row, snapshot.scores[row.postId], ''), activityId: row.id, id }];
    }));
    const render = (id, fields) => {
      const item = selected.get(id);
      return projection({ ...item, links: { ...item.links, techbuzz: siteUrl + item.links.techbuzz } }, fields);
    };
    db.exec('BEGIN IMMEDIATE');
    try {
      const previous = new Map(state.all().map(row => [row.id, row.revision]));
      for (const [id, item] of selected) {
        const revision = createHash('sha256').update(JSON.stringify(item)).digest('base64url');
        if (previous.get(id) === revision) continue;
        write.run(id, revision);
        insert.run(id, 'upsert', snapshot.generatedAt);
      }
      for (const id of previous.keys()) {
        if (selected.has(id)) continue;
        remove.run(id);
        insert.run(id, 'remove', snapshot.generatedAt);
      }
      const maxSeq = watermark.get().seq;
      db.exec('COMMIT');
      const syncCursor = (seq, fields) => token({ kind: 'sync', epoch, seq, fields });
      if (changes) {
        const old = decode(params.get('cursor') ?? '', 'sync', maxSeq);
        const all = changePage.all(old.seq, limit + 1);
        const page = all.slice(0, limit);
        const results = page.map(row => row.op === 'remove' || !selected.has(row.id)
          ? { op: 'remove', changedAt: row.changed_at, id: row.id }
          : { op: 'upsert', changedAt: row.changed_at, item: render(row.id, old.fields) });
        return { schemaVersion: 1, fields: old.fields, cursor: syncCursor(page.at(-1)?.seq ?? old.seq, old.fields),
          count: results.length, hasMore: all.length > limit, changes: results };
      }
      const supplied = params.get('fields');
      let fields = supplied ?? 'default';
      if (!['default','minimal'].includes(fields)) throw new PublicationError(400, 'invalid_request', 'fields 必须是 default 或 minimal。');
      let seq = maxSeq, asOf = snapshot.generatedAt, after = '';
      if (params.has('page')) {
        const saved = decode(params.get('page'), 'page', maxSeq);
        if (!/^post:\d+$/.test(saved.after) || !Number.isFinite(Date.parse(saved.asOf))) throw reset();
        if (supplied && saved.fields !== supplied) throw new PublicationError(400, 'invalid_cursor', 'page 游标与 fields 不匹配。');
        ({ seq, asOf, after, fields } = saved);
      }
      const all = snapshotPage.all(seq, after, limit + 1);
      const page = all.slice(0, limit);
      const hasMore = all.length > limit;
      return { schemaVersion: 1, fields, asOf, cursor: syncCursor(seq, fields), count: page.length, hasMore,
        nextPage: hasMore ? token({ kind: 'page', epoch, seq, fields, asOf, after: page.at(-1).id }) : null,
        items: page.map(({ id }) => render(id, fields)) };
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw error;
    }
  };
}
