# Design system: SNI Spoof

The design system of record. Read it before changing anything visual. When a
design decision changes, update this file in the same commit as the code.

Reference, not narrative. It exists to answer "what colour is a disabled
label" without re-deriving the answer from a `theme.css` diff.

---

## 1. Design principles

1. **One primary action.** The app has one job. Exactly one control starts and
   stops the proxy, and nothing else on the screen can toggle it by accident.
   Reading where your traffic goes must never risk changing where it goes.
2. **State legible at a glance.** The window spends most of its life minimised
   or behind something else. When it comes forward, the state must be readable
   in under a second, from colour and shape before text.
3. **Restraint.** Two surface levels, three text steps, one accent. A new
   visual weight has to displace an existing one, not stack on top of it.
4. **Motion explains, it does not decorate.** Every animation answers one of
   four questions: what changed, what did I just press, where did this come
   from, where did it go. Motion that answers none of those is deleted.
5. **The platform pays for the frame.** This is a frameless 420x560 window on
   WebKitGTK that runs for hours. Every visual decision is also a repaint
   decision. See Section 8.

---

## 2. Visual theme and atmosphere

A quiet, cold graphite instrument panel. Near-neutral dark surfaces with a
faint blue cast, one saturated blue accent, and a single large luminous disc
that carries the entire state of the system. The atmosphere is closer to a
hardware power switch than to a web dashboard: sparse, physical, and calm
until something is actually happening.

Dial reading, as a redesign of the incumbent UI:

| Dial | Incumbent | Target | Why |
|---|---|---|---|
| Visual density | 5 | 3 | One screen, one decision. Space is the signal. |
| Design variance | 3 | 4 | Deliberately low. This is an Operate surface; symmetry around a single disc is the composition, not a failure of nerve. |
| Motion intensity | 4 | 6 | Motion is the deliverable that makes a one-screen utility feel expensive rather than merely functional. |

**Mode: Operate.** The visitor completes a task. Scanability, consistency and
native expectation outrank expression. Brand lives in precise detail: the
disc, the tracking table, the sheet physics.

---

## 3. Tokens

Three layers. Primitives are raw values with no meaning. Semantics name a role
and are the only layer components may reference. Component tokens are local to
one component and are set from semantics.

### 3.1 Primitive layer (raw values, never referenced directly)

| Value | Source |
|---|---|
| `#0c0c0f` | Graphite base. Not pure black: pure black kills depth and removes the surface the shell gradient sits on. |
| `#17171a` | One step lighter. The sheet panel, so it reads as a separate object over the shell. |
| `#f5f5f7` | Apple dark-mode label |
| `#a1a1a6` | Apple dark-mode secondary label |
| `#7c7c82` | Apple dark-mode tertiary label |
| `#0a84ff` | Apple `systemBlue` (dark) |
| `#0071e3` | Apple marketing blue, one step down |
| `#8e8e93` | Apple `systemGray` |
| `#ff9f0a` | Apple `systemOrange` (dark) |
| `#30d158` | Apple `systemGreen` (dark) |
| `#ff453a` | Apple `systemRed` (dark) |
| `rgba(255,255,255, .055 / .085 / .09 / .12 / .16 / .28)` | The white-alpha ladder for fills, hairlines and highlights |
| `rgba(0,0,0, .42 / .5)` | Sunken well, sheet backdrop |
| `120 / 180 / 260 / 420` ms | The four durations |

Every hex above is a published Apple dark-mode system colour. Do not invent
substitutes and do not "adjust for the background".

### 3.2 Semantic layer (`@theme` in `src/theme.css`)

**Surfaces**

| Token | Value | Role |
|---|---|---|
| `--color-shell` | `#0c0c0f` | The window. Level 1. The only element carrying `backdrop-filter`. |
| `--color-shell-edge` | `rgba(235,240,255,.12)` | The 1px window border that separates the frameless window from the desktop |
| `--color-raised` | `rgba(255,255,255,.055)` | Level 2. A card resting on the shell. |
| `--color-raised-hover` | `rgba(255,255,255,.085)` | Level 2, pointer over it, or the active row in a list |
| `--color-sunken` | `rgba(0,0,0,.42)` | A well cut into a surface: log scroller, text inputs |
| `--color-hairline` | `rgba(255,255,255,.09)` | Structural 1px line |
| `--color-hairline-strong` | `rgba(255,255,255,.16)` | A line that is also a grabbable object: the sheet handle, the sheet's top edge |

