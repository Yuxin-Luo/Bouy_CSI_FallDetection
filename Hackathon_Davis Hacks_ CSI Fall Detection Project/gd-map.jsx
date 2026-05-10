// Buoy — Map screen (caregiver)
// Big top-down floor plan, presence indicator, sensor health, layer chips.

const GDFloorPlanLarge = () => (
  <svg viewBox="0 0 360 380" width="100%" style={{ display: 'block' }}>
    <defs>
      <radialGradient id="presence" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#0A84FF" stopOpacity="0.35"/>
        <stop offset="100%" stopColor="#0A84FF" stopOpacity="0"/>
      </radialGradient>
      <pattern id="dot-grid" x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="1" fill="rgba(60,60,67,0.10)"/>
      </pattern>
    </defs>

    {/* dot grid background */}
    <rect x="0" y="0" width="360" height="380" fill="url(#dot-grid)"/>

    {/* outer wall */}
    <rect x="14" y="14" width="332" height="352" rx="4" fill="white"
      stroke="rgba(60,60,67,0.40)" strokeWidth="1.6"/>

    {/* rooms */}
    {[
      { x: 14,  y: 14,  w: 130, h: 150, label: 'Kitchen',     fill: 'rgba(255,149,0,0.06)' },
      { x: 144, y: 14,  w: 202, h: 200, label: 'Living Room', fill: 'rgba(10,132,255,0.10)' },
      { x: 14,  y: 164, w: 130, h: 202, label: 'Bedroom',     fill: 'rgba(94,92,230,0.06)' },
      { x: 144, y: 214, w: 90,  h: 152, label: 'Bath',        fill: 'rgba(229,229,234,0.6)' },
      { x: 234, y: 214, w: 112, h: 152, label: 'Hall',        fill: 'rgba(229,229,234,0.4)' },
    ].map(r => (
      <g key={r.label}>
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={r.fill}
          stroke="rgba(60,60,67,0.35)" strokeWidth="0.8" rx="2"/>
        <text x={r.x + 8} y={r.y + 16}
          fontFamily={gdTokens.sf} fontSize="11" fill="rgba(60,60,67,0.65)"
          fontWeight="600" letterSpacing="0.2">{r.label}</text>
      </g>
    ))}

    {/* presence glow */}
    <circle cx="220" cy="100" r="80" fill="url(#presence)" />

    {/* sensors */}
    {[
      { x: 78,  y: 90,  k: 'rx', l: '1' },
      { x: 245, y: 60,  k: 'rx', l: '2' },
      { x: 200, y: 110, k: 'tx', l: 'TX' },
      { x: 78,  y: 280, k: 'rx', l: '3' },
      { x: 290, y: 290, k: 'rx', l: '4' },
    ].map((s, i) => (
      <g key={i}>
        {/* coverage halo */}
        {s.k === 'rx' && (
          <circle cx={s.x} cy={s.y} r="55" fill="none"
            stroke="rgba(52,199,89,0.25)" strokeWidth="1" strokeDasharray="2 4"/>
        )}
        {/* TX broadcasts (concentric rings) */}
        {s.k === 'tx' && (
          <>
            <circle cx={s.x} cy={s.y} r="22" fill="none" stroke="#0A84FF" strokeWidth="1" opacity="0.5"/>
            <circle cx={s.x} cy={s.y} r="32" fill="none" stroke="#0A84FF" strokeWidth="0.8" opacity="0.3"/>
            <circle cx={s.x} cy={s.y} r="44" fill="none" stroke="#0A84FF" strokeWidth="0.6" opacity="0.18"/>
          </>
        )}
        <circle cx={s.x} cy={s.y} r="11" fill="white" stroke="rgba(0,0,0,0.06)" strokeWidth="1"/>
        <circle cx={s.x} cy={s.y} r="9" fill={s.k === 'tx' ? gdTokens.blue : gdTokens.green}/>
        <text x={s.x} y={s.y + 3} textAnchor="middle"
          fontFamily={gdTokens.sf} fontSize={s.k === 'tx' ? 8 : 9}
          fill="white" fontWeight="700">{s.l}</text>
      </g>
    ))}

    {/* person figure */}
    <g transform="translate(214, 90)">
      <circle r="14" fill="white" stroke="#0A84FF" strokeWidth="2"/>
      <circle cy="-4" r="3" fill="#0A84FF"/>
      <path d="M -4,2 L 4,2 L 3,7 L -3,7 Z" fill="#0A84FF"/>
    </g>
  </svg>
);

