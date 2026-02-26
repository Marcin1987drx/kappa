import express from 'express';
import cors from 'cors';
import { customersRouter, typesRouter, partsRouter, testsRouter, settingsRouter, dataRouter } from './routes/index.js';
import { projectsRouter } from './routes/projects.js';
import { 
  employeesRouter, 
  scheduleAssignmentsRouter, 
  logsRouter, 
  commentsRouter, 
  preferencesRouter, 
  templatesRouter,
  absenceTypesRouter,
  absenceLimitsRouter,
  absencesRouter,
  employeeDetailsRouter,
  qualificationsRouter,
  holidaysRouter,
  extraTasksRouter
} from './routes/schedule.js';
import { initDatabase } from './database/db.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Routes
app.use('/api/customers', customersRouter);
app.use('/api/types', typesRouter);
app.use('/api/parts', partsRouter);
app.use('/api/tests', testsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/data', dataRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/schedule-assignments', scheduleAssignmentsRouter);
app.use('/api/logs', logsRouter);
app.use('/api/comments', commentsRouter);
app.use('/api/preferences', preferencesRouter);
app.use('/api/templates', templatesRouter);
app.use('/api/absence-types', absenceTypesRouter);
app.use('/api/absence-limits', absenceLimitsRouter);
app.use('/api/absences', absencesRouter);
app.use('/api/employee-details', employeeDetailsRouter);
app.use('/api/qualifications', qualificationsRouter);
app.use('/api/holidays', holidaysRouter);
app.use('/api/extra-tasks', extraTasksRouter);

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Initialize database and start server
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`🚀 Backend server running on http://localhost:${PORT}`);
    console.log(`📊 API endpoint: http://localhost:${PORT}/api`);
  });
}).catch((err) => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
