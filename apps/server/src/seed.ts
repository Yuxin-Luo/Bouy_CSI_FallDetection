import { db } from './db';
import { v4 as uuidv4 } from 'uuid';

const HOUSEHOLD_CODE = '483920';
const DEVICES = ['csi-board-01', 'phone-accelerometer'];
const USERS = [
  { name: 'Margaret', phone: '+14089135478', role: 'at_risk' as const },
  { name: 'John',     phone: '+16692089723', role: 'contact' as const },
  { name: 'Roommate 2', phone: '+14086566336', role: 'contact' as const },
];

export function seedIfEmpty() {
  let household = db.prepare('SELECT * FROM households WHERE code = ?').get(HOUSEHOLD_CODE) as any;

  if (!household) {
    household = { id: uuidv4(), code: HOUSEHOLD_CODE };
    db.prepare('INSERT INTO households (id, code) VALUES (?, ?)').run(household.id, household.code);
    console.log('[seed] Created household', HOUSEHOLD_CODE);
  }

  for (const u of USERS) {
    const exists = db.prepare('SELECT id FROM users WHERE household_id = ? AND phone = ?').get(household.id, u.phone);
    if (!exists) {
      if (u.role === 'at_risk') {
        const atRiskExists = db.prepare("SELECT id FROM users WHERE household_id = ? AND role = 'at_risk'").get(household.id);
        if (atRiskExists) continue;
      }
      db.prepare('INSERT INTO users (id, household_id, role, name, phone) VALUES (?, ?, ?, ?, ?)')
        .run(uuidv4(), household.id, u.role, u.name, u.phone);
      console.log('[seed] Added user', u.name);
    }
  }

  for (const deviceId of DEVICES) {
    const exists = db.prepare('SELECT id FROM devices WHERE id = ?').get(deviceId);
    if (!exists) {
      db.prepare('INSERT INTO devices (id, household_id) VALUES (?, ?)').run(deviceId, household.id);
      console.log('[seed] Registered device', deviceId);
    }
  }
}
