// Primitive sketch components — phone frames, monitor, floor plans, charts
// All use the .paper graph-paper bg and the #sketchy SVG filter for hand-drawn feel.

const SketchyFilter = () => (
  <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
    <defs>
      <filter id="sketchy" x="-2%" y="-2%" width="104%" height="104%">
        <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="3" />
        <feDisplacementMap in="SourceGraphic" scale="1.6" />
      </filter>
      <filter id="sketchy-strong" x="-3%" y="-3%" width="106%" height="106%">
        <feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="2" seed="5" />
        <feDisplacementMap in="SourceGraphic" scale="2.2" />
      </filter>
    </defs>
  </svg>
);

// Phone frame — children render inside the screen area with column layout
const Phone = ({ children, label, style, className = '', tall, wide }) => (
  <div className={`phone ${tall ? 'tall' : ''} ${wide ? 'wide' : ''} ${className}`} style={style}>
    <div className="phone-notch" />
    <div className="phone-screen">
      <div className="statusbar">
        <span>9:41</span>
        <span>●●● ◯ 87%</span>
      </div>
      {children}
    </div>
    <div className="phone-home" />
  </div>
);

// Desktop monitor frame
const Monitor = ({ children, style }) => (
  <div className="monitor" style={style}>
    <div className="monitor-screen">{children}</div>
  </div>
);

// Standard caregiver tab bar
const TabBar = ({ active = 'Map' }) => {
  const tabs = ['Home', 'Map', 'Alerts', 'Notif', 'More'];
  return (
    <div className="tabbar">
      {tabs.map(t => (
        <div key={t} className={`tab ${active === t ? 'on' : ''}`}>
          <div style={{ width: 14, height: 14, border: '1.5px solid currentColor', borderRadius: t === 'More' ? 2 : 50 }} />
          {t}
        </div>
      ))}
    </div>
  );
};

// A floor plan — pass rooms as {label,x,y,w,h,fill?} and sensors as {kind,label,x,y}
const FloorPlan = ({ width = 220, height = 180, rooms = [], sensors = [], coverage = [], person, fall, trail = [], style }) => (
  <div className="relative" style={{ width, height, margin: '0 auto', ...style }}>
    {coverage.map((c, i) => (
      <div key={'c' + i} className="coverage" style={{ left: c.x - c.r, top: c.y - c.r, width: c.r * 2, height: c.r * 2 }} />
    ))}
    {rooms.map((r, i) => (
      <div key={'r' + i} className={`room ${r.fill || ''}`}
        style={{ left: r.x, top: r.y, width: r.w, height: r.h, background: r.fillColor }}>
        <div className="room-label" style={{ left: 4, top: 2 }}>{r.label}</div>
      </div>
    ))}
    {trail.map((t, i) => (
      <svg key={'t' + i} style={{ position: 'absolute', left: 0, top: 0, width, height, pointerEvents: 'none' }}>
        <line x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
          stroke={t.color || 'var(--alert)'} strokeWidth={t.w || 2}
          strokeDasharray="4 3" opacity="0.7" />
      </svg>
    ))}
    {sensors.map((s, i) => (
      <div key={'s' + i} className={`sensor ${s.kind || ''} ${s.alert ? 'alert' : ''}`}
        style={{ left: s.x - 9, top: s.y - 9 }}>
        {s.kind === 'tx' && <div className="ping" />}
        {s.alert && <div className="ping alert-ping" />}
        <span style={{ position: 'relative' }}>{s.label}</span>
      </div>
    ))}
    {person && (
      <div className="absolute" style={{ left: person.x - 8, top: person.y - 14 }}>
        <svg width="16" height="22" viewBox="0 0 16 22" fill="none" stroke="var(--ink)" strokeWidth="2">
          <circle cx="8" cy="4" r="3" />
          <line x1="8" y1="7" x2="8" y2="14" />
          <line x1="8" y1="10" x2="3" y2="13" /><line x1="8" y1="10" x2="13" y2="13" />
          <line x1="8" y1="14" x2="4" y2="20" /><line x1="8" y1="14" x2="12" y2="20" />
        </svg>
      </div>
    )}
    {fall && (
      <div className="absolute" style={{ left: fall.x - 12, top: fall.y - 6 }}>
        <svg width="24" height="14" viewBox="0 0 24 14" fill="none" stroke="var(--alert)" strokeWidth="2">
          <ellipse cx="12" cy="7" rx="10" ry="4" />
          <circle cx="4" cy="7" r="2.5" fill="var(--alert-fill)" />
        </svg>
      </div>
    )}
  </div>
);

