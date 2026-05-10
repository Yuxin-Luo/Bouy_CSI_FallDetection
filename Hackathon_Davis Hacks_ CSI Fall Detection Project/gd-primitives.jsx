// SF-styled iOS primitives for Buoy — built on top of ios-frame.jsx
// Naming: gd* (buoy) to avoid collisions with other style objects.

const gdTokens = {
  bg: '#F2F2F7',
  card: '#FFFFFF',
  cardSubtle: '#F8F8FA',
  border: 'rgba(60,60,67,0.10)',
  text: '#000000',
  text2: 'rgba(60,60,67,0.85)',
  text3: 'rgba(60,60,67,0.60)',
  text4: 'rgba(60,60,67,0.30)',
  blue: '#0A84FF',
  green: '#34C759',
  red: '#FF3B30',
  orange: '#FF9500',
  yellow: '#FFCC00',
  indigo: '#5E5CE6',
  greenBg: '#E8F8EC',
  redBg: '#FDECEB',
  orangeBg: '#FFF1DF',
  blueBg: '#E5F2FF',
  sf: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", system-ui, sans-serif',
  sfMono: 'ui-monospace, "SF Mono", Menlo, monospace',
  sfRound: '-apple-system, BlinkMacSystemFont, "SF Pro Rounded", "SF Pro Display", system-ui, sans-serif',
};

