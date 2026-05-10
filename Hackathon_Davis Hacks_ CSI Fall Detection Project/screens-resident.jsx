// SCREEN 7: Resident-side simple UI (the person being monitored)

const ResidentV1_AmbientStatus = () => (
  <Phone>
    <div className="grow center" style={{flexDirection:'column', gap:14}}>
      <div className="hand" style={{fontSize:14, color:'var(--ink-soft)'}}>Good afternoon, Margaret</div>
      <div style={{width:80, height:80, borderRadius:'50%',
        background:'var(--ok-fill)', border:'2.5px solid var(--ok)',
        display:'flex', alignItems:'center', justifyContent:'center',
        fontFamily:'var(--hand)', fontSize:40, color:'var(--ok)', filter:'url(#sketchy)'}}>
        ✓
      </div>
      <div className="title text-center" style={{fontSize:24, color:'var(--ok)'}}>
        All quiet
      </div>
      <div className="hand2 text-center" style={{fontSize:13, maxWidth:200, color:'var(--ink-soft)'}}>
        Sarah and James can see<br/>everything's OK.
      </div>
    </div>
    <div className="col gap-6">
      <div className="btn full" style={{fontSize:16, padding:'10px'}}>📞 Call Sarah</div>
      <div className="btn full" style={{fontSize:14}}>I'm going out for a bit</div>
    </div>
    <Note color="#c8e8d4" style={{ top:90, right:-70, fontSize:11 }}>
      Reassuring,<br/>not interactive
    </Note>
  </Phone>
);

const ResidentV2_ImFineCheckIn = () => (
  <Phone>
    <div className="col" style={{flex:1, background:'var(--alert-fill)',
      margin:-10, padding:18, justifyContent:'space-around'}}>
      <div className="text-center">
        <div className="lbl" style={{color:'var(--alert)', letterSpacing:2}}>WE NOTICED</div>
        <div className="title" style={{fontSize:30, color:'var(--alert)', marginTop:10, lineHeight:1.1}}>
          Are you OK,<br/>Margaret?
        </div>
      </div>
      {/* big tap button */}
      <div className="center">
        <div className="btn ok" style={{width:200, height:200, borderRadius:'50%',
          fontSize:30, fontFamily:'var(--hand)', flexDirection:'column'}}>
          I'M FINE
          <div style={{fontSize:13, fontFamily:'var(--hand2)', fontWeight:400, marginTop:4}}>
            tap to dismiss
          </div>
        </div>
      </div>
      <div className="col gap-6">
        <div className="text-center hand2" style={{fontSize:12}}>
          Otherwise we'll call Sarah in
        </div>
        <div className="text-center title" style={{fontSize:34, color:'var(--alert)'}}>
          0:21
        </div>
        <div className="btn alert full" style={{fontSize:16, padding:'8px'}}>I need help</div>
      </div>
    </div>
  </Phone>
);

const ResidentV3_BigButtonHome = () => (
  <Phone>
    <div className="hand text-center mb-8" style={{fontSize:14, color:'var(--ink-soft)'}}>
      Tuesday afternoon
    </div>
    <div className="col gap-8" style={{flex:1, justifyContent:'center'}}>
      <div className="btn ok full" style={{fontSize:24, padding:'24px 8px',
        flexDirection:'column', gap:4}}>
        📞
        <div>Call Sarah</div>
      </div>
      <div className="btn full" style={{fontSize:22, padding:'24px 8px',
        flexDirection:'column', gap:4}}>
        🚪
        <div>Going out</div>
      </div>
      <div className="btn alert full" style={{fontSize:22, padding:'24px 8px',
        flexDirection:'column', gap:4}}>
        ⚠
        <div>I need help</div>
      </div>
    </div>
    <div className="text-center tiny mt-8">Sensors: all OK · Wi-Fi: connected</div>
    <Note color="#fde2c8" style={{ top:30, right:-80, fontSize:11 }}>
      Senior-friendly<br/>tap targets
    </Note>
  </Phone>
);

const ResidentV4_TabletWallMount = () => (
  <Phone wide tall>
    <div className="row gap-12 mb-8" style={{alignItems:'baseline'}}>
      <div className="title" style={{fontSize:38}}>2:14<span style={{fontSize:18}}> pm</span></div>
      <div className="hand2" style={{fontSize:13, color:'var(--ink-soft)'}}>Tuesday · 72 °F</div>
    </div>
    <div className="hand" style={{fontSize:18, marginBottom:10}}>Hi Margaret 👋</div>
    {/* dashboard cards */}
    <div className="row gap-6 mb-8">
      <div className="box ok grow" style={{padding:8}}>
        <div className="lbl" style={{color:'var(--ok)'}}>STATUS</div>
        <div className="hand" style={{fontSize:14, marginTop:2}}>All quiet ✓</div>
      </div>
      <div className="box accent grow" style={{padding:8}}>
        <div className="lbl" style={{color:'var(--accent)'}}>SARAH</div>
        <div className="hand" style={{fontSize:14, marginTop:2}}>Last visit · Sun</div>
      </div>
    </div>
    <div className="box mb-8" style={{padding:8}}>
      <div className="lbl mb-4">Today's reminders</div>
      <div className="col gap-4">
        <div className="hand" style={{fontSize:13}}>○ 3:00 pm — meds</div>
        <div className="hand" style={{fontSize:13}}>○ 4:30 pm — call w/ Dr. Patel</div>
      </div>
    </div>
    <div className="row gap-6">
      <div className="btn ok grow" style={{fontSize:14}}>📞 Call Sarah</div>
      <div className="btn alert grow" style={{fontSize:14}}>Help</div>
    </div>
    <div className="grow"></div>
    <div className="text-center tiny">tap face for video call</div>
  </Phone>
);

const ResidentV5_StepOutSuspend = () => (
  <Phone>
    <div className="hand mb-4" style={{fontSize:18, fontWeight:700}}>Going out?</div>
    <div className="hand2 mb-8" style={{fontSize:12, color:'var(--ink-soft)'}}>
      I'll pause sensors so they don't<br/>alert Sarah for nothing.
    </div>
    {/* duration picker */}
    <div className="box mb-8" style={{padding:10}}>
      <div className="lbl mb-4">Suspend for</div>
      <div className="row gap-6" style={{flexWrap:'wrap'}}>
        {['30 min','1 h','2 h','4 h','til evening','custom'].map((o,i)=>(
          <div key={o} className={`btn ${i===2?'primary':''}`} style={{fontSize:12, padding:'4px 8px'}}>{o}</div>
        ))}
      </div>
    </div>
    <div className="box accent mb-8" style={{padding:10}}>
      <div className="lbl" style={{color:'var(--accent)'}}>WHILE YOU'RE OUT</div>
      <div className="hand mt-4" style={{fontSize:13}}>
        ✓ No false "no motion" alerts<br/>
        ✓ Sarah will see "Mom is out"<br/>
        ✓ Auto-resumes at the time you set
      </div>
    </div>
    <div className="grow"></div>
    <div className="btn ok full" style={{fontSize:18, padding:'12px'}}>Pause for 2 hours</div>
    <Note color="#d8e0f0" style={{ top:50, right:-70, fontSize:11 }}>
      Removes friction<br/>for normal life
    </Note>
  </Phone>
);

window.ResidentScreens = {
  ResidentV1_AmbientStatus, ResidentV2_ImFineCheckIn, ResidentV3_BigButtonHome,
  ResidentV4_TabletWallMount, ResidentV5_StepOutSuspend,
};