There are exactly two surface levels. A third would need a third token and a
reason recorded here.

**Text**

| Token | Value | Role | Contrast on `--color-shell` |
|---|---|---|---|
| `--color-text` | `#f5f5f7` | Primary. Values, names, state labels. | 18.1:1 |
| `--color-dim` | `#a1a1a6` | Secondary. Log lines, route values, title bar. | 7.59:1 |
| `--color-faint` | `#7c7c82` | Tertiary. Field labels, captions, disabled hints. | 4.71:1 |

All three clear WCAG AA 4.5:1 for body text on the shell, including
`--color-faint`. There is therefore no size floor on `--color-faint` and no
"non-essential text only" exemption to remember. A fourth, dimmer step is
banned: it would fail.

**Accent and state**

| Token | Value | Role |
|---|---|---|
| `--color-brand` | `#0a84ff` | The single accent. Text, icons, focus rings, tints on dark. 5.35:1 on the shell. |
| `--color-brand-press` | `#0071e3` | Solid button fills that carry white text. 4.70:1 against white. |
| `--color-st-stopped` | `#8e8e93` | State |
| `--color-st-starting` | `#ff9f0a` | State |
| `--color-st-running` | `#30d158` | State |
| `--color-st-error` | `#ff453a` | State |

**One accent, locked.** `--color-brand` is the only accent in the app and it
is used identically everywhere. The four `--color-st-*` values are not
accents: they are a semantic status scale with exactly one consumer each, and
they never appear as decoration, as a border tint, or as a second brand voice.
A green button that is not a running indicator is a defect.

The token is `--color-brand`, **never** `--color-accent`. The later
`@theme inline` block re-maps `--color-accent` onto shadcn's muted-hover token
and would win.

**Motion**

| Token | Value | Use |
|---|---|---|
| `--ease-out` | `cubic-bezier(.23,1,.32,1)` | Default. Anything travelling to a rest position. |
| `--ease-in-out` | `cubic-bezier(.77,0,.175,1)` | Something leaving and arriving in one move: the power glyph morph. |
| `--ease-sheet` | `cubic-bezier(.32,.72,0,1)` | The iOS drawer curve. The sheet, and the disclosure panel. |
| `--dur-press` | `120ms` | Press and hover feedback |
| `--dur-fast` | `180ms` | Label cross-fade, focus ring, small state |
| `--dur-panel` | `260ms` | Disclosure, horizontal push inside the sheet |
| `--dur-sheet` | `420ms` | The sheet's own travel |

The built-in CSS easings (`ease`, `ease-out`) are banned. They are too weak to
read as intentional at these durations. There is no overshooting CSS curve:
see the decision log. Overshoot comes from `motion`'s spring, which has a
velocity term, or it does not happen.

**Shape**

| Token | Value | Use |
|---|---|---|
| `--radius-shell` | `20px` | The window, and the sheet's top corners |
| `--radius-card` | `16px` | Cards and list rows |
| `--radius-control` | `12px` | Inputs, small buttons |

**Shape lock.** Three steps, nested largest to smallest, plus `9999px` for
anything circular or pill-shaped (the disc, the state dots, the handle, the
badge). A radius that is not one of those four is a defect. Nothing in the app
has square corners.

**Tracking**

Tracking is size-specific. One `letter-spacing` value is wrong somewhere:
display type reads loose as it grows, micro type reads too tight to stay
legible. Apple's tracking table, in em.

| Token | Value | Applies to |
|---|---|---|
| `--track-display` | `-0.026em` | 28px and up |
| `--track-title` | `-0.021em` | 20px to 24px |
| `--track-body` | `-0.011em` | 15px to 17px. The `body` default. |
| `--track-caption` | `-0.003em` | 12px to 13px |
| `--track-micro` | `0.006em` | 11px and below |

