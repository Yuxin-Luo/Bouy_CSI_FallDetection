// Buoy v2 — warm white & green, Google-suite structure + Beli editorial flavor.
// Tokens, primitives, and 5 screens. Naming: bv2* to avoid global collisions.

const bv2 = {
  // Warm cream backdrop (Beli)
  bg:        '#EFEAE0',
  surface:   '#FBF8F2',         // warm white card
  surfacePure:'#FFFFFF',
  surfaceAlt:'#F1F4EE',         // soft sage
  border:    'rgba(31,31,31,0.10)',
  divider:   'rgba(31,31,31,0.08)',
  // Type
  text:      '#1F1F1F',
  text2:     '#3C4043',
  text3:     '#6B6B6B',
  text4:     '#A0A0A0',
  // Greens (Material 3 sage + Google green)
  green:     '#1F5F3F',         // deeper, more editorial than Google green
  greenDeep: '#0E3D26',
  greenSoft: '#3F8C5C',
  greenTint: '#E6F0E8',
  greenTint2:'#D2E4D8',
  // Functional
  red:       '#C0392B',
  redTint:   '#F7E1DD',
  amber:     '#C4711A',
  amberTint: '#F3E2C8',
  blue:      '#2A5BA8',
  blueTint:  '#E1E9F5',
  // Room band accents (warm, Beli-like)
  bedroom:   '#A47148',
  kitchen:   '#D4A35A',
  living:    '#1F5F3F',
  bath:      '#7AA6B9',
  // Type stacks
  serif:     '"DM Serif Display", Georgia, "Times New Roman", serif',
  sans:      '"Plus Jakarta Sans", ui-sans-serif, -apple-system, system-ui, sans-serif',
  mono:      '"JetBrains Mono", ui-monospace, monospace',
};

