// SCREEN 6: Notifications & contacts setup

const NotifV1_RuleMatrix = () => (
  <Phone wide>
    <div className="hand mb-8" style={{fontSize:17, fontWeight:700}}>Who gets pinged?</div>
    <div className="lbl mb-4">Rule grid</div>
    <div className="box" style={{padding:0, overflow:'hidden', fontSize:10}}>
      <div className="row" style={{borderBottom:'1.5px solid var(--ink)', background:'rgba(31,42,68,0.05)'}}>
        <div style={{flex:1.4, padding:'4px 6px', fontFamily:'var(--mono)'}}>event</div>
        {['push','sms','call'].map(c=>(
          <div key={c} style={{flex:1, padding:'4px 6px', fontFamily:'var(--mono)', textAlign:'center'}}>{c}</div>
        ))}
      </div>
      {[
        { e:'Confirmed fall',  v:[2,2,2], c:'alert' },
        { e:'Suspected fall',  v:[2,1,0] },
        { e:'No motion 8h',    v:[1,0,0] },
        { e:'Sensor offline',  v:[1,0,0] },
        { e:'Weekly digest',   v:[1,0,0], c:'ok' },
      ].map((r,i)=>(
        <div key={i} className="row" style={{borderBottom:'1px solid var(--ink-faint)', alignItems:'center'}}>
          <div style={{flex:1.4, padding:'5px 6px'}}>
            <div className="hand" style={{fontSize:12}}>{r.e}</div>
          </div>
          {r.v.map((v,j)=>(
            <div key={j} style={{flex:1, padding:'5px 6px', textAlign:'center'}}>
              {v===2 ? <span className="pill alert" style={{fontSize:9, padding:'0 4px'}}>all</span>
               : v===1 ? <span className="pill ok" style={{fontSize:9, padding:'0 4px'}}>S</span>
               : <span className="tiny">—</span>}
            </div>
          ))}
        </div>
      ))}
    </div>
    <div className="lbl mt-12 mb-4">Quiet hours · 10 pm – 7 am</div>
    <div className="box" style={{padding:6}}>
      <div className="hand" style={{fontSize:12}}>Override only for: <span className="hl-red">confirmed fall</span></div>
    </div>
    <div className="row gap-6 mt-8">
      <div className="btn grow" style={{fontSize:12}}>Test push</div>
      <div className="btn grow" style={{fontSize:12}}>Test SMS</div>
    </div>
    <Note color="#fde2c8" style={{ top:60, right:-70, fontSize:11 }}>
      Power-user grid
    </Note>
  </Phone>
);

const NotifV2_ContactCascade = () => (
  <Phone>
    <div className="hand mb-4" style={{fontSize:18, fontWeight:700}}>Cascade</div>
    <div className="hand2 mb-8" style={{fontSize:12, color:'var(--ink-soft)'}}>
      For confirmed fall — try in order:
    </div>
    <div className="col gap-8" style={{flex:1}}>
      {[
        { o:1, n:'Sarah (daughter)', r:'primary',  d:'@ 0:00 · push + call' },
        { o:2, n:'James (son)',      r:'secondary',d:'@ 1:00 · push + call' },
        { o:3, n:'Pat (neighbor)',   r:'backup',   d:'@ 2:00 · sms' },
        { o:4, n:'911',              r:'emergency',d:'@ 5:00 · auto-dial', danger:true },
      ].map((c,i)=>(
        <div key={i} className={`box ${c.danger?'alert':''}`} style={{padding:8}}>
          <div className="row gap-8" style={{alignItems:'center'}}>
            <div style={{width:26, height:26, borderRadius:'50%', border:'2px solid var(--ink)',
              display:'flex',alignItems:'center',justifyContent:'center', fontFamily:'var(--mono)',
              fontWeight:700}}>{c.o}</div>
            <div className="col grow">
              <div className="hand" style={{fontSize:14, fontWeight:700}}>{c.n}</div>
              <div className="tiny">{c.r}</div>
            </div>
            <span className="hand2" style={{fontSize:14}}>⋮⋮</span>
          </div>
          <div className="hand2 mt-4" style={{fontSize:11, color:'var(--ink-soft)'}}>{c.d}</div>
        </div>
      ))}
    </div>
    <div className="btn full mt-8" style={{fontSize:13}}>+ Add contact</div>
    <Note color="#d8e0f0" style={{ top:60, right:-80, fontSize:11 }}>
      Drag to reorder<br/>cascade.
    </Note>
  </Phone>
);

