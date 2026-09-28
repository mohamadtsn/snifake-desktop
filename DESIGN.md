# DESIGN.md — Workbench

The design system of record. Every value in `src/theme.css` is here, with the
reason it is that value. When a design decision changes, this file changes in
the same commit; when the two disagree, this file is wrong and gets fixed.

Source material: `design/` (14 rendered screens) and the Figma file
`FonwwOWwiOA6bzum07z2oT`. Figma is the authority for numbers; the PNGs are the
authority for what a screen is supposed to feel like.

---

## 1. What the thing is

An 850×760 desktop workbench with four tabs and a modal preferences sheet.

The previous language — **Console**, a 420×504 single column with a signal bar,
a rocker switch and two drag-dismissed drawers — was dense and opaque: it hid
the tunnel's second stage behind a selector, and nothing on it told you what a
control would do before you pressed it. It is documented in §8 for the
decisions worth keeping; its CSS survives only in `src/theme-legacy.css` until
the last component that needs it is gone.

The workbench is a dark machined panel. A near-black canvas, a graphite window
sitting on it, inset cards a step darker still, and a 1px white hairline with a
specular top edge wherever one surface meets another. Nothing glows that is not
reporting a state.

**The one rule that outranks every other rule in this file** is carried over
from Console unchanged:

> **The interface never shows a reading it does not have.**

A bar that moves without data behind it is a lie the user cannot detect. The
mockups were drawn by a designer with no access to the engine, so they are full
of readings nothing produces: `-58 dBm`, an RTT sparkline, `1,420 pkts/s`,
`BUFFER: 1.4 MB / 16 MB`, `ENC: AES-128-GCM`. Every one of them was removed and
its layout slot refilled with something real — see §6 and the 2026-09-26
decision-log entry. The screens still compose the way they were drawn, because
only the content changed, never the slot.

### 1.1 Why green means running and amber means wait

Green is `active`. Amber is `starting`, `holding` and caution. Red is `fault`
and destructive. Blue acts and selects.

This is not the default reflex, and it was argued out once already (2026-08-27,
§8). On real equipment amber means *caution*: an all-amber healthy panel reads
as a fault that is not there. And the tunnel's `holding` state — fail-closed,
refusing to relay because the SNI stage is down — is the design **working**.
Red there would train people to distrust the state protecting them.

The consequence for code: `types.ts`'s `STATE_COLOR` and `TUNNEL_STATE_COLOR`
map `holding` and `starting` onto the same amber, deliberately.

---

## 2. Tokens

### 2.1 Surfaces — four solid fills, never an alpha stack

| Token | Value | What sits on it |
|---|---|---|
| `--color-canvas` | `#0b0c10` | behind the window; visible only as the 1px frame edge |
| `--color-surface` | `#15161a` | the window itself, the title bar, the footer |
| `--color-card` | `#1d2027` | cards, grouped lists, editor panes, modal bodies |
| `--color-inset` | `#0c0e14` | pressed into a card: segmented tracks, log wells, rule gutters |
| `--color-raised` | `#33353e` | lifted off a card: the selected segment thumb |
| `--color-raised-dim` | `#282a32` | secondary buttons, which share the thumb's weight |

**Every surface is a solid fill.** The mockups stack white and black alphas, so
a card inside a card inside a sheet lands on a different colour on every
screen — which is exactly why the three mockup families drifted apart (§7).
Solids cannot drift. They are also cheaper: WebKitGTK re-blends an alpha layer
on every repaint of anything underneath it.

### 2.2 Hairlines and the specular edge

| Token | Value |
|---|---|
| `--color-hairline` | `rgba(255,255,255,0.08)` |
| `--color-hairline-strong` | `rgba(255,255,255,0.14)` |
| `--shadow-specular` | `inset 0 1px 0 rgba(255,255,255,0.06)` |
| `--shadow-specular-strong` | `inset 0 1px 0 rgba(255,255,255,0.12)` |

One hairline value everywhere. The specular edge is what makes a surface read
as a machined plate rather than a rectangle of a slightly different grey: it
catches light on the top 1px only, so the eye reads a bevel where there is a
single declaration. Strong is for the two surfaces that have to look lifted —
the segment thumb and a primary button.

### 2.3 Depth — three shadows, and no more

| Token | Value | Meaning |
|---|---|---|
| `--shadow-sunken` | `inset 0 2px 4px rgba(0,0,0,0.05)` | pressed into its track (toggle track, segmented track) |
| `--shadow-lift` | `0 1px 1px rgba(0,0,0,0.05)` | sitting on a card (buttons, segment thumb) |
| `--shadow-modal` | `0 24px 70px rgba(0,0,0,0.85)` | the one modal layer |

There is exactly one modal elevation. Two would mean a sheet over a sheet, and
nothing in this application needs that.

### 2.4 Text — four alpha steps

