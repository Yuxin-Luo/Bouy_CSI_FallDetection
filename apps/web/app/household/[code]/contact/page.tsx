'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { subscribeToHousehold } from '@/lib/pusher-client';
import { api } from '@/lib/api';

type IncidentState =
  | 'DETECTED' | 'AWAITING_USER_RESPONSE' | 'CONTACTS_NOTIFIED'
  | 'CONTACT_RESPONDING' | 'ESCALATION_AVAILABLE' | 'ESCALATED' | 'RESOLVED';

interface Incident {
  id: string; state: IncidentState; confidence: number | null;
  device_id: string | null; detected_at: string; resolved_at: string | null;
}
interface SensorInfo {
  online: boolean;
  rate_hz: number;
  error: string | null;
}

interface DeviceState {
  device_id: string;
  event_type: string;
  timestamp: string;
  fall_probability: number;
  state: 'WARMUP' | 'IDLE' | 'WATCHING' | 'ALERT';
  threshold: number;
  room_occupied: boolean;
  sensors_online_count: number;
  sensors_total_count: number;
  sensors: Record<string, SensorInfo>;
  is_stale: boolean;
  received_at: string;
}

interface HouseholdData {
  members: { id: string; name: string; role: string }[];
  activeIncident: Incident | null;
  devices: { id: string }[];
  monitoring: { paused: boolean; pause_requested: boolean };
}

// ── Hearth design tokens ──────────────────────────────────────────────────────
const tk = {
  bg: '#F4F6F1',
  card: '#FFFFFF',
  cardSubtle: '#EFF3EC',
  border: 'rgba(46,90,62,0.12)',
  text: '#1C3826',
  text2: 'rgba(28,56,38,0.80)',
  text3: 'rgba(28,56,38,0.52)',
  text4: 'rgba(28,56,38,0.28)',
  primary: '#2E5A3E',
  primarySoft: '#E6F0E9',
  success: '#2D7A45',
  successBg: '#E6F0E9',
  destructive: '#B84D2A',
  destructiveBg: '#FAE5DE',
  warning: '#9A7B1E',
  warningBg: '#E0F4F4',
  shadow: '0 4px 20px -4px rgba(46,90,62,0.12)',
  shadowCard: '0 1px 3px rgba(46,90,62,0.06), 0 4px 16px -4px rgba(46,90,62,0.10)',
  serif: '"Instrument Serif", ui-serif, Georgia, serif',
  sans: '"Inter", ui-sans-serif, system-ui, sans-serif',
};

type Tab = 'home' | 'map' | 'alerts';

interface Caregiver {
  id: string;
  name: string;
  role: string;
  phone: string;
}

function stateLabel(s: IncidentState) {
  const m: Record<IncidentState, string> = {
    DETECTED: 'Detected', AWAITING_USER_RESPONSE: 'Waiting for response',
    CONTACTS_NOTIFIED: 'Contacts notified', CONTACT_RESPONDING: 'Contact responding',
    ESCALATION_AVAILABLE: 'No response — escalation available',
    ESCALATED: 'Emergency services called', RESOLVED: 'Resolved',
  };
  return m[s] ?? s;
}

// ── Floor plan — matches Hearth HomeMap style ─────────────────────────────────
// Room layout matches home-data.tsx from inspo:
//   [Room 1][Room 2][Open Living (CSI)][Room 3][Room 4]
//   ══════════════════ hallway ═══════════════════════
// viewBox 600 × 190
function FloorPlan({ incident, mini = false, csiActive = false }: { incident: Incident | null; mini?: boolean; csiActive?: boolean }) {
  const isAlert = !!incident;

  // Room definitions (mirroring home-data.tsx)
  const rooms = [
    { id: 'r1',   name: 'Room 1',      type: 'bedroom', x: 20,  y: 20, width: 100, height: 100 },
    { id: 'r2',   name: 'Room 2',      type: 'bedroom', x: 130, y: 20, width: 100, height: 100 },
    { id: 'open', name: 'Open Living', type: 'living',  x: 240, y: 20, width: 120, height: 100 },
    { id: 'r3',   name: 'Room 3',      type: 'bedroom', x: 370, y: 20, width: 100, height: 100 },
    { id: 'r4',   name: 'Room 4',      type: 'bedroom', x: 480, y: 20, width: 100, height: 100 },
    { id: 'hall', name: 'Hallway',     type: 'hallway', x: 20,  y: 130, width: 560, height: 40 },
  ];

  return (
    <svg
      id="apartmentMapSvg"
      viewBox="0 0 600 190"
      width="100%"
      style={{ display: 'block' }}
      role="img"
      aria-label="Top-down map of the apartment"
    >
      {/* Rooms */}
      {rooms.map(r => {
        const isLiving = r.type === 'living';
        const isHall = r.type === 'hallway';
        const isHighlighted = isLiving && isAlert;
        const fill = isLiving
          ? (isAlert ? tk.destructiveBg : tk.primarySoft)
          : isHall ? '#EFF3EC'
          : tk.card;
        return (
          <g key={r.id}>
            <rect
              x={r.x} y={r.y} width={r.width} height={r.height}
              rx={isHall ? 6 : 8}
              fill={fill}
              stroke={isHighlighted ? tk.destructive : 'rgba(46,90,62,0.18)'}
              strokeWidth={isHighlighted ? 2 : 1.2}
            />
            <text
              x={r.x + r.width / 2}
              y={isHall ? r.y + r.height / 2 + 4 : r.y + r.height - 12}
              textAnchor="middle"
              fontSize={isHall ? 10 : 11}
              fill={isHighlighted ? tk.destructive : 'rgba(28,56,38,0.52)'}
              fontFamily="Inter, sans-serif"
              fontWeight={isLiving ? 600 : 500}
            >
              {r.name}
            </text>
            {isLiving && (
              <text
                x={r.x + r.width / 2}
                y={r.y + r.height - 28}
                textAnchor="middle"
                fontSize={8}
                fill={isAlert ? tk.destructive : 'rgba(46,90,62,0.45)'}
                fontFamily="Inter, sans-serif"
                fontWeight={700}
                letterSpacing={0.6}
              >
                {isAlert ? 'FALL DETECTED' : csiActive ? 'CSI ACTIVE' : 'CSI OFFLINE'}
              </text>
            )}
          </g>
        );
      })}

    </svg>
  );
}

// Export helpers
function getExportableSvgText(): string {
  const el = document.getElementById('apartmentMapSvg');
  if (!el) return '';
  const clone = el.cloneNode(true) as SVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', '1440');
  clone.setAttribute('height', '760');
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}
function exportSvg() {
  downloadBlob(new Blob([getExportableSvgText()], { type: 'image/svg+xml' }), 'hearth-floor-plan.svg');
}
function exportPng() {
  const text = getExportableSvgText();
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = 1440; c.height = 760;
    c.getContext('2d')!.drawImage(img, 0, 0, 1440, 760);
    c.toBlob(b => b && downloadBlob(b, 'hearth-floor-plan.png'));
    URL.revokeObjectURL(url);
  };
  img.src = url;
}

