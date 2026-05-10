import { Router, Request, Response } from 'express';
import { db } from '../db';
import {
  createIncident,
  userRespond,
  contactAck,
  contactResolve,
  trigger911,
  DetectPayload,
} from '../state-machine';

const router = Router();

// Model team / hardware hits this endpoint
// Also used by the "Simulate Fall" admin button
// POST /api/incidents/detect
router.post('/detect', (req: Request, res: Response) => {
  const payload: DetectPayload = req.body;

  if (!payload.device_id) {
    return res.status(400).json({ error: 'device_id is required' });
  }

  // Look up household by device_id
  const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(payload.device_id) as any;
  if (!device) {
    return res.status(404).json({ error: `Device ${payload.device_id} not registered to any household` });
  }

  // Check if monitoring is paused
  const ms = db.prepare('SELECT paused FROM monitoring_state WHERE household_id = ?').get(device.household_id) as any;
  if (ms?.paused) {
    console.log(`[/detect] Monitoring paused for household ${device.household_id} — skipping`);
    return res.json({ ok: true, skipped: true, reason: 'monitoring_paused' });
  }

  try {
    const incident = createIncident(device.household_id, payload);
    return res.json({ ok: true, incident });
  } catch (err: any) {
    console.error('[/detect]', err);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/incidents/:id
router.get('/:id', (req: Request, res: Response) => {
  const incident = db.prepare('SELECT * FROM incidents WHERE id = ?').get(req.params.id) as any;
  if (!incident) return res.status(404).json({ error: 'Not found' });

  const events = db.prepare('SELECT * FROM incident_events WHERE incident_id = ? ORDER BY timestamp ASC')
    .all(req.params.id);

  return res.json({ incident, events });
});

// POST /api/incidents/:id/respond — at-risk user responds
router.post('/:id/respond', (req: Request, res: Response) => {
  const { response } = req.body; // 'ok' | 'help'
  if (!['ok', 'help'].includes(response)) {
    return res.status(400).json({ error: 'response must be ok or help' });
  }
  try {
    userRespond(req.params.id, response);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/incidents/:id/ack — contact acknowledges and is responding; immediately resolves
router.post('/:id/ack', (req: Request, res: Response) => {
  const { contactName } = req.body;
  if (!contactName) return res.status(400).json({ error: 'contactName required' });
  try {
    contactAck(req.params.id, contactName);       // → CONTACT_RESPONDING + SMS at-risk user
    contactResolve(req.params.id, contactName);   // → RESOLVED
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/incidents/:id/resolve — contact marks situation resolved
router.post('/:id/resolve', (req: Request, res: Response) => {
  const { contactName } = req.body;
  if (!contactName) return res.status(400).json({ error: 'contactName required' });
  try {
    contactResolve(req.params.id, contactName);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/incidents/:id/911 — trigger 911 (mocked)
router.post('/:id/911', (_req: Request, res: Response) => {
  try {
    trigger911(_req.params.id);
    return res.json({ ok: true });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// POST /api/incidents/:id/admin-reset — force resolve any stuck incident (demo tool)
router.post('/:id/admin-reset', (req: Request, res: Response) => {
  db.prepare(`UPDATE incidents SET state='RESOLVED', resolved_at=datetime('now') WHERE id=?`).run(req.params.id);
  return res.json({ ok: true });
});

// POST /api/admin/reset-household/:code — clear all active incidents for a household (demo tool)
router.post('/admin/reset/:code', (req: Request, res: Response) => {
  const household = db.prepare('SELECT * FROM households WHERE code = ?').get(req.params.code) as any;
  if (!household) return res.status(404).json({ error: 'Not found' });
  const result = db.prepare(`UPDATE incidents SET state='RESOLVED', resolved_at=datetime('now') WHERE household_id=? AND state NOT IN ('RESOLVED','ESCALATED')`).run(household.id);
  return res.json({ ok: true, cleared: result.changes });
});

export default router;
