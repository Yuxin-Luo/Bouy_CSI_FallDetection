// Buoy — Home screen (caregiver)
// Apple Health-style cards, blue accent, room-presence focus.

const GDFloorPlanMini = ({ activeRoom = 'living' }) => {
  // Compact floor plan used inside Home / Map cards
  const fill = (key) => activeRoom === key ? 'rgba(10,132,255,0.10)' : 'transparent';
  const stroke = (key) => activeRoom === key ? '#0A84FF' : 'rgba(60,60,67,0.30)';
  const sw = (key) => activeRoom === key ? 1.6 : 1;
  return (
    <svg viewBox="0 0 220 160" width="100%" style={{ display: 'block' }}>
      {/* outer wall */}
      <rect x="6" y="6" width="208" height="148" fill="none" stroke="rgba(60,60,67,0.30)" strokeWidth="1.4" rx="3"/>
      {/* rooms */}
      <rect x="6" y="6" width="86" height="68" fill={fill('kitchen')} stroke={stroke('kitchen')} strokeWidth={sw('kitchen')} rx="2"/>
      <rect x="92" y="6" width="122" height="86" fill={fill('living')} stroke={stroke('living')} strokeWidth={sw('living')} rx="2"/>
      <rect x="6" y="74" width="86" height="80" fill={fill('bed')} stroke={stroke('bed')} strokeWidth={sw('bed')} rx="2"/>
      <rect x="92" y="92" width="60" height="62" fill={fill('bath')} stroke={stroke('bath')} strokeWidth={sw('bath')} rx="2"/>
      <rect x="152" y="92" width="62" height="62" fill={fill('hall')} stroke={stroke('hall')} strokeWidth={sw('hall')} rx="2"/>
      {/* labels */}
      <g fontFamily={gdTokens.sf} fontSize="8" fill={gdTokens.text3} fontWeight="500">
        <text x="12" y="18">Kitchen</text>
        <text x="98" y="18">Living Room</text>
        <text x="12" y="86">Bedroom</text>
        <text x="98" y="104">Bath</text>
        <text x="158" y="104">Hall</text>
      </g>
      {/* sensors as small dots */}
      <g>
        {[
          { x: 35, y: 40, tx: false }, { x: 150, y: 50, tx: true },
          { x: 35, y: 115, tx: false }, { x: 180, y: 130, tx: false },
        ].map((s, i) => (
          <g key={i}>
            <circle cx={s.x} cy={s.y} r={s.tx ? 4 : 3} fill={s.tx ? '#0A84FF' : '#34C759'} />
            <circle cx={s.x} cy={s.y} r={s.tx ? 4 : 3} fill="none" stroke="white" strokeWidth="1"/>
          </g>
        ))}
      </g>
      {/* person dot in active room */}
      {activeRoom === 'living' && (
        <g>
          <circle cx="135" cy="50" r="9" fill="#0A84FF" opacity="0.18" />
          <circle cx="135" cy="50" r="5" fill="#0A84FF" />
          <circle cx="135" cy="50" r="5" fill="none" stroke="white" strokeWidth="1.4"/>
        </g>
      )}
    </svg>
  );
};

// Day-strip showing room presence over 24h
const GDDayStrip = ({ height = 12 }) => {
  // Simulated bands across 24h
  const bands = [
    { color: '#5E5CE6', w: 28 }, // 0-6:30 bedroom
    { color: '#FF9500', w: 5 },  // kitchen
    { color: '#E5E5EA', w: 8 },  // bath
    { color: '#0A84FF', w: 14 }, // living
    { color: '#FF9500', w: 4 },  // kitchen
    { color: '#0A84FF', w: 18 }, // living (current)
    { color: '#E5E5EA', w: 4 },
    { color: '#5E5CE6', w: 19 }, // bedroom evening
  ];
  return (
    <div style={{ display: 'flex', height, borderRadius: height/2, overflow: 'hidden',
      border: '0.5px solid ' + gdTokens.border }}>
      {bands.map((b, i) => (
        <div key={i} style={{ width: `${b.w}%`, background: b.color, opacity: 0.85 }}/>
      ))}
    </div>
  );
};

