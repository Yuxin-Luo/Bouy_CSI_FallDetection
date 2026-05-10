import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';

const router = Router();

// Create or join a household
// POST /api/households/join
router.post('/join', (req: Request, res: Response) => {
  const { code, name, phone, role } = req.body;

  if (!code || !name || !phone || !role) {
    return res.status(400).json({ error: 'code, name, phone, role are required' });
  }

  if (!['at_risk', 'contact'].includes(role)) {
    return res.status(400).json({ error: 'role must be at_risk or contact' });
  }

  // Find or create the household
  let household = db.prepare('SELECT * FROM households WHERE code = ?').get(code) as any;
  if (!household) {
    household = { id: uuidv4(), code };
    db.prepare('INSERT INTO households (id, code) VALUES (?, ?)').run(household.id, household.code);
  }

  // Enforce one at-risk user per household
  if (role === 'at_risk') {
    const existing = db.prepare("SELECT id FROM users WHERE household_id = ? AND role = 'at_risk'").get(household.id);
    if (existing) {
      return res.status(409).json({ error: 'This household already has an at-risk user' });
    }
  }

  const userId = uuidv4();
  db.prepare('INSERT INTO users (id, household_id, role, name, phone) VALUES (?, ?, ?, ?, ?)')
    .run(userId, household.id, role, name, phone);

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);

  return res.json({ household, user });
});

// GET /api/households/:code — fetch household info + members
router.get('/:code', (req: Request, res: Response) => {
  const household = db.prepare('SELECT * FROM households WHERE code = ?').get(req.params.code) as any;
  if (!household) return res.status(404).json({ error: 'Household not found' });

  const members = db.prepare('SELECT id, name, role, phone FROM users WHERE household_id = ?').all(household.id);
  const activeIncident = db.prepare(`
    SELECT * FROM incidents
    WHERE household_id = ? AND state NOT IN ('RESOLVED', 'ESCALATED')
    ORDER BY detected_at DESC LIMIT 1
  `).get(household.id);

  const devices = db.prepare('SELECT id FROM devices WHERE household_id = ?').all(household.id) as any[];
  const ms = db.prepare('SELECT * FROM monitoring_state WHERE household_id = ?').get(household.id) as any;
  const monitoring = { paused: !!ms?.paused, pause_requested: !!ms?.pause_requested };

  return res.json({ household, members, activeIncident: activeIncident ?? null, devices, monitoring });
});

// GET /api/households/:code/incidents — recent incident history
router.get('/:code/incidents', (req: Request, res: Response) => {
  const household = db.prepare('SELECT * FROM households WHERE code = ?').get(req.params.code) as any;
  if (!household) return res.status(404).json({ error: 'Household not found' });

  const incidents = db.prepare(`
    SELECT * FROM incidents WHERE household_id = ?
    ORDER BY detected_at DESC LIMIT 20
  `).all(household.id);

  return res.json({ incidents });
});

// ── Household profile (resident name override) ────────────────────────────────

// GET /api/households/:code/profile
router.get('/:code/profile', (req: Request, res: Response) => {
  const household = db.prepare('SELECT * FROM households WHERE code = ?').get(req.params.code) as any;
  if (!household) return res.status(404).json({ error: 'Household not found' });
  const profile = db.prepare('SELECT * FROM household_profile WHERE household_id = ?').get(household.id) as any;
  return res.json({ resident_name: profile?.resident_name ?? null });
});

// PATCH /api/households/:code/profile
router.patch('/:code/profile', (req: Request, res: Response) => {
  const { resident_name } = req.body;
  const household = db.prepare('SELECT * FROM households WHERE code = ?').get(req.params.code) as any;
  if (!household) return res.status(404).json({ error: 'Household not found' });
  db.prepare(`
    INSERT INTO household_profile (household_id, resident_name, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(household_id) DO UPDATE SET resident_name = excluded.resident_name, updated_at = excluded.updated_at
  `).run(household.id, resident_name ?? null);
  return res.json({ ok: true, resident_name });
});

// ── Caregivers ────────────────────────────────────────────────────────────────

// GET /api/households/:code/caregivers
router.get('/:code/caregivers', (req: Request, res: Response) => {
  const household = db.prepare('SELECT * FROM households WHERE code = ?').get(req.params.code) as any;
  if (!household) return res.status(404).json({ error: 'Household not found' });
  const caregivers = db.prepare('SELECT * FROM caregivers WHERE household_id = ? ORDER BY created_at ASC').all(household.id);
  return res.json({ caregivers });
});