// ---------- Icons ----------
const BvIcon = ({ name, size = 20, color = bv2.text, weight = 1.8 }) => {
  const s = size, sw = weight;
  const wrap = (kids) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">{kids}</svg>
  );
  const filled = (kids) => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill={color}>{kids}</svg>
  );
  switch (name) {
    case 'home': return wrap(<><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h5v-6h4v6h5V10"/></>);
    case 'home.fill': return filled(<path d="M12 3 2 12h3v8h5v-6h4v6h5v-8h3z"/>);
    case 'map': return wrap(<><path d="M3 6v15l6-2 6 2 6-2V4l-6 2-6-2-6 2z"/><path d="M9 4v15M15 6v15"/></>);
    case 'map.fill': return filled(<path d="M3 5v15l6-2 6 2 6-2V3l-6 2-6-2zM9 4.5v14M15 7v14"/>);
    case 'bell': return wrap(<><path d="M6 9a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9z"/><path d="M10 21a2 2 0 0 0 4 0"/></>);
    case 'bell.fill': return filled(<path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-5v-1l-1.5-1.5V11a5.5 5.5 0 0 0-4.5-5.4V5a1 1 0 0 0-2 0v.6A5.5 5.5 0 0 0 6.5 11v3.5L5 16v1z"/>);
    case 'people': return wrap(<><circle cx="9" cy="9" r="3.2"/><circle cx="17" cy="10" r="2.5"/><path d="M3 19c.5-3 3-4.5 6-4.5s5.5 1.5 6 4.5"/><path d="M15 19c.5-2 2-3 3.5-3s2.5.5 3 2"/></>);
    case 'people.fill': return filled(<><circle cx="9" cy="9" r="3.5"/><circle cx="17" cy="10" r="2.8"/><path d="M2.5 19c.5-3 3-5 6.5-5s6 2 6.5 5zM14.5 19c.4-2 1.7-3.5 3.5-3.5s3.1 1.5 3.5 3.5z"/></>);
    case 'menu': return wrap(<><circle cx="5" cy="5" r="1.5"/><circle cx="12" cy="5" r="1.5"/><circle cx="19" cy="5" r="1.5"/><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="5" cy="19" r="1.5"/><circle cx="12" cy="19" r="1.5"/><circle cx="19" cy="19" r="1.5"/></>);
    case 'menu.fill': return filled(<><circle cx="5" cy="5" r="1.8"/><circle cx="12" cy="5" r="1.8"/><circle cx="19" cy="5" r="1.8"/><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/><circle cx="5" cy="19" r="1.8"/><circle cx="12" cy="19" r="1.8"/><circle cx="19" cy="19" r="1.8"/></>);
    case 'search': return wrap(<><circle cx="11" cy="11" r="7"/><path d="m21 21-4.5-4.5"/></>);
    case 'phone': return filled(<path d="M6.6 10.8a15 15 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11 11 0 0 0 3.5.55 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1 11 11 0 0 0 .55 3.5 1 1 0 0 1-.25 1z"/>);
    case 'walk': return filled(<><circle cx="14" cy="4" r="2"/><path d="M11 8l-3 4 1 5-2 5h2l2-4 1.5 1.5V22h2v-4l-2-3 1-3 2 2.5h2l-2-4-3-2.5z"/></>);
    case 'check': return wrap(<path d="M4 12l5 5L20 6"/>);
    case 'warning': return filled(<><path d="M12 2 1 21h22z"/><rect x="11" y="9" width="2" height="6" fill="white"/><circle cx="12" cy="18" r="1.2" fill="white"/></>);
    case 'sensor': return wrap(<><circle cx="6" cy="12" r="2.2" fill={color} stroke="none"/><path d="M10 8a6 6 0 0 1 0 8M14 5a10 10 0 0 1 0 14M18 2a14 14 0 0 1 0 20"/></>);
    case 'chev.right': return wrap(<path d="M9 6l6 6-6 6"/>);
    case 'plus': return wrap(<><path d="M12 5v14M5 12h14"/></>);
    case 'tune': return wrap(<><path d="M4 6h10M4 12h6M4 18h12"/><circle cx="17" cy="6" r="2"/><circle cx="13" cy="12" r="2"/><circle cx="19" cy="18" r="2"/></>);
    case 'star': return filled(<path d="m12 2 3 6.6 7.2.7-5.4 4.8 1.6 7L12 17.6 5.6 21.1l1.6-7L1.8 9.3l7.2-.7z"/>);
    case 'mic': return wrap(<><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></>);
    case 'lock': return filled(<><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" fill="none" stroke={color} strokeWidth="1.8"/></>);
    case 'help': return wrap(<><circle cx="12" cy="12" r="9"/><path d="M9 9.5a3 3 0 1 1 4 2.8c-1 .4-1.5 1-1.5 2"/><circle cx="11.5" cy="17" r=".8" fill={color}/></>);
    case 'leaf': return filled(<path d="M5 19c0-9 5-14 14-14 0 9-5 14-14 14zm0 0c2-4 5-7 9-9"/>);
    default: return null;
  }
};

// ---------- Components ----------
const BvCard = ({ children, style, tone = 'white' }) => {
  const bg = tone === 'sage' ? bv2.surfaceAlt
    : tone === 'green' ? bv2.greenTint
    : tone === 'pure' ? bv2.surfacePure
    : tone === 'cream' ? '#F6EFDF'
    : bv2.surface;
  return (
    <div style={{
      background: bg, borderRadius: 22, padding: 18, marginBottom: 12,
      border:'1px solid '+bv2.border,
      ...style,
    }}>{children}</div>
  );
};

const BvChip = ({ children, active = false, leading }) => (
  <div style={{
    display:'inline-flex', alignItems:'center', gap:6,
    height: 34, padding: '0 14px',
    borderRadius: 17, fontSize: 12.5, fontWeight: 600,
    fontFamily: bv2.sans, letterSpacing: 0.1,
    background: active ? bv2.text : 'transparent',
    color: active ? bv2.bg : bv2.text2,
    border: active ? '1px solid '+bv2.text : '1px solid '+bv2.border,
    flexShrink: 0,
  }}>{leading}{children}</div>
);

const BvPill = ({ children, kind = 'green' }) => {
  const m = {
    green:  { bg: bv2.greenTint, fg: bv2.greenDeep },
    red:    { bg: bv2.redTint,   fg: '#7A1A12' },
    amber:  { bg: bv2.amberTint, fg: '#6F3B0E' },
    blue:   { bg: bv2.blueTint,  fg: '#1A3A75' },
    neutral:{ bg: bv2.surfaceAlt,fg: bv2.text2 },
    dark:   { bg: bv2.text,      fg: bv2.bg },
  }[kind] || { bg: bv2.greenTint, fg: bv2.greenDeep };
  return (
    <span style={{
      display:'inline-flex', alignItems:'center', gap:4,
      background: m.bg, color: m.fg,
      borderRadius: 8, padding:'3px 10px',
      fontFamily: bv2.sans, fontSize: 11, fontWeight: 700, letterSpacing: 0.4,
      textTransform:'uppercase',
    }}>{children}</span>
  );
};

const BvBtn = ({ children, kind = 'filled', leading, style }) => {
  const styles = {
    filled:  { bg: bv2.text,    fg: bv2.bg,        bd: 'none' },
    green:   { bg: bv2.green,   fg: 'white',       bd: 'none' },
    tonal:   { bg: bv2.greenTint, fg: bv2.greenDeep, bd: '1px solid '+bv2.greenTint2 },
    outline: { bg: 'transparent', fg: bv2.text,    bd: '1px solid '+bv2.text },
    ghost:   { bg: 'transparent', fg: bv2.text2,   bd: '1px solid '+bv2.border },
    danger:  { bg: bv2.red,     fg: 'white',       bd: 'none' },
  }[kind];
  return (
    <button style={{
      height: 44, padding:'0 22px', borderRadius: 22,
      background: styles.bg, color: styles.fg, border: styles.bd,
      fontFamily: bv2.sans, fontSize: 13.5, fontWeight: 700, letterSpacing: 0.2,
      display:'inline-flex', alignItems:'center', justifyContent:'center', gap: 8,
      cursor:'pointer', ...style,
    }}>{leading}{children}</button>
  );
};

// Header — Beli-style: serif title, tiny eyebrow, plain right action
const BvAppBar = ({ eyebrow, title, leading, trailing }) => (
  <div style={{ padding:'52px 20px 14px', display:'flex', alignItems:'flex-end', gap: 12 }}>
    {leading}
    <div style={{ flex:1, minWidth:0 }}>
      {eyebrow && (<div style={{ fontFamily: bv2.sans, fontSize: 11, fontWeight: 700,
        color: bv2.text3, letterSpacing: 1.4, textTransform:'uppercase', marginBottom: 4 }}>{eyebrow}</div>)}
      <div style={{ fontFamily: bv2.serif, fontSize: 34, fontWeight: 400,
        lineHeight: 1, color: bv2.text, letterSpacing: -0.6 }}>{title}</div>
    </div>
    {trailing}
  </div>
);

// Search bar — Google but warm
const BvSearchBar = ({ placeholder = 'Search', avatar = 'S' }) => (
  <div style={{ margin:'0 16px 12px', height: 48, borderRadius: 24,
    background: bv2.surface, display:'flex', alignItems:'center', padding:'0 6px 0 16px',
    border:'1px solid '+bv2.border }}>
    <BvIcon name="search" size={18} color={bv2.text3}/>
    <div style={{ flex:1, fontFamily: bv2.sans, fontSize: 14, color: bv2.text3, paddingLeft: 12, fontWeight:500 }}>{placeholder}</div>
    <BvIcon name="mic" size={18} color={bv2.text3}/>
    <div style={{ width: 36, height: 36, borderRadius: 18, marginLeft: 10,
      background: bv2.green, display:'flex', alignItems:'center', justifyContent:'center',
      color:'white', fontFamily: bv2.sans, fontSize: 13, fontWeight: 700 }}>{avatar}</div>
  </div>
);

// Bottom nav
const BvNav = ({ active = 'Home' }) => {
  const items = [
    { k:'Home',   icon:'home',   on:'home.fill' },
    { k:'Map',    icon:'map',    on:'map.fill' },
    { k:'Alerts', icon:'bell',   on:'bell.fill', badge:1 },
    { k:'People', icon:'people', on:'people.fill' },
    { k:'More',   icon:'menu',   on:'menu.fill' },
  ];
  return (
    <div style={{ display:'flex', height: 78, padding:'10px 4px 26px',
      background: bv2.surface, borderTop:'1px solid '+bv2.divider }}>
      {items.map(it => {
        const a = it.k === active;
        return (
          <div key={it.k} style={{ flex:1, display:'flex', flexDirection:'column',
            alignItems:'center', gap: 4 }}>
            <div style={{ position:'relative', width: 64, height: 32, borderRadius: 16,
              background: a ? bv2.greenTint2 : 'transparent',
              display:'flex', alignItems:'center', justifyContent:'center' }}>
              <BvIcon name={a ? it.on : it.icon} size={22}
                color={a ? bv2.greenDeep : bv2.text3}/>
              {it.badge && (
                <div style={{ position:'absolute', top: 2, right: 12,
                  minWidth: 16, height: 16, padding:'0 4px', borderRadius: 8,
                  background: bv2.red, color:'white', fontFamily: bv2.sans,
                  fontSize: 10, fontWeight: 700,
                  display:'flex', alignItems:'center', justifyContent:'center',
                  border:'2px solid '+bv2.surface }}>{it.badge}</div>
              )}
            </div>
            <div style={{ fontFamily: bv2.sans, fontSize: 10.5,
              fontWeight: a ? 700 : 600,
              letterSpacing: 0.4, textTransform:'uppercase',
              color: a ? bv2.greenDeep : bv2.text3 }}>{it.k}</div>
          </div>
        );
      })}
    </div>
  );
};

// Section header
const BvSection = ({ title, action, style }) => (
  <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between',
    padding:'14px 6px 10px', ...style }}>
    <div style={{ fontFamily: bv2.serif, fontSize: 22, fontWeight: 400,
      color: bv2.text, letterSpacing: -0.3 }}>{title}</div>
    {action && (<div style={{ fontFamily: bv2.sans, fontSize: 12, fontWeight: 700,
      color: bv2.text2, letterSpacing: 0.6, textTransform:'uppercase' }}>{action}</div>)}
  </div>
);

