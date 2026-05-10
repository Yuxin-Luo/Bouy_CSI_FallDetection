# CSI Home-Sensing Frontend — Design Write-up

A design exploration for the user-facing app that sits on top of your CSI (Channel State Information) sensing pipeline. The backend is the Python dashboard reading from one TX and N RX ESP32 boards over USB serial; the frontend is what a resident, caregiver, or hackathon judge actually looks at.

The goal of this document is to give you a clear picture of *what screens exist, what they show, and how they fit together* — including the apartment-map view you're excited about. Even though the demo will be a single room, I'm designing as if the product spans a whole apartment, because that's the more compelling pitch and the architecture decisions cascade from there.

**This is a mobile-first product.** The whole point of remote home-sensing is that the caregiver isn't at the home. They're at work, at the grocery store, on a flight, in another time zone. The phone is where the alert lands, where the check-in happens, and where 90% of usage will live. The desktop/web view exists, but it's the secondary surface — used for setup, deep diagnostics, and weekly review. Every design decision below assumes a phone screen first and scales up from there.

---

## 1. Overall philosophy

Three principles I'd anchor on, because they shape every screen:

**Calm by default, urgent when needed.** 95% of the time the system is showing "everything's fine, nothing happened" — and that view should feel reassuring, not anxious (no flashing red dots, no fake metrics). When a fall happens, the UI should *break that calm decisively* — full-screen takeover, audible cue, unmissable. The asymmetry is the whole point of fall-detection UX.

**Spatial first, list second.** The pitch is "we know what's happening *in your home*." The map should be the headline view, not a footer afterthought — it's what makes this feel different from a wearable or a generic alert app.

**Privacy as a feature.** No cameras. No microphones. WiFi-only. This is an actual differentiator over Ring/Nest-style monitoring and worth surfacing on the login screen, the about page, and anywhere a caregiver might pause to wonder "is this watching grandma?".

**Designed for the pocket.** The caregiver is not sitting in front of the dashboard. They're commuting, in a meeting, asleep across town. Information density on the phone has to be ruthless: one glance answers "is everything okay?" Anything more requires a tap. Push notifications and lock-screen previews carry as much load as the in-app screens themselves.

---

## 2. Information architecture

Top-level navigation, in roughly the order they'd appear in the sidebar or tab bar:

- **Home** — at-a-glance status, today's timeline, latest alerts
- **Map** — live apartment view (the headline)
- **Activity** — historical timeline, presence trends, daily reports
- **Sensors** — device health, calibration, troubleshooting
- **Alerts** — current and past fall/anomaly events with evidence
- **Notifications & Contacts** — who gets pinged for what, when
- **Settings** — profile, household, account, privacy, export

Roles to support from day one (even if v1 only ships one):

- **Resident** — the person being monitored. Sees a simplified, less-noisy view. Can dismiss false alarms, mute non-critical alerts.
- **Caregiver** — adult child, spouse, professional aide. Sees full dashboard, configures alerts, can be one of multiple caregivers per household.
- **Admin** (optional) — for multi-residence settings like assisted-living facilities. Skip for hackathon.

---

## 3. Login & onboarding

**Auth screen.** Email + password, plus SSO (Google, Apple). Multi-factor for caregiver accounts because they receive emergency alerts and you don't want a hijacked account silencing fall notifications. Forgot-password flow is standard. The login screen is also the first place to plant the privacy message — a small "WiFi-only sensing — no cameras, no mics" line under the logo does a lot of work.

**First-run onboarding wizard.** This is where most of the configuration happens, and it should feel like a friendly setup, not a 12-step interrogation:

