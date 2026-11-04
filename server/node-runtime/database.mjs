// Production SQLite adapter for the same queries used by the Worker handler.
import { DatabaseSync } from "node:sqlite";
export class SQLiteD1 {
  constructor(path) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
  }
  prepare(sql) {
    const db = this.db;
    let values = [];
    return {
      bind(...args) {
        values = args;
        return this;
      },
      first(column) {
        const row = db.prepare(sql).get(...values);
        return row ? (column ? row[column] : row) : null;
      },
      all() {
        return { results: db.prepare(sql).all(...values) };
      },
      run() {
        const r = db.prepare(sql).run(...values);
        return { success: true, meta: { changes: Number(r.changes) } };
      },
    };
  }
  // No await inside a transaction: another HTTP request cannot interleave writes.
  batch(statements) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const rows = statements.map((s) => s.run());
      this.db.exec("COMMIT");
      return rows;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}
