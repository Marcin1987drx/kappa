import { Router } from 'express';
import { runQuery, getAll, getOne, saveDatabase, getDatabaseBuffer, replaceDatabase, dbPath } from '../database/db.js';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename_routes = fileURLToPath(import.meta.url);
const __dirname_routes = dirname(__filename_routes);

// Simple CRUD router generator with upsert support
function createCrudRouter(table: string) {
  const router = Router();

  // Get all
  router.get('/', (req, res) => {
    try {
      const items = getAll(`SELECT * FROM ${table} ORDER BY name`);
      res.json(items);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: `Failed to fetch ${table}` });
    }
  });

  // Get by ID
  router.get('/:id', (req, res) => {
    try {
      const item = getOne(`SELECT * FROM ${table} WHERE id = ?`, [req.params.id]);
      if (!item) {
        return res.status(404).json({ error: `${table} not found` });
      }
      res.json(item);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: `Failed to fetch ${table}` });
    }
  });

  // Create (upsert)
  router.post('/', (req, res) => {
    try {
      const { id, name, created_at } = req.body;
      const existing = getOne(`SELECT id FROM ${table} WHERE id = ?`, [id]);
      
      if (existing) {
        runQuery(`UPDATE ${table} SET name = ? WHERE id = ?`, [name, id]);
      } else {
        runQuery(`INSERT INTO ${table} (id, name, created_at) VALUES (?, ?, ?)`, [id, name, created_at]);
      }
      res.status(201).json({ id, name, created_at });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: `Failed to create ${table}` });
    }
  });

  // Update
  router.put('/:id', (req, res) => {
    try {
      const { name } = req.body;
      runQuery(`UPDATE ${table} SET name = ? WHERE id = ?`, [name, req.params.id]);
      res.json({ id: req.params.id, name });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: `Failed to update ${table}` });
    }
  });

  // Delete
  router.delete('/:id', (req, res) => {
    try {
      runQuery(`DELETE FROM ${table} WHERE id = ?`, [req.params.id]);
      res.json({ success: true });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: `Failed to delete ${table}` });
    }
  });

  return router;
}

export const customersRouter = createCrudRouter('customers');
export const typesRouter = createCrudRouter('types');
export const partsRouter = createCrudRouter('parts');
export const testsRouter = createCrudRouter('tests');

// Settings router
export const settingsRouter = Router();

