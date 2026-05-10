// SCREEN 5: Activity / presence trends — longitudinal view
const ActivityV1_24hStrips = () => (
  <Phone>
    <div className="between mb-4">
      <div className="hand" style={{fontSize:18, fontWeight:700}}>Activity</div>
      <span className="hand2" style={{fontSize:11}}>this week</span>
    </div>
    <div className="hand2 mb-8" style={{fontSize:11, color:'var(--ink-soft)'}}>Each row = a day. Colors = which room.</div>
    <div className="col gap-6">
      {['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((d,i) => (
        <div key={d} className="row gap-6" style={{alignItems:'center'}}>
          <span className="mono" style={{width:26}}>{d}</span>
          <div style={{flex:1}}>
            <DayStrip bands={[
              { color:'var(--accent)', w:25+i, opacity:0.5 },
              { color:'var(--warn-fill)', w:6 },
              { color:'transparent', w:8 },
              { color:'var(--ok-fill)', w:14+(i%3) },
              { color:'transparent', w:5 },
              { color:'var(--accent-fill)', w:18-(i%4) },
              { color:'var(--warn-fill)', w:4 },
              { color:'transparent', w:100 },
            ]} height={12}/>
          </div>
        </div>
      ))}
    </div>
    <div className="row between mt-4 mb-12">
      <span className="tiny">12a</span><span className="tiny">6a</span>
      <span className="tiny">12p</span><span className="tiny">6p</span><span className="tiny">12a</span>
    </div>
    <div className="row gap-6 mb-8" style={{flexWrap:'wrap',fontSize:10}}>
      <span className="pill"><span className="dot" style={{background:'var(--accent-fill)'}}/> Bed</span>
      <span className="pill"><span className="dot" style={{background:'var(--warn-fill)'}}/> Kit</span>
      <span className="pill"><span className="dot" style={{background:'var(--ok-fill)'}}/> Liv</span>
    </div>
    <TabBar active="More" />
  </Phone>
);

const ActivityV2_HeatmapCalendar = () => (
  <Phone>
    <div className="between mb-4">
      <div className="hand" style={{fontSize:18, fontWeight:700}}>8 weeks</div>
      <span className="hand2" style={{fontSize:11}}>activity intensity</span>
    </div>
    <div className="box mb-8" style={{padding:8}}><Heatmap weeks={8} cols={7}/></div>
    <div className="row gap-4 mb-8" style={{flexWrap:'wrap',fontSize:9}}>
      <span className="hand2" style={{fontSize:10}}>quiet</span>
      {['#e8dfc8','var(--ok-fill)','var(--accent-fill)','var(--warn-fill)'].map((c,i)=>(
        <div key={i} style={{width:14,height:10, background:c, border:'1px solid var(--ink-faint)'}}/>
      ))}
      <span className="hand2" style={{fontSize:10}}>busy</span>
    </div>
    <div className="lbl mb-4">Recent insights</div>
    <div className="col gap-6" style={{flex:1}}>
      <div className="box warn" style={{padding:6}}>
        <div className="hand" style={{fontSize:13}}>↓ 35% kitchen activity this week</div>
        <div className="tiny">vs. last 4-week avg</div>
      </div>
      <div className="box accent" style={{padding:6}}>
        <div className="hand" style={{fontSize:13}}>Sleep starts 1.2 h later</div>
        <div className="tiny">since Mar 1</div>
      </div>
    </div>
    <TabBar active="More" />
  </Phone>
);