### 3.3 Component layer

| Token | Value | Owner |
|---|---|---|
| `--disc-size` | `152px` | `.disc` |
| `--disc` | one of `--color-st-*` | `.disc`, set inline per state by `PowerDisc` |
| sheet panel fill | `#17171a` | `.sheet-panel`. The one place a primitive is used directly, because it is a single object with no second consumer. |
| sheet backdrop | `rgba(0,0,0,.5)` | `.sheet-backdrop` |
| handle bar | `38x4px`, `9999px`, `--color-hairline-strong` | `.sheet-handle::after` |
| handle hit area | `26px` tall, full width | `.sheet-handle` |

---

## 4. Typography

**Stack**

```
-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
"Segoe UI Variable Text", "Geist Variable", system-ui, sans-serif
```

Platform font first: SF Pro and Segoe UI Variable ship real optical sizing and
tracking tables, which no webfont substitute reproduces. `Geist Variable` is
the Linux answer and is bundled via `@fontsource-variable/geist`, so it sits
ahead of `system-ui` to keep Linux off Cantarell or DejaVu.

`font-optical-sizing: auto` is on at `body`.

**Monospace** is the Tailwind default stack (`ui-monospace`, SF Mono, Menlo,
Consolas). Used only for values that are read character by character: ports,
IPs, hostnames, log lines. Never as a costume for "technical".

**Scale.** Every size pairs with the tracking token for its band.

| Role | Size | Weight | Tracking |
|---|---|---|---|
| Disc state label | 22px | 600 | `--track-title` |
| Sheet title | 17px | 600 | `--track-title` |
| Profile name, list row | 14px | 500 / 400 | `--track-body` |
| Input value | 13.5px, 12.5px mono | 400 | inherit |
| Header button, editor chrome | 13px | 400 / 500 | `--track-caption` |
| Disc action hint, title bar | 12.5px, 12px | 400 / 500 | `--track-caption` |
| Route value, badge | 11.5px, 11px | 400 | `--track-caption` |
| Field label, route label | 10.5px, 10px uppercase | 400 / 500 | `--track-micro` or explicit `.05em` for caps |

Hierarchy comes from weight and colour first, size second. There is one 22px
element on the screen and nothing larger.

**Numerals.** Anything that changes in place while the user is looking at it
(the activity badge, ports being edited) uses tabular figures, so the value
does not shimmy as digits change width.

---

## 5. Spacing and radii

A 2px-based scale, used through Tailwind's spacing utilities.

| Step | Used for |
|---|---|
| 2px, 4px | Icon-to-label, label-to-error |
| 6px, 8px | Inside a row, between paired fields |
| 12px, 14px | Between cards, inside card padding on the cross axis |
| 16px | Window gutter, card padding on the main axis |
| 20px | Disc to its label block |

More space above a group heading than below it. Tight inside a group,
generous between groups. The single largest gap on the screen is around the
disc, because it is the single most important object.

Radii: see the shape lock in Section 3.2.

---

## 6. Motion

### 6.1 What may animate

`transform`, `opacity`, `color`, `background-color`, `clip-path`. Nothing
else, with one grandfathered exception: `.disclosure-panel` animates `height`,
because Base UI publishes the measured height as a custom property and the
panel is `contain: paint`, so the repaint cannot escape its own box.

Never `height` outside that panel. Never `filter: blur` on a persistent
surface. `backdrop-filter` lives on `.shell` and nowhere else. See Section 8
for why.

### 6.2 The authored moments

Five, and only five. Each answers one of the four questions in Principle 4.

| Moment | Answers | How |
|---|---|---|
| Disc press | what did I press | `scale(.965)` on the *button*, on pointer-down, `--dur-press` |
| Disc state change | what changed | Colour swap plus a keyed label cross-fade, `--dur-fast` |
| Disc running breath | is it still alive | `scale(1)` to `scale(1.03)` on `.disc`, 3200ms, infinite |
| Sheet travel | where did this come from and go | `translateY`, `--dur-sheet` `--ease-sheet`, same path in and out |
| Sheet push navigation | where did the editor come from | `translateX` plus opacity, `--dur-panel` |

