import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { GameState } from './state';

/**
 * Persistence: one row per game holding its JSON state. Live GPS fixes are never
 * written here — only reveal snapshots (which hunters were already shown) are stored,
 * and they are purged by the retention policy.
 */
export class GameStore {
  private db: DatabaseSync;
  private upsert;
  private del;

  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS games_expires ON games(expires_at);
    `);
    this.migrate();
    this.upsert = this.db.prepare(`
      INSERT INTO games (id, code, status, state, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET code=excluded.code, status=excluded.status, state=excluded.state,
        updated_at=excluded.updated_at, expires_at=excluded.expires_at`);
    this.del = this.db.prepare('DELETE FROM games WHERE id = ?');
  }

  /**
   * Schema migrations. Bump SCHEMA_VERSION and add a step when the table layout changes.
   * (Changes to the game-state JSON are handled by `GameState.v` in loadAll.)
   */
  private migrate() {
    const SCHEMA_VERSION = 1;
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    let v = row.user_version;
    if (v > SCHEMA_VERSION) throw new Error(`Database schema v${v} is newer than this server (v${SCHEMA_VERSION})`);
    // if (v < 2) { this.db.exec('ALTER TABLE games ADD COLUMN …'); v = 2; }
    if (v < SCHEMA_VERSION) {
      v = SCHEMA_VERSION;
      this.db.exec(`PRAGMA user_version = ${v}`);
    }
  }

  save(game: GameState, expiresAt: number) {
    this.upsert.run(game.id, game.code, game.status, JSON.stringify(game), game.updatedAt, expiresAt);
  }

  delete(id: string) {
    this.del.run(id);
  }

  codeExists(code: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM games WHERE code = ?').get(code);
  }

  loadAll(now: number): GameState[] {
    this.db.prepare('DELETE FROM games WHERE expires_at < ?').run(now);
    const rows = this.db.prepare('SELECT state FROM games').all() as { state: string }[];
    const out: GameState[] = [];
    for (const r of rows) {
      try {
        const g = JSON.parse(r.state) as GameState;
        if (g.v === 1) out.push(g); // future: upgrade older state versions here
      } catch (err) {
        console.error('Skipping unreadable game row', err);
      }
    }
    return out;
  }

  close() {
    this.db.close();
  }
}
