import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export class Store {
  constructor(path = ":memory:") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS records (
        kind TEXT NOT NULL, id TEXT NOT NULL, project_id TEXT NOT NULL, body TEXT NOT NULL,
        PRIMARY KEY(kind,id)
      );
      CREATE INDEX IF NOT EXISTS records_project ON records(project_id,kind);
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
        project_id TEXT NOT NULL, body TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_project ON events(project_id,seq);
      CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, digest TEXT NOT NULL, body TEXT NOT NULL);
      PRAGMA user_version=1;`);
  }
  get(kind, id) {
    const row = this.db
      .prepare("SELECT body FROM records WHERE kind=? AND id=?")
      .get(kind, id);
    return row ? JSON.parse(row.body) : null;
  }
  list(kind, project) {
    const rows = project
      ? this.db
          .prepare(
            "SELECT body FROM records WHERE kind=? AND project_id=? ORDER BY rowid",
          )
          .all(kind, project)
      : this.db
          .prepare("SELECT body FROM records WHERE kind=? ORDER BY rowid")
          .all(kind);
    return rows.map((r) => JSON.parse(r.body));
  }
  put(kind, record) {
    this.db
      .prepare(
        "INSERT INTO records(kind,id,project_id,body) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET project_id=excluded.project_id,body=excluded.body",
      )
      .run(
        kind,
        record.id,
        record.project_id || record.id,
        JSON.stringify(record),
      );
    return record;
  }
  event(event) {
    const result = this.db
      .prepare("INSERT INTO events(id,project_id,body) VALUES(?,?,?)")
      .run(event.id, event.project_id, JSON.stringify(event));
    return { ...event, seq: Number(result.lastInsertRowid) };
  }
  events(project, after = 0, limit = 60, latest = false) {
    const rows = this.db
      .prepare(
        `SELECT seq,body FROM events WHERE project_id=? AND seq>? ORDER BY seq ${latest ? "DESC" : "ASC"} LIMIT ?`,
      )
      .all(project, after, limit);
    if (latest) rows.reverse();
    return rows.map((row) => ({ ...JSON.parse(row.body), seq: row.seq }));
  }
  receipt(id) {
    return this.db.prepare("SELECT * FROM receipts WHERE id=?").get(id);
  }
  saveReceipt(id, digest, result) {
    this.db
      .prepare("INSERT INTO receipts VALUES(?,?,?)")
      .run(id, digest, JSON.stringify(result));
  }
  afterCommit(callback) {
    if (this.commitCallbacks) this.commitCallbacks.push(callback);
    else callback();
  }
  transaction(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    this.commitCallbacks = [];
    let result, callbacks;
    try {
      result = fn();
      this.db.exec("COMMIT");
      callbacks = this.commitCallbacks;
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.commitCallbacks = null;
      throw error;
    }
    this.commitCallbacks = null;
    for (const callback of callbacks)
      try {
        callback();
      } catch (error) {
        console.error("Relayboard event subscriber:", error.message);
      }
    return result;
  }
  close() {
    this.db.close();
  }
}
