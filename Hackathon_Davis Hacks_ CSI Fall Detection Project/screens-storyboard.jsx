// SCREEN 8: Demo-day storyboard — 7-frame comic strip walking through the judge demo

const StoryboardFrame = ({ n, title, children, w = 240, h = 320 }) => (
  <div style={{ width: w, height: h, position: 'relative', filter: 'url(#sketchy)',
    border: '2.5px solid var(--ink)', background: 'var(--paper)', borderRadius: 6,
    padding: 8, display: 'flex', flexDirection: 'column' }}>
    <div className="between mb-4">
      <span className="lbl" style={{color:'var(--accent)'}}>FRAME {n}</span>
      <span className="hand" style={{fontSize:13, fontWeight:700}}>{title}</span>
    </div>
    <div style={{ flex: 1, position: 'relative' }}>{children}</div>
  </div>
);

const Storyboard = () => (
  <div className="row gap-12" style={{flexWrap:'wrap', justifyContent:'center', padding:16}}>
    <StoryboardFrame n="1" title="Hand the phone over">
      <div className="center" style={{flexDirection:'column', height:'100%', gap:10}}>
        <div style={{width:90, height:140, border:'2px solid var(--ink)', borderRadius:14,
          padding:8, position:'relative', background:'rgba(31,42,68,0.05)'}}>
          <div style={{fontFamily:'var(--hand)', fontSize:24, textAlign:'center'}}>9:41</div>
          <div className="box ok" style={{padding:4, marginTop:18, fontSize:9}}>
            <div className="hand" style={{fontSize:10}}>Mom · Living rm</div>
            <div className="tiny" style={{fontSize:8}}>all quiet ✓</div>
          </div>
        </div>
        <div className="hand2 text-center" style={{fontSize:12, lineHeight:1.2}}>
          Judge's lock screen.<br/>"Calm by default."
        </div>
      </div>
    </StoryboardFrame>

    <StoryboardFrame n="2" title="Open · Home tab">
      <div className="col gap-4" style={{padding:8, height:'100%'}}>
        <div className="hand" style={{fontSize:13, fontWeight:700}}>Mom's place</div>
        <div className="box ok" style={{padding:4}}>
          <div className="hand" style={{fontSize:11}}>In Living rm · 14m ago</div>
        </div>
        <div className="lbl" style={{fontSize:9}}>TODAY</div>
        <DayStrip bands={[
          { color:'var(--accent-fill)', w:25 },
          { color:'transparent', w:10 },
          { color:'var(--ok-fill)', w:30 },
          { color:'transparent', w:35 },
        ]} height={10}/>
        <div className="lbl mt-4" style={{fontSize:9}}>RECENT ALERTS</div>
        <div className="hand2" style={{fontSize:11}}>None in 7 days ✓</div>
      </div>
    </StoryboardFrame>

    <StoryboardFrame n="3" title="The map (live)">
      <div className="col" style={{height:'100%', padding:4}}>
        <div className="hand2 mb-4" style={{fontSize:11}}>Walk through the room…</div>
        <FloorPlan width={210} height={180} rooms={[
          { label:'Kit', x:6, y:6, w:70, h:50 },
          { label:'Living', x:80, y:6, w:124, h:90, fillColor:'var(--ok-fill)' },
          { label:'Bed', x:6, y:58, w:70, h:80 },
          { label:'Bath', x:80, y:100, w:60, h:50 },
        ]} sensors={[
          { kind:'tx', label:'TX', x:110, y:50 },
          { label:'1', x:40, y:30 },
          { label:'2', x:170, y:60 },
        ]} person={{x:140, y:50}} />
        <div className="hand text-center mt-4" style={{fontSize:11, color:'var(--accent)'}}>
          ← figure follows me
        </div>
      </div>
    </StoryboardFrame>

    <StoryboardFrame n="4" title="Trigger: fall on mat">
      <div className="col" style={{height:'100%', padding:4, background:'var(--alert-fill)',
        margin:-8, padding:8}}>
        <div className="lbl mb-4" style={{color:'var(--alert)'}}>BUZZ · 0:23</div>
        <FloorPlan width={210} height={140} rooms={[
          { label:'Kit', x:6, y:6, w:60, h:40, fillColor:'rgba(31,42,68,0.06)' },
          { label:'LIVING', x:70, y:6, w:130, h:80, fillColor:'var(--alert-fill)' },
          { label:'Bed', x:6, y:48, w:60, h:60, fillColor:'rgba(31,42,68,0.06)' },
        ]} sensors={[
          { kind:'tx', label:'TX', x:100, y:50 },
          { label:'2', x:170, y:40, alert:true },
        ]} fall={{x:160, y:60}} />
        <div className="hand mt-4" style={{fontSize:12, color:'var(--alert)', fontWeight:700}}>
          FALL · Living room · 93%
        </div>
        <div className="tiny">RX2: 14× spike</div>
      </div>
    </StoryboardFrame>

    <StoryboardFrame n="5" title={`Resident: "I'm fine"`}>
      <div className="col center" style={{height:'100%', gap:10}}>
        <div className="hand text-center" style={{fontSize:12}}>
          Mom's tablet asks her —
        </div>
        <div className="btn ok" style={{width:130, height:130, borderRadius:'50%',
          fontSize:20, flexDirection:'column', fontFamily:'var(--hand)'}}>
          I'M FINE
          <div style={{fontSize:10, fontFamily:'var(--hand2)', fontWeight:400}}>tap to cancel</div>
        </div>
        <div className="hand2 text-center" style={{fontSize:11}}>
          → cascade pauses<br/>→ event logged
        </div>
      </div>
    </StoryboardFrame>

    <StoryboardFrame n="6" title="Evidence locker">
      <div className="col" style={{height:'100%', padding:4, gap:6}}>
        <div className="hand" style={{fontSize:12, fontWeight:700}}>Tue 3:14 pm</div>
        <Squiggle width={220} height={28} stroke="var(--alert)" spike/>
        <div className="hand2" style={{fontSize:11}}>RX2: 14× · RX1: 6×</div>
        <div className="row gap-4 mt-4">
          <div className="btn ok grow" style={{fontSize:11, padding:'2px 4px'}}>real</div>
          <div className="btn warn grow" style={{fontSize:11, padding:'2px 4px'}}>false</div>
        </div>
        <div className="hand text-center mt-4" style={{fontSize:11, color:'var(--accent)'}}>
          ↑ data flywheel
        </div>
      </div>
    </StoryboardFrame>

    <StoryboardFrame n="7" title="Activity over weeks">
      <div className="col" style={{height:'100%', padding:4, gap:6}}>
        <div className="hand" style={{fontSize:12, fontWeight:700}}>"And there's more…"</div>
        <Heatmap weeks={6} cols={5}/>
        <div className="box warn mt-4" style={{padding:4}}>
          <div className="hand" style={{fontSize:11}}>↓ kitchen activity 35%</div>
        </div>
        <div className="hand2 text-center mt-4" style={{fontSize:10, color:'var(--ink-soft)'}}>
          Long-term value<br/>beyond falls.
        </div>
      </div>
    </StoryboardFrame>
  </div>
);

window.StoryboardScreen = Storyboard;
