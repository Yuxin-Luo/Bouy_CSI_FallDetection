// SCREEN 3 (revised): Live fall alert — DUAL-SIDED moment
// Each variant shows the caregiver's phone + the resident's phone side-by-side
// to make it visually obvious that BOTH sides get the alert simultaneously,
// with 911 on both ends.

const DualFrame = ({ left, right, leftLabel, rightLabel, note }) => (
  <div className="paper" style={{ width: 720, height: 660, padding: 12, position: 'relative' }}>
    {/* lightning between phones */}
    <svg style={{position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none'}}>
      <path d="M 360 60 Q 360 200, 340 320 Q 380 440, 360 600"
        fill="none" stroke="var(--alert)" strokeWidth="2" strokeDasharray="6 5" filter="url(#sketchy-strong)" opacity="0.5"/>
    </svg>
    <div className="row gap-8 mb-8" style={{justifyContent:'space-around', alignItems:'baseline'}}>
      <div style={{flex:1, textAlign:'center'}}>
        <div className="lbl" style={{color:'var(--accent)'}}>{leftLabel}</div>
      </div>
      <div className="lbl" style={{color:'var(--alert)', fontSize:11}}>← SAME EVENT →</div>
      <div style={{flex:1, textAlign:'center'}}>
        <div className="lbl" style={{color:'var(--alert)'}}>{rightLabel}</div>
      </div>
    </div>
    <div className="row gap-12" style={{justifyContent:'center', alignItems:'flex-start'}}>
      <div>{left}</div>
      <div style={{paddingTop:60, position:'relative'}}>
        {/* central sync indicator */}
        <div className="col center" style={{gap:6, padding:'10px 0'}}>
          <div className="pill alert pulse-red">FALL DETECTED</div>
          <div className="hand2" style={{fontSize:11, textAlign:'center', maxWidth:120, color:'var(--ink-soft)'}}>
            Both phones buzz at the same moment
          </div>
          <div style={{fontSize:32, color:'var(--alert)', filter:'url(#sketchy-strong)'}}>⚡</div>
          <div className="mono" style={{fontSize:10, color:'var(--ink-soft)'}}>
            cancel<br/>window<br/>0:23
          </div>
        </div>
      </div>
      <div>{right}</div>
    </div>
    {note && (
      <Note style={{ bottom: 12, left: 16, fontSize: 12, transform: 'rotate(-1deg)' }}>{note}</Note>
    )}
  </div>
);

// V1: Lock-screen banner on caregiver vs. big "Are you OK" on resident
const FallV1_LockscreenSplit = () => {
  const caregiver = (
    <Phone>
      <div className="col" style={{flex:1, justifyContent:'space-between',
        background:'linear-gradient(180deg, rgba(31,42,68,0.05), rgba(31,42,68,0.15))',
        margin:-10, padding:14}}>
        <div className="text-center mt-12">
          <div className="title" style={{fontSize:42}}>9:41</div>
          <div className="hand" style={{fontSize:13}}>Tuesday</div>
        </div>
        <div className="col gap-8">
          <div className="box alert pulse-red" style={{padding:10}}>
            <div className="between">
              <span className="lbl" style={{color:'var(--alert)'}}>HOMECARE · FALL</span>
              <span className="tiny">now</span>
            </div>
            <div className="hand" style={{fontSize:15, marginTop:4, fontWeight:700}}>
              Mom may have fallen
            </div>
            <div className="hand2" style={{fontSize:12, marginTop:2}}>
              Living room · high confidence
            </div>
            <div className="row gap-4 mt-8">
              <div className="btn alert grow" style={{fontSize:12, padding:'4px 6px'}}>📞 Call Mom</div>
              <div className="btn grow" style={{fontSize:12, padding:'4px 6px'}}>View</div>
            </div>
            <div className="btn alert full mt-4" style={{fontSize:12, padding:'3px',
              background:'var(--paper)', color:'var(--alert)', borderColor:'var(--alert)'}}>📞 Call 911</div>
          </div>
          <div className="text-center tiny">slide up to dismiss</div>
        </div>
      </div>
    </Phone>
  );
  const resident = (
    <Phone>
      <div className="col" style={{flex:1, background:'var(--alert-fill)',
        margin:-10, padding:14, justifyContent:'space-around'}}>
        <div className="text-center">
          <div className="lbl" style={{color:'var(--alert)', letterSpacing:2}}>WE NOTICED</div>
          <div className="title" style={{fontSize:26, color:'var(--alert)', marginTop:6, lineHeight:1.1}}>
            Are you OK,<br/>Margaret?
          </div>
        </div>
        <div className="center">
          <div className="btn ok" style={{width:170, height:170, borderRadius:'50%',
            fontSize:24, fontFamily:'var(--hand)', flexDirection:'column'}}>
            I'M FINE
            <div style={{fontSize:11, fontFamily:'var(--hand2)', fontWeight:400}}>tap to cancel</div>
          </div>
        </div>
        <div className="col gap-6">
          <div className="text-center title" style={{fontSize:28, color:'var(--alert)'}}>0:23</div>
          <div className="btn alert full" style={{fontSize:15, padding:'8px'}}>📞 Call 911</div>
        </div>
      </div>
    </Phone>
  );
  return <DualFrame left={caregiver} right={resident}
    leftLabel="CAREGIVER · SARAH'S PHONE" rightLabel="RESIDENT · MOM'S PHONE"
    note="Same event. Two roles. One countdown ticking on both screens." />;
};

// V2: Map zoom + sheet on caregiver, fullscreen check-in on resident
const FallV2_MapAndCheckin = () => {
  const caregiver = (
    <Phone>
      <div className="lbl mb-4" style={{color:'var(--alert)'}}>FALL · LIVING RM · 0:23</div>
      <div className="box alert pulse-red" style={{padding:6, flex:'0 0 auto', position:'relative', marginBottom:8}}>
        <FloorPlan width={250} height={170} rooms={[
          { label:'Kit', x:6, y:6, w:80, h:50, fillColor:'rgba(31,42,68,0.06)' },
          { label:'LIVING', x:90, y:6, w:156, h:100, fillColor:'var(--alert-fill)' },
          { label:'Bed', x:6, y:58, w:80, h:106, fillColor:'rgba(31,42,68,0.06)' },
          { label:'Bath', x:90, y:108, w:70, h:56, fillColor:'rgba(31,42,68,0.06)' },
        ]} sensors={[
          { kind:'tx', label:'TX', x:130, y:50 },
          { label:'2', x:200, y:40, alert:true },
        ]} fall={{x:175, y:60}} />
      </div>
      <div className="title mb-4" style={{fontSize:18, color:'var(--alert)'}}>
        Mom fell in the<br/>Living room
      </div>
      <div className="tiny mb-8">RX2 saw 14× variance · 2s ago · 93% conf</div>
      <div className="col gap-6">
        <div className="btn alert full" style={{fontSize:15}}>📞 Call Mom</div>
        <div className="row gap-6">
          <div className="btn grow" style={{fontSize:12}}>View map</div>
          <div className="btn alert grow" style={{fontSize:12,
            background:'var(--paper)', color:'var(--alert)'}}>📞 911</div>
        </div>
      </div>
    </Phone>
  );
  const resident = (
    <Phone>
      <div className="col" style={{flex:1, background:'var(--alert-fill)',
        margin:-10, padding:14, justifyContent:'space-between'}}>
        <div className="text-center mt-8">
          <div className="lbl" style={{color:'var(--alert)'}}>SAFETY CHECK</div>
          <div className="title mt-4" style={{fontSize:24, color:'var(--alert)'}}>
            Did you fall,<br/>Margaret?
          </div>
          <div className="hand2 mt-4" style={{fontSize:13}}>
            We sensed something in the living room.
          </div>
        </div>
        <div className="col center gap-8">
          <div className="btn ok" style={{width:160, height:160, borderRadius:'50%',
            fontSize:22, fontFamily:'var(--hand)', flexDirection:'column'}}>
            I'M OK
          </div>
          <div className="hand2 text-center" style={{fontSize:11}}>
            Otherwise we'll call Sarah in
          </div>
          <div className="title" style={{fontSize:32, color:'var(--alert)'}}>0:23</div>
        </div>
        <div className="btn alert full" style={{fontSize:16, padding:'8px'}}>📞 Call 911</div>
      </div>
    </Phone>
  );
  return <DualFrame left={caregiver} right={resident}
    leftLabel="CAREGIVER VIEW" rightLabel="RESIDENT VIEW"
    note='Caregiver gets WHERE & HOW. Resident gets a single big tap. 911 on both sides.' />;
};

// V3: Watch / minimal on caregiver, tablet wall-mount on resident
const FallV3_GlanceableSplit = () => {
  const caregiver = (
    <Phone>
      <div className="grow center" style={{flexDirection:'column', gap:10}}>
        <div className="hand" style={{fontSize:13, color:'var(--ink-soft)'}}>watch · phone · all your devices</div>
        {/* watch face */}
        <div style={{width:160, height:200, border:'2.5px solid var(--ink)', borderRadius:36,
          padding:14, background:'var(--ink)', color:'var(--paper)',
          display:'flex', flexDirection:'column', justifyContent:'space-between',
          filter:'url(#sketchy)'}}>
          <div className="lbl" style={{color:'#ffb3b8', fontSize:9}}>HOMECARE</div>
          <div>
            <div className="hand" style={{color:'var(--paper)', fontSize:18, fontWeight:700, lineHeight:1.05}}>
              MOM<br/>FELL
            </div>
            <div className="hand2" style={{color:'#ffb3b8', fontSize:10, marginTop:2}}>Living rm · 0:23</div>
          </div>
          <div className="row gap-4">
            <div style={{flex:1, height:18, background:'var(--alert)', borderRadius:9,
              fontFamily:'var(--hand)', fontSize:10, color:'var(--paper)',
              display:'flex',alignItems:'center',justifyContent:'center'}}>Call</div>
            <div style={{flex:1, height:18, border:'1.5px solid var(--paper)', borderRadius:9,
              fontFamily:'var(--hand)', fontSize:10,
              display:'flex',alignItems:'center',justifyContent:'center'}}>911</div>
          </div>
        </div>
        <div className="hand2 text-center mt-4" style={{fontSize:12, maxWidth:200, color:'var(--ink-soft)'}}>
          Buzzes wrist · breaks DND · two-tap action.
        </div>
      </div>
    </Phone>
  );
  const resident = (
    <Phone wide>
      <div className="col" style={{flex:1, background:'var(--alert-fill)',
        margin:-10, padding:16, justifyContent:'space-between'}}>
        <div className="text-center">
          <div className="lbl" style={{color:'var(--alert)'}}>TABLET ON THE FRIDGE</div>
          <div className="title mt-6" style={{fontSize:32, color:'var(--alert)'}}>
            ARE YOU OK?
          </div>
        </div>
        <div className="row gap-8">
          <div className="btn ok grow" style={{fontSize:24, padding:'24px 8px',
            flexDirection:'column'}}>
            ✓<div>I'M FINE</div>
          </div>
          <div className="btn alert grow" style={{fontSize:24, padding:'24px 8px',
            flexDirection:'column'}}>
            !<div>HELP</div>
          </div>
        </div>
        <div className="col gap-4">
          <div className="text-center title" style={{fontSize:28, color:'var(--alert)'}}>0:23</div>
          <div className="btn alert full" style={{fontSize:18, padding:'10px'}}>📞 Call 911</div>
        </div>
      </div>
    </Phone>
  );
  return <DualFrame left={caregiver} right={resident}
    leftLabel="CAREGIVER · WATCH FACE" rightLabel="RESIDENT · WALL TABLET"
    note="Even on tiny screens, the alert lands. Resident's tablet gets giant fingertargets." />;
};

// V4: Detailed evidence card on caregiver, conversational on resident
const FallV4_RichVsGentle = () => {
  const caregiver = (
    <Phone>
      <div className="row between mb-4">
        <span className="pill alert pulse-red">FALL · 0:21</span>
        <span className="tiny">tap = play 10s</span>
      </div>
      <div className="title mb-8" style={{fontSize:20, color:'var(--alert)'}}>
        Mom · Living room
      </div>
      <div className="box alert" style={{padding:6, marginBottom:8}}>
        <FloorPlan width={235} height={100} rooms={[
          { label:'Kit', x:6, y:6, w:60, h:40 },
          { label:'LIVING', x:70, y:6, w:140, h:60, fillColor:'var(--alert-fill)' },
          { label:'Bed', x:6, y:48, w:60, h:46 },
        ]} sensors={[
          { kind:'tx', label:'TX', x:90, y:40 },
          { label:'2', x:170, y:30, alert:true },
        ]} fall={{x:160, y:50}} />
      </div>
      <div className="box mb-8" style={{padding:6}}>
        <div className="lbl mb-4">EVIDENCE</div>
        <div className="row gap-4" style={{alignItems:'center'}}>
          <span className="mono" style={{width:24, color:'var(--alert)'}}>RX2</span>
          <Squiggle width={150} height={20} stroke="var(--alert)" spike/>
          <span className="mono" style={{color:'var(--alert)'}}>14×</span>
        </div>
      </div>
      <div className="col gap-6">
        <div className="btn alert full" style={{fontSize:15}}>📞 Call Mom</div>
        <div className="row gap-6">
          <div className="btn grow" style={{fontSize:12}}>False alarm</div>
          <div className="btn alert grow" style={{fontSize:12,
            background:'var(--paper)', color:'var(--alert)'}}>📞 911</div>
        </div>
      </div>
    </Phone>
  );
  const resident = (
    <Phone>
      <div className="grow center" style={{flexDirection:'column', gap:14}}>
        <div className="hand text-center" style={{fontSize:18, lineHeight:1.2, maxWidth:240}}>
          Margaret —<br/>we noticed<br/><span className="hl-red">a sudden movement</span>.
        </div>
        <div className="hand2 text-center" style={{fontSize:13, color:'var(--ink-soft)'}}>
          Just checking in.
        </div>
        <div className="row gap-8 mt-4">
          <div className="btn ok" style={{width:120, height:120, borderRadius:60,
            fontSize:18, flexDirection:'column'}}>
            ✓<div style={{fontSize:13}}>All good</div>
          </div>
          <div className="btn alert" style={{width:120, height:120, borderRadius:60,
            fontSize:18, flexDirection:'column'}}>
            !<div style={{fontSize:13}}>Help</div>
          </div>
        </div>
      </div>
      <div className="col gap-4">
        <div className="text-center hand2" style={{fontSize:12}}>Calling Sarah in <b style={{color:'var(--alert)'}}>0:21</b></div>
        <div className="btn alert full" style={{fontSize:15, padding:'8px'}}>📞 Call 911</div>
      </div>
    </Phone>
  );
  return <DualFrame left={caregiver} right={resident}
    leftLabel="CAREGIVER · INVESTIGATE" rightLabel="RESIDENT · GENTLE PROMPT"
    note="Caregiver sees data; resident sees a calm question. Both have a 911 button." />;
};

window.AlertScreens = {
  FallV1_LockscreenSplit,
  FallV2_MapAndCheckin,
  FallV3_GlanceableSplit,
  FallV4_RichVsGentle,
};
window.DualFrame = DualFrame;