| Token | Value | Job |
|---|---|---|
| `--color-t1` | `rgba(255,255,255,0.92)` | titles, values, the thing you came to read |
| `--color-t2` | `rgba(255,255,255,0.60)` | labels, secondary readouts, subtitles |
| `--color-t3` | `rgba(255,255,255,0.40)` | units, hints, placeholder-adjacent text |
| `--color-t4` | `rgba(255,255,255,0.22)` | disabled, and the `•` between footer readouts |

Alphas rather than greys so one ladder works unchanged on all four surfaces.
Contrast against `--color-card`: t1 ≈ 13.5:1, t2 ≈ 6.9:1, t3 ≈ 3.9:1. t3 is
therefore only ever used at 13px or larger, or for non-text, and t4 is never
used for text a sighted user has to read — it marks a control as unavailable,
and the control's `disabled` attribute is what actually says so.

### 2.5 Accents

| Token | Value | Meaning |
|---|---|---|
| `--color-accent` | `#007aff` | primary action, selection |
| `--color-ok` | `#34c759` | `running` / `active` |
| `--color-warn` | `#ff9500` | `starting` / `holding` / caution |
| `--color-bad` | `#ff453a` | `fault`, destructive |

Each has a `-soft` (15% wash, for the surface of a tinted badge or a selected
card) and a `-line` (30%, for its border), so a tinted surface is never mixed
by hand at a call site.

These are the iOS dark system colours. That is not decoration: it is the one
internally consistent family among the three the mockups used, and it is the
family the main dashboard and all three Preferences screens already use. See
§7 for what was discarded.

### 2.6 Type

Inter for the interface, JetBrains Mono for anything that is a number, an
address, a path, a digest or a rule line. Both ship in the bundle — this
application's users are frequently unable to reach Google Fonts, so a font that
does not ship is a font the interface does not have. `tabular-nums` is on at
`body`, so a changing port does not shuffle the characters after it.

| Token | Size / leading | Where |
|---|---|---|
| `--text-micro` | 9 / 9 | badge text (`TRAY MODE`, `CORE REQUIRED`) |
| `--text-mini` | 10 / 15 | version chips, the smallest mono readouts |
| `--text-note` | 11 / 16.5 | secondary text, footer readouts, section labels |
| `--text-body` | 12 / 18 | buttons, tabs, card body — the document default |
| `--text-row` | 13 / 19.5 | a preferences row, a field label, the title bar |
| `--text-title` | 17 / 25.5 | a tab's page title |

Six sizes, each with the leading it is drawn with, named rather than scaled:
this is one fixed-size window, not a responsive page, so `text-row` **is** what
a preferences row is, at 13px, always. Section labels are 11px semibold
uppercase at `+0.55px` tracking; 13px titles carry `-0.325px`, because Inter
needs negative tracking above 12px and positive tracking in small caps.

### 2.7 Shape

`--radius-xs` 4 · `--radius-sm` 6 · `--radius-md` 8 · `--radius-lg` 12 ·
`--radius-xl` 16, plus the pill.

Concentric, and that is the whole rule: a 12px group holds 8px rows holds 6px
controls, and the step between them is the padding between them. xs is badges,
sm is buttons and segments, md is rows and tracks, lg is cards and groups, xl
is a modal. Anything round is fully round — a toggle, a status pip, a close
button — never a large radius pretending to be.

The window itself is square. The mockups draw a 22px radius with an outer
shadow, which needs `transparent: true`; on Linux that depends on a compositor
and degrades into a black box, and on WebKitGTK under Wayland it has already
cost this project every pointer event in the window once (2026-08-27, §8).

### 2.8 Motion

