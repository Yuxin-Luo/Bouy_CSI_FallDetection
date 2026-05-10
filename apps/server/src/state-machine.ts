import { v4 as uuidv4 } from 'uuid';
import { db } from './db';
import { pushToHousehold } from './pusher';
import { sendSMS } from './sms';
import { config } from './config';

export type IncidentState =
  | 'DETECTED'
  | 'AWAITING_USER_RESPONSE'
  | 'CONTACTS_NOTIFIED'
  | 'CONTACT_RESPONDING'
  | 'ESCALATION_AVAILABLE'
  | 'ESCALATED'
  | 'RESOLVED';

interface Incident {
  id: string;
  household_id: string;
  user_id: string;
  device_id: string | null;
  state: IncidentState;
  confidence: number | null;
  metadata: string | null;
  detected_at: string;
  resolved_at: string | null;
  t1_deadline: string | null;
  t2_deadline: string | null;
  t3_deadline: string | null;
}

interface User {
  id: string;
  household_id: string;
  role: 'at_risk' | 'contact';
  name: string;
  phone: string;
}

interface Household {
  id: string;
  code: string;
}

// In-memory timer handles keyed by `${incidentId}:t1|t2|t3`
const timers = new Map<string, NodeJS.Timeout>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getIncident(id: string): Incident {
  const row = db.prepare('SELECT * FROM incidents WHERE id = ?').get(id) as Incident | undefined;
  if (!row) throw new Error(`Incident ${id} not found`);
  return row;
}

function getHousehold(id: string): Household {
  return db.prepare('SELECT * FROM households WHERE id = ?').get(id) as Household;
}

function getAtRiskUser(householdId: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE household_id = ? AND role = 'at_risk'").get(householdId) as User | undefined;
}

function getContacts(householdId: string): User[] {
  return db.prepare("SELECT * FROM users WHERE household_id = ? AND role = 'contact'").all(householdId) as User[];
}

