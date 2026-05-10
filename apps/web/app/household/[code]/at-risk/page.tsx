'use client';
import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { subscribeToHousehold } from '@/lib/pusher-client';
import { api } from '@/lib/api';
import { useFallDetector } from '@/lib/use-fall-detector';

type Phase = 'idle' | 'alarm' | 'contacts_notified' | 'responded' | 'paused' | 'pause_pending';

interface ActiveIncident {
  id: string;
  confidence: number | null;
  t1DeadlineMs: number;
}

interface DeviceState {
  device_id: string;
  is_stale: boolean;
  received_at: string | null;
  payload: Record<string, unknown> | null;
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
  primary: '#2E5A3E',
  primarySoft: '#E6F0E9',
  success: '#2D7A45',
  successBg: '#E6F0E9',
  destructive: '#B84D2A',
  destructiveBg: '#FAE5DE',
  warning: '#9A7B1E',
  warningBg: '#E0F4F4',
  serif: '"Instrument Serif", ui-serif, Georgia, serif',
  sans: '"Inter", ui-sans-serif, system-ui, sans-serif',
  shadow: '0 1px 3px rgba(46,90,62,0.06), 0 4px 16px -4px rgba(46,90,62,0.10)',
};

export default function AtRiskPage() {
  const { code } = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const [phase, setPhase] = useState<Phase>('idle');
  const [incident, setIncident] = useState<ActiveIncident | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [responseResult, setResponseResult] = useState<'ok' | 'help' | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [deviceState, setDeviceState] = useState<DeviceState | null>(null);
  const [deviceIds, setDeviceIds] = useState<string[]>([]);
  const phaseRef = useRef<Phase>('idle');
  const incidentRef = useRef<ActiveIncident | null>(null);
  const speechRef = useRef<NodeJS.Timeout | null>(null);

  function stopAlarm() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
    if (speechRef.current) { clearInterval(speechRef.current); speechRef.current = null; }
  }

  function speakAlarm() {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const say = (text: string) => setTimeout(() => {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.rate = 0.85; utt.volume = 1;
      window.speechSynthesis.speak(utt);
    }, 0);
    say('Are you OK? Please tap the screen to respond.');
    speechRef.current = setInterval(() => {
      say('Are you OK? Please respond. A possible fall has been detected.');
    }, 8000);
  }

  const startAlarm = useCallback((inc: ActiveIncident) => {
    // Guard: only start if currently idle (prevents double-trigger from Pusher + direct call)
    if (phaseRef.current !== 'idle') return;
    incidentRef.current = inc;
    setIncident(inc);
    phaseRef.current = 'alarm';
    setPhase('alarm');
    setSecondsLeft(Math.round(inc.t1DeadlineMs / 1000));

    if (typeof window !== 'undefined') {
      const audio = new Audio('/alarm.mp3');
      audio.loop = true;
      audio.play().catch(() => {});
      audioRef.current = audio;
    }
    speakAlarm();

    const deadline = Date.now() + inc.t1DeadlineMs;
    timerRef.current = setInterval(() => {
      const remaining = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setSecondsLeft(remaining);
      if (remaining === 0) {
        stopAlarm();
        phaseRef.current = 'contacts_notified';
        setPhase('contacts_notified');
      }
    }, 500);
  }, []);

  async function handleRespond(response: 'ok' | 'help') {
    const inc = incidentRef.current;
    if (!inc) return;
    stopAlarm();
    setResponseResult(response);
    phaseRef.current = 'responded';
    setPhase('responded');
    api.respond(inc.id, response).catch(() => {});
    if (response === 'ok') {
      setTimeout(() => {
        phaseRef.current = phaseRef.current === 'responded' ? 'idle' : phaseRef.current;
        setPhase(p => p === 'responded' ? 'idle' : p);
        setIncident(null);
        incidentRef.current = null;
        setResponseResult(null);
      }, 3000);
    }
  }

  function handleCancel() {
    const inc = incidentRef.current;
    stopAlarm();
    phaseRef.current = 'idle';
    setPhase('idle');
    setIncident(null);
    incidentRef.current = null;
    setResponseResult(null);
    if (inc) api.respond(inc.id, 'ok').catch(() => {});
  }

  async function handleRequestPause() {
    phaseRef.current = 'pause_pending';
    setPhase('pause_pending');
    await api.requestMonitoringPause(code).catch(() => {});
  }

  async function handleResume() {
    await api.resumeMonitoring(code).catch(() => {});
    phaseRef.current = 'idle';
    setPhase('idle');
  }

  // Fetch device list once on mount
  useEffect(() => {
    api.getHousehold(code).then((data: { devices?: { id: string }[] }) => {
      if (data.devices?.length) setDeviceIds(data.devices.map((d: { id: string }) => d.id));
    }).catch(() => {});
  }, [code]);

  // Poll device state every 5s
  useEffect(() => {
    if (!deviceIds.length) return;
    let cancelled = false;
    async function poll() {
      for (const id of deviceIds) {
        try {
          const state = await api.getDeviceState(id);
          if (!cancelled) setDeviceState(state);
          return;
        } catch {}
      }
      if (!cancelled) setDeviceState(null);
    }
    poll();
    const interval = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [deviceIds]);

  // Accelerometer — just trigger the incident; Pusher onIncidentNew handles the alarm
  const { status: detectorStatus, magnitude, requestPermission, stop: stopDetector } = useFallDetector({
    spikeThreshold: 35,
    onFallDetected: async (confidence) => {
      if (phaseRef.current !== 'idle') return;
      api.simulateFall('phone-accelerometer', confidence).catch(() => {});
      // Alarm will start via Pusher onIncidentNew
    },
  });

  // Send heartbeat telemetry while accelerometer is active so the dashboard can see it
  useEffect(() => {
    if (detectorStatus !== 'active') return;
    const beat = () => api.postTelemetry('phone-accelerometer', { accelerometer_active: true }).catch(() => {});
    beat();
    const id = setInterval(beat, 5000);
    return () => clearInterval(id);
  }, [detectorStatus]);

  useEffect(() => {
    const incidentId = searchParams.get('incident');

    const checkActive = async () => {
      try {
        const data = await api.getHousehold(code);
        // Sync monitoring state
        if (data.monitoring?.paused) {
          phaseRef.current = 'paused';
          setPhase('paused');
          return;
        }
        if (data.monitoring?.pause_requested) {
          phaseRef.current = 'pause_pending';
          setPhase('pause_pending');
          return;
        }
        const inc = data.activeIncident;
        if (!inc) return;
        if (inc.state === 'AWAITING_USER_RESPONSE') {
          const t1DeadlineMs = inc.t1_deadline
            ? Math.max(0, new Date(inc.t1_deadline).getTime() - Date.now())
            : 45000;
          startAlarm({ id: inc.id, confidence: inc.confidence, t1DeadlineMs });
        } else if (['CONTACTS_NOTIFIED', 'CONTACT_RESPONDING'].includes(inc.state)) {
          setIncident({ id: inc.id, confidence: inc.confidence, t1DeadlineMs: 0 });
          phaseRef.current = 'contacts_notified';
          setPhase('contacts_notified');
        }
      } catch {}
    };

    if (incidentId) {
      api.getIncident(incidentId).then(({ incident: inc }) => {
        if (inc.state === 'AWAITING_USER_RESPONSE') {
          const t1DeadlineMs = inc.t1_deadline
            ? Math.max(0, new Date(inc.t1_deadline).getTime() - Date.now())
            : 45000;
          startAlarm({ id: inc.id, confidence: inc.confidence, t1DeadlineMs });
        } else if (inc.state === 'CONTACTS_NOTIFIED') {
          setIncident({ id: inc.id, confidence: inc.confidence, t1DeadlineMs: 0 });
          phaseRef.current = 'contacts_notified';
          setPhase('contacts_notified');
        }
      }).catch(() => {});
    } else {
      checkActive();
    }

    const unsub = subscribeToHousehold(code, {
      onIncidentNew: (data) => {
        startAlarm({ id: data.incidentId, confidence: data.confidence, t1DeadlineMs: data.t1DeadlineMs });
      },
      onIncidentUpdate: (data) => {
        if (['RESOLVED', 'ESCALATED'].includes(data.toState)) {
          stopAlarm();
          if (data.actor === 'at_risk_user') {
            // User dismissed it themselves → back to idle
            phaseRef.current = 'idle';
            setPhase('idle');
            setIncident(null);
            incidentRef.current = null;
          } else if (phaseRef.current === 'alarm' || phaseRef.current === 'contacts_notified') {
            // Caregiver resolved it — show "Help is on the way" until user dismisses
            phaseRef.current = 'contacts_notified';
            setPhase('contacts_notified');
          }
        }
        if (data.toState === 'CONTACTS_NOTIFIED' && phaseRef.current === 'alarm') {
          stopAlarm();
          phaseRef.current = 'contacts_notified';
          setPhase('contacts_notified');
        }
      },
      onMonitoringUpdate: (data) => {
        if (data.paused) {
          phaseRef.current = 'paused';
          setPhase('paused');
        } else if (data.pause_requested) {
          phaseRef.current = 'pause_pending';
          setPhase('pause_pending');
        } else {
          phaseRef.current = 'idle';
          setPhase('idle');
        }
      },
    });

    // Re-sync when PWA comes back to foreground
    function handleVisibility() { if (!document.hidden) checkActive(); }
    document.addEventListener('visibilitychange', handleVisibility);
    return () => { unsub(); stopAlarm(); document.removeEventListener('visibilitychange', handleVisibility); };
  }, [code, searchParams, startAlarm]);

  // ── Idle ─────────────────────────────────────────────────────────────────────
  if (phase === 'idle') {
    return (
      <main style={{
        minHeight: '100dvh', background: tk.bg, fontFamily: tk.sans, color: tk.text,
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '0 20px',
        paddingTop: 'max(56px, env(safe-area-inset-top))',
        paddingBottom: 'max(32px, env(safe-area-inset-bottom))',
      }}>
        <div style={{ width: '100%', maxWidth: 480, flex: 1, display: 'flex', flexDirection: 'column' }}>

          {/* Header */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.8, color: tk.text3,
              textTransform: 'uppercase', marginBottom: 4 }}>Bouy</div>
            <div style={{ fontFamily: tk.sans, fontSize: 32, color: tk.text }}>Your monitor</div>
          </div>

          {/* Status card */}
          {(() => {
            const csiOnline = !!(deviceState && !deviceState.is_stale);
            const accelOnline = detectorStatus === 'active';
            const isOnline = csiOnline || accelOnline;
            const cardBg = isOnline
              ? 'linear-gradient(135deg, #2E5A3E, #3D7A54)'
              : 'linear-gradient(135deg, #5A5A5A, #3A3A3A)';
            const dotColor = isOnline ? '#A8D5B5' : '#9A9A9A';
            const dotShadow = isOnline ? 'rgba(168,213,181,0.25)' : 'rgba(0,0,0,0)';
            const eyebrow = isOnline ? 'All quiet' : 'No signal';
            const headline = isOnline ? 'Monitoring Active' : 'Monitoring Offline';
            const subtitle = csiOnline
              ? 'CSI sensors are active'
              : accelOnline
                ? 'On device · Phone motion sensor active'
                : 'No device data received — sensor may be offline';
            return (
              <div style={{
                background: cardBg, borderRadius: 20,
                padding: '24px 20px', marginBottom: 16, position: 'relative', overflow: 'hidden',
              }}>
                <div style={{ position: 'absolute', right: -30, top: -30, width: 150, height: 150,
                  borderRadius: '50%', background: 'rgba(255,255,255,0.07)' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, position: 'relative' }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: dotColor,
                    boxShadow: `0 0 0 3px ${dotShadow}` }} />
                  <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.8, color: 'rgba(232,240,233,0.80)',
                    textTransform: 'uppercase' }}>{eyebrow}</span>
                </div>
                <div style={{ fontFamily: tk.sans, fontSize: 26, color: 'white', lineHeight: 1.3,
                  position: 'relative', marginBottom: 4 }}>
                  {headline}
                </div>
                <div style={{ fontSize: 13, color: 'rgba(232,240,233,0.65)', position: 'relative' }}>
                  {subtitle}
                </div>
              </div>
            );
          })()}

          {/* Motion sensor card */}
          <div style={{ background: tk.card, borderRadius: 16, padding: 16, marginBottom: 12,
            border: `1px solid ${tk.border}`, boxShadow: tk.shadow }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: tk.text, marginBottom: 12 }}>
              Phone motion sensor
            </div>
            {detectorStatus === 'idle' && (
              <>
                <div style={{ fontSize: 13, color: tk.text3, marginBottom: 12 }}>
                  Enable as a backup fall detector when away from home
                </div>
                <button onClick={requestPermission} style={{
                  width: '100%', height: 44, background: tk.primarySoft, borderRadius: 12,
                  border: 'none', color: tk.primary, fontSize: 15, fontWeight: 600,
                  cursor: 'pointer', fontFamily: tk.sans,
                }}>Enable Motion Detection</button>
              </>
            )}
            {detectorStatus === 'requesting' && (
              <div style={{ fontSize: 13, color: tk.text3 }}>Requesting permission…</div>
            )}
            {detectorStatus === 'active' && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 4, background: tk.success, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: tk.text2, fontFamily: tk.sans }}>Motion sensor active</span>
                </div>
                <button onClick={() => { stopDetector(); }} style={{
                  background: tk.destructiveBg, border: 'none', borderRadius: 10,
                  padding: '6px 12px', color: tk.destructive, fontSize: 13, fontWeight: 600,
                  fontFamily: tk.sans, cursor: 'pointer',
                }}>
                  Turn off
                </button>
              </div>
            )}
            {detectorStatus === 'denied' && (
              <div style={{ fontSize: 13, color: tk.destructive }}>
                Permission denied — CSI monitoring only
              </div>
            )}
            {detectorStatus === 'unsupported' && (
              <div style={{ fontSize: 13, color: tk.text3 }}>Not available on this device</div>
            )}
          </div>

          {/* Pause monitoring — only for CSI, not phone sensor */}
          {!!(deviceState && !deviceState.is_stale) && (
            <button onClick={handleRequestPause} style={{
              width: '100%', padding: '14px 0', background: tk.card, borderRadius: 16,
              border: `1px solid ${tk.border}`, color: tk.text2,
              fontSize: 15, fontWeight: 500, cursor: 'pointer', fontFamily: tk.sans,
              boxShadow: tk.shadow,
            }}>
              Pause monitoring
            </button>
          )}
        </div>
      </main>
    );
  }

  // ── Pause pending (waiting for caregiver approval) ────────────────────────────
  if (phase === 'pause_pending') {
    return (
      <main style={{
        minHeight: '100dvh', background: tk.warningBg, fontFamily: tk.sans,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '32px 24px',
        paddingTop: 'max(52px, env(safe-area-inset-top))',
        paddingBottom: 'max(32px, env(safe-area-inset-bottom))',
      }}>
        <div style={{ width: '100%', maxWidth: 400, textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: 32, background: tk.warningBg,
            border: `2px solid ${tk.warning}`, display: 'flex', alignItems: 'center',
            justifyContent: 'center', margin: '0 auto 20px',
            boxShadow: `0 0 0 8px rgba(154,123,30,0.12)` }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
              stroke={tk.warning} strokeWidth="2" strokeLinecap="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
          </div>
          <div style={{ fontFamily: tk.sans, fontSize: 28, color: tk.text, marginBottom: 8 }}>
            Waiting for approval
          </div>
          <div style={{ fontSize: 15, color: tk.text2, marginBottom: 32, lineHeight: 1.5 }}>
            Your caregivers have been notified. Monitoring will pause once they approve.
          </div>
          <button onClick={handleResume} style={{
            width: '100%', height: 52, background: tk.card, borderRadius: 16,
            border: `1px solid ${tk.border}`, color: tk.text2,
            fontSize: 16, fontWeight: 500, cursor: 'pointer', fontFamily: tk.sans,
          }}>
            Cancel request
          </button>
        </div>
      </main>
    );
  }

  // ── Paused ────────────────────────────────────────────────────────────────────
  if (phase === 'paused') {
    return (
      <main style={{
        minHeight: '100dvh', background: tk.bg, fontFamily: tk.sans,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '32px 24px',
        paddingTop: 'max(52px, env(safe-area-inset-top))',
        paddingBottom: 'max(32px, env(safe-area-inset-bottom))',
      }}>
        <div style={{ width: '100%', maxWidth: 400, textAlign: 'center' }}>
          <div style={{ width: 64, height: 64, borderRadius: 32, background: tk.cardSubtle,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
              stroke={tk.text3} strokeWidth="2" strokeLinecap="round">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          </div>
          <div style={{ fontFamily: tk.sans, fontSize: 28, color: tk.text, marginBottom: 8 }}>
            Monitoring paused
          </div>
          <div style={{ fontSize: 15, color: tk.text2, marginBottom: 32, lineHeight: 1.5 }}>
            Fall detection is currently off. Resume when you're ready.
          </div>
          <button onClick={handleResume} style={{
            width: '100%', height: 52, background: tk.primary, borderRadius: 16,
            border: 'none', color: 'white',
            fontSize: 16, fontWeight: 600, cursor: 'pointer', fontFamily: tk.sans,
          }}>
            Resume monitoring
          </button>
        </div>
      </main>
    );
  }

  // ── Contacts notified ─────────────────────────────────────────────────────────
  if (phase === 'contacts_notified') {
    return (
      <main style={{
        minHeight: '100dvh', background: tk.bg, fontFamily: tk.sans,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '32px 20px',
        paddingTop: 'max(52px, env(safe-area-inset-top))',
        paddingBottom: 'max(32px, env(safe-area-inset-bottom))',
      }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          <div style={{ background: tk.card, borderRadius: 20, padding: '32px 24px',
            boxShadow: tk.shadow, border: `1px solid ${tk.border}`, textAlign: 'center', marginBottom: 12 }}>
            <div style={{ width: 56, height: 56, borderRadius: 28,
              background: tk.warningBg, border: `2px solid rgba(154,123,30,0.25)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                stroke={tk.warning} strokeWidth="2" strokeLinecap="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.64 3.12 2 2 0 0 1 3.62 1h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.96a16 16 0 0 0 6.13 6.13l.97-.97a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            </div>
            <div style={{ fontFamily: tk.sans, fontSize: 28, color: tk.text, marginBottom: 8 }}>
              Help is on the way
            </div>
            <div style={{ fontSize: 15, color: tk.text2, lineHeight: 1.5 }}>
              Your caregivers have been notified and are responding.
            </div>
          </div>
          <button onClick={handleCancel} style={{
            width: '100%', height: 52, background: tk.primarySoft, borderRadius: 16,
            border: `1px solid rgba(46,90,62,0.20)`, color: tk.primary,
            fontSize: 16, fontWeight: 600, cursor: 'pointer', fontFamily: tk.sans,
          }}>
            I'm OK — cancel alert
          </button>
        </div>
      </main>
    );
  }

  // ── Responded ─────────────────────────────────────────────────────────────────
  if (phase === 'responded') {
    const isOk = responseResult === 'ok';
    return (
      <main style={{
        minHeight: '100dvh', background: tk.bg, fontFamily: tk.sans,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '32px 20px',
        paddingTop: 'max(52px, env(safe-area-inset-top))',
        paddingBottom: 'max(32px, env(safe-area-inset-bottom))',
      }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          <div style={{ background: tk.card, borderRadius: 20, padding: '32px 24px',
            boxShadow: tk.shadow, border: `1px solid ${tk.border}`, textAlign: 'center' }}>
            <div style={{ width: 56, height: 56, borderRadius: 28,
              background: isOk ? tk.successBg : tk.destructiveBg,
              border: `2px solid ${isOk ? 'rgba(45,122,69,0.25)' : 'rgba(184,77,42,0.25)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                stroke={isOk ? tk.success : tk.destructive} strokeWidth="2.5" strokeLinecap="round">
                {isOk
                  ? <path d="M4 12l5 5L20 6" />
                  : <path d="M12 8v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />}
              </svg>
            </div>
            <div style={{ fontFamily: tk.sans, fontSize: 28, color: tk.text, marginBottom: 8 }}>
              {isOk ? 'All clear' : 'Help is coming'}
            </div>
            <div style={{ fontSize: 15, color: tk.text2, lineHeight: 1.5 }}>
              {isOk ? "Alert cancelled. Glad you're OK." : 'Your caregivers have been notified.'}
            </div>
          </div>
          {!isOk && (
            <button onClick={handleCancel} style={{
              width: '100%', height: 52, background: tk.primarySoft, borderRadius: 16,
              border: `1px solid rgba(46,90,62,0.20)`, color: tk.primary,
              fontSize: 16, fontWeight: 600, cursor: 'pointer', fontFamily: tk.sans,
              marginTop: 12,
            }}>
              I'm OK — cancel alert
            </button>
          )}
        </div>
      </main>
    );
  }

  // ── Alarm ─────────────────────────────────────────────────────────────────────
  return (
    <main style={{
      minHeight: '100dvh',
      background: `linear-gradient(135deg, ${tk.destructive}, #8B3520)`,
      fontFamily: tk.sans,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      padding: '32px 24px',
      paddingTop: 'max(52px, env(safe-area-inset-top))',
      paddingBottom: 'max(32px, env(safe-area-inset-bottom))',
      position: 'relative', overflow: 'hidden',
    }}>
      {/* Pulsing ring */}
      <div style={{
        position: 'absolute', inset: 0,
        border: '6px solid rgba(255,255,255,0.15)',
        borderRadius: 0, animation: 'pulse 1.5s ease-in-out infinite',
        pointerEvents: 'none',
      }} />

      <div style={{ width: '100%', maxWidth: 400, textAlign: 'center', position: 'relative' }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, color: 'rgba(250,229,222,0.80)',
          textTransform: 'uppercase', marginBottom: 16 }}>
          Fall detected
        </div>

        <div style={{ fontFamily: tk.sans, fontSize: 36, color: 'white', marginBottom: 8, lineHeight: 1.2 }}>
          Are you OK?
        </div>
        <div style={{ fontSize: 14, color: 'rgba(250,229,222,0.75)', marginBottom: 32 }}>
          Caregivers will be notified in
        </div>

        {/* Countdown */}
        <div style={{
          fontFamily: 'ui-monospace, monospace', fontSize: 80, fontWeight: 700,
          color: 'white', lineHeight: 1, marginBottom: 8,
          textShadow: '0 2px 20px rgba(0,0,0,0.20)',
        }}>
          {secondsLeft}
        </div>
        <div style={{ fontSize: 13, color: 'rgba(250,229,222,0.60)', marginBottom: 40 }}>seconds</div>

        {/* Buttons */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <button onClick={() => handleRespond('ok')} style={{
            width: '100%', height: 60, background: 'white', borderRadius: 18,
            border: 'none', color: tk.success, fontSize: 18, fontWeight: 700,
            cursor: 'pointer', fontFamily: tk.sans,
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          }}>
            I'm OK
          </button>
          <button onClick={() => handleRespond('help')} style={{
            width: '100%', height: 52, background: 'rgba(255,255,255,0.15)', borderRadius: 18,
            border: '1px solid rgba(255,255,255,0.30)', color: 'white',
            fontSize: 16, fontWeight: 600, cursor: 'pointer', fontFamily: tk.sans,
          }}>
            I need help
          </button>
        </div>
      </div>
    </main>
  );
}
