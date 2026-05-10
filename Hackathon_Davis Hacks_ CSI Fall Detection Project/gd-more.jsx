// Buoy — More tab (Activity trends, Sensors, Settings)

const GDMoreScreen = () => (
  <div style={{ background: gdTokens.bg, fontFamily: gdTokens.sf,
    height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: '52px 20px 6px' }}>
      <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 0.4 }}>More</div>
    </div>

    <div style={{ padding: '10px 16px 16px', flex: 1 }}>
      {/* Activity highlights */}
      <GDSectionHeader title="Trends" action="Show all" />
      <GDCard>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8}}>
          <div style={{fontSize:17, fontWeight:600}}>Activity · 30 days</div>
          <div style={{fontSize:13, color:gdTokens.text3}}>vs prior 30</div>
        </div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:14}}>
          {[
            { l:'AVG SLEEP', v:'7.2h', d:'+12m', up:true },
            { l:'KITCHEN', v:'3.1×/d', d:'-35%', up:false, warn:true },
            { l:'STEPS-EQUIV', v:'4.1k', d:'+4%', up:true },
          ].map(s=>(
            <div key={s.l}>
              <div style={{fontSize:11, color:gdTokens.text3, fontWeight:600, letterSpacing:0.3}}>{s.l}</div>
              <div style={{fontSize:22, fontWeight:700, marginTop:2}}>{s.v}</div>
              <div style={{fontSize:12, fontWeight:600, marginTop:1,
                color: s.warn ? gdTokens.orange : (s.up ? '#1B7B3A' : gdTokens.text3)}}>{s.d}</div>
            </div>
          ))}
        </div>
        {/* heatmap */}
        <div style={{display:'grid', gridTemplateColumns:'repeat(15, 1fr)',
          gridAutoFlow:'column', gridTemplateRows:'repeat(7, 14px)', gap:3}}>
          {Array.from({length: 15*7}).map((_,i)=>{
            const v = Math.random();
            const c = v<0.2 ? '#EAEAF0' : v<0.45 ? '#CFE5D7' : v<0.75 ? '#9DD2B0' : '#34C759';
            return <div key={i} style={{background:c, borderRadius:3}}/>;
          })}
        </div>
        <div style={{display:'flex', justifyContent:'space-between', marginTop:6,
          fontSize:11, color:gdTokens.text3}}>
          <span>5 weeks ago</span><span>today</span>
        </div>
      </GDCard>

      <GDCard style={{padding:0, overflow:'hidden'}}>
        <div style={{padding:'14px 16px 6px',
          display:'flex',justifyContent:'space-between', alignItems:'center'}}>
          <div style={{fontSize:17, fontWeight:600}}>Insights</div>
          <GDPill kind="orange">3 new</GDPill>
        </div>
        {[
          { tag:'UNUSUAL', c:gdTokens.orange,
            t:'Mom\'s been in the bedroom 11h today — 4h more than typical Tuesday.' },
          { tag:'PATTERN', c:gdTokens.blue,
            t:'Morning kitchen activity 45 min later than usual, 3 days running.' },
          { tag:'POSITIVE', c:gdTokens.green,
            t:'Sleep got 22 min more consistent this month.' },
        ].map((row,i,arr)=>(
          <div key={i} style={{padding:'10px 16px',
            borderTop: '0.5px solid '+gdTokens.border}}>
            <div style={{fontSize:11, fontWeight:700, letterSpacing:0.4, color:row.c}}>{row.tag}</div>
            <div style={{fontSize:14, marginTop:2, lineHeight:1.35, color:gdTokens.text2}}>{row.t}</div>
          </div>
        ))}
      </GDCard>

      <GDSectionHeader title="Diagnostics" />
      <GDCard style={{padding:0, overflow:'hidden'}}>
        {[
          { i:'sensor.tag.radiowaves.forward', l:'Sensors', s:'4 of 4 healthy', c:gdTokens.green },
          { i:'wifi', l:'Connection', s:'Gateway online · 14 ms', c:gdTokens.green },
          { i:'heart.text.square.fill', l:'Evidence locker', s:'Variance traces · CSV export', c:gdTokens.blue },
          { i:'lock.shield.fill', l:'Privacy', s:'WiFi-only · no cameras / mics', c:gdTokens.indigo },
          { i:'gearshape.fill', l:'Settings', s:'Profile, household, account', c:gdTokens.text3 },
        ].map((r,i,arr)=>(
          <div key={r.l} style={{display:'flex', alignItems:'center', gap:12,
            padding:'12px 16px',
            borderTop: i===0 ? 'none' : '0.5px solid '+gdTokens.border}}>
            <div style={{width:32,height:32,borderRadius:8,
              background: r.c+'22',
              display:'flex',alignItems:'center',justifyContent:'center'}}>
              <GDSymbol name={r.i} size={18} color={r.c}/>
            </div>
            <div style={{flex:1, minWidth:0}}>
              <div style={{fontSize:15, fontWeight:500}}>{r.l}</div>
              <div style={{fontSize:13, color:gdTokens.text3}}>{r.s}</div>
            </div>
            <GDSymbol name="chevron.right" size={15} color={gdTokens.text4}/>
          </div>
        ))}
      </GDCard>

      <div style={{textAlign:'center', fontSize:12, color:gdTokens.text4,
        padding:'12px 0 4px', fontFamily:gdTokens.sfMono}}>
        Buoy · v0.4 · build 142
      </div>
    </div>

    <GDTabBar active="More" />
  </div>
);

window.GDMoreScreen = GDMoreScreen;
