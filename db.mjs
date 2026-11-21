import { DatabaseSync } from 'node:sqlite';
import { initCollector } from './collector.mjs';
import { initResearch } from './research.mjs';

export function openDatabase(path = process.env.TECHBUZZ_DB || '/data/techbuzz.sqlite') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 15000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  initCollector(db);
  initResearch(db);
  db.exec(`CREATE TABLE IF NOT EXISTS x_activity (
    source_id TEXT NOT NULL, tweet_id TEXT NOT NULL, kind TEXT NOT NULL,
    author TEXT, url TEXT, published_at TEXT, first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL, body TEXT,
    PRIMARY KEY (source_id, tweet_id, kind)
  )`);
  if (!db.prepare('PRAGMA table_info(x_activity)').all().some(column => column.name === 'observed_at')) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!db.prepare('PRAGMA table_info(x_activity)').all().some(column => column.name === 'observed_at')) {
        db.exec('ALTER TABLE x_activity ADD COLUMN observed_at TEXT');
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  return db;
}