const GDHomeScreen = () => (
  <div style={{ background: gdTokens.bg, fontFamily: gdTokens.sf,
    height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
    {/* top status header (replaces nav bar) */}
    <div style={{ padding: '52px 20px 8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, color: gdTokens.text3, fontWeight: 500, letterSpacing: 0.3 }}>HOME</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginTop: 2 }}>Mom's place</div>
        </div>
        <div style={{ width: 36, height: 36, borderRadius: 18, background: gdTokens.card,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 1px 2px rgba(0,0,0,0.06)' }}>
          <GDSymbol name="person.crop.circle.fill" size={28} color={gdTokens.blue} />
        </div>
      </div>
    </div>

    <div style={{ padding: '4px 16px 16px', flex: 1 }}>
      {/* HERO — current state */}
      <GDCard style={{ padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ width: 8, height: 8, borderRadius: 4, background: gdTokens.green,
            boxShadow: '0 0 0 3px rgba(52,199,89,0.18)' }}/>
          <div style={{ fontSize: 13, color: gdTokens.text3, fontWeight: 600, letterSpacing: 0.3 }}>
            ALL QUIET · UPDATED 12 SEC AGO
          </div>
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1 }}>
          Mom is in the<br/>
          <span style={{ color: gdTokens.blue }}>living room</span>
        </div>
        <div style={{ fontSize: 15, color: gdTokens.text3, marginTop: 6 }}>
          Last motion 14 minutes ago · arrived 3:01 pm
        </div>

        <div style={{ marginTop: 14, padding: '10px 0 0', borderTop: '0.5px solid ' + gdTokens.border }}>
          <GDFloorPlanMini activeRoom="living" />
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <div style={{ flex: 1, height: 38, background: gdTokens.blue,
            borderRadius: 19, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontSize: 15, fontWeight: 600, gap: 6 }}>
            <GDSymbol name="phone.fill" size={15} color="white"/> Call Mom
          </div>
          <div style={{ flex: 1, height: 38, background: gdTokens.cardSubtle,
            borderRadius: 19, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: gdTokens.blue, fontSize: 15, fontWeight: 600, gap: 6,
            border: '0.5px solid ' + gdTokens.border }}>
            <GDSymbol name="map.fill" size={15} color={gdTokens.blue}/> Open map
          </div>
        </div>
      </GDCard>

      {/* TODAY TIMELINE */}
      <GDSectionHeader title="Today" action="See all" />
      <GDCard>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>Room presence</div>
          <div style={{ fontSize: 13, color: gdTokens.text3 }}>Tue, March 4</div>
        </div>
        <GDDayStrip />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6,
          fontSize: 11, color: gdTokens.text3, fontVariantNumeric: 'tabular-nums' }}>
          <span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>12a</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {[
            { c: '#5E5CE6', l: 'Bedroom' },
            { c: '#FF9500', l: 'Kitchen' },
            { c: '#0A84FF', l: 'Living' },
            { c: '#E5E5EA', l: 'Other' },
          ].map(t => (
            <div key={t.l} style={{ display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 8px 3px 6px', background: gdTokens.cardSubtle, borderRadius: 8,
              fontSize: 12, fontWeight: 500, color: gdTokens.text2 }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: t.c }}/>
              {t.l}
            </div>
          ))}
        </div>
      </GDCard>

      {/* RECENT ALERTS — empty positive state */}
      <GDCard style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 20, background: gdTokens.greenBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <GDSymbol name="checkmark" size={22} color="#1B7B3A"/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>No alerts in 7 days</div>
          <div style={{ fontSize: 13, color: gdTokens.text3, marginTop: 1 }}>Last event Feb 26 · false alarm</div>
        </div>
        <GDSymbol name="chevron.right" size={17} color={gdTokens.text4}/>
      </GDCard>

      {/* SENSORS */}
      <GDCard style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '14px 16px 10px', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 17, fontWeight: 600 }}>Sensors</div>
          <GDPill kind="green">4/4 healthy</GDPill>
        </div>
        {[
          { name: 'TX broadcaster', loc: 'Center wall', kind: 'tx', stat: 'Pkts 92/s' },
          { name: 'RX 1', loc: 'Kitchen', stat: '94/s · -52 dBm' },
          { name: 'RX 2', loc: 'Living room', stat: '91/s · -49 dBm' },
          { name: 'RX 3', loc: 'Bedroom', stat: '89/s · -57 dBm' },
        ].map((s, i, arr) => (
          <div key={s.name} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '10px 16px',
            borderTop: '0.5px solid ' + gdTokens.border,
          }}>
            <div style={{ width: 32, height: 32, borderRadius: 8,
              background: s.kind === 'tx' ? gdTokens.blueBg : gdTokens.greenBg,
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <GDSymbol name="sensor.tag.radiowaves.forward" size={18}
                color={s.kind === 'tx' ? gdTokens.blue : '#1B7B3A'}/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 500 }}>{s.name}</div>
              <div style={{ fontSize: 13, color: gdTokens.text3 }}>{s.loc}</div>
            </div>
            <div style={{ fontSize: 12, color: gdTokens.text3, fontFamily: gdTokens.sfMono }}>
              {s.stat}
            </div>
            <GDSymbol name="chevron.right" size={15} color={gdTokens.text4}/>
          </div>
        ))}
      </GDCard>
    </div>

    <GDTabBar active="Home" />
  </div>
);

window.GDHomeScreen = GDHomeScreen;
window.GDFloorPlanMini = GDFloorPlanMini;
window.GDDayStrip = GDDayStrip;
