# DESIGN.md — Console

The design system of record. `src/theme.css` implements it; this file decides
it. If the two disagree, this file is wrong and should be fixed in the same
commit as the code.

---

## 1. What the thing is

A piece of network equipment rendered in software. Not an app with a hero
button — an instrument with a face, a set of readouts and one switch.

Everything below follows from that. The reason a decision like "amber means
caution" or "corners are 4px" is not arbitrary is that a console has a house
style, and we are inside it.

**Three laws.**

1. **Three signal colours, three meanings, no overlap.** Green is live and
   healthy, amber is in transition, red is fault, grey is the absence of
   signal. Nothing else in the app is coloured at all.
2. **Corners are tight.** 3px, 4px, 6px. A console is machined, not moulded.
3. **Rules and engraved labels do the work cards and shadows used to.** There
   is one elevated surface in the whole app and it is the drawer.

### 1.1 Why phosphor green, and why amber is not "good"

`running` was amber for one revision, on the argument that green-for-running
is a reflex every VPN client and status page already reaches for. That
argument was about differentiation only, and it lost to a stronger one about
meaning:

**On real equipment, an amber lamp means caution.** A router's amber link LED
is a degraded link. ISA-101 and every traffic light in the world use amber for
"attention, something is changing". A panel lit entirely amber while
everything is fine says the opposite of what it means, and a user glancing at
it reads a problem that is not there.

So green won the semantics — but not the generic green. `--color-live` is a
**CRT phosphor green**: desaturated enough to sit inside the graphite family,
and the archetypal colour of a terminal, which is what this app is dressed as.
It is not the mint (`#22c55e`) that ships as a framework default.

Amber kept the job it is actually right for: `starting`, and the unread-log
badge. Both mean "in transition, or worth a look".

The three-colour set is legible **because** it is learned. Reaching for an
unconventional colour to avoid a convention is a cost paid by the user.

---

## 2. Tokens

Every value the app uses is in `@theme` in `src/theme.css`. Nothing outside
that block invents a colour, a duration or a radius.

### 2.1 Surfaces — one cool-graphite family

| Token | Value | Used for |
|---|---|---|
| `--color-bg` | `#0d0e10` | the window |
| `--color-panel` | `#131518` | the status face, the selector, the drawer, menus |
| `--color-inset` | `#0a0b0c` | inputs, the log scroller |
| `--color-hover` | `#191c20` | hover fill, the switch's unlit top stop |

Each step is a **real lightness step**, not a translucent white overlay.
WebKitGTK composites a flat fill for free and re-blends an alpha layer on
every repaint of anything beneath it, so translucency here would cost frames
during log streaming for no visual gain.

### 2.2 Rules — three, with distinct jobs

| Token | Value | Job |
|---|---|---|
| `--color-line` | `#23262b` | **structural.** Separates regions. Nearly invisible by design. |
| `--color-edge` | `#2d3137` | **decorative.** Defines a control's boundary, draws engraved rules. |
| `--color-beam` | `#3b4048` | **lit.** Hover borders, the drag handle, the selected marker. |

A 1px `--color-line` disappears against `--color-panel`; that is deliberate
for separators and wrong for anything meant to be seen. Engraved rules use
`--color-edge` for exactly this reason.

### 2.3 Text — four steps

| Token | Value | Contrast on `--color-bg` | Job |
|---|---|---|---|
| `--color-text` | `#e9ebee` | 15.6:1 | values, the thing you came to read |
| `--color-dim` | `#969ba2` | 7.2:1 | secondary values, menu rows |
| `--color-faint` | `#6a6f76` | 4.6:1 | engraved labels |
| `--color-ghost` | `#2a2d32` | — | **never carries text.** Unlit bar segments, placeholders, em-dashes. |

`--color-ghost` failing contrast is not an oversight. It is defined as the
colour of *absence*, and anything it is applied to must also be conveyed
another way (the bar's `aria-label`, an input's real `<label>`).

### 2.4 Signal

| Token | Value | Notes |
|---|---|---|
| `--color-live` | `#4ed17f` | 10.0:1 on `--color-bg`. The accent: lit segments, `running`, focus rings, commit buttons. |
| `--color-live-deep` | `#2ea863` | the bottom stop of the lit switch |
| `--color-live-ink` | `#04150c` | the only dark-on-light pairing in the app |
| `--color-amber` | `#ffb224` | 10.9:1. `starting` and the unread-log badge — transition, not health. |
| `--color-amber-deep` | `#d98a00` | the `starting` wipe |
| `--color-st-error` | `#ff5c4d` | 6.5:1. Fault. |