| Token | Value |
|---|---|
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` |
| `--ease-in-out` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| `--dur-press` | 90ms |
| `--dur-fast` | 160ms |
| `--dur-panel` | 240ms |

The policy, unchanged from Console:

1. **Only `transform`, `opacity` and colour animate.** Anything else means
   layout, and layout at 60fps on WebKitGTK means dropped frames.
2. **Every animation has a `prefers-reduced-motion: reduce` opt-out.** The
   CSS-driven half is covered by the blanket rule at the foot of `theme.css`;
   components animating through `motion/react` read `useReducedMotion()`
   themselves.
3. **Springs live in `src/lib/motion.ts`.** One curve, one definition, so two
   drawers cannot hold two copies of it.
4. **Motion has to be motivated.** Tab changes cross-fade because the content
   is replaced; a sheet scales from 0.98 because it arrives from in front; list
   rows animate because they reorder. Nothing loops, and nothing moves to show
   that it can.

### 2.9 Shell geometry

`--h-titlebar` 52px · `--h-footer` 36px. Both fixed; the tab region is
whatever is left and is the only thing that scrolls. Window: 850×760, min
780×620, `resizable: true`, `decorations: false`, opaque.

---

## 3. Layout

```
AppShell (850×760, transparent, 12px radius)
├─ TitleBar   52px   app icon+version · tab bar (window-centred) · status · gear
├─ TabRegion  flex   the only scroll container: Telemetry | Sockets | Config | About
└─ StatusFooter 36px left: link and tunnel endpoints · right: live throughput
```

**The tab bar is centred on the window**, in a `pointer-events-none` layer
positioned `absolute inset-0` inside the header, with the control itself
taking the pointer back. The side clusters get `max-w-[31%]` so neither can
reach it.

This replaces the reserved-width approach. Both clusters used to reserve the
window-control cluster's width whether or not the controls were on that side,
so that the bar landed at the same x on macOS as on Linux. That is
compensation for a mis-centred bar rather than a centred one: it centres on
the space *between* the clusters, which is not where the eye looks, and it has
to be recomputed every time either cluster changes weight — which is exactly
what removing the core pill would have forced. Positioning in the window
dissolves the problem instead of balancing it, and it measures at a delta of
0.00px from the window centre at 780, 1000 and 1280 wide.

Every readout in the title bar and the footer still goes through a formatter
in `src/lib/readouts.ts` that truncates with a middle ellipsis: a
60-character profile name is a value the user chose, and it must not be able
to push a cluster into the tabs.

**The core pill is gone.** It read `core v1.13.21` whenever everything was
fine, which is a readout nobody reads, and it said nothing that is not said
better elsewhere: a missing core is stated by the tunnel actuator that
refuses to start, by `CoreSetupModal`, and by Preferences → Core with the
real path and the real digest. `coreLabel()` went with it; the pill was its
only consumer.

**The wordmark is gone too**, replaced by the application icon at 38px. The
PNG has its own transparent margin, so the plate that shows is about the height
of the 34px tab bar. It reads as the window's identity rather than as a chip
the size of the version label beside it. The name is already on the
window, in the tray, and on About.

The header, About and the favicon import the mark from `src-tauri/icons/`,
the directory the bundle's icons are generated into from `icon.svg`. There is
no copy under `public/`: there was one, the redraw in 58be5fb regenerated
`src-tauri/icons/` and not it, and the interface went on showing the retired
globe beside a green window icon. About shows the mark at 88px on its own
plate, without the inset box the globe used to sit in, under a wash in the
mark's own bloom green (`#4ed17f`) rather than the blue the globe was lit with.

Each tab is its own scroll container. Sockets and both Config tabs overflow at
760px **by design** — the mockups are clipped there and the clipped content is
real content. Telemetry does not overflow with the log closed.

### 3.1 Window controls

The mockups draw macOS traffic lights. The application ships on three platforms
with `decorations: false`, so instead of three coloured discs it renders one
neutral cluster of 28×28 ghost glyph buttons, matching the gear button already
in the header: *hide to tray*, *minimize*, *maximize/restore*.

The cluster sits **left of the app icon on macOS** and **right of the gear on
Windows and Linux**, which is where each platform's user looks for it. It no
longer needs a reserved width on the opposite side: the tab bar is centred on
the window rather than between the clusters, so the cluster's width cannot
move it. `CONTROLS_WIDTH` survives only as the cluster's own width.

Quit is reachable from the tray, and from the close glyph when *Close Window
Minimizes to Menu Bar* is off.

---

## 4. Component inventory

### 4.1 Primitives (`src/components/ui/`)

One concern each. A class used by exactly one component is that component's
business, not `theme.css`'s.

| Component | Role |
|---|---|
| `Icon` | every Material Symbols glyph, with one weight/fill/`opsz` policy |
| `Segmented` | the tab bar, the rule-list switcher, verbosity, import tabs |
| `Toggle` | the pill switch, 36×20 and 30×17 |
| `Card` | inset panel with the specular top edge, in three tones |
| `GroupedList` | the inset list, and `GroupedList.Row` (see below) |
| `Badge` | mono uppercase tag in the state colours |
| `StatusDot` | 6/8px pip, with its glow |
| `FieldRow` / `TextField` | label + input + right-aligned hint, and the undo stack the editors need |
| `Button` | primary, secondary, tinted, ghost, danger; the press state is a 1% scale |
| `ModalSheet` | Base UI `Dialog` in this language |
| `ConfirmDialog` | Base UI `AlertDialog` in this language, with an optional `tertiary` answer |

`ModalSheet` and `ConfirmDialog` are both Base UI rather than hand-rolled
because focus trapping, `Esc`, scroll lock and the `aria` wiring are the part
that is easy to get quietly wrong. The split between them is semantic: a sheet
is a place you go, and `Esc`/backdrop dismissing it is correct; a dialog asks a
question, and its two answers are buttons.

**`tinted` is the safe answer that is not the main one.** Accent wash, accent
line, accent text: it reads as positive without competing with the one
`primary` a footer may hold. It exists as a variant because Tailwind resolves
conflicting utilities by stylesheet order, not class order, so tinting a
`secondary` from outside is not reliable.

