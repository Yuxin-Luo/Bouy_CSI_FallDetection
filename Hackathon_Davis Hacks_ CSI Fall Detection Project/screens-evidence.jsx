// SCREEN 4: Alert detail / evidence locker — historical alert deep-dive

const EvidenceV1_TimelineFirst = () => (
  <Phone>
    <div className="row gap-6 mb-4" style={{alignItems:'center'}}>
      <span className="hand" style={{fontSize:14, color:'var(--accent)'}}>← Alerts</span>
      <span className="pill alert" style={{marginLeft:'auto'}}>resolved</span>
    </div>
    <div className="title mb-4">Tue · 3:14 pm</div>
    <div className="hand2 mb-8" style={{fontSize:12, color:'var(--ink-soft)'}}>
      Living room · 93% conf · cancelled by Mom
    </div>
    {/* event timeline */}
    <div className="col gap-6 mb-8 box" style={{padding:8}}>
      {[
        { t:'3:14:02', e:'Variance spike on RX2 (14×)', c:'var(--alert)' },
        { t:'3:14:03', e:'Stillness pattern matched', c:'var(--alert)' },
        { t:'3:14:04', e:'Push sent to Sarah, James', c:'var(--accent)' },
        { t:'3:14:18', e:'Mom tapped "I\'m fine"', c:'var(--ok)' },
        { t:'3:14:18', e:'Alert downgraded · cancelled', c:'var(--ok)' },
      ].map((row,i) => (
        <div key={i} className="row gap-8" style={{alignItems:'flex-start'}}>
          <span className="mono" style={{minWidth:46, color:row.c}}>{row.t}</span>
          <span className="hand" style={{fontSize:13, flex:1}}>{row.e}</span>
        </div>
      ))}
    </div>
    <div className="lbl mb-4">Was this real?</div>
    <div className="row gap-6">
      <div className="btn ok grow" style={{fontSize:13}}>Real fall</div>
      <div className="btn grow" style={{fontSize:13}}>False alarm</div>
      <div className="btn grow" style={{fontSize:13}}>Other</div>
    </div>
    <div className="text-center mt-8 tiny">↓ export PDF for doctor</div>
  </Phone>
);

const EvidenceV2_VarianceTraces = () => (
  <Phone>
    <div className="between mb-8">
      <div className="hand" style={{fontSize:18, fontWeight:700}}>Event #142</div>
      <span className="pill warn">false alarm</span>
    </div>
    <div className="hand2 mb-8" style={{fontSize:12}}>10-sec window around 3:14:02</div>
    <div className="box" style={{padding:8, marginBottom:8}}>
      <div className="lbl mb-4">Per-sensor variance</div>
      <div className="col gap-4">
        <div className="row gap-6" style={{alignItems:'center'}}>
          <span className="mono" style={{width:24, color:'var(--alert)'}}>RX2</span>
          <Squiggle width={170} height={26} stroke="var(--alert)" spike/>
          <span className="hand2" style={{fontSize:11, color:'var(--alert)'}}>14.2×</span>
        </div>
        <div className="row gap-6" style={{alignItems:'center'}}>
          <span className="mono" style={{width:24}}>RX1</span>
          <Squiggle width={170} height={26} spike stroke="var(--ink-soft)"/>
          <span className="hand2" style={{fontSize:11}}>6.1×</span>
        </div>
        <div className="row gap-6" style={{alignItems:'center'}}>
          <span className="mono" style={{width:24}}>RX3</span>
          <Squiggle width={170} height={26} stroke="var(--ink-soft)"/>
          <span className="hand2" style={{fontSize:11}}>1.1×</span>
        </div>
        <div className="row gap-6" style={{alignItems:'center'}}>
          <span className="mono" style={{width:24}}>RX4</span>
          <Squiggle width={170} height={26} stroke="var(--ink-soft)"/>
          <span className="hand2" style={{fontSize:11}}>1.3×</span>
        </div>
      </div>
    </div>
    <div className="box" style={{padding:8, marginBottom:8}}>
      <div className="lbl mb-4">Map at moment</div>
      <FloorPlan width={230} height={100} rooms={[
        { label:'Kit', x:6, y:6, w:70, h:40 },
        { label:'Living', x:80, y:6, w:140, h:60, fillColor:'var(--alert-fill)' },
        { label:'Bed', x:6, y:48, w:70, h:50 },
      ]} sensors={[
        { kind:'tx', label:'TX', x:110, y:46 },
        { label:'2', x:170, y:30, alert:true },
      ]} fall={{x:160, y:50}} />
    </div>
    <div className="row gap-6">
      <div className="btn grow" style={{fontSize:12}}>Real</div>
      <div className="btn grow" style={{fontSize:12}}>False</div>
      <div className="btn grow" style={{fontSize:12}}>Export</div>
    </div>
  </Phone>
);

