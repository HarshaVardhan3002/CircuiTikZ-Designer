# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0]

### Added

- Unified import flow for JSON files, pasted CircuiTikZ/TikZ, and uploaded source files.
- Expanded CircuiTikZ parsing and transformation with diagnostics, import reports, component aliases, anchors, coordinate forms, and spline-control support.
- Cubic spline component with editable anchors/handles, continuity modes, save/load, and TikZ export/import support.
- Modern v1.1 UI shell with themes, command palette, status bar, shortcut help, provider chips, and refreshed properties/view controls.
- Programmatic circuit API, runtime log bus, log panel, and focused import/spline/vision regression tests.

### Added — Beta

- Detect from image (AI Beta), including provider configuration, image preprocessing, confidence overlays, and review chips.
- AI Assistant chat (Beta), including model tool-calling and visual-check workflow.
- MCP/harness automation path (Beta) for model-driven or external-agent editing flows.

### Notes for maintainers

- Beta surfaces are provider/model-dependent and should be reviewed separately from the stable editor, import, export, parser, and spline functionality.
- Local planning/report artifacts are intentionally ignored by Git: `/docs/`, `/reports/`, `implementation_plan.md`, and `*.docx`.

## [0.9.6]

### Fixed

- **Form controls now visible on every dark theme.** The previous styling let Bootstrap's defaults through, so on AMOLED (`#000` background) the slider track, slider thumb, dropdown chevron, text inputs and the "Current grid spacing" info pill all rendered near-invisibly. Each is now bound to the active theme's tokens and explicitly re-drawn:
  - `.form-range` track (6 px, themed border + bg) and thumb (18 px filled in `--c-accent`, white ring against the page background, hover scale-up, focus halo).
  - `.form-select` chevron is an inline SVG tinted to match `--c-fg-subtle` so it shows on every background (Bootstrap's hardcoded dark-grey chevron disappeared on AMOLED).
  - `.form-control` / `textarea` / `input` now have a 1-px `--c-border-strong` border that's noticeably brighter on dark themes; hover lifts to `--c-fg-subtle`, focus to `--c-accent` with a 3-px ring in `--c-accent-subtle`.
  - The "Current grid spacing" alert pill reads from `--c-accent-subtle` instead of Bootstrap's `bg-info-subtle`, which produced an unreadable teal on AMOLED.
  - `.form-check-input` (toggles, checkboxes) is filled with `--c-accent` when checked, with a white tick — replaces Bootstrap's default blue-on-blue.
- **AMOLED palette retuned**: `--c-bg-input` lifted from `#141414` → `#1c1c1c`, `--c-border-strong` from `rgba(255,255,255,0.18)` → `rgba(255,255,255,0.28)`. The slider track and form borders now read clearly without compromising the deep-black canvas. Same change is propagated to all other dark themes that derive from token defaults.

### Added — typography pass

- Loaded **Inter Tight** (display + UI) and **JetBrains Mono** (monospace) from Google Fonts. Inter Tight is Inter's slightly tighter UI variant — better at the 13–18 px sizes the chrome lives at. Both with `display=swap` so the font load doesn't block first paint.
- New typography tokens: `--font-display` (separate from `--font-sans` so headings can carry tighter tracking), `--font-features` (Inter's `cv02 / cv03 / cv04 / cv11 / ss01 / ss03` contextual alternates — cleaner `l`, rounder digits, the small finishes that read as "premium" rather than generic), `--font-features-mono` (JetBrains Mono `calt / ss01 / ss02 / ss03`), and a tracking scale (`--ls-tight`, `--ls-normal`, `--ls-wide`, `--ls-uppercase`).
- `font-feature-settings` and `font-optical-sizing: auto` applied at the `html.ui-modern` root, with antialiasing hints (`-webkit-font-smoothing: antialiased`, `-moz-osx-font-smoothing: grayscale`).
- Headings (h1–h5) tightened: `font-display`, `letter-spacing: -0.015em`, `line-height: 1.18`, `font-weight: 600`. The previous style read as workmanlike; the new one has the clearance and rhythm of a designed UI.
- `#propertiesTitle` and section headers in the right pane are now properly small-caps-style: 13 px, uppercase, `0.08em` tracking, semibold — the "ENVIRONMENT VARIABLE PRESETS" label demonstrates the rule.
- `.status-value` in the status bar uses `font-feature-settings: "tnum"` so the cursor coordinates don't shift width as the digits change.
- Brand wordmark uses the display font with tighter tracking; the version chip's tabular-nums variant keeps the `v0.9.6` badge stable.

## [0.9.5]

### Added

- Six new themes alongside the original Modern Light / Modern Charcoal pair:
  - **AMOLED Black** — pure `#000` background with a warm orange accent. Designed for OLED displays where black pixels are off; max contrast, lowest power.
  - **Peach** — soft warm peach off-white with a coral-orange accent. Bright but easy on the eyes for long sessions.
  - **Sky** — light cornflower-blue palette. Crisp and bright, good for daytime working light.
  - **Forest** — deep mossy-green dark theme with a muted sage accent. Earth-toned, low eye-strain alternative to the cooler dark themes.
  - **Nord** — Arctic blue-grey palette inspired by Arctic Ice Studio's Nord theme. Popular among European devs / IDE users.
  - **Bauhaus** — primary red on warm cream, paying tribute to the German Werkbund / Bauhaus design language. Red is the action accent, blue is information, yellow is warning — exactly the colour roles in the Bauhaus pedagogical canon.
- Theme picker now opens a grouped menu on **single click** (was previously a dark/light toggle on click + menu on right-click — the toggle was unintuitive and discoverable only by accident). Groups: *Modern* (Light / Charcoal / AMOLED), *Coloured* (Peach / Sky / Forest / Nord / Bauhaus), *Classic* (legacy Light / Dark), *UI mode* (Modern UI / Classic UI). Current theme tick-marked, each row shows a representative icon.
- Each new theme localises its name in German with the proper term (`Pfirsich`, `Himmelblau`, `Wald`, `AMOLED Schwarz`, …). The picker re-renders on language switch.
- Command palette (Ctrl/⌘ + K) now lists all ten themes individually, each with locale-aware keywords (e.g. searching for "blau" matches Sky / Himmelblau / Bauhaus's blue accent).

### Removed

- The legacy dark-mode toggle (the moon icon + Bootstrap form-switch) is hidden in Modern UI mode. The theme picker fully replaces it, and the toggle was the source of confusion ("why are there two moons?"). The element stays in the DOM so the legacy code paths in `MainController` keep working in Classic UI; it just doesn't render.

### Changed

- `ThemeController.toggleDark()` is theme-aware: each light theme has a sensible dark counterpart (Sky ↔ Nord, Peach → Charcoal, Bauhaus → Charcoal, AMOLED → Modern Light, etc.) so the OS-level dark-mode media query produces a useful flip instead of always defaulting to a single pair.
- The active theme's `data-bs-theme` is now derived from a per-theme `isDark` check rather than a string-suffix heuristic, so the AMOLED, Forest, and Nord themes correctly mark themselves dark for any Bootstrap component still reading the attribute.

## [0.9.4]

### Added

- **Design-token system** (`src/styles/tokens.scss`) — single source of truth for spacing (8-pt grid), radii, typography scale, motion (durations + eases), elevation (5 ambient-shadow tiers), and z-index layers. All visual rules read from tokens; theming is just a question of swapping the colour set.
- **Four themes** with a runtime picker:
  - *Modern Light* — warm cream off-white (`#faf9f6`), terracotta accent (`#c47c4a`), inspired by Claude's interface palette. Soft elevation, calm contrast, generous spacing.
  - *Modern Charcoal* — warm dark (`#1a1816`), no blue cast, same terracotta accent. Deep but not pure black, designed for long sessions.
  - *Classic Light* — the original CircuiTikZ Designer Bootstrap palette, kept as a "legacy" option for users who prefer the previous look.
  - *Classic Dark* — the original blue-tinted dark theme.
  Themes are stored in localStorage; the OS-level `prefers-color-scheme` is honoured on first load. The dark-mode toggle in the top bar now flips between the dark/light pair within the active UI mode.
- **Modern / Classic UI mode toggle**. The `ui-modern` class on `<html>` activates the entire design-system layer; `ui-classic` falls back to the v0.9.3 look. Switchable from the theme menu (right-click the theme button) or the command palette.
- **Glass-morphism panels** — top navbar, floating tool cluster, status bar, symbol drawer, and command palette all use `backdrop-filter: blur()` with theme-aware translucent backgrounds. No flat gradients; depth is conveyed with ambient shadow + blur.
- **Command palette (Ctrl/⌘ + K)** — Spotlight-style overlay with fuzzy search across tools, file actions, themes, and language switches. Subsequence-matching algorithm with word-boundary and contiguity bonuses (no external fuzzy-search library); arrow-key navigation, enter to run, Esc to dismiss. Sections grouped (Tools / File & Actions / Themes). Each row shows an icon, title (with matched chars highlighted), optional description, and optional keyboard shortcut. Auto-translates on locale switch.
- **i18n module** (`src/scripts/i18n.ts`) with English + German dictionaries. German uses proper EE technical vocabulary — *Bauteil* (component), *Schaltplan* (circuit diagram), *Widerstand* / *Kondensator* / *Spule* (R/C/L), *Raster* (grid, the standard CAD term per DIN 6789), *Stetigkeit* (continuity, math/physics), *Stützpunkt* (anchor point), *Spiegelung* (point-mirror, the C¹ semantic), *Radieren* (the eraser tool, distinct from *Löschen* = delete). Auto-detects browser language on first load, persists choice in localStorage.
- **Language picker** in the top bar (next to the theme picker). Click to switch between English and Deutsch; the entire UI re-translates without reload via the `applyTranslations()` walker that consumes `data-i18n*` attributes.
- **Responsive layout fix** — the floating tool cluster now centres horizontally with `transform: translateX(-50%)` instead of relying on Bootstrap's absolute positioning, wraps with `flex-wrap` on narrow viewports, and respects `max-width: calc(100% - var(--sp-6))`. The status bar collapses non-essential readouts below 600 px wide. No more clipping at small window sizes.
- **Tooltips re-themed** — backdrop matches the active theme, faster open delay, max-width capped, no jarring black box on the Modern Charcoal theme.
- **Modern scrollbars** — thin, themed, hover-darken on track-thumb. Falls back gracefully on Firefox via `scrollbar-width` / `scrollbar-color`.
- **Empty-canvas hint** rewritten to use translatable interpolated keyboard chips (`{q}`, `{w}`, `{cmdK}`) so the hint stays correct after a language switch.

### Changed

- The previous `polish.scss` is replaced with a token-driven version that activates only when `html.ui-modern` is present. Switching to Classic UI mode reverts the entire layer.
- Top-bar action icons (help, theme, language, command palette) use a softened hover with background-fill instead of a text-shadow, easier on the eyes during long sessions.
- Modal enter-animation tightened to 220 ms with a `cubic-bezier(0.2, 0.7, 0.2, 1)` ease.

### Out of scope (next release candidates)

- Customizable workspace layouts (split panes, detachable property pane).
- Saved-session history / recent-files menu.
- Component-family panels in the symbol drawer.
- More languages — the i18n scaffold is ready; adding Spanish / French / Italian is a per-string translation pass.

## [0.9.3]

### Added

- Right-click context menu on a selected spline's anchors. Lets you set continuity (Corner / G¹ smooth / C¹ mirror) per anchor with the current mode tick-marked, insert a fresh anchor before or after the right-clicked one, or delete the anchor (disabled when only two anchors remain). Inserted anchors land at the midpoint of the chord and inherit smooth default handles.
- Smarter default handles when a spline is placed. Interior anchors now lay their tangents along the chord between their two neighbours (Catmull-Rom-style), so freshly drawn splines look smooth out of the box instead of polylines with kinks at every vertex. Endpoint handles still point one third of the way to the lone neighbour.
- **Status bar** pinned to the bottom of the canvas pane. Shows the active tool, the cursor position in cm (live, rAF-throttled), the current zoom level as a percentage, and the total component count. Hidden until first interaction so it doesn't compete with the empty-canvas hint on a clean session.
- **Empty-canvas hint** with the discoverability keys for first-time users — opens the symbol drawer with `Q`, the wire tool with `W`, and pasting CircuiTikZ source with `Ctrl/⌘ + Shift + O`. Fades out automatically as soon as the first component is added.
- **Handwriting input toolbar slot** — disabled placeholder with a "soon" badge and a tooltip explaining the future behaviour. Clicking surfaces a non-blocking toast pointing users at the cubic-spline tool as the current substitute. The slot is wired so the v0.10+ pen-capture work plugs in without further toolbar surgery.
- **Toast helper** in `MainController.toast(message, durationMs?)` — used by the handwriting placeholder; available to other controllers for non-modal informational pings (auto-dismiss, no click required).

### Changed

- **UI polish layer** added as `src/styles/polish.scss` and imported from `styles.scss`. All rules are additive on top of the existing styles — drop the import to revert. Highlights:
  - Toolbar buttons get hover-lift, smooth color and shadow transitions, and a visible focus ring (`:focus-visible`) for keyboard navigation.
  - The top control bar gains a soft drop shadow, blurred translucent background, and a fade-in entrance animation.
  - Symbol palette tiles lift on hover with a subtle accent tint pulled from the primary colour.
  - Modals enter with a smoother cubic-bezier transform-and-fade instead of the default Bootstrap pop.
  - Spline handle dots show a soft drop-shadow on hover so the active grab target is visually distinct.
  - The version badge in the top bar is rendered with a subtle linear-gradient instead of flat secondary fill.
  - All animations respect `prefers-reduced-motion`.

### Performance

- Geometry caches inside `SplineComponent`: the SVG path string, axis-aligned bounding box, and polyline approximation are computed lazily and reused across renders. Cache invalidation is wired to every anchor / handle mutation site (drag, rotate, flip, continuity change, insert / delete, JSON load). Long splines now re-render from cache hits during pan / zoom / re-select instead of rebuilding the path string each time.
- `requestAnimationFrame`-coalesced updates during handle and anchor drag. Rapid mousemove events that previously triggered three or four `SVG.path.plot` calls per frame collapse to a single render per frame, eliminating jank on splines with many segments.
- `update()` now compares incoming `referencePoints` against the cached anchor positions and skips the geometry-invalidation path entirely when they're already in sync — common when the canvas requests a redraw for a reason other than a spline edit (theme switch, view fit, snap recalculation).

## [0.9.2]

### Added

- New **Cubic spline** path component, in the Symbols palette under Basic. Built around CircuiTikZ's `\draw (.) .. controls (.) and (.) .. (.)` syntax — drop a polyline of anchor points, then drag the control handles that appear on each interior anchor to shape the curve. Per Christof's request, the underlying primitive is a chain of cubic Béziers; a multi-segment spline is just a sequence of `..controls..` groups that share their endpoint coordinates.
- **Anchor-continuity property**, exposed on every selected spline as a three-way button group:
  - **Corner** — handles are independent. The anchor is a kink. Default for inserted anchors.
  - **G¹ smooth** — handles share a tangent line; their lengths can differ. The dragged handle drives the direction of the other.
  - **C¹ mirror** — handles are point-mirrored: same direction, same length. The dragged handle drives the other's full vector.
  The constraint is enforced live during handle drag, so the chosen invariant doesn't drift over the course of a long edit.
- TikZ exporter emits one `..controls (c1) and (c2) ..` group per segment, sharing the terminal coordinate with the next segment for chained splines (matches the canonical CircuiTikZ form).
- TikZ importer: the lexer now produces a `DOTDOT` token for `..`, and the parser walks the `..controls (c1) and (c2) ..` connector and packs both control points onto the path element. The transformer collapses runs of consecutive controls segments into a single `cubic-spline` save object, with interior-anchor continuity inferred from the existing handle geometry — a spline exported with C¹ enforced re-imports with the constraint preserved (within `1e-3 cm` linear / `0.5°` angular tolerance).
- 6 new tests in the import harness covering: `..` lexing, single-segment parse, chained multi-segment parse, the missing-`controls` and missing-trailing-`..` recovery paths, and a 20-segment alternating spline+wire stress fixture.

### Changed

- Path-component TikZ command builder now accepts arbitrary connector strings (not just `--`/`-|`/`|-`/`to[…]`) so the spline component's `..controls..` connectors round-trip through the existing path-emit pipeline without a special case.

## [0.9.0]

### Added

- CircuiTikZ import: paste, drop, or open a `.tex` / `.tikz` file and get an editable diagram. Covers the common textbook idioms (voltage dividers, transistor amplifiers, op-amps, rectifiers, DIP chips with 7-segment displays, mixed-signal prototypes).
- JSON round-trip import: Designer-exported JSON files can now be re-opened with forgiving schema validation (missing optional fields degrade to warnings, unknown fields are preserved).
- Unified Load modal that routes paste, file upload, and drag-and-drop through a single ImportController, with automatic format sniffing (JSON vs. TikZ).
- Import Report modal with severity filtering (error / warning / info). Every diagnostic carries a code, line, column, and a one-sentence plain-English suggestion; the report persists across Retry.
- Symbol alias table for CircuiTikZ short-forms (`R`, `V`, `L`, `C`, `D`, `sw`, …) mapped in preference order to the canonical Designer names (`american resistor`, `american voltage source`, …), with graceful fallback.
- TikZ coordinate-intersection shorthand `(A |- B)` / `(A -| B)` is now understood and resolved against the named-point table.
- Compound anchor names such as `(ic.pin 15)`, `(ic.pin 1)`, `(ic.pin edge)` for DIP / multi-pin ICs are parsed with original spacing preserved.
- `\node[...] at (name.anchor) {...}` now accepts named-point references (previously only numeric / polar coords were honoured).
- Bare `-` and `+` are admitted as anchor / identifier tokens, so op-amp pin references (`(oa.-)`, `(oa.+)`) and math-mode labels with a leading sign (`{$+V_{CC}$}`) import without diagnostics.
- CircuiTikZ annotation-position modifiers `i^=` and `v^=` (current / voltage label above) tokenize cleanly alongside the pre-existing `i_=` / `v_=` idioms.
- Multi-character end-marker decorations `*-*`, `-*`, `*-` (and the `o`-prefixed variants on option lists) are recognised and ignored (visual-only in v0.9).
- In-app help page documenting supported idioms and known limitations.
- 62 automated import tests (lexer, parser, transformer, integration, fuzz).

### Changed

- All importer diagnostics are non-throwing by design: the parser and transformer never abort on user input, so a single unrecognised token or malformed coordinate yields a warning and the rest of the document still imports.
- `\draw` walk is now a state-machine that buffers wire segments and flushes them when a path-symbol (`to[R=…]`, `to[V=…]`, …) is hit, so mixed component-and-wire paths come across faithfully.
- Inline embedded-node names (`\draw (0,0) node[nmos] (M1) {}`) are now registered in the named-point table as they are emitted, making later references (`(M1.drain)`) resolve correctly.

### Known limitations

- Anchors are parsed but not used for precise placement; components snap to node centers. Anchor-aware placement is planned for v1.0.
- LaTeX macros (`\newcommand`, `\def`) are not expanded — users should paste post-expansion source.
- PGF transforms (`[scale=…]`, `[transform shape]`) are parsed but not applied to geometry.
- Path shapes (`rectangle`, `circle`) are accepted as bounding-box annotations rather than first-class shapes.

## [0.8.1]

### Fixed

- Some components not rendering arrows or text correctly

## [0.8.0]

### Added

- Can now give the design a name
- Multi component editing
- Open component
- Short component
- Voltage and current arrows
- Poles (nodes) added to path symbol components
- Basic global circuitikz key management
- Global voltage styles option
- Global label alignment option

### Changed

- Boolean properties now more intuitive to use (also tristate capability)
- Settings modal is now only tab management
- Tab management deletes empty DB entries on refresh if already closed

### Fixed

- Text rotation in TikZ output for rectangle component
- Backwards compatibility for wire JSON format before CTD v0.6.0
- Issue #60 and #63: arrows disappearing when changing the theme or exporting them to svg
- Issue #67: wrong output for multiline text for export to tikz
- Issue #70: disappearing selection box
- Issue #73: Transformer core not rotating correctly; now always using transform shape in tikz output

## [0.7.5]

### Changed

- Now cannot close currently open tabs anymore since this doesn't work all the time (only if the tabs opened each other). Highlighting the tabs instead.

## [0.7.4]

### Fixed

- Fixed a bug where plain polygons couldn't be exported

## [0.7.3]

## Added

- Basic Flip flops

## Changed

- Exporting to SVG now doesn't require Computer Modern on the device, where the SVG will be used
- Symbols now updated to circuitikz version 1.8.2

## Fixed

- Default text position for circuitikz nodes now correct (bug fixed in circuitikz v1.8.2)
- Path label distance now correctly reflected in exported tikz code

## [0.7.2]

### Fixed

- SVG export of text with mathjax ignoring the mathjax
- Path label positioning for vertical paths

## [0.7.1]

### Fixed

- SVG export leading to a crash in some cases

## [0.7.0]

### Added

- Can now select the desired component variant via changing the options in the properties window (Issue #33)
- Tab management system (open in settings)
- Copy and paste between different tabs
- Rectangle text now able to use mathjax/LaTeX expressions. Just enter math mode like you would do in LaTeX (surround with $-signs or \\(\\)-pair) (Issue #49)
- Ability to use hyphenation in rectangle text. Use with caution: Very basic implementation --> LaTeX export will produce different hyphenation
- Indication for which component is currently hovered over
- Fit view button in canvas properties to fit the view to the components
- Component for Text (Same as rectangle component but different default values) (Issue #48)
- Different wire component defaults (some with arrows preapplied) (Issue #46)

### Changed

- Improved search function in component drawer (regex now supported)
- Can now choose if the label should be placed relative to the component transform or the canvas for node components (components which are represented by node commands in Tikz)
- Default opacity now 1 (Issue #47)
- Rectangle text now uses computer modern like LaTeX
- Selection and snapping visuals adjusted
- Visuals for checkboxes in properties window now consistent with other properties

### Fixed

- Rectangle text now escapes special characters (Issue #51)
- Bounding box size and position for some components
- Selecting text inside a text input field in the properties is now not deselected when ending the selection inside the canvas
- Pasting before copying for the first time now ignores the paste command
- many minor fixes

## [0.6.0]

### Added

- Rotate components by 45 degrees with a dedicated button in the properties window
- Scale circuitikz components (This also scales the line width, which is not the case with TikZ, i.e. what you see in CircuiTikZ-Designer will be slightly different than what you get in TikZ so keep that in mind)
- Can now group and ungroup components

### Changed

- No more ForeignObjects are used in the SVG components and export. This should dramatically increase compatibility of the SVG export with 3rd party software.

### Fixed

- The grid was not drawn exactly where it should have been drawn
- Many other small fixes

## [0.5.2]

### Fixed

- Clicking the "Draw wires" tool while placing a component would essentially brick the tool (Hotkeys unaffected)

## [0.5.1]

### Fixed

- Path components didn't show resize points

## [0.5.0]

### Added

- Rectangle(square) and Ellipse(circle) components
- Text via the rectangle component
- New shortcut: T for placing rectangles/text
- Label coloring
- Label positioning:
    - Gap to the component for adjusting the distance
    - Choosing the side for path components
    - Choose anchor and position for other components
- Aligning and distributing components
- Wires now moveable
- Wire points can be edited
- Can add basic arrows to wire endpoints
- More z-order control (move forward or backward)
- Can now also rotate and flip components on mobile via buttons in the properties window
- Color fill for rectangle and ellipse components
- Stroke options for wires, rectangle and ellipse components
- Better snapping visualizations
- Possible to generate executables via electron

### Changed

- The titlebar now shows actions only if the device has enough available space, otherwise collapses them into a toggle menu
- Path component adjustment points now look the same as other adjustment points
- Page layout on mobile

### Fixed

- Mobile controls. Can now use mobile with slightly reduces functionality
- Selection visualisation/bounding boxes now more consistent
- Many small bugfixes

## [0.4.2]

### Fixed

- path components sometimes flickered when moving them if they have a label and are oriented a certain way

## [0.4.1]

### Fixed

- loading a json didn't load wires

## [0.4.0]

### Added

- Properties window (shows information about currently selected component)
- Changeable grid settings like grid size
- Labeling via Mathjax (very close to Tex syntax)
- Changeable settings for path components
    - name
    - label
    - mirror/invert
    - z-order via buttons
- Changeable settings for node components
    - name
    - label
    - z-order via buttons

## Changed

- Naming of components in component drawer
- Preference loading logic
- Local save state per tab
- Placing components now automatically reselects the component after placing it &rarr; can rapidly place many of the same component
- save file format. still backwards compatible

## [0.3.1]

### Changed

- Save state management of browser sessions now more versatile (multiple sessions with different circuit designs)

### Fixed

- Position of selection rectangle for path components fixed on Safari
- Meta tags for website previews using the open graph protocol

## [0.3.0]

### Added

- Dark mode
- Many new components:
    - CircuiTikZ manual chapter 4.7 - Mechanical Analogy
    - CircuiTikZ manual chapter 4.9 - Multiple wires (buses)
    - CircuiTikZ manual chapter 4.12 - Terminal shapes
    - CircuiTikZ manual chapter 4.14 - Block diagram components
    - CircuiTikZ manual chapter 4.16 - Electronic tubes
    - CircuiTikZ manual chapter 4.17 - RF components
    - CircuiTikZ manual chapter 4.19 - Transformers
    - CircuiTikZ manual chapter 4.20 - Amplifiers
    - CircuiTikZ manual chapter 4.21 - Switches, Buttons and jumpers
    - CircuiTikZ manual chapter 4.22 - Logic gates
    - Metal-oxide varistor
    - Current tap (probe)
    - Wiggly fuse
    - Relais
    - Neon lamp (double cathode + anode and cathode)
    - Spark gap
    - IEC 60617 connector as path
- Additional snap points for some components
- New shortcut for an unconnected terminal (Alt/Option + .)
- Clicking on a component without dragging now selects the component
- MacOS keyboard shortcut definitions
- "Backspace" now also deletes components
- More UI tooltips

### Changed

- All descriptions of all components in the component drawer. No more IDs, more descriptive
- Default camera zoom level
- Minimum size of symbols in component drawer
- Adjusted component categories slightly. "Wiring" category now encompasses more components
- Only start showing snapping points when actually dragging
- Component drawer search bar is now always visible when the component drawer is visible

### Fixed

- Dragging a path component at its center now properly snaps

## [0.2.0]

### Added

- Selections
- Undo/Redo
- Copy/Paste
- Save/Load
- Export as SVG
- Navbar for aesthetics
- Help menu

### Changed

- Readme for GitHub release

## [0.1.0]

### Added

- Initial release of this changelog.