**`ConfirmDialog.tertiary` is a third answer of a different kind.** It sits
alone on the leading edge in `tinted`, with the cancel/confirm pair on the
trailing edge; the distance is what stops it reading as a third option in a
row, and the dialog widens from 420px to 480px to make room for that
distance. `disabledReason` disables it and puts the reason in a `title` on a
wrapper, because a disabled button takes no pointer events and a title on it
would never show. Only the unsaved-changes dialog uses it.

**`GroupedList` separators belong to the row, not to the group.** The rule
was `[&>*+*]:border-t` on the container, which draws full-bleed lines and
cuts the group into a table. It is now a `::before` on the row, inset to the
text column — `44px` with an icon (`px-4` 16 + icon 16 + `gap-3` 12), `16px`
without one — and hidden on `:first-child`. That is what macOS System
Settings does, and this list borrows its idiom. The row also takes a
`hover:bg-raised-dim/40` raise, so a row reads as operable.

**`GroupedList.Row` takes `on`**, which tints the row's icon with the accent.
It is not decoration: without it a group of switches reads as a column of
sentences that each happen to have a control beside them, and with it the
group reports its own state at a glance. Sockets' three safeguards pass it.

### 4.2 Primitives in `theme.css`

Only what Tailwind cannot express as a utility: `.mono`, `.pick` (opting a
copyable value back into text selection, against the window-wide
`user-select: none`), `.material-symbols-outlined`'s variation settings,
`.tab-scroll`, and `.log-lines`.

`.meter-ping` is the ring on `UpdateMeter`'s opt-in `pulse` dot. It reuses
`badge-ping`'s keyframes (one curve for one idea) in the accent, runs only
while bytes arrive, and is absent under reduced motion; the steady dot beneath
it stays.

`.log-lines` does not wrap. Log lines scroll sideways, because wrapping splits
an IPv4 address mid-octet, and a log you cannot scan by column is not a log.

### 4.3 The two subsystems that are restyled and never rewritten

**`ActivitySection`** owns the log. It drives `set_log_streaming`, backfills
through `get_log_buffer`, renders `log-batch` payloads behind an `openRef`
guard, and polls the buffer length once a second while closed to drive its
badge. That gate is the reason this application does not peg the CPU while
minimized: WebKitGTK keeps running JS and layout for hidden windows, so one
Tauri event per stdout line was measurably expensive. Only its markup changes.

**The rule editor** validates per keystroke against `src/lib/rules.ts`, which
duplicates `tunnel/rules.rs` on purpose and is tested against the same fixture
table so the duplication cannot drift in silence. Rust re-validates on save and
remains the authority.

---

## 5. Accessibility

- One focus ring for the application, `:focus-visible` only: a ring that
  appears on mouse-down makes every click look like an error.
- Pointer cursors are set once at the root, for every control, because a
  control is pointable because it is a control — not because someone remembered
  a utility class. Disabled controls keep the arrow, which is the distinction.
- Every toggle takes a required `aria-label`; a pill switch has no text.
- Every glyph is `aria-hidden`. The control around it carries the name.
- Colour never carries a state alone. Every state that has a colour also has a
  word (`ACTIVE`, `STANDBY`, `HOLD`, `FAULT`) and, where it is a pip, a shape.
- Error text sits below its field and reserves its height, so a message
  appearing shifts nothing.

---

## 6. The honesty pass over the mockups

Twelve invented readouts were removed and their slots refilled from real state.
The full table lives in the spec
(`docs/superpowers/specs/2026-09-26-console-to-workbench-redesign-design.md`
§4.1); the shape of it is:

| Mockup showed | Slot now shows |
|---|---|
| `-58 dBm` + 4-bar signal | the active profile's `LISTEN_HOST:PORT` |
| RTT sparkline, `RTT 42 ms` | the tunnel's `protocol · transport · security` |
| `12ms` header pill | the core version, or `no core` |
| `BUS: 0x88F2 // 1,420 pkts/s` | `<profile> → <connect ip>:<port>` |
| `ENC: AES-128-GCM` | `SNI: <tunnel sni>` |
| `BUFFER: 1.4 MB / 16 MB` | the log buffer's real line count |
| `ENGINE V4.2 CORE` | the pinned sing-box version from `core_status()` |
| `xray-core-darwin-arm64` | `core::asset_name()` |
| `Verified SHA-256` / `Notarized` | one `Signed` badge, the plugin's own check |
| `2 Active Links` / `1,420 pkts/s` | the two stages, by name and state |

Seven invented **controls** were removed outright, the two with the most
teaching value being *TLS Packet Fragmentation* (the engine does not fragment;
it injects an out-of-window fake ClientHello, and the row now says so in one
non-interactive line) and *Strict Kill Switch* (not in the `Routing` model;
`Default route through tunnel` on Sockets is the real control).

### 6.1 The second pass (`2026-09-27-workbench-revision`)

The `design/new/` mockups reintroduced four of the removed readouts. Three
were rejected again; one became measurable for the first time, which is the
phase the note below anticipated.

