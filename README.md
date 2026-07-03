# CircuiTi*k*Z-Designer

[![License](https://img.shields.io/github/license/circuit2tikz/circuitikz-designer)](LICENSE)
![GitHub last commit (dev)](https://img.shields.io/github/last-commit/circuit2tikz/circuitikz-designer/dev)
![GitHub commit activity (dev)](https://img.shields.io/github/commit-activity/m/circuit2tikz/circuitikz-designer/dev)
![GitHub Issues or Pull Requests](https://img.shields.io/github/issues/circuit2tikz/circuitikz-designer)

An interactive, visual, online editor for creating electrical circuit diagrams for LaTeX/CircuiTi*k*Z with ease — now with AI-powered circuit detection from a photo of a hand-drawn diagram. Try it out [online](https://circuit2tikz.tf.fau.de/designer/)!

## What's new in v1.1

CircuiTi*k*Z-Designer v1.1 makes the path from "I have a circuit on paper" to "compilable LaTeX" dramatically shorter:

- **Detect from image (AI)** — drop a photo or scan of a hand-drawn circuit and let an AI vision model parse it into editable components and wires. Bring your own provider; nothing leaves your machine without your key.
- **Three providers shipped out of the box:**
    - OpenAI-compatible endpoints (OpenAI, Ollama, LM Studio, vLLM, anything that speaks the chat-completions JSON dialect)
    - Anthropic Claude (3.5 / 4 / 4.5 Sonnet, Opus, Haiku — anything with vision)
    - Google Gemini (2.0 / 2.5 Flash & Pro)
- **Per-component confidence flagging** — the importer marks any component the model wasn't confident about so you can review them before accepting.
- **251-entry component vocabulary** sent to the model — covers the full CircuiTi*k*Z library including transistors, gates, sources, instruments, and node-style symbols.
- **Modern UI** — the default layout has been redesigned from the ground up: a glass-style top toolbar, a polished status bar, themable colour palettes, and a command palette (`Ctrl/⌘+K`). The original Bootstrap layout is preserved as **Classic** mode for users who prefer it.
- **First-class top-bar** — Save, Import, Export, Undo / Redo and Settings are visible without searching. The Import dropdown surfaces "Detect from image (AI)" with a sparkle icon next to "From file" and "Paste TikZ".
- **First-time onboarding** — a one-time welcome card on first visit, an enriched empty-canvas hint that shows the three ways to start, and a `?` shortcut overlay.

## Overview

CircuiTi*k*Z-Designer bridges the gap between visual circuit design and precise LaTeX code, letting you design, customize, and export diagrams without manually writing TikZ commands.
Whether you're preparing academic papers, teaching materials, or engineering documentation, CircuiTi*k*Z-Designer provides:

- A clean, intuitive interface for fast diagram creation
- An extensive component library for all your circuit needs
- Real-time previews and instant export to high-quality LaTeX code
- AI-assisted intake from a hand-drawn sketch — bring your own provider, your keys never leave the browser

Stop wrestling with code syntax — focus on your circuit design, and let CircuiTikZ-Designer handle the Ti*k*Z.

|         Edit in CircuiTi*k*Z-Designer         |            Export to compilable Ti*k*Z code            |
| :-------------------------------------------: | :----------------------------------------------------: |
| ![sallen-key edit](./examples/sallen-key.png) | ![sallen-key export](./examples/sallen-key_export.png) |

|               Use it in your LaTeX project!                |
| :--------------------------------------------------------: |
| ![sallen-key overleaf](./examples/sallen-key_overleaf.png) |

## Key Features

- **Detect from Image (AI):** upload a hand-drawn circuit photo; the app extracts components and wires using a vision LLM you configure (OpenAI / Anthropic / Gemini / local Ollama / LM Studio). Per-component confidence flagging lets you review before accepting.
- **Modern UI with Classic fallback:** redesigned interface with a glass-effect navbar, themable palettes, command palette (`Ctrl/⌘+K`), keyboard-shortcut overlay, and a polished status bar. Toggle to "Classic" in Settings if you prefer the original look.
- **Visual Circuit Design:** intuitive interface with multi-tab support and component grouping
- **Wide Component Library:** 251+ symbols including most circuit elements plus tikz primitives like rectangles, ellipses and arrows
- **Export Ready:** generate clean LaTeX/TikZ code and compatible SVG exports for seamless document integration
- **Advanced Editing:** rotate, scale, align, distribute, and snap components with clear visuals and flexible editing capabilities
- **Component Variants:** easily switch between different versions of components and adjust their properties via the properties window
- **Cross-Platform Friendly:** dark mode and mobile support for comfortable online editing anywhere
- **MathJax Support:** write MathJax math expressions directly inside text components with real-time rendering
- **Internationalised:** English and German UI strings, with a stub for adding more locales

## Use locally

1. Have [Node.js](https://nodejs.org/) installed
2. Clone the repository
3. Run "npm install" in terminal in project directory
4. Run "npm start" in terminal in project directory
5. Open website at URL provided in command line output

## How to use

All controls of the application are explained in the help menu in the top right corner via the circled questionmark in the application itself. You can also press `?` at any time to open the keyboard shortcut overlay, or `Ctrl/⌘+K` for the command palette.

To use **Detect from image (AI)**:

1. Open **Settings** (gear icon, top right) and configure an AI provider in the *AI Provider* section. You'll need an API key for OpenAI, Anthropic, or Google — or a base URL to your local Ollama / LM Studio / vLLM endpoint.
2. Click **Import → Detect from image (AI)** in the navbar (or just drag an image file onto the canvas).
3. Pick a hand-drawn or photographed circuit (PNG, JPEG, or WebP).
4. Click **Detect**. The model returns a list of components and wires; the importer drops them on the canvas and flags any low-confidence items for review.
5. Review the orange-highlighted components, fix any misreads, and export as you would any other circuit.

If you need help, please use the [general discussions](https://github.com/Circuit2TikZ/CircuiTikZ-Designer/discussions/categories/general) page.

## Contributing

### Bug reporting

Please use the [issues page](https://github.com/Circuit2TikZ/CircuiTikZ-Designer/issues) of the project to report bugs. Please always provide steps on how to reproduce the bug.

### Feature requests

You can post feature requests and discuss them on the [discussions](https://github.com/Circuit2TikZ/CircuiTikZ-Designer/discussions/categories/ideas) page.

### Contribute code/component implementations

Fork the repo, and create a pull request. Please always test your code thoroughly!

## Roadmap / Future scope

These are aspirations — not commitments. The full thinking lives in [`docs/superpowers/notes/2026-05-04-future-scope.md`](docs/superpowers/notes/2026-05-04-future-scope.md). Highlights:

- **V1.5 — Simulation Engine.** Animated circuit simulation built on a pure-TS DC/AC/transient solver, sharing the same component graph the v1.1 detection pipeline produces. Inspirations: NgSpice, Falstad.
- **V2 — Semiconductor Design Subset.** A chip / IC design mode with pin layouts, package outlines, multi-layer routing, and DRC. Likely a sub-app sharing the symbol library but with its own canvas mode. Major surface area, not a near-term commitment.
- **V2+ — MCP Integration.** Expose the editor and detection pipeline as a Model Context Protocol server so other AI agents can inspect, edit, and extend circuits programmatically.
- **Other deferred work:** label/value OCR (recover R₁=10kΩ from the photo, not just *resistor*), multi-pass refinement (chain detection → critic → edit-only second pass), an ONNX in-browser fallback for users who don't want to configure a cloud provider.
