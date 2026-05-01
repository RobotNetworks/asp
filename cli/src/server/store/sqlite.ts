import { DatabaseSync } from "node:sqlite";

/**
 * Open (or create) the ASP SQLite database at the given path and apply all
 * schema migrations. Returns the open database handle.
 *
 * Idempotent: safe to call every time the server starts. Each migration is
 * gated on the user_version pragma so it only runs once.
 */
export function openDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);

  // WAL mode: better concurrent read performance; crash-safe.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  applyMigrations(db);
  return db;
}

const MIGRATIONS: Array<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS agents (
        handle      TEXT PRIMARY KEY,
        token       TEXT NOT NULL UNIQUE,
        policy      TEXT NOT NULL DEFAULT 'allowlist',
        allowlist   TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id            TEXT PRIMARY KEY,
        state         TEXT NOT NULL DEFAULT 'active',
        topic         TEXT,
        created_at    INTEGER NOT NULL,
        ended_at      INTEGER,
        next_sequence INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS participants (
        session_id    TEXT NOT NULL,
        handle        TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'invited',
        has_joined    INTEGER NOT NULL DEFAULT 0,
        joined_at     INTEGER,
        left_at       INTEGER,
        left_sequence INTEGER,
        PRIMARY KEY (session_id, handle)
      );

      CREATE TABLE IF NOT EXISTS session_events (
        event_id   TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        sequence   INTEGER NOT NULL,
        type       TEXT NOT NULL,
        payload    TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (session_id, sequence)
      );

      CREATE INDEX IF NOT EXISTS idx_session_events_session
        ON session_events (session_id, sequence);
    `,
  },
  {
    version: 2,
    sql: `
      DROP TABLE IF EXISTS contacts;
    `,
  },
];

/**
 * Truncate all application tables without dropping the schema. Used by the
 * admin reset endpoint to wipe all agents, sessions, and events from a
 * running network so it starts from a clean state.
 */
export function resetDatabase(db: DatabaseSync): void {
  db.exec(`
    BEGIN;
    DELETE FROM session_events;
    DELETE FROM participants;
    DELETE FROM sessions;
    DELETE FROM agents;
    COMMIT;
  `);
}

function applyMigrations(db: DatabaseSync): void {
  const current = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  const pending = MIGRATIONS.filter((m) => m.version > current);
  for (const migration of pending) {
    db.exec(migration.sql);
    db.exec(`PRAGMA user_version = ${migration.version}`);
  }
}
