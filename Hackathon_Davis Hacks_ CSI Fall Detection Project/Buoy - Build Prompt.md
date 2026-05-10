# Buoy — Frontend Build Prompt

> A handoff prompt for a coding agent (Claude Code, Cursor, etc.) to implement the **Buoy** caregiver iOS app from the wireframes + hi-fi mock in this project. Built on top of a CSI (Channel-State-Information) home-sensing platform that does fall detection and room-level presence without cameras or wearables.

---

## 1. Product in one paragraph

Buoy is the caregiver-facing iOS app for a CSI fall-detection system installed in an aging-in-place home. A small mesh of Wi-Fi sensors (1 TX broadcaster + 3 RX receivers) blankets the apartment; ML on the edge turns radio-variance into **room-level presence** and **fall events**. The app gives an adult child or care coordinator three things in priority order: (1) instant, dramatic fall alerts they can act on in under 10 seconds, (2) a calm "all is well" daily glance at where their parent is right now and how the day is going, and (3) a reviewable record of past incidents with sensor evidence so false alarms can be tuned out over time. The professional install means there is no setup wizard — the app opens straight into the dashboard.

## 2. Audience & tone

- **Primary user:** the adult child (40–65) of an older parent living alone. Not a developer. Anxious by default, scans before reading.
- **Secondary user:** professional care coordinator managing 5–20 residences.
- **Tone:** Apple Health meets a calm hospital chart. Reassuring greens when nothing is happening; urgent but un-panicked reds when something is. No exclamation marks in copy except in the active-fall headline. No emoji.

## 3. Visual system

Treat **Apple Health** as the north-star reference. Specifically:

