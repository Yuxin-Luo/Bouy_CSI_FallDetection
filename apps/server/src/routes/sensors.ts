// POST /api/telemetry — receives the ~2s telemetry stream from the CSI device.
// Upserts one row per device_id; no history kept server-side.
// The device posts falls separately to POST /api/incidents/detect.

import { Router, Request, Response } from 'express';
import { db } from '../db';

const router = Router();

router.post('/', (req: Request, res: Response) => {
  const body = req.body;
  const { device_id } = body;

  if (!device_id) {
    return res.status(400).json({ error: 'device_id is required' });
  }

  const receivedAt = new Date().toISOString();
  db.prepare(`
    INSERT INTO device_telemetry (device_id, payload, received_at)
    VALUES (?, ?, ?)
    ON CONFLICT(device_id) DO UPDATE SET
      payload     = excluded.payload,
      received_at = excluded.received_at
  `).run(device_id, JSON.stringify(body), receivedAt);

  return res.json({ ok: true });
});

export default router;
