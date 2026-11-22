import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export function openStore(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,title TEXT,created TEXT,updated TEXT);
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,session TEXT,role TEXT,text TEXT,status TEXT,sources TEXT,created TEXT);
    CREATE TABLE IF NOT EXISTS receipts(id INTEGER PRIMARY KEY,session TEXT,message TEXT,kind TEXT,detail TEXT,elapsed INTEGER,created TEXT);`);
  db.exec("UPDATE messages SET status='interrupted' WHERE status='running'");
  const now = () => new Date().toISOString();
  return {
    db,
    list: () => db.prepare('SELECT * FROM sessions ORDER BY updated DESC').all(),
    create(title = '新研究') { const id = randomUUID(), at = now(); db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(id,title,at,at); return this.get(id); },
    get(id) { const s = db.prepare('SELECT * FROM sessions WHERE id=?').get(id); return s ? { ...s, messages: db.prepare('SELECT * FROM messages WHERE session=? ORDER BY rowid').all(id).map(m => ({ ...m, sources: JSON.parse(m.sources) })) } : null; },
    add(session, role, text, status='complete') { const id = randomUUID(); db.prepare('INSERT INTO messages VALUES(?,?,?,?,?,?,?)').run(id,session,role,text,status,'[]',now()); db.prepare('UPDATE sessions SET updated=? WHERE id=?').run(now(),session); if(role==='user') db.prepare("UPDATE sessions SET title=? WHERE id=? AND title='新研究'").run(text.slice(0,60),session); return id; },
    update(id,text,status,sources=[]) { db.prepare('UPDATE messages SET text=?,status=?,sources=? WHERE id=?').run(text,status,JSON.stringify(sources),id); },
    receipt(session,message,kind,detail,elapsed) { db.prepare('INSERT INTO receipts(session,message,kind,detail,elapsed,created) VALUES(?,?,?,?,?,?)').run(session,message,kind,JSON.stringify(detail),elapsed,now()); },
  };
}