// Beli-style ranked badge
const BvRankBadge = ({ n, color = bv2.text }) => (
  <div style={{ width: 32, height: 32, borderRadius: 16,
    background: color, color: bv2.bg,
    fontFamily: bv2.serif, fontSize: 16, fontWeight: 400,
    display:'flex', alignItems:'center', justifyContent:'center',
    flexShrink: 0 }}>{n}</div>
);

// Big numerical score (Beli)
const BvScore = ({ value, label, sub, color = bv2.green }) => (
  <div style={{ display:'flex', alignItems:'baseline', gap: 10 }}>
    <div style={{ fontFamily: bv2.serif, fontSize: 56, fontWeight: 400,
      lineHeight: 0.9, color, letterSpacing: -1.4 }}>{value}</div>
    <div>
      <div style={{ fontFamily: bv2.sans, fontSize: 11, fontWeight: 700,
        color: bv2.text3, letterSpacing: 1.4, textTransform:'uppercase' }}>{label}</div>
      <div style={{ fontFamily: bv2.sans, fontSize: 13, color: bv2.text2, marginTop: 2 }}>{sub}</div>
    </div>
  </div>
);

// ---------- Floor plans ----------
const BvFloorPlanMini = ({ active='living' }) => {
  const tint = (k) => active === k ? bv2.greenTint2 : 'transparent';
  const stk  = (k) => active === k ? bv2.greenSoft : 'rgba(31,31,31,0.18)';
  return (
    <svg viewBox="0 0 220 150" width="100%" style={{ display:'block' }}>
      <rect x="4" y="4" width="212" height="142" fill="#F8F2E5"
        stroke="rgba(31,31,31,0.18)" strokeWidth="1.2" rx="6"/>
      <rect x="4" y="4" width="86" height="64" fill={tint('kitchen')} stroke={stk('kitchen')} strokeWidth="1" rx="4"/>
      <rect x="90" y="4" width="126" height="86" fill={tint('living')} stroke={stk('living')} strokeWidth="1.4" rx="4"/>
      <rect x="4" y="68" width="86" height="78" fill={tint('bed')} stroke={stk('bed')} strokeWidth="1" rx="4"/>
      <rect x="90" y="90" width="60" height="56" fill={tint('bath')} stroke={stk('bath')} strokeWidth="1" rx="4"/>
      <rect x="150" y="90" width="66" height="56" fill={tint('hall')} stroke={stk('hall')} strokeWidth="1" rx="4"/>
      <g fontFamily={bv2.sans} fontSize="8" fill={bv2.text3} fontWeight="600" letterSpacing="0.4">
        <text x="10" y="16">KITCHEN</text><text x="96" y="16">LIVING ROOM</text>
        <text x="10" y="80">BEDROOM</text><text x="96" y="102">BATH</text><text x="156" y="102">HALL</text>
      </g>
      {[{x:35,y:38,tx:false},{x:150,y:50,tx:true},{x:35,y:110,tx:false},{x:180,y:124,tx:false}].map((s,i)=>(
        <circle key={i} cx={s.x} cy={s.y} r={s.tx?4:3.2} fill={s.tx?bv2.greenSoft:bv2.green} stroke="white" strokeWidth="1.2"/>
      ))}
      {active === 'living' && (
        <g>
          <circle cx="135" cy="48" r="11" fill={bv2.greenSoft} opacity="0.22"/>
          <circle cx="135" cy="48" r="6" fill={bv2.green} stroke="white" strokeWidth="1.6"/>
        </g>
      )}
    </svg>
  );
};