State map (`src/types.ts`): `stopped → --color-st-stopped` (grey),
`starting → --color-amber`, `running → --color-live`,
`error → --color-st-error`.

`starting` and `running` differ in **both** hue and motion — amber with a
filling wipe, green with a steady scan — so the transition is legible from
either channel alone. That redundancy is what makes the moment the engine
comes up readable at a glance across the room.

### 2.5 Type

One face does almost everything: **Geist Mono Variable**, with
`font-variant-numeric: tabular-nums` set on `body`.

This is not decoration. Every value in this app is an address, a port or a
clock; in a proportional face the port column shifts as digits change, and
`1`/`l` and `0`/`O` stop being distinguishable in a hostname. The mono face
is a correctness feature that happens to also carry the console identity.

The sans (**Geist Variable**) is reserved for prose, via `.prose-face` on the
`AlertDialog`s. A paragraph set in mono is a ransom note.

**Tracking is size-specific.** One letter-spacing value is wrong somewhere.

| Token | Value | Applies to |
|---|---|---|
| `--track-engrave` | `0.14em` | uppercase labels ≤10px |
| `--track-label` | `0.06em` | uppercase 11–26px (the condition word) |
| `--track-value` | `0.005em` | mono values |
| `--track-body` | `-0.008em` | prose in dialogs |

### 2.6 Shape

`--radius-chip: 3px`, `--radius-control: 4px`, `--radius-panel: 6px`. Plus
`1px` on bar segments. That is the complete list.

### 2.7 Motion

| Token | Value | Job |
|---|---|---|
| `--ease-out` | `cubic-bezier(0.2, 0.9, 0.25, 1)` | everything that latches |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | the power glyph morph |
| `--ease-sheet` | `cubic-bezier(0.32, 0.72, 0, 1)` | the drawer only |
| `--dur-press` | 90ms | press feedback |
| `--dur-fast` | 150ms | colour and border changes |
| `--dur-panel` | 220ms | disclosure, menu |
| `--dur-sheet` | 380ms | the drawer |

Console motion is **short and mechanical**. Things latch; they do not float.
There is no overshoot curve in the file: overshoot without a velocity term
reads as elastic rather than physical, so anything that genuinely needs it
uses a `motion/react` spring, which has one.

Only `transform`, `opacity`, `color`, `background-color` and `border-color`
animate. The one exception is the disclosure panel's height, which is why it
carries `contain: paint`.

---

## 3. Layout

```
┌─────────────────────────────────────┐
│ bezel  ·  name │ condition │ ⌄ ─ ✕  │  36px, fixed, outside the sheet host
├─────────────────────────────────────┤
│ STATUS ───────────────────────────  │  ┐
│ ┌─────────────────────────────────┐ │  │
│ │ ▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮▮            │ │  │ the instrument face
│ │ CONDITION            UPTIME     │ │  │ (the one block allowed to
│ │ ACTIVE              00:14:07    │ │  │  take space)
│ └─────────────────────────────────┘ │  │
│ ROUTE ────────────────────────────  │  │ scrolls
│ LISTEN    127.0.0.1        :40443   │  │
│ UPSTREAM  104.18.4.130       :443   │  │
│ SNI       security.vercel.com   —   │  │
│ PROFILE ──────────────────────────  │  │
│ [ cloudflare            ▾ ]  [ ✎ ]  │  ┘
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │  fixed furniture:
│ │           ⏻  STOP               │ │  never scrolls off
│ └─────────────────────────────────┘ │
│ ▸ LOG ───────────────────────── 12  │
└─────────────────────────────────────┘
```

**Window: 420×504, min 380×440.** Sized to the content with the log closed.

**Two regions.** Everything above the bottom rule scrolls; the switch and the
log trigger do not. The primary control must never be scrolled off, and the
log has to be reachable without hunting for it.

**The bezel is outside the sheet host.** When the drawer is open the console
is dimmed and `inert`; the bezel is not, so quit and minimise stay reachable.
The drawer and its scrim both start 36px down for the same reason.

**Sections are separated by engraved rules, not cards.** A console is one
panel with its sections silkscreened onto it. The single exception is the
status face, which gets a `.panel` fill because it is the readout the window
exists to provide.

---

## 4. Components

