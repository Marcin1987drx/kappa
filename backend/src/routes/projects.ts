import { Router } from 'express';
import { runQuery, getAll, getOne } from '../database/db.js';
import type { Project, WeekData } from '../types.js';

export const projectsRouter = Router();

// Get all projects with weeks data
projectsRouter.get('/', (req, res) => {
  try {
    const projects = getAll('SELECT * FROM projects ORDER BY created_at DESC') as any[];

    // Fetch weeks data for each project
    const projectsWithWeeks = projects.map(project => {
      const weeks = getAll('SELECT week, ist, soll FROM project_weeks WHERE project_id = ?', [project.id]) as any[];

      const weeksObj: { [key: string]: WeekData } = {};
      weeks.forEach(w => {
        weeksObj[w.week] = { ist: w.ist, soll: w.soll };
      });

      return {
        id: project.id,
        customer_id: project.customer_id,
        type_id: project.type_id,
        part_id: project.part_id,
        test_id: project.test_id,
        weeks: weeksObj,
        timePerUnit: project.time_per_unit || 0,
        created_at: project.created_at,
        updated_at: project.updated_at
      };
    });

    res.json(projectsWithWeeks);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch projects' });
  }
});

// Get project by ID
projectsRouter.get('/:id', (req, res) => {
  try {
    const project = getOne('SELECT * FROM projects WHERE id = ?', [req.params.id]) as any;
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const weeks = getAll('SELECT week, ist, soll FROM project_weeks WHERE project_id = ?', [project.id]) as any[];
    const weeksObj: { [key: string]: WeekData } = {};
    weeks.forEach(w => {
      weeksObj[w.week] = { ist: w.ist, soll: w.soll };
    });

    res.json({
      ...project,
      weeks: weeksObj
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch project' });
  }
});

// Create project
projectsRouter.post('/', (req, res) => {
  try {
    const { id, customer_id, type_id, part_id, test_id, weeks, timePerUnit, created_at, updated_at } = req.body;
    
    runQuery(`
      INSERT INTO projects (id, customer_id, type_id, part_id, test_id, time_per_unit, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [id, customer_id, type_id, part_id, test_id, timePerUnit || 0, created_at, updated_at]);

    // Insert weeks data
    if (weeks) {
      for (const [week, data] of Object.entries(weeks)) {
        runQuery(`
          INSERT INTO project_weeks (project_id, week, ist, soll)
          VALUES (?, ?, ?, ?)
        `, [id, week, (data as WeekData).ist, (data as WeekData).soll]);
      }
    }

    res.status(201).json(req.body);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// Update project
projectsRouter.put('/:id', (req, res) => {
  try {
    const { customer_id, type_id, part_id, test_id, weeks, timePerUnit, updated_at } = req.body;
    
    runQuery(`
      UPDATE projects 
      SET customer_id = ?, type_id = ?, part_id = ?, test_id = ?, time_per_unit = ?, updated_at = ?
      WHERE id = ?
    `, [customer_id, type_id, part_id, test_id, timePerUnit || 0, updated_at, req.params.id]);

    // Update weeks data
    if (weeks) {
      // Delete existing weeks
      runQuery('DELETE FROM project_weeks WHERE project_id = ?', [req.params.id]);
      
      // Insert new weeks data
      for (const [week, data] of Object.entries(weeks)) {
        runQuery(`
          INSERT INTO project_weeks (project_id, week, ist, soll)
          VALUES (?, ?, ?, ?)
        `, [req.params.id, week, (data as WeekData).ist, (data as WeekData).soll]);
      }
    }

    res.json(req.body);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update project' });
  }
});

// Update week data
projectsRouter.patch('/:id/weeks/:week', (req, res) => {
  try {
    const { ist, soll } = req.body;
    const { id, week } = req.params;

    // Check if week exists
    const existing = getOne('SELECT * FROM project_weeks WHERE project_id = ? AND week = ?', [id, week]);
    
    if (existing) {
      runQuery('UPDATE project_weeks SET ist = ?, soll = ? WHERE project_id = ? AND week = ?', [ist, soll, id, week]);
    } else {
      runQuery('INSERT INTO project_weeks (project_id, week, ist, soll) VALUES (?, ?, ?, ?)', [id, week, ist, soll]);
    }

    // Update project updated_at
    runQuery('UPDATE projects SET updated_at = ? WHERE id = ?', [Date.now(), id]);

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to update week data' });
  }
});

// Delete project
projectsRouter.delete('/:id', (req, res) => {
  try {
    runQuery('DELETE FROM projects WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete project' });
  }
});