const GDMapScreen = () => (
  <div style={{ background: gdTokens.bg, fontFamily: gdTokens.sf,
    height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
    {/* large title */}
    <div style={{ padding: '52px 20px 6px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 0.4 }}>Map</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <div style={{ width: 36, height: 36, borderRadius: 18, background: gdTokens.card,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
            <GDSymbol name="magnifyingglass" size={18} color={gdTokens.blue}/>
          </div>
          <div style={{ width: 36, height: 36, borderRadius: 18, background: gdTokens.card,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
            <GDSymbol name="ellipsis.circle" size={20} color={gdTokens.blue}/>
          </div>
        </div>
      </div>
      <div style={{ fontSize: 15, color: gdTokens.text3, marginTop: 2 }}>
        Mom · in living room · 14 min still
      </div>
    </div>

    {/* layer chips */}
    <div style={{ padding: '10px 16px 4px', display: 'flex', gap: 8, overflow: 'auto' }}>
      {[
        { l: 'Presence',   on: true },
        { l: 'Coverage',   on: true },
        { l: 'Heatmap',    on: false },
        { l: 'Sensor IDs', on: true },
        { l: 'Trails',     on: false },
      ].map(c => (
        <div key={c.l} style={{
          padding: '7px 12px', borderRadius: 14,
          background: c.on ? gdTokens.blue : gdTokens.card,
          color: c.on ? 'white' : gdTokens.text2,
          fontSize: 13, fontWeight: 600,
          boxShadow: c.on ? 'none' : '0 1px 2px rgba(0,0,0,0.04)',
          flexShrink: 0,
        }}>{c.l}</div>
      ))}
    </div>

    <div style={{ padding: '8px 16px 16px' }}>
      {/* the map card */}
      <GDCard style={{ padding: 12, background: '#FCFCFE' }}>
        <GDFloorPlanLarge />
      </GDCard>

      {/* legend / quick stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
        <GDCard style={{ marginBottom: 0, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <GDSymbol name="figure.walk" size={18} color={gdTokens.blue}/>
            <div style={{ fontSize: 13, color: gdTokens.text3, fontWeight: 600, letterSpacing: 0.2 }}>PRESENCE</div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>Living Room</div>
          <div style={{ fontSize: 13, color: gdTokens.text3, marginTop: 2 }}>Confidence 94%</div>
        </GDCard>
        <GDCard style={{ marginBottom: 0, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <GDSymbol name="sensor.tag.radiowaves.forward" size={18} color={gdTokens.green}/>
            <div style={{ fontSize: 13, color: gdTokens.text3, fontWeight: 600, letterSpacing: 0.2 }}>SENSORS</div>
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, marginTop: 6 }}>4 of 4</div>
          <div style={{ fontSize: 13, color: '#1B7B3A', marginTop: 2, fontWeight: 500 }}>All healthy</div>
        </GDCard>
      </div>

      {/* tap-a-room */}
      <GDSectionHeader title="Rooms" action="Reorder" />
      <GDCard style={{ padding: 0 }}>
        {[
          { k: 'Living Room', sub: 'Active · 14 min', tag: 'now', tagKind: 'blue' },
          { k: 'Kitchen',     sub: 'Last seen 1:48 pm', tag: '1h ago' },
          { k: 'Bedroom',     sub: 'Last seen 7:12 am', tag: '8h ago' },
          { k: 'Bath',        sub: 'Last seen 1:50 pm', tag: '1h ago' },
        ].map((r, i, arr) => (
          <div key={r.k} style={{ display: 'flex', alignItems: 'center', gap: 12,
            padding: '12px 16px',
            borderTop: i === 0 ? 'none' : '0.5px solid ' + gdTokens.border }}>
            <div style={{ width: 6, height: 32, borderRadius: 3,
              background: i === 0 ? gdTokens.blue : 'rgba(60,60,67,0.18)' }}/>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 500 }}>{r.k}</div>
              <div style={{ fontSize: 13, color: gdTokens.text3 }}>{r.sub}</div>
            </div>
            <div style={{ fontSize: 13, color: r.tagKind === 'blue' ? gdTokens.blue : gdTokens.text3,
              fontWeight: 600 }}>{r.tag}</div>
            <GDSymbol name="chevron.right" size={15} color={gdTokens.text4}/>
          </div>
        ))}
      </GDCard>
    </div>

    <GDTabBar active="Map" />
  </div>
);

window.GDMapScreen = GDMapScreen;