const EvidenceV3_VideoStyleScrubber = () => (
  <Phone>
    <div className="row gap-4 mb-4" style={{alignItems:'center'}}>
      <span className="hand" style={{fontSize:13, color:'var(--accent)'}}>← back</span>
      <span className="hand" style={{fontSize:14, marginLeft:'auto'}}>Replay</span>
    </div>
    {/* big map preview as if it's a video frame */}
    <div className="box" style={{padding:0, position:'relative', flex:'0 0 auto'}}>
      <FloorPlan width={250} height={170} rooms={[
        { label:'Kit', x:6, y:6, w:80, h:60 },
        { label:'Living', x:90, y:6, w:150, h:100, fillColor:'var(--alert-fill)' },
        { label:'Bed', x:6, y:68, w:80, h:90 },
      ]} sensors={[
        { kind:'tx', label:'TX', x:120, y:60 },
        { label:'1', x:40, y:40 },
        { label:'2', x:200, y:50, alert:true },
      ]} fall={{x:175, y:60}} />
      <div className="center absolute" style={{inset:0}}>
        <div style={{width:48, height:48, borderRadius:'50%', background:'rgba(255,255,255,0.7)',
          border:'2px solid var(--ink)', display:'flex', alignItems:'center', justifyContent:'center'}}>
          <div style={{width:0,height:0,borderLeft:'14px solid var(--ink)',
            borderTop:'9px solid transparent',borderBottom:'9px solid transparent', marginLeft:4}}/>
        </div>
      </div>
    </div>
    {/* scrubber */}
    <div className="mt-8 mb-4">
      <div style={{height:24, position:'relative'}}>
        <Squiggle width={250} height={24} stroke="var(--ink-soft)" spike/>
        <div style={{position:'absolute', left:'62%', top:0, bottom:0,
          width:0, borderLeft:'2px solid var(--alert)'}}/>
      </div>
      <div className="row between mt-4">
        <span className="mono">-5.0s</span>
        <span className="mono" style={{color:'var(--alert)'}}>EVENT</span>
        <span className="mono">+5.0s</span>
      </div>
    </div>
    <div className="row gap-6 mt-8" style={{justifyContent:'center'}}>
      <div className="btn" style={{fontSize:11, padding:'2px 6px'}}>0.25×</div>
      <div className="btn primary" style={{fontSize:11, padding:'2px 6px'}}>1×</div>
      <div className="btn" style={{fontSize:11, padding:'2px 6px'}}>scrub</div>
    </div>
    <div className="row gap-6 mt-8">
      <div className="btn ok grow" style={{fontSize:13}}>Real fall</div>
      <div className="btn grow" style={{fontSize:13}}>False</div>
    </div>
  </Phone>
);