const BvFloorPlanLarge = () => (
  <svg viewBox="0 0 360 380" width="100%" style={{ display:'block' }}>
    <defs>
      <radialGradient id="bv2-presence" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor={bv2.greenSoft} stopOpacity="0.32"/>
        <stop offset="100%" stopColor={bv2.greenSoft} stopOpacity="0"/>
      </radialGradient>
      <pattern id="bv2-grid" x="0" y="0" width="14" height="14" patternUnits="userSpaceOnUse">
        <circle cx="1" cy="1" r="0.8" fill="rgba(31,31,31,0.08)"/>
      </pattern>
    </defs>
    <rect x="0" y="0" width="360" height="380" fill="url(#bv2-grid)"/>
    <rect x="14" y="14" width="332" height="352" rx="10" fill="#F8F2E5"
      stroke="rgba(31,31,31,0.30)" strokeWidth="1.4"/>
    {[
      {x:14,y:14,w:130,h:150,l:'KITCHEN',     f:'rgba(212,163,90,0.10)'},
      {x:144,y:14,w:202,h:200,l:'LIVING ROOM',f:'rgba(31,95,63,0.12)'},
      {x:14,y:164,w:130,h:202,l:'BEDROOM',    f:'rgba(164,113,72,0.10)'},
      {x:144,y:214,w:90,h:152,l:'BATH',       f:'rgba(122,166,185,0.10)'},
      {x:234,y:214,w:112,h:152,l:'HALL',      f:'rgba(31,31,31,0.04)'},
    ].map(r => (
      <g key={r.l}>
        <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={r.f}
          stroke="rgba(31,31,31,0.30)" strokeWidth="0.8" rx="6"/>
        <text x={r.x+10} y={r.y+18} fontFamily={bv2.sans} fontSize="9.5"
          fill={bv2.text3} fontWeight="700" letterSpacing="1.2">{r.l}</text>
      </g>
    ))}
    <circle cx="220" cy="100" r="84" fill="url(#bv2-presence)"/>
    {[
      {x:78,y:90,k:'rx',l:'1'},{x:245,y:60,k:'rx',l:'2'},
      {x:200,y:110,k:'tx',l:'TX'},
      {x:78,y:280,k:'rx',l:'3'},{x:290,y:290,k:'rx',l:'4'},
    ].map((s,i)=>(
      <g key={i}>
        {s.k==='rx' && <circle cx={s.x} cy={s.y} r="55" fill="none" stroke={bv2.greenSoft} strokeOpacity="0.25" strokeWidth="1" strokeDasharray="2 4"/>}
        {s.k==='tx' && <>
          <circle cx={s.x} cy={s.y} r="22" fill="none" stroke={bv2.green} strokeWidth="1" opacity="0.5"/>
          <circle cx={s.x} cy={s.y} r="32" fill="none" stroke={bv2.green} strokeWidth="0.8" opacity="0.3"/>
          <circle cx={s.x} cy={s.y} r="44" fill="none" stroke={bv2.green} strokeWidth="0.6" opacity="0.18"/>
        </>}
        <circle cx={s.x} cy={s.y} r="11" fill="white" stroke="rgba(0,0,0,0.06)"/>
        <circle cx={s.x} cy={s.y} r="9" fill={s.k==='tx'?bv2.green:bv2.greenSoft}/>
        <text x={s.x} y={s.y+3} textAnchor="middle" fontFamily={bv2.sans} fontSize={s.k==='tx'?8:9} fill="white" fontWeight="700">{s.l}</text>
      </g>
    ))}
    <g transform="translate(214,90)">
      <circle r="14" fill="white" stroke={bv2.green} strokeWidth="2"/>
      <circle cy="-4" r="3" fill={bv2.green}/>
      <path d="M -4,2 L 4,2 L 3,7 L -3,7 Z" fill={bv2.green}/>
    </g>
  </svg>
);

const BvDayStrip = ({ height=14 }) => {
  const bands = [
    { c: bv2.bedroom,   w: 28 },
    { c: bv2.kitchen,   w: 5 },
    { c: '#E5DFD0',     w: 8 },
    { c: bv2.living,    w: 14 },
    { c: bv2.kitchen,   w: 4 },
    { c: bv2.living,    w: 18 },
    { c: '#E5DFD0',     w: 4 },
    { c: bv2.bedroom,   w: 19 },
  ];
  return (
    <div style={{ display:'flex', height, borderRadius: height/2, overflow:'hidden' }}>
      {bands.map((b,i)=>(<div key={i} style={{ width:`${b.w}%`, background:b.c, opacity:0.95 }}/>))}
    </div>
  );
};

const BvVariance = ({ color=bv2.amber, spike=true, height=26 }) => {
  const N = 60, pts = [];
  for (let i=0;i<N;i++){
    const x = (i/(N-1))*100;
    let y = 50 + Math.sin(i*0.55)*5 + Math.sin(i*1.3)*3 + (Math.random()-0.5)*4;
    if (spike && i>N*0.5 && i<N*0.75) {
      const k=(i-N*0.5)/(N*0.25);
      y = 50 - Math.sin(k*Math.PI)*38 + (Math.random()-0.5)*4;
    }
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height={height} style={{display:'block'}}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.4"
        strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
    </svg>
  );
};

