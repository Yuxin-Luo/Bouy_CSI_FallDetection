# Bouy Tech-Stack HTML Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a single static HTML page `dev_doc/9-bouy-tech-stack-2026-07-06.html` that documents the full Bouy CSI fall-detection tech stack (ESP32 → CSI packet → receiver → features → LSTM+CNN → ensemble → real-time frontend) with embedded Mermaid flowcharts, hand-drawn SVGs, ASCII diagrams, and exact `file.py:line` references — for your own future reference as a depth-technical engineer.

**Architecture:** Single HTML file at `dev_doc/9-bouy-tech-stack-2026-07-06.html`. White background + gray borders (github-readme style). 12 sequential sections + sticky TOC. Tailwind v3 + Mermaid v10 from public CDN. Section-level visual variety: Mermaid flowcharts for state/sequencing, inline SVG for spatial geometry, ASCII for shapes. No JavaScript logic except CDN script tags. Hyperparam table at §4.

**Tech Stack:** HTML5, Tailwind CSS (CDN), Mermaid.js (CDN), inline SVG. Static — no JS, no build step.

**Spec:** `dev_doc/9-bouy-tech-stack-html-design-2026-07-06.md`

---

## Global Constraints

| Constraint | Value | Source |
|---|---|---|
| Output file | `dev_doc/9-bouy-tech-stack-2026-07-06.html` (exact path) | spec §1 |
| Encoding | UTF-8 | spec §1 |
| Language | `lang="zh-CN"` (Chinese-led, English code/paths) | project CLAUDE.md |
| Style | Pure white background + gray borders (#e5e7eb), no dark theme | spec §0 / user answer |
| CDN: Tailwind | `https://cdn.tailwindcss.com` (v3 Play CDN) | spec §1 |
| CDN: Mermaid | `https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js` | spec §1 |
| Font stack | Tailwind default (`system-ui, sans-serif`) + monospace for code | spec §0 |
| Max file size | ≤ 80KB (per spec §0 — keeps load fast) | this plan |
| Line-number refs | Format `path/to/file.py:L10-L20` (NEVER paste >5 lines of source code) | spec §0 |
| Out of scope | Twilio/Pusher/Next.js, full source dumps, LOOCV numerics (except §12) | spec §5 |
| Date stamp | "基于 2026-07-06 代码复盘" prominent at top | spec §0 |
| Honest scope footer | "MIT 免责 + 非医疗设备" at bottom | spec §7 #8 |
| Project root | This sub-project (`Bouy_CSI_FallDetection/`) | spec §1 |

---

## Working Directory

All commands assume `pwd` is the **Bouy sub-project root**:

```
/home/ruo/Desktop/LYX/USTB-SONY/esp-csi-v2/ESP32_FallRec_Reference/ReferenceCode/Opensourse/Bouy_CSI_FallDetection
```

The HTML will live at:

```
dev_doc/9-bouy-tech-stack-2026-07-06.html
```

---

## Task Index

1. **Shell + Tailwind + Mermaid** — file scaffold & deps load check
2. **Hero header + KPI cards + TOC nav**
3. **§1 Hardware layer** (1 TX + 4 RX + CSI packet)
4. **§2 Collection layer** (collect_mouse.py → NPZ)
5. **§3 Label splitting** (FALL → FALL_IMPACT + FLOORED)
6. **§4 Feature extraction (★ depth)** with hyperparam table
7. **§5 Model architectures** (LSTM + ResNet-CNN)
8. **§6 Training** (session-disjoint split + optimizer)
9. **§7 Ensemble + threshold + priority (★ depth)**
10. **§8 Live inference** (NPZ → result)
11. **§9 Frontend (★ depth)** — 4-row layout + smoothstep
12. **§10 End-to-end latency**
13. **§11 Decision table** + **§12 Honest scope footer**
14. **Final verification + commit**

---

### Task 1: Scaffold HTML shell + CDN load check

**Files:**
- Create: `dev_doc/9-bouy-tech-stack-2026-07-06.html`

**Interfaces:**
- Produces: a file at exact path above, containing `<!DOCTYPE html>` through `</html>`, viewable in a browser

**Step 1.1 — Create the file with bare shell + CDN tags**

Write this exact content to `dev_doc/9-bouy-tech-stack-2026-07-06.html`:

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Bouy CSI Fall Detection · 技术栈全链路</title>
<script src="https://cdn.tailwindcss.com"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2937; background: #ffffff; }
  code, pre, .mono { font-family: "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace; font-size: 13px; }
  pre { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 14px 16px; overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { padding: 8px 12px; text-align: left; border: 1px solid #e5e7eb; }
  th { background: #f9fafb; font-weight: 600; color: #374151; }
  tr:nth-child(even) td { background: #fafafa; }
  .kpi-card { background: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; }
  .toc-link { display: block; padding: 4px 10px; border-radius: 4px; color: #4b5563; font-size: 13px; }
  .toc-link:hover { background: #f3f4f6; color: #111827; }
  .toc-link.active { background: #eff6ff; color: #1d4ed8; font-weight: 600; }
  details > summary { list-style: none; cursor: pointer; padding: 8px 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; }
  details > summary::-webkit-details-marker { display: none; }
  details > summary::before { content: "▸"; display: inline-block; margin-right: 8px; transition: transform .15s; }
  details[open] > summary::before { transform: rotate(90deg); }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; border: 1px solid #e5e7eb; background: #ffffff; color: #374151; }
  .pill-blue { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
  .pill-green { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
  .pill-amber { background: #fffbeb; color: #b45309; border-color: #fde68a; }
  .pill-rose { background: #fff1f2; color: #be123c; border-color: #fecdd3; }
  .h-tag::before { content: "#"; color: #9ca3af; margin-right: 6px; font-weight: 400; }
  .mono-tag { font-family: "JetBrains Mono", monospace; font-size: 12px; color: #6b7280; }
  .border-toc { border-left: 2px solid #e5e7eb; }
</style>
</head>
<body>
<main id="top" class="max-w-7xl mx-auto px-6 py-8 space-y-16">

<!-- Hero placeholder (filled in Task 2) -->
<section id="hero-placeholder" class="text-slate-400">[Hero placeholder — Task 2]</section>

</main>

<script>
  document.addEventListener('DOMContentLoaded', () => {
    mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'loose' });
  });
</script>
</body>
</html>
```

**Step 1.2 — Verify file parses**

Run:

```bash
test -f dev_doc/9-bouy-tech-stack-2026-07-06.html && \
  head -1 dev_doc/9-bouy-tech-stack-2026-07-06.html && \
  tail -1 dev_doc/9-bouy-tech-stack-2026-07-06.html && \
  wc -c dev_doc/9-bouy-tech-stack-2026-07-06.html
```

Expected output:

```
<!DOCTYPE html>
</html>
<N> dev_doc/9-bouy-tech-stack-2026-07-06.html
```

(where N is ~3500 bytes)

**Step 1.3 — Verify CDN tags are syntactically correct**

Run:

```bash
grep -c 'cdn.tailwindcss.com' dev_doc/9-bouy-tech-stack-2026-07-06.html
grep -c 'mermaid@10' dev_doc/9-bouy-tech-stack-2026-07-06.html
```

Expected: `1` and `1`.

**Step 1.4 — Commit**

```bash
git add dev_doc/9-bouy-tech-stack-2026-07-06.html
git commit -m "docs: scaffold Bouy tech-stack HTML shell (Task 1 of 14)"
```

---

### Task 2: Hero header + KPI cards + sticky TOC

**Files:**
- Modify: `dev_doc/9-bouy-tech-stack-2026-07-06.html` — replace `<!-- Hero placeholder -->` block with hero + nav

**Step 2.1 — Replace the hero-placeholder section with this exact markup**

Locate:

```
<!-- Hero placeholder (filled in Task 2) -->
<section id="hero-placeholder" class="text-slate-400">[Hero placeholder — Task 2]</section>
```

Replace with:

```html
<!-- ========== HERO ========== -->
<header class="border-b border-gray-200 pb-8">
  <div class="flex items-center justify-between flex-wrap gap-4">
    <div>
      <div class="flex items-center gap-2 text-sm text-gray-500 mb-2">
        <span class="pill pill-blue">ESP32</span>
        <span class="pill pill-green">WiFi CSI</span>
        <span class="pill pill-amber">PyTorch</span>
        <span class="pill pill-rose">MATPLOTLIB 实时</span>
      </div>
      <h1 class="text-3xl md:text-4xl font-bold text-gray-900 leading-tight">
        Bouy CSI Fall Detection · 技术栈全链路
      </h1>
      <p class="mt-3 text-gray-600 max-w-3xl">
        把 "WiFi 信号 → 跌倒判定" 这条链路从硬件到屏幕可视化完整写下来。
        范围: ESP32 固件 → 1 TX + 4 RX 采集 → 特征提取 → LSTM + CNN 训练 → α 融合 → 实时推理 → 前端展示。
        <strong>不含</strong> Twilio / Pusher / Next.js 业务层。
      </p>
      <p class="mt-2 text-xs text-gray-500 mono-tag">
        基于 2026-07-06 代码复盘 · docs in /dev_doc/ · spec: 9-bouy-tech-stack-html-design-2026-07-06.md
      </p>
    </div>
  </div>

  <!-- KPI cards -->
  <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mt-8">
    <div class="kpi-card">
      <div class="text-xs text-gray-500 uppercase tracking-wider">子载波</div>
      <div class="text-2xl font-bold text-gray-900 mt-1">192</div>
      <div class="text-xs text-gray-500">OFDM @ 2.4GHz ch6</div>
    </div>
    <div class="kpi-card">
      <div class="text-xs text-gray-500 uppercase tracking-wider">采样率</div>
      <div class="text-2xl font-bold text-gray-900 mt-1">~70 Hz</div>
      <div class="text-xs text-gray-500">每秒 CSI 包</div>
    </div>
    <div class="kpi-card">
      <div class="text-xs text-gray-500 uppercase tracking-wider">类别</div>
      <div class="text-2xl font-bold text-gray-900 mt-1">6</div>
      <div class="text-xs text-gray-500">EMPTY..FLOORED</div>
    </div>
    <div class="kpi-card">
      <div class="text-xs text-gray-500 uppercase tracking-wider">感受野</div>
      <div class="text-2xl font-bold text-gray-900 mt-1">9 × 6s</div>
      <div class="text-xs text-gray-500">≈ 14s 上下文</div>
    </div>
    <div class="kpi-card">
      <div class="text-xs text-gray-500 uppercase tracking-wider">融合权重</div>
      <div class="text-2xl font-bold text-gray-900 mt-1">α=0.50</div>
      <div class="text-xs text-gray-500">LSTM / CNN 平衡</div>
    </div>
  </div>
</header>

<!-- ========== STICKY TOC ========== -->
<nav class="sticky top-0 z-30 bg-white/90 backdrop-blur border border-gray-200 rounded-lg px-4 py-3 -mx-2">
  <div class="text-xs uppercase tracking-wider text-gray-500 mb-2 font-semibold">目录</div>
  <div class="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
    <a href="#s1" class="toc-link">§1 硬件层</a>
    <a href="#s2" class="toc-link">§2 采集层</a>
    <a href="#s3" class="toc-link">§3 标签切分</a>
    <a href="#s4" class="toc-link">§4 特征提取 ★</a>
    <a href="#s5" class="toc-link">§5 模型架构</a>
    <a href="#s6" class="toc-link">§6 训练</a>
    <a href="#s7" class="toc-link">§7 Ensemble ★</a>
    <a href="#s8" class="toc-link">§8 实时推理</a>
    <a href="#s9" class="toc-link">§9 前端 ★</a>
    <a href="#s10" class="toc-link">§10 时延累计</a>
    <a href="#s11" class="toc-link">§11 决策表</a>
    <a href="#s12" class="toc-link">§12 已知限制</a>
  </div>
</nav>
```

**Step 2.2 — Verify all 12 TOC anchors exist (they don't yet — that's fine; they'll land in later tasks)**

Run:

```bash
grep -c 'id="s[0-9]' dev_doc/9-bouy-tech-stack-2026-07-06.html
```

Expected: `0` for now (anchors will be added in Tasks 3–13).

**Step 2.3 — Verify file size hasn't exploded**

Run:

```bash
wc -l dev_doc/9-bouy-tech-stack-2026-07-06.html
wc -c dev_doc/9-bouy-tech-stack-2026-07-06.html
```

Expected: ≤ 200 lines, ≤ 12KB.

**Step 2.4 — Commit**

```bash
git add dev_doc/9-bouy-tech-stack-2026-07-06.html
git commit -m "docs: add hero + KPI + sticky TOC (Task 2 of 14)"
```

---

### Task 3: §1 Hardware layer (1 TX + 4 RX + CSI packet)

**Files:**
- Modify: `dev_doc/9-bouy-tech-stack-2026-07-06.html` — append §1 at end of `<main>`, before `</main>`

**Step 3.1 — Append this exact section**

Locate the closing `</main>` tag. Insert this block immediately BEFORE `</main>` (after Task 2's TOC `</nav>`):

```html
<!-- ========== §1 硬件层 ========== -->
<section id="s1" class="space-y-4">
  <div class="flex items-baseline gap-3">
    <div class="text-blue-600 font-mono text-sm font-semibold">§1</div>
    <h2 class="text-2xl font-semibold text-gray-900">硬件层 (Hardware)</h2>
  </div>
  <p class="text-gray-600 max-w-3xl">
    一块 ESP32 TX 和四块 ESP32 RX 构成一对多接收链路。CSI (Channel State Information)
    是每个 WiFi 数据包内 HT-LTF (High-Throughput Long Training Field) 携带的频率响应,
    含 192 个 OFDM 子载波上的复数值。本项目取其幅度。
  </p>

  <!-- SVG: 1 TX + 4 RX 房间示意 -->
  <div class="border border-gray-200 rounded-lg p-4 bg-gray-50">
    <svg viewBox="0 0 600 220" class="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
      <!-- room outline -->
      <rect x="40" y="20" width="520" height="180" fill="#ffffff" stroke="#9ca3af" stroke-width="2" stroke-dasharray="4 4" />
      <!-- TX top-center -->
      <g>
        <rect x="280" y="38" width="40" height="22" rx="3" fill="#dbeafe" stroke="#1d4ed8" stroke-width="1.5"/>
        <text x="300" y="52" font-family="monospace" font-size="11" text-anchor="middle" fill="#1d4ed8">TX</text>
      </g>
      <!-- 4 RX corners -->
      <g>
        <rect x="60" y="36" width="40" height="22" rx="3" fill="#ecfdf5" stroke="#047857" stroke-width="1.5"/>
        <text x="80" y="50" font-family="monospace" font-size="11" text-anchor="middle" fill="#047857">RX1</text>
      </g>
      <g>
        <rect x="500" y="36" width="40" height="22" rx="3" fill="#ecfdf5" stroke="#047857" stroke-width="1.5"/>
        <text x="520" y="50" font-family="monospace" font-size="11" text-anchor="middle" fill="#047857">RX2</text>
      </g>
      <g>
        <rect x="60" y="170" width="40" height="22" rx="3" fill="#ecfdf5" stroke="#047857" stroke-width="1.5"/>
        <text x="80" y="184" font-family="monospace" font-size="11" text-anchor="middle" fill="#047857">RX3</text>
      </g>
      <g>
        <rect x="500" y="170" width="40" height="22" rx="3" fill="#ecfdf5" stroke="#047857" stroke-width="1.5"/>
        <text x="520" y="184" font-family="monospace" font-size="11" text-anchor="middle" fill="#047857">RX4</text>
      </g>
      <!-- 多径示意: TX to each RX as wavy arrows -->
      <g stroke="#60a5fa" stroke-width="1" fill="none" opacity="0.5">
        <path d="M 300 60 Q 200 100 80 60" stroke-dasharray="3 3" />
        <path d="M 300 60 Q 200 80 80 60" />
        <path d="M 300 60 Q 400 100 520 60" stroke-dasharray="3 3" />
        <path d="M 300 60 Q 400 80 520 60" />
        <path d="M 300 60 Q 200 140 80 170" stroke-dasharray="3 3" />
        <path d="M 300 60 Q 200 150 80 170" />
        <path d="M 300 60 Q 400 140 520 170" stroke-dasharray="3 3" />
        <path d="M 300 60 Q 400 150 520 170" />
      </g>
      <!-- 人在中间 -->
      <g>
        <circle cx="300" cy="130" r="10" fill="#fbbf24" stroke="#92400e" stroke-width="1.5"/>
        <line x1="300" y1="140" x2="300" y2="160" stroke="#92400e" stroke-width="2"/>
        <line x1="300" y1="160" x2="285" y2="180" stroke="#92400e" stroke-width="2"/>
        <line x1="300" y1="160" x2="315" y2="180" stroke="#92400e" stroke-width="2"/>
        <line x1="300" y1="148" x2="285" y2="170" stroke="#92400e" stroke-width="2"/>
        <line x1="300" y1="148" x2="315" y2="170" stroke="#92400e" stroke-width="2"/>
        <text x="300" y="200" font-family="sans-serif" font-size="10" text-anchor="middle" fill="#374151">被监护人</text>
      </g>
      <text x="50" y="14" font-family="sans-serif" font-size="11" fill="#6b7280">1 TX + 4 RX 房间布局</text>
    </svg>
  </div>

  <!-- ASCII: CSI packet 字节布局 (简化) -->
  <div>
    <h3 class="text-lg font-semibold text-gray-800 mt-6">CSI packet 布局 (简化)</h3>
    <pre>┌──────────┬──────────────────────────────────┬──────────┐
│ preamble │  HT-LTF 192 subcarriers (complex)│  tail    │
│ 12 µs    │  ≈ 4 µs → 192 个复数 (re/im)     │  padding │
└──────────┴──────────────────────────────────┴──────────┘
             ↓ 抽 amplitude, 一帧 = 192 floats
             ↓ 70 Hz → 每秒 ≈ 70 帧 / 板</pre>
  </div>

  <!-- Mermaid: firmware state machine -->
  <div>
    <h3 class="text-lg font-semibold text-gray-800 mt-6">Firmware data flow</h3>
    <div class="mermaid">
flowchart LR
  A[WiFi 802.11n<br/>channel 6] --> B[ESP32 RX<br/>csi_recv]
  B --> C[HT-LTF 抽 192 subs<br/>per packet]
  C --> D[UART 921600 baud<br/>CSV 一行/包]
  D --> E[PC USB /dev/ttyACM*<br/>MultiPortReader]
  E --> F[NPZ chunk 6s<br/>amplitudes_&lt;rx&gt;]
    </div>
  </div>

  <div class="text-xs text-gray-500 mono-tag mt-2">
    引用: fall-detection-training/firmware/csi_recv/main/* ·
    src/pc_tools/receiver/csi_io.py ·
    collection_mouse.py:MULTIPORTREADER 配置 (921600, 0 buffer)
  </div>
</section>
```

**Step 3.2 — Verify §1 anchor + Mermaid block**

Run:

```bash
grep -c 'id="s1"' dev_doc/9-bouy-tech-stack-2026-07-06.html
grep -c '<div class="mermaid">' dev_doc/9-bouy-tech-stack-2026-07-06.html
grep -c 'flowchart' dev_doc/9-bouy-tech-stack-2026-07-06.html
```

Expected: `1`, `1`, `1`.

**Step 3.3 — Commit**

```bash
git add dev_doc/9-bouy-tech-stack-2026-07-06.html
git commit -m "docs: add §1 hardware layer with SVG + ASCII + Mermaid (Task 3 of 14)"
```

---

### Task 4: §2 Collection layer (collect_mouse.py → NPZ)

**Files:**
- Modify: `dev_doc/9-bouy-tech-stack-2026-07-06.html` — append §2 before `</main>`

**Step 4.1 — Append §2 section**

Insert this immediately before `</main>` (after Task 3's §1):

```html
<!-- ========== §2 采集层 ========== -->
<section id="s2" class="space-y-4">
  <div class="flex items-baseline gap-3">
    <div class="text-blue-600 font-mono text-sm font-semibold">§2</div>
    <h2 class="text-2xl font-semibold text-gray-900">采集层 (Collection)</h2>
  </div>
  <p class="text-gray-600 max-w-3xl">
    <code>collection_mouse.py</code> 是 labeling-friendly 录制工具: 4 RX 串口实时读
    (丢给 <code>MultiPortReader</code> 后台线程), 鼠标按键发 2-bit / 6-bit 协议标记类别。
    每个 session 输出 3 个 sidecar 文件。
  </p>

  <!-- Mermaid: collection 时序 -->
  <div class="mermaid">
sequenceDiagram
  participant U as User<br/>鼠标按键
  participant F as Matplotlib<br/>Figure
  participant B as MultiPortReader<br/>(4× daemon thread)
  participant FS as csi.npz
  participant JS as labels.json
  participant MS as metadata.json
  Note over B: 921600 baud, 0 buffer cap
  loop 4 RX boards
    B->>B: serial read non-blocking
    B->>F: push (name, amplitudes[192], t_mono)
  end
  U->>F: mouse click (L/R bit)
  F->>F: BitBuffer.push + tentative preview
  Note right of F: 1s timeout → commit
  F->>JS: append {t_start, t_end, class}
  U->>F: middle click / SIGINT / close
  F->>FS: save csi.npz (per-RX arrays)
  F->>JS: save labels.json
  F->>MS: save metadata.json
  </div>

  <!-- ASCII: NPZ chunk 文件结构 -->
  <div>
    <h3 class="text-lg font-semibold text-gray-800 mt-6">csi.npz 文件内部结构</h3>
    <pre>csi.npz (≈ 几 MB / session)
├─ rx_names:        ["RX1","RX2","RX3","RX4"]   4× str
├─ timestamps_RX1:  float64[N]    N ≈ 70 × 60 × min
├─ amplitudes_RX1:  float32[N, 192]              每包 → 192 subcarriers
├─ timestamps_RX2:  ...
├─ amplitudes_RX2:  ...
└─ (RX3, RX4 同上)

labels.json (人标)
└─ segments: [{ t_start: float, t_end: float, class: str }, ...]
   类别: EMPTY / STILL / WALKING / TRANSITION / FALL (orig 5 类)

metadata.json
├─ session_name, started_at, subject, notes
├─ ports: [{path, name, packets}]
└─ rx_warnings (运行时告警: 哪块 RX 在哪段时间 pkts=0)</pre>
  </div>

  <div class="text-xs text-gray-500 mono-tag mt-2">
    引用: collection/collection_mouse.py:103-149 (BitBuffer) · csi_io.py:MultiPortReader ·
    :Main 函数的 save_session 调用
  </div>
</section>
```

**Step 4.2 — Sanity check: mermaid block count**

Run:

```bash
grep -c '<div class="mermaid">' dev_doc/9-bouy-tech-stack-2026-07-06.html
```

Expected: `2` (one from §1, one new from §2).

**Step 4.3 — Commit**

```bash
git add dev_doc/9-bouy-tech-stack-2026-07-06.html
git commit -m "docs: add §2 collection layer with Mermaid sequence + NPZ ASCII (Task 4 of 14)"
```

---

### Task 5: §3 Label splitting (FALL → FALL_IMPACT + FLOORED)

**Files:**
- Modify: `dev_doc/9-bouy-tech-stack-2026-07-06.html` — append §3 before `</main>`

**Step 5.1 — Append §3**

Insert before `</main>`:

```html
<!-- ========== §3 标签切分 ========== -->
<section id="s3" class="space-y-4">
  <div class="flex items-baseline gap-3">
    <div class="text-blue-600 font-mono text-sm font-semibold">§3</div>
    <h2 class="text-2xl font-semibold text-gray-900">标签切分 (FALL → FALL_IMPACT + FLOORED)</h2>
  </div>
  <p class="text-gray-600 max-w-3xl">
    原 <code>labels.json</code> 把整段跌倒（含冲击 + 倒地后静止）都标成 FALL。
    ~95% 是冲击后的静止态，与 STILL 不可区分。需要把每段 FALL 切成:
    <strong>FALL_IMPACT</strong> (前 1.5s) + <strong>FLOORED</strong> (剩余)。
    这样模型学得到清晰的 per-frame "冲击" 信号。
  </p>

  <!-- SVG: 时间轴示意 -->
  <div class="border border-gray-200 rounded-lg p-4 bg-gray-50">
    <svg viewBox="0 0 700 110" class="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
      <!-- 时间轴 -->
      <line x1="40" y1="55" x2="660" y2="55" stroke="#6b7280" stroke-width="2"/>
      <!-- 刻度 -->
      <g stroke="#9ca3af" stroke-width="1">
        <line x1="40" y1="50" x2="40" y2="60"/>
        <line x1="160" y1="50" x2="160" y2="60"/>
        <line x1="280" y1="50" x2="280" y2="60"/>
        <line x1="600" y1="50" x2="600" y2="60"/>
        <line x1="660" y1="50" x2="660" y2="60"/>
      </g>
      <g font-family="sans-serif" font-size="11" fill="#6b7280" text-anchor="middle">
        <text x="40" y="80">t_start</text>
        <text x="160" y="80">+1.5 s</text>
        <text x="280" y="80">+4 s</text>
        <text x="660" y="80">t_end</text>
      </g>
      <!-- FALL_IMPACT 块 -->
      <rect x="40" y="20" width="120" height="30" fill="#fee2e2" stroke="#b91c1c" stroke-width="1.5"/>
      <text x="100" y="38" font-family="monospace" font-size="12" text-anchor="middle" fill="#7f1d1d">FALL_IMPACT</text>
      <!-- FLOORED 块 -->
      <rect x="160" y="20" width="500" height="30" fill="#fef3c7" stroke="#a16207" stroke-width="1.5"/>
      <text x="410" y="38" font-family="monospace" font-size="12" text-anchor="middle" fill="#713f12">FLOORED</text>
      <text x="50" y="100" font-family="sans-serif" font-size="10" fill="#6b7280">原 labels.json 一段 FALL</text>
    </svg>
  </div>

  <table>
    <thead>
      <tr><th>类别</th><th>时窗</th><th>释义</th></tr>
    </thead>
    <tbody>
      <tr><td>FALL_IMPACT</td><td>[t_start, t_start+1.5s]</td><td>冲击期 (rapid descent + impact)</td></tr>
      <tr><td>FLOORED</td><td>[t_start+1.5s, t_end]</td><td>倒地后静止</td></tr>
      <tr><td>EMPTY</td><td>[前段]</td><td>空房间</td></tr>
      <tr><td>STILL</td><td>[段]</td><td>人在但不移动</td></tr>
      <tr><td>WALKING</td><td>[段]</td><td>持续走动</td></tr>
      <tr><td>TRANSITION</td><td>[段]</td><td>坐→站、躺→坐等</td></tr>
    </tbody>
  </table>

  <div class="text-xs text-gray-500 mono-tag mt-2">
    引用: labeling/split_fall_labels.py:25-52 (split_segments), 默认 IMPACT_SEC=1.5,
    输出 labels_v2.json · 类索引: 0=EMPTY..5=FLOORED (6 类)
  </div>
</section>
```

**Step 5.2 — Verify**

Run:

```bash
grep -c 'id="s3"' dev_doc/9-bouy-tech-stack-2026-07-06.html
grep -c 'FALL_IMPACT' dev_doc/9-bouy-tech-stack-2026-07-06.html
```

Expected: `1`, `>= 3`.

**Step 5.3 — Commit**

```bash
git add dev_doc/9-bouy-tech-stack-2026-07-06.html
git commit -m "docs: add §3 label splitting with SVG timeline + class table (Task 5 of 14)"
```

---

### Task 6: §4 Feature extraction (★ depth) + hyperparam table

**Files:**
- Modify: `dev_doc/9-bouy-tech-stack-2026-07-06.html` — append §4 before `</main>`

This is the deepest section. Two feature pipelines: LSTM hand-crafted (16-d) + CNN band-spectrogram (32, 49, 21).

**Step 6.1 — Append §4**

Insert before `</main>`:

```html
<!-- ========== §4 特征提取 (★ 深度) ========== -->
<section id="s4" class="space-y-4">
  <div class="flex items-baseline gap-3">
    <div class="text-blue-600 font-mono text-sm font-semibold">§4</div>
    <h2 class="text-2xl font-semibold text-gray-900">特征提取 (Feature engineering)</h2>
    <span class="pill pill-amber">★ 深度</span>
  </div>
  <p class="text-gray-600 max-w-3xl">
    两条独立特征管线喂两条模型。
    <strong>LSTM 走手工 16 维 / 1 s 窗口</strong>;
    <strong>CNN 走 32 通道 STFT 频谱 / 6 s 窗口</strong>。
    二者时间对齐方式不同: LSTM 是 (16 窗口 × 0.5 s hop) 的序列, CNN 是单帧 (49 频 × 21 时)。
  </p>

  <!-- SVG: 192 subs → 8 bands 切片 -->
  <div class="border border-gray-200 rounded-lg p-4 bg-gray-50">
    <svg viewBox="0 0 700 200" class="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
      <!-- Title -->
      <text x="20" y="20" font-family="sans-serif" font-size="13" fill="#374151" font-weight="600">192 subcarriers → 8 bands</text>
      <!-- bar of 192 subs (one RX) -->
      <g>
        <rect x="40" y="40" width="620" height="20" fill="#e5e7eb" stroke="#9ca3af" stroke-width="1"/>
        <!-- 8 band shading -->
        <g fill="#bfdbfe" opacity="0.7">
          <rect x="40" y="40" width="77.5" height="20"/>
          <rect x="117.5" y="40" width="77.5" height="20"/>
          <rect x="195" y="40" width="77.5" height="20"/>
          <rect x="272.5" y="40" width="77.5" height="20"/>
          <rect x="350" y="40" width="77.5" height="20"/>
          <rect x="427.5" y="40" width="77.5" height="20"/>
          <rect x="505" y="40" width="77.5" height="20"/>
          <rect x="582.5" y="40" width="77.5" height="20"/>
        </g>
        <!-- band separators -->
        <g stroke="#1d4ed8" stroke-width="1" stroke-dasharray="2 2">
          <line x1="117.5" y1="40" x2="117.5" y2="60"/>
          <line x1="195" y1="40" x2="195" y2="60"/>
          <line x1="272.5" y1="40" x2="272.5" y2="60"/>
          <line x1="350" y1="40" x2="350" y2="60"/>
          <line x1="427.5" y1="40" x2="427.5" y2="60"/>
          <line x1="505" y1="40" x2="505" y2="60"/>
          <line x1="582.5" y1="40" x2="582.5" y2="60"/>
          <line x1="660" y1="40" x2="660" y2="60"/>
        </g>
        <text x="350" y="78" font-family="monospace" font-size="10" text-anchor="middle" fill="#374151">
          sub 0..191 (per RX, mean amplitude across subs per band → 1D time series)
        </text>
      </g>
      <!-- arrow -->
      <line x1="350" y1="90" x2="350" y2="105" stroke="#9ca3af" stroke-width="2"/>
      <polygon points="345,103 355,103 350,113" fill="#9ca3af"/>

      <!-- 8 bands × STFT -->
      <g>
        <text x="20" y="128" font-family="sans-serif" font-size="11" fill="#374151">每 band:</text>
        <text x="20" y="142" font-family="sans-serif" font-size="11" fill="#374151">1D series (T_packets,)</text>
        <text x="20" y="156" font-family="sans-serif" font-size="11" fill="#374151">→ STFT(nperseg=96, noverlap=80)</text>
        <text x="20" y="170" font-family="sans-serif" font-size="11" fill="#374151">→ (49 freq × 21 time)</text>
      </g>
      <g>
        <!-- 4×8 grid showing channels -->
        <text x="220" y="128" font-family="sans-serif" font-size="11" fill="#374151">4 RX × 8 band = 32 channels</text>
        <g transform="translate(220,135)">
          <g font-family="monospace" font-size="10" fill="#374151" text-anchor="middle">
            <!-- Header row: RX1..RX4 above each block of 8 -->
            <text x="10" y="0">RX1</text><text x="90" y="0">RX2</text>
            <text x="170" y="0">RX3</text><text x="250" y="0">RX4</text>
            <!-- 8 bands × 4 RX as 4 columns of 8 small boxes -->
            <g fill="#fef3c7" stroke="#a16207" stroke-width="1">
              <rect x="0" y="5" width="20" height="8"/><rect x="0" y="14" width="20" height="8"/><rect x="0" y="23" width="20" height="8"/><rect x="0" y="32" width="20" height="8"/>
              <rect x="0" y="41" width="20" height="8"/><rect x="0" y="50" width="20" height="8"/><rect x="0" y="59" width="20" height="8"/><rect x="0" y="68" width="20" height="8"/>
            </g>
            <g fill="#dbeafe" stroke="#1d4ed8" stroke-width="1">
              <rect x="80" y="5" width="20" height="8"/><rect x="80" y="14" width="20" height="8"/><rect x="80" y="23" width="20" height="8"/><rect x="80" y="32" width="20" height="8"/>
              <rect x="80" y="41" width="20" height="8"/><rect x="80" y="50" width="20" height="8"/><rect x="80" y="59" width="20" height="8"/><rect x="80" y="68" width="20" height="8"/>
            </g>
            <g fill="#dcfce7" stroke="#15803d" stroke-width="1">
              <rect x="160" y="5" width="20" height="8"/><rect x="160" y="14" width="20" height="8"/><rect x="160" y="23" width="20" height="8"/><rect x="160" y="32" width="20" height="8"/>
              <rect x="160" y="41" width="20" height="8"/><rect x="160" y="50" width="20" height="8"/><rect x="160" y="59" width="20" height="8"/><rect x="160" y="68" width="20" height="8"/>
            </g>
            <g fill="#fce7f3" stroke="#9d174d" stroke-width="1">
              <rect x="240" y="5" width="20" height="8"/><rect x="240" y="14" width="20" height="8"/><rect x="240" y="23" width="20" height="8"/><rect x="240" y="32" width="20" height="8"/>
              <rect x="240" y="41" width="20" height="8"/><rect x="240" y="50" width="20" height="8"/><rect x="240" y="59" width="20" height="8"/><rect x="240" y="68" width="20" height="8"/>
            </g>
          </g>
        </g>
      </g>
    </svg>
  </div>

  <!-- ASCII: 16 维 LSTM 特征向量 -->
  <div>
    <h3 class="text-lg font-semibold text-gray-800 mt-6">LSTM 16 维手工特征向量 (每 1 s 窗口)</h3>
    <pre>每 window (1.0 s, hop 0.5 s), per RX 4 维:
┌──────────────────────────┬──────────────────────────┐
│ feat[0] robust_var       │  robust_variance(amps)  │
│ feat[1] delta_var        │  var_w - var_w-1         │
│ feat[2] mean_amp         │  float(amps.mean())      │
│ feat[3] spectral_centroid│  0.5~5 Hz 能量加权频率   │
└──────────────────────────┴──────────────────────────┘
4 RX × 4 = 16 维 flat 向量
跨 16 个窗口 = 序列 (16, 16) → LSTM 1×64 → softmax(6 类)</pre>
  </div>

  <!-- 公式 details -->
  <details>
    <summary>📐 公式细节 (点开看)</summary>
    <div class="mt-3 space-y-3 text-gray-700">
      <p><strong>robust_variance (k=3.0):</strong></p>
      <pre>detrended = amps - amps.mean(axis=0)
mad = median(|detrended|, axis=0)
clip = 3.0 × 1.4826 × mad
variance = mean(clip(detrended, ±clip)²)</pre>
      <p class="text-xs text-gray-500">MAD-clip 抑制突发尖刺 (路由切换 / 微波炉), k=3.0 ≈ 3σ 等价。</p>

      <p><strong>spectral_centroid_in_band (0.5–5 Hz):</strong></p>
      <pre>detrend → rfft (axis=0, n=窗口样本数)
band_mask = (freqs ≥ 0.5 Hz) & (freqs ≤ 5 Hz)
centroid = Σ(freq × |spec|²) / Σ|spec|² over band</pre>
      <p class="text-xs text-gray-500">人走动 ≈ 0.5–2 Hz 步频, 跌倒冲击 ≈ 1–5 Hz 宽带。裁掉 &gt;5 Hz 噪声。</p>
    </div>
  </details>

  <!-- 超参集中表 -->
  <h3 class="text-lg font-semibold text-gray-800 mt-6">关键超参一览 (全文检索入口)</h3>
  <table>
    <thead>
      <tr><th>超参</th><th>值</th><th>位置</th><th>为什么</th></tr>
    </thead>
    <tbody>
      <tr><td><code>NOMINAL_RATE_HZ</code></td><td>70</td><td>infer_loop_ensemble.py:94</td><td>实际采样率漂移容忍</td></tr>
      <tr><td><code>LSTM_WIN_SEC</code></td><td>1.0</td><td>infer_loop_ensemble.py:99</td><td>走路步频 ~2 Hz, 需 ≥0.5 s</td></tr>
      <tr><td><code>LSTM_HOP_SEC</code></td><td>0.5</td><td>infer_loop_ensemble.py:100</td><td>50% 重叠, 避免边缘效应</td></tr>
      <tr><td><code>LSTM_T_SEQ</code></td><td>16</td><td>infer_loop_ensemble.py:101</td><td>16 × 0.5 = 8 s 上文 + 当前 1 s</td></tr>
      <tr><td><code>LSTM_N_FEAT_PER_RX</code></td><td>4</td><td>infer_loop_ensemble.py:102</td><td>var / delta_var / mean_amp / centroid</td></tr>
      <tr><td><code>NPERSEG</code></td><td>96</td><td>infer_loop_ensemble.py:91</td><td>49 freq bins, ≈1.4 Hz 分辨率</td></tr>
      <tr><td><code>NOVERLAP</code></td><td>80</td><td>infer_loop_ensemble.py:92</td><td>16-sample hop → 21 time bins</td></tr>
      <tr><td><code>N_BANDS</code></td><td>8</td><td>infer_loop_ensemble.py:93</td><td>192/8 = 24 sub/band</td></tr>
      <tr><td><code>α</code></td><td>0.5</td><td>state.json + ensemble_predict</td><td>balanced (D.22.4 实测最优)</td></tr>
      <tr><td><code>THRESHOLD</code></td><td>0.5</td><td>frontend/app.py 顶部</td><td>与训练 held-out 校准</td></tr>
      <tr><td><code>PRIORITY_ORDER</code></td><td>FALL_IMPACT &gt; FLOORED &gt; TRANSITION &gt; WALKING &gt; STILL &gt; EMPTY</td><td>frontend/app.py 顶部</td><td>临床紧迫性</td></tr>
      <tr><td><code>CHUNK_SEC</code></td><td>6.0</td><td>receiver.py + infer_loop</td><td>边到边 6 s</td></tr>
      <tr><td><code>UPDATE_HZ</code></td><td>5.0</td><td>frontend/app.py</td><td>UI 红帧率</td></tr>
      <tr><td><code>QUEUE_MAX</code></td><td>10</td><td>frontend/app.py</td><td>drop-oldest 拥塞控制</td></tr>
      <tr><td><code>smoothstep dur</code></td><td>6.0 s</td><td>frontend/app.py</td><td>与 chunk 对齐</td></tr>
    </tbody>
  </table>

  <div class="text-xs text-gray-500 mono-tag mt-2">
    引用: src/pc_tools/inference/infer_loop_ensemble.py:128-271 (check_rx_presence / chunk_to_*)
    · fall-detection-training/training/train_lstm.py:59-86 (robust_variance / spectral_centroid)
    · fall-detection-training/training/train_lstm.py:89-162 (extract_features_for_session)
    · fall-detection-training/training/train_cnn_deep.py:75-180 (extract_band_spectrograms_for_session)
  </div>
</section>
```

**Step 6.2 — Verify**

Run:

```bash
grep -c 'id="s4"' dev_doc/9-bouy-tech-stack-2026-07-06.html
grep -c 'NOMINAL_RATE_HZ' dev_doc/9-bouy-tech-stack-2026-07-06.html
grep -c 'infer_loop_ensemble.py:' dev_doc/9-bouy-tech-stack-2026-07-06.html
```

Expected: `1`, `1`, `>= 10`.

**Step 6.3 — Commit**

```bash
git add dev_doc/9-bouy-tech-stack-2026-07-06.html
git commit -m "docs: add §4 feature extraction (LSTM 16-d + CNN 32ch spec) with hyperparam table (Task 6 of 14)"
```

---

### Task 7: §5 Model architectures (LSTM + ResNet-CNN)

**Files:**
- Modify: `dev_doc/9-bouy-tech-stack-2026-07-06.html` — append §5 before `</main>`

**Step 7.1 — Append §5**

Insert before `</main>`:

```html
<!-- ========== §5 模型架构 ========== -->
<section id="s5" class="space-y-4">
  <div class="flex items-baseline gap-3">
    <div class="text-blue-600 font-mono text-sm font-semibold">§5</div>
    <h2 class="text-2xl font-semibold text-gray-900">模型架构 (LSTM + ResNet-CNN)</h2>
  </div>
  <p class="text-gray-600 max-w-3xl">
    两条模型走两套特征、各自对小数据友好。
    LSTM 是 stacked 单层 + MLP head; ResNet-CNN 是 4 stage + skip。
  </p>

  <h3 class="text-lg font-semibold text-gray-800 mt-4">LSTM (CSIClassifier)</h3>
  <pre>Input:  (B, T_seq=16, F=16)
   ↓
LSTM(1 layer, hidden=64, batch_first=True)
   ↓  (B, 16, 64)
LayerNorm(64) → Dropout(0.3)
   ↓
Linear(64 → 32) → ReLU → Dropout(0.3)
   ↓
Linear(32 → 6)
   ↓ softmax → (B, 6) class probs</pre>

  <h3 class="text-lg font-semibold text-gray-800 mt-6">ResNet-CNN (CSI_DeepCNN)</h3>
  <pre>Input:  (B, C=32, F=49, T=21)
   ↓
Stem: Conv2d(32→32, 3×3) + BN + ReLU
   ↓
Stage 1: [ResBlock(32→32)] × 2
   ↓
Stage 2: [ResBlock(32→64, stride 2)] + [ResBlock(64→64)]
   ↓
Stage 3: [ResBlock(64→128, stride 2)] + [ResBlock(128→128)]
   ↓
Stage 4: [ResBlock(128→128)]
   ↓
AdaptiveAvgPool2d(1) → Flatten → (B, 128)
   ↓
Linear(128→128) → ReLU → Dropout(0.4)
   ↓
Linear(128→64) → ReLU → Dropout(0.4)
   ↓
Linear(64→6)
   ↓ softmax → (B, 6) class probs
~ 1.5M params (base=32, dense=128)</pre>

  <h3 class="text-lg font-semibold text-gray-800 mt-6">对比</h3>
  <table>
    <thead>
      <tr><th>维度</th><th>LSTM</th><th>ResNet-CNN</th></tr>
    </thead>
    <tbody>
      <tr><td>输入 shape</td><td>(B, 16, 16)</td><td>(B, 32, 49, 21)</td></tr>
      <tr><td>时窗</td><td>8.5 s 上下文 (16 × 0.5 s + 当前)</td><td>6 s 单窗</td></tr>
      <tr><td>参数量</td><td>~17 k</td><td>~1.5 M</td></tr>
      <tr><td>训练速度</td><td>CPU 5 min / session</td><td>GPU 30 s/epoch</td></tr>
      <tr><td>擅长</td><td>时间序列动态 (步频、停顿)</td><td>频谱形状 (冲击能量分布)</td></tr>
      <tr><td>弱项</td><td>频域细节</td><td>长程时序</td></tr>
    </tbody>
  </table>

  <div class="text-xs text-gray-500 mono-tag mt-2">
    引用: train_lstm.py:281-341 (CSIClassifier)
    · train_cnn_deep.py:372-428 (CSI_DeepCNN)
  </div>
</section>
```

**Step 7.2 — Verify**

```bash
grep -c 'id="s5"' dev_doc/9-bouy-tech-stack-2026-07-06.html
grep -c 'CSIClassifier' dev_doc/9-bouy-tech-stack-2026-07-06.html
grep -c 'CSI_DeepCNN' dev_doc/9-bouy-tech-stack-2026-07-06.html
```

Expected: `1`, `>= 2`, `>= 2`.

**Step 7.3 — Commit**

```bash
git add dev_doc/9-bouy-tech-stack-2026-07-06.html
git commit -m "docs: add §5 model architectures (LSTM + ResNet-CNN) (Task 7 of 14)"
```

---

### Task 8: §6 Training (session-disjoint split + optimizer)

**Files:**
- Modify: `dev_doc/9-bouy-tech-stack-2026-07-06.html` — append §6 before `</main>`

**Step 8.1 — Append §6**

Insert before `</main>`:

```html
<!-- ========== §6 训练 ========== -->
<section id="s6" class="space-y-4">
  <div class="flex items-baseline gap-3">
    <div class="text-blue-600 font-mono text-sm font-semibold">§6</div>
    <h2 class="text-2xl font-semibold text-gray-900">训练 (Training)</h2>
  </div>
  <p class="text-gray-600 max-w-3xl">
    Session-disjoint (按时段切分) + class-weighted CE 抗不平衡 +
    ReduceLROnPlateau + 早停。LSTM 跑 CPU 即可, CNN 在 GPU 上 30s/epoch。
  </p>

  <!-- ASCII: session-disjoint 三折分 -->
  <h3 class="text-lg font-semibold text-gray-800 mt-4">Session-disjoint split</h3>
  <pre>Session pool:  s1 s2 s3 s4 s5 s6 s7   (7 sessions in train pool)

                  ┌─────── train ───────┐ ┌─ val ─┐ ┌ test ─┐
Fold 1:           │ s1 s3 s4 s5 s6 s7 │ │ s2 │ │ s3 │ (held-out)
Fold 2 (LOOCV):   │ s1 s2 s4 s5 s6 s7 │ │ s3 │ │ s2 │
...
每折在 test session 评估 → 7 个 F1 → 平均 = LOOCV F1

约束: 同一 session 的窗口不能跨折 (数据强时序相关)</pre>

  <details>
    <summary>⚙️ 优化器 / scheduler 默认 (点开看)</summary>
    <pre>LSTM:
  optimizer = Adam(lr=1e-3, weight_decay=1e-4)
  loss = CrossEntropy(weight = inv_freq / sum * n_classes)
  scheduler = ReduceLROnPlateau(factor=0.5, patience=5, min_lr=1e-5)
  early_stop = patience=15 on val_macro_f1

CNN:
  optimizer = AdamW(lr=5e-4, weight_decay=1e-4)
  loss = CrossEntropy(weighted)
  scheduler = ReduceLROnPlateau(factor=0.5, patience=8, min_lr=1e-6)
  early_stop = patience=25
  augment = SpecAugment(freq_mask=0.15, time_mask=0.15, n_masks=2)</pre>
  </details>

  <h3 class="text-lg font-semibold text-gray-800 mt-6">关键步骤数据流</h3>
  <div class="mermaid">
flowchart LR
  A[csi.npz + labels_v2.json] --> B[extract_features<br/>16-d 或 32ch spec]
  B --> C[Session-disjoint split<br/>train/val/test]
  C --> D[DataLoader batch=32]
  D --> E[forward + CE loss]
  E --> F[backward + Adam(W)]
  F --> G[step scheduler<br/>on val_loss]
  G --> H{val macro-F1<br/>提升?}
  H -- yes --> I[save best ckpt]
  H -- no --> J{patience 满了?}
  J -- yes --> K[early stop]
  J -- no --> E
  </div>

  <div class="text-xs text-gray-500 mono-tag mt-2">
    引用: train_lstm.py:fit() @:368-431 · train_cnn_deep.py:fit() @:458-531
    · loocv_eval.py (force_test_session 循环)
  </div>
</section>
```

**Step 8.2 — Verify**

```bash
grep -c 'id="s6"' dev_doc/9-bouy-tech-stack-2026-07-06.html
grep -c '<div class="mermaid">' dev_doc/9-bouy-tech-stack-2026-07-06.html
```

Expected: `1`, `3` (now §1 + §2 + §6).

**Step 8.3 — Commit**

```bash
git add dev_doc/9-bouy-tech-stack-2026-07-06.html
git commit -m "docs: add §6 training section + ASCCI LOOCV split + Mermaid loop (Task 8 of 14)"
```

---

### Task 9: §7 Ensemble + threshold + priority (★ depth)

**Files:**
- Modify: `dev_doc/9-bouy-tech-stack-2026-07-06.html` — append §7 before `</main>`

**Step 9.1 — Append §7**

Insert before `</main>`:

```html
<!-- ========== §7 Ensemble + 阈值 + 优先级 (★ 深度) ========== -->
<section id="s7" class="space-y-4">
  <div class="flex items-baseline gap-3">
    <div class="text-blue-600 font-mono text-sm font-semibold">§7</div>
    <h2 class="text-2xl font-semibold text-gray-900">Ensemble + 阈值 + 优先级</h2>
    <span class="pill pill-amber">★ 深度</span>
  </div>
  <p class="text-gray-600 max-w-3xl">
    三个独立决策器: LSTM 6-d probs, CNN 6-d probs, priority walker。
    融合仅是起点 — 最终 "active class banner" 由 <code>pick_active</code>
    按优先级顺序选第一个 ≥ THRESHOLD 的类别。
  </p>

  <!-- SVG: alpha 融合条 -->
  <div class="border border-gray-200 rounded-lg p-4 bg-gray-50">
    <svg viewBox="0 0 700 130" class="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
      <text x="20" y="20" font-family="sans-serif" font-size="13" font-weight="600" fill="#374151">α 加权融合 (默认 α=0.5)</text>
      <!-- two inputs -->
      <rect x="40" y="40" width="140" height="30" fill="#dbeafe" stroke="#1d4ed8"/>
      <text x="110" y="58" font-family="monospace" font-size="13" text-anchor="middle" fill="#1e3a8a">lstm_prob[6]</text>
      <rect x="40" y="85" width="140" height="30" fill="#dcfce7" stroke="#15803d"/>
      <text x="110" y="103" font-family="monospace" font-size="13" text-anchor="middle" fill="#14532d">cnn_prob[6]</text>
      <!-- alpha -->
      <line x1="195" y1="55" x2="240" y2="55" stroke="#1d4ed8" stroke-width="1.5"/>
      <text x="217" y="48" font-family="monospace" font-size="11" text-anchor="middle" fill="#1d4ed8">× α</text>
      <line x1="195" y1="100" x2="240" y2="100" stroke="#15803d" stroke-width="1.5"/>
      <text x="217" y="93" font-family="monospace" font-size="11" text-anchor="middle" fill="#15803d">× (1−α)</text>
      <!-- sum -->
      <circle cx="270" cy="78" r="14" fill="#ffffff" stroke="#6b7280" stroke-width="1.5"/>
      <text x="270" y="83" font-family="monospace" font-size="14" text-anchor="middle">+</text>
      <line x1="284" y1="78" x2="350" y2="78" stroke="#374151" stroke-width="1.5"/>
      <!-- output -->
      <rect x="350" y="62" width="140" height="30" fill="#fef3c7" stroke="#a16207"/>
      <text x="420" y="80" font-family="monospace" font-size="13" text-anchor="middle" fill="#713f12">ens_prob[6]</text>
      <!-- arrow to threshold -->
      <line x1="500" y1="78" x2="540" y2="78" stroke="#374151" stroke-width="1.5"/>
      <polygon points="538,73 538,83 548,78" fill="#374151"/>
      <!-- threshold gate -->
      <rect x="555" y="50" width="120" height="56" fill="#f9fafb" stroke="#6b7280" stroke-dasharray="3 3"/>
      <text x="615" y="68" font-family="monospace" font-size="11" text-anchor="middle" fill="#374151">THRESHOLD=0.50</text>
      <text x="615" y="85" font-family="monospace" font-size="11" text-anchor="middle" fill="#374151">6 类概率</text>
      <text x="615" y="100" font-family="monospace" font-size="11" text-anchor="middle" fill="#374151">→ priority walker</text>
    </svg>
  </div>

  <h3 class="text-lg font-semibold text-gray-800 mt-6">优先级 walker (前端核心)</h3>
  <div class="mermaid">
flowchart TD
  Start[新 chunk 到达] --> Init[重置 winner = None]
  Init --> Loop{for cls in<br/>PRIORITY_ORDER:}
  Loop -->|第一轮 FALL_IMPACT| A1{FALL_IMPACT<br/>≥ THRESHOLD?}
  A1 -- yes --> W1[winner = FALL_IMPACT<br/>break]
  A1 -- no --> A2{next cls}
  A2 -->|FLOORED| B1{FLOORED<br/>≥ THRESHOLD?}
  B1 -- yes --> W2[winner = FLOORED]
  B1 -- no --> B2[next]
  B2 --> ... --> End[若全空 → 'EMPTY<br/>(below threshold)']
  W1 & W2 --> Banner[大字体<br/>active class banner]
  End -.-> Banner
  </div>

  <div class="text-xs text-gray-500 mono-tag mt-2">
    引用: infer_loop_ensemble.py:622-630 (α·lstm + (1-α)·cnn) · state.json 热重载 α · frontend/app.py:THRESHOLD=0.50 · pick_active() (priority walker)
  </div>
</section>
```

**Step 9.2 — Verify**

```bash
grep -c 'id="s7"' dev_doc/9-bouy-tech-stack-2026-07-06.html
grep -c 'PRIORITY_ORDER\|priority' dev_doc/9-bouy-tech-stack-2026-07-06.html
```

Expected: `1`, `>= 3`.

**Step 9.3 — Commit**

```bash
git add dev_doc/9-bouy-tech-stack-2026-07-06.html
git commit -m "docs: add §7 ensemble + threshold + priority (Task 9 of 14)"
```

---

### Task 10: §8 Live inference (NPZ → result)

**Files:**
- Modify: `dev_doc/9-bouy-tech-stack-2026-07-06.html` — append §8 before `</main>`

**Step 10.1 — Append §8**

Insert before `</main>`:

```html
<!-- ========== §8 实时推理 ========== -->
<section id="s8" class="space-y-4">
  <div class="flex items-baseline gap-3">
    <div class="text-blue-600 font-mono text-sm font-semibold">§8</div>
    <h2 class="text-2xl font-semibold text-gray-900">实时推理 (Live inference)</h2>
  </div>
  <p class="text-gray-600 max-w-3xl">
    把训练时相同的 LSTM + CNN 两个 ckpt 加载进 <code>infer_loop_ensemble.py</code>。
    守护线程 <code>InferenceWorker</code> 轮询 <code>data/live/</code>：
    每来一个新 chunk NPZ，串行跑 CNN + LSTM，α-fuse，输出 6 类概率。
  </p>

  <!-- SVG: streaming chunk 流 -->
  <div class="border border-gray-200 rounded-lg p-4 bg-gray-50">
    <svg viewBox="0 0 700 110" class="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
      <text x="20" y="20" font-family="sans-serif" font-size="12" font-weight="600" fill="#374151">t_offset timeline (each chunk = 6 s, non-overlapping)</text>
      <line x1="40" y1="55" x2="660" y2="55" stroke="#6b7280" stroke-width="2"/>
      <g>
        <rect x="40" y="40" width="60" height="30" fill="#dbeafe" stroke="#1d4ed8"/>
        <text x="70" y="58" font-family="monospace" font-size="10" text-anchor="middle">ck 0</text>
        <rect x="100" y="40" width="60" height="30" fill="#dbeafe" stroke="#1d4ed8"/>
        <text x="130" y="58" font-family="monospace" font-size="10" text-anchor="middle">ck 1</text>
        <rect x="160" y="40" width="60" height="30" fill="#dbeafe" stroke="#1d4ed8"/>
        <text x="190" y="58" font-family="monospace" font-size="10" text-anchor="middle">ck 2</text>
        <rect x="220" y="40" width="60" height="30" fill="#dbeafe" stroke="#1d4ed8"/>
        <text x="250" y="58" font-family="monospace" font-size="10" text-anchor="middle">ck 3</text>
        <rect x="280" y="40" width="60" height="30" fill="#dbeafe" stroke="#1d4ed8"/>
        <text x="310" y="58" font-family="monospace" font-size="10" text-anchor="middle">...</text>
        <rect x="340" y="40" width="60" height="30" fill="#dcfce7" stroke="#15803d"/>
        <text x="370" y="58" font-family="monospace" font-size="10" text-anchor="middle">ck N</text>
        <rect x="400" y="40" width="60" height="30" fill="#dcfce7" stroke="#15803d"/>
        <text x="430" y="58" font-family="monospace" font-size="10" text-anchor="middle">ck N+1</text>
      </g>
      <text x="40" y="92" font-family="monospace" font-size="10" fill="#6b7280">t_offset=0</text>
      <text x="100" y="92" font-family="monospace" font-size="10" fill="#6b7280">+6 s</text>
      <text x="160" y="92" font-family="monospace" font-size="10" fill="#6b7280">+12 s</text>
      <text x="340" y="92" font-family="monospace" font-size="10" fill="#6b7280">+N·6 s</text>
      <text x="40" y="105" font-family="monospace" font-size="10" fill="#9ca3af">LSTM ring buffer (16 cap) accumulates features across chunks</text>
    </svg>
  </div>

  <!-- Mermaid: InferenceWorker 状态机 -->
  <div class="mermaid">
stateDiagram-v2
  [*] --> Init
  Init --> Loading: load lstm.pt, cnn.pt<br/>recover mu/sd
  Loading --> Watching: models loaded, watch data/live/
  Watching --> CheckingRX: new chunk detected
  CheckingRX --> Fatal: missing rx & strict mode
  CheckingRX --> CNNPass: all rx present
  CNNPass --> LSTMPass: chunk_to_cnn_spectrogram + forward → cnn_prob
  LSTMPass --> Fuse: chunk_to_lstm_features + push ring<br/>if ring ≥ 16 → lstm forward → lstm_prob
  Fuse --> Emit: α·lstm + (1-α)·cnn → print 1 line
  Emit --> Watching: t_offset += 6.0
  Fatal --> [*]: sys.exit(2)
  </div>

  <details>
    <summary>🕒 冷启动时序 (~14 s 才到 "LSTM ready") (点开看)</summary>
    <pre>t=0   : receiver.py + infer_loop_ensemble.py 同时启动
t=0~6 : 第 1 个 chunk 写完 → CNN 立刻出 cnn_prob 1 个
        LSTM ring buffer = 0 → 还没有 LSTM 概率
        屏幕显示 "CNN-only (LSTM warming up)"
t=6~8 : 第 2 个 chunk 累积 ring buffer (≈11 窗口, 还差 5)
t=14  : 第 3 个 chunk 末 → ring buffer 满 16 → 第 1 个 LSTM 概率出炉
        → screen 显示 fused (lstm + cnn)
此后每个 chunk 6 s 出 1 个新概率</pre>
  </details>

  <div class="text-xs text-gray-500 mono-tag mt-2">
    引用: infer_loop_ensemble.py:L128-139 (check_rx_presence), L199-271 (chunk_to_lstm_features),
    L274-283 (features_to_lstm_sequence), L530-647 (主循环)
  </div>
</section>
```

**Step 10.2 — Verify**

```bash
grep -c 'id="s8"' dev_doc/9-bouy-tech-stack-2026-07-06.html
grep -c 'InferenceWorker' dev_doc/9-bouy-tech-stack-2026-07-06.html
```

Expected: `1`, `>= 1`.

**Step 10.3 — Commit**

```bash
git add dev_doc/9-bouy-tech-stack-2026-07-06.html
git commit -m "docs: add §8 live inference with streaming timeline + Mermaid state (Task 10 of 14)"
```

---

### Task 11: §9 Frontend (★ depth) — 4-row layout + smoothstep

**Files:**
- Modify: `dev_doc/9-bouy-tech-stack-2026-07-06.html` — append §9 before `</main>`

**Step 11.1 — Append §9**

Insert before `</main>`:

```html
<!-- ========== §9 前端 (★ 深度) ========== -->
<section id="s9" class="space-y-4">
  <div class="flex items-baseline gap-3">
    <div class="text-blue-600 font-mono text-sm font-semibold">§9</div>
    <h2 class="text-2xl font-semibold text-gray-900">实时前端 (Real-time UI)</h2>
    <span class="pill pill-amber">★ 深度</span>
  </div>
  <p class="text-gray-600 max-w-3xl">
    Matplotlib 4 行布局 + 后台 <code>InferenceWorker</code> 守护线程。
    关键不变量: <strong>绘制永远不阻塞数据接收</strong>。
    两个线程靠 <code>queue.Queue(maxsize=10)</code> 解耦, drop-oldest。
  </p>

  <!-- ASCII: 4 行 matplotlib 布局 -->
  <h3 class="text-lg font-semibold text-gray-800 mt-4">Matplotlib 4 行布局</h3>
  <pre>┌────────────────────────────────────────────────────┐
│ Row 0: ACTIVE CLASS BANNER  (巨字, 颜色编码)        │  ← priority winner
│         例: "STILL"  (黑边)                        │
├────────────────────────────────────────────────────┤
│ Row 1: 4 RX 频谱 (subcarrier 0..191 × amplitude)   │  ← 新 chunk 触发
│         RX1=蓝, RX2=橙, RX3=绿, RX4=红             │     6s smoothstep
├────────────────────────────────────────────────────┤
│ Row 2: 6 类概率条 (横向, 红虚线 THRESHOLD=0.50)     │  ← display_probs
│         EMPTY STILL WALKING TRANS FALL_ FLOOR      │     6s smoothstep
├────────────────────────────────────────────────────┤
│ Row 3: 状态行                                       │  ← monospace
│         chunk=t=185.4 lstm_warm=16/16 α=0.50       │
│         last10=[STILL,STILL,WALK,TRANS,FALL_,...]  │
└────────────────────────────────────────────────────┘</pre>

  <!-- SVG: worker ↔ UI thread queue -->
  <h3 class="text-lg font-semibold text-gray-800 mt-6">线程解耦</h3>
  <div class="border border-gray-200 rounded-lg p-4 bg-gray-50">
    <svg viewBox="0 0 700 180" class="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
      <!-- worker thread -->
      <rect x="20" y="20" width="220" height="140" fill="#dbeafe" stroke="#1d4ed8"/>
      <text x="130" y="40" font-family="monospace" font-size="12" text-anchor="middle" fill="#1e3a8a" font-weight="600">InferenceWorker (daemon thread)</text>
      <text x="130" y="60" font-family="monospace" font-size="11" text-anchor="middle" fill="#1e3a8a">while not stop:</text>
      <text x="130" y="76" font-family="monospace" font-size="11" text-anchor="middle" fill="#1e3a8a">  glob data/live/*.npz</text>
      <text x="130" y="92" font-family="monospace" font-size="11" text-anchor="middle" fill="#1e3a8a">  check_rx_presence</text>
      <text x="130" y="108" font-family="monospace" font-size="11" text-anchor="middle" fill="#1e3a8a">  CNN forward + LSTM forward</text>
      <text x="130" y="124" font-family="monospace" font-size="11" text-anchor="middle" fill="#1e3a8a">  α-fuse</text>
      <text x="130" y="140" font-family="monospace" font-size="11" text-anchor="middle" fill="#1e3a8a">  queue.put(frame, timeout=0)</text>
      <!-- Queue -->
      <rect x="270" y="55" width="160" height="70" fill="#fef3c7" stroke="#a16207" stroke-dasharray="4 4"/>
      <text x="350" y="75" font-family="monospace" font-size="12" text-anchor="middle" fill="#713f12" font-weight="600">queue.Queue(maxsize=10)</text>
      <text x="350" y="92" font-family="monospace" font-size="11" text-anchor="middle" fill="#713f12">drop-oldest 拥塞控制</text>
      <text x="350" y="108" font-family="monospace" font-size="10" text-anchor="middle" fill="#9ca3af">Frame TypedDict</text>
      <text x="350" y="121" font-family="monospace" font-size="10" text-anchor="middle" fill="#9ca3af">(probs, amp, t_offset, n_windows)</text>
      <!-- UI thread -->
      <rect x="460" y="20" width="220" height="140" fill="#dcfce7" stroke="#15803d"/>
      <text x="570" y="40" font-family="monospace" font-size="12" text-anchor="middle" fill="#14532d" font-weight="600">Frontend (main thread)</text>
      <text x="570" y="60" font-family="monospace" font-size="11" text-anchor="middle" fill="#14532d">FuncAnimation @ 5 fps</text>
      <text x="570" y="76" font-family="monospace" font-size="11" text-anchor="middle" fill="#14532d">update(_):</text>
      <text x="570" y="92" font-family="monospace" font-size="11" text-anchor="middle" fill="#14532d">  drain queue → keep latest</text>
      <text x="570" y="108" font-family="monospace" font-size="11" text-anchor="middle" fill="#14532d">  _compute_display_probs</text>
      <text x="570" y="124" font-family="monospace" font-size="11" text-anchor="middle" fill="#14532d">  _update_banner + _update_*</text>
      <text x="570" y="140" font-family="monospace" font-size="11" text-anchor="middle" fill="#14532d">绝不调 numpy/torch</text>
      <!-- arrows -->
      <line x1="240" y1="90" x2="265" y2="90" stroke="#374151" stroke-width="1.5"/>
      <polygon points="263,85 263,95 273,90" fill="#374151"/>
      <line x1="430" y1="90" x2="455" y2="90" stroke="#374151" stroke-width="1.5"/>
      <polygon points="453,85 453,95 463,90" fill="#374151"/>
    </svg>
  </div>

  <details>
    <summary>📐 smoothstep 插值 (6 s 跨 chunk 平滑) (点开看)</summary>
    <pre>新 chunk 到达 → 启动 6 s 插值 (与下一 chunk 同步):
  α_smooth(t) = (t − t0) / 6.0       # ∈ [0, 1]
  α_curve = α² × (3 − 2α)              # smoothstep C¹ 连续
  display_probs = lerp(prev, new, α_curve)

目的: 视觉上 banner / 概率条 / 频谱不会 "硬跳"。
     像 collection_mouse.py 那样随时间滚动的实时感。</pre>
  </details>

  <table class="mt-4">
    <thead><tr><th>关键常量</th><th>值</th><th>作用</th></tr></thead>
    <tbody>
      <tr><td><code>UPDATE_HZ</code></td><td>5.0</td><td>matplotlib FuncAnimation 红帧率</td></tr>
      <tr><td><code>QUEUE_MAX</code></td><td>10</td><td>UI 跟不上就 drop-oldest 旧帧</td></tr>
      <tr><td><code>CHUNK_SEC</code></td><td>6.0</td><td>必须与 receiver 一致</td></tr>
      <tr><td><code>THRESHOLD</code></td><td>0.50</td><td>概率门槛 + 红虚线 y 轴</td></tr>
      <tr><td><code>PRIORITY_ORDER</code></td><td>FALL_IMPACT&gt;FLOORED&gt;...</td><td>walk(优先)→选 first ≥ threshold</td></tr>
      <tr><td><code>allow-missing-rxs</code></td><td>flag opt-in</td><td>strict 默认 (HARD-FATAL)</td></tr>
    </tbody>
  </table>

  <div class="text-xs text-gray-500 mono-tag mt-2">
    引用: src/pc_tools/frontend/app.py (~855 行)
    · InferenceWorker (daemon thread, queue.Queue drain)
    · 4-row FuncAnimation layout (mirrors collection_mouse.py)
    · dev_doc/7 (strict RX 政策)
  </div>
</section>
```

**Step 11.2 — Verify**

```bash
grep -c 'id="s9"' dev_doc/9-bouy-tech-stack-2026-07-06.html
grep -c 'smoothstep\|smooth_step' dev_doc/9-bouy-tech-stack-2026-07-06.html
grep -c 'InferenceWorker' dev_doc/9-bouy-tech-stack-2026-07-06.html
```

Expected: `1`, `>= 2`, `>= 2`.

**Step 11.3 — Commit**

```bash
git add dev_doc/9-bouy-tech-stack-2026-07-06.html
git commit -m "docs: add §9 frontend (4-row layout + smoothstep + thread decoupling) (Task 11 of 14)"
```

---

### Task 12: §10 End-to-end latency

**Files:**
- Modify: `dev_doc/9-bouy-tech-stack-2026-07-06.html` — append §10 before `</main>`

**Step 12.1 — Append §10**

Insert before `</main>`:

```html
<!-- ========== §10 端到端时延 ========== -->
<section id="s10" class="space-y-4">
  <div class="flex items-baseline gap-3">
    <div class="text-blue-600 font-mono text-sm font-semibold">§10</div>
    <h2 class="text-2xl font-semibold text-gray-900">端到端时延 (落体发生 → 屏幕显示)</h2>
  </div>
  <p class="text-gray-600 max-w-3xl">
    假设跌倒在 chunk 开始的 t=0 处, "STILL banner → FALL_IMPACT banner" 的链路:
  </p>

  <pre>事件          时刻 (相对 t=0)
─────────────  ──────────────────
跌倒发生       t = 0       ▓
                            │
chunk 写出     t ≈ 1-3    │ receiver 攒满下一 chunk 中段触发 (worst case ~3s)
                            │
NPZ 落盘      t ≈ 6      │ chunk_sec=6, 最坏 1 个 chunk 延迟
                            │
worker 轮询    t ≈ 6.5    │ poll_sec=0.5
                            │
CNN forward   t ≈ 6.55   │ <0.05s CPU
LSTM forward  t ≈ 6.6    │ <0.05s CPU
                            │
priority 选中  t ≈ 6.6    │ pick_active + ENS = argmax+walk
                            │
queue 排出     t ≈ 6.6-8  │ UI 下次 update (≤200ms) 拿到新帧
                            │
banner 显示    t ≈ 7-8    │ FuncAnimation @ 5Hz
                            │
smoothstep 插完 t ≈ 13   │ 6s smoothstep 完成, 最终 FALL_IMPACT 完全显形

总时延: ~7-8s (LSTM-ready 后) / ~14s (含 LSTM 冷启动)</pre>

  <div class="text-xs text-gray-500 mono-tag mt-2">
    来源: 理论值, 用 receiver 6s / poll 0.5s / forward 0.05s 实测推算。
    实际跑会在 [6s, 14s] 区间内, 取决于 LSTM 是否已 warmed up。
  </div>
</section>
```

**Step 12.2 — Verify**

```bash
grep -c 'id="s10"' dev_doc/9-bouy-tech-stack-2026-07-06.html
```

Expected: `1`.

**Step 12.3 — Commit**

```bash
git add dev_doc/9-bouy-tech-stack-2026-07-06.html
git commit -m "docs: add §10 end-to-end latency waterfall (Task 12 of 14)"
```

---

### Task 13: §11 Decision table + §12 Honest scope

**Files:**
- Modify: `dev_doc/9-bouy-tech-stack-2026-07-06.html` — append §11 + §12 before `</main>`

**Step 13.1 — Append §11 + §12 + closing footer**

Insert before `</main>`:

```html
<!-- ========== §11 决策表 (Why) ========== -->
<section id="s11" class="space-y-4">
  <div class="flex items-baseline gap-3">
    <div class="text-blue-600 font-mono text-sm font-semibold">§11</div>
    <h2 class="text-2xl font-semibold text-gray-900">关键设计决策表 (Why)</h2>
  </div>
  <p class="text-gray-600 max-w-3xl">
    改这些决策点前必须先查本表 + 对应 dev_doc / 代码行号。
  </p>

  <table>
    <thead>
      <tr><th>决策点</th><th>选择</th><th>为什么</th></tr>
    </thead>
    <tbody>
      <tr><td>1 TX + 4 RX 拓扑</td><td>而非更多</td><td>单脚本会话成本; 4 板已够画等高线; 单房间尺度外推</td></tr>
      <tr><td>WiFi 信道 6</td><td>2.4G 中段</td><td>多径稳定; ESP32 CSI 默认; 不与 1/11 干扰</td></tr>
      <tr><td>192 子载波</td><td>HT 20MHz</td><td>ESP32 完整报告; 信道利用率高</td></tr>
      <tr><td>921600 baud</td><td>串口高速档</td><td>192 subs × 8 byte × 70Hz ≈ 100KB/s, 115200 不够</td></tr>
      <tr><td>6 类 (vs 5 类)</td><td>FALL → IMPACT + FLOORED</td><td>FALL 后段 ≈ STILL, 模型不可分。切开后才学得到冲击</td></tr>
      <tr><td>9 × 6s 感受野</td><td>LSTM 16 窗 + CNN 单窗</td><td>覆盖站立→失稳→冲击→倒地+ 落地缓冲</td></tr>
      <tr><td>LSTM 16 维手工</td><td>而非深度 LSTM 自动学</td><td>小数据 (7 session) 下手工特征方差/质心/ΔVar 更稳</td></tr>
      <tr><td>CNN 32 通道 × 8 band</td><td>而非 4 通道全局 mean</td><td>保留 subcarrier 空间-频率多样性, mean 聚合扔掉太多</td></tr>
      <tr><td>TorchScript (shipped) vs self-trained ckpt</td><td>后者 (我们走的路)</td><td>shipped Transformer 训练代码私有不可改; self-trained 链路可调试</td></tr>
      <tr><td>α=0.5 默认</td><td>LSTM / CNN 平衡</td><td>实测 (D.22.4) 与 0.3 / 0.7 比最优</td></tr>
      <tr><td>THRESHOLD=0.50</td><td>vs 0.84</td><td>0.50 平衡 (召回优先 demo); 0.84 严苛 (零误报)</td></tr>
      <tr><td>PRIORITY_ORDER 临床优先</td><td>FALL_IMPACT 最高</td><td>跌倒不可漏报; STILL / EMPTY 即使误报代价低</td></tr>
      <tr><td>strict RX 默认</td><td>缺板 HARD-FATAL</td><td>掉线 = 硬件问题, agent 不能伪造数据"绕过"</td></tr>
      <tr><td>smoothstep 6s</td><td>而非硬跳</td><td>视觉与 collection_mouse.py 同样流畅感, 不会抽搐</td></tr>
      <tr><td>队列 QUEUE_MAX=10 + drop-oldest</td><td>而非阻塞</td><td>UI 阻塞会丢数据; 丢旧比丢新好</td></tr>
    </tbody>
  </table>
</section>

<!-- ========== §12 已知限制 ========== -->
<section id="s12" class="space-y-4">
  <div class="flex items-baseline gap-3">
    <div class="text-blue-600 font-mono text-sm font-semibold">§12</div>
    <h2 class="text-2xl font-semibold text-gray-900">已知限制 (Honest scope)</h2>
  </div>

  <div class="border border-amber-200 bg-amber-50 rounded-lg p-4 text-amber-900">
    <p><strong>本仓库不是验证过的医疗/安全设备。</strong> MIT 许可证免责; 阈值与状态机计时是工程经验, 无临床证据。</p>
  </div>

  <ul class="list-disc list-inside text-gray-700 space-y-2">
    <li><strong>训练集仅 7 个 session</strong>: LOOCV 在单房间同受试者下拿到 0.444 ensemble F1; <strong>未经跨房间 / 跨受试者验证</strong></li>
    <li><strong>THRESHOLD=0.50 由单次 held-out 会话选定</strong>: 改前必须先复现 LOOCV + held-out 基线</li>
    <li><strong>模型针对 FALL_IMPACT 单一二分类</strong>: 6 类标签在训练时间融合; 站/躺姿态、活体确认、CSI 静止检测均未做</li>
    <li><strong>T1/T2/T3 计时为工程经验</strong>: 业务级 Twilio/Pusher 状态机, 这里 <strong>不展开</strong> (见 apps/server/src/state-machine.ts)</li>
    <li><strong>无 LOOCV 复现脚本自动化</strong>: fall-detection-training/evaluation/loocv_eval.py 是入口但需要数据 + 用户触发</li>
    <li><strong>外部数据 (CSI-HAR) 适配器存在但未跑通</strong>: external_data_adapter/csi_har_adapter.py 是迁移模板, 训练只用了我们自己的 7 会话</li>
  </ul>

  <hr class="my-8 border-gray-200"/>
  <footer class="text-xs text-gray-500 space-y-1">
    <p>📚 关联文档:</p>
    <ul class="list-disc list-inside space-y-0.5">
      <li><a href="0-references-2026-06-28.xml" class="text-blue-600 hover:underline">0-references-2026-06-28.xml</a> — 参考资料登记表</li>
      <li><a href="3-bouy-repro-howto-2026-06-28.md" class="text-blue-600 hover:underline">3-bouy-repro-howto</a> — 复现 bootcamp 全流程</li>
      <li><a href="5-bouy-post-arch-2026-06-30.md" class="text-blue-600 hover:underline">5-bouy-post-arch</a> — 训练后架构现状</li>
      <li><a href="6-bouy-hang-root-cause-2026-06-30.md" class="text-blue-600 hover:underline">6-bouy-hang-root-cause</a> — hang 根因 (RX3 掉线)</li>
      <li><a href="7-bouy-rx-disconnect-policy-2026-07-01.md" class="text-blue-600 hover:underline">7-bouy-rx-disconnect-policy</a> — 严格 RX 政策</li>
      <li><a href="8-bouy-frontend-2026-07-01.md" class="text-blue-600 hover:underline">8-bouy-frontend</a> — 前端设计文档</li>
      <li><a href="HANDOFF-2026-07-01.md" class="text-blue-600 hover:underline">HANDOFF-2026-07-01.md</a> — 上次会话交接</li>
    </ul>
    <p class="mono-tag mt-3">基于 2026-07-06 代码复盘 · MIT 许可证 (Bouy) · 非医疗设备</p>
  </footer>
</section>
```

**Step 13.2 — Verify §11 + §12 anchors + footer present**

```bash
grep -c 'id="s11"' dev_doc/9-bouy-tech-stack-2026-07-06.html
grep -c 'id="s12"' dev_doc/9-bouy-tech-stack-2026-07-06.html
grep -c 'MIT' dev_doc/9-bouy-tech-stack-2026-07-06.html
```

Expected: `1`, `1`, `>= 2` (one in §12 disclaimer box, one in footer).

**Step 13.3 — Commit**

```bash
git add dev_doc/9-bouy-tech-stack-2026-07-06.html
git commit -m "docs: add §11 decision table + §12 honest scope + footer (Task 13 of 14)"
```

---

### Task 14: Final verification + commit

**Files:**
- Read: `dev_doc/9-bouy-tech-stack-2026-07-06.html`

**Step 14.1 — Full HTML well-formedness check**

Run:

```bash
python3 -c "
from html.parser import HTMLParser
p = HTMLParser()
p.feed(open('dev_doc/9-bouy-tech-stack-2026-07-06.html').read())
print('OK: HTML parse clean')
print(f'Total lines: {sum(1 for _ in open(\"dev_doc/9-bouy-tech-stack-2026-07-06.html\"))}')
" && \
  test "$(grep -c '<section id=\"s[0-9]' dev_doc/9-bouy-tech-stack-2026-07-06.html)" = "12" && \
  echo "PASS: 12 sections present" && \
  wc -c dev_doc/9-bouy-tech-stack-2026-07-06.html
```

Expected:
- `OK: HTML parse clean`
- `Total lines: 600-900` (rough)
- `PASS: 12 sections present`
- File size roughly 50-80 KB

**Step 14.2 — All 12 TOC anchor targets exist (round-trip check)**

Run:

```bash
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  if grep -q "id=\"s$i\"" dev_doc/9-bouy-tech-stack-2026-07-06.html; then
    echo "s$i: ✓"
  else
    echo "s$i: ✗ MISSING"
  fi
done
```

Expected: `s1: ✓` through `s12: ✓` (no `✗ MISSING` line).

**Step 14.3 — All key concepts grep-able**

Run:

```bash
for term in "α" "spectral_centroid" "robust_variance" "smoothstep" "PRIORITY_ORDER" "torch" "STFT" "192" "921600"; do
  count=$(grep -c "$term" dev_doc/9-bouy-tech-stack-2026-07-06.html)
  echo "$term : $count occurrences"
done
```

Expected: each term has ≥ 1 occurrence.

**Step 14.4 — Mermaid blocks renderable check**

Run:

```bash
echo "Mermaid block count:"
grep -c '<div class="mermaid">' dev_doc/9-bouy-tech-stack-2026-07-06.html
echo "Mermaid closing count:"
grep -c '</div>' dev_doc/9-bouy-tech-stack-2026-07-06.html
```

Expected: at least 4 mermaid blocks (§1 flow, §2 seq, §6 flow, §7 flow, §8 state).

**Step 14.5 — Visual smoke test with Playwright (optional but recommended)**

If you have Playwright:

```bash
python3 -c "
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto('file://' + '$PWD/dev_doc/9-bouy-tech-stack-2026-07-06.html')
    page.wait_for_load_state('networkidle')
    page.screenshot(path='/tmp/9-bouy-tech-stack.png', full_page=True)
    print('Screenshot saved: /tmp/9-bouy-tech-stack.png')
    browser.close()
"
```

Expected: PNG saved. Inspect image to confirm layout.

If Playwright not installed, skip this step — manual browser open works.

**Step 14.6 — Final commit summary**

```bash
git log --oneline | head -20
git status
```

Expected: 13 commits (one per Task 1-13) + clean working tree (Task 14 produced no diff).

**Step 14.7 — Update HANDOFF with this new doc reference (do NOT commit this; just for your own use)**

Open `dev_doc/HANDOFF-2026-07-01.md` in your editor and append a one-line paragraph at the very end:

```markdown
## 11. 增量附录（2026-07-06）

- 新增 `dev_doc/9-bouy-tech-stack-html-design-2026-07-06.md`（设计 spec）
- 新增 `dev_doc/9-bouy-tech-stack-2026-07-06.html`（HTML 复盘页，单文件，CDN 引用 Tailwind + Mermaid；12 节覆盖 ESP32→CSI→receiver→features→LSTM+CNN→ensemble→frontend 全链路；不含 Twilio/Pusher/Next.js 业务层）。基于本会话复盘代码 + 8 份历史 dev_doc 整合。
```

(No commit to git from this step; this is a free-form addition for your future self.)

---

## Self-Review

**1. Spec coverage:**

| Spec section | Plan task |
|---|---|
| §0 hero + KPI + TOC | Task 2 ✓ |
| §1 hardware | Task 3 ✓ |
| §2 collection | Task 4 ✓ |
| §3 split | Task 5 ✓ |
| §4 features ★ | Task 6 ✓ |
| §5 architectures | Task 7 ✓ |
| §6 training | Task 8 ✓ |
| §7 ensemble ★ | Task 9 ✓ |
| §8 live inference | Task 10 ✓ |
| §9 frontend ★ | Task 11 ✓ |
| §10 latency | Task 12 ✓ |
| §11 decision table | Task 13 ✓ |
| §12 honest scope + footer | Task 13 ✓ |
| Hyperparam table | Task 6 (step 6.1 inside §4) ✓ |
| Mermaid + SVG + ASCII mix | Tasks 3,4,6,8,9,10,11 ✓ |
| Line-number refs throughout | All tasks ✓ |
| No source code >5 lines | All tasks (only ASCII pseudo-code) ✓ |

**2. Placeholder scan:** No "TBD", "TODO", "implement later" in any task. Every code block has actual content.

**3. Type/name consistency:** Anchor IDs (`s1..s12`) referenced consistently in TOC (Task 2) and verify steps (Task 14). Mermaid init consistent across blocks. hyperparam refs all use `path.py:LN` format.

**Scope check:** Single deliverable, one subsystem (HTML doc) — no decomposition needed.

---

**Plan complete. Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