// ---- Symbols (SF-Symbol-like inline SVGs, sized to fit common iOS sizes) ----
const GDSymbol = ({ name, size = 17, color = gdTokens.text, weight = 'regular' }) => {
  const sw = weight === 'bold' ? 2.2 : weight === 'medium' ? 1.9 : 1.6;
  const map = {
    'house.fill': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M12 3 2 12h3v8h5v-6h4v6h5v-8h3z" />
      </svg>
    ),
    'house': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round">
        <path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-4v-6H10v6H4a1 1 0 0 1-1-1z"/>
      </svg>
    ),
    'map.fill': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M3 5v15l6-2 6 2 6-2V3l-6 2-6-2zM9 4v14M15 6v14"/>
      </svg>
    ),
    'map': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round">
        <path d="M3 5v15l6-2 6 2 6-2V3l-6 2-6-2zM9 4v14M15 6v14"/>
      </svg>
    ),
    'bell.fill': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-5v-1l-1.5-1.5V11a5.5 5.5 0 0 0-4.5-5.4V5a1 1 0 0 0-2 0v.6A5.5 5.5 0 0 0 6.5 11v3.5L5 16v1z"/>
      </svg>
    ),
    'bell': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round" strokeLinecap="round">
        <path d="M6 9a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9z"/>
        <path d="M10 21a2 2 0 0 0 4 0"/>
      </svg>
    ),
    'bell.badge.fill': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-5v-1l-1.5-1.5V11a5.5 5.5 0 0 0-4.5-5.4V5a1 1 0 0 0-2 0v.6A5.5 5.5 0 0 0 6.5 11v3.5L5 16v1z"/>
        <circle cx="19" cy="5" r="3.5" fill="#FF3B30" stroke="white" strokeWidth="1.4"/>
      </svg>
    ),
    'message.fill': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9l-5 4v-4H5a2 2 0 0 1-2-2z"/>
      </svg>
    ),
    'message': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinejoin="round">
        <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9l-5 4v-4H5a2 2 0 0 1-2-2z"/>
      </svg>
    ),
    'ellipsis.circle.fill': (
      <svg width={size} height={size} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" fill={color}/>
        <circle cx="7" cy="12" r="1.4" fill="white"/>
        <circle cx="12" cy="12" r="1.4" fill="white"/>
        <circle cx="17" cy="12" r="1.4" fill="white"/>
      </svg>
    ),
    'ellipsis.circle': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw}>
        <circle cx="12" cy="12" r="10"/>
        <circle cx="7" cy="12" r="1.2" fill={color} stroke="none"/>
        <circle cx="12" cy="12" r="1.2" fill={color} stroke="none"/>
        <circle cx="17" cy="12" r="1.2" fill={color} stroke="none"/>
      </svg>
    ),
    'phone.fill': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11 11 0 0 0 3.5.55 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11 11 0 0 0 .55 3.5 1 1 0 0 1-.25 1z"/>
      </svg>
    ),
    'figure.walk': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <circle cx="14" cy="4" r="2"/>
        <path d="M11 8l-3 4 1 5-2 5h2l2-4 1.5 1.5V22h2v-4l-2-3 1-3 2 2.5h2l-2-4-3-2.5z"/>
      </svg>
    ),
    'figure.fall': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <circle cx="6" cy="6" r="2"/>
        <path d="M9 9 4 14l-1 6h2l1-3 7 1 7-1v-2l-5 0-3-2 1-2 4 2 3-2-2-2-5-1z"/>
      </svg>
    ),
    'wifi': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round">
        <path d="M2 9a14 14 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8 16a6 6 0 0 1 8 0"/>
        <circle cx="12" cy="19.5" r="1.2" fill={color}/>
      </svg>
    ),
    'sensor.tag.radiowaves.forward': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round">
        <circle cx="6" cy="12" r="2.2" fill={color} stroke="none"/>
        <path d="M10 8a6 6 0 0 1 0 8M14 5a10 10 0 0 1 0 14M18 2a14 14 0 0 1 0 20"/>
      </svg>
    ),
    'chevron.right': (
      <svg width={size * 0.45} height={size * 0.85} viewBox="0 0 8 14" fill="none">
        <path d="M1 1l6 6-6 6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    'chevron.down': (
      <svg width={size * 0.7} height={size * 0.45} viewBox="0 0 14 8" fill="none">
        <path d="M1 1l6 6 6-6" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    ),
    'checkmark': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw + 0.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12l5 5L20 6"/>
      </svg>
    ),
    'checkmark.circle.fill': (
      <svg width={size} height={size} viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill={color}/><path d="M7 12l3.5 3.5L17 9" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
    ),
    'exclamationmark.triangle.fill': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M12 2 1 21h22z" />
        <rect x="11" y="9" width="2" height="6" fill="white"/>
        <circle cx="12" cy="18" r="1.2" fill="white"/>
      </svg>
    ),
    'plus': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw + 0.4} strokeLinecap="round">
        <path d="M12 5v14M5 12h14"/>
      </svg>
    ),
    'magnifyingglass': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round">
        <circle cx="11" cy="11" r="7"/>
        <path d="M21 21l-4.5-4.5"/>
      </svg>
    ),
    'heart.text.square.fill': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <rect x="2" y="2" width="20" height="20" rx="5" />
        <path d="M12 17s-5-3-5-7a3 3 0 0 1 5-2 3 3 0 0 1 5 2c0 4-5 7-5 7z" fill="white"/>
      </svg>
    ),
    'heart.fill': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M12 21s-7-4.5-7-11a4.5 4.5 0 0 1 7-3.5A4.5 4.5 0 0 1 19 10c0 6.5-7 11-7 11z"/>
      </svg>
    ),
    'lock.shield.fill': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M12 2 4 5v6c0 5 3.5 9 8 11 4.5-2 8-6 8-11V5z"/>
        <rect x="9" y="11" width="6" height="6" rx="1" fill="white"/>
        <path d="M10 11V9a2 2 0 0 1 4 0v2" fill="none" stroke="white" strokeWidth="1.4"/>
      </svg>
    ),
    'gearshape.fill': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm9-.5a8.7 8.7 0 0 0-.6-1.5l1.4-2-2-2-2 1.4a8.7 8.7 0 0 0-1.5-.6L15.5 1h-3l-.8 2.4a8.7 8.7 0 0 0-1.5.6L8.2 2.4l-2 2 1.4 2A8.7 8.7 0 0 0 7 8L4.6 8.7v3l2.4.8a8.7 8.7 0 0 0 .6 1.5L6.2 16l2 2 2-1.4a8.7 8.7 0 0 0 1.5.6L12.5 19h3l.8-1.8a8.7 8.7 0 0 0 1.5-.6l2 1.4 2-2-1.4-2 .6-1.5L23 11.5v-3z"/>
      </svg>
    ),
    'person.crop.circle.fill': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <circle cx="12" cy="12" r="11"/>
        <circle cx="12" cy="10" r="3.5" fill="white"/>
        <path d="M5.5 19c1-3.5 4-5 6.5-5s5.5 1.5 6.5 5" fill="white"/>
      </svg>
    ),
    'square.grid.2x2.fill': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
        <rect x="3" y="3" width="8" height="8" rx="1.5"/>
        <rect x="13" y="3" width="8" height="8" rx="1.5"/>
        <rect x="3" y="13" width="8" height="8" rx="1.5"/>
        <rect x="13" y="13" width="8" height="8" rx="1.5"/>
      </svg>
    ),
    'square.grid.2x2': (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw}>
        <rect x="3" y="3" width="8" height="8" rx="1.5"/>
        <rect x="13" y="3" width="8" height="8" rx="1.5"/>
        <rect x="3" y="13" width="8" height="8" rx="1.5"/>
        <rect x="13" y="13" width="8" height="8" rx="1.5"/>
      </svg>
    ),
  };
  return map[name] || null;
};