// ---------- Screens ----------
const BvHome = () => (
  <div style={{ background: bv2.bg, fontFamily: bv2.sans, height:'100%',
    overflow:'auto', display:'flex', flexDirection:'column' }}>
    <BvAppBar eyebrow="MOM'S PLACE · ALL QUIET" title="Buoy"
      trailing={<div style={{ width:38, height:38, borderRadius:19, background: bv2.green,
        display:'flex', alignItems:'center', justifyContent:'center',
        color:'white', fontFamily: bv2.sans, fontSize: 13, fontWeight: 700 }}>S</div>}/>
    <BvSearchBar placeholder="Search activity, alerts, sensors" avatar="S"/>
    <div style={{ padding:'0 16px 16px', flex:1 }}>
      {/* Hero */}
      <BvCard tone="cream" style={{ padding: 22 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
          <span style={{ width:8, height:8, borderRadius:4, background:bv2.greenSoft,
            boxShadow:`0 0 0 4px ${bv2.greenTint}` }}/>
          <span style={{ fontSize:11, fontWeight:700, color:bv2.greenDeep, letterSpacing:1.4, textTransform:'uppercase' }}>
            Live · 12 sec ago
          </span>
        </div>
        <div style={{ fontFamily: bv2.serif, fontSize: 38, fontWeight: 400,
          lineHeight: 1.05, color: bv2.text, letterSpacing:-0.8 }}>
          Mom is in the<br/>
          <em style={{ color: bv2.green, fontStyle:'italic' }}>living room.</em>
        </div>
        <div style={{ fontSize: 13, color: bv2.text3, marginTop: 10, fontWeight: 500 }}>
          Last motion 14 min ago · arrived 3:01 pm
        </div>
        <div style={{ marginTop: 16, padding: 10, background: bv2.surfacePure, borderRadius: 14,
          border:'1px solid '+bv2.border }}>
          <BvFloorPlanMini active="living"/>
        </div>
        <div style={{ display:'flex', gap: 8, marginTop: 16 }}>
          <BvBtn kind="green" leading={<BvIcon name="phone" size={15} color="white"/>} style={{ flex:1, height:46 }}>Call mom</BvBtn>
          <BvBtn kind="outline" leading={<BvIcon name="map" size={15} color={bv2.text}/>} style={{ flex:1, height:46 }}>Open map</BvBtn>
        </div>
      </BvCard>

      {/* Score: confidence + streak (Beli-style big numbers) */}
      <div style={{ display:'grid', gridTemplateColumns:'1.3fr 1fr', gap: 10, marginBottom: 12 }}>
        <BvCard style={{ marginBottom: 0, padding: 18 }}>
          <BvScore value="94" label="Detection" sub="Confidence" color={bv2.green}/>
        </BvCard>
        <BvCard tone="green" style={{ marginBottom: 0, padding: 18, display:'flex', flexDirection:'column', justifyContent:'center' }}>
          <div style={{ fontFamily: bv2.serif, fontSize: 44, fontWeight: 400, color: bv2.greenDeep, lineHeight: 0.9, letterSpacing:-1.2 }}>7</div>
          <div style={{ fontFamily: bv2.sans, fontSize: 11, fontWeight: 700, color: bv2.greenDeep, letterSpacing: 1.2, textTransform:'uppercase', marginTop: 6 }}>Day streak</div>
          <div style={{ fontSize: 12, color: bv2.greenDeep, opacity: 0.75, marginTop: 2 }}>No false alarms</div>
        </BvCard>
      </div>

      <BvSection title="Today" action="See all"/>
      <BvCard>
        <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginBottom: 12 }}>
          <div style={{ fontFamily: bv2.sans, fontSize:13, fontWeight:700, letterSpacing:1.2, textTransform:'uppercase', color: bv2.text3 }}>Room presence</div>
          <div style={{ fontFamily: bv2.mono, fontSize:11, color: bv2.text3 }}>TUE · MAR 4</div>
        </div>
        <BvDayStrip/>
        <div style={{ display:'flex', justifyContent:'space-between', marginTop:8,
          fontSize:11, color: bv2.text3, fontFamily: bv2.mono }}>
          <span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span>
        </div>
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginTop:14 }}>
          {[
            {c:bv2.bedroom, l:'Bedroom', h:'7h'},
            {c:bv2.kitchen, l:'Kitchen', h:'1h'},
            {c:bv2.living,  l:'Living',  h:'4h'},
            {c:'#E5DFD0',   l:'Other',   h:'12h'},
          ].map(t=>(
            <span key={t.l} style={{ display:'inline-flex', alignItems:'center', gap:6,
              padding:'5px 11px', background: bv2.surfaceAlt, borderRadius: 12,
              fontSize:12, fontWeight:600, color: bv2.text2 }}>
              <span style={{ width:8, height:8, borderRadius:4, background:t.c }}/>{t.l} <span style={{color:bv2.text3,fontWeight:500}}>{t.h}</span>
            </span>
          ))}
        </div>
      </BvCard>

      {/* Beli-style ranked rooms */}
      <BvSection title="Most-used rooms" action="This week"/>
      <BvCard style={{ padding: 0 }}>
        {[
          { n:1, r:'Bedroom',     h:'52 hrs', sub:'7.4 h/day average', dot: bv2.bedroom },
          { n:2, r:'Living room', h:'27 hrs', sub:'3.9 h/day average', dot: bv2.living },
          { n:3, r:'Kitchen',     h:'9 hrs',  sub:'1.3 h/day average', dot: bv2.kitchen },
        ].map((r,i)=>(
          <div key={r.n} style={{ display:'flex', alignItems:'center', gap:14,
            padding:'14px 18px', borderTop: i===0 ? 'none' : '1px solid '+bv2.divider }}>
            <BvRankBadge n={r.n} color={i===0?bv2.green:bv2.text}/>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:15, fontWeight:600, color: bv2.text }}>{r.r}</div>
              <div style={{ fontSize:12, color: bv2.text3, marginTop:1 }}>{r.sub}</div>
            </div>
            <div style={{ textAlign:'right' }}>
              <div style={{ fontFamily: bv2.serif, fontSize:20, color: bv2.text, lineHeight:1 }}>{r.h}</div>
            </div>
            <span style={{ width:6, height:36, borderRadius:3, background:r.dot, opacity:0.7 }}/>
          </div>
        ))}
      </BvCard>

      <BvSection title="Activity"/>
      <BvCard style={{ padding: 0 }}>
        {[
          {t:'3:01 pm', a:'Arrived in living room',     m:'14 min still', i:'walk', c:bv2.green},
          {t:'1:48 pm', a:'Left the kitchen',           m:'2 min motion',  i:'walk', c:bv2.kitchen},
          {t:'1:22 pm', a:'Stove RX picked up cooking', m:'High motion',   i:'sensor', c:bv2.amber},
          {t:'7:12 am', a:'Out of bed',                 m:'Bedroom → hall',i:'walk', c:bv2.bedroom},
        ].map((e,i)=>(
          <div key={i} style={{ display:'flex', alignItems:'flex-start', gap:14,
            padding:'14px 18px', borderTop: i===0 ? 'none' : '1px solid '+bv2.divider }}>
            <div style={{ width:36, height:36, borderRadius:18,
              background: bv2.surfaceAlt,
              display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
              <BvIcon name={e.i} size={18} color={e.c}/>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:14, fontWeight:600, color: bv2.text }}>{e.a}</div>
              <div style={{ fontSize:12, color: bv2.text3, marginTop:1 }}>{e.m}</div>
            </div>
            <div style={{ fontFamily: bv2.mono, fontSize: 11, color: bv2.text3 }}>{e.t}</div>
          </div>
        ))}
      </BvCard>
    </div>
    <BvNav active="Home"/>
  </div>
);