// ── Variance sparkline ────────────────────────────────────────────────────────
function VarianceTrace({ color = tk.destructive, height = 28 }: { color?: string; height?: number }) {
  const N = 60;
  const pts: string[] = [];
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 100;
    let y = 50 + Math.sin(i * 0.55) * 5 + Math.sin(i * 1.3) * 3;
    if (i > N * 0.5 && i < N * 0.75) {
      const k = (i - N * 0.5) / (N * 0.25);
      y = 50 - Math.sin(k * Math.PI) * 38;
    }
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height={height} style={{ display: 'block' }}>
      <polyline points={pts.join(' ')} fill="none" stroke={color}
        strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────────
function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: tk.card,
      borderRadius: 16,
      padding: 16,
      marginBottom: 12,
      border: '1px solid rgba(46,90,62,0.10)',
      boxShadow: tk.shadowCard,
      ...style,
    }}>{children}</div>
  );
}

// ── Pill ──────────────────────────────────────────────────────────────────────
function Pill({ children, kind = 'green' }: { children: React.ReactNode; kind?: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    green:  { bg: tk.successBg,     fg: tk.success },
    red:    { bg: tk.destructiveBg, fg: tk.destructive },
    orange: { bg: tk.warningBg,     fg: tk.warning },
    blue:   { bg: tk.primarySoft,   fg: tk.primary },
  };
  const { bg, fg } = map[kind] ?? map.green;
  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center',
      background: bg, color: fg,
      borderRadius: 10, padding: '3px 10px',
      fontFamily: tk.sans, fontSize: 12, fontWeight: 600, letterSpacing: 0.2,
    }}>{children}</div>
  );
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '4px 4px 10px' }}>
      <h2 style={{ fontFamily: tk.sans, fontSize: 22, fontWeight: 400, color: tk.text, margin: 0 }}>{title}</h2>
      {action && (
        <button onClick={onAction} style={{ fontFamily: tk.sans, fontSize: 13, color: tk.primary,
          background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}>
          {action}
        </button>
      )}
    </div>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────
function TabBar({ active, onSelect, hasAlert }: { active: Tab; onSelect: (t: Tab) => void; hasAlert: boolean }) {
  const items: { k: Tab; label: string; icon: string }[] = [
    { k: 'home',   label: 'Home',   icon: 'M12 3 2 12h3v8h5v-6h4v6h5v-8h3z' },
    { k: 'map',    label: 'Map',    icon: 'M3 5v15l6-2 6 2 6-2V3l-6 2-6-2zM9 4v14M15 6v14' },
    { k: 'alerts', label: 'Alerts', icon: 'M6 9a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9zM10 21a2 2 0 0 0 4 0' },
  ];
  return (
    <div style={{
      position: 'fixed', bottom: 0, zIndex: 100,
      left: '50%', transform: 'translateX(-50%)',
      width: '100%', maxWidth: 600,
      display: 'flex', alignItems: 'flex-start',
      paddingTop: 10,
      paddingBottom: 'max(22px, env(safe-area-inset-bottom))',
      paddingLeft: 4, paddingRight: 4,
      background: 'rgba(244,246,241,0.90)',
      backdropFilter: 'blur(24px) saturate(180%)',
      WebkitBackdropFilter: 'blur(24px) saturate(180%)',
      borderTop: '1px solid rgba(46,90,62,0.12)',
      borderLeft: '1px solid rgba(46,90,62,0.08)',
      borderRight: '1px solid rgba(46,90,62,0.08)',
    }}>
      {items.map(it => {
        const on = it.k === active;
        const color = on ? tk.primary : tk.text3;
        return (
          <button key={it.k} onClick={() => onSelect(it.k)}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 4, background: 'none', border: 'none', cursor: 'pointer', position: 'relative',
              padding: '0 4px' }}>
            <div style={{ position: 'relative' }}>
              {on && (
                <div style={{
                  position: 'absolute', inset: -6, borderRadius: 12,
                  background: tk.primarySoft, zIndex: -1,
                }} />
              )}
              <svg width="24" height="24" viewBox="0 0 24 24"
                fill={on ? tk.primary : 'none'}
                stroke={on ? 'none' : color}
                strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d={it.icon} />
              </svg>
              {it.k === 'alerts' && hasAlert && (
                <div style={{
                  position: 'absolute', top: -3, right: -9, width: 18, height: 18,
                  borderRadius: 9, background: tk.destructive,
                  border: '2px solid rgba(244,246,241,0.90)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700, color: 'white', fontFamily: tk.sans,
                }}>1</div>
              )}
            </div>
            <div style={{ fontFamily: tk.sans, fontSize: 10, fontWeight: on ? 600 : 500,
              color, letterSpacing: 0.1 }}>
              {it.label}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ContactPage() {
  const { code } = useParams<{ code: string }>();
  const [tab, setTab] = useState<Tab>('home');
  const [household, setHousehold] = useState<HouseholdData | null>(null);
  const [activeIncident, setActiveIncident] = useState<Incident | null>(null);
  const [deviceState, setDeviceState] = useState<DeviceState | null>(null);
  const [phoneState, setPhoneState] = useState<DeviceState | null>(null);
  const [recentIncidents, setRecentIncidents] = useState<Incident[]>([]);
  const [show911Modal, setShow911Modal] = useState(false);
  const [show911Screen, setShow911Screen] = useState(false);
  const [last911Incident, setLast911Incident] = useState<Incident | null>(null);
  const [contactName, setContactName] = useState('');
  const [loading, setLoading] = useState(false);
  const [resolvedBanner, setResolvedBanner] = useState<string | null>(null);
  const [caregivers, setCaregivers] = useState<Caregiver[]>([]);
  const [editingCaregiver, setEditingCaregiver] = useState<Caregiver | null>(null);
  const [showCaregiverModal, setShowCaregiverModal] = useState(false);
  const [showResidentModal, setShowResidentModal] = useState(false);
  const [residentNameOverride, setResidentNameOverride] = useState<string>('');
  const [cgDraft, setCgDraft] = useState({ name: '', role: '', phone: '' });
  const [residentDraft, setResidentDraft] = useState('');
  const [monitoring, setMonitoring] = useState({ paused: false, pause_requested: false });

  useEffect(() => {
    const u = localStorage.getItem('user');
    if (u) setContactName(JSON.parse(u).name);
  }, []);

  useEffect(() => {
    api.getProfile(code).then(d => { if (d.resident_name) setResidentNameOverride(d.resident_name); }).catch(() => {});
    api.getCaregivers(code).then(d => setCaregivers(d.caregivers)).catch(() => {});
  }, [code]);

  function openAddCaregiver() {
    setEditingCaregiver(null);
    setCgDraft({ name: '', role: '', phone: '' });
    setShowCaregiverModal(true);
  }
  function openEditCaregiver(cg: Caregiver) {
    setEditingCaregiver(cg);
    setCgDraft({ name: cg.name, role: cg.role, phone: cg.phone });
    setShowCaregiverModal(true);
  }
  async function submitCaregiver() {
    if (!cgDraft.name.trim()) return;
    if (editingCaregiver) {
      const { caregiver } = await api.updateCaregiver(code, editingCaregiver.id, cgDraft);
      setCaregivers(prev => prev.map(c => c.id === editingCaregiver.id ? caregiver : c));
    } else {
      const { caregiver } = await api.addCaregiver(code, cgDraft);
      setCaregivers(prev => [...prev, caregiver]);
    }
    setShowCaregiverModal(false);
  }
  async function deleteCaregiver(id: string) {
    await api.deleteCaregiver(code, id);
    setCaregivers(prev => prev.filter(c => c.id !== id));
  }
  function openEditResident(currentName: string) {
    setResidentDraft(currentName);
    setShowResidentModal(true);
  }
  async function submitResident() {
    const trimmed = residentDraft.trim();
    if (!trimmed) return;
    await api.updateProfile(code, trimmed);
    setResidentNameOverride(trimmed);
    setShowResidentModal(false);
  }

  const fetchData = useCallback(async () => {
    try {
      const data = await api.getHousehold(code);
      setHousehold(data);
      setActiveIncident(data.activeIncident);
      if (data.monitoring) setMonitoring(data.monitoring);
      const { incidents } = await api.getIncidents(code);
      setRecentIncidents(incidents);
    } catch {}
  }, [code]);

  // Poll CSI device state every 3s — skip phone-accelerometer, skip stale results
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      const devices = (household?.devices ?? []).filter(d => d.id !== 'phone-accelerometer');
      for (const device of devices) {
        try {
          const state = await api.getDeviceState(device.id);
          if (!cancelled) {
            setDeviceState(state.is_stale ? null : state);
          }
          return;
        } catch {}
      }
      if (!cancelled) setDeviceState(null);
    }
    poll();
    const id = setInterval(poll, 3000);
    return () => { cancelled = true; clearInterval(id); };
  }, [household?.devices]);

  // Poll phone-accelerometer state every 5s — shows on/off based on heartbeat freshness
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const state = await api.getDeviceState('phone-accelerometer');
        if (!cancelled) setPhoneState(state);
      } catch {
        if (!cancelled) setPhoneState(null);
      }
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Re-sync when PWA comes back to foreground (Pusher may have missed events while backgrounded)
  useEffect(() => {
    function handleVisibility() {
      if (!document.hidden) fetchData();
    }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [fetchData]);

  useEffect(() => {
    fetchData();
    const unsub = subscribeToHousehold(code, {
      onMonitoringUpdate: (data) => setMonitoring({ paused: data.paused, pause_requested: data.pause_requested }),
      // Silently note the new incident — don't alarm caregivers yet.
      // The at-risk user has T1 seconds to respond; we react when state → CONTACTS_NOTIFIED.
      onIncidentNew: () => { fetchData(); },
      onIncidentUpdate: (data) => {
        setActiveIncident(prev => {
          if (!prev || prev.id !== data.incidentId) return prev;
          return { ...prev, state: data.toState };
        });
        // Caregiver action required — switch to alerts tab
        if (data.toState === 'CONTACTS_NOTIFIED') {
          fetchData();
          setTab('alerts');
        }
        if (['RESOLVED', 'ESCALATED'].includes(data.toState)) {
          setActiveIncident(null);
          fetchData();
          if (data.toState === 'RESOLVED' && data.actor === 'at_risk_user') {
            const msg = data.note?.includes('late')
              ? 'They cancelled — confirmed they are OK.'
              : 'They responded — confirmed they are OK.';
            setResolvedBanner(msg);
            setTimeout(() => setResolvedBanner(null), 8000);
          }
        }
      },
      on911Prompt: () => setShow911Modal(true),
    });
    return unsub;
  }, [code, fetchData]);

  async function handleAck() {
    if (!activeIncident) return;
    const name = contactName || 'Caregiver';
    setLoading(true);
    await api.ack(activeIncident.id, name).catch(() => {});
    setLoading(false);
  }
  async function handleResolve() {
    if (!activeIncident) return;
    const name = contactName || 'Caregiver';
    setLoading(true);
    await api.resolve(activeIncident.id, name).catch(() => {});
    setLoading(false);
  }
  async function handle911() {
    if (!activeIncident) return;
    setLast911Incident(activeIncident);
    setShow911Modal(false);
    setShow911Screen(true);
    await api.trigger911(activeIncident.id).catch(() => {});
  }
  async function handleApproveMonitoringPause() {
    await api.approveMonitoringPause(code).catch(() => {});
  }
  async function handleResumeMonitoring() {
    await api.resumeMonitoring(code).catch(() => {});
  }

  async function handleSimulate() {
    try { await api.simulateFall('csi-board-01'); setTab('alerts'); }
    catch (err: any) { alert(`Simulate failed: ${err.message}`); }
  }
  async function handleReset() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    await fetch(`${apiUrl}/api/incidents/admin/reset/${code}`, { method: 'POST' }).catch(() => {});
    fetchData();
  }

  // ── 911 screen ───────────────────────────────────────────────────────────
  if (show911Screen) {
    return (
      <div style={{ minHeight: '100dvh', background: '#0F1A12', fontFamily: tk.sans,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '24px 20px', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}>
        <div style={{ fontSize: 64, marginBottom: 16 }}>🚨</div>
        <div style={{ fontFamily: tk.sans, fontSize: 32, color: 'white', marginBottom: 8, textAlign: 'center' }}>
          Connecting to 911
        </div>
        <div style={{ fontSize: 15, color: 'rgba(250,229,222,0.75)', marginBottom: 32, textAlign: 'center' }}>
          Emergency services have been contacted
        </div>
        <Card style={{ width: '100%', maxWidth: 360, padding: '20px 20px', background: '#1A2E1F' }}>
          {[
            ['Incident ID', (last911Incident?.id?.slice(0, 8) ?? '—') + '…'],
            ['Location', 'Household ' + code],
            ['ETA', '4 minutes'],
            ['Status', '✓ Dispatched'],
          ].map(([l, v]) => (
            <div key={l} style={{ display: 'flex', justifyContent: 'space-between',
              padding: '10px 0', borderBottom: '1px solid rgba(46,90,62,0.20)' }}>
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, fontFamily: tk.sans }}>{l}</span>
              <span style={{ color: l === 'Status' ? '#6FCF87' : 'white', fontSize: 14, fontWeight: 600 }}>{v}</span>
            </div>
          ))}
        </Card>
        <p style={{ color: 'rgba(250,229,222,0.35)', fontSize: 12, marginTop: 24, fontFamily: tk.sans }}>
          Demo mode — no real call placed
        </p>
      </div>
    );
  }

  const atRisk = household?.members.find(m => m.role === 'at_risk');
  const residentDisplayName = residentNameOverride || atRisk?.name || 'Resident';
  // Only treat incident as an actionable alert once contacts are involved
  // (AWAITING_USER_RESPONSE is the at-risk user's window — don't alarm caregivers yet)
  const isAlert = !!activeIncident && ['CONTACTS_NOTIFIED', 'CONTACT_RESPONDING', 'ESCALATION_AVAILABLE', 'ESCALATED'].includes(activeIncident.state);

  // ── Home tab ─────────────────────────────────────────────────────────────
  const HomeTab = () => (
    <div style={{ padding: '0 16px 24px' }}>

      {/* Resolved banner */}
      {resolvedBanner && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12,
          background: tk.successBg, borderRadius: 14, padding: '14px 16px', marginBottom: 14,
          border: '1px solid rgba(46,122,69,0.20)' }}>
          <div style={{ width: 32, height: 32, borderRadius: 16, background: '#2D7A45',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <path d="M4 12l5 5L20 6" />
            </svg>
          </div>
          <div>
            <div style={{ fontWeight: 600, color: tk.success, fontSize: 15, fontFamily: tk.sans }}>Alert resolved</div>
            <div style={{ fontSize: 13, color: 'rgba(45,122,69,0.75)', marginTop: 2, fontFamily: tk.sans }}>{resolvedBanner}</div>
          </div>
        </div>
      )}

      {/* Monitoring pause request banner */}
      {monitoring.pause_requested && !monitoring.paused && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12,
          background: tk.warningBg, borderRadius: 14, padding: '14px 16px', marginBottom: 14,
          border: '1px solid rgba(154,123,30,0.20)' }}>
          <div style={{ width: 32, height: 32, borderRadius: 16, background: tk.warning,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke="white" strokeWidth="2.5" strokeLinecap="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: tk.warning, fontSize: 14, fontFamily: tk.sans }}>
              {residentDisplayName} wants to pause monitoring
            </div>
            <div style={{ fontSize: 12, color: 'rgba(154,123,30,0.75)', marginTop: 2, fontFamily: tk.sans }}>
              Approve to temporarily disable fall detection
            </div>
          </div>
          <button onClick={handleApproveMonitoringPause} style={{
            background: tk.warning, border: 'none', borderRadius: 10,
            padding: '7px 14px', color: 'white', fontSize: 13, fontWeight: 600,
            fontFamily: tk.sans, cursor: 'pointer', flexShrink: 0,
          }}>Approve</button>
        </div>
      )}

      {/* Monitoring paused banner */}
      {monitoring.paused && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12,
          background: tk.cardSubtle, borderRadius: 14, padding: '14px 16px', marginBottom: 14,
          border: `1px solid ${tk.border}` }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, color: tk.text2, fontSize: 14, fontFamily: tk.sans }}>
              Monitoring paused
            </div>
            <div style={{ fontSize: 12, color: tk.text3, marginTop: 2, fontFamily: tk.sans }}>
              Fall detection is off at {residentDisplayName}'s request
            </div>
          </div>
          <button onClick={handleResumeMonitoring} style={{
            background: tk.primarySoft, border: 'none', borderRadius: 10,
            padding: '7px 14px', color: tk.primary, fontSize: 13, fontWeight: 600,
            fontFamily: tk.sans, cursor: 'pointer', flexShrink: 0,
          }}>Resume</button>
        </div>
      )}

      {/* Hero gradient card */}
      {(() => {
        const csiOn = !!(deviceState && !deviceState.is_stale);
        const accelOn = !!(phoneState && !phoneState.is_stale);
        const monitoringOn = csiOn || accelOn;
        const heroBg = isAlert
          ? `linear-gradient(135deg, ${tk.destructive}, #8B3520)`
          : monitoringOn
            ? 'linear-gradient(135deg, #2E5A3E, #3D7A54)'
            : 'linear-gradient(135deg, #4A4A4A, #2E2E2E)';
        const dotColor = isAlert ? '#FAD4C8' : monitoringOn ? '#A8D5B5' : '#888888';
        const dotShadow = isAlert ? 'rgba(250,212,200,0.25)' : monitoringOn ? 'rgba(168,213,181,0.25)' : 'transparent';
        const eyebrow = isAlert
          ? 'Fall detected · Active alert'
          : csiOn ? 'All quiet · Monitoring'
          : accelOn ? 'All quiet · On device'
          : 'Sensors offline · No data';
        const eyebrowColor = isAlert ? 'rgba(250,229,222,0.80)' : 'rgba(232,240,233,0.80)';
        return (
      <div style={{
        borderRadius: 20,
        background: heroBg,
        padding: '24px 20px',
        marginBottom: 14,
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* decorative blob */}
        <div style={{
          position: 'absolute', right: -30, top: -30, width: 160, height: 160,
          borderRadius: '50%', background: 'rgba(255,255,255,0.08)',
        }} />
        <div style={{ position: 'relative' }}>
          {/* status eyebrow */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14 }}>
            <div style={{
              width: 7, height: 7, borderRadius: '50%',
              background: dotColor,
              boxShadow: `0 0 0 3px ${dotShadow}`,
            }} />
            <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.8,
              color: eyebrowColor,
              fontFamily: tk.sans, textTransform: 'uppercase' }}>
              {eyebrow}
            </span>
          </div>

          {/* Serif headline */}
          <div style={{ fontFamily: tk.sans, fontSize: 28, color: 'white',
            lineHeight: 1.2, marginBottom: 8 }}>
            {isAlert
              ? <>{residentDisplayName}<br /><span style={{ fontStyle: 'italic' }}>may have fallen</span></>
              : monitoringOn
                ? <>{residentDisplayName}<br />is home</>
                : <>{residentDisplayName}<br /><span style={{ fontStyle: 'italic', color: 'rgba(255,255,255,0.60)' }}>status unknown</span></>
            }
          </div>

          {isAlert && activeIncident?.confidence ? (
            <div style={{ fontSize: 13, color: 'rgba(250,229,222,0.75)', marginBottom: 16, fontFamily: tk.sans }}>
              {Math.round(activeIncident.confidence * 100)}% confidence ·{' '}
              {new Date(activeIncident.detected_at).toLocaleTimeString()}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'rgba(232,240,233,0.60)', marginBottom: 16, fontFamily: tk.sans }}>
              {csiOn ? 'CSI sensor monitoring active' : accelOn ? 'On-device motion sensor active' : 'Sensor offline — no presence data'}
            </div>
          )}

          {/* Mini map */}
          <div style={{ borderRadius: 12, overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.15)', marginBottom: 16, background: 'rgba(255,255,255,0.06)' }}>
            <FloorPlan incident={isAlert ? activeIncident : null} mini csiActive={!!(deviceState && !deviceState.is_stale)} />
          </div>

          {/* Action buttons */}
          {isAlert ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {activeIncident!.state === 'CONTACTS_NOTIFIED' && (
                  <button onClick={handleAck} disabled={loading} style={{
                    flex: 1, height: 46, borderRadius: 23, border: 'none',
                    background: tk.warning, color: 'white',
                    fontSize: 15, fontWeight: 600, fontFamily: tk.sans, cursor: 'pointer',
                  }}>
                    I'm Responding
                  </button>
                )}
                {activeIncident!.state === 'CONTACT_RESPONDING' && (
                  <button onClick={handleResolve} disabled={loading} style={{
                    flex: 1, height: 46, borderRadius: 23, border: 'none',
                    background: tk.success, color: 'white',
                    fontSize: 15, fontWeight: 600, fontFamily: tk.sans, cursor: 'pointer',
                  }}>
                    Mark Resolved
                  </button>
                )}
                {activeIncident!.state === 'ESCALATION_AVAILABLE' && (
                  <button onClick={() => setShow911Modal(true)} style={{
                    flex: 1, height: 46, borderRadius: 23, border: 'none',
                    background: 'white', color: tk.destructive,
                    fontSize: 15, fontWeight: 700, fontFamily: tk.sans, cursor: 'pointer',
                  }}>
                    Call 911
                  </button>
                )}
                <button onClick={() => setTab('map')} style={{
                  flex: 1, height: 46, borderRadius: 23,
                  border: '1px solid rgba(255,255,255,0.30)',
                  background: 'rgba(255,255,255,0.12)', color: 'white',
                  fontSize: 15, fontWeight: 500, fontFamily: tk.sans, cursor: 'pointer',
                }}>
                  View Map
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setTab('map')} style={{
                flex: 1, height: 42, borderRadius: 21, border: 'none',
                background: 'rgba(255,255,255,0.20)', color: 'white',
                fontSize: 14, fontWeight: 600, fontFamily: tk.sans, cursor: 'pointer',
              }}>
                Open Map
              </button>
              <button onClick={() => setTab('alerts')} style={{
                flex: 1, height: 42, borderRadius: 21,
                border: '1px solid rgba(255,255,255,0.25)',
                background: 'transparent', color: 'rgba(255,255,255,0.80)',
                fontSize: 14, fontWeight: 500, fontFamily: tk.sans, cursor: 'pointer',
              }}>
                View Alerts
              </button>
            </div>
          )}
        </div>
      </div>
        );
      })()}

      {/* Sensors */}
      <SectionHeader title="Sensors" />

      {/* Phone motion sensor — always visible */}
      {(() => {
        const phoneOn = !!(phoneState && !phoneState.is_stale);
        return (
          <Card style={{ padding: '12px 16px', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: tk.text, fontFamily: tk.sans }}>
                  Phone motion sensor
                </div>
                <div style={{ fontSize: 12, color: tk.text3, fontFamily: tk.sans, marginTop: 1 }}>
                  {phoneOn ? 'On device · motion detection active' : 'Off — enable on recipient\'s phone'}
                </div>
              </div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                background: phoneOn ? tk.successBg : tk.cardSubtle,
                color: phoneOn ? tk.success : tk.text3,
                borderRadius: 10, padding: '3px 10px',
                fontSize: 12, fontWeight: 600, fontFamily: tk.sans,
              }}>
                <div style={{ width: 6, height: 6, borderRadius: 3, background: 'currentColor' }} />
                {phoneOn ? 'On' : 'Off'}
              </div>
            </div>
          </Card>
        );
      })()}

      {deviceState == null ? (
        <Card>
          <div style={{ fontSize: 14, color: tk.text3, fontFamily: tk.sans, textAlign: 'center', padding: '4px 0' }}>
            Waiting for CSI device telemetry…
          </div>
        </Card>
      ) : (() => {
        const ds = deviceState;
        const isStale = ds.is_stale;
        const stateColor: Record<string, string> = {
          WARMUP: tk.warning, IDLE: tk.text3, WATCHING: tk.success, ALERT: tk.destructive,
        };
        const stateBg: Record<string, string> = {
          WARMUP: tk.warningBg, IDLE: tk.cardSubtle, WATCHING: tk.successBg, ALERT: tk.destructiveBg,
        };
        const isPhone = ds.device_id === 'phone-accelerometer';
        const sensorEntries = Object.entries(ds.sensors ?? {});
        return (
          <>
            {/* Device header row */}
            <Card style={{ padding: '12px 16px', marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: tk.text, fontFamily: tk.sans }}>
                    {isPhone ? 'Phone motion sensor' : ds.device_id}
                  </div>
                  <div style={{ fontSize: 12, color: tk.text3, fontFamily: tk.sans, marginTop: 1 }}>
                    {isStale
                      ? 'No data — device offline'
                      : isPhone
                        ? 'On device · motion detection active'
                        : `${ds.sensors_online_count}/${ds.sensors_total_count} receivers online${ds.room_occupied ? ' · room occupied' : ' · room empty'}`}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    background: isStale ? tk.destructiveBg : isPhone ? tk.successBg : stateBg[(!isAlert && ds.state === 'ALERT') ? 'WATCHING' : ds.state] ?? tk.cardSubtle,
                    color: isStale ? tk.destructive : isPhone ? tk.success : stateColor[(!isAlert && ds.state === 'ALERT') ? 'WATCHING' : ds.state] ?? tk.text3,
                    borderRadius: 10, padding: '3px 10px',
                    fontSize: 12, fontWeight: 600, fontFamily: tk.sans,
                  }}>
                    <div style={{ width: 6, height: 6, borderRadius: 3, background: 'currentColor' }} />
                    {isStale ? 'Offline' : isPhone ? 'On device' : (!isAlert && ds.state === 'ALERT') ? 'WATCHING' : ds.state}
                  </div>
                </div>
              </div>
            </Card>

            {/* Per-receiver rows */}
            {!isPhone && <Card style={{ padding: 0, overflow: 'hidden' }}>
              {sensorEntries.length === 0 ? (
                <div style={{ padding: '12px 16px', fontSize: 13, color: tk.text3, fontFamily: tk.sans }}>
                  No receiver data
                </div>
              ) : sensorEntries.map(([name, info], i) => {
                const active = !isStale && info.online;
                const iconColor = active ? tk.success : tk.text3;
                const iconBg = active ? tk.successBg : tk.cardSubtle;
                return (
                  <div key={name} style={{ display: 'flex', alignItems: 'center', gap: 12,
                    padding: '11px 16px', borderTop: i === 0 ? 'none' : '1px solid rgba(46,90,62,0.08)' }}>
                    <div style={{ width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                      background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                        stroke={iconColor} strokeWidth="1.8" strokeLinecap="round">
                        <circle cx="6" cy="12" r="2" fill={iconColor} stroke="none" />
                        <path d="M10 8a6 6 0 0 1 0 8M14 5a10 10 0 0 1 0 14" />
                      </svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: tk.text, fontFamily: tk.sans }}>{name}</div>
                      <div style={{ fontSize: 12, color: tk.text3, fontFamily: tk.sans, marginTop: 1 }}>
                        {active ? `${info.rate_hz.toFixed(1)} Hz` : '—'}
                      </div>
                    </div>
                    <Pill kind={active ? 'green' : 'orange'}>
                      {active ? 'Online' : 'Disconnected'}
                    </Pill>
                  </div>
                );
              })}
            </Card>}
          </>
        );
      })()}

      {/* Resident */}
      <SectionHeader title="Resident" />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '13px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 18, background: tk.primarySoft,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: tk.sans, fontSize: 16, color: tk.primary, fontStyle: 'italic' }}>
              {residentDisplayName.charAt(0)}
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 500, color: tk.text, fontFamily: tk.sans }}>{residentDisplayName}</div>
              <div style={{ fontSize: 12, color: tk.text3, fontFamily: tk.sans, marginTop: 1 }}>At-risk resident</div>
            </div>
          </div>
          <button onClick={() => openEditResident(residentDisplayName)} style={{
            background: tk.primarySoft, border: 'none', borderRadius: 10,
            padding: '6px 12px', color: tk.primary, fontSize: 13, fontWeight: 600,
            fontFamily: tk.sans, cursor: 'pointer',
          }}>Edit</button>
        </div>
      </Card>

      {/* Care circle */}
      <SectionHeader title="Care circle" action="+ Add" onAction={openAddCaregiver} />
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {caregivers.length === 0 ? (
          <div style={{ padding: '16px', textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: tk.text3, fontFamily: tk.sans, marginBottom: 8 }}>
              No caregivers added yet
            </div>
            <button onClick={openAddCaregiver} style={{
              background: tk.primarySoft, border: 'none', borderRadius: 10,
              padding: '8px 16px', color: tk.primary, fontSize: 14, fontWeight: 600,
              fontFamily: tk.sans, cursor: 'pointer',
            }}>Add first caregiver</button>
          </div>
        ) : (
          caregivers.map((cg, i) => (
            <div key={cg.id} style={{ display: 'flex', alignItems: 'center', gap: 10,
              padding: '13px 16px', borderTop: i === 0 ? 'none' : '1px solid rgba(46,90,62,0.08)' }}>
              <div style={{ width: 36, height: 36, borderRadius: 18, background: '#E6F0E9',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                fontFamily: tk.sans, fontSize: 15, color: tk.primary, fontStyle: 'italic' }}>
                {cg.name.charAt(0)}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 500, color: tk.text, fontFamily: tk.sans }}>{cg.name}</div>
                <div style={{ fontSize: 12, color: tk.text3, fontFamily: tk.sans, marginTop: 1 }}>
                  {cg.role}{cg.phone ? ' · ' + cg.phone : ''}
                </div>
              </div>
              <button onClick={() => openEditCaregiver(cg)} style={{
                background: 'none', border: 'none', padding: '4px 8px', cursor: 'pointer',
                color: tk.primary, fontSize: 13, fontWeight: 500, fontFamily: tk.sans,
              }}>Edit</button>
            </div>
          ))
        )}
      </Card>

      {/* Admin tools */}
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button onClick={handleSimulate} style={{
          flex: 1, padding: '10px 0', background: tk.card, borderRadius: 12,
          border: '1px solid rgba(46,90,62,0.15)', color: tk.text3,
          fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: tk.sans,
        }}>
          System Test
        </button>
        <button onClick={handleReset} style={{
          flex: 1, padding: '10px 0', background: tk.card, borderRadius: 12,
          border: `1px solid rgba(184,77,42,0.25)`, color: tk.destructive,
          fontSize: 13, fontWeight: 500, cursor: 'pointer', fontFamily: tk.sans,
        }}>
          Issue Resolved
        </button>
      </div>
    </div>
  );

  // ── Map tab ───────────────────────────────────────────────────────────────
  const MapTab = () => (
    <div style={{ padding: '0 16px 24px' }}>
      <Card style={{ padding: 16, background: '#F4F6F1' }}>
        <FloorPlan incident={isAlert ? activeIncident : null} csiActive={!!(deviceState && !deviceState.is_stale)} />
        <div style={{ marginTop: 10, fontSize: 12, color: tk.text3, fontFamily: tk.sans, textAlign: 'center' }}>
          {deviceState && !deviceState.is_stale
            ? 'Open Living is CSI-monitored · turns red on fall detection'
            : 'CSI device offline · no active monitoring'}
        </div>
      </Card>

      {/* Stats */}
      {(() => {
        const csiOn = !!(deviceState && !deviceState.is_stale);
        const onlineCount = csiOn ? (deviceState!.sensors_online_count ?? 0) : 0;
        const totalCount = csiOn ? (deviceState!.sensors_total_count ?? 0) : 0;
        const sensorLabel = csiOn
          ? (onlineCount === totalCount ? 'All online' : `${onlineCount} online`)
          : 'No data';
        const sensorColor = csiOn && onlineCount > 0 ? tk.success : tk.text3;
        return (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12, marginBottom: 4 }}>
            <Card style={{ marginBottom: 0, padding: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: tk.text3,
                fontFamily: tk.sans, textTransform: 'uppercase', marginBottom: 8 }}>
                {isAlert ? 'Alert' : 'Presence'}
              </div>
              <div style={{ fontFamily: tk.sans, fontSize: 22, color: isAlert ? tk.destructive : tk.text }}>
                Open Living
              </div>
              <div style={{ fontSize: 13, marginTop: 4, fontFamily: tk.sans,
                color: isAlert ? tk.destructive : csiOn ? tk.text3 : tk.text3 }}>
                {isAlert
                  ? `${activeIncident?.confidence ? Math.round(activeIncident.confidence * 100) + '%' : 'High'} confidence`
                  : csiOn ? 'CSI active' : 'No signal'}
              </div>
            </Card>
            <Card style={{ marginBottom: 0, padding: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.6, color: tk.text3,
                fontFamily: tk.sans, textTransform: 'uppercase', marginBottom: 8 }}>Sensors</div>
              <div style={{ fontFamily: tk.sans, fontSize: 22, color: csiOn ? tk.text : tk.text3 }}>
                {csiOn ? `${onlineCount} of ${totalCount}` : '—'}
              </div>
              <div style={{ fontSize: 13, color: sensorColor, marginTop: 4, fontFamily: tk.sans }}>{sensorLabel}</div>
            </Card>
          </div>
        );
      })()}

      {/* Room list */}
      {(() => {
        const csiOn = !!(deviceState && !deviceState.is_stale);
        return (
        <><SectionHeader title="Rooms" />
        <Card style={{ padding: 0 }}>
        {[
          { name: 'Open Living', sub: isAlert ? 'Fall detected' : csiOn ? 'CSI active' : 'Offline', active: csiOn, alert: isAlert },
          { name: 'Room 1', sub: 'No sensor coverage', active: false },
          { name: 'Room 2', sub: 'No sensor coverage', active: false },
          { name: 'Room 3', sub: 'No sensor coverage', active: false },
          { name: 'Room 4', sub: 'No sensor coverage', active: false },
        ].map((r, i) => (
          <div key={r.name} style={{ display: 'flex', alignItems: 'center', gap: 12,
            padding: '13px 16px', borderTop: i === 0 ? 'none' : '1px solid rgba(46,90,62,0.08)' }}>
            <div style={{ width: 4, height: 32, borderRadius: 2,
              background: r.alert ? tk.destructive : r.active ? tk.primary : 'rgba(46,90,62,0.15)' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: tk.text, fontFamily: tk.sans }}>{r.name}</div>
              <div style={{ fontSize: 13, color: r.alert ? tk.destructive : tk.text3, fontFamily: tk.sans }}>
                {r.sub}
              </div>
            </div>
            {r.active && <Pill kind={r.alert ? 'red' : 'blue'}>{r.alert ? 'Alert' : 'Active'}</Pill>}
          </div>
        ))}
        </Card></>
        );
      })()}
    </div>
  );

  // ── Alerts tab ────────────────────────────────────────────────────────────
  const AlertsTab = () => (
    <div style={{ padding: '0 16px 24px' }}>
      {/* Active incident */}
      {activeIncident && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 4px 10px' }}>
            <div style={{ width: 8, height: 8, borderRadius: 4, background: tk.destructive }} />
            <div style={{ fontSize: 11, fontWeight: 700, color: tk.destructive, letterSpacing: 0.7,
              fontFamily: tk.sans, textTransform: 'uppercase' }}>Active now</div>
          </div>
          <Card style={{ padding: 0, overflow: 'hidden',
            boxShadow: `0 0 0 1.5px ${tk.destructive}33, 0 8px 24px ${tk.destructive}1A` }}>
            <div style={{ padding: '18px 18px 14px', background: tk.destructiveBg }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: tk.destructive,
                letterSpacing: 0.6, marginBottom: 10, fontFamily: tk.sans, textTransform: 'uppercase' }}>
                Fall detected · {stateLabel(activeIncident.state)}
              </div>
              <div style={{ fontFamily: tk.sans, fontSize: 24, lineHeight: 1.2, marginBottom: 8 }}>
                {residentDisplayName}<br />
                <span style={{ fontStyle: 'italic', color: tk.destructive }}>may have fallen</span>
              </div>
              {activeIncident.confidence && (
                <div style={{ fontSize: 13, color: tk.text2, fontFamily: tk.sans }}>
                  {Math.round(activeIncident.confidence * 100)}% confidence ·{' '}
                  {activeIncident.device_id} ·{' '}
                  {new Date(activeIncident.detected_at).toLocaleTimeString()}
                </div>
              )}
            </div>
            <div style={{ padding: 14, display: 'flex', gap: 8 }}>
              {activeIncident.state === 'CONTACTS_NOTIFIED' && (
                <button onClick={handleAck} disabled={loading} style={{
                  flex: 1, height: 46, background: tk.warning, borderRadius: 23,
                  border: 'none', color: 'white', fontSize: 15, fontWeight: 600,
                  fontFamily: tk.sans, cursor: 'pointer',
                }}>
                  I'm Responding
                </button>
              )}
              {activeIncident.state === 'CONTACT_RESPONDING' && (
                <button onClick={handleResolve} disabled={loading} style={{
                  flex: 1, height: 46, background: tk.success, borderRadius: 23,
                  border: 'none', color: 'white', fontSize: 15, fontWeight: 600,
                  fontFamily: tk.sans, cursor: 'pointer',
                }}>
                  Mark Resolved
                </button>
              )}
              {activeIncident.state === 'ESCALATION_AVAILABLE' && (
                <button onClick={() => setShow911Modal(true)} style={{
                  flex: 1, height: 46, background: tk.destructive, borderRadius: 23,
                  border: 'none', color: 'white', fontSize: 15, fontWeight: 700,
                  fontFamily: tk.sans, cursor: 'pointer',
                }}>
                  Call 911
                </button>
              )}
              <button onClick={() => setTab('map')} style={{
                flex: 1, height: 46, background: tk.cardSubtle, borderRadius: 23,
                border: '1px solid rgba(46,90,62,0.15)', color: tk.primary,
                fontSize: 14, fontWeight: 500, fontFamily: tk.sans, cursor: 'pointer',
              }}>
                View Map
              </button>
            </div>
          </Card>
        </>
      )}

      {/* History */}
      <SectionHeader title="History" />
      {recentIncidents.length === 0 ? (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 20, background: tk.successBg,
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                stroke={tk.success} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12l5 5L20 6" />
              </svg>
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: tk.text, fontFamily: tk.sans }}>No alerts yet</div>
              <div style={{ fontSize: 13, color: tk.text3, marginTop: 2, fontFamily: tk.sans }}>System is monitoring</div>
            </div>
          </div>
        </Card>
      ) : (
        <Card style={{ padding: 0 }}>
          {recentIncidents.slice(0, 8).map((inc, i) => {
            const isResolved = inc.state === 'RESOLVED';
            const kind = isResolved ? 'green' : inc.state === 'ESCALATED' ? 'red' : 'orange';
            const traceColor = kind === 'red' ? tk.destructive : kind === 'orange' ? tk.warning : tk.success;
            return (
              <div key={inc.id} style={{ padding: '13px 16px',
                borderTop: i === 0 ? 'none' : '1px solid rgba(46,90,62,0.08)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <div>
                    <div style={{ fontFamily: tk.sans, fontSize: 16, color: tk.text }}>
                      Open Living
                      <span style={{ fontFamily: tk.sans, fontSize: 13, color: tk.text3, fontWeight: 400 }}>
                        {' '}· {new Date(inc.detected_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: tk.text3, marginTop: 2, fontFamily: tk.sans }}>
                      {new Date(inc.detected_at).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}
                      {inc.confidence ? ` · ${Math.round(inc.confidence * 100)}% confidence` : ''}
                    </div>
                  </div>
                  <Pill kind={kind}>{stateLabel(inc.state)}</Pill>
                </div>
                <div style={{ borderTop: '1px dashed rgba(46,90,62,0.12)', paddingTop: 8 }}>
                  <div style={{ fontSize: 10, color: tk.text4, fontWeight: 600, letterSpacing: 0.5,
                    marginBottom: 4, fontFamily: tk.sans, textTransform: 'uppercase' }}>
                    CSI variance — Open Living
                  </div>
                  <VarianceTrace color={traceColor} height={24} />
                </div>
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
      `}</style>

      {/* outer bg — full width always */}
      <div style={{ background: tk.bg, minHeight: '100dvh', fontFamily: tk.sans, color: tk.text }}>
        {/* Sticky header — full-width blur, inner content constrained */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 50,
          background: 'rgba(244,246,241,0.90)',
          backdropFilter: 'blur(24px) saturate(180%)',
          WebkitBackdropFilter: 'blur(24px) saturate(180%)',
          borderBottom: '1px solid rgba(46,90,62,0.10)',
        }}>
          <div style={{ maxWidth: 600, margin: '0 auto',
            padding: 'max(52px, calc(44px + env(safe-area-inset-top))) 20px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 11, color: tk.text3, fontWeight: 600, letterSpacing: 0.8,
                  textTransform: 'uppercase', fontFamily: tk.sans }}>
                  {residentDisplayName}'s Home
                </div>
                <div style={{ fontFamily: tk.sans, fontSize: 28, marginTop: 2, color: tk.text }}>
                  {tab === 'home' ? 'Bouy Dashboard' : tab === 'map' ? 'Map' : 'Alerts'}
                </div>
              </div>
              {isAlert && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6,
                  background: tk.destructiveBg, borderRadius: 20, padding: '6px 14px',
                  border: `1px solid ${tk.destructive}40` }}>
                  <div style={{ width: 6, height: 6, borderRadius: 3, background: tk.destructive }} />
                  <span style={{ color: tk.destructive, fontSize: 12, fontWeight: 700,
                    fontFamily: tk.sans, letterSpacing: 0.5 }}>ALERT</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Content — constrained + centered */}
        <div style={{ maxWidth: 600, margin: '0 auto', paddingBottom: 96, paddingTop: 16 }}>
          {tab === 'home'   && <HomeTab />}
          {tab === 'map'    && <MapTab />}
          {tab === 'alerts' && <AlertsTab />}
        </div>

        <TabBar active={tab} onSelect={setTab} hasAlert={isAlert} />
      </div>

      {/* Edit resident modal */}
      {showResidentModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,56,38,0.50)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          zIndex: 200, padding: '0 0 max(20px, env(safe-area-inset-bottom))' }}>
          <div style={{ background: tk.card, borderRadius: '20px 20px 0 0',
            padding: '24px 20px', width: '100%', maxWidth: 480,
            boxShadow: '0 -8px 40px rgba(46,90,62,0.16)' }}>
            <div style={{ width: 32, height: 4, borderRadius: 2, background: 'rgba(46,90,62,0.20)',
              margin: '-12px auto 22px' }} />
            <div style={{ fontFamily: tk.sans, fontSize: 24, color: tk.text, marginBottom: 6 }}>
              Edit resident
            </div>
            <div style={{ fontSize: 14, color: tk.text3, fontFamily: tk.sans, marginBottom: 20 }}>
              Update the resident's display name shown across the app.
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: tk.text3, fontFamily: tk.sans,
                letterSpacing: 0.5, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                Name
              </label>
              <input
                value={residentDraft}
                onChange={e => setResidentDraft(e.target.value)}
                placeholder="Resident name"
                style={{ width: '100%', height: 46, borderRadius: 12, padding: '0 14px',
                  border: '1px solid rgba(46,90,62,0.20)', fontSize: 16, fontFamily: tk.sans,
                  color: tk.text, background: tk.bg, outline: 'none' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShowResidentModal(false)} style={{
                flex: 1, height: 48, background: tk.cardSubtle, borderRadius: 14,
                border: '1px solid rgba(46,90,62,0.15)', fontSize: 15, fontWeight: 500,
                color: tk.text2, cursor: 'pointer', fontFamily: tk.sans,
              }}>Cancel</button>
              <button onClick={submitResident} style={{
                flex: 1, height: 48, background: tk.primary, borderRadius: 14,
                border: 'none', fontSize: 15, fontWeight: 600, color: 'white',
                cursor: 'pointer', fontFamily: tk.sans,
              }}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Add/edit caregiver modal */}
      {showCaregiverModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,56,38,0.50)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          zIndex: 200, padding: '0 0 max(20px, env(safe-area-inset-bottom))' }}>
          <div style={{ background: tk.card, borderRadius: '20px 20px 0 0',
            padding: '24px 20px', width: '100%', maxWidth: 480,
            boxShadow: '0 -8px 40px rgba(46,90,62,0.16)' }}>
            <div style={{ width: 32, height: 4, borderRadius: 2, background: 'rgba(46,90,62,0.20)',
              margin: '-12px auto 22px' }} />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <div style={{ fontFamily: tk.sans, fontSize: 24, color: tk.text }}>
                {editingCaregiver ? 'Edit caregiver' : 'Add caregiver'}
              </div>
              {editingCaregiver && (
                <button onClick={() => { deleteCaregiver(editingCaregiver.id); setShowCaregiverModal(false); }}
                  style={{ background: tk.destructiveBg, border: 'none', borderRadius: 10,
                    padding: '6px 12px', color: tk.destructive, fontSize: 13, fontWeight: 600,
                    fontFamily: tk.sans, cursor: 'pointer' }}>
                  Remove
                </button>
              )}
            </div>
            <div style={{ fontSize: 14, color: tk.text3, fontFamily: tk.sans, marginBottom: 20 }}>
              {editingCaregiver ? 'Update this caregiver\'s information.' : 'Add someone to this household\'s care circle.'}
            </div>
            {[
              { label: 'Name', key: 'name' as const, placeholder: 'Full name' },
              { label: 'Role', key: 'role' as const, placeholder: 'e.g. Daughter, Home carer' },
              { label: 'Phone', key: 'phone' as const, placeholder: '(555) 000-0000' },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: tk.text3, fontFamily: tk.sans,
                  letterSpacing: 0.5, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
                  {f.label}
                </label>
                <input
                  value={cgDraft[f.key]}
                  onChange={e => setCgDraft(d => ({ ...d, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  style={{ width: '100%', height: 46, borderRadius: 12, padding: '0 14px',
                    border: '1px solid rgba(46,90,62,0.20)', fontSize: 15, fontFamily: tk.sans,
                    color: tk.text, background: tk.bg, outline: 'none' }}
                />
              </div>
            ))}
            <div style={{ display: 'flex', gap: 10, marginTop: 6 }}>
              <button onClick={() => setShowCaregiverModal(false)} style={{
                flex: 1, height: 48, background: tk.cardSubtle, borderRadius: 14,
                border: '1px solid rgba(46,90,62,0.15)', fontSize: 15, fontWeight: 500,
                color: tk.text2, cursor: 'pointer', fontFamily: tk.sans,
              }}>Cancel</button>
              <button onClick={submitCaregiver} style={{
                flex: 1, height: 48, background: tk.primary, borderRadius: 14,
                border: 'none', fontSize: 15, fontWeight: 600, color: 'white',
                cursor: 'pointer', fontFamily: tk.sans,
              }}>{editingCaregiver ? 'Save changes' : 'Add caregiver'}</button>
            </div>
          </div>
        </div>
      )}

      {/* 911 modal */}
      {show911Modal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,56,38,0.50)',
          display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
          zIndex: 200, padding: '0 0 max(20px, env(safe-area-inset-bottom))' }}>
          <div style={{ background: tk.card, borderRadius: '20px 20px 0 0',
            padding: '24px 20px', width: '100%', maxWidth: 480,
            boxShadow: '0 -8px 40px rgba(46,90,62,0.16)' }}>
            <div style={{ width: 32, height: 4, borderRadius: 2, background: 'rgba(46,90,62,0.20)',
              margin: '-12px auto 22px' }} />
            <div style={{ fontFamily: tk.sans, fontSize: 26, color: tk.destructive, marginBottom: 10 }}>
              Call 911?
            </div>
            <div style={{ fontSize: 15, color: tk.text2, marginBottom: 24, lineHeight: 1.55, fontFamily: tk.sans }}>
              No emergency contacts have responded. This will notify emergency services.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setShow911Modal(false)} style={{
                flex: 1, height: 50, background: tk.cardSubtle, borderRadius: 14,
                border: '1px solid rgba(46,90,62,0.15)', fontSize: 16, fontWeight: 500,
                color: tk.text2, cursor: 'pointer', fontFamily: tk.sans,
              }}>
                Cancel
              </button>
              <button onClick={handle911} style={{
                flex: 1, height: 50, background: tk.destructive, borderRadius: 14,
                border: 'none', fontSize: 16, fontWeight: 700, color: 'white',
                cursor: 'pointer', fontFamily: tk.sans,
              }}>
                Confirm 911
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
