// Buoy — Notify (contacts & rules) screen

const GDNotifyScreen = () => (
  <div style={{ background: gdTokens.bg, fontFamily: gdTokens.sf,
    height: '100%', overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
    <div style={{ padding: '52px 20px 6px' }}>
      <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: 0.4 }}>Notify</div>
      <div style={{ fontSize: 15, color: gdTokens.text3, marginTop: 2 }}>
        Who gets pinged · 3 contacts
      </div>
    </div>

    <div style={{ padding: '10px 16px 16px', flex: 1 }}>
      <GDSectionHeader title="Cascade" action="Edit" />
      <GDCard style={{ padding: 0, overflow: 'hidden' }}>
        {[
          { o:1, n:'Sarah (daughter)', r:'Primary · push + call', t:'@ 0:00', c:gdTokens.blue },
          { o:2, n:'James (son)',      r:'Secondary · push + call', t:'@ 1:00', c:gdTokens.indigo },
          { o:3, n:'Pat (neighbor)',   r:'Backup · SMS',           t:'@ 2:00', c:gdTokens.orange },
          { o:4, n:'911',              r:'Emergency · auto-dial',  t:'@ 5:00', c:gdTokens.red, danger:true },
        ].map((c,i,arr)=>(
          <div key={c.o} style={{display:'flex', alignItems:'center', gap:12,
            padding:'12px 16px',
            borderTop: i===0 ? 'none' : '0.5px solid '+gdTokens.border}}>
            <div style={{width:30,height:30,borderRadius:15,background:c.c,
              color:'white',fontWeight:700,fontSize:13,
              display:'flex',alignItems:'center',justifyContent:'center'}}>{c.o}</div>
            <div style={{flex:1, minWidth:0}}>
              <div style={{fontSize:15, fontWeight:600, color: c.danger?gdTokens.red:gdTokens.text}}>{c.n}</div>
              <div style={{fontSize:13, color:gdTokens.text3}}>{c.r}</div>
            </div>
            <div style={{fontSize:13, color:gdTokens.text3, fontFamily:gdTokens.sfMono}}>{c.t}</div>
          </div>
        ))}
        <div style={{padding:'12px 16px', borderTop:'0.5px solid '+gdTokens.border,
          display:'flex', alignItems:'center', gap:8, color:gdTokens.blue, fontSize:15, fontWeight:500}}>
          <GDSymbol name="plus" size={16} color={gdTokens.blue}/> Add contact
        </div>
      </GDCard>

      <GDSectionHeader title="Rules" />
      <GDCard style={{padding:0, overflow:'hidden'}}>
        {[
          { t:'Confirmed fall', s:'High priority · breaks DND', on:true,  c:'red' },
          { t:'Suspected fall', s:'Low confidence',             on:true,  c:'orange' },
          { t:'No motion 8h',   s:'Inactivity warning',         on:true,  c:'blue' },
          { t:'Sensor offline', s:'30 min threshold',           on:false },
          { t:'Weekly digest',  s:'Sunday morning',             on:true,  c:'green' },
        ].map((r,i,arr)=>(
          <div key={r.t} style={{display:'flex', alignItems:'center', gap:12,
            padding:'12px 16px',
            borderTop: i===0 ? 'none' : '0.5px solid '+gdTokens.border}}>
            <div style={{flex:1}}>
              <div style={{fontSize:15, fontWeight:500}}>{r.t}</div>
              <div style={{fontSize:13, color:gdTokens.text3}}>{r.s}</div>
            </div>
            {/* iOS toggle */}
            <div style={{width:51, height:31, borderRadius:16,
              background: r.on ? gdTokens.green : '#E9E9EB',
              position:'relative', transition:'background 0.2s',
              boxShadow: r.on ? 'none' : 'inset 0 0 0 0.5px rgba(0,0,0,0.04)'}}>
              <div style={{width:27, height:27, borderRadius:14, background:'white',
                position:'absolute', top:2, left: r.on?22:2,
                boxShadow:'0 3px 8px rgba(0,0,0,0.15), 0 1px 1px rgba(0,0,0,0.06)'}}/>
            </div>
          </div>
        ))}
      </GDCard>

      <GDSectionHeader title="Quiet hours" />
      <GDCard>
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
          <div>
            <div style={{fontSize:15, fontWeight:500}}>10:00 PM – 7:00 AM</div>
            <div style={{fontSize:13, color:gdTokens.text3, marginTop:2}}>
              Override only for confirmed falls
            </div>
          </div>
          <GDSymbol name="chevron.right" size={15} color={gdTokens.text4}/>
        </div>
      </GDCard>

      <GDSectionHeader title="Test" />
      <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:10}}>
        <GDCard style={{padding:14, marginBottom:0, textAlign:'center'}}>
          <GDSymbol name="bell.badge.fill" size={24} color={gdTokens.blue}/>
          <div style={{fontSize:14, fontWeight:600, marginTop:6, color:gdTokens.blue}}>Test push</div>
        </GDCard>
        <GDCard style={{padding:14, marginBottom:0, textAlign:'center'}}>
          <GDSymbol name="message.fill" size={24} color={gdTokens.green}/>
          <div style={{fontSize:14, fontWeight:600, marginTop:6, color:'#1B7B3A'}}>Test SMS</div>
        </GDCard>
      </div>
    </div>

    <GDTabBar active="Notify" />
  </div>
);

window.GDNotifyScreen = GDNotifyScreen;
