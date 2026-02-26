import { Router } from 'express';
import { runQuery, getAll, getOne, saveDatabase } from '../database/db.js';

// ==================== EMPLOYEES ====================
export const employeesRouter = Router();

employeesRouter.get('/', (req, res) => {
  try {
    const items = getAll('SELECT * FROM employees ORDER BY firstName, lastName');
    res.json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

employeesRouter.get('/:id', (req, res) => {
  try {
    const item = getOne('SELECT * FROM employees WHERE id = ?', [req.params.id]);
    if (!item) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    res.json(item);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch employee' });
  }
});

employeesRouter.post('/', (req, res) => {
  try {
    const { id, firstName, lastName, color, status, suggestedShift, shiftSystem } = req.body;
    const created_at = Date.now();
    
    // Check if exists (upsert)
    const existing = getOne('SELECT id FROM employees WHERE id = ?', [id]);
    if (existing) {
      runQuery(`
        UPDATE employees SET firstName = ?, lastName = ?, color = ?, status = ?, suggestedShift = ?, shiftSystem = ?
        WHERE id = ?
      `, [firstName, lastName, color, status || 'available', suggestedShift || null, shiftSystem || 2, id]);
    } else {
      runQuery(`
        INSERT INTO employees (id, firstName, lastName, color, status, suggestedShift, shiftSystem, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [id, firstName, lastName, color, status || 'available', suggestedShift || null, shiftSystem || 2, created_at]);
    }
    
    res.status(201).json({ id, firstName, lastName, color, status, suggestedShift, shiftSystem, created_at });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create employee' });
  }
});

employeesRouter.put('/:id', (req, res) => {
  try {
    const { firstName, lastName, color, status, suggestedShift, shiftSystem } = req.body;
    runQuery(`
      UPDATE employees SET firstName = ?, lastName = ?, color = ?, status = ?, suggestedShift = ?, shiftSystem = ?
      WHERE id = ?
    `, [firstName, lastName, color, status, suggestedShift, shiftSystem || 2, req.params.id]);
    res.json({ id: req.params.id, firstName, lastName, color, status, suggestedShift, shiftSystem });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update employee' });
  }
});

employeesRouter.delete('/:id', (req, res) => {
  try {
    runQuery('DELETE FROM employees WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete employee' });
  }
});

// ==================== SCHEDULE ASSIGNMENTS ====================
export const scheduleAssignmentsRouter = Router();

scheduleAssignmentsRouter.get('/', (req, res) => {
  try {
    const items = getAll('SELECT * FROM schedule_assignments ORDER BY week, shift');
    res.json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch schedule assignments' });
  }
});

scheduleAssignmentsRouter.post('/', (req, res) => {
  try {
    console.log('POST /schedule-assignments body:', JSON.stringify(req.body));
    const { id, employeeId, projectId, week, shift, scope, note, createdAt, updatedAt } = req.body;
    const testId = req.body.testId || null;
    const partId = req.body.partId || null;
    const created_at = createdAt || Date.now();
    
    // Check if exists (upsert)
    const existing = getOne('SELECT id FROM schedule_assignments WHERE id = ?', [id]);
    if (existing) {
      runQuery(`
        UPDATE schedule_assignments SET employeeId = ?, projectId = ?, testId = ?, week = ?, shift = ?, scope = ?, note = ?
        WHERE id = ?
      `, [employeeId, projectId, testId, week, shift || 1, scope || 'project', note || null, id]);
    } else {
      runQuery(`
        INSERT INTO schedule_assignments (id, employeeId, projectId, testId, week, shift, scope, note, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [id, employeeId, projectId, testId, week, shift || 1, scope || 'project', note || null, created_at]);
    }
    
    res.status(201).json({ id, employeeId, projectId, testId, week, shift, scope, note, created_at });
  } catch (error) {
    console.error('Schedule assignment error:', error);
    res.status(500).json({ error: 'Failed to create schedule assignment' });
  }
});

scheduleAssignmentsRouter.delete('/:id', (req, res) => {
  try {
    runQuery('DELETE FROM schedule_assignments WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete schedule assignment' });
  }
});

// ==================== LOGS ====================
export const logsRouter = Router();

logsRouter.get('/', (req, res) => {
  try {
    const items = getAll('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 100');
    res.json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

logsRouter.post('/', (req, res) => {
  try {
    const { id, userId, userName, action, entityType, entityName, details, timestamp } = req.body;
    
    runQuery(`
      INSERT INTO logs (id, userId, userName, action, entityType, entityName, details, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, userId, userName, action, entityType, entityName, details, timestamp || Date.now()]);
    
    res.status(201).json({ id, userId, userName, action, entityType, entityName, details, timestamp });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create log' });
  }
});

logsRouter.delete('/clear', (req, res) => {
  try {
    runQuery('DELETE FROM logs', []);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to clear logs' });
  }
});

// ==================== COMMENTS ====================
export const commentsRouter = Router();

commentsRouter.get('/', (req, res) => {
  try {
    const items = getAll('SELECT * FROM comments ORDER BY createdAt DESC');
    res.json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch comments' });
  }
});

commentsRouter.post('/', (req, res) => {
  try {
    const { id, projectId, week, text, createdAt } = req.body;
    
    // Check if exists (upsert)
    const existing = getOne('SELECT id FROM comments WHERE id = ?', [id]);
    if (existing) {
      runQuery('UPDATE comments SET text = ? WHERE id = ?', [text, id]);
    } else {
      runQuery(`
        INSERT INTO comments (id, projectId, week, text, createdAt)
        VALUES (?, ?, ?, ?, ?)
      `, [id, projectId, week, text, createdAt || Date.now()]);
    }
    
    res.status(201).json({ id, projectId, week, text, createdAt });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create comment' });
  }
});

commentsRouter.delete('/:id', (req, res) => {
  try {
    runQuery('DELETE FROM comments WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// ==================== USER PREFERENCES (replaces localStorage) ====================
export const preferencesRouter = Router();

preferencesRouter.get('/', (req, res) => {
  try {
    const items = getAll('SELECT * FROM user_preferences');
    // Convert to object
    const prefs: Record<string, any> = {};
    (items as any[]).forEach(item => {
      try {
        prefs[item.key] = JSON.parse(item.value);
      } catch {
        prefs[item.key] = item.value;
      }
    });
    res.json(prefs);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

preferencesRouter.get('/:key', (req, res) => {
  try {
    const item = getOne('SELECT value FROM user_preferences WHERE key = ?', [req.params.key]) as any;
    if (!item) {
      return res.json(null);
    }
    try {
      res.json(JSON.parse(item.value));
    } catch {
      res.json(item.value);
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch preference' });
  }
});

preferencesRouter.put('/:key', (req, res) => {
  try {
    const key = req.params.key;
    const value = JSON.stringify(req.body.value);
    
    const existing = getOne('SELECT key FROM user_preferences WHERE key = ?', [key]);
    if (existing) {
      runQuery('UPDATE user_preferences SET value = ? WHERE key = ?', [value, key]);
    } else {
      runQuery('INSERT INTO user_preferences (key, value) VALUES (?, ?)', [key, value]);
    }
    
    res.json({ key, value: req.body.value });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update preference' });
  }
});

preferencesRouter.delete('/:key', (req, res) => {
  try {
    runQuery('DELETE FROM user_preferences WHERE key = ?', [req.params.key]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete preference' });
  }
});

// ==================== SCHEDULE TEMPLATES ====================
export const templatesRouter = Router();

templatesRouter.get('/', (req, res) => {
  try {
    const items = getAll('SELECT * FROM schedule_templates ORDER BY createdAt DESC');
    res.json((items as any[]).map(item => ({
      ...item,
      data: JSON.parse(item.data || '{}')
    })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch templates' });
  }
});

templatesRouter.post('/', (req, res) => {
  try {
    const { id, name, data, createdAt } = req.body;
    const dataStr = JSON.stringify(data);
    
    const existing = getOne('SELECT id FROM schedule_templates WHERE id = ?', [id]);
    if (existing) {
      runQuery('UPDATE schedule_templates SET name = ?, data = ? WHERE id = ?', [name, dataStr, id]);
    } else {
      runQuery(`
        INSERT INTO schedule_templates (id, name, data, createdAt)
        VALUES (?, ?, ?, ?)
      `, [id, name, dataStr, createdAt || Date.now()]);
    }
    
    res.status(201).json({ id, name, data, createdAt });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create template' });
  }
});

templatesRouter.delete('/:id', (req, res) => {
  try {
    runQuery('DELETE FROM schedule_templates WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete template' });
  }
});

// ==================== ABSENCE TYPES ====================
export const absenceTypesRouter = Router();

absenceTypesRouter.get('/', (req, res) => {
  try {
    const items = getAll('SELECT * FROM absence_types WHERE isActive = 1 ORDER BY sortOrder');
    res.json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch absence types' });
  }
});

absenceTypesRouter.get('/all', (req, res) => {
  try {
    const items = getAll('SELECT * FROM absence_types ORDER BY sortOrder');
    res.json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch absence types' });
  }
});

absenceTypesRouter.put('/:id', (req, res) => {
  try {
    const { name, icon, color, defaultDays, isPaid, requiresApproval, isActive, sortOrder } = req.body;
    runQuery(`
      UPDATE absence_types 
      SET name = ?, icon = ?, color = ?, defaultDays = ?, isPaid = ?, requiresApproval = ?, isActive = ?, sortOrder = ?
      WHERE id = ?
    `, [name, icon, color, defaultDays, isPaid ? 1 : 0, requiresApproval ? 1 : 0, isActive ? 1 : 0, sortOrder, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update absence type' });
  }
});

absenceTypesRouter.post('/', (req, res) => {
  try {
    const { id, name, icon, color, defaultDays, isPaid, requiresApproval, sortOrder } = req.body;
    runQuery(`
      INSERT INTO absence_types (id, name, icon, color, defaultDays, isPaid, requiresApproval, isActive, sortOrder)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
    `, [id, name, icon, color, defaultDays || 0, isPaid ? 1 : 0, requiresApproval ? 1 : 0, sortOrder || 99]);
    res.status(201).json({ id, name, icon, color, defaultDays, isPaid, requiresApproval });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create absence type' });
  }
});

// ==================== EMPLOYEE ABSENCE LIMITS ====================
export const absenceLimitsRouter = Router();

absenceLimitsRouter.get('/', (req, res) => {
  try {
    const { employeeId, year } = req.query;
    let sql = 'SELECT * FROM employee_absence_limits WHERE 1=1';
    const params: any[] = [];
    
    if (employeeId) {
      sql += ' AND employeeId = ?';
      params.push(employeeId);
    }
    if (year) {
      sql += ' AND year = ?';
      params.push(year);
    }
    
    const items = getAll(sql, params);
    res.json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch absence limits' });
  }
});

absenceLimitsRouter.post('/', (req, res) => {
  try {
    const { id, employeeId, absenceTypeId, year, totalDays, usedDays } = req.body;
    
    // Upsert - insert or update
    const existing = getOne('SELECT id FROM employee_absence_limits WHERE employeeId = ? AND absenceTypeId = ? AND year = ?', 
      [employeeId, absenceTypeId, year]);
    
    if (existing) {
      runQuery(`
        UPDATE employee_absence_limits 
        SET totalDays = ?, usedDays = ?
        WHERE employeeId = ? AND absenceTypeId = ? AND year = ?
      `, [totalDays, usedDays || 0, employeeId, absenceTypeId, year]);
    } else {
      runQuery(`
        INSERT INTO employee_absence_limits (id, employeeId, absenceTypeId, year, totalDays, usedDays)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [id || `${employeeId}-${absenceTypeId}-${year}`, employeeId, absenceTypeId, year, totalDays, usedDays || 0]);
    }
    
    res.status(201).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save absence limit' });
  }
});

absenceLimitsRouter.post('/bulk', (req, res) => {
  try {
    const { employeeId, year, limits } = req.body;
    
    for (const limit of limits) {
      const existing = getOne('SELECT id FROM employee_absence_limits WHERE employeeId = ? AND absenceTypeId = ? AND year = ?', 
        [employeeId, limit.absenceTypeId, year]);
      
      if (existing) {
        runQuery(`
          UPDATE employee_absence_limits 
          SET totalDays = ?
          WHERE employeeId = ? AND absenceTypeId = ? AND year = ?
        `, [limit.totalDays, employeeId, limit.absenceTypeId, year]);
      } else {
        runQuery(`
          INSERT INTO employee_absence_limits (id, employeeId, absenceTypeId, year, totalDays, usedDays)
          VALUES (?, ?, ?, ?, ?, 0)
        `, [`${employeeId}-${limit.absenceTypeId}-${year}`, employeeId, limit.absenceTypeId, year, limit.totalDays]);
      }
    }
    
    res.status(201).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save absence limits' });
  }
});

// ==================== ABSENCES ====================
export const absencesRouter = Router();

absencesRouter.get('/', (req, res) => {
  try {
    const { employeeId, year, month, status } = req.query;
    let sql = `
      SELECT a.*, at.name as typeName, at.icon as typeIcon, at.color as typeColor,
             e.firstName, e.lastName
      FROM absences a
      JOIN absence_types at ON a.absenceTypeId = at.id
      JOIN employees e ON a.employeeId = e.id
      WHERE 1=1
    `;
    const params: any[] = [];
    
    if (employeeId) {
      sql += ' AND a.employeeId = ?';
      params.push(employeeId);
    }
    if (year) {
      sql += ' AND (strftime("%Y", a.startDate) = ? OR strftime("%Y", a.endDate) = ?)';
      params.push(year, year);
    }
    if (month) {
      sql += ' AND (strftime("%m", a.startDate) = ? OR strftime("%m", a.endDate) = ?)';
      params.push(month.toString().padStart(2, '0'), month.toString().padStart(2, '0'));
    }
    if (status) {
      sql += ' AND a.status = ?';
      params.push(status);
    }
    
    sql += ' ORDER BY a.startDate DESC';
    
    const items = getAll(sql, params);
    res.json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch absences' });
  }
});

absencesRouter.post('/', (req, res) => {
  try {
    const { id, employeeId, absenceTypeId, startDate, endDate, workDays, status, note } = req.body;
    
    runQuery(`
      INSERT INTO absences (id, employeeId, absenceTypeId, startDate, endDate, workDays, status, note, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, employeeId, absenceTypeId, startDate, endDate, workDays, status || 'approved', note, Date.now()]);
    
    // Update used days in limits
    const currentYear = new Date(startDate).getFullYear();
    runQuery(`
      UPDATE employee_absence_limits 
      SET usedDays = usedDays + ?
      WHERE employeeId = ? AND absenceTypeId = ? AND year = ?
    `, [workDays, employeeId, absenceTypeId, currentYear]);
    
    res.status(201).json({ id, employeeId, absenceTypeId, startDate, endDate, workDays, status, note });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create absence' });
  }
});

absencesRouter.put('/:id', (req, res) => {
  try {
    const { employeeId, absenceTypeId, startDate, endDate, workDays, status, note } = req.body;
    
    // Get old absence to adjust used days
    const oldAbsence = getOne<any>('SELECT * FROM absences WHERE id = ?', [req.params.id]);
    
    runQuery(`
      UPDATE absences 
      SET employeeId = ?, absenceTypeId = ?, startDate = ?, endDate = ?, workDays = ?, status = ?, note = ?
      WHERE id = ?
    `, [employeeId, absenceTypeId, startDate, endDate, workDays, status, note, req.params.id]);
    
    // Adjust used days if workDays changed
    if (oldAbsence && oldAbsence.workDays !== workDays) {
      const diff = workDays - oldAbsence.workDays;
      const currentYear = new Date(startDate).getFullYear();
      runQuery(`
        UPDATE employee_absence_limits 
        SET usedDays = usedDays + ?
        WHERE employeeId = ? AND absenceTypeId = ? AND year = ?
      `, [diff, employeeId, absenceTypeId, currentYear]);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update absence' });
  }
});

absencesRouter.delete('/:id', (req, res) => {
  try {
    // Get absence to restore used days
    const absence = getOne<any>('SELECT * FROM absences WHERE id = ?', [req.params.id]);
    
    if (absence) {
      const currentYear = new Date(absence.startDate).getFullYear();
      runQuery(`
        UPDATE employee_absence_limits 
        SET usedDays = usedDays - ?
        WHERE employeeId = ? AND absenceTypeId = ? AND year = ?
      `, [absence.workDays, absence.employeeId, absence.absenceTypeId, currentYear]);
    }
    
    runQuery('DELETE FROM absences WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete absence' });
  }
});

// ==================== EMPLOYEE DETAILS ====================
export const employeeDetailsRouter = Router();

employeeDetailsRouter.get('/:employeeId', (req, res) => {
  try {
    const details = getOne('SELECT * FROM employee_details WHERE employeeId = ?', [req.params.employeeId]);
    res.json(details || {});
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch employee details' });
  }
});

employeeDetailsRouter.put('/:employeeId', (req, res) => {
  try {
    const { email, phone, birthDate, hireDate, department, position, contractType, workingHours, notes } = req.body;
    const employeeId = req.params.employeeId;
    
    const existing = getOne('SELECT employeeId FROM employee_details WHERE employeeId = ?', [employeeId]);
    
    if (existing) {
      runQuery(`
        UPDATE employee_details 
        SET email = ?, phone = ?, birthDate = ?, hireDate = ?, department = ?, position = ?, contractType = ?, workingHours = ?, notes = ?
        WHERE employeeId = ?
      `, [email, phone, birthDate, hireDate, department, position, contractType, workingHours, notes, employeeId]);
    } else {
      runQuery(`
        INSERT INTO employee_details (employeeId, email, phone, birthDate, hireDate, department, position, contractType, workingHours, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [employeeId, email, phone, birthDate, hireDate, department, position, contractType, workingHours, notes]);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update employee details' });
  }
});

// ==================== EMPLOYEE QUALIFICATIONS ====================
export const qualificationsRouter = Router();

qualificationsRouter.get('/', (req, res) => {
  try {
    const { employeeId } = req.query;
    let sql = `
      SELECT q.*, t.name as testName
      FROM employee_qualifications q
      JOIN tests t ON q.testId = t.id
    `;
    const params: any[] = [];
    
    if (employeeId) {
      sql += ' WHERE q.employeeId = ?';
      params.push(employeeId);
    }
    
    const items = getAll(sql, params);
    res.json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch qualifications' });
  }
});

qualificationsRouter.post('/', (req, res) => {
  try {
    const { id, employeeId, testId, level, certifiedAt, expiresAt } = req.body;
    
    const existing = getOne('SELECT id FROM employee_qualifications WHERE employeeId = ? AND testId = ?', [employeeId, testId]);
    
    if (existing) {
      runQuery(`
        UPDATE employee_qualifications 
        SET level = ?, certifiedAt = ?, expiresAt = ?
        WHERE employeeId = ? AND testId = ?
      `, [level, certifiedAt, expiresAt, employeeId, testId]);
    } else {
      runQuery(`
        INSERT INTO employee_qualifications (id, employeeId, testId, level, certifiedAt, expiresAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [id || `${employeeId}-${testId}`, employeeId, testId, level, certifiedAt, expiresAt]);
    }
    
    res.status(201).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to save qualification' });
  }
});

qualificationsRouter.delete('/:id', (req, res) => {
  try {
    runQuery('DELETE FROM employee_qualifications WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete qualification' });
  }
});

// ==================== HOLIDAYS ====================
export const holidaysRouter = Router();

holidaysRouter.get('/', (req, res) => {
  try {
    const { year } = req.query;
    let sql = 'SELECT * FROM holidays';
    const params: any[] = [];
    
    if (year) {
      sql += ' WHERE strftime("%Y", date) = ?';
      params.push(year);
    }
    
    sql += ' ORDER BY date';
    const items = getAll(sql, params);
    res.json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch holidays' });
  }
});

holidaysRouter.post('/', (req, res) => {
  try {
    const { date, name, isMovable } = req.body;
    runQuery(`
      INSERT OR REPLACE INTO holidays (id, date, name, isMovable)
      VALUES (?, ?, ?, ?)
    `, [date, date, name, isMovable ? 1 : 0]);
    res.status(201).json({ date, name, isMovable });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create holiday' });
  }
});

holidaysRouter.delete('/:date', (req, res) => {
  try {
    runQuery('DELETE FROM holidays WHERE date = ?', [req.params.date]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete holiday' });
  }
});

// ==================== EXTRA TASKS ====================
export const extraTasksRouter = Router();

extraTasksRouter.get('/', (req, res) => {
  try {
    const week = req.query.week as string | undefined;
    let items;
    if (week) {
      items = getAll('SELECT * FROM extra_tasks WHERE week = ? ORDER BY created_at', [week]);
    } else {
      items = getAll('SELECT * FROM extra_tasks ORDER BY week, created_at');
    }
    res.json(items);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch extra tasks' });
  }
});

extraTasksRouter.post('/', (req, res) => {
  try {
    const { id, name, week, timePerUnit, units, comment } = req.body;
    const created_at = req.body.created_at || Date.now();
    
    const existing = getOne('SELECT id FROM extra_tasks WHERE id = ?', [id]);
    if (existing) {
      runQuery(`
        UPDATE extra_tasks SET name = ?, week = ?, timePerUnit = ?, units = ?, comment = ?
        WHERE id = ?
      `, [name, week, timePerUnit || 15, units || 1, comment || null, id]);
    } else {
      runQuery(`
        INSERT INTO extra_tasks (id, name, week, timePerUnit, units, comment, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [id, name, week, timePerUnit || 15, units || 1, comment || null, created_at]);
    }
    
    saveDatabase();
    res.status(201).json({ id, name, week, timePerUnit, units, comment, created_at });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create/update extra task' });
  }
});

extraTasksRouter.put('/:id', (req, res) => {
  try {
    const { name, week, timePerUnit, units, comment } = req.body;
    runQuery(`
      UPDATE extra_tasks SET name = ?, week = ?, timePerUnit = ?, units = ?, comment = ?
      WHERE id = ?
    `, [name, week, timePerUnit || 15, units || 1, comment || null, req.params.id]);
    saveDatabase();
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update extra task' });
  }
});

extraTasksRouter.delete('/:id', (req, res) => {
  try {
    runQuery('DELETE FROM extra_tasks WHERE id = ?', [req.params.id]);
    // Also remove assignments for this extra task
    runQuery('DELETE FROM schedule_assignments WHERE projectId = ?', [`extra-${req.params.id}`]);
    saveDatabase();
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to delete extra task' });
  }
});