const BvMap = () => (
  <div style={{ background: bv2.bg, fontFamily: bv2.sans, height:'100%',
    overflow:'auto', display:'flex', flexDirection:'column' }}>
    <BvAppBar eyebrow="MOM · LIVING ROOM · 14 MIN STILL" title="Map"
      trailing={<div style={{ display:'flex', gap:8 }}>
        <div style={{ width:38, height:38, borderRadius:19, background:bv2.surface,
          display:'flex', alignItems:'center', justifyContent:'center',
          border:'1px solid '+bv2.border }}>
          <BvIcon name="search" size={17} color={bv2.text2}/>
        </div>
        <div style={{ width:38, height:38, borderRadius:19, background:bv2.surface,
          display:'flex', alignItems:'center', justifyContent:'center',
          border:'1px solid '+bv2.border }}>
          <BvIcon name="tune" size={17} color={bv2.text2}/>
        </div>
      </div>}/>
    <div style={{ padding:'0 16px 8px', display:'flex', gap:8, overflow:'auto' }}>
      {[
        {l:'Presence',on:true},{l:'Coverage',on:true},{l:'Heatmap',on:false},
        {l:'Sensor IDs',on:true},{l:'Trails',on:false},
      ].map(c=>(<BvChip key={c.l} active={c.on}>{c.l}</BvChip>))}
    </div>

    <div style={{ padding:'8px 16px 16px' }}>
      <BvCard style={{ padding: 12 }}><BvFloorPlanLarge/></BvCard>

      <div style={{ display:'grid', gridTemplateColumns:'1.2fr 1fr', gap:10, marginBottom: 12 }}>
        <BvCard style={{ marginBottom:0, padding:18 }}>
          <BvScore value="94%" label="Presence" sub="Living room" color={bv2.green}/>
        </BvCard>
        <BvCard tone="green" style={{ marginBottom:0, padding:18, display:'flex', flexDirection:'column', justifyContent:'center' }}>
          <div style={{ fontFamily: bv2.serif, fontSize: 36, color: bv2.greenDeep, lineHeight: 0.9, letterSpacing:-0.8 }}>4/4</div>
          <div style={{ fontFamily: bv2.sans, fontSize: 10.5, fontWeight: 700, color: bv2.greenDeep, letterSpacing: 1.2, textTransform:'uppercase', marginTop: 6 }}>Sensors healthy</div>
        </BvCard>
      </div>

      <BvSection title="Rooms" action="Reorder"/>
      <BvCard style={{ padding: 0 }}>
        {[
          {n:1, k:'Living room', sub:'Active · 14 min', tag:'Now',     on:true},
          {n:2, k:'Kitchen',     sub:'Last seen 1:48 pm', tag:'1h ago'},
          {n:3, k:'Bath',        sub:'Last seen 1:50 pm', tag:'1h ago'},
          {n:4, k:'Bedroom',     sub:'Last seen 7:12 am', tag:'8h ago'},
        ].map((r,i)=>(
          <div key={r.k} style={{ display:'flex', alignItems:'center', gap:14,
            padding:'14px 18px', borderTop: i===0 ? 'none' : '1px solid '+bv2.divider }}>
            <BvRankBadge n={r.n} color={r.on?bv2.green:bv2.text}/>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:15, fontWeight:600 }}>{r.k}</div>
              <div style={{ fontSize:12, color:bv2.text3, marginTop:1 }}>{r.sub}</div>
            </div>
            <div style={{ fontFamily: bv2.mono, fontSize:11,
              color: r.on ? bv2.green : bv2.text3, fontWeight:600 }}>{r.tag}</div>
          </div>
        ))}
      </BvCard>

      <BvSection title="Sensors"/>
      <BvCard style={{ padding: 0 }}>
        {[
          { n:'TX broadcaster', l:'Center wall', tx:true,  s:'92 pkt/s' },
          { n:'RX 1 · Kitchen', l:'Above microwave',     tx:false, s:'94/s · −52 dBm' },
          { n:'RX 2 · Living',  l:'Bookshelf',           tx:false, s:'91/s · −49 dBm' },
          { n:'RX 3 · Bedroom', l:'Door frame',          tx:false, s:'89/s · −57 dBm' },
        ].map((r,i)=>(
          <div key={r.n} style={{ display:'flex', alignItems:'center', gap:14,
            padding:'12px 18px', borderTop: i===0 ? 'none' : '1px solid '+bv2.divider }}>
            <div style={{ width: 36, height: 36, borderRadius: 18,
              background: r.tx ? bv2.greenTint : bv2.surfaceAlt,
              display:'flex', alignItems:'center', justifyContent:'center' }}>
              <BvIcon name="sensor" size={18} color={r.tx ? bv2.greenDeep : bv2.text2}/>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ fontSize:14, fontWeight:600, color: bv2.text }}>{r.n}</div>
              <div style={{ fontSize:12, color: bv2.text3 }}>{r.l}</div>
            </div>
            <div style={{ fontSize:11, color: bv2.text3, fontFamily: bv2.mono }}>{r.s}</div>
          </div>
        ))}
      </BvCard>
    </div>
    <BvNav active="Map"/>
  </div>
);

