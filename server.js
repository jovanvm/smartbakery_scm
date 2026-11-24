import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedDatabase } from './src/database/seed.js';
import { errorHandler, notFoundHandler } from './src/middleware/error-handler.js';
import apiRoutes from './src/routes/api.routes.js';

dotenv.config();

const seedResult = await seedDatabase();
const app = express();
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(currentDir, 'public');
const indexPath = path.join(publicDir, 'index.html');
const port = Number(process.env.PORT) || 3000;

app.locals.seedResult = seedResult;
app.disable('x-powered-by');
app.use(express.json());
app.use(express.static(publicDir));
app.use('/api', apiRoutes);
app.use('/api', notFoundHandler);

app.use((_request, response) => {
  response.sendFile(indexPath);
});

app.use(errorHandler);

app.listen(port, () => {
  console.log(`SmartBakery SCM berjalan di http://localhost:${port}`);
  console.log(`Seed database: ${seedResult.seeded ? 'diterapkan' : seedResult.reason}`);
});
