import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createExtensionDatabase } from "../src/main/extension-database";

describe("extension database", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  function memoryDb() {
    return createExtensionDatabase(":memory:");
  }

  it("runs DDL via exec and reads rows back with query", () => {
    const db = memoryDb();
    db.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)");
    db.run("INSERT INTO notes (body) VALUES (?)", ["hello"]);

    expect(db.query("SELECT body FROM notes")).toEqual([{ body: "hello" }]);
    db.close();
  });

  it("returns insert metadata from run", () => {
    const db = memoryDb();
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER)");

    const result = db.run("INSERT INTO t (n) VALUES (?)", [7]);

    expect(result.changes).toBe(1);
    expect(Number(result.lastInsertRowid)).toBe(1);
    db.close();
  });

  it("returns a single row or undefined from get", () => {
    const db = memoryDb();
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, n INTEGER)");
    db.run("INSERT INTO t (n) VALUES (5)");

    expect(db.get("SELECT n FROM t WHERE id = ?", [1])).toEqual({ n: 5 });
    expect(db.get("SELECT n FROM t WHERE id = ?", [99])).toBeUndefined();
    db.close();
  });

  it("supports named parameters via an object", () => {
    const db = memoryDb();
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    db.run("INSERT INTO t (name) VALUES (:name)", { name: "ada" });

    expect(db.get("SELECT name FROM t WHERE name = :name", { name: "ada" })).toEqual({ name: "ada" });
    db.close();
  });

  it("commits a transaction and rolls back on throw", () => {
    const db = memoryDb();
    db.exec("CREATE TABLE t (n INTEGER)");

    db.transaction(() => {
      db.run("INSERT INTO t (n) VALUES (1)");
      db.run("INSERT INTO t (n) VALUES (2)");
    });
    expect(db.query("SELECT n FROM t")).toHaveLength(2);

    expect(() =>
      db.transaction(() => {
        db.run("INSERT INTO t (n) VALUES (3)");
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(db.query("SELECT n FROM t")).toHaveLength(2); // rolled back

    db.close();
  });

  it("persists to disk across reopen and creates the parent directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "baby-menu-db-"));
    tempDirs.push(dir);
    const dbPath = join(dir, "nested", "baby-menu.db");

    const first = createExtensionDatabase(dbPath);
    first.exec("CREATE TABLE t (n INTEGER)");
    first.run("INSERT INTO t (n) VALUES (42)");
    first.close();

    expect(existsSync(dbPath)).toBe(true);

    const second = createExtensionDatabase(dbPath);
    expect(second.get("SELECT n FROM t")).toEqual({ n: 42 });
    second.close();
  });
});