const BvAlerts = () => (
  <div style={{ background: bv2.bg, fontFamily: bv2.sans, height:'100%',
    overflow:'auto', display:'flex', flexDirection:'column' }}>
    <BvAppBar eyebrow="1 ACTIVE · 14 IN LAST 30 DAYS" title="Alerts"
      trailing={<div style={{ width:38, height:38, borderRadius:19, background:bv2.surface,
        display:'flex', alignItems:'center', justifyContent:'center',
        border:'1px solid '+bv2.border }}>
        <BvIcon name="tune" size={17} color={bv2.text2}/>
      </div>}/>

    <div style={{ padding:'0 16px 16px', flex:1 }}>
      <div style={{ marginBottom: 8, paddingLeft: 6, display:'flex', alignItems:'center', gap:6 }}>
        <span style={{ width:8, height:8, borderRadius:4, background: bv2.red,
          animation:'bv2-pulse 1.4s ease-in-out infinite' }}/>
        <span style={{ fontSize:11, color: bv2.red, fontWeight:700, letterSpacing:1.4 }}>ACTIVE NOW</span>
      </div>

      <BvCard style={{ padding:0, overflow:'hidden',
        border:'1px solid rgba(192,57,43,0.30)',
        boxShadow:'0 8px 24px rgba(192,57,43,0.10)' }}>
        <div style={{ padding:'18px 20px 16px', background: bv2.redTint }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <BvIcon name="warning" size={18} color={bv2.red}/>
            <span style={{ fontSize:11, color: bv2.red, fontWeight:700, letterSpacing:1.4 }}>
              FALL DETECTED · 0:23 LEFT
            </span>
          </div>
          <div style={{ fontFamily: bv2.serif, fontSize: 28, fontWeight: 400,
            marginTop: 10, lineHeight: 1.1, letterSpacing: -0.5 }}>
            Mom may have fallen<br/>
            in the <em style={{ color: bv2.red, fontStyle:'italic' }}>living room.</em>
          </div>
          <div style={{ display:'flex', alignItems:'baseline', gap:14, marginTop: 14 }}>
            <div>
              <div style={{ fontFamily: bv2.serif, fontSize: 36, color: bv2.red, lineHeight:0.9, letterSpacing:-0.8 }}>93</div>
              <div style={{ fontSize: 10, color: bv2.text3, fontWeight:700, letterSpacing:1.2, textTransform:'uppercase', marginTop: 2 }}>Confidence</div>
            </div>
            <div style={{ fontSize:13, color: bv2.text2 }}>RX 2 detected the fall · 2 sec ago</div>
          </div>
        </div>
        <div style={{ padding: 14, display:'flex', flexDirection:'column', gap: 10 }}>
          <div style={{ display:'flex', gap:10 }}>
            <BvBtn kind="green" style={{ flex:1 }}
              leading={<BvIcon name="phone" size={15} color="white"/>}>Call mom</BvBtn>
            <BvBtn kind="danger" style={{ flex:1 }}
              leading={<BvIcon name="phone" size={15} color="white"/>}>Call 911</BvBtn>
          </div>
          <div style={{ display:'flex', gap:10 }}>
            <BvBtn kind="ghost" style={{ flex:1, height:38 }}>Open map</BvBtn>
            <BvBtn kind="ghost" style={{ flex:1, height:38 }}>Mark false alarm</BvBtn>
          </div>
        </div>
      </BvCard>

      <BvSection title="History" action="Filter"/>
      <BvCard style={{ padding:0 }}>
        {[
          {d:'Tue · Mar 4', t:'3:14 pm', s:'Living room', tag:'False alarm', kind:'amber', conf:'93'},
          {d:'Mon · Mar 3', t:'8:02 am', s:'Bathroom',    tag:'Real fall',   kind:'red',   conf:'78'},
          {d:'Sun · Mar 2', t:'2:11 pm', s:'Kitchen',     tag:'False alarm', kind:'amber', conf:'64'},
          {d:'Sat · Mar 1', t:'11:55 pm',s:'Bedroom',     tag:'Pending',     kind:'blue',  conf:'88'},
        ].map((a,i)=>(
          <div key={i} style={{ padding:'14px 18px',
            borderTop: i===0 ? 'none' : '1px solid '+bv2.divider }}>
            <div style={{ display:'flex', alignItems:'center', gap: 12 }}>
              <div style={{ width: 44, textAlign:'center', flexShrink:0 }}>
                <div style={{ fontFamily: bv2.serif, fontSize: 22, lineHeight:1,
                  color: a.kind==='red'?bv2.red:a.kind==='amber'?bv2.amber:bv2.blue }}>{a.conf}</div>
                <div style={{ fontFamily: bv2.sans, fontSize: 9, color: bv2.text3,
                  fontWeight: 700, letterSpacing: 0.8, marginTop: 2 }}>CONF.</div>
              </div>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:14, fontWeight:600 }}>{a.s}</div>
                <div style={{ fontSize:12, color: bv2.text3, marginTop:2 }}>{a.d} · {a.t}</div>
              </div>
              <BvPill kind={a.kind}>{a.tag}</BvPill>
            </div>
            <div style={{ marginTop:10, paddingTop: 8, borderTop:'1px dashed '+bv2.divider }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:4 }}>
                <span style={{ fontSize:9.5, color: bv2.text3, fontWeight:700,
                  letterSpacing:1.2, textTransform:'uppercase' }}>Variance — RX2</span>
                <span style={{ fontSize:10, color: bv2.text3, fontFamily: bv2.mono }}>show traces ▾</span>
              </div>
              <BvVariance height={26} spike
                color={a.kind==='red'?bv2.red:a.kind==='amber'?bv2.amber:bv2.blue}/>
            </div>
          </div>
        ))}
      </BvCard>

      <BvSection title="Last 30 days"/>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
        {[
          {l:'Real',      v:'3',   c: bv2.red},
          {l:'False',     v:'11',  c: bv2.amber},
          {l:'Precision', v:'21%', c: bv2.green},
        ].map(s=>(
          <BvCard key={s.l} style={{ marginBottom:0, padding:16 }}>
            <div style={{ fontSize:10, color:bv2.text3, fontWeight:700, letterSpacing:1.2, textTransform:'uppercase' }}>{s.l}</div>
            <div style={{ fontFamily: bv2.serif, fontSize:32, fontWeight:400, marginTop:6, color: s.c, letterSpacing:-0.8, lineHeight:0.9 }}>{s.v}</div>
          </BvCard>
        ))}
      </div>
    </div>
    <BvNav active="Alerts"/>
  </div>
);

const BvPeople = () => (
  <div style={{ background: bv2.bg, fontFamily: bv2.sans, height:'100%',
    overflow:'auto', display:'flex', flexDirection:'column' }}>
    <BvAppBar eyebrow="3 CAREGIVERS · ESCALATION IN 30S" title="People"
      trailing={<BvBtn kind="filled" style={{ height:36, padding:'0 14px' }}
        leading={<BvIcon name="plus" size={14} color={bv2.bg}/>}>Invite</BvBtn>}/>

    <div style={{ padding:'0 16px 16px', flex:1 }}>
      <BvCard style={{ padding:0 }}>
        {[
          {n:1, name:'Sarah Chen',   r:'Daughter · primary',  i:'SC', tag:'Primary', kind:'green', col:'#1F5F3F,#3F8C5C'},
          {n:2, name:'David Chen',   r:'Son · backup',        i:'DC', tag:'Backup',  kind:'neutral',col:'#A47148,#C28A60'},
          {n:3, name:'Linda Park',   r:'Neighbor · backup',   i:'LP', tag:'Backup',  kind:'neutral',col:'#7AA6B9,#9DBED0'},
          {n:'!', name:'911 Dispatch', r:'After 60 sec',      i:'!',  tag:'911',     kind:'red',   col:'#C0392B,#E37165'},
        ].map((p,i)=>(
          <div key={p.name} style={{ display:'flex', alignItems:'center', gap:14,
            padding:'14px 18px', borderTop: i===0 ? 'none' : '1px solid '+bv2.divider }}>
            <div style={{ width: 44, height: 44, borderRadius: 22,
              background:`linear-gradient(135deg,${p.col})`,
              display:'flex', alignItems:'center', justifyContent:'center',
              color:'white', fontFamily: bv2.sans, fontSize: 14, fontWeight: 700, letterSpacing:0.4 }}>{p.i}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:15, fontWeight:600 }}>{p.name}</div>
              <div style={{ fontSize:12, color: bv2.text3 }}>{p.r}</div>
            </div>
            <BvPill kind={p.kind}>{p.tag}</BvPill>
          </div>
        ))}
      </BvCard>

      <BvSection title="Escalation"/>
      <BvCard style={{ padding: 18 }}>
        {[
          {t:'0s',  l:'Push to primary',     sub:'Sarah · Apple Watch + iPhone'},
          {t:'30s', l:'Push backup + SMS',   sub:'David, Linda'},
          {t:'60s', l:'Auto-call 911',       sub:'Address + last known room sent'},
        ].map((e,i,arr)=>(
          <div key={i} style={{ display:'flex', gap:14, position:'relative',
            paddingBottom: i === arr.length-1 ? 0 : 18 }}>
            <div style={{ display:'flex', flexDirection:'column', alignItems:'center' }}>
              <div style={{ width: 36, height: 36, borderRadius: 18,
                background: i===arr.length-1 ? bv2.redTint : bv2.greenTint,
                color: i===arr.length-1 ? '#7A1A12' : bv2.greenDeep,
                display:'flex', alignItems:'center', justifyContent:'center',
                fontFamily: bv2.serif, fontSize: 13, fontWeight: 400 }}>{e.t}</div>
              {i < arr.length-1 && <div style={{ flex:1, width: 2,
                background: bv2.divider, marginTop: 4 }}/>}
            </div>
            <div style={{ flex:1, paddingTop: 6 }}>
              <div style={{ fontSize:14, fontWeight:600 }}>{e.l}</div>
              <div style={{ fontSize:12, color: bv2.text3, marginTop:2 }}>{e.sub}</div>
            </div>
            <BvIcon name="chev.right" size={16} color={bv2.text4}/>
          </div>
        ))}
      </BvCard>

      <BvCard style={{ display:'flex', alignItems:'center', gap:14 }}>
        <div style={{ width:44, height:44, borderRadius:22, background: bv2.surfaceAlt,
          display:'flex', alignItems:'center', justifyContent:'center' }}>
          <BvIcon name="lock" size={20} color={bv2.text2}/>
        </div>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:600 }}>Quiet hours</div>
          <div style={{ fontSize:12, color: bv2.text3 }}>10 pm – 7 am · falls always alert</div>
        </div>
        <div style={{ width: 44, height: 26, borderRadius: 13, background: bv2.green,
          padding: 2, display:'flex' }}>
          <div style={{ marginLeft:'auto', width: 22, height: 22, borderRadius:11, background:'white' }}/>
        </div>
      </BvCard>

      <BvCard style={{ padding: 0 }}>
        <div style={{ padding:'14px 18px 8px', fontFamily: bv2.sans, fontSize:11, fontWeight:700, letterSpacing:1.2, textTransform:'uppercase', color: bv2.text3 }}>Channels</div>
        {[
          {l:'Push notifications', on:true},
          {l:'SMS',                on:true},
          {l:'Phone call',         on:true},
          {l:'Apple Watch',        on:false},
        ].map((c)=>(
          <div key={c.l} style={{ display:'flex', alignItems:'center',
            padding:'14px 18px', borderTop:'1px solid '+bv2.divider }}>
            <div style={{ flex:1, fontSize:14, fontWeight:500 }}>{c.l}</div>
            <div style={{ width: 44, height: 26, borderRadius: 13,
              background: c.on ? bv2.green : 'rgba(31,31,31,0.20)',
              padding: 2, display:'flex' }}>
              <div style={{ marginLeft: c.on ? 'auto' : 0, width: 22, height: 22,
                borderRadius:11, background:'white' }}/>
            </div>
          </div>
        ))}
      </BvCard>
    </div>
    <BvNav active="People"/>
  </div>
);

