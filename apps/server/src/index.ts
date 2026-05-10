import express from 'express';
import cors from 'cors';
import { config } from './config';
import { rehydrateTimers } from './state-machine';
import { seedIfEmpty } from './seed';
import householdsRouter from './routes/households';
import incidentsRouter from './routes/incidents';
import telemetryRouter from './routes/sensors';   // POST /api/telemetry
import devicesRouter from './routes/devices';      // GET  /api/devices/:id/...

const app = express();

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Routes
app.use('/api/households', householdsRouter);
app.use('/api/incidents', incidentsRouter);
app.use('/api/telemetry', telemetryRouter);
app.use('/api/devices', devicesRouter);

// Seed demo data and re-hydrate timers on boot
seedIfEmpty();
rehydrateTimers();

app.listen(config.PORT, () => {
  console.log(`[server] Running on http://localhost:${config.PORT}`);
});
