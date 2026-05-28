import "./suppress-sqlite-warning";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { StatementSync } from "node:sqlite";
import type { BabyMenuDatabase, SqlParams, SqlRunResult } from "../shared/contracts";

// Load node:sqlite through require rather than a static import. A static import is
// hoisted above the warning-suppressor side-effect when bundled, so the experimental
// warning would fire before it could be filtered; a require runs in body order, after.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

// The shared, local SQLite store for all extensions. node:sqlite is compiled into
// Electron's bundled Node, so there is no native dependency and nothing to build for
// the universal package. It is synchronous and runs in the main process, so queries
// must stay small - push heavy work into a background task that writes results back.
export type ExtensionDatabase = BabyMenuDatabase & {
  close: () => void;
};

function bindArgs(params?: SqlParams): unknown[] {
  if (params === undefined) return [];
  return Array.isArray(params) ? params : [params];
}

export function createExtensionDatabase(databasePath: string): ExtensionDatabase {
  if (databasePath !== ":memory:") mkdirSync(dirname(databasePath), { recursive: true });

  const db = new DatabaseSync(databasePath);
  // WAL keeps reads and writes from blocking each other; busy_timeout avoids
  // immediate "database is locked" errors under brief contention.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");

  const prepare = (sql: string): StatementSync => db.prepare(sql);
  // node:sqlite accepts either positional values or a single named-parameter object.
  // bindArgs already normalizes to that arg list; cast to each method's tuple type.
  type AllArgs = Parameters<StatementSync["all"]>;
  type GetArgs = Parameters<StatementSync["get"]>;
  type RunArgs = Parameters<StatementSync["run"]>;

  return {
    query<T = Record<string, unknown>>(sql: string, params?: SqlParams): T[] {
      return prepare(sql).all(...(bindArgs(params) as AllArgs)) as T[];
    },
    get<T = Record<string, unknown>>(sql: string, params?: SqlParams): T | undefined {
      return prepare(sql).get(...(bindArgs(params) as GetArgs)) as T | undefined;
    },
    run(sql: string, params?: SqlParams): SqlRunResult {
      const result = prepare(sql).run(...(bindArgs(params) as RunArgs));
      return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
    },
    exec(sql: string): void {
      db.exec(sql);
    },
    transaction<T>(fn: () => T): T {
      db.exec("BEGIN");
      try {
        const result = fn();
        db.exec("COMMIT");
        return result;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    close(): void {
      db.close();
    },
  };
}