// ---- Tab bar (iOS) ----
const GDTabBar = ({ active = 'Home' }) => {
  const items = [
    { k: 'Home',   icon: 'house',          iconOn: 'house.fill' },
    { k: 'Map',    icon: 'map',            iconOn: 'map.fill' },
    { k: 'Alerts', icon: 'bell',           iconOn: 'bell.fill', badge: 1 },
    { k: 'Notify', icon: 'message',        iconOn: 'message.fill' },
    { k: 'More',   icon: 'square.grid.2x2',iconOn: 'square.grid.2x2.fill' },
  ];
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start',
      paddingTop: 10, paddingBottom: 22, paddingLeft: 4, paddingRight: 4,
      background: 'rgba(247,247,250,0.85)',
      backdropFilter: 'blur(28px) saturate(180%)',
      WebkitBackdropFilter: 'blur(28px) saturate(180%)',
      borderTop: '0.5px solid ' + gdTokens.border,
    }}>
      {items.map(it => {
        const on = it.k === active;
        const color = on ? gdTokens.blue : gdTokens.text3;
        return (
          <div key={it.k} style={{ flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', gap: 4, position: 'relative' }}>
            <div style={{ position: 'relative' }}>
              <GDSymbol name={on ? it.iconOn : it.icon} size={26} color={color} />
              {it.badge && (
                <div style={{ position: 'absolute', top: -3, right: -8,
                  minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
                  background: gdTokens.red, color: 'white',
                  fontFamily: gdTokens.sf, fontSize: 12, fontWeight: 600,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  border: '1.5px solid #F7F7FA' }}>
                  {it.badge}
                </div>
              )}
            </div>
            <div style={{ fontFamily: gdTokens.sf, fontSize: 10, fontWeight: 500,
              color, letterSpacing: 0.05 }}>{it.k}</div>
          </div>
        );
      })}
    </div>
  );
};

// ---- Card (Apple Health–style) ----
const GDCard = ({ children, style }) => (
  <div style={{
    background: gdTokens.card, borderRadius: 16,
    padding: 16, marginBottom: 12,
    boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03)',
    ...style,
  }}>{children}</div>
);

const GDSectionHeader = ({ title, action }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
    padding: '0 4px', marginBottom: 8 }}>
    <div style={{ fontFamily: gdTokens.sf, fontSize: 22, fontWeight: 700,
      letterSpacing: 0.35, color: gdTokens.text }}>{title}</div>
    {action && (
      <div style={{ fontFamily: gdTokens.sf, fontSize: 15, color: gdTokens.blue, fontWeight: 400 }}>
        {action}
      </div>
    )}
  </div>
);

// ---- Large title page header (matches iOS large title style) ----
const GDLargeTitle = ({ title, subtitle, trailing }) => (
  <div style={{ padding: '8px 20px 16px' }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
      <div>
        <div style={{ fontFamily: gdTokens.sf, fontSize: 34, fontWeight: 700,
          letterSpacing: 0.4, lineHeight: '41px', color: gdTokens.text }}>{title}</div>
        {subtitle && (
          <div style={{ fontFamily: gdTokens.sf, fontSize: 15, color: gdTokens.text3,
            marginTop: 2 }}>{subtitle}</div>
        )}
      </div>
      {trailing}
    </div>
  </div>
);

// ---- Status pill ----
const GDPill = ({ children, kind = 'green' }) => {
  const map = {
    green:  { bg: gdTokens.greenBg,  fg: '#1B7B3A' },
    red:    { bg: gdTokens.redBg,    fg: '#C42821' },
    orange: { bg: gdTokens.orangeBg, fg: '#9A5A00' },
    blue:   { bg: gdTokens.blueBg,   fg: '#0A6FCF' },
  };
  const { bg, fg } = map[kind] || map.green;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
      background: bg, color: fg, borderRadius: 10, padding: '3px 8px',
      fontFamily: gdTokens.sf, fontSize: 13, fontWeight: 600 }}>
      {children}
    </div>
  );
};

Object.assign(window, { gdTokens, GDSymbol, GDTabBar, GDCard, GDSectionHeader, GDLargeTitle, GDPill });