// Variance / motion graph squiggle as inline SVG
const Squiggle = ({ width = 140, height = 36, spike, stroke = 'var(--ink-soft)', fill = 'none' }) => {
  const pts = [];
  const N = 40;
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * width;
    let y = height / 2 + Math.sin(i * 0.6) * 3 + Math.sin(i * 1.7) * 2 + (Math.random() - 0.5) * 2.5;
    if (spike && i > N * 0.55 && i < N * 0.75) {
      const k = (i - N * 0.55) / (N * 0.2);
      const env = Math.sin(k * Math.PI);
      y = height / 2 - env * (height * 0.4) + (Math.random() - 0.5) * 3;
    }
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return (
    <svg width={width} height={height} style={{ overflow: 'visible' }}>
      <polyline points={pts.join(' ')} fill={fill} stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
};

// Day-strip: array of {color, w} -> coloured bands summing to 100
const DayStrip = ({ bands, height = 14 }) => (
  <div className="daystrip" style={{ height }}>
    {bands.map((b, i) => (
      <span key={i} style={{ width: `${b.w}%`, background: b.color, opacity: b.opacity || 0.7 }} />
    ))}
  </div>
);

// Calendar heatmap
const Heatmap = ({ weeks = 8, cols = 7, sparse }) => {
  const cells = [];
  for (let w = 0; w < weeks; w++) {
    for (let d = 0; d < cols; d++) {
      const v = sparse ? (Math.random() < 0.6 ? 0.15 : Math.random()) : Math.random();
      const c = v < 0.2 ? '#e8dfc8' : v < 0.45 ? 'var(--ok-fill)' : v < 0.75 ? 'var(--accent-fill)' : 'var(--warn-fill)';
      cells.push(<div key={`${w}-${d}`} style={{ background: c, border: '1px solid var(--ink-faint)', borderRadius: 2 }} />);
    }
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${weeks}, 1fr)`, gridAutoFlow: 'column',
      gridTemplateRows: `repeat(${cols}, 10px)`, gap: 2, width: '100%' }}>{cells}</div>
  );
};

// Sketchy hand-drawn arrow / annotation
const HandArrow = ({ from, to, color = 'var(--accent)', label, curve = 0 }) => {
  const dx = to.x - from.x, dy = to.y - from.y;
  const mx = (from.x + to.x) / 2 + curve, my = (from.y + to.y) / 2 - Math.abs(curve) * 0.3;
  const angle = Math.atan2(to.y - my, to.x - mx);
  const arrowSize = 8;
  return (
    <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible' }}>
      <path d={`M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`}
        fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" filter="url(#sketchy-strong)" />
      <polygon points={`0,0 ${-arrowSize},${arrowSize / 2} ${-arrowSize},${-arrowSize / 2}`}
        fill={color} transform={`translate(${to.x},${to.y}) rotate(${(angle * 180) / Math.PI})`} />
      {label && (
        <text x={mx} y={my - 4} fill={color} fontFamily="Caveat" fontWeight="600" fontSize="13" textAnchor="middle">{label}</text>
      )}
    </svg>
  );
};

// PostIt note callout
const Note = ({ children, style, color }) => (
  <div className="absolute" style={{
    background: color || '#fef4a8', color: '#5a4a2a',
    fontFamily: 'var(--hand)', fontWeight: 600, fontSize: 13,
    padding: '6px 10px', borderRadius: 3, transform: 'rotate(-1.5deg)',
    boxShadow: '1px 2px 0 rgba(0,0,0,0.15)',
    maxWidth: 180, lineHeight: 1.15, ...style,
  }}>{children}</div>
);

Object.assign(window, { SketchyFilter, Phone, Monitor, TabBar, FloorPlan, Squiggle, DayStrip, Heatmap, HandArrow, Note });