const BvMore = () => (
  <div style={{ background: bv2.bg, fontFamily: bv2.sans, height:'100%',
    overflow:'auto', display:'flex', flexDirection:'column' }}>
    <BvAppBar eyebrow="ACCOUNT" title="More"/>
    <div style={{ padding:'0 16px 16px', flex:1 }}>
      <BvCard tone="cream" style={{ display:'flex', alignItems:'center', gap:14 }}>
        <div style={{ width:60, height:60, borderRadius:30,
          background:'linear-gradient(135deg,#A47148,#C28A60)',
          display:'flex', alignItems:'center', justifyContent:'center',
          color:'white', fontFamily: bv2.serif, fontSize: 24, fontWeight: 400 }}>M</div>
        <div style={{ flex:1 }}>
          <div style={{ fontFamily: bv2.serif, fontSize:22, fontWeight:400, letterSpacing:-0.3 }}>Margaret Chen</div>
          <div style={{ fontSize:12, color: bv2.text3, marginTop:1 }}>72 · 1428 Fern St, Apt 3B</div>
        </div>
        <BvBtn kind="ghost" style={{ height: 34, padding:'0 14px' }}>Edit</BvBtn>
      </BvCard>

      {[
        { hd:'System', items:[
          {l:'Sensor diagnostics', s:'4/4 healthy · last test Mar 1', i:'sensor'},
          {l:'Apartment layout',   s:'5 rooms · edit floor plan',    i:'map'},
        ]},
        { hd:'Sharing', items:[
          {l:'Caregivers',         s:'3 people · invite more', i:'people'},
          {l:'Privacy & data',     s:'30-day retention',       i:'lock'},
        ]},
        { hd:'Account', items:[
          {l:'Subscription',       s:'Family plan · $19/mo',   i:'star'},
          {l:'Help & support',     s:'Live chat 7am – 9pm',    i:'help'},
        ]},
      ].map(g=>(
        <div key={g.hd}>
          <div style={{ padding:'14px 6px 10px', fontFamily: bv2.sans, fontSize: 11,
            fontWeight: 700, color: bv2.text3, letterSpacing: 1.2, textTransform:'uppercase' }}>{g.hd}</div>
          <BvCard style={{ padding: 0 }}>
            {g.items.map((it,i)=>(
              <div key={it.l} style={{ display:'flex', alignItems:'center', gap: 14,
                padding:'14px 18px', borderTop: i===0 ? 'none' : '1px solid '+bv2.divider }}>
                <div style={{ width: 36, height: 36, borderRadius: 18,
                  background: bv2.greenTint,
                  display:'flex', alignItems:'center', justifyContent:'center' }}>
                  <BvIcon name={it.i} size={17} color={bv2.greenDeep}/>
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:14, fontWeight:600 }}>{it.l}</div>
                  <div style={{ fontSize:12, color: bv2.text3, marginTop:1 }}>{it.s}</div>
                </div>
                <BvIcon name="chev.right" size={16} color={bv2.text4}/>
              </div>
            ))}
          </BvCard>
        </div>
      ))}

      <BvCard style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8,
        padding: 16, color: bv2.red, fontWeight: 600, fontSize: 14 }}>Sign out</BvCard>

      <div style={{ textAlign:'center', fontSize:10, color: bv2.text4,
        padding:'8px 0 4px', fontFamily: bv2.mono, letterSpacing:1.2 }}>BUOY · v0.4 · BUILD 142</div>
    </div>
    <BvNav active="More"/>
  </div>
);

Object.assign(window, {
  bv2, BvIcon, BvCard, BvChip, BvPill, BvBtn, BvAppBar, BvSearchBar, BvNav,
  BvSection, BvRankBadge, BvScore,
  BvFloorPlanMini, BvFloorPlanLarge, BvDayStrip, BvVariance,
  BvHome, BvMap, BvAlerts, BvPeople, BvMore,
});