const NotifV3_TogglesSimple = () => (
  <Phone>
    <div className="hand mb-8" style={{fontSize:18, fontWeight:700}}>Notifications</div>
    <div className="lbl mb-4">When something happens</div>
    <div className="col gap-6 mb-12">
      {[
        { t:'Confirmed fall', s:'high priority · breaks DND', on:true,  c:'alert' },
        { t:'Suspected fall', s:'low confidence',             on:true },
        { t:'No motion 8h',   s:'inactivity warning',         on:true },
        { t:'Sensor offline', s:'30 min threshold',           on:false },
        { t:'Weekly digest',  s:'every Sunday morning',       on:true,  c:'ok' },
      ].map((r,i)=>(
        <div key={i} className={`box ${r.c||''}`} style={{padding:6}}>
          <div className="between">
            <div className="col">
              <div className="hand" style={{fontSize:13, fontWeight:700}}>{r.t}</div>
              <div className="tiny">{r.s}</div>
            </div>
            {/* sketchy toggle */}
            <div style={{width:40,height:22,borderRadius:11,
              border:'2px solid var(--ink)',
              background: r.on ? 'var(--ok-fill)' : 'transparent',
              position:'relative', filter:'url(#sketchy)'}}>
              <div style={{width:14,height:14, background:'var(--ink)', borderRadius:'50%',
                position:'absolute', top:2, left: r.on?20:2}}/>
            </div>
          </div>
        </div>
      ))}
    </div>
    <div className="lbl mb-4">Channels</div>
    <div className="row gap-6">
      <div className="pill ok">push ✓</div>
      <div className="pill ok">sms ✓</div>
      <div className="pill">email</div>
      <div className="pill">call</div>
    </div>
    <div className="grow"></div>
    <TabBar active="Notif" />
  </Phone>
);

const NotifV4_ScenarioPresets = () => (
  <Phone>
    <div className="hand mb-4" style={{fontSize:18, fontWeight:700}}>Pick a preset</div>
    <div className="hand2 mb-12" style={{fontSize:12, color:'var(--ink-soft)'}}>You can fine-tune later.</div>
    <div className="col gap-8" style={{flex:1}}>
      {[
        { n:'Sensitive', s:'Ping me on anything · best for high-risk', c:'alert', sel:false },
        { n:'Standard',  s:'Confirmed events only · most caregivers', c:'ok', sel:true },
        { n:'Minimal',   s:'Just the weekly digest + emergencies', c:'', sel:false },
        { n:'Custom',    s:'Build it from scratch', c:'accent', sel:false },
      ].map((p,i)=>(
        <div key={i} className={`box ${p.c} ${p.sel?'pulse-red':''}`}
          style={{padding:10, position:'relative'}}>
          <div className="between">
            <div className="col">
              <div className="hand" style={{fontSize:16, fontWeight:700}}>{p.n}</div>
              <div className="hand2" style={{fontSize:12}}>{p.s}</div>
            </div>
            {p.sel && <span className="check hand" style={{color:'var(--ok)', fontSize:18}}>✓</span>}
          </div>
        </div>
      ))}
    </div>
    <div className="btn primary full mt-8" style={{fontSize:14}}>Use Standard</div>
    <Note color="#c8e8d4" style={{ top:50, right:-70, fontSize:11 }}>
      One-tap setup<br/>for anxious users
    </Note>
  </Phone>
);

const NotifV5_AlertSimulator = () => (
  <Phone>
    <div className="hand mb-4" style={{fontSize:18, fontWeight:700}}>Test it now</div>
    <div className="hand2 mb-12" style={{fontSize:12, color:'var(--ink-soft)'}}>
      What an alert will feel like at 3 am.
    </div>
    <div className="box-dashed center" style={{flex:1, flexDirection:'column', gap:14, padding:14}}>
      {/* mini phone preview */}
      <div style={{width:130, height:200, border:'2px solid var(--ink)', borderRadius:18,
        background:'rgba(31,42,68,0.06)', position:'relative', filter:'url(#sketchy)'}}>
        <div style={{position:'absolute', top:6, left:'50%', transform:'translateX(-50%)',
          width:30, height:6, background:'var(--ink)', borderRadius:3}}/>
        <div className="box alert" style={{margin:'30px 8px 8px', padding:6}}>
          <div className="lbl" style={{fontSize:9, color:'var(--alert)'}}>FALL · DEMO</div>
          <div className="hand" style={{fontSize:11, marginTop:2}}>Mom · Living rm</div>
          <div className="row gap-4 mt-4">
            <div style={{flex:1, height:14, background:'var(--alert)', borderRadius:7}}/>
            <div style={{flex:1, height:14, background:'var(--paper)',
              border:'1px solid var(--ink)', borderRadius:7}}/>
          </div>
        </div>
      </div>
      <div className="hand2" style={{fontSize:12, textAlign:'center'}}>
        Sound: <span className="hl-blue">"Soft Chime"</span><br/>
        Vibration: <span className="hl-blue">"Short-Long"</span>
      </div>
    </div>
    <div className="col gap-6 mt-8">
      <div className="btn primary full" style={{fontSize:14}}>🔔 Send test alert</div>
      <div className="row gap-6">
        <div className="btn grow" style={{fontSize:12}}>Change sound</div>
        <div className="btn grow" style={{fontSize:12}}>Change buzz</div>
      </div>
    </div>
  </Phone>
);

window.NotifScreens = {
  NotifV1_RuleMatrix, NotifV2_ContactCascade, NotifV3_TogglesSimple,
  NotifV4_ScenarioPresets, NotifV5_AlertSimulator,
};
