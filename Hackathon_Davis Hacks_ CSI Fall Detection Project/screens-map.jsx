// SCREEN 2: Apartment map — the headline view, all 5 are top-down floor plans
// (per user pick) but with different information emphasis

const MapV1_CalmDefault = () => (
  <Phone>
    <div className="between mb-4">
      <div className="hand" style={{fontSize:18, fontWeight:700}}>Mom's place</div>
      <span className="pill ok">all quiet</span>
    </div>
    <div className="hand2 mb-8" style={{fontSize:11, color:'var(--ink-faint)'}}>
      In Living room · last motion 14 min ago
    </div>
    <div className="box" style={{flex:1, padding:6, position:'relative'}}>
      <FloorPlan width={250} height={300} rooms={[
        { label:'Kitchen', x:6, y:6, w:100, h:80 },
        { label:'Living', x:108, y:6, w:138, h:140, fillColor:'var(--ok-fill)' },
        { label:'Bed', x:6, y:88, w:100, h:140 },
        { label:'Bath', x:108, y:148, w:70, h:80 },
        { label:'Hall', x:180, y:148, w:66, h:80 },
      ]} sensors={[
        { kind:'tx', label:'TX', x:130, y:80 },
        { label:'1', x:50, y:50 },
        { label:'2', x:170, y:80 },
        { label:'3', x:50, y:160 },
        { label:'4', x:215, y:200 },
      ]} person={{ x: 175, y: 80 }} />
    </div>
    <div className="row gap-8 mt-8 mb-8" style={{justifyContent:'space-around'}}>
      <div className="col" style={{alignItems:'center'}}>
        <span className="dot ok"></span>
        <span className="tiny">4/4 OK</span>
      </div>
      <div className="col" style={{alignItems:'center'}}>
        <span className="hand" style={{fontSize:13}}>72 °F</span>
        <span className="tiny">indoor</span>
      </div>
      <div className="col" style={{alignItems:'center'}}>
        <span className="hand" style={{fontSize:13}}>0</span>
        <span className="tiny">alerts/wk</span>
      </div>
    </div>
    <TabBar active="Map" />
  </Phone>
);

const MapV2_HeatmapDense = () => (
  <Phone>
    <div className="between mb-4">
      <div className="hand" style={{fontSize:18, fontWeight:700}}>Live map</div>
      <span className="hand2" style={{fontSize:11}}>● motion heat</span>
    </div>
    <div className="box" style={{flex:1, padding:6, position:'relative'}}>
      <FloorPlan width={250} height={310} rooms={[
        { label:'Kitchen', x:6, y:6, w:100, h:80, fillColor:'var(--warn-fill)' },
        { label:'Living', x:108, y:6, w:138, h:140, fillColor:'var(--alert-fill)' },
        { label:'Bed', x:6, y:88, w:100, h:140, fillColor:'rgba(31,42,68,0.05)' },
        { label:'Bath', x:108, y:148, w:70, h:80, fillColor:'var(--ok-fill)' },
        { label:'Hall', x:180, y:148, w:66, h:80, fillColor:'rgba(31,42,68,0.05)' },
      ]} coverage={[
        { x:50, y:50, r:55 },
        { x:170, y:80, r:65 },
        { x:50, y:160, r:55 },
        { x:215, y:200, r:55 },
      ]} sensors={[
        { kind:'tx', label:'TX', x:130, y:80 },
        { label:'1', x:50, y:50 },
        { label:'2', x:170, y:80 },
        { label:'3', x:50, y:160 },
        { label:'4', x:215, y:200 },
      ]} person={{ x: 160, y: 70 }} />
    </div>
    <div className="row gap-4 mt-8" style={{flexWrap:'wrap', fontSize:10}}>
      <span className="pill" style={{background:'rgba(31,42,68,0.05)'}}>still</span>
      <span className="pill ok">low</span>
      <span className="pill warn">med</span>
      <span className="pill alert">high</span>
      <span className="hand2" style={{fontSize:10, marginLeft:'auto'}}>tap layer ▼</span>
    </div>
    <div className="mt-8 mb-8 box" style={{padding:'4px 8px'}}>
      <div className="hand" style={{fontSize:13}}>"Living rm — high motion · 12s"</div>
    </div>
    <TabBar active="Map" />
  </Phone>
);

const MapV3_SignalTrails = () => (
  <Phone>
    <div className="between mb-4">
      <div className="hand" style={{fontSize:18, fontWeight:700}}>Signal view</div>
      <span className="hand2" style={{fontSize:11, color:'var(--accent)'}}>● live trails</span>
    </div>
    <div className="hand2 mb-8" style={{fontSize:11, color:'var(--ink-faint)'}}>
      Lines = which RX sees motion right now
    </div>
    <div className="box" style={{flex:1, padding:6, position:'relative'}}>
      <FloorPlan width={250} height={290} rooms={[
        { label:'Kitchen', x:6, y:6, w:100, h:80 },
        { label:'Living', x:108, y:6, w:138, h:140 },
        { label:'Bed', x:6, y:88, w:100, h:140 },
        { label:'Bath', x:108, y:148, w:70, h:80 },
        { label:'Hall', x:180, y:148, w:66, h:80 },
      ]} sensors={[
        { kind:'tx', label:'TX', x:130, y:80 },
        { label:'1', x:50, y:50 },
        { label:'2', x:170, y:80 },
        { label:'3', x:50, y:160 },
        { label:'4', x:215, y:200 },
      ]} trail={[
        { x1:170, y1:80, x2:160, y2:75, color:'var(--accent)', w:3 },
        { x1:50,  y1:50, x2:160, y2:75, color:'var(--accent)', w:1.5 },
        { x1:130, y1:80, x2:160, y2:75, color:'var(--ok)',     w:2 },
      ]} person={{ x: 160, y: 75 }} />
      <Note style={{position:'absolute', bottom:6, right:6, fontSize:10, padding:'2px 6px',
        transform:'rotate(0deg)', background:'rgba(255,255,255,0.85)'}}>
        RX2: 8.3× variance<br/>RX1: 1.4×
      </Note>
    </div>
    <div className="row gap-6 mt-8 mb-8" style={{justifyContent:'space-around'}}>
      <div className="btn" style={{fontSize:11, padding:'2px 8px'}}>Coverage</div>
      <div className="btn primary" style={{fontSize:11, padding:'2px 8px'}}>Trails</div>
      <div className="btn" style={{fontSize:11, padding:'2px 8px'}}>Heat</div>
    </div>
    <TabBar active="Map" />
  </Phone>
);