The `starting` arc and the `error` shake are state renderings, not decoration:
the arc replaces the word "waiting", and the shake fires exactly once, because
a loop is nagging and once is a report.

### 6.3 Interruptibility

A transition in flight must be catchable. Pressing Stop while the disc is
still settling into `starting` reverses from where it is. The sheet, grabbed
mid-close, follows the pointer from its current position rather than finishing
the close first. This is the difference between animation and physics, and it
is the reason `motion` is in the dependency list at all.

### 6.4 Reduced motion contract

Gentler, not absent. Under `prefers-reduced-motion: reduce`:

- Movement and overshoot are removed. Every `transform` animation stops.
- Opacity and colour transitions stay. Feedback never disappears: the disc's
  press feedback becomes an opacity drop instead of a scale.
- The breath, the arc spin and the shake stop.
- The sheet cross-fades in place instead of travelling.
- Transitions collapse to `1ms`, not `0`, so transition-end handlers still run.

CSS animations carry their own `@media` block. `motion` components are covered
globally by `<MotionConfig reducedMotion="user">` in `src/main.tsx`. Both are
required: one does not cover the other.

### 6.5 Press feedback lives on the button, not on the disc

`.disc` runs a keyframe animation in two of its four states (`running`
breathes, `error` shakes). A running animation's `transform` wins over any
`transform` an `:active` rule sets on the same element, so a press scale on
`.disc` is silently dead in exactly the two states where feedback matters
most. The scale therefore lives on `.disc-button`, one level up: nested
transforms compose rather than compete, and the press fires in every state.

Anything else that needs to move a disc which may be animating goes on the
button too, for the same reason.

### 6.6 Library boundary

One runtime animation dependency: `motion`, imported as `motion/react`. It is
allowed in exactly the places CSS cannot reach, and banned everywhere else.

**Where `motion` is used, and why CSS could not do it**

| Moment | Why CSS fails |
|---|---|
| A profile row entering and leaving the list | CSS cannot animate an element React has already unmounted. `AnimatePresence` can. |
| Reordering or removing rows | `layout` does the FLIP measurement. Hand-rolling it is a day of work and a source of jank. |
| The disc's start and stop transition | A spring that inherits the current velocity of an interrupted animation. A CSS transition restarts from a static value. |

**Where `motion` is banned**

- Hover, press and focus feedback. Those stay CSS `:hover`, `:active` and
  `:focus-visible`: they must respond on the very first frame, before React
  has rendered anything.
- The sheet drag. It is hand-rolled on Pointer Events over `src/lib/gesture.ts`
  and it is the one part of the frontend with tests. Do not swap in `drag="y"`.
- Anything already animating correctly in `theme.css`. If a CSS transition
  works, leave it.

**Shared spring constants**

| Constant | Value | Used by |
|---|---|---|
| `LIST_SPRING` | `stiffness 500, damping 40, mass 1` | Every row enter, exit and layout move |
| `DISC_SPRING` | `stiffness 400, damping 30` | The disc's state scale and halo bloom |

Two springs, so everything that moves shares one physical vocabulary. A third
needs a reason recorded here.

**Composition on the disc.** Three nested transforms that compose rather than
compete: `.disc-button` carries the press scale (CSS), the `motion.span`
inside it carries the state spring, and `.disc` itself carries the breathe and
shake keyframes. See Section 6.5 for why they cannot share an element.

**The halo is driven through a custom property.** A pseudo-element cannot be a
`motion` component, so `DISC_SPRING` animates `--halo` on the wrapper and
`.disc::before` reads `opacity: var(--halo, 0.9)`.

---

## 7. Components