| Reintroduced | Verdict |
|---|---|
| Throughput bar / `DATA USED` | **Kept, and now measured.** `forward.rs` counts the bytes it relays through a counting `Read` adapter, and the tunnel's outbound dials that same listener, so one counter pair covers both stages. `Event::Traffic` carries cumulative totals once a second; the rate is derived from two samples in `src/lib/traffic.ts`. |
| `-58 dBm` + signal bars | Rejected again. There is no radio and nothing that resembles a signal strength. |
| `12 ms` header pill | Rejected again. There is no probe. The pill it would have shared the bar with — `core v1.13.21` — was itself removed this pass. |
| `TLS 1.3` in the protocol line | Rejected. The core negotiates the version and never reports it, so `VLESS · WS · TLS` is the whole of what is known. |
| `BUS: 0x88F2 // 1,420 pkts/s` | Rejected again. The sniffer only sees handshake packets to the upstream, so a rate drawn from it would not count what it claims to count. |

Three slots are now filled by a *measurement* rather than by a substitution:

| Where | Reads | Absent case |
|---|---|---|
| Footer, right | `↑ 850.5 KB/s  ↓ 7.0 MB/s` | `—` on both |
| Stage 1 tile | `RATE ↑ … ↓ …` | the line is not drawn |
| Stage 2 tile | `SESSION ↓ 10.1 MB ↑ 1.3 MB` | the line is not drawn |

`—`, never `0`: zero is a claim that nothing moved, and a dash is the absence
of a reading. A stopped stage clears its samples, so a rate cannot survive
the run that produced it.

One readout was added that is neither a measurement nor a substitution:
`STAGES n/2 SYNCHRONIZED`, derived from the two states. It is the one
summary the new mockups added that this application can make honestly.

And one clock changed meaning: a **faulted** stage freezes its uptime and
shows `STOPPED AT hh:mm:ss` instead of resetting to zero. "It ran for two
minutes and then died" is the useful fact; `00:00:00` is not.

---

## 7. Where the numbers came from

The 14 mockups were generated in three batches, and each batch used a different
palette family. This is not intent; it is noise, and treating it as intent is
how a design system ends up with fourteen greys.

| | Main dashboard `6:2958` | Preferences `9:3941` | Sockets `6:2188` |
|---|---|---|---|
| family | white alphas over graphite, iOS accents | solid Apple greys | **Material 3 dark tonal** |
| card | `rgba(255,255,255,.04)` | `#1d2027` | `#1d1f25` |
| inset | `rgba(0,0,0,.25)` | `#0c0e14` | `rgba(12,14,20,.3)` |
| `ok` | `#34c759` | `#34c759` | `#53e16f` |
| accent | `#007aff` | `#007aff` | `#adc6ff` |

Reconciliation, per surface:

- **canvas, surface** — the dashboard's, which is also the only screen that
  draws the canvas at all.
- **card, inset** — the dashboard's alphas, flattened over their own parents,
  land on `#1e1f23` and `#101114`; Preferences states `#1d2027` and `#0c0e14`
  as solids. They are the same colours within 4/255, so the solid spelling was
  taken: it is what a token needs, because it cannot compound.
- **raised** — Preferences' `#33353e`. The dashboard's `rgba(255,255,255,.08)`
  flattens to `#28292c`, which does not separate from `--color-card` at all,
  and Preferences is the only family that actually draws a selected segment
  thumb.
- **accents** — the iOS family the dashboard and Preferences share. Sockets'
  Material 3 accents were discarded wholesale rather than blended: half a
  tonal palette is not a palette.
- **`--color-bad` `#ff453a`** is the one value not literally present in those
  three frames, because none of them draws a destructive control. It is iOS
  dark `systemRed`, the completion of the set the other three come from.

### 7.1 A fourth family: `design/new/` (2026-09-27)

Three more frames arrived after the redesign shipped, showing only the parts
that change. **No token moved.** They are a fourth palette family, and the
reconciliation above already settled that question; what they contributed was
*structure*, and one measurement.

| What the frames proposed | What was taken |
|---|---|
| Round power button with a coloured halo | **Adopted.** The stage actuator was a pill switch in the card's corner — the same weight this system gives a preference, for the one action the screen exists for. The halo takes the status badge's colour, so the two cannot disagree. |
| Throughput bar / `DATA USED` | **Adopted, and now measured** — see §6.1. The first readout on this screen that is not a substitution. |
| `STAGES: 2/2 SYNCHRONIZED` | **Adopted.** Derived from the two states; the one summary the new frames added that this application can make honestly. |
| Inset separators in the safeguard list | **Adopted**, and generalised to `GroupedList` (§4.1). |
| Rounded window frame | **Adopted**, with no outer shadow — see §8. |
| `-58 dBm`, `12 ms`, `TLS 1.3`, `BUS: … pkts/s` | **Rejected a second time**, each for the reason in §6.1. |
| Their palette | **Ignored**, as §7 already decided for the third family. A fourth set of greys is still noise. |

