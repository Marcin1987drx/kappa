import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Create data directory if it doesn't exist
const dataDir = join(__dirname, '../../data');
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

const dbPath = join(dataDir, 'kappaplannung.db');

let db: SqlJsDatabase;

async function initDatabase() {
  const SQL = await initSqlJs();
  
  // Load existing database or create new one
  if (existsSync(dbPath)) {
    const buffer = readFileSync(dbPath);
    db = new SQL.Database(buffer);
    console.log('✅ Database loaded from:', dbPath);
  } else {
    db = new SQL.Database();
    console.log('✅ New database created');
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS parts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS tests (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      type_id TEXT NOT NULL,
      part_id TEXT NOT NULL,
      test_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS project_weeks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      week TEXT NOT NULL,
      ist INTEGER DEFAULT 0,
      soll INTEGER DEFAULT 0,
      UNIQUE(project_id, week)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Create indexes
  db.run(`CREATE INDEX IF NOT EXISTS idx_projects_customer ON projects(customer_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_projects_type ON projects(type_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_projects_test ON projects(test_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_project_weeks_project ON project_weeks(project_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_project_weeks_week ON project_weeks(week)`);

  // Save database to disk
  saveDatabase();
  
  console.log('✅ Database initialized at:', dbPath);
}

function saveDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  writeFileSync(dbPath, buffer);
}

// Auto-save every 5 seconds if there are changes
setInterval(() => {
  if (db) {
    saveDatabase();
  }
}, 5000);

// Helper functions for cleaner API
export function runQuery(sql: string, params: any[] = []): void {
  db.run(sql, params);
  saveDatabase();
}

export function getOne<T>(sql: string, params: any[] = []): T | undefined {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject() as T;
    stmt.free();
    return row;
  }
  stmt.free();
  return undefined;
}

export function getAll<T>(sql: string, params: any[] = []): T[] {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

export { db, initDatabase, saveDatabase };
