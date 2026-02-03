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

  // Employee tables
  db.run(`
    CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      firstName TEXT NOT NULL,
      lastName TEXT NOT NULL,
      color TEXT,
      status TEXT DEFAULT 'available',
      suggestedShift TEXT,
      created_at INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS schedule_assignments (
      id TEXT PRIMARY KEY,
      employeeId TEXT NOT NULL,
      projectId TEXT NOT NULL,
      testId TEXT,
      week TEXT NOT NULL,
      shift INTEGER DEFAULT 1,
      scope TEXT DEFAULT 'project',
      note TEXT,
      created_at INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      entityType TEXT,
      entityName TEXT,
      details TEXT,
      timestamp INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL,
      week TEXT NOT NULL,
      text TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    )
  `);

  // User preferences table (replaces localStorage)
  db.run(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // Schedule templates
  db.run(`
    CREATE TABLE IF NOT EXISTS schedule_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    )
  `);

  // ==================== ABSENCE MANAGEMENT ====================
  
  // Absence types configuration (typy nieobecności z limitami domyślnymi)
  db.run(`
    CREATE TABLE IF NOT EXISTS absence_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT,
      color TEXT,
      defaultDays INTEGER DEFAULT 0,
      isPaid INTEGER DEFAULT 1,
      requiresApproval INTEGER DEFAULT 1,
      isActive INTEGER DEFAULT 1,
      sortOrder INTEGER DEFAULT 0
    )
  `);

  // Employee absence limits (limity urlopowe per pracownik per rok)
  db.run(`
    CREATE TABLE IF NOT EXISTS employee_absence_limits (
      id TEXT PRIMARY KEY,
      employeeId TEXT NOT NULL,
      absenceTypeId TEXT NOT NULL,
      year INTEGER NOT NULL,
      totalDays INTEGER DEFAULT 0,
      usedDays INTEGER DEFAULT 0,
      UNIQUE(employeeId, absenceTypeId, year)
    )
  `);

  // Absences (konkretne nieobecności)
  db.run(`
    CREATE TABLE IF NOT EXISTS absences (
      id TEXT PRIMARY KEY,
      employeeId TEXT NOT NULL,
      absenceTypeId TEXT NOT NULL,
      startDate TEXT NOT NULL,
      endDate TEXT NOT NULL,
      workDays INTEGER DEFAULT 1,
      status TEXT DEFAULT 'approved',
      note TEXT,
      createdAt INTEGER NOT NULL,
      approvedAt INTEGER,
      approvedBy TEXT
    )
  `);

  // Employee extended data (rozszerzone dane pracownika)
  db.run(`
    CREATE TABLE IF NOT EXISTS employee_details (
      employeeId TEXT PRIMARY KEY,
      email TEXT,
      phone TEXT,
      birthDate TEXT,
      hireDate TEXT,
      department TEXT,
      position TEXT,
      contractType TEXT,
      workingHours INTEGER DEFAULT 40,
      notes TEXT
    )
  `);

  // Employee qualifications matrix (matryca kwalifikacji)
  db.run(`
    CREATE TABLE IF NOT EXISTS employee_qualifications (
      id TEXT PRIMARY KEY,
      employeeId TEXT NOT NULL,
      testId TEXT NOT NULL,
      level INTEGER DEFAULT 1,
      certifiedAt INTEGER,
      expiresAt INTEGER,
      UNIQUE(employeeId, testId)
    )
  `);

  // Polish holidays (święta polskie)
  db.run(`
    CREATE TABLE IF NOT EXISTS holidays (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      isMovable INTEGER DEFAULT 0
    )
  `);

  // Insert default absence types if not exist
  const existingTypes = getAll('SELECT id FROM absence_types');
  if (existingTypes.length === 0) {
    const defaultTypes = [
      { id: 'vacation', name: 'Urlop wypoczynkowy', icon: '🏖️', color: '#10b981', defaultDays: 26, isPaid: 1, sortOrder: 1 },
      { id: 'vacation-force', name: 'Urlop siła wyższa 50%', icon: '⚡', color: '#f59e0b', defaultDays: 2, isPaid: 1, sortOrder: 2 },
      { id: 'vacation-overdue', name: 'Zaległy urlop', icon: '📅', color: '#6366f1', defaultDays: 0, isPaid: 1, sortOrder: 3 },
      { id: 'paternity', name: 'Urlop ojcowski', icon: '👶', color: '#3b82f6', defaultDays: 14, isPaid: 1, sortOrder: 4 },
      { id: 'parental', name: 'Urlop macierzyński/rodzicielski', icon: '👨‍👩‍👧', color: '#ec4899', defaultDays: 0, isPaid: 1, sortOrder: 5 },
      { id: 'childcare', name: 'Opieka nad dzieckiem', icon: '👨‍👧', color: '#8b5cf6', defaultDays: 2, isPaid: 1, sortOrder: 6 },
      { id: 'occasional', name: 'Urlop okolicznościowy', icon: '🎭', color: '#14b8a6', defaultDays: 0, isPaid: 1, sortOrder: 7 },
      { id: 'sick', name: 'Chorobowe', icon: '🤒', color: '#ef4444', defaultDays: 0, isPaid: 1, sortOrder: 8 },
      { id: 'medical', name: 'Badania okresowe', icon: '🏥', color: '#06b6d4', defaultDays: 1, isPaid: 1, sortOrder: 9 },
      { id: 'unpaid', name: 'Urlop bezpłatny', icon: '💼', color: '#64748b', defaultDays: 0, isPaid: 0, sortOrder: 10 },
      { id: 'occasional-env', name: 'Urlop okolicznościowy', icon: '🎭', color: '#14b8a6', defaultDays: 0, isPaid: 1, sortOrder: 11 },
      { id: 'delegation', name: 'Delegacja', icon: '✈️', color: '#0ea5e9', defaultDays: 0, isPaid: 1, sortOrder: 12 },
      { id: 'home-office', name: 'Home Office', icon: '🏠', color: '#a855f7', defaultDays: 12, isPaid: 1, sortOrder: 13 }
    ];
    
    for (const type of defaultTypes) {
      db.run(`INSERT INTO absence_types (id, name, icon, color, defaultDays, isPaid, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [type.id, type.name, type.icon, type.color, type.defaultDays, type.isPaid, type.sortOrder]);
    }
  }

  // Insert Polish holidays for 2025-2027
  const existingHolidays = getAll('SELECT id FROM holidays');
  if (existingHolidays.length === 0) {
    const holidays = [
      // 2025
      { date: '2025-01-01', name: 'Nowy Rok' },
      { date: '2025-01-06', name: 'Trzech Króli' },
      { date: '2025-04-20', name: 'Wielkanoc', isMovable: 1 },
      { date: '2025-04-21', name: 'Poniedziałek Wielkanocny', isMovable: 1 },
      { date: '2025-05-01', name: 'Święto Pracy' },
      { date: '2025-05-03', name: 'Święto Konstytucji 3 Maja' },
      { date: '2025-06-08', name: 'Zielone Świątki', isMovable: 1 },
      { date: '2025-06-19', name: 'Boże Ciało', isMovable: 1 },
      { date: '2025-08-15', name: 'Wniebowzięcie NMP' },
      { date: '2025-11-01', name: 'Wszystkich Świętych' },
      { date: '2025-11-11', name: 'Święto Niepodległości' },
      { date: '2025-12-25', name: 'Boże Narodzenie' },
      { date: '2025-12-26', name: 'Drugi dzień Bożego Narodzenia' },
      // 2026
      { date: '2026-01-01', name: 'Nowy Rok' },
      { date: '2026-01-06', name: 'Trzech Króli' },
      { date: '2026-04-05', name: 'Wielkanoc', isMovable: 1 },
      { date: '2026-04-06', name: 'Poniedziałek Wielkanocny', isMovable: 1 },
      { date: '2026-05-01', name: 'Święto Pracy' },
      { date: '2026-05-03', name: 'Święto Konstytucji 3 Maja' },
      { date: '2026-05-24', name: 'Zielone Świątki', isMovable: 1 },
      { date: '2026-06-04', name: 'Boże Ciało', isMovable: 1 },
      { date: '2026-08-15', name: 'Wniebowzięcie NMP' },
      { date: '2026-11-01', name: 'Wszystkich Świętych' },
      { date: '2026-11-11', name: 'Święto Niepodległości' },
      { date: '2026-12-25', name: 'Boże Narodzenie' },
      { date: '2026-12-26', name: 'Drugi dzień Bożego Narodzenia' },
      // 2027
      { date: '2027-01-01', name: 'Nowy Rok' },
      { date: '2027-01-06', name: 'Trzech Króli' },
      { date: '2027-03-28', name: 'Wielkanoc', isMovable: 1 },
      { date: '2027-03-29', name: 'Poniedziałek Wielkanocny', isMovable: 1 },
      { date: '2027-05-01', name: 'Święto Pracy' },
      { date: '2027-05-03', name: 'Święto Konstytucji 3 Maja' },
      { date: '2027-05-16', name: 'Zielone Świątki', isMovable: 1 },
      { date: '2027-05-27', name: 'Boże Ciało', isMovable: 1 },
      { date: '2027-08-15', name: 'Wniebowzięcie NMP' },
      { date: '2027-11-01', name: 'Wszystkich Świętych' },
      { date: '2027-11-11', name: 'Święto Niepodległości' },
      { date: '2027-12-25', name: 'Boże Narodzenie' },
      { date: '2027-12-26', name: 'Drugi dzień Bożego Narodzenia' }
    ];
    
    for (const h of holidays) {
      db.run(`INSERT INTO holidays (id, date, name, isMovable) VALUES (?, ?, ?, ?)`,
        [h.date, h.date, h.name, h.isMovable || 0]);
    }
  }

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