Blank areas in those three frames are **not deletions**: they show only what
changes. `StatusStrip` and `ChannelRow` were untouched by this round.
- **text** — the plan's four alpha steps. Sockets' `#e2e2ea` / `#c1c6d7` /
  `#8b90a0` / `#414755` are white at .89 / .78 / .56 / .27: the same four-step
  ladder, independently drawn, which is the strongest evidence the ladder is
  right.

Nothing here averages two mockups. Where they disagreed, one was chosen and
the reason is in the row.

---

## 8. Decision log

**2026-09-28 — Routing mode is `md`.** The mode selector is the channel
card's decision, and at `sm` it read as a filter beside the profile
selectors. Verified at the 780px minimum and at 1000px: no segment label
truncates, the card row stays on one line, and the guarantee sentence keeps
the line count it had at `sm`.

**2026-09-28 — Preferences keeps one height.** The body is fixed at the
tallest pane's height (`PREFS_BODY_HEIGHT`, Core, 448px), so switching panes
never moves the frame; shorter panes leave space below, as System Settings
does. `ModalSheet` takes it as `bodyHeight` and sets it as the flex *basis*,
not `height`: `flex-1`'s 0% basis wins over `height` in a column container,
and the measured result of setting `height` was no change at all. On a
window shorter than that (the 780×620 minimum) the popup's `max-h` wins and
the body scrolls.

**2026-09-28 — Updates are followed on About, not in a modal.** `Update now`
closes the offer and moves to About (through the leave guard, like any tab
change), whose panel carries the meter; About's button names the phase,
Downloading then Installing. The meter gains an opt-in leading dot (`pulse`)
that pings in the accent while bytes arrive and holds still while installing;
reduced motion removes the ring and keeps the dot. The core download does not
opt in. Closing the offer no longer discards the update it found. Only the
silent launch check opens the offer; a check pressed on About reports into
About.

**2026-09-28 — The unsaved-changes question covers every draft and offers
Save.** Three owners (Sockets, the SNI editor, the tunnel editor), and every
exit that could discard one asks: the tab bar, and inside Config the list,
the kind switch, New and Import. The dialog names what would be lost and has
three answers: `Save and leave` alone on the leading edge in the accent tint,
then `Keep editing` and `Discard changes`. Save is disabled with the draft's
own first validation message when the draft is invalid; a save that fails
closes the dialog and leaves the user where they were, draft intact, with the
error shown the usual way. Quit keeps its own dialog, whose sentence now
names whichever draft is dirty; close-to-tray only hides the window, so it is
not guarded. The earlier "two answers only" ruling is reversed at the
author's request; the separation and the tint are what keep the third answer
from reading as a third option in a row.

**2026-09-28 — The tunnel's button starts the link.** The "Start the SNI
link first" warning box is removed. With the link down and nothing else
blocking, the tunnel's power button stays live, a quiet `text-t3` line under
its detail reads `starts the SNI link too`, and a press starts the link and
then the tunnel (`tunnelStartPlan`, `chainStep` in `lib/tunnelMachine.ts`).
The tunnel reads `starting` for the whole wait, elevation prompt included; a
cancelled prompt or a failed link puts it back to idle, and a second press
while it waits cancels the chain. Rejected: a disabled button with a lock
glyph (a dead control that still needs explaining) and a ping on the link's
button (an extra click to do what the user already asked for). The
core-missing and no-tunnel boxes stay: those need the user.
`ActuatorCard` takes this as `hint`, which is the opposite of `blocked`: the
control is live and the line says what else it does, so it gets no colour,
no icon and no box.

**2026-09-27 — The window is transparent and the root draws the frame.**
`transparent: true` on the `main` window (plus `macOSPrivateApi` in the
config *and* the `macos-private-api` cargo feature on `tauri`, or the build
script refuses the config), transparent `html` and `body`, and the root
element at `rounded-[12px] overflow-hidden` with a 1px inset ring.

**There is no outer margin and no drop shadow, deliberately.** With
`decorations: false` the window's own edge is the region the window manager
grabs for resizing; insetting the content to make room for a shadow takes
that grab region away, and a window that cannot be resized by its edge is a
worse window than one without a shadow. Depth comes from the inset ring.

**Known failure mode, accepted:** on a window manager with no compositor
(i3 without picom, say) the four corners render solid black rather than
transparent. That is what an unsupported alpha channel looks like; it is not
a bug in this code.

**This is the one change here that cannot be verified in CI.** A rounded
frame exists only at runtime and the build container has no desktop session.
It was confirmed as far as a browser can confirm it — 12px radius, clipped
content, transparent body — and needs `npm run tauri dev` for the rest.

**2026-09-27 — `ring-inset` is not a modifier in this project.** Tailwind v4
generates a *colour* utility for every `--color-*` token, and this theme has
`--color-inset`. So `.ring-inset` exists twice in the sheet: once as
`--tw-ring-inset: inset` and once as `--tw-ring-color: var(--color-inset)` —
and the colour rule wins, painting a 1px opaque `#0c0e14` line instead of
the hairline that was asked for. Found on the root frame, where the ring
simply did not appear. **Use `inset-ring-*` instead**, which has no
collision, and never write `ring-inset` while a token of that name exists.