| Component | What it is | States | Deliberately not clickable |
|---|---|---|---|
| `PowerDisc` | The status indicator and the primary action, as one 152px circular button. Colour tells you where you are, pressing changes it. | stopped, starting (rotating arc), running (breathing), error (one shake); hover, pointer-down, focus-visible | The label block below the disc. It is a sibling, outside the hit area. |
| `RouteRows` | Read-only Listen / Upstream / SNI. | none | All of it. Reading where traffic goes must never risk toggling it. |
| `ProfileBar` | Which profile the disc will act on, and the way into managing them. | hover, pointer-down, focus-visible | The state dot inside it. It mirrors the disc, it does not duplicate its action. |
| `Sheet` | Bottom-sheet primitive over Base UI `Dialog`. Focus trap, `Esc` and scroll lock from Base UI; the visual layer and the drag are ours. | closed, open, dragging, dismissing | The panel body while a drag is in progress. |
| `ProfileSheet` | List and editor, as two horizontally pushed views inside one sheet. | list, editor | Nothing. Every row and every action is reachable by keyboard. |
| `ProfileEditor` | Name plus the five connection fields, inline per-field validation. | pristine, invalid (per field), valid, saving-disabled | none |
| `ActivitySection` | Log disclosure. Owns all log state, so closing it unmounts every line. | closed with badge, open, empty, streaming | none |
| `TitleBar` | Drag region plus hide / minimise / quit. | hover, focus-visible | The drag region itself. |

**Bespoke versus shadcn.** `PowerDisc`, `Sheet`, `ProfileSheet`,
`ProfileEditor`, `ProfileBar`, `RouteRows` and `Disclosure` are bespoke and
stay bespoke. `alert-dialog` is the only shadcn primitive on screen. Do not
reach for the registry to replace a bespoke component: they exist because the
registry version would be generically shaped, and this app is one screen where
every shape carries meaning. Do reach for it before hand-editing anything
under `src/components/ui/`.