| Component | What it is |
|---|---|
| `TitleBar` | the bezel: name, condition readout, two window glyphs (× hides to tray) |
| `StatusPanel` | the instrument face: 20-segment bar, condition, uptime |
| `PowerSwitch` | the only control that starts or stops the engine |
| `RouteRows` | the route as a three-column grid |
| `ProfileSelect` | the channel selector plus the way into the drawer |
| `Disclosure` | an engraved header made pressable |
| `ActivitySection` | owns all log state; drives `set_log_streaming` |
| `AboutDialog` | identity, metadata and the manual update check |
| `UpdateMeter` | real download bytes, in `App.tsx` beside the update dialog |
| `UpdateMeter` | the download bar in the update dialog — the only progress bar |
| `Sheet` / `ProfileSheet` / `ProfileEditor` | the drawer |

### 4.1 The signal bar

Twenty segments, driven entirely from CSS off `data-state`. A running console
costs **zero React renders** for the animation.

It encodes state and **only** state. There is deliberately no throughput
meter: the engine does not report bytes, and a bar that moves without data
behind it is a lie the user has no way to detect.

The update download bar is the one exception, and it is not one: the updater
reports the size of every chunk it receives, so that bar is backed by counted
bytes. Where the server sends no `Content-Length` it refuses to claim a
position and sweeps instead — an admission, not a guess.

- `stopped` — dark
- `starting` — a filling wipe, per-segment delay
- `running` — every segment lit, one opacity keyframe with a per-segment
  delay so a scan sweeps left to right. A per-segment delay rather than a
  moving gradient overlay, so nothing composites above the bar.
- `error` — the whole bar in muted red

Unlit segments carry `inset 0 1px 0 rgba(255,255,255,0.05)`. Without it the
bar reads as a printed graphic; with it, as a row of lamps catching light
from above. Every inset border in the file assumes that same single light
source directly above.

### 4.2 The power switch

A latching rocker, not a round button. Width is what says "primary", and a
rectangle can carry a word.

- Press drops it 1px into the panel and swaps the outer shadow for an inner
  one — the complete feedback vocabulary of a physical switch.
- `running` lights it: solid green carrying `--color-live-ink`. This is the
  only dark-on-light pairing in the app and it is reserved for the single
  most important control.
- `error` shakes it **once**. A loop nags; once reports.
- The label names the **action**, never the state: Start / Abort / Stop /
  Retry.
- Stop stays reachable while `starting`: an elevation prompt that never
  returns must not leave the only exit greyed out.
- It is **not keyed on `state`** — a remount would drop keyboard focus at
  precisely the moment the user is watching the panel change.

### 4.3 The profile selector

Replaced a rail of chips. Two reasons, both real:

1. **Safety.** Switching profiles while the engine is up restarts it. A chip
   rail put that one stray click away on the main panel. A selector costs two
   deliberate actions — open, then choose — and cannot be hit by accident.
2. **Layout stability.** A chip rail grows with the profile list, so the
   panel's shape depended on how many profiles you happened to have. The
   selector is one row forever.

The trigger shows the **route as well as the name**, because a name does not
tell you where traffic goes.

Inside the menu, the *selected* row is marked with a neutral `✓` and the
*running* row with a green rule down its side. These are different facts —
selecting while stopped only changes what Start will run — and green is
reserved for "carrying traffic".

### 4.4 The drawer

Base UI `Dialog` supplies focus trapping, `Esc` and scroll lock. The visual
layer and the drag are hand-rolled on Pointer Events, writing `transform`
straight onto the node: a drag has to track 1:1 and stay interruptible, and a
transition during a drag is what makes a sheet feel like it is on a rubber
leash.

- Portals into `.shell`, not `<body>`, so `inset` resolves against the
  console and the drawer stays inside the bezel.
- Grabbing a *closing* drawer resumes from its presentation transform.
- The drag physics live in `src/lib/gesture.ts` and are the one part of the
  frontend that is genuinely tested (`gesture.test.ts`), because they are the
  numbers that decide how it feels.
- Since switching moved to the selector, this is purely a management surface.

### 4.5 About

Reached from an `ⓘ` on the bezel, opening a **dialog**. It was an accordion
at the foot of the operating panel, which is a place nobody looks for version
metadata and which cost the console height it needed for controls.

The bezel is where every desktop already puts this — GNOME's header-bar menu,
Windows' Help menu, macOS' app menu — so it costs no discovery. The `ⓘ` sits
with the window controls but behind a hairline: it acts on the *app*, the
other two act on the *window*.

A `Dialog`, not the `AlertDialog` everything else uses. About asks nothing
and decides nothing, so Esc, the backdrop and Close must all dismiss it
without reading as "cancel".

**Typography inside it** is where the app's type scale gets used properly:

- The name is the bezel's engraved uppercase wordmark two steps up the scale
  (21px, `--track-label`). One product, one lockup — not a different
  treatment per surface. The hairline between name and version is the same
  separator the bezel puts between name and condition.
