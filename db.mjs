import { DatabaseSync } from 'node:sqlite';
import { initCollector } from './collector.mjs';
import { initResearch } from './research.mjs';

export function openDatabase(path = process.env.TECHBUZZ_DB || '/data/techbuzz.sqlite') {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA busy_timeout = 15000; PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  initCollector(db);
  initResearch(db);
  return db;
}