1. Create household — name (e.g. "Mom's place"), resident profile (name, age, any medical notes the caregiver wants the system to know about — kept private to the household).
2. Build the apartment layout — drag-and-drop rooms onto a canvas, name each one, set approximate dimensions in feet/meters. Pre-canned templates for "Studio," "1BR," "2BR" speed this up. The layout doesn't need to be architecturally precise — rough rectangles are fine and more usable than a CAD-perfect drawing.
3. Pair sensors — the app discovers connected ESP32s (over the Python dashboard's WebSocket bridge), shows them as unlabeled cards, and asks the user to physically tag each board with a sticker (RX1, RX2…) and drag it onto the floor plan to indicate where it lives. The TX board gets the same treatment but with a different icon.
4. Calibrate — a 60-second "empty room" recording. Step out, press start, wait. The system establishes a baseline variance per RX. This is what lets the active/still thresholds adapt to the specific home.
5. Add caregivers and contacts — invite by email, set notification preferences (more on this below).
6. Test alert — fire a fake fall event so the resident and caregiver both see what it looks like. Crucial for trust; people don't trust an alarm they've never heard.

The wizard should be skippable after step 1 ("set up later") for the impatient, but those steps are gates on the system being useful, so the home screen will keep nudging.

---

## 4. The apartment map (the headline view)

This is the screen that should make a judge lean forward. Build it well and the rest of the app feels like a polished afterthought.

**What's drawn on it.** A top-down floor plan, rooms as labeled rectangles. Each ESP32 board appears as an icon at its placed location:

- **TX board** — small antenna icon, with a faint pulsing ring to show it's broadcasting.
- **RX boards** — dot icons, one per receiver. Color-coded by health (green = healthy packet rate, yellow = degraded, red = offline).

Around each RX, an optional translucent disc shows its rough effective sensing range. Where discs overlap, you get *coverage diversity* — those overlap regions are where the system performs best, and showing them visually helps the user understand sensor placement.

**What's animated on it (live state).**

- **Presence indicator per room** — a soft "occupied" glow when motion is detected in that room, fading out over a few seconds when motion stops. Keep it subtle; it's ambient information, not a notification.
- **Inferred location of the resident** — a single human-figure icon that drifts to the room with strongest motion signal. CSI can't pinpoint coordinates, but it can localize to a room with reasonable confidence when sensors are spread out, and a slow-moving figure is more honest about uncertainty than a precise GPS-style dot.
- **"Which sensor saw it" trails** — when an event happens (fall, big motion spike), draw a brief light trail from the affected RX(s) to the event location, with line thickness indicating signal strength. This answers the *exact* question you raised: which sensor detected the fall, and how strongly. Trail fades after ~3 seconds.

**What happens when a fall is detected.**

The map shifts decisively into alert mode: the room of the fall pulses red, the RX(s) that triggered get bright outlines, a marker appears at the inferred fall location, and a card slides up from the bottom with the timeline of the last 10 seconds and an "Acknowledge / False alarm / Call resident" set of buttons. The resident's avatar on the map collapses to a "lying down" pose. Other rooms gray out so the eye is forced to the event.

**Interactions on the map.**

- Click a sensor → side panel with that sensor's details (variance graph, RSSI, packet rate, last calibration).
- Click a room → that room's recent activity timeline (last 24 hours of presence/motion).
- Drag a sensor → reposition (with a confirmation step, since calibration assumes fixed placement).
- Toggle layers — coverage discs, motion heatmap, sensor labels, room dimensions. Power users can declutter to taste.

**Single-room demo path.** For the hackathon: render the same map UI but with one labeled room and one TX + N RX. The richer features (multi-room presence, room-to-room movement) gracefully no-op. The visual story still lands — judges see "this is the platform; today's demo is one room; you can see how it scales."

**Implementation notes.** SVG with React state-driven updates is more than enough for the scale (handful of rooms, handful of sensors). Live updates come via a WebSocket from the Python dashboard pushing variance/event events. A library like `react-floor-plan` or a hand-rolled SVG layer both work; rolling your own gives full control over the trail/pulse animations, which are what make the screen feel alive.

---

## 5. Home / status dashboard

Default landing screen for caregivers. The "calm by default" view.

A large card up top with the high-level state: *"Mom is in the living room. Last activity: 14 minutes ago. All sensors healthy."* Beneath it, a row of three smaller cards:

- **Today's timeline** — horizontal strip showing room-by-room presence over the last 24 hours, like a sleep tracker but for rooms. Time of last meal-prep activity (kitchen presence), bed time (bedroom presence overnight), morning wake.
- **Recent alerts** — most recent fall/anomaly events with status (acknowledged, dismissed, escalated). Empty state is positive: "No alerts in the last 7 days. ✓"
- **Sensor health summary** — N of N online, packet rate average, last calibration date.

A secondary card below highlights *trends* — comparing today's activity pattern to the baseline established over the prior weeks. "Mom has been in the bedroom for 11 hours today, which is 4 hours more than her typical Tuesday." This is where the system earns its keep beyond falls — it surfaces *gradual* changes that nobody would notice from a single day's data.

---

## 6. Sensors / devices view

For when something's wrong with the hardware. A list view with one card per RX (and one for the TX), each showing:

- Name, location on map (clickable thumbnail)
- Status pill: online / degraded / offline
- Live mini-graph: variance over the last 60 seconds, updating in real time
- Stats: packets/sec, RSSI mean, MAC, USB port path, firmware version
- Last calibration timestamp, with a "Recalibrate now" button
- Dropdown: restart, reflash firmware, remove, view diagnostics

Clicking through to a sensor detail page should expose the deeper diagnostics — full per-subcarrier amplitude plot, RSSI history, packet-loss timeline, channel info. This is the "I'm a power user / I want to debug why RX3 is flaky" view. It's also the view a hackathon judge with an EE background will dig into, so make it look real even if it's mostly read-only.

A diagnostic mode toggle lets you put the system into "calibration" — pause alerting, record a fresh empty-room baseline, write back the new thresholds.

---

## 7. Alerts (current and historical)

The alerts page is the *evidence locker* — every fall or anomaly event preserved with enough detail to review later, share with a doctor, or feed back into the model.

Each alert entry expands to show:

- **Timeline of the event** — the variance trace from each RX in the seconds before, during, and after the alert. This is the model's "evidence" for why it fired.
- **Which sensor(s) triggered** — with confidence scores. If RX2 saw a 12× variance spike and RX3 only saw 1.2×, that's diagnostic information.
- **Map snapshot** — the apartment view at the moment of the fall, with the trigger highlighted.
- **What happened next** — was the alert acknowledged by the resident within the cancellation window? Were caregivers contacted? Did anyone call?
- **Feedback buttons** — *Real fall* / *False alarm* / *Other (specify)*. This is the data flywheel: every confirmed/rejected alert becomes a labeled training example for the model.

An "export" option packages an alert as a PDF for a doctor or insurance claim — timeline, evidence, response log. Probably overkill for the hackathon but worth mentioning to judges as a roadmap item, because it grounds the product in real-world value.

---

## 8. Notifications & contacts

The most fiddly screen, but also the one caregivers will spend the most time on once it's set up.

**Contacts list.** Each contact is a row: name, phone, email, optional photo. Each can be assigned a *role* (primary caregiver, secondary, emergency, household) and an *escalation rank* (who gets called first, who gets called if the first doesn't respond).

**Notification rules.** Rules are organized per *event type* — fall, prolonged inactivity, missing morning routine, sensor offline, etc. — and per *channel*. The grid looks roughly like this in the UI:

| Event | Push | SMS | Email | Phone call |
|---|---|---|---|---|
| Confirmed fall | All caregivers | All | All | Primary, then secondary after 60s |
| Suspected fall (low confidence) | All | Primary only | — | — |
| Resident hasn't moved in 8 hrs | Primary | — | — | — |
| Sensor offline > 30 min | Primary | — | Primary | — |

The user sets thresholds and channels per row. Templates ("Sensitive setup," "Standard," "Minimal") let them start from a sane preset.

**Quiet hours.** Per-contact, with a hard override for high-severity events ("call me at 3am only if it's a real fall").

**Test buttons.** Every channel needs a "send test" button. Without this, nobody trusts the system, because nobody has felt what an alert is going to feel like.

**Resident-side check-in.** When a fall is detected, the resident's phone or in-home tablet shows a big "Are you okay?" prompt with a 30-second cancellation window. If they tap "I'm fine," the alert is downgraded; if they don't respond, it escalates. This is a critical UX detail for reducing false-alarm fatigue without putting lives at risk — without it, every dropped grocery bag becomes a 911 call.

---

## 9. Activity / presence detection view

The longitudinal view. Less urgent than alerts, but where the long-term value lives.

**Daily timeline.** A 24-hour horizontal strip per day, broken down by room with colored bands. Bedroom occupancy at night, kitchen activity in the morning, living room in the evening — patterns emerge over weeks, and any deviation pops visually.

**Activity heatmap.** A calendar view (like GitHub's contribution graph but for activity), where each day is colored by total motion volume. Light days stand out at a glance.

**Anomaly cards.** The system surfaces auto-detected deviations: "Mom's morning kitchen activity is 45 minutes later than typical for the past 3 days." These aren't alerts — they're *insights*. A caregiver scans them weekly, not constantly.

**Inferred activity classification.** Going beyond presence — labeling intervals as walking, sitting still, sleeping, stationary, possibly even sleep quality (via breathing-band CSI energy). Be honest about confidence; tag uncertain classifications with "likely" rather than asserting them.

**Multi-resident caveat.** CSI generally can't tell two people apart in the same room — it sees motion energy, not identity. Be explicit in the UI when there's ambiguity ("Activity detected in living room — could be one or more people"). Pretending otherwise will erode trust the moment the resident has a guest over.

---

## 10. Settings

Standard but worth listing for completeness:

- **Profile** — your account info, password, MFA
- **Household** — residents, caregivers, transfer ownership
- **Apartment** — re-edit the floor plan, sensor positions, calibration history
- **Privacy** — data retention period (default 90 days, configurable), export all data, delete account, end-to-end encryption status. This page should be unusually transparent — list exactly what's collected, what's sent off-device, what's stored where. A privacy-forward product earns its keep on this page.
- **Integrations (future)** — connect to a smart-home hub, a medical-alert service, a doctor's portal
- **About** — version, firmware versions, hardware model, support links

---

## 11. Mobile-first design specifics

Since the phone is the primary surface, this section calls out the patterns that *only* matter on mobile and shouldn't be lost in the per-screen descriptions above.

**Navigation pattern.** Bottom tab bar on mobile (Home / Map / Alerts / Notifications / More) — five tabs max. The "More" drawer hides Sensors, Activity, Settings to keep the bar uncluttered. On tablet and desktop the same screens promote to a left sidebar. Use a single React codebase that responds to viewport, not separate apps.

**The lock-screen alert is the product.** When a fall fires, what the caregiver actually sees is a notification banner — likely on a watch face, lock screen, or pulled-down notification shade. That tiny rectangle has to do real work. It needs:

- A clear category label ("Fall detected") so it's recognizable in 200 ms.
- The room ("Living room") and resident's name ("Mom").
- Confidence band ("High confidence") so the caregiver can prioritize.
- Action buttons inline — "Call Mom," "View details," "Dismiss" — without opening the app.
- A distinctive sound. Don't reuse the default. Caregivers will mute the system if it sounds like spam, so the alert tone needs to be unique, urgent without being shrill, and not annoying enough to disable. iOS Critical Alerts permission and Android's high-priority channels both let you bypass Do Not Disturb for genuine emergencies — use them only for confirmed-fall events, not for every motion blip.

**The Map view on a phone.** The apartment map is your headline view, but it's challenging on a 6-inch screen. Two patterns to use:

- *Pinch-zoom and pan*, just like a real map, with snap-to-room when zoomed in close. The whole apartment fits when zoomed out.
- *Auto-focus on events*. When a fall fires, the map auto-zooms and centers on the affected room with the trail/pulse animation. Tap-to-zoom-out returns to the full view.

For one-room demos, the map collapses to a single room view that fills the screen — same component, just a different default zoom level.

**Live updates without burning the battery.** WebSockets stay open expensively on mobile. The app should:

- Use a WebSocket only when the app is in the foreground.
- Switch to push notifications via APNS/FCM when backgrounded — the server holds the open connection to the home gateway, the phone gets pinged only on real events.
- Reconnect aggressively when the app returns to foreground; users will frequently open the app *during* an alert to check status, and a stale connection at that moment is a trust killer.

**Glanceable widgets and the watch face.** The "calm" view of the system is small enough to be a home-screen widget — a single line: *"Mom — Living room — All quiet"*. The same content makes a great Apple Watch complication and Android quick-tile. People who never open the app will see the system every day this way. It's also where most of the system's positive feeling lives — the alerts are the rare exception; the steady "everything's fine" is the daily reassurance.

**Quick-actions and Live Activities.** On iOS, when an event is in progress (a fall has been detected, the cancellation window is counting down), use a Live Activity / Dynamic Island pattern — the countdown timer stays visible above the lock screen, with one-tap actions to escalate or dismiss. On Android, a persistent foreground notification serves the same purpose. This is the difference between "I missed the alert because I was driving" and "the countdown was right there on my screen the whole time."

**Offline and degraded states.** Phones drop signal. The app should:

- Cache the most recent state locally so opening the app shows *something* even with no connection.
- Visibly indicate stale data — a small "Last updated 14 minutes ago" line at the top, or a gentle gray-out of live elements.
- Queue actions (acknowledge, dismiss) for retry when reconnected, so a caregiver in a parking garage isn't blocked.
- Distinguish *"the phone is offline"* from *"the home gateway is offline"* — the second is much more alarming and needs its own clear messaging ("We can't reach Mom's sensors. They've been offline for 8 minutes.").

**One-handed use, day and night.** Caregivers will get alerts at 3 AM. Important controls — acknowledge, call, dismiss — need to live in the bottom third of the screen, where a thumb can reach without re-gripping. Dark mode is non-negotiable; any 3-AM screen that flashes white is a UX failure. Increase tap targets above the platform default (56pt minimum for emergency actions) so a sleepy or panicked tap doesn't miss.

**Multi-device handoff.** A caregiver might have multiple devices — phone, tablet, watch, web. When one device acknowledges an alert, every other device should reflect that immediately. Nothing erodes trust faster than dismissing a fall alert on your phone, then having your watch buzz with the same alert thirty seconds later because the state didn't sync.

**Permissions onboarding.** The app needs notification, microphone-free, location-free permissions. Keep the permission asks minimal and well-explained. Asking for notification permission before the user understands what notifications they'll get is the easiest way to get permanently denied. Ask in context, after onboarding, with a clear "we'll only ping you for [these specific events]" preface.

**Native vs. wrapped web.** For the hackathon, a responsive web app accessed via a browser is fast to build and demos fine — open it on the judge's phone. For production, you want native push notifications, native critical alerts, watch complications, Live Activities. A React Native or Expo build sharing logic with the web codebase is a sensible v1 path. A purely-web PWA is a workable interim — PWAs can do push notifications on Android and iOS 16+, though iOS still has limits on critical alerts that mean a wrapped or native build is needed for true production reliability.

**Resident-side mobile.** The resident also has a phone (or a wall-mounted tablet they actually use). Their app is much simpler:

- Big "I'm fine" button when an alert is firing, with the cancellation countdown.
- Otherwise, a single screen showing a friendly status message and a "call my caregiver" button.
- Optional: a "step out" button so when they leave the apartment, the system suspends alerts until they return — prevents the "Mom went to the store, sensors saw nothing for 4 hours, app fired an inactivity alert" failure mode.

Don't make the resident interface complicated. The whole point is that they shouldn't have to think about the system unless something's wrong.

---

## 12. Cool-but-optional ideas worth pitching

A few features I'd hold for "v2" slides at the end of the demo to leave judges wanting more:

- **Smart-home triggers.** When a fall is detected, automatically turn on the lights in that room, unlock the front door for paramedics, pause the TV — via Home Assistant or a similar bridge.
- **Voice-free check-in via wearable.** Pair with an Apple Watch or similar — a haptic tap on the wrist when an alert fires, button to confirm "I'm fine" without needing to reach a phone.
- **Doctor-shareable weekly digest.** Auto-generated PDF: presence patterns, anomalies, fall events, activity trends. Email-ready to a clinician.
- **Sleep quality dashboard.** If breathing-band CSI is stable enough, infer sleep stages and surface a sleep score. (Risky claim — only ship if the data backs it up.)
- **Multi-home view.** For caregivers monitoring multiple residences — siblings, parents in different cities — a portfolio view of all their households.
- **Voice or natural-language search of activity.** "When did Mom last leave the house?" — a small LLM over the activity log answers.

---

## 13. Tech stack suggestion

For a working mobile-first frontend on a hackathon timeline:

- **React Native (Expo) + TypeScript** for the mobile app. Expo gives you push notifications, builds to both iOS and Android, and supports OTA updates so you can fix things mid-demo. If "native build infrastructure" sounds like a hackathon trap, fall back to a **responsive React PWA** built with Vite and Tailwind — lower native fidelity but ships in hours, and works on whichever phone a judge hands you.
- **Tailwind (NativeWind on RN)** for styling — same utility classes work on web and native.
- **Recharts (web) / Victory Native (RN)** for the variance/timeline graphs.
- **Custom SVG (`react-native-svg` on RN)** for the apartment map. Plays nice with pinch-zoom gesture libraries on mobile.
- **WebSocket bridge** from your Python dashboard pushing live events. Use FastAPI on the Python side; it's a 30-line addition to what you already have. Pair with a small relay server (a free Render or Railway instance) that holds the persistent connection and fans out push notifications via APNS/FCM, so the phone doesn't need to keep a socket open in the background.
- **Push notifications** via **Expo Notifications** (wraps APNS + FCM). Configure the iOS Critical Alerts entitlement for confirmed-fall events.
- **Auth via Supabase or Clerk** — both have native mobile SDKs, MFA, and role management out of the box.
- **Zustand or Jotai** for state (Redux is overkill for this scope).
- **MMKV or AsyncStorage** for the local cache that backs the offline state.

Single codebase, deploy the web build to Vercel, the mobile build via Expo's QR-code OTA so a judge can scan it on their own phone during the demo. The whole frontend is realistically 4–6 days of focused work for a competent React/RN developer if the API contract with the backend is settled early.

---

## 14. Demo-day storyboard

Tying it all together — what you walk a judge through, in order. Hand them a phone running the app at the start; this is a mobile product.

1. **Lock-screen pitch.** Hand a judge a phone with the app installed. Their lock screen shows the app's "calm" widget: *"Mom — Living room — All quiet."* "We use WiFi sensing. No cameras, no mics. This is what 95% of your day looks like."
2. **Open the app to the Home tab.** Brief tour of today's timeline and recent alerts (empty state, which is the goal).
3. **Apartment map.** "Here's the layout. These four are our RX boards, that's the TX. Watch the presence indicator follow me as I walk." Physically walk through your demo room while the figure on the map moves on the judge's phone in real time.
4. **Trigger a fall on the demo mat.** *The judge's phone buzzes.* Lock screen shows the critical alert with "Call Mom / View / Dismiss" actions inline. They tap View — the app opens to a map zoomed on the affected room, mid-pulse. "RX2 saw a 14× variance spike, RX1 saw 6×. Classified at 93% confidence in under 2 seconds."
5. **Cancellation flow.** A second device — your phone, playing the resident — shows the big "I'm fine" check-in. "If the resident is fine, this cancels in the cancellation window. If not, the contact cascade fires." Optionally, with permission, drop the judge's phone number into the contacts list before the demo so a real test alert pings them at this step.
6. **Alert history.** Tap into the just-fired event. "Every event is logged with the variance trace, the responsible sensors, and feedback buttons so the model learns from real outcomes."
7. **Activity view.** "Over weeks, this is what we'd surface — gradual changes a caregiver wouldn't notice day-to-day."

Total demo: 4 minutes. Map and the live phone alert are the hook, fall trigger is the climax, activity view is the "and there's more" closer. The judge holding their own phone for the whole demo is what makes the product feel real instead of a slide deck.

---

## 15. What to build first (priorities)

If you can only ship a fraction of this for the hackathon, in order:

1. **Mobile-responsive web app** that opens cleanly on a phone — not a desktop dashboard pretending to be a phone app. Use a PWA so judges can "install" it from the browser.
2. **Apartment map with live sensor states and the fall-event animation.** *(headline)*
3. **Working fall alert path:** detect → push notification to phone → in-app display → cancellation window → log to history.
4. **Alert detail view** with the variance evidence and which sensors triggered.
5. **Sensor health page** (mostly read-only).
6. **Login + a single-household onboarding flow.**
7. **Notification preferences** — even if just "send to my email and one phone number" for the demo.

Skip for now: multi-home, activity classification beyond presence, doctor-share PDF, smart-home integrations, sleep quality, native iOS/Android builds with Critical Alerts. Mention them on a roadmap slide instead — they're cheap to talk about and expensive to build. The PWA + push-notification path gets you a believable mobile demo without burning days on App Store provisioning.