- The version is the second-most-read fact in an About box, so it sits on the
  name's baseline rather than buried as a table row.
- The description is the only prose here and therefore the only thing in the
  sans face, with `text-wrap: balance` so it never orphans a word.
- Metadata rows reuse the Route block's label-column geometry, so the two
  read as the same kind of object.
- Values are `leading-[1.4]`, not `leading-none`: a *stack* of rows needs
  vertical rhythm that a single row set solid does not have.
- Values carry `.pick` — the one place the app's global `user-select: none`
  is lifted, because these get pasted into bug reports.
- `Source` shows `owner/repo`, not the full URL. The URL wrapped and orphaned
  "desktop" onto its own line, and `owner/repo` is how GitHub is read anyway.
- Neither button is accented. Green is the signal colour and the accent for
  *commit* actions; checking for updates commits nothing, and an About box
  has no primary action worth accenting.

### 4.6 The update meter

Real bytes, never a fake sweep to fill the wait — the same law that keeps a
throughput meter off the status face (§4.1). When the download server sends
no `content-length` the bar says exactly that by refusing to claim a
position, and sweeps instead.

- **Radius is 1px**, the same as a signal-bar segment. §2.6 lists 3/4/6px
  plus that 1px and the list is closed; a pill is the one shape this app
  does not make. It also rhymes the meter with the other horizontal readout
  on screen.
- **The sweep is `linear`.** An easing curve lingers at both extremes, which
  are precisely where the bar sits outside the track, and easing implies
  phases an indeterminate sweep does not have.
- **The sweep travels -35% → 105%.** The fill is `scaleX(0.3)` about its left
  edge, so those are one bar-width off each end. Percentages resolve against
  the *unscaled* box, which is easy to get wrong: an earlier -110% → 440%
  put the bar off-screen for three quarters of every cycle.
- **The readout is in the value face**, not the dialog's prose face. Bytes
  are a value (§2.5). Geist Variable happens to ship equal-width digits so
  nothing visibly jitters today, but a fallback to Cantarell has no such
  guarantee and this is a number the user watches change.
- **The readout is `--color-dim`, not `--color-faint`.** Faint clears 4.5:1
  on `--color-bg`; on the dialog's lighter `--color-panel` it does not.
- Fill and sweep are `transform`/`translate` only, so the whole thing is
  composited. Under `prefers-reduced-motion` the indeterminate bar goes
  static and dims rather than disappearing.

**Copy follows the phase.** Download and install are two phases of one flow,
and the title, description and button all name the same one at the same
time. The button said "Installing…" while the description said "Downloading",
which is exactly the inconsistency §"writing" warns about.

### 4.7 The log

The one surface that repaints continuously while the engine streams: flat
fill, no blur, no shadow, `contain: content`.

Lines **do not wrap** — they scroll sideways. Wrapping breaks an address
across two lines mid-octet, and checking addresses is the entire reason to
open this pane.

The disclosure panel **unmounts when closed**, which is what keeps 500 log
lines out of the DOM, and `ActivitySection` tells the backend to stop
streaming entirely. With the log closed the whole cost of a proxy log line is
one `push_back` in Rust: no IPC, no React render.

---

## 5. Accessibility

- Every text colour except `--color-ghost` clears 4.5:1 on its surface, so
  there is no size floor to remember. `--color-ghost` never carries text.
- The signal bar is `role="img"` with the condition as its `aria-label`; it
  is never the only channel for state, which is also spelled out in words
  twice (bezel and status face). This matters most for the green/red pair,
  which is the classic red-green colour-blindness confusion: the words, and
  the bar's motion, carry the state without it.
- Focus is visible on every control: an amber border, never a removed
  outline.
- Inputs keep a real `<label>`. A placeholder is an example, not a label.
- Addresses are `dir="ltr"` and left-read regardless of UI language.
- `prefers-reduced-motion` is **gentler, not absent**: movement goes, colour
  and opacity stay. The bar keeps its lit/unlit colours and loses only the
  scan. Transitions drop to `1ms`, not `0`, so `transitionend` handlers still
  fire and Base UI still has an exit animation to wait on.

---

## 6. Decision log

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

**2026-08-27 — Log lines stopped wrapping.** `break-all` was splitting IPv4
addresses across lines mid-octet.

**2026-08-27 — The status face is the only block allowed to take space.**
Filling leftover height with padding read as unfinished; filling it with a
throughput meter would have meant inventing data. Giving the readout real
size is the honest use of it.
