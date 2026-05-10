// SCREEN 1 (revised): Post-install — team handles physical setup, user lands here
// 4 variants of the "you're all set" / first-look dashboard

const PostInstallV1_AllSet = () => (
  <Phone>
    <div className="grow center" style={{flexDirection:'column', gap:14}}>
      <div style={{width:90, height:90, borderRadius:'50%',
        background:'var(--ok-fill)', border:'2.5px solid var(--ok)',
        display:'flex', alignItems:'center', justifyContent:'center',
        fontFamily:'var(--hand)', fontSize:48, color:'var(--ok)', filter:'url(#sketchy)'}}>
        ✓
      </div>
      <div className="title text-center" style={{fontSize:24}}>
        You're all set.
      </div>
      <div className="hand2 text-center" style={{fontSize:13, maxWidth:230, color:'var(--ink-soft)', lineHeight:1.3}}>
        Our team installed and calibrated 4 sensors at Mom's place. Everything's online.
      </div>
      <div className="box ok" style={{padding:8, marginTop:6}}>
        <div className="row gap-8">
          <div className="col" style={{alignItems:'center'}}>
            <span className="title" style={{fontSize:18}}>4/4</span>
            <span className="tiny">sensors</span>
          </div>
          <div style={{width:1, background:'var(--ok)'}}/>
          <div className="col" style={{alignItems:'center'}}>
            <span className="title" style={{fontSize:18}}>3</span>
            <span className="tiny">rooms</span>
          </div>
          <div style={{width:1, background:'var(--ok)'}}/>
          <div className="col" style={{alignItems:'center'}}>
            <span className="title" style={{fontSize:18}}>✓</span>
            <span className="tiny">calibrated</span>
          </div>
        </div>
      </div>
    </div>
    <div className="btn primary full" style={{fontSize:16}}>See the live map →</div>
    <Note color="#c8e8d4" style={{ top:60, right:-80, fontSize:12 }}>
      No DIY setup.<br/>Team handled it.
    </Note>
  </Phone>
);

const PostInstallV2_HereIsYourLayout = () => (
  <Phone>
    <div className="hand mb-4" style={{fontSize:20, fontWeight:700}}>Here's Mom's place</div>
    <div className="hand2 mb-8" style={{fontSize:12, color:'var(--ink-soft)'}}>
      Our installer set this up on Mar 1. Tap a sensor to learn more.
    </div>
    <div className="box" style={{padding:6, position:'relative'}}>
      <FloorPlan width={250} height={210} rooms={[
        { label:'Kitchen', x:6, y:6, w:100, h:80 },
        { label:'Living rm', x:108, y:6, w:138, h:120 },
        { label:'Bedroom', x:6, y:88, w:100, h:115 },
        { label:'Bath', x:108, y:128, w:60, h:75 },
        { label:'Hall', x:170, y:128, w:76, h:75 },
      ]} sensors={[
        { kind:'tx', label:'TX', x:130, y:60 },
        { label:'1', x:50, y:50 },
        { label:'2', x:200, y:60 },
        { label:'3', x:50, y:150 },
        { label:'4', x:215, y:170 },
      ]} />
      <Note style={{position:'absolute', bottom:6, right:-6, fontSize:11, padding:'2px 6px',
        transform:'rotate(2deg)'}}>
        all healthy ✓
      </Note>
    </div>
    <div className="lbl mt-12 mb-4">Next steps (optional)</div>
    <div className="col gap-4">
      <div className="box" style={{padding:6}}>
        <div className="hand" style={{fontSize:13}}>○ Add a 2nd caregiver</div>
      </div>
      <div className="box" style={{padding:6}}>
        <div className="hand" style={{fontSize:13}}>○ Send a test alert</div>
      </div>
    </div>
    <div className="btn primary full mt-8" style={{fontSize:14}}>Got it</div>
  </Phone>
);

const PostInstallV3_DashboardLanding = () => (
  <Phone>
    <div className="between mb-4">
      <div className="hand" style={{fontSize:18, fontWeight:700}}>Mom's place</div>
      <span className="pill ok">all quiet</span>
    </div>
    <div className="hand2 mb-8" style={{fontSize:11, color:'var(--ink-soft)'}}>
      In Living rm · last motion 14 min ago
    </div>
    <div className="box ok mb-8" style={{padding:8}}>
      <div className="hand" style={{fontSize:13, fontWeight:700}}>Welcome, Sarah 👋</div>
      <div className="hand2" style={{fontSize:11, marginTop:2}}>
        Setup is done. Here's the dashboard you'll use day-to-day.
      </div>
    </div>
    <div className="lbl mb-4">TODAY</div>
    <DayStrip bands={[
      { color:'var(--accent-fill)', w:30 },
      { color:'transparent', w:5 },
      { color:'var(--warn-fill)', w:10 },
      { color:'var(--ok-fill)', w:15 },
      { color:'transparent', w:40 },
    ]}/>
    <div className="row between mt-4 mb-12">
      <span className="tiny">12a</span><span className="tiny">12p</span><span className="tiny">12a</span>
    </div>
    <div className="row gap-6 mb-8">
      <div className="box ok grow text-center" style={{padding:6}}>
        <div className="title" style={{fontSize:18}}>4/4</div>
        <div className="tiny">sensors OK</div>
      </div>
      <div className="box grow text-center" style={{padding:6}}>
        <div className="title" style={{fontSize:18}}>0</div>
        <div className="tiny">alerts/wk</div>
      </div>
    </div>
    <div className="grow"></div>
    <TabBar active="Home" />
  </Phone>
);

const PostInstallV4_AddCaregivers = () => (
  <Phone>
    <div className="lbl mb-4">ONE LAST THING</div>
    <div className="title mb-8">Who else should<br/>get alerts?</div>
    <div className="hand2 mb-12" style={{fontSize:12, color:'var(--ink-soft)'}}>
      Add anyone who should be notified if Mom falls.
    </div>
    <div className="col gap-6 mb-8">
      <div className="box ok" style={{padding:8}}>
        <div className="between">
          <div className="col">
            <div className="hand" style={{fontSize:14, fontWeight:700}}>Sarah (you)</div>
            <div className="tiny">primary · push + call</div>
          </div>
          <span className="check hand" style={{fontSize:14, color:'var(--ok)'}}>✓</span>
        </div>
      </div>
      <div className="box-dashed" style={{padding:8}}>
        <div className="hand2" style={{fontSize:13, opacity:0.6}}>+ Add caregiver</div>
        <div className="tiny" style={{opacity:0.6}}>email or phone</div>
      </div>
      <div className="box-dashed" style={{padding:8}}>
        <div className="hand2" style={{fontSize:13, opacity:0.6}}>+ Add emergency contact</div>
        <div className="tiny" style={{opacity:0.6}}>called if no one else responds</div>
      </div>
    </div>
    <div className="grow"></div>
    <div className="btn full mb-4" style={{fontSize:13}}>Skip — just me for now</div>
    <div className="btn primary full" style={{fontSize:14}}>Done</div>
  </Phone>
);

window.OnboardingScreens = {
  PostInstallV1_AllSet,
  PostInstallV2_HereIsYourLayout,
  PostInstallV3_DashboardLanding,
  PostInstallV4_AddCaregivers,
};
