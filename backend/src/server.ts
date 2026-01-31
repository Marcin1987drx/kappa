import express from 'express';
import cors from 'cors';
import { customersRouter, typesRouter, partsRouter, testsRouter, settingsRouter, dataRouter } from './routes/index.js';
import { projectsRouter } from './routes/projects.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// Routes
app.use('/api/customers', customersRouter);
app.use('/api/types', typesRouter);
app.use('/api/parts', partsRouter);
app.use('/api/tests', testsRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/data', dataRouter);

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Backend server running on http://localhost:${PORT}`);
  console.log(`📊 API endpoint: http://localhost:${PORT}/api`);
});

export default app;