const ActivityV3_AnomalyCards = () => (
  <Phone>
    <div className="between mb-8">
      <div className="hand" style={{fontSize:18, fontWeight:700}}>Insights</div>
      <span className="pill warn">3 new</span>
    </div>
    <div className="col gap-8" style={{flex:1}}>
      <div className="box warn" style={{padding:8}}>
        <div className="lbl" style={{color:'var(--warn)'}}>UNUSUAL · 2 days</div>
        <div className="hand mt-4" style={{fontSize:14}}>
          Mom's been in the bedroom <span className="hl-amber">11 h</span> today — 4 h more than typical Tue.
        </div>
        <div className="row gap-4 mt-6">
          <div className="btn" style={{fontSize:11, padding:'2px 6px'}}>Check in</div>
          <div className="btn" style={{fontSize:11, padding:'2px 6px'}}>Dismiss</div>
        </div>
      </div>
      <div className="box accent" style={{padding:8}}>
        <div className="lbl" style={{color:'var(--accent)'}}>PATTERN · 3 days</div>
        <div className="hand mt-4" style={{fontSize:14}}>
          Morning kitchen activity 45 min later than usual.
        </div>
        <Squiggle width={220} height={32} stroke="var(--accent)" spike/>
      </div>
      <div className="box ok" style={{padding:8}}>
        <div className="lbl" style={{color:'var(--ok)'}}>POSITIVE</div>
        <div className="hand mt-4" style={{fontSize:14}}>
          Sleep got 22 min more consistent this month. ✓
        </div>
      </div>
    </div>
    <TabBar active="More" />
  </Phone>
);

const ActivityV4_MultiMetricDashboard = () => (
  <Phone>
    <div className="hand mb-8" style={{fontSize:18, fontWeight:700}}>Mom · 30 days</div>
    <div className="row gap-6 mb-8">
      <div className="box grow text-center" style={{padding:6}}>
        <div className="title">7.2 h</div><div className="tiny">avg sleep</div>
        <Squiggle width={70} height={18} stroke="var(--accent)"/>
      </div>
      <div className="box grow text-center" style={{padding:6}}>
        <div className="title">4.1 k</div><div className="tiny">motion units</div>
        <Squiggle width={70} height={18} stroke="var(--ok)"/>
      </div>
    </div>
    <div className="row gap-6 mb-8">
      <div className="box grow text-center" style={{padding:6}}>
        <div className="title">3 ×</div><div className="tiny">kitchen visits/day</div>
      </div>
      <div className="box warn grow text-center" style={{padding:6}}>
        <div className="title" style={{color:'var(--warn)'}}>14</div><div className="tiny">false alerts</div>
      </div>
    </div>
    <div className="lbl mb-4">Daily timeline (last 14 days)</div>
    <div className="col gap-4">
      {Array.from({length:7}).map((_,i)=>(
        <div key={i} className="row gap-6" style={{alignItems:'center'}}>
          <span className="mono" style={{width:18}}>{i+1}</span>
          <Squiggle width={210} height={14} stroke="var(--ink-soft)" spike={i===2}/>
        </div>
      ))}
    </div>
    <div className="grow"></div>
    <TabBar active="More" />
  </Phone>
);

const ActivityV5_StoryDigest = () => (
  <Phone>
    <div className="lbl mb-4">WEEKLY DIGEST · MAR 4</div>
    <div className="title mb-8">Mom had a<br/>steady week.</div>
    <div className="col gap-8" style={{flex:1}}>
      <div className="hand" style={{fontSize:14, lineHeight:1.3}}>
        She was <span className="hl-green">up around 7 am</span> most days, kitchen by 7:30.
      </div>
      <div className="box-dashed" style={{padding:6}}>
        <Squiggle width={220} height={36} stroke="var(--accent)" spike/>
        <div className="tiny">wake-up times — pretty consistent</div>
      </div>
      <div className="hand" style={{fontSize:14, lineHeight:1.3}}>
        Two <span className="hl-amber">late nights</span> Wed and Sat — bed after 12:30.
      </div>
      <div className="hand" style={{fontSize:14, lineHeight:1.3}}>
        <span className="hl-red">One fall alert</span> Tue 3:14 pm. She was OK.
      </div>
      <div className="hand" style={{fontSize:14, lineHeight:1.3}}>
        Sensors all healthy. <span className="hl-green">No issues</span> this week.
      </div>
    </div>
    <div className="row gap-6 mt-8">
      <div className="btn grow" style={{fontSize:12}}>Share with doctor</div>
      <div className="btn grow" style={{fontSize:12}}>See data</div>
    </div>
    <Note color="#c8e8d4" style={{ top: 100, right: -80, fontSize:12 }}>
      Email-able<br/>weekly summary
    </Note>
  </Phone>
);

window.ActivityScreens = {
  ActivityV1_24hStrips, ActivityV2_HeatmapCalendar, ActivityV3_AnomalyCards,
  ActivityV4_MultiMetricDashboard, ActivityV5_StoryDigest,
};