**2026-09-26 — The segmented control has a thumb that moves.** It had a
background that appeared on one segment and disappeared from another, which
is a different thing: a segmented control's whole point is that the
selection has a *position*, and you can see it change. One `layoutId` per
instance, on the `THUMB_SPRING`.

**2026-09-26 — The modal scale never animated, for the whole redesign.**
Tailwind v4 emits `scale-[0.98]` as the CSS `scale` property, not as part of
`transform`, and the popups' transition list named `opacity, transform,
translate`. Every sheet and dialog faded in at full size and the scale
snapped. Found by grepping the built stylesheet during the motion audit,
which is the only place the two halves of that bug are visible at once.

**2026-09-26 — A tab change cross-fades the incoming panel only.** Waiting
for the outgoing one to leave first would double the latency of the most
pressed control in the window. 140ms, opacity only.

**2026-09-26 — Console → Workbench.** The shipped interface was one 420×504
column: dense, with the tunnel's second stage behind a selector and no panel
explaining its own guarantee. Replaced by an 850×760 four-tab workbench in
which every panel states in words what it does *and does not* capture — which
is the single biggest usability gain in the change, larger than anything
visual. Spec:
`docs/superpowers/specs/2026-09-26-console-to-workbench-redesign-design.md`.

**2026-09-26 — Twelve mockup readouts were removed, and their slots kept.**
The designer had no access to the engine, so the screens report data nothing
produces. Each slot was refilled with a real value rather than deleted, so the
compositions survive; where nothing real existed, the control went. §6, and
§4.1 of the spec for the full table. The alternative — adding counters to the
engine so the mockup could be honest — is real work worth doing and is not
this change.

**2026-09-26 — One token set, normalized from three drifting mockup
families.** Recorded in §7 with the losing value in every row, so the next
change argues with a document instead of with a screenshot.

**2026-09-26 — Neutral window controls instead of macOS traffic lights.** The
one place this implementation deliberately departs from the mockups. Three
coloured discs on Linux are a costume; the cluster is the same 28×28 ghost
button the header already uses for the gear, and it sits where each platform's
user looks for it. §3.1.

**2026-09-26 — Surfaces are solid fills, not alpha stacks.** The mockups' own
inconsistency is the argument: the same card is three colours across three
screens because each was composited over a different parent. §2.1.

**2026-09-26 — Fonts are imported from `main.tsx`, not `theme.css`.** Through
CSS the `@fontsource` import is inlined by the Tailwind PostCSS plugin and its
`url(./files/…)` is left pointing at a directory the build never writes: every
face 404s and the window silently falls back to a system font. This had been
true of Geist since it was added, in every production bundle. Found by grepping
`dist/` for `.woff2` rather than by anything that type-checks.

**2026-09-26 — `@theme static`.** Tailwind v4 tree-shakes `@theme`, emitting
only the custom properties some generated utility happens to reference.
`types.ts` hands `var(--color-ok)` to an inline style, and `--h-titlebar` is
read by a component, so tokens must exist whether or not a utility mentions
them.

---

*Everything below this line is the Console era. It documents a language the
application no longer speaks, kept because the arguments are still the
arguments, and because deleting the record of what was tried is how a project
tries it twice.*

## 9. Decision log — Console era (historical)


**2026-09-07 — The Channels heading carries the way into the tunnel drawer.**
"With no tunnel configured none of this appears" was implemented literally, and
literally it meant the tunnel row — the only route to the drawer — was itself
behind "a tunnel exists". From a fresh install the feature was unreachable: no
way to create the first one. A chip on the engraved rule rather than an empty
channel row, because someone who never wants a tunnel should not be handed one
to dismiss. Found by installing the build, not by any check that passed on it.

**2026-09-06 — The instrument face gained a second reading.** One panel, two
rows, a hairline between them. Two panels would have said the two stages are
independent, and they are not: the tunnel dials the link. See §4.9.

**2026-09-06 — One switch became a bank of two.** The alternative was a small
secondary control inside the channel row, which would have made stopping the
tunnel a different *kind* of act from stopping the link. It is not. See §4.10.

**2026-09-06 — `HOLD` is amber, not red.** Fail-closed is the design working,
not the design failing. Red would train people to distrust the state that is
protecting them. See §1.1.

**2026-09-06 — The tunnel reading lost its own signal bar, and the window grew
to 660.** Both came out of rendering the panel for the first time and
measuring it. A second twenty-segment bar gave the subordinate reading the
weight of the primary one, and the two-stage column came to 497px inside a
560px window's 400px of scroller, so the channel selectors — the one row the
panel exists to keep in reach — started 8px below the fold. Neither was
visible from type-checking, the cross-target build, or a scan of every class
against `theme.css`; all of those passed on the broken layout.

**2026-09-06 — `box-shadow` is named as an animated property.** §2 had said
only five properties animate since before `.switch` and the input focus ring
existed, both of which animate `box-shadow`. The motion audit found the doc
was describing an app that had not existed for some time. The rule was
corrected rather than the code: the shadow swap *is* the tactile vocabulary,
it runs on one control under the pointer, and doing it with `transform` would
move the control instead of pressing it.

**2026-09-06 — `.chip` still has no press state, deliberately for now.** The
audit flagged it: a pressable element with no `:active` feedback. Not taken,
because `.chip` is app-wide and changing it would alter every existing chip
in a release whose subject is the tunnel. Recorded so it is a decision rather
than an oversight.

**2026-08-27 — Window is opaque and square-cornered.** It was
`transparent: true` with CSS-rounded corners. On WebKitGTK under Wayland that
leaves the GTK surface with an empty input region: the window renders but
receives **no pointer events at all**, so nothing in the app was clickable.
Removed `transparent`, `shadow` and `backgroundColor` from `tauri.conf.json`.
Not a compromise — a console has a bezel.

**2026-08-27 — Console replaces the previous dark-glass language.** The old
system (blue accent, 152px glowing power disc, 16–20px radii, translucent
raised cards) was the default aesthetic every desktop utility reaches for.
Direction taken from beautifului.dev's crafted-primitives approach —
consistent radii, minimal shadow, one accent, generous rules — and pushed
toward instrument rather than product.

**2026-08-27 — Amber for running… then reversed to phosphor green.** The
original call optimised for not looking like every other VPN client. The
counter-argument is stronger and won: amber conventionally means *caution* on
real equipment, so an all-amber healthy panel reads as a fault that is not
there. Green took `running`; amber kept `starting` and the log badge, which is
the job it is actually right for. See §1.1.

**2026-08-27 — Mono by default, sans for prose.** Every value in the app is
an address, a port or a clock. See §2.5.

**2026-08-27 — Profile chips → selector.** Switching restarts a running
engine; a one-click chip on the main panel was too easy to hit by accident,
and a rail's width tracked the profile count. See §4.3.

**2026-08-27 — The bezel left the sheet host.** With the title bar inside it,
opening the profile drawer made the window controls inert: no way to quit
without first closing the drawer.

**2026-08-28 — The profile drawer got a visible way out.** Drag-to-dismiss
and Esc both closed it, but neither is visible, and a drawer with no visible
exit is one people learn to distrust. Its header now uses the same three
slots as the editor's: leave on the left, view name in the middle, the one
action on the right.

**2026-08-28 — Pointer cursors, once, at the root.** See §5.

**2026-08-28 — Fields own their undo stack.** See §4.7.

**2026-08-28 — The update meter joined the system.** It arrived with a
pill radius (not one of the app's four), a sweep that was off-screen for 77%
of its cycle (measured), a readout inheriting the dialog's prose face, and a
button naming the wrong phase. Fixed rather than reverted: the underlying
call — real bytes, honest indeterminate state — was right, and is the same
call §4.1 makes about the status face. See §4.6.

**2026-08-28 — `.value-face`, for numbers on a prose surface.** `.prose-face`
switches a dialog to the sans and turns tabular figures off, which is correct
for a paragraph and wrong for a byte counter inside one. Applied to the
element itself, so it beats the inherited face without a cascade-layer
argument.

**2026-08-28 — About moved from an inline accordion to a bezel dialog.**
Version metadata at the foot of the scrolling operating panel is both a
non-standard place to look and a claim on height the controls needed. Every
desktop platform reaches it from the window's own chrome; this now does too.
See §4.5.

**2026-08-28 — `.chip` restored as the small secondary button.** It was
defined inside the profile-rail block and was deleted with it, leaving Save,
"+ New" and both About buttons rendering unstyled. It is now defined on its
own terms, since it outlived the rail it was written for.

**2026-09-05 — The stock globe was replaced by a drawn mark.** The old icon
was a blue wireframe globe with a red swap badge: a category illustration
that shared no surface, colour or geometry with the app it launched, and the
one asset the design system had never reached. See §6.

**2026-09-05 — The tray shows state by relighting the mark.** The status dot
in the icon's corner was drawn at icon resolution and then scaled to a 22px
panel, where it survived as a smudge — and it used a palette (`#2ecc71`,
`#e74c3c`) that belonged to no part of this design system. Both fixed: the
trace is the lamp, and the four values come from §2.4. See §6.

**2026-09-05 — About names who built it.** As a maker's plate rather than a
metadata row. See §4.5.

**2026-08-27 — Log lines stopped wrapping.** `break-all` was splitting IPv4
addresses across lines mid-octet.

**2026-08-27 — The status face is the only block allowed to take space.**
Filling leftover height with padding read as unfinished; filling it with a
throughput meter would have meant inventing data. Giving the readout real
size is the honest use of it.