settingsRouter.get('/', (req, res) => {
  try {
    const setting = getOne('SELECT value FROM settings WHERE key = ?', ['app-settings']) as any;
    if (!setting) {
      return res.json({
        language: 'en',
        darkMode: true,
        animations: true,
        highlightMissing: true,
        blinkAlerts: true
      });
    }
    res.json(JSON.parse(setting.value));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

settingsRouter.put('/', (req, res) => {
  try {
    const settings = req.body;
    const value = JSON.stringify(settings);
    
    // Check if settings exist
    const existing = getOne('SELECT * FROM settings WHERE key = ?', ['app-settings']);
    
    if (existing) {
      runQuery('UPDATE settings SET value = ? WHERE key = ?', [value, 'app-settings']);
    } else {
      runQuery('INSERT INTO settings (key, value) VALUES (?, ?)', ['app-settings', value]);
    }
    
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Export/Import
export const dataRouter = Router();

// Full export - ALL modules
dataRouter.get('/export', (req, res) => {
  try {
    const data: any = {
      exportDate: new Date().toISOString(),
      version: '2.0',
      customers: getAll('SELECT * FROM customers'),
      types: getAll('SELECT * FROM types'),
      parts: getAll('SELECT * FROM parts'),
      tests: getAll('SELECT * FROM tests'),
      projects: [],
      employees: getAll('SELECT * FROM employees'),
      scheduleAssignments: getAll('SELECT * FROM schedule_assignments'),
      absenceTypes: getAll('SELECT * FROM absence_types'),
      absences: getAll('SELECT * FROM absences'),
      absenceLimits: getAll('SELECT * FROM employee_absence_limits'),
      employeeDetails: getAll('SELECT * FROM employee_details'),
      qualifications: getAll('SELECT * FROM employee_qualifications'),
      holidays: getAll('SELECT * FROM holidays'),
      comments: getAll('SELECT * FROM comments'),
      logs: getAll('SELECT * FROM logs'),
      templates: getAll('SELECT * FROM schedule_templates'),
      preferences: getAll('SELECT * FROM user_preferences'),
      settings: null
    };

    // Get projects with weeks
    const projects = getAll('SELECT * FROM projects') as any[];
    data.projects = projects.map(project => {
      const weeks = getAll('SELECT week, ist, soll, stoppage, production_lack FROM project_weeks WHERE project_id = ?', [project.id]) as any[];
      const weeksObj: any = {};
      weeks.forEach(w => {
        weeksObj[w.week] = { 
          ist: w.ist, 
          soll: w.soll,
          stoppage: w.stoppage === 1,
          productionLack: w.production_lack === 1
        };
      });
      return { ...project, weeks: weeksObj };
    });

    // Get settings
    const setting = getOne('SELECT value FROM settings WHERE key = ?', ['app-settings']) as any;
    if (setting) {
      data.settings = JSON.parse(setting.value);
    }

    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to export data' });
  }
});

// Export specific module only
dataRouter.get('/export/:module', (req, res) => {
  try {
    const moduleName = req.params.module;
    let data: any = {};

    switch (moduleName) {
      case 'planning':
        data = {
          customers: getAll('SELECT * FROM customers'),
          types: getAll('SELECT * FROM types'),
          parts: getAll('SELECT * FROM parts'),
          tests: getAll('SELECT * FROM tests'),
          projects: [],
          comments: getAll('SELECT * FROM comments'),
        };
        const projects = getAll('SELECT * FROM projects') as any[];
        data.projects = projects.map(project => {
          const weeks = getAll('SELECT week, ist, soll, stoppage, production_lack FROM project_weeks WHERE project_id = ?', [project.id]) as any[];
          const weeksObj: any = {};
          weeks.forEach(w => {
            weeksObj[w.week] = { ist: w.ist, soll: w.soll, stoppage: w.stoppage === 1, productionLack: w.production_lack === 1 };
          });
          return { ...project, weeks: weeksObj };
        });
        break;
      case 'employees':
        data = {
          employees: getAll('SELECT * FROM employees'),
          employeeDetails: getAll('SELECT * FROM employee_details'),
          qualifications: getAll('SELECT * FROM employee_qualifications'),
        };
        break;
      case 'schedule':
        data = {
          scheduleAssignments: getAll('SELECT * FROM schedule_assignments'),
          templates: getAll('SELECT * FROM schedule_templates'),
        };
        break;
      case 'absences':
        data = {
          absenceTypes: getAll('SELECT * FROM absence_types'),
          absences: getAll('SELECT * FROM absences'),
          absenceLimits: getAll('SELECT * FROM employee_absence_limits'),
          holidays: getAll('SELECT * FROM holidays'),
        };
        break;
      // Individual table modules
      case 'customers':
        data = { customers: getAll('SELECT * FROM customers') };
        break;
      case 'types':
        data = { types: getAll('SELECT * FROM types') };
        break;
      case 'parts':
        data = { parts: getAll('SELECT * FROM parts') };
        break;
      case 'tests':
        data = { tests: getAll('SELECT * FROM tests') };
        break;
      case 'projects': {
        const allProjects = getAll('SELECT * FROM projects') as any[];
        data = {
          projects: allProjects.map(project => {
            const weeks = getAll('SELECT week, ist, soll, stoppage, production_lack FROM project_weeks WHERE project_id = ?', [project.id]) as any[];
            const weeksObj: any = {};
            weeks.forEach(w => {
              weeksObj[w.week] = { ist: w.ist, soll: w.soll, stoppage: w.stoppage === 1, productionLack: w.production_lack === 1 };
            });
            return { ...project, weeks: weeksObj };
          }),
          comments: getAll('SELECT * FROM comments'),
        };
        break;
      }
      default:
        return res.status(400).json({ error: `Unknown module: ${moduleName}` });
    }

    data.exportDate = new Date().toISOString();
    data.version = '2.0';
    data.module = moduleName;
    res.json(data);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to export module data' });
  }
});

// Full import (all data)
dataRouter.post('/import', (req, res) => {
  try {
    const { customers, types, parts, tests, projects, settings,
            employees, scheduleAssignments, absenceTypes, absences, 
            absenceLimits, employeeDetails, qualifications, holidays,
            comments, logs, templates, preferences } = req.body;

    // Clear existing data
    runQuery('DELETE FROM project_weeks', []);
    runQuery('DELETE FROM projects', []);
    runQuery('DELETE FROM customers', []);
    runQuery('DELETE FROM types', []);
    runQuery('DELETE FROM parts', []);
    runQuery('DELETE FROM tests', []);

    // Import customers
    customers?.forEach((c: any) => {
      runQuery('INSERT INTO customers (id, name, created_at) VALUES (?, ?, ?)', [c.id, c.name, c.created_at || c.createdAt]);
    });

    // Import types
    types?.forEach((t: any) => {
      runQuery('INSERT INTO types (id, name, created_at) VALUES (?, ?, ?)', [t.id, t.name, t.created_at || t.createdAt]);
    });

    // Import parts
    parts?.forEach((p: any) => {
      runQuery('INSERT INTO parts (id, name, created_at) VALUES (?, ?, ?)', [p.id, p.name, p.created_at || p.createdAt]);
    });

    // Import tests
    tests?.forEach((t: any) => {
      runQuery('INSERT INTO tests (id, name, created_at) VALUES (?, ?, ?)', [t.id, t.name, t.created_at || t.createdAt]);
    });

    // Import projects
    projects?.forEach((p: any) => {
      runQuery(`
        INSERT INTO projects (id, customer_id, type_id, part_id, test_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [
        p.id,
        p.customer_id || p.customerId,
        p.type_id || p.typeId,
        p.part_id || p.partId,
        p.test_id || p.testId,
        p.created_at || p.createdAt,
        p.updated_at || p.updatedAt
      ]);

      if (p.weeks) {
        for (const [week, data] of Object.entries(p.weeks)) {
          const weekData = data as any;
          runQuery('INSERT INTO project_weeks (project_id, week, ist, soll, stoppage, production_lack) VALUES (?, ?, ?, ?, ?, ?)', 
            [p.id, week, weekData.ist, weekData.soll, weekData.stoppage ? 1 : 0, weekData.productionLack ? 1 : 0]);
        }
      }
    });

    // Import employees
    if (employees?.length) {
      runQuery('DELETE FROM employees', []);
      employees.forEach((e: any) => {
        runQuery(`INSERT INTO employees (id, firstName, lastName, color, status, suggestedShift, role, email, phone, department, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [e.id, e.firstName, e.lastName, e.color, e.status || 'available', e.suggestedShift, e.role || 'worker', e.email, e.phone, e.department, e.created_at || e.createdAt]);
      });
    }

    // Import schedule assignments
    if (scheduleAssignments?.length) {
      runQuery('DELETE FROM schedule_assignments', []);
      scheduleAssignments.forEach((a: any) => {
        runQuery(`INSERT INTO schedule_assignments (id, employeeId, projectId, testId, week, shift, scope, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [a.id, a.employeeId, a.projectId, a.testId, a.week, a.shift || 1, a.scope || 'project', a.note, a.created_at || a.createdAt]);
      });
    }

    // Import absence types
    if (absenceTypes?.length) {
      runQuery('DELETE FROM absence_types', []);
      absenceTypes.forEach((t: any) => {
        runQuery(`INSERT INTO absence_types (id, name, icon, color, defaultDays, isPaid, requiresApproval, isActive, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [t.id, t.name, t.icon, t.color, t.defaultDays || 0, t.isPaid ?? 1, t.requiresApproval ?? 1, t.isActive ?? 1, t.sortOrder || 0]);
      });
    }

    // Import absences
    if (absences?.length) {
      runQuery('DELETE FROM absences', []);
      absences.forEach((a: any) => {
        runQuery(`INSERT INTO absences (id, employeeId, absenceTypeId, startDate, endDate, workDays, status, note, createdAt, approvedAt, approvedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [a.id, a.employeeId, a.absenceTypeId, a.startDate, a.endDate, a.workDays || 1, a.status || 'approved', a.note, a.createdAt, a.approvedAt, a.approvedBy]);
      });
    }

    // Import absence limits
    if (absenceLimits?.length) {
      runQuery('DELETE FROM employee_absence_limits', []);
      absenceLimits.forEach((l: any) => {
        runQuery(`INSERT INTO employee_absence_limits (id, employeeId, absenceTypeId, year, totalDays, usedDays) VALUES (?, ?, ?, ?, ?, ?)`,
          [l.id, l.employeeId, l.absenceTypeId, l.year, l.totalDays || 0, l.usedDays || 0]);
      });
    }

    // Import employee details
    if (employeeDetails?.length) {
      runQuery('DELETE FROM employee_details', []);
      employeeDetails.forEach((d: any) => {
        runQuery(`INSERT INTO employee_details (employeeId, email, phone, birthDate, hireDate, department, position, contractType, workingHours, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [d.employeeId, d.email, d.phone, d.birthDate, d.hireDate, d.department, d.position, d.contractType, d.workingHours || 40, d.notes]);
      });
    }

    // Import qualifications
    if (qualifications?.length) {
      runQuery('DELETE FROM employee_qualifications', []);
      qualifications.forEach((q: any) => {
        runQuery(`INSERT INTO employee_qualifications (id, employeeId, testId, level, certifiedAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)`,
          [q.id, q.employeeId, q.testId, q.level || 1, q.certifiedAt, q.expiresAt]);
      });
    }

    // Import holidays
    if (holidays?.length) {
      runQuery('DELETE FROM holidays', []);
      holidays.forEach((h: any) => {
        runQuery(`INSERT INTO holidays (id, date, name, isMovable) VALUES (?, ?, ?, ?)`,
          [h.id || h.date, h.date, h.name, h.isMovable || 0]);
      });
    }

    // Import comments
    if (comments?.length) {
      runQuery('DELETE FROM comments', []);
      comments.forEach((c: any) => {
        runQuery(`INSERT INTO comments (id, projectId, week, text, createdAt) VALUES (?, ?, ?, ?, ?)`,
          [c.id, c.projectId, c.week, c.text, c.createdAt]);
      });
    }

    // Import logs
    if (logs?.length) {
      runQuery('DELETE FROM logs', []);
      logs.forEach((l: any) => {
        runQuery(`INSERT INTO logs (id, userId, userName, action, entityType, entityName, details, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [l.id, l.userId, l.userName, l.action, l.entityType, l.entityName, l.details, l.timestamp]);
      });
    }

    // Import templates
    if (templates?.length) {
      runQuery('DELETE FROM schedule_templates', []);
      templates.forEach((t: any) => {
        runQuery(`INSERT INTO schedule_templates (id, name, data, createdAt) VALUES (?, ?, ?, ?)`,
          [t.id, t.name, t.data, t.createdAt]);
      });
    }

    // Import settings
    if (settings) {
      const value = JSON.stringify(settings);
      const existing = getOne('SELECT * FROM settings WHERE key = ?', ['app-settings']);
      
      if (existing) {
        runQuery('UPDATE settings SET value = ? WHERE key = ?', [value, 'app-settings']);
      } else {
        runQuery('INSERT INTO settings (key, value) VALUES (?, ?)', ['app-settings', value]);
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to import data' });
  }
});

// Partial import - import specific module only
dataRouter.post('/import/:module', (req, res) => {
  try {
    const moduleName = req.params.module;
    const data = req.body;

    switch (moduleName) {
      case 'planning': {
        // Clear planning data
        runQuery('DELETE FROM project_weeks', []);
        runQuery('DELETE FROM projects', []);
        runQuery('DELETE FROM customers', []);
        runQuery('DELETE FROM types', []);
        runQuery('DELETE FROM parts', []);
        runQuery('DELETE FROM tests', []);
        runQuery('DELETE FROM comments', []);

        data.customers?.forEach((c: any) => {
          runQuery('INSERT INTO customers (id, name, created_at) VALUES (?, ?, ?)', [c.id, c.name, c.created_at || c.createdAt]);
        });
        data.types?.forEach((t: any) => {
          runQuery('INSERT INTO types (id, name, created_at) VALUES (?, ?, ?)', [t.id, t.name, t.created_at || t.createdAt]);
        });
        data.parts?.forEach((p: any) => {
          runQuery('INSERT INTO parts (id, name, created_at) VALUES (?, ?, ?)', [p.id, p.name, p.created_at || p.createdAt]);
        });
        data.tests?.forEach((t: any) => {
          runQuery('INSERT INTO tests (id, name, created_at) VALUES (?, ?, ?)', [t.id, t.name, t.created_at || t.createdAt]);
        });
        data.projects?.forEach((p: any) => {
          runQuery(`INSERT INTO projects (id, customer_id, type_id, part_id, test_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [p.id, p.customer_id || p.customerId, p.type_id || p.typeId, p.part_id || p.partId, p.test_id || p.testId, p.created_at || p.createdAt, p.updated_at || p.updatedAt]);
          if (p.weeks) {
            for (const [week, weekData] of Object.entries(p.weeks)) {
              const wd = weekData as any;
              runQuery('INSERT INTO project_weeks (project_id, week, ist, soll, stoppage, production_lack) VALUES (?, ?, ?, ?, ?, ?)',
                [p.id, week, wd.ist, wd.soll, wd.stoppage ? 1 : 0, wd.productionLack ? 1 : 0]);
            }
          }
        });
        data.comments?.forEach((c: any) => {
          runQuery('INSERT INTO comments (id, projectId, week, text, createdAt) VALUES (?, ?, ?, ?, ?)',
            [c.id, c.projectId, c.week, c.text, c.createdAt]);
        });
        break;
      }
      case 'employees': {
        runQuery('DELETE FROM employee_details', []);
        runQuery('DELETE FROM employee_qualifications', []);
        runQuery('DELETE FROM employees', []);

        data.employees?.forEach((e: any) => {
          runQuery(`INSERT INTO employees (id, firstName, lastName, color, status, suggestedShift, role, email, phone, department, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [e.id, e.firstName, e.lastName, e.color, e.status || 'available', e.suggestedShift, e.role || 'worker', e.email, e.phone, e.department, e.created_at || e.createdAt]);
        });
        data.employeeDetails?.forEach((d: any) => {
          runQuery(`INSERT INTO employee_details (employeeId, email, phone, birthDate, hireDate, department, position, contractType, workingHours, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [d.employeeId, d.email, d.phone, d.birthDate, d.hireDate, d.department, d.position, d.contractType, d.workingHours || 40, d.notes]);
        });
        data.qualifications?.forEach((q: any) => {
          runQuery(`INSERT INTO employee_qualifications (id, employeeId, testId, level, certifiedAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)`,
            [q.id, q.employeeId, q.testId, q.level || 1, q.certifiedAt, q.expiresAt]);
        });
        break;
      }
      case 'schedule': {
        runQuery('DELETE FROM schedule_assignments', []);
        runQuery('DELETE FROM schedule_templates', []);

        data.scheduleAssignments?.forEach((a: any) => {
          runQuery(`INSERT INTO schedule_assignments (id, employeeId, projectId, testId, week, shift, scope, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [a.id, a.employeeId, a.projectId, a.testId, a.week, a.shift || 1, a.scope || 'project', a.note, a.created_at || a.createdAt]);
        });
        data.templates?.forEach((t: any) => {
          runQuery(`INSERT INTO schedule_templates (id, name, data, createdAt) VALUES (?, ?, ?, ?)`,
            [t.id, t.name, t.data, t.createdAt]);
        });
        break;
      }
      case 'absences': {
        runQuery('DELETE FROM absences', []);
        runQuery('DELETE FROM employee_absence_limits', []);
        runQuery('DELETE FROM absence_types', []);
        runQuery('DELETE FROM holidays', []);

        data.absenceTypes?.forEach((t: any) => {
          runQuery(`INSERT INTO absence_types (id, name, icon, color, defaultDays, isPaid, requiresApproval, isActive, sortOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [t.id, t.name, t.icon, t.color, t.defaultDays || 0, t.isPaid ?? 1, t.requiresApproval ?? 1, t.isActive ?? 1, t.sortOrder || 0]);
        });
        data.absences?.forEach((a: any) => {
          runQuery(`INSERT INTO absences (id, employeeId, absenceTypeId, startDate, endDate, workDays, status, note, createdAt, approvedAt, approvedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [a.id, a.employeeId, a.absenceTypeId, a.startDate, a.endDate, a.workDays || 1, a.status || 'approved', a.note, a.createdAt, a.approvedAt, a.approvedBy]);
        });
        data.absenceLimits?.forEach((l: any) => {
          runQuery(`INSERT INTO employee_absence_limits (id, employeeId, absenceTypeId, year, totalDays, usedDays) VALUES (?, ?, ?, ?, ?, ?)`,
            [l.id, l.employeeId, l.absenceTypeId, l.year, l.totalDays || 0, l.usedDays || 0]);
        });
        data.holidays?.forEach((h: any) => {
          runQuery(`INSERT INTO holidays (id, date, name, isMovable) VALUES (?, ?, ?, ?)`,
            [h.id || h.date, h.date, h.name, h.isMovable || 0]);
        });
        break;
      }
      // Individual table modules
      case 'customers': {
        runQuery('DELETE FROM customers', []);
        data.customers?.forEach((c: any) => {
          runQuery('INSERT INTO customers (id, name, created_at) VALUES (?, ?, ?)', [c.id, c.name, c.created_at || c.createdAt]);
        });
        break;
      }
      case 'types': {
        runQuery('DELETE FROM types', []);
        data.types?.forEach((t: any) => {
          runQuery('INSERT INTO types (id, name, created_at) VALUES (?, ?, ?)', [t.id, t.name, t.created_at || t.createdAt]);
        });
        break;
      }
      case 'parts': {
        runQuery('DELETE FROM parts', []);
        data.parts?.forEach((p: any) => {
          runQuery('INSERT INTO parts (id, name, created_at) VALUES (?, ?, ?)', [p.id, p.name, p.created_at || p.createdAt]);
        });
        break;
      }
      case 'tests': {
        runQuery('DELETE FROM tests', []);
        data.tests?.forEach((t: any) => {
          runQuery('INSERT INTO tests (id, name, created_at) VALUES (?, ?, ?)', [t.id, t.name, t.created_at || t.createdAt]);
        });
        break;
      }
      case 'projects': {
        runQuery('DELETE FROM project_weeks', []);
        runQuery('DELETE FROM projects', []);
        runQuery('DELETE FROM comments', []);
        data.projects?.forEach((p: any) => {
          runQuery(`INSERT INTO projects (id, customer_id, type_id, part_id, test_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [p.id, p.customer_id || p.customerId, p.type_id || p.typeId, p.part_id || p.partId, p.test_id || p.testId, p.created_at || p.createdAt, p.updated_at || p.updatedAt]);
          if (p.weeks) {
            for (const [week, weekData] of Object.entries(p.weeks)) {
              const wd = weekData as any;
              runQuery('INSERT INTO project_weeks (project_id, week, ist, soll, stoppage, production_lack) VALUES (?, ?, ?, ?, ?, ?)',
                [p.id, week, wd.ist, wd.soll, wd.stoppage ? 1 : 0, wd.productionLack ? 1 : 0]);
            }
          }
        });
        data.comments?.forEach((c: any) => {
          runQuery('INSERT INTO comments (id, projectId, week, text, createdAt) VALUES (?, ?, ?, ?, ?)',
            [c.id, c.projectId, c.week, c.text, c.createdAt]);
        });
        break;
      }
      default:
        return res.status(400).json({ error: `Unknown module: ${moduleName}` });
    }

    res.json({ success: true, module: moduleName });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: `Failed to import module: ${req.params.module}` });
  }
});

// Download raw SQLite database file
dataRouter.get('/download-db', (req, res) => {
  try {
    const buffer = getDatabaseBuffer();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    res.setHeader('Content-Type', 'application/x-sqlite3');
    res.setHeader('Content-Disposition', `attachment; filename="kappa-database-${timestamp}.db"`);
    res.setHeader('Content-Length', buffer.length.toString());
    res.send(buffer);
  } catch (error) {
    console.error('Download DB error:', error);
    res.status(500).json({ error: 'Failed to download database' });
  }
});

// Upload and replace SQLite database file (base64 encoded in JSON)
dataRouter.post('/upload-db', async (req, res) => {
  try {
    const { data: base64Data } = req.body;
    if (!base64Data) {
      return res.status(400).json({ error: 'No database data provided' });
    }
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Basic validation - SQLite files start with "SQLite format 3"
    const header = buffer.slice(0, 16).toString('utf8');
    if (!header.startsWith('SQLite format 3')) {
      return res.status(400).json({ error: 'Invalid SQLite database file' });
    }

    await replaceDatabase(buffer);
    res.json({ success: true, size: buffer.length });
  } catch (error) {
    console.error('Upload DB error:', error);
    res.status(500).json({ error: 'Failed to upload database' });
  }
});

// Backup - creates a timestamped backup file
dataRouter.post('/backup', (req, res) => {
  try {
    const { path: backupPath } = req.body;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    
    // Export full data
    const data: any = {
      backupDate: new Date().toISOString(),
      version: '2.0',
      customers: getAll('SELECT * FROM customers'),
      types: getAll('SELECT * FROM types'),
      parts: getAll('SELECT * FROM parts'),
      tests: getAll('SELECT * FROM tests'),
      projects: [],
      employees: getAll('SELECT * FROM employees'),
      scheduleAssignments: getAll('SELECT * FROM schedule_assignments'),
      absenceTypes: getAll('SELECT * FROM absence_types'),
      absences: getAll('SELECT * FROM absences'),
      absenceLimits: getAll('SELECT * FROM employee_absence_limits'),
      employeeDetails: getAll('SELECT * FROM employee_details'),
      qualifications: getAll('SELECT * FROM employee_qualifications'),
      holidays: getAll('SELECT * FROM holidays'),
      comments: getAll('SELECT * FROM comments'),
      logs: getAll('SELECT * FROM logs'),
      templates: getAll('SELECT * FROM schedule_templates'),
      settings: null
    };

    const projects = getAll('SELECT * FROM projects') as any[];
    data.projects = projects.map(project => {
      const weeks = getAll('SELECT week, ist, soll, stoppage, production_lack FROM project_weeks WHERE project_id = ?', [project.id]) as any[];
      const weeksObj: any = {};
      weeks.forEach(w => {
        weeksObj[w.week] = { ist: w.ist, soll: w.soll, stoppage: w.stoppage === 1, productionLack: w.production_lack === 1 };
      });
      return { ...project, weeks: weeksObj };
    });

    const setting = getOne('SELECT value FROM settings WHERE key = ?', ['app-settings']) as any;
    if (setting) data.settings = JSON.parse(setting.value);

    // Save to backup path
    const targetDir = backupPath || join(__dirname_routes, '../../../backups');
    
    if (!existsSync(targetDir)) {
      mkdirSync(targetDir, { recursive: true });
    }

    const filename = `kappa-backup-${timestamp}.json`;
    const fullPath = join(targetDir, filename);
    writeFileSync(fullPath, JSON.stringify(data, null, 2));

    res.json({ 
      success: true, 
      filename, 
      path: fullPath,
      size: statSync(fullPath).size,
      date: data.backupDate
    });
  } catch (error) {
    console.error('Backup error:', error);
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

// Get backup list
dataRouter.get('/backups', (req, res) => {
  try {
    const backupPath = (req.query.path as string) || join(__dirname_routes, '../../../backups');
    
    if (!existsSync(backupPath)) {
      return res.json({ backups: [], path: backupPath });
    }

    const files = readdirSync(backupPath)
      .filter((f: string) => f.startsWith('kappa-backup-') && f.endsWith('.json'))
      .map((f: string) => {
        const stats = statSync(join(backupPath, f));
        return {
          filename: f,
          size: stats.size,
          created: stats.mtime.toISOString()
        };
      })
      .sort((a: any, b: any) => new Date(b.created).getTime() - new Date(a.created).getTime());

    res.json({ backups: files, path: backupPath });
  } catch (error) {
    console.error('List backups error:', error);
    res.status(500).json({ error: 'Failed to list backups' });
  }
});

// Restore from backup file
dataRouter.post('/backup/restore', (req, res) => {
  try {
    const { filename, backupPath } = req.body;
    const dir = backupPath || join(__dirname_routes, '../../../backups');
    const fullPath = join(dir, filename);

    if (!existsSync(fullPath)) {
      return res.status(404).json({ error: 'Backup file not found' });
    }

    const content = readFileSync(fullPath, 'utf8');
    const data = JSON.parse(content);

    // Re-use the import logic by calling the same endpoint internally
    // We forward the parsed data to the import handler
    res.json({ success: true, data });
  } catch (error) {
    console.error('Restore error:', error);
    res.status(500).json({ error: 'Failed to restore backup' });
  }
});

dataRouter.delete('/clear', (req, res) => {
  try {
    runQuery('DELETE FROM project_weeks', []);
    runQuery('DELETE FROM projects', []);
    runQuery('DELETE FROM customers', []);
    runQuery('DELETE FROM types', []);
    runQuery('DELETE FROM parts', []);
    runQuery('DELETE FROM tests', []);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to clear data' });
  }
});

// Clear specific table
dataRouter.delete('/clear/:table', (req, res) => {
  try {
    const table = req.params.table;
    const allowedTables = ['customers', 'types', 'parts', 'tests', 'projects', 'comments', 'logs', 'employees', 'schedule_assignments', 'project_weeks',
                           'absence_types', 'absences', 'employee_absence_limits', 'employee_details', 'employee_qualifications', 'holidays', 'schedule_templates'];
    
    if (!allowedTables.includes(table)) {
      return res.status(400).json({ error: 'Invalid table name' });
    }
    
    // Special handling for projects - also clear project_weeks
    if (table === 'projects') {
      runQuery('DELETE FROM project_weeks', []);
    }
    
    runQuery(`DELETE FROM ${table}`, []);
    res.json({ success: true, table });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to clear table' });
  }
});