const MapV4_FocusedRoomDrill = () => (
  <Phone>
    <div className="row gap-8 mb-8" style={{alignItems:'center'}}>
      <span className="hand" style={{fontSize:14, color:'var(--accent)'}}>← Map</span>
      <div className="hand" style={{fontSize:18, fontWeight:700}}>Living room</div>
    </div>
    {/* mini-map locator */}
    <div className="row gap-8 mb-8">
      <FloorPlan width={70} height={80} rooms={[
        { label:'', x:2, y:2, w:30, h:24 },
        { label:'', x:34, y:2, w:34, h:42, fillColor:'var(--accent-fill)' },
        { label:'', x:2, y:28, w:30, h:42 },
        { label:'', x:34, y:46, w:18, h:24 },
        { label:'', x:54, y:46, w:14, h:24 },
      ]} sensors={[]} />
      <div className="col gap-4" style={{flex:1}}>
        <div className="row gap-6"><span className="dot ok"></span><span className="hand" style={{fontSize:13}}>Occupied · 14 min</span></div>
        <div className="row gap-6"><span className="dot"></span><span className="hand" style={{fontSize:13}}>2 sensors covering</span></div>
        <div className="row gap-6"><span className="dot warn"></span><span className="hand" style={{fontSize:13}}>RX2 noisy today</span></div>
      </div>
    </div>
    <div className="lbl mb-4">Last 24 h in this room</div>
    <div className="mb-8"><Squiggle width={250} height={48} stroke="var(--accent)" /></div>
    <div className="lbl mb-4">Time-of-day presence</div>
    <DayStrip bands={[
      { color:'transparent', w:25 },
      { color:'var(--accent)', w:8, opacity:0.5 },
      { color:'transparent', w:12 },
      { color:'var(--accent)', w:18, opacity:0.7 },
      { color:'transparent', w:6 },
      { color:'var(--accent)', w:22, opacity:0.6 },
      { color:'transparent', w:9 },
    ]} />
    <div className="row gap-6 mt-8" style={{justifyContent:'space-between'}}>
      <span className="tiny">12a</span><span className="tiny">6a</span>
      <span className="tiny">12p</span><span className="tiny">6p</span><span className="tiny">12a</span>
    </div>
    <div className="grow"></div>
    <TabBar active="Map" />
  </Phone>
);

const MapV5_3DStackPerSensor = () => (
  <Phone>
    <div className="between mb-4">
      <div className="hand" style={{fontSize:18, fontWeight:700}}>Map · stacks</div>
      <span className="hand2" style={{fontSize:11}}>per-sensor</span>
    </div>
    <div className="hand2 mb-8" style={{fontSize:11, color:'var(--ink-faint)'}}>
      Map + a live trace under every sensor.
    </div>
    <div className="box" style={{flex:1, padding:6, position:'relative'}}>
      <FloorPlan width={250} height={210} rooms={[
        { label:'Kit', x:6, y:6, w:100, h:80 },
        { label:'Living', x:108, y:6, w:138, h:90, fillColor:'var(--ok-fill)' },
        { label:'Bed', x:6, y:88, w:100, h:115 },
        { label:'Bath', x:108, y:100, w:70, h:55 },
        { label:'Hall', x:180, y:100, w:66, h:55 },
      ]} sensors={[
        { kind:'tx', label:'TX', x:130, y:60 },
        { label:'1', x:50, y:50 },
        { label:'2', x:170, y:50 },
        { label:'3', x:50, y:155 },
        { label:'4', x:215, y:130 },
      ]} person={{x:170, y:60}} />
    </div>
    {/* stack of mini graphs */}
    <div className="col gap-4 mt-8">
      {[
        { l:'RX1', s:false, c:'var(--ink-soft)' },
        { l:'RX2', s:true,  c:'var(--accent)' },
        { l:'RX3', s:false, c:'var(--ink-soft)' },
        { l:'RX4', s:false, c:'var(--ink-soft)' },
      ].map(g => (
        <div key={g.l} className="row gap-6" style={{alignItems:'center'}}>
          <span className="mono" style={{width:24}}>{g.l}</span>
          <Squiggle width={210} height={18} stroke={g.c} spike={g.s} />
        </div>
      ))}
    </div>
    <TabBar active="Map" />
  </Phone>
);

window.MapScreens = {
  MapV1_CalmDefault,
  MapV2_HeatmapDense,
  MapV3_SignalTrails,
  MapV4_FocusedRoomDrill,
  MapV5_3DStackPerSensor,
};
