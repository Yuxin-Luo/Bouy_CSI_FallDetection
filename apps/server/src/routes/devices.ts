import { Router, Request, Response } from 'express';
import { db } from '../db';

const router = Router();

const STALE_MS = 10_000; // treat device offline if last telemetry > 10s ago

// GET /api/devices/:device_id/state
// Returns the most recent telemetry document + is_stale flag.
router.get('/:device_id/state', (req: Request, res: Response) => {
  const row = db.prepare('SELECT * FROM device_telemetry WHERE device_id = ?').get(req.params.device_id) as any;
  if (!row) return res.status(404).json({ error: 'No telemetry received for this device yet' });

  const ageMs = Date.now() - new Date(row.received_at).getTime();
  const payload = JSON.parse(row.payload);

  return res.json({ ...payload, is_stale: ageMs > STALE_MS, received_at: row.received_at });
});

// GET /api/devices/:device_id/incidents?limit=10
// Recent incidents for the household this device belongs to, newest first.
router.get('/:device_id/incidents', (req: Request, res: Response) => {
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(req.params.device_id) as any;
  if (!device) return res.status(404).json({ error: 'Device not registered' });

  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const incidents = db.prepare(`
    SELECT * FROM incidents WHERE household_id = ?
    ORDER BY detected_at DESC LIMIT ?
  `).all(device.household_id, limit);

  return res.json({ incidents });
});

export default router;
