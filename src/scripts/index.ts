// Self-hosted UI fonts (offline-capable; replaces the Google Fonts CDN links).
import "@fontsource/inter-tight/400.css"
import "@fontsource/inter-tight/500.css"
import "@fontsource/inter-tight/600.css"
import "@fontsource/inter-tight/700.css"
import "@fontsource/jetbrains-mono/400.css"
import "@fontsource/jetbrains-mono/500.css"
import "@fontsource/jetbrains-mono/600.css"
import "material-symbols/outlined.css"
import "computer-modern/cmu-serif.css"

/**
 * The main source file. Does only include {@link MainController}, which does the actual work.
 */

// Install the central log bus FIRST so it captures console/errors/network from the very start.
import { logBus } from "./logBus"
logBus.install()

import { MainController } from "./internal"
import { circuitAPI } from "./circuitAPI"
import { ChatController } from "./chatController"
import { LogPanelController } from "./logPanel"
import { initHarnessBridge } from "./harnessBridge"

// @ts-ignore
window.mainController = MainController.instance
// Programmatic Circuit API / harness seam - drive the editor from outside the UI (window.circuitAPI).
// @ts-ignore
window.circuitAPI = circuitAPI
// Expose the log bus for the DevTools console and the (coming) log panel.
// @ts-ignore
window.logBus = logBus

// Vision (handwritten circuit detection) bootstrap.
// Register all available providers and bind the user-facing controllers. The controllers' bind()
// methods are guarded against missing markup, so they no-op cleanly if the HTML hasn't been built.
import {
	VisionSettingsController,
	VisionImportController,
	ReviewChipController,
	registerProvider,
	openaiCompatProvider,
	anthropicProvider,
	geminiProvider,
} from "./internal"

registerProvider(openaiCompatProvider)
registerProvider(anthropicProvider)
registerProvider(geminiProvider)

// Wait for DOMContentLoaded so getElementById() lookups succeed even if the bundle is parsed
// before the body has finished streaming.
const bindVisionControllers = () => {
	VisionSettingsController.instance.bind()
	VisionImportController.instance.bind()
	ReviewChipController.instance.bind()
	// In-app AI chat that drives the circuit through circuitAPI (reuses the AI provider config).
	ChatController.instance.bind()
	// Moving log panel (bottom-left) + record/download button, backed by the central log bus.
	LogPanelController.instance.bind()
	// External harness / MCP bridge - only connects when opened with ?harness=<port|ws-url>.
	initHarnessBridge()
}
if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", bindVisionControllers, { once: true })
} else {
	bindVisionControllers()
}

// v1.1 UX additions: navbar dropdowns, version label, onboarding toast, status-bar
// AI provider chip, and `?` shortcut overlay. UxV11Controller.bindAll() is idempotent
// and each sub-binder is internally guarded; safe to call multiple times.
import {
	UxV11Controller,
	bindVersionLabelUxV11,
	bindOnboardingHintUxV11,
	bindStatusBarProviderUxV11,
	bindShortcutOverlayUxV11,
} from "./internal"

const bindUxV11 = () => {
	// Each helper resolves to UxV11Controller.bindAll() - calling all four keeps
	// the call sites legible per the task spec while wiring everything once.
	bindVersionLabelUxV11()
	bindOnboardingHintUxV11()
	bindStatusBarProviderUxV11()
	bindShortcutOverlayUxV11()
	// And explicitly cement the singleton in case any of the helpers are
	// removed in a later pass.
	UxV11Controller.instance.bindAll()
}
if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", bindUxV11, { once: true })
} else {
	bindUxV11()
}