// POST /api/households/:code/caregivers
router.post('/:code/caregivers', (req: Request, res: Response) => {
  const { name, role, phone } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  const household = db.prepare('SELECT * FROM households WHERE code = ?').get(req.params.code) as any;
  if (!household) return res.status(404).json({ error: 'Household not found' });
  const id = uuidv4();
  db.prepare('INSERT INTO caregivers (id, household_id, name, role, phone) VALUES (?, ?, ?, ?, ?)')
    .run(id, household.id, name, role ?? '', phone ?? '');
  const caregiver = db.prepare('SELECT * FROM caregivers WHERE id = ?').get(id) as any;

  // Welcome message — onboards them to WhatsApp alerts automatically
  if (caregiver.phone) {
    const profile = db.prepare('SELECT resident_name FROM household_profile WHERE household_id = ?').get(household.id) as any;
    const atRisk = db.prepare("SELECT name FROM users WHERE household_id = ? AND role = 'at_risk'").get(household.id) as any;
    const residentName = profile?.resident_name || atRisk?.name || 'a resident';
    const dashboardUrl = `${config.BASE_URL}/household/${req.params.code}/contact`;
    sendSMS(caregiver.phone,
      `Hi ${name}! You've been added as a caregiver for ${residentName} on Bouy. ` +
      `You'll receive fall detection alerts here. View the dashboard: ${dashboardUrl}`
    ).catch(console.error);
  }

  return res.status(201).json({ caregiver });
});

// PUT /api/households/:code/caregivers/:id
router.put('/:code/caregivers/:id', (req: Request, res: Response) => {
  const { name, role, phone } = req.body;
  const household = db.prepare('SELECT * FROM households WHERE code = ?').get(req.params.code) as any;
  if (!household) return res.status(404).json({ error: 'Household not found' });
  const existing = db.prepare('SELECT * FROM caregivers WHERE id = ? AND household_id = ?').get(req.params.id, household.id);
  if (!existing) return res.status(404).json({ error: 'Caregiver not found' });
  db.prepare('UPDATE caregivers SET name = ?, role = ?, phone = ? WHERE id = ?')
    .run(name ?? (existing as any).name, role ?? (existing as any).role, phone ?? (existing as any).phone, req.params.id);
  const updated = db.prepare('SELECT * FROM caregivers WHERE id = ?').get(req.params.id);
  return res.json({ caregiver: updated });
});

// DELETE /api/households/:code/caregivers/:id
router.delete('/:code/caregivers/:id', (req: Request, res: Response) => {
  const household = db.prepare('SELECT * FROM households WHERE code = ?').get(req.params.code) as any;
  if (!household) return res.status(404).json({ error: 'Household not found' });
  db.prepare('DELETE FROM caregivers WHERE id = ? AND household_id = ?').run(req.params.id, household.id);
  return res.json({ ok: true });
});

// ── Monitoring pause ──────────────────────────────────────────────────────────
import { pushToHousehold } from '../pusher';
import { sendSMS } from '../sms';
import { config } from '../config';

function upsertMonitoring(householdId: string, paused: number, pause_requested: number) {
  db.prepare(`
    INSERT INTO monitoring_state (household_id, paused, pause_requested, updated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(household_id) DO UPDATE SET
      paused = excluded.paused,
      pause_requested = excluded.pause_requested,
      updated_at = excluded.updated_at
  `).run(householdId, paused, pause_requested);
}

// POST /api/households/:code/monitoring/request — at-risk user requests a pause
router.post('/:code/monitoring/request', (req: Request, res: Response) => {
  const household = db.prepare('SELECT * FROM households WHERE code = ?').get(req.params.code) as any;
  if (!household) return res.status(404).json({ error: 'Household not found' });
  upsertMonitoring(household.id, 0, 1);
  pushToHousehold(req.params.code, 'monitoring:update', { paused: false, pause_requested: true });
  return res.json({ ok: true });
});

// POST /api/households/:code/monitoring/approve — caregiver approves the pause
router.post('/:code/monitoring/approve', (req: Request, res: Response) => {
  const household = db.prepare('SELECT * FROM households WHERE code = ?').get(req.params.code) as any;
  if (!household) return res.status(404).json({ error: 'Household not found' });
  upsertMonitoring(household.id, 1, 0);
  pushToHousehold(req.params.code, 'monitoring:update', { paused: true, pause_requested: false });
  return res.json({ ok: true });
});

// POST /api/households/:code/monitoring/resume — anyone can resume
router.post('/:code/monitoring/resume', (req: Request, res: Response) => {
  const household = db.prepare('SELECT * FROM households WHERE code = ?').get(req.params.code) as any;
  if (!household) return res.status(404).json({ error: 'Household not found' });
  upsertMonitoring(household.id, 0, 0);
  pushToHousehold(req.params.code, 'monitoring:update', { paused: false, pause_requested: false });
  return res.json({ ok: true });
});

// Admin: register a device to a household
// POST /api/households/:code/devices
router.post('/:code/devices', (req: Request, res: Response) => {
  const { device_id } = req.body;
  const household = db.prepare('SELECT * FROM households WHERE code = ?').get(req.params.code) as any;
  if (!household) return res.status(404).json({ error: 'Household not found' });

  db.prepare('INSERT OR REPLACE INTO devices (id, household_id) VALUES (?, ?)').run(device_id, household.id);
  return res.json({ ok: true, device_id, household_id: household.id });
});

export default router;
