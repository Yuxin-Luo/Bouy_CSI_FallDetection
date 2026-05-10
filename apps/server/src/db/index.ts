import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/app.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS households (
    id   TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    role         TEXT NOT NULL CHECK(role IN ('at_risk', 'contact')),
    name         TEXT NOT NULL,
    phone        TEXT NOT NULL,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS devices (
    id           TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS incidents (
    id           TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    user_id      TEXT NOT NULL REFERENCES users(id),
    device_id    TEXT,
    state        TEXT NOT NULL DEFAULT 'DETECTED',
    confidence   REAL,
    metadata     TEXT,
    detected_at  TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at  TEXT,
    t1_deadline  TEXT,
    t2_deadline  TEXT,
    t3_deadline  TEXT
  );

  CREATE TABLE IF NOT EXISTS incident_events (
    id          TEXT PRIMARY KEY,
    incident_id TEXT NOT NULL REFERENCES incidents(id),
    from_state  TEXT,
    to_state    TEXT NOT NULL,
    actor       TEXT,
    note        TEXT,
    timestamp   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS caregivers (
    id           TEXT PRIMARY KEY,
    household_id TEXT NOT NULL REFERENCES households(id),
    name         TEXT NOT NULL,
    role         TEXT NOT NULL DEFAULT '',
    phone        TEXT NOT NULL DEFAULT '',
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS household_profile (
    household_id  TEXT PRIMARY KEY REFERENCES households(id),
    resident_name TEXT,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sensor_status (
    sensor_id    TEXT NOT NULL,
    household_id TEXT NOT NULL REFERENCES households(id),
    device_id    TEXT,
    packet_rate  REAL,
    rssi         REAL,
    last_seen    TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (sensor_id, household_id)
  );

  CREATE TABLE IF NOT EXISTS device_telemetry (
    device_id   TEXT PRIMARY KEY,
    payload     TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS monitoring_state (
    household_id    TEXT PRIMARY KEY REFERENCES households(id),
    paused          INTEGER NOT NULL DEFAULT 0,
    pause_requested INTEGER NOT NULL DEFAULT 0,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);