const EvidenceV4_AlertList = () => (
  <Phone>
    <div className="between mb-8">
      <div className="hand" style={{fontSize:18, fontWeight:700}}>Alerts · 30 days</div>
      <span className="hand2" style={{fontSize:11}}>filter ▼</span>
    </div>
    {/* mini summary cards */}
    <div className="row gap-6 mb-8">
      <div className="box grow text-center" style={{padding:6}}>
        <div className="title">3</div>
        <div className="tiny">real</div>
      </div>
      <div className="box warn grow text-center" style={{padding:6}}>
        <div className="title" style={{color:'var(--warn)'}}>11</div>
        <div className="tiny">false</div>
      </div>
      <div className="box ok grow text-center" style={{padding:6}}>
        <div className="title" style={{color:'var(--ok)'}}>21%</div>
        <div className="tiny">precision</div>
      </div>
    </div>
    <div className="col gap-6" style={{flex:1, overflow:'hidden'}}>
      {[
        { d:'Tue 3:14p', s:'Living room · 93%', tag:'false', c:'warn' },
        { d:'Mon 8:02a', s:'Bathroom · 78%',    tag:'real',  c:'alert' },
        { d:'Sun 2:11p', s:'Kitchen · 64%',     tag:'false', c:'warn' },
        { d:'Sat 11:55p',s:'Bed · 88%',         tag:'?',     c:'' },
        { d:'Thu 9:30a', s:'Living · 71%',      tag:'false', c:'warn' },
      ].map((a,i) => (
        <div key={i} className={`box ${a.c}`} style={{padding:6}}>
          <div className="between">
            <span className="hand" style={{fontSize:13, fontWeight:700}}>{a.d}</span>
            <span className={`pill ${a.c||''}`}>{a.tag}</span>
          </div>
          <div className="hand2" style={{fontSize:11}}>{a.s}</div>
        </div>
      ))}
    </div>
    <TabBar active="Alerts" />
  </Phone>
);

const EvidenceV5_NarrativeReplay = () => (
  <Phone>
    <div className="lbl mb-4" style={{color:'var(--alert)'}}>EVENT · TUE 3:14 PM</div>
    <div className="title mb-8">Here's what<br/>happened.</div>
    <div className="col gap-8" style={{flex:1}}>
      {[
        { i:1, t:'For 14 minutes Mom was watching TV in the living room.',
          c:'var(--ink-soft)' },
        { i:2, t:'At 3:14:02, RX2 saw a sharp motion — 14× her baseline.',
          h:'14× baseline', c:'var(--alert)' },
        { i:3, t:'Then everything went still for 2 seconds. The model called this a fall.',
          h:'still 2 sec', c:'var(--alert)' },
        { i:4, t:'We sent push to Sarah and James. Mom\'s tablet asked "are you OK?".',
          c:'var(--accent)' },
        { i:5, t:'Mom tapped "I\'m fine" 16 sec later. We logged it as a false alarm.',
          h:'I\'m fine', c:'var(--ok)' },
      ].map((s,i) => (
        <div key={i} className="row gap-8">
          <div style={{minWidth:24, height:24, borderRadius:'50%',
            border:`2px solid ${s.c}`, display:'flex', alignItems:'center', justifyContent:'center',
            color:s.c, fontFamily:'var(--mono)', fontSize:11, fontWeight:700}}>
            {s.i}
          </div>
          <div className="hand" style={{fontSize:14, flex:1, lineHeight:1.25}}>
            {s.t}
          </div>
        </div>
      ))}
    </div>
    <div className="row gap-6 mt-12">
      <div className="btn grow" style={{fontSize:12}}>See the data ↓</div>
      <div className="btn grow" style={{fontSize:12}}>Share PDF</div>
    </div>
    <Note color="#c8e8d4" style={{ top: 90, right: -80, fontSize:12 }}>
      Narrative<br/>for non-engineers
    </Note>
  </Phone>
);

window.EvidenceScreens = {
  EvidenceV1_TimelineFirst,
  EvidenceV2_VarianceTraces,
  EvidenceV3_VideoStyleScrubber,
  EvidenceV4_AlertList,
  EvidenceV5_NarrativeReplay,
};