**States that must always exist.** Empty (the log's "No activity yet"),
loading (the disc's `starting` arc, which is the only loading state in the
app), error (per-field inline in the editor, `AlertDialog` for engine
failures), disabled (Save at 35% opacity while invalid). There are no skeleton
loaders because there is no list that arrives asynchronously.

---

## 8. Platform constraints

The runtime is WebKitGTK inside a frameless, transparent, 420x560 Tauri
window that stays resident for hours, often minimised. WebKitGTK keeps running
JavaScript, style and layout for hidden windows.

| Rule | Reason |
|---|---|
| `backdrop-filter` only on `.shell` | WebKitGTK re-blurs a backdrop layer on every repaint of anything above it. A second one turns every state change into a full-window re-rasterisation. |
| No `filter: blur` on a persistent surface | Same, worse: it re-rasterises per frame of any animation on that surface. The disc's halo is therefore a radial gradient, not a blurred circle. |
| No outer drop shadow on `.shell` | `.shell` fills the window, so a 60px blur would be rasterised every repaint and then clipped away unseen. Depth comes from a 1px border plus an inset highlight. |
| Only compositable properties animate | See Section 6.1. |
| `html`, `body`, `#root` stay transparent | The window is `transparent: true` with corners drawn in CSS. Any opaque layer between the webview canvas and `.shell` shows through as a sharp-cornered rectangle at the corners. |
| Log lines never travel over IPC unless Activity is open | One Tauri event per stdout line pegged the CPU during downloads, even minimised. The Rust `LogBuffer` batches at 200ms and only while the panel is open. |
| `h-screen`, not `min-h-[100dvh]` | The `dvh` guidance exists for the iOS Safari address bar. There is no address bar and no browser chrome here: the window is a fixed 420x560. `h-screen` is correct and `dvh` adds a unit nobody can test. |
| `user-select: none` on chrome, opt back in on inputs | Desktop app chrome, not a web page. |

---

## 9. Accessibility

- **Focus is always visible.** `focus-visible:ring-2 ring-brand/60` on every
  control, or a 3px `color-mix` ring on the disc. `outline: none` never
  appears without a replacement in the same rule.
- **Focus survives state.** `PowerDisc`'s button is not keyed on `state`. Only
  the label block below it is keyed, so the label cross-fades while keyboard
  focus stays on the button. A remount would drop focus every time the proxy
  changed state, which is exactly when the user is watching.
- **`aria-pressed`** on the disc reflects active. **`aria-label`** names the
  action, not the state: "Stop the proxy", not "Running".
- **Hit targets.** 152px for the disc. 48px rows for profiles and the profile
  bar. 32px minimum for title-bar chrome and the sheet's icon buttons, which
  is below the 44px touch guideline and acceptable because this is a
  pointer-and-keyboard desktop surface with no touch input.
- **Every action has a keyboard path.** Tab order is profile bar, disc,
  activity trigger. Inside the sheet: `Esc` closes, Tab reaches every row and
  every edit button, Enter saves. Nothing is reachable by pointer alone. There
  is deliberately no swipe-to-delete: it is undiscoverable on a desktop and
  unreachable from a keyboard, and the editor's Delete button covers the same
  ground for everyone.
- **Contrast.** See the table in Section 3.2. Every text token clears 4.5:1 on
  the shell. Solid accent fills carrying white text use `--color-brand-press`,
  not `--color-brand`, because `#0a84ff` under white is 3.65:1 and fails.
- **Colour is never the only channel.** Every state carries a text label under
  the disc as well as a colour, and the running row in the profile list is
  marked by a dot with a `aria-label`, next to a name.
- **Inputs keep visible labels.** A placeholder is an example, not a label.
  Inputs are `dir="ltr"` and left-read regardless of surrounding language,
  because they hold hostnames, IPs and ports rather than prose.
- **Browser surfaces are themed**, not left at the user agent default: text
  selection, caret, and the scrollbars in the log and the profile list.

---

## 10. Anti-patterns

Banned in this project. Some are general AI tells, some are specific to this
window.

**Visual**

- Pure `#000000` or pure `#ffffff` as a surface.
- A second accent colour. One accent, locked, used identically everywhere.
- A zero-offset coloured halo used as a shadow. Shadows carry an offset and a
  soft blur. The disc's halo is a state affordance, not a shadow, and it is
  the only glow in the app.
- Gradient text. Emphasis comes from weight or colour.
- Glass or blur as decoration. `backdrop-filter` is a platform decision here,
  not a style, and it appears exactly once.
- A coloured `border-left` above 1px as a status device.
- Nested cards. Two surface levels, and a card inside a card is a third.
- A radius outside the four in Section 3.2.
- An eyebrow or kicker above a heading. This window has no headings that need one.
- A modal for a task that needs neither interruption nor protected focus. The
  three `AlertDialog`s each guard a destructive or irreversible action.

**Typography**

- Inter.
- Serif, anywhere.
- Monospace for anything that is not read character by character.
- One global `letter-spacing`. Use the tracking token for the size band.
- An oversized heading used to create hierarchy that weight and colour could
  have created.

**Copy**

- The em-dash and en-dash characters (U+2014, U+2013) anywhere visible:
  labels, buttons, errors, log prefixes, dialog copy. Use a period, a comma, a colon, or two sentences.
  This applies to this document too.
- Emoji or Unicode glyphs standing in for an icon. Icons come from
  `lucide-react`, one family, consistent stroke. Commit messages are exempt:
  the project's git convention uses them and they are not UI.
- Marketing verbs. "Elevate", "Seamless", "Unleash", "Next-Gen".
- A subtitle that restates the state. `STATE_ACTION` names what pressing does,
  because `STATE_TEXT` already said where you are.
- Italics in a monospace column. In a log they read as a rendering fault, not
  as emphasis.
- Fake precision. No invented percentages or throughput figures.

**Motion**

- An animation that cannot be justified in one sentence against Principle 4.
- An entrance animation on every element. Five authored moments, listed in
  Section 6.2.
- Overshoot on anything the user did not physically start.
- A loop on an error. Once is a report, a loop is nagging.
- Any animation without a `prefers-reduced-motion` path.

---

## 11. Decision log

Dated entries for choices whose reasoning is not recoverable from the code.

### 2026-08-27: audit of the incumbent UI

Run before any code, over `src/theme.css`, `StatusControl.tsx` and
`ConnectionSection.tsx`. What read as templated, and therefore what the
redesign has to beat:

1. **The row-shaped status card.** Icon plus title plus subtitle plus trailing
   pill, inside a rounded card. This is the single most generic component
   shape in software, and it made the app's one important object look like a
   settings row. Replaced by `PowerDisc`.
2. **Status and action stacked as two readings of the same fact.** `STATE_TEXT`
   said "Running", `STATE_SUBTITLE` said "Traffic is being spoofed", and the
   chip said "Stop". Three strings for one state. Now: colour plus one label
   plus one action hint.
3. **Blue-black surfaces.** `#070b16` with `rgba(150,185,255,.14)` edges read
   as navy, which is a 2015 dashboard tell. Apple's dark materials read as
   grey with a hint of blue. Moved to `#0c0c0f`.
4. **Invented state colours.** `#34d399`, `#fbbf24`, `#fb7185`, `#4f8dff` are
   the Tailwind default palette, recognisable on sight. Replaced with Apple's
   published dark-mode system colours.
5. **Hardcoded tracking per component.** `tracking-[0.04em]`,
   `tracking-[-0.017em]`, `tracking-[0.085em]`, `tracking-[0.005em]`, all
   inline, all one-off. Replaced with the five `--track-*` tokens.
6. **Everything behind a disclosure.** Connection and Activity were both
   collapsed, so the default screen was a status row and two closed drawers,
   with no visible content. The route rows are now always visible and the
   profile editor moved into a sheet, which is a place rather than a drawer.
7. **Consistent and worth keeping.** The two-level surface system, the
   backdrop-filter discipline, `user-select` on chrome, the log buffer's IPC
   gate, and `--color-brand` as the accent name. All preserved.

### 2026-08-27: `--color-brand-press` for solid fills carrying white text

`stitch-design-taste` and `impeccable`'s craft floor both make the button
contrast check mandatory. White text on `#0a84ff` is **3.65:1**, which fails
AA for text below 18px. The editor's Save button is 13px.

Resolution: `--color-brand` stays the accent for text, icons, focus rings and
tints on dark, where it is 5.35:1. Solid fills that carry white text use
`--color-brand-press` (`#0071e3`, 4.70:1 against white). The token stops being
only a press state and becomes the fill colour, which is why it is documented
as such in Section 3.2 rather than named `--color-brand-active`.

This is a change to the Phase 2 plan's Task 5, which specified `bg-brand`.

### 2026-08-27: saturation, and the one-accent rule

`stitch-design-taste` caps accent saturation below 80% and allows one accent.
`#0a84ff` is far above that cap, and the app carries four more colours.

Resolution: the plan pins Apple's published palette in its global constraints,
and the brief wins over a general-purpose cap. The one-accent rule is honoured
literally: `--color-brand` is the only accent. The four `--color-st-*` values
are a semantic status scale, each with exactly one consumer, never used as
decoration. The saturation cap is recorded as consciously overridden, because
an Apple-ecosystem utility that desaturates `systemBlue` no longer reads as
one.

### 2026-08-27: the disc halo survives the no-glow ban

Both taste skills ban neon and outer glows, and the craft floor calls a
zero-offset coloured halo decoration rather than depth.

Resolution: kept, with the reasoning recorded. The halo is not a shadow and is
not decorating a card. It is the state channel of the single most important
object in the app, sized relative to the disc, and it is a radial gradient
rather than a `filter: blur` precisely because of Section 8. It is also the
only glow in the app. Depth elsewhere comes from a 1px border plus an inset
highlight, exactly as the ban intends.

### 2026-08-27: dark only

`design-taste-frontend` requires both colour modes unless the brief says
otherwise. The plan's global constraints say dark only.

Resolution: dark only. The window is transparent with a translucent shell over
the user's desktop. A light variant would need a second shell material, a
second contrast table and a second set of state colours, for a surface whose
entire visual identity is the dark glass. Recorded as deliberate, not as an
omission.

### 2026-08-27: `h-screen` over `min-h-[100dvh]`

`dvh` exists for the mobile browser address bar. There is no browser chrome in
a Tauri window and the window is a fixed 420x560. `h-screen` is correct.

### 2026-08-27: `lucide-react` stays

`design-taste-frontend` discourages Lucide in favour of Phosphor, Radix or
Tabler, with an explicit exemption when the project already depends on it. It
does. Swapping icon libraries is a dependency change with no visual payoff
here, where six glyphs are on screen. One family, consistent stroke, no
hand-rolled paths, with one exception: the power glyph in `PowerDisc` is an
authored SVG because it morphs between two states and no library ships that.

### 2026-08-27: no `Geist Mono`

`stitch-design-taste` pairs Geist with Geist Mono. Adding
`@fontsource-variable/geist-mono` is a dependency, and the plan's global
constraints allow exactly one new runtime dependency, spent on `motion`. The
Tailwind default mono stack resolves to a real monospace on every target
platform. Revisit only if the mono column ever becomes a primary reading
surface, which it is not: it is a log and a set of ports.

### 2026-08-27: shadcn tokens are re-tuned, not adopted

`components.json` declares `baseColor: "neutral"`, but the `:root` block in
`theme.css` was hand-edited to blue-tinted oklch values (`oklch(.16 .035 255)`
and friends). Those feed `AlertDialog` through `--popover` and `--card`. Left
as-is, the dialogs would stay navy while the rest of the app moved to
graphite.

Resolution: Task 2 neutralises the shadcn block to match the new shell rather
than adopting shadcn's own defaults, and `--ring` and `--primary` point at
`--color-brand`. The dialogs are the only shadcn surface on screen, so this is
a five-line change, not a migration.

### 2026-08-27: no overshooting CSS curve

`impeccable`'s detector flagged `--ease-spring`
(`cubic-bezier(.34, 1.56, .64, 1)`) as bounce easing. Checked: after the
status orb was deleted in Task 2 the token had zero consumers.

Removed rather than kept. The finding is also correct on the merits: a
cubic-bezier that overshoots has no velocity term, so it always overshoots by
the same proportion no matter how the motion was started, which is what makes
it read as elastic instead of physical. Overshoot that has to feel real comes
from `motion`'s spring, which inherits velocity. If a future CSS-only
animation genuinely needs overshoot, that is a signal it should be a `motion`
component instead.

### 2026-08-27: Task 8 static pass, two defects fixed

Item 1, press feedback on pointer-down: failed in the `running` and `error`
states. See Section 6.5.

Item 7, interruption: grabbing the sheet while it was still closing snapped it
to its base transform, because `[data-dragging]` removes the transition and
the inline transform was not written until the first `pointermove`. Fixed by
reading the presentation `translateY` at `pointerdown`, writing it inline
immediately, and treating it as the drag origin. An interrupted drag is now
continuous. Reopening a sheet that has already committed to closing is out of
scope: that is Base UI's lifecycle, not ours.

### 2026-08-27: no shared-element flight between the bar and the sheet row

Phase 2 Task 9 Step 4 called for a `layoutId` shared between the active
profile's name in `ProfileBar` and the same name in its sheet row, so opening
the sheet flies the label from one to the other. Not implemented, and it
should not be attempted as specified.

`layoutId` projection measures both boxes with `getBoundingClientRect` in a
layout effect, synchronously after the DOM update and before paint. At that
instant `.sheet-panel` still has its pre-change `transform: translateY(100%)`,
because a CSS transition has not advanced yet. The target box therefore
measures a full window height below the viewport, and the label flies
downward off-screen instead of into the row.

This is structural, not a tuning problem: it is what happens whenever a
projection target lives inside a subtree whose position is owned by a CSS
transform transition that `motion` cannot see. No variant of the shared
element escapes it, including moving the `layoutId` onto the state dot.

The two ways out are both worse. Handing the sheet's travel to `motion` so
projection is consistent contradicts the constraint that the drag stays
hand-rolled and tested, and it puts a 1:1 pointer gesture behind an animation
runtime. Measuring manually and correcting for the panel offset re-implements
projection by hand for one label.

The moment it was meant to sell is already carried: the sheet travels up, the
content behind pushes back to `scale(.98)`, and the active row is marked. If
this is revisited, the precondition is that the sheet's own travel and the
shared element are driven by the same system.
