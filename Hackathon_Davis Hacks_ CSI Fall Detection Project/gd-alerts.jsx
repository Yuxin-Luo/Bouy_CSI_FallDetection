// Buoy — Alerts screen (caregiver)
// Active fall in progress at top, history below. Optional variance traces.

const GDVarianceTrace = ({ color = gdTokens.red, spike = true, height = 28, width = '100%' }) => {
  const N = 60;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 100;
    let y = 50 + Math.sin(i * 0.55) * 5 + Math.sin(i * 1.3) * 3 + (Math.random() - 0.5) * 4;
    if (spike && i > N * 0.5 && i < N * 0.75) {
      const k = (i - N * 0.5) / (N * 0.25);
      y = 50 - Math.sin(k * Math.PI) * 38 + (Math.random() - 0.5) * 4;
    }
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none"
      width={width} height={height} style={{ display: 'block' }}>
      <polyline points={pts.join(' ')} fill="none" stroke={color}
        strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round"
        vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

const GDAlertsScreen = () => (
  <div style={{ background: gdTokens.bg, fontFamily: gdTokens.sf,
    height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
    {/* large title */}
    <div style={{ padding: '52px 20px 6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 0.4 }}>Alerts</div>
          <div style={{ fontSize: 15, color: gdTokens.text3, marginTop: 2 }}>
            1 active · 14 in last 30 days
          </div>
        </div>
        <div style={{ width: 36, height: 36, borderRadius: 18, background: gdTokens.card,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
          <GDSymbol name="ellipsis.circle" size={20} color={gdTokens.blue}/>
        </div>
      </div>
    </div>

    <div style={{ padding: '10px 16px 16px', flex: 1 }}>
      {/* ACTIVE EVENT — the big one */}
      <div style={{ marginBottom: 8, paddingLeft: 4,
        display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ width: 8, height: 8, borderRadius: 4, background: gdTokens.red,
          animation: 'gd-pulse 1.4s ease-in-out infinite' }}/>
        <div style={{ fontSize: 13, color: gdTokens.red, fontWeight: 700, letterSpacing: 0.4 }}>
          ACTIVE NOW
        </div>
      </div>

      <GDCard style={{ padding: 0, overflow: 'hidden',
        boxShadow: '0 0 0 1px rgba(255,59,48,0.20), 0 8px 24px rgba(255,59,48,0.10)' }}>
        <div style={{ padding: '16px 16px 12px', background: gdTokens.redBg }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <GDSymbol name="exclamationmark.triangle.fill" size={18} color={gdTokens.red}/>
            <div style={{ fontSize: 13, color: gdTokens.red, fontWeight: 700, letterSpacing: 0.4 }}>
              FALL DETECTED · 0:23 LEFT
            </div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 700, marginTop: 8, lineHeight: 1.15 }}>
            Mom may have fallen<br/>
            in the <span style={{ color: gdTokens.red }}>living room</span>
          </div>
          <div style={{ fontSize: 13, color: gdTokens.text2, marginTop: 6 }}>
            High confidence (93%) · 2 seconds ago · RX2 detected the fall
          </div>
        </div>

        {/* action stack */}
        <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, height: 44, background: gdTokens.green, borderRadius: 22,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              color: 'white', fontSize: 16, fontWeight: 600 }}>
              <GDSymbol name="phone.fill" size={16} color="white"/> Call Mom
            </div>
            <div style={{ flex: 1, height: 44, background: gdTokens.red, borderRadius: 22,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              color: 'white', fontSize: 16, fontWeight: 700 }}>
              <GDSymbol name="phone.fill" size={16} color="white"/> Call 911
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{ flex: 1, height: 36, background: gdTokens.cardSubtle, borderRadius: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: gdTokens.blue, fontSize: 14, fontWeight: 600,
              border: '0.5px solid ' + gdTokens.border }}>
              Open map
            </div>
            <div style={{ flex: 1, height: 36, background: gdTokens.cardSubtle, borderRadius: 18,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: gdTokens.text2, fontSize: 14, fontWeight: 600,
              border: '0.5px solid ' + gdTokens.border }}>
              Mark false alarm
            </div>
          </div>
        </div>
      </GDCard>

      {/* HISTORY */}
      <GDSectionHeader title="History" action="Filter" />
      <GDCard style={{ padding: 0, overflow: 'hidden' }}>
        {[
          { d: 'Tue · Mar 4', t: '3:14 pm', s: 'Living room',
            tag: 'False alarm', tagKind: 'orange', conf: '93%', spike: true },
          { d: 'Mon · Mar 3', t: '8:02 am', s: 'Bathroom',
            tag: 'Real fall', tagKind: 'red', conf: '78%', spike: true },
          { d: 'Sun · Mar 2', t: '2:11 pm', s: 'Kitchen',
            tag: 'False alarm', tagKind: 'orange', conf: '64%', spike: true },
          { d: 'Sat · Mar 1', t: '11:55 pm', s: 'Bedroom',
            tag: 'Pending review', tagKind: 'blue', conf: '88%', spike: true },
        ].map((a, i) => (
          <div key={i} style={{
            padding: '12px 16px',
            borderTop: i === 0 ? 'none' : '0.5px solid ' + gdTokens.border,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>
                  {a.s} · <span style={{ color: gdTokens.text3, fontWeight: 400 }}>{a.t}</span>
                </div>
                <div style={{ fontSize: 13, color: gdTokens.text3, marginTop: 1 }}>
                  {a.d} · {a.conf} confidence
                </div>
              </div>
              <GDPill kind={a.tagKind}>{a.tag}</GDPill>
            </div>
            <div style={{ marginTop: 8, padding: '6px 0',
              borderTop: '0.5px dashed ' + gdTokens.border }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                marginBottom: 4 }}>
                <div style={{ fontSize: 11, color: gdTokens.text3, fontWeight: 600,
                  letterSpacing: 0.3, textTransform: 'uppercase' }}>
                  Variance — RX2
                </div>
                <div style={{ fontSize: 11, color: gdTokens.text3, fontFamily: gdTokens.sfMono }}>
                  show traces ▾
                </div>
              </div>
              <GDVarianceTrace color={a.tagKind === 'red' ? gdTokens.red
                : a.tagKind === 'orange' ? gdTokens.orange : gdTokens.blue}
                height={26} spike={a.spike} />
            </div>
          </div>
        ))}
      </GDCard>

      {/* Summary */}
      <GDSectionHeader title="Summary · 30 days" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <GDCard style={{ padding: 14, marginBottom: 0 }}>
          <div style={{ fontSize: 12, color: gdTokens.text3, fontWeight: 600, letterSpacing: 0.3 }}>REAL</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 2, color: gdTokens.red }}>3</div>
        </GDCard>
        <GDCard style={{ padding: 14, marginBottom: 0 }}>
          <div style={{ fontSize: 12, color: gdTokens.text3, fontWeight: 600, letterSpacing: 0.3 }}>FALSE</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 2, color: gdTokens.orange }}>11</div>
        </GDCard>
        <GDCard style={{ padding: 14, marginBottom: 0 }}>
          <div style={{ fontSize: 12, color: gdTokens.text3, fontWeight: 600, letterSpacing: 0.3 }}>PRECISION</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 2, color: gdTokens.green }}>21%</div>
        </GDCard>
      </div>
    </div>

    <GDTabBar active="Alerts" />
  </div>
);

window.GDAlertsScreen = GDAlertsScreen;
window.GDVarianceTrace = GDVarianceTrace;