- **White cards on a warm-gray app background**, generous whitespace, no heavy borders.
- **One accent color: iOS system blue `#0A84FF`.** Use it for the active tab, primary buttons, links, and the "person is here" highlight. Do not introduce a second brand color.
- **Status colors** are functional, not decorative: green `#34C759` = OK, red `#FF3B30` = active fall, orange `#FF9500` = warning / false-alarm tag, indigo `#5E5CE6` = bedroom presence band.
- **Typography:** SF Pro (system stack). Large titles 34/700 with 0.4 letter-spacing. Body 15/400. Section headers 22/700. Stat numbers 28/700, tabular-nums.
- **Cards:** 16px radius, 16px inner padding, very soft shadow `0 1px 2px rgba(0,0,0,0.04), 0 4px 12px rgba(0,0,0,0.03)`. Stack vertically with 12px gap.
- **Buttons:** 38–44px tall pill-shaped (`borderRadius: half-height`). Primary fill `#0A84FF` white text; secondary subtle gray fill `#F8F8FA` with blue text and a 0.5px hairline border.
- **Pills (status tags):** 10px radius, 13/600 text, tinted background + matching darker text — e.g. `bg #E8F8EC, fg #1B7B3A` for green.
- **Hairlines:** `0.5px solid rgba(60,60,67,0.10)` for separators inside cards.
- **No gradients, no glassmorphism inside cards** (the iOS frame's status bar/tab bar is the only place blur appears).
- **Iconography:** SF-Symbols-style line icons drawn as inline SVG, ~17–22px in body, 26px in tab bar.

The visual rule: **the app should look like it ships from Cupertino, not from a startup.** When in doubt, copy what Apple Fitness or Health does and don't invent.

## 4. Information architecture

Five tabs in the bottom tab bar, in this order, with the bell badged when there's an unread alert:

| Tab        | Purpose                                                              |
|------------|----------------------------------------------------------------------|
| **Home**   | "Is mom OK right now?" — current room, today's activity, no-news-is-good-news. |
| **Map**    | Top-down floor plan with live presence dot, sensor health, layer chips. |
| **Alerts** | Active fall card (when present) + reviewable history with sensor traces. |
| **Notify** | Who gets pinged for what. Caregiver list + escalation rules.         |
| **More**   | Resident profile, sensor diagnostics, sharing, settings.             |

There is **no onboarding flow** — sensors are professionally installed. First-launch lands directly on Home.

## 5. Screen-by-screen spec

### 5.1 Home — "Mom's place"

- **Top:** small `HOME` eyebrow + 28/700 "Mom's place" title, avatar circle on the right.
- **Hero card:**
  - Pulsing 8px green dot + caps eyebrow `ALL QUIET · UPDATED 12 SEC AGO`.
  - 28/700 headline: `Mom is in the / living room` — "living room" in blue.
  - Sub: `Last motion 14 minutes ago · arrived 3:01 pm`.
  - Inline mini floor plan (220×160 SVG, 5 rooms, sensor dots, blue presence dot in active room).
  - Two equal-width pills: primary blue `Call Mom` (phone icon) + secondary `Open map` (map icon).
- **Today section** (header 22/700 + "See all" link in blue):
  - Card titled "Room presence". 24h horizontal stacked band (12px tall, rounded ends) with bedroom indigo / kitchen orange / living blue / other gray. Time axis underneath: `12a 6a 12p 6p 12a`. Color legend chips below.
- **Empty positive card:** green check circle + "No alerts in 7 days" + "Last event Feb 26 · false alarm" + chevron.
- **Sensors card:** header "Sensors" + green pill "4/4 healthy". List rows for TX broadcaster + RX 1/2/3 with location, monospaced packet stats, chevrons.

### 5.2 Map — Live floor plan

- Large title "Map" + ellipsis & search circular icons on the right.
- Sub: `Mom · in living room · 14 min still`.
- **Horizontal-scroll layer chips:** Presence, Coverage, Heatmap, Sensor IDs, Trails. Active = blue fill / white text; inactive = white card / dark text.
- **Map card** (white, 12px padding): 360×380 SVG with:
  - Dot-grid background.
  - 5 rooms with subtle tint matching their accent color and labeled in 11/600.
  - 3 RX sensors as white-ringed green dots with dashed coverage halos.
  - 1 TX as a blue dot with concentric rings broadcasting outward.
  - A radial blue presence glow + a stick-figure "person" icon in the active room.
- **Two-up stat cards:** `PRESENCE / Living Room / Confidence 94%` and `SENSORS / 4 of 4 / All healthy`.
- **Rooms list:** rows with a colored bar (blue for active), name, last-seen sub, time tag, chevron.

### 5.3 Alerts — Active + history

- Large title "Alerts" + sub `1 active · 14 in last 30 days`.
- **Active card** (only when there is an active event):
  - Red eyebrow with pulsing dot: `ACTIVE NOW`.
  - Card has a red-tinted hero header: triangle icon + `FALL DETECTED · 0:23 LEFT` + 24/700 headline `Mom may have fallen / in the living room` (last phrase red) + sub line with confidence + sensor + time.
  - Action stack: top row 44px green `Call Mom` + red `Call 911`. Second row 36px secondary `Open map` + `Mark false alarm`.
- **History card list** — each row:
  - Top: room + time, date + confidence sub, status pill on the right (red = real fall, orange = false alarm, blue = pending review).
  - Below dashed hairline: small caps eyebrow `VARIANCE — RX2` with a `show traces ▾` toggle. When on, render a 26px-tall variance polyline in the matching status color, with a clear spike in the middle. Traces are **off by default**; the toggle is global.
- **Summary 30-day**: three stat cards in a row — `REAL 3` (red), `FALSE 11` (orange), `PRECISION 21%` (green).

### 5.4 Notify — Caregiver routing

- Large title "Notify" + sub `3 contacts · escalation in 30s`.
- **People list card:** rows for each contact with avatar (initials on a tinted circle), name, role, and a right-aligned status pill (`Primary`, `Backup`, `911`). Tap → contact detail.
- **Escalation rule card:** stepped vertical timeline showing `0s — push to primary`, `30s — push backup + SMS`, `60s — auto-call 911`. Each step has a tap-to-edit chevron.
- **Quiet hours** card: time range row + toggle.
- **Channels** card: rows with toggles for Push, SMS, Phone call, Apple Watch.

### 5.5 More — Profile & diagnostics

- Large title "More".
- **Profile card:** avatar + name + age + address + "Edit".
- **Grouped list** (iOS inset-grouped):
  - Sensor diagnostics → live packet rates, last calibration date, "Run self-test".
  - Apartment layout → edit floor plan / room names.
  - Sharing → invite caregivers.
  - Privacy & data → data retention, export, delete.
  - Subscription → plan, next billing.
  - Help & support.
- Sign out at the bottom in red.

## 6. The fall-alert moment (the demo's hero)

This is the most important interaction in the product. When a fall is detected:

1. **System push lands** with a sound + haptic. Lock screen shows a critical alert with a phone icon and an inline `Call Mom / Call 911 / I've got it` action set, even when the device is muted.
2. **Tap → app opens directly to the Alerts tab with the Active card front and center.** Do not show Home first.
3. **A 30-second countdown** runs in the eyebrow (`0:23 LEFT`). When it hits zero, escalation fires automatically per the user's rules in Notify.
4. **Resident side** (separate small surface — Apple Watch tap, smart-display, or in-room button): a big black-on-white "ARE YOU OK?" with an `I'm fine` cancel button that aborts escalation across all caregivers.
5. **After resolution** — the active card collapses into the History list with a tag chosen by the caregiver: `Real fall`, `False alarm`, or `Pending review`.

Mock the active state and the resolved state both in the alerts screen.

## 7. Components to extract

Build these as reusable SwiftUI views (or React components if doing a web mock):

- `StatusPill(kind, label)` — green/red/orange/blue tinted pill.
- `Card(children, style?)` — white 16-radius soft-shadow container.
- `SectionHeader(title, action?)` — 22/700 + optional blue trailing action.
- `LargeTitle(title, subtitle?, trailing?)` — 34/700 with optional sub + trailing icons.
- `TabBar(active)` — 5-tab blurred bottom bar with badge support.
- `FloorPlan(rooms[], sensors[], presence)` — small + large variants.
- `DayStrip(bands[])` — 24h colored band.
- `VarianceTrace(points[], color, spike)` — sensor variance line, used in Alerts history.
- `SymbolIcon(name, size, color, weight)` — SF-Symbol-style inline SVGs (or real SF Symbols if SwiftUI).

## 8. Data shape (mock)

```ts
type Resident = { id: string; name: string; address: string; avatar?: string };
type Sensor   = { id: string; kind: 'tx' | 'rx'; room: string; pktRate: number; rssi: number; healthy: boolean };
type Room     = { id: string; name: string; rect: {x:number;y:number;w:number;h:number}; accent: string };
type Presence = { roomId: string; since: string; confidence: number };
type Event    = {
  id: string; ts: string; room: string; sensor: string;
  confidence: number; status: 'active'|'real'|'false'|'pending';
  variance: number[]; // 60-point series, normalized 0..1
};
```

The home screen subscribes to `Presence`; the alerts screen subscribes to `Event[]` and renders the most recent active one as the hero.

## 9. Motion

- Pulsing dot on active state: 1.4s ease-in-out infinite, opacity 0.5↔1.
- Card mount: fade + 4px translateY, 200ms.
- Active alert headline: subtle 1px shake on first appearance only.
- Tab swap: cross-fade 120ms, no slide.
- Don't animate anything else.

## 10. Accessibility

- All status conveyed by **color + icon + text**, never color alone.
- Dynamic Type support up to XXL — cards must reflow, not truncate.
- VoiceOver label for the hero card reads the full sentence: "All quiet. Mom is in the living room. Last motion 14 minutes ago."
- Hit targets ≥ 44pt.
- Active-fall actions are reachable with one thumb on a 6.7" device.

## 11. What NOT to do

- No onboarding wizard, no calibration UI, no sensor pairing screens — installation is professional.
- No camera-style UI, no video — the value prop is no-cameras.
- No gamification, streaks, or badges. This is not a fitness app.
- No marketing copy on functional screens. No "Welcome back!"
- No second accent color. No purple "AI sparkle" gradients.
- No emoji.
- Do not invent stats the sensors can't measure (heart rate, sleep stages, etc).

## 12. Reference files in this project

- `Buoy — Hi-fi.html` — five-screen hi-fi mock laid out side by side.
- `gd-primitives.jsx` — tokens, symbols, tab bar, card, pill, large title.
- `gd-home.jsx`, `gd-map.jsx`, `gd-alerts.jsx`, `gd-notify.jsx`, `gd-more.jsx` — per-screen React.
- `CSI Frontend Wireframes.html` — earlier sketch-style exploration with multiple variants per screen.

Build to match the hi-fi, use the wireframes as a sanity check on alternates.
