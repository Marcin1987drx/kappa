import { Router } from 'express';
import { runQuery, getAll, getOne, saveDatabase } from '../database/db.js';

// Simple CRUD router generator
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

  // Create
  router.post('/', (req, res) => {
    try {
      const { id, name, created_at } = req.body;
      runQuery(`INSERT INTO ${table} (id, name, created_at) VALUES (?, ?, ?)`, [id, name, created_at]);
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

dataRouter.get('/export', (req, res) => {
  try {
    const data = {
      customers: getAll('SELECT * FROM customers'),
      types: getAll('SELECT * FROM types'),
      parts: getAll('SELECT * FROM parts'),
      tests: getAll('SELECT * FROM tests'),
      projects: [],
      settings: null
    };

    // Get projects with weeks
    const projects = getAll('SELECT * FROM projects') as any[];
    data.projects = projects.map(project => {
      const weeks = getAll('SELECT week, ist, soll FROM project_weeks WHERE project_id = ?', [project.id]) as any[];
      const weeksObj: any = {};
      weeks.forEach(w => {
        weeksObj[w.week] = { ist: w.ist, soll: w.soll };
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

dataRouter.post('/import', (req, res) => {
  try {
    const { customers, types, parts, tests, projects, settings } = req.body;

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
          runQuery('INSERT INTO project_weeks (project_id, week, ist, soll) VALUES (?, ?, ?, ?)', [p.id, week, (data as any).ist, (data as any).soll]);
        }
      }
    });

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