function logEvent(incidentId: string, fromState: string | null, toState: string, actor: string, note?: string) {
  db.prepare(`
    INSERT INTO incident_events (id, incident_id, from_state, to_state, actor, note)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(uuidv4(), incidentId, fromState ?? null, toState, actor, note ?? null);
}

function transition(incidentId: string, toState: IncidentState, actor: string, note?: string) {
  const incident = getIncident(incidentId);
  const fromState = incident.state;

  const resolvedAt = ['RESOLVED', 'ESCALATED'].includes(toState) ? new Date().toISOString() : null;

  db.prepare(`UPDATE incidents SET state = ?, resolved_at = COALESCE(?, resolved_at) WHERE id = ?`)
    .run(toState, resolvedAt, incidentId);

  logEvent(incidentId, fromState, toState, actor, note);

  const household = getHousehold(incident.household_id);
  pushToHousehold(household.code, 'incident:update', {
    incidentId,
    fromState,
    toState,
    actor,
    note: note ?? null,
    timestamp: new Date().toISOString(),
  });

  console.log(`[SM] ${incidentId} ${fromState} → ${toState} (${actor})`);
}

function clearTimer(incidentId: string, key: 't1' | 't2' | 't3') {
  const k = `${incidentId}:${key}`;
  const t = timers.get(k);
  if (t) { clearTimeout(t); timers.delete(k); }
}

function scheduleTimer(incidentId: string, key: 't1' | 't2' | 't3', deadline: Date, fn: () => void) {
  clearTimer(incidentId, key);
  const delay = Math.max(0, deadline.getTime() - Date.now());
  const handle = setTimeout(fn, delay);
  timers.set(`${incidentId}:${key}`, handle);
  console.log(`[SM] Timer ${key} set for ${incidentId} in ${Math.round(delay / 1000)}s`);
}

// ─── Phase handlers ───────────────────────────────────────────────────────────

function startT1(incidentId: string) {
  const deadline = new Date(Date.now() + config.T1_MS);
  db.prepare('UPDATE incidents SET t1_deadline = ? WHERE id = ?').run(deadline.toISOString(), incidentId);

  scheduleTimer(incidentId, 't1', deadline, () => {
    const inc = getIncident(incidentId);
    if (inc.state !== 'AWAITING_USER_RESPONSE') return;
    console.log(`[SM] T1 expired for ${incidentId} — escalating to contacts`);
    notifyContacts(incidentId, 'T1_TIMEOUT').catch(console.error);
  });
}

async function notifyContacts(incidentId: string, actor: string) {
  const inc = getIncident(incidentId);
  clearTimer(incidentId, 't1');
  transition(incidentId, 'CONTACTS_NOTIFIED', actor);

  const household = getHousehold(inc.household_id);
  const contacts = getContacts(inc.household_id);
  const caregivers = db.prepare("SELECT * FROM caregivers WHERE household_id = ? AND phone != ''").all(inc.household_id) as { phone: string }[];
  const atRisk = getAtRiskUser(inc.household_id);

  const dashboardUrl = `${config.BASE_URL}/household/${household.code}/contact`;
  const alertMsg = `ALERT: ${atRisk?.name ?? 'A household member'} may have fallen and hasn't responded. Tap to respond: ${dashboardUrl}`;

  const allPhones = [
    ...contacts.map(c => c.phone),
    ...caregivers.map(c => c.phone),
  ];

  await Promise.all(allPhones.map(phone => sendSMS(phone, alertMsg)));

  startT2(incidentId);
}

function startT2(incidentId: string) {
  const deadline = new Date(Date.now() + config.T2_MS);
  db.prepare('UPDATE incidents SET t2_deadline = ? WHERE id = ?').run(deadline.toISOString(), incidentId);

  scheduleTimer(incidentId, 't2', deadline, () => {
    const inc = getIncident(incidentId);
    if (inc.state !== 'CONTACTS_NOTIFIED') return;
    console.log(`[SM] T2 expired for ${incidentId} — escalation available`);
    transition(incidentId, 'ESCALATION_AVAILABLE', 'T2_TIMEOUT');
    startT3(incidentId);
  });
}

function startT3(incidentId: string) {
  const deadline = new Date(Date.now() + config.T3_MS);
  db.prepare('UPDATE incidents SET t3_deadline = ? WHERE id = ?').run(deadline.toISOString(), incidentId);

  scheduleTimer(incidentId, 't3', deadline, () => {
    const inc = getIncident(incidentId);
    if (inc.state !== 'ESCALATION_AVAILABLE') return;
    // Auto-surface 911 prompt via Pusher — don't auto-trigger, require human click
    const household = getHousehold(inc.household_id);
    pushToHousehold(household.code, 'incident:911_prompt', {
      incidentId,
      message: 'No one has responded. Please consider calling 911.',
    });
    console.log(`[SM] T3 expired for ${incidentId} — 911 prompt sent`);
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface DetectPayload {
  device_id: string;
  timestamp?: string;
  event_type: string;
  confidence?: number;
  user_id?: string;
  metadata?: object;
}

export function createIncident(householdId: string, payload: DetectPayload): Incident {
  // Deduplicate: one active incident per household at a time
  const existing = db.prepare(`
    SELECT * FROM incidents
    WHERE household_id = ? AND state NOT IN ('RESOLVED', 'ESCALATED')
  `).get(householdId) as Incident | undefined;

  if (existing) {
    // If the old incident is past the point where the user can act, auto-resolve it
    // and allow a fresh detection (e.g. they fell again after being ignored)
    if (['ESCALATION_AVAILABLE', 'ESCALATED'].includes(existing.state)) {
      clearTimer(existing.id, 't1');
      clearTimer(existing.id, 't2');
      clearTimer(existing.id, 't3');
      db.prepare(`UPDATE incidents SET state='RESOLVED', resolved_at=datetime('now') WHERE id=?`).run(existing.id);
      logEvent(existing.id, existing.state, 'RESOLVED', 'system', 'Auto-resolved: new fall detected');
      console.log(`[SM] Auto-resolved stuck incident ${existing.id} — creating fresh one`);
      // fall through to create new incident
    } else {
      console.log(`[SM] Active incident ${existing.id} already exists for household — ignoring`);
      return existing;
    }
  }

  // Find the at-risk user
  let userId = payload.user_id;
  if (!userId) {
    const atRisk = getAtRiskUser(householdId);
    if (!atRisk) throw new Error('No at-risk user found in household');
    userId = atRisk.id;
  }

  const id = uuidv4();
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO incidents (id, household_id, user_id, device_id, state, confidence, metadata, detected_at)
    VALUES (?, ?, ?, ?, 'DETECTED', ?, ?, ?)
  `).run(
    id, householdId, userId,
    payload.device_id ?? null,
    payload.confidence ?? null,
    payload.metadata ? JSON.stringify(payload.metadata) : null,
    payload.timestamp ?? now
  );

  logEvent(id, null, 'DETECTED', 'system', `Confidence: ${payload.confidence ?? 'unknown'}`);

  const household = getHousehold(householdId);

  // Immediately move to AWAITING_USER_RESPONSE
  transition(id, 'AWAITING_USER_RESPONSE', 'system');

  // SMS the at-risk user with a direct link
  const atRisk = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User;
  const incidentUrl = `${config.BASE_URL}/household/${household.code}/at-risk?incident=${id}`;
  sendSMS(atRisk.phone,
    `Are you OK? We detected a possible fall. Tap to respond: ${incidentUrl}`
  ).catch(console.error);

  // Push alarm to the at-risk user's view
  pushToHousehold(household.code, 'incident:new', {
    incidentId: id,
    confidence: payload.confidence ?? null,
    deviceId: payload.device_id,
    t1DeadlineMs: config.T1_MS,
  });

  startT1(id);

  return getIncident(id);
}

export function userRespond(incidentId: string, response: 'ok' | 'help'): void {
  const inc = getIncident(incidentId);
  const contacts = getContacts(inc.household_id);
  const atRisk = getAtRiskUser(inc.household_id);

  // Late "I'm OK" — allow from any active state, resolves and notifies contacts
  if (response === 'ok' && ['CONTACTS_NOTIFIED', 'CONTACT_RESPONDING', 'ESCALATION_AVAILABLE'].includes(inc.state)) {
    clearTimer(incidentId, 't1');
    clearTimer(incidentId, 't2');
    clearTimer(incidentId, 't3');
    transition(incidentId, 'RESOLVED', 'at_risk_user', 'User confirmed they are OK (late response)');
    // No SMS on "I'm OK" — caregivers see the resolution via the dashboard in real time
    return;
  }

  if (inc.state !== 'AWAITING_USER_RESPONSE') {
    throw new Error(`Cannot respond from state ${inc.state}`);
  }

  clearTimer(incidentId, 't1');

  if (response === 'ok') {
    transition(incidentId, 'RESOLVED', 'at_risk_user', 'User confirmed they are OK');
    // No SMS on "I'm OK" — caregivers see the resolution via the dashboard in real time
  } else {
    notifyContacts(incidentId, 'at_risk_user').catch(console.error);
  }
}

export function contactAck(incidentId: string, contactName: string): void {
  const inc = getIncident(incidentId);
  if (!['CONTACTS_NOTIFIED', 'ESCALATION_AVAILABLE'].includes(inc.state)) {
    throw new Error(`Cannot ack from state ${inc.state}`);
  }

  clearTimer(incidentId, 't2');
  clearTimer(incidentId, 't3');
  transition(incidentId, 'CONTACT_RESPONDING', contactName, `${contactName} acknowledged and is responding`);

  // SMS the at-risk user so they know someone is coming
  const atRisk = getAtRiskUser(inc.household_id);
  if (atRisk) {
    sendSMS(atRisk.phone,
      `Help is on the way! ${contactName} has seen your alert and is responding.`
    ).catch(console.error);
  }
}

// "User was OK after all" — contact resolves the incident
export function contactResolve(incidentId: string, contactName: string): void {
  const inc = getIncident(incidentId);
  if (inc.state !== 'CONTACT_RESPONDING') {
    throw new Error(`Cannot resolve from state ${inc.state}`);
  }
  transition(incidentId, 'RESOLVED', contactName, 'Contact confirmed situation resolved');
}

export function trigger911(incidentId: string): void {
  const inc = getIncident(incidentId);
  if (inc.state !== 'ESCALATION_AVAILABLE') {
    throw new Error(`Cannot trigger 911 from state ${inc.state}`);
  }
  clearTimer(incidentId, 't3');
  transition(incidentId, 'ESCALATED', 'contact', '911 triggered (demo — mocked)');
}

// ─── Boot: re-hydrate timers for any active incidents ─────────────────────────

export function rehydrateTimers(): void {
  const active = db.prepare(`
    SELECT * FROM incidents WHERE state NOT IN ('RESOLVED', 'ESCALATED')
  `).all() as Incident[];

  console.log(`[SM] Re-hydrating ${active.length} active incident(s)`);

  const now = Date.now();

  for (const inc of active) {
    // If any deadline has already passed on restart, the incident is stale — auto-resolve it
    // rather than firing expired timers (which would spam 911 prompts on every redeploy).
    const t1Past = inc.t1_deadline && new Date(inc.t1_deadline).getTime() <= now;
    const t2Past = inc.t2_deadline && new Date(inc.t2_deadline).getTime() <= now;
    const t3Past = inc.t3_deadline && new Date(inc.t3_deadline).getTime() <= now;

    if (t3Past || (inc.state === 'ESCALATION_AVAILABLE' && t2Past)) {
      db.prepare(`UPDATE incidents SET state='RESOLVED', resolved_at=datetime('now') WHERE id=?`).run(inc.id);
      logEvent(inc.id, inc.state, 'RESOLVED', 'system', 'Auto-resolved: all deadlines expired before server restart');
      console.log(`[SM] Auto-resolved stale incident ${inc.id} on restart`);
      continue;
    }

    if (inc.state === 'AWAITING_USER_RESPONSE' && inc.t1_deadline && !t1Past) {
      scheduleTimer(inc.id, 't1', new Date(inc.t1_deadline), () => {
        const current = getIncident(inc.id);
        if (current.state !== 'AWAITING_USER_RESPONSE') return;
        notifyContacts(inc.id, 'T1_TIMEOUT').catch(console.error);
      });
    }

    if (inc.state === 'CONTACTS_NOTIFIED' && inc.t2_deadline && !t2Past) {
      scheduleTimer(inc.id, 't2', new Date(inc.t2_deadline), () => {
        const current = getIncident(inc.id);
        if (current.state !== 'CONTACTS_NOTIFIED') return;
        transition(inc.id, 'ESCALATION_AVAILABLE', 'T2_TIMEOUT');
        startT3(inc.id);
      });
    }

    if (inc.state === 'ESCALATION_AVAILABLE' && inc.t3_deadline && !t3Past) {
      scheduleTimer(inc.id, 't3', new Date(inc.t3_deadline), () => {
        const current = getIncident(inc.id);
        if (current.state !== 'ESCALATION_AVAILABLE') return;
        const household = getHousehold(current.household_id);
        pushToHousehold(household.code, 'incident:911_prompt', { incidentId: inc.id });
      });
    }
  }
}
