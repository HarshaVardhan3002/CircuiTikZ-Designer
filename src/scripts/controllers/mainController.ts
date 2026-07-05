import * as SVG from "@svgdotjs/svg.js"
import texSvgUrl from "url:mathjax/es5/tex-svg.js"
import { Button as _bootstrapButton, Collapse as _bootstrapCollapse, Offcanvas, Tooltip, Modal, Tab } from "bootstrap"
import "../utils/impSVGNumber"
import { waitForElementLoaded } from "../utils/domWatcher"
import hotkeys from "hotkeys-js"
import { version } from "../../../package.json"

import {
	CanvasController,
	ExportController,
	SelectionController,
	SaveController,
	ImportController,
	ImportReportController,
	Undo,
	CopyPaste,
	PropertyController,
	CircuitComponent,
	ComponentPlacer,
	NodeSymbolComponent,
	PathSymbolComponent,
	WireComponent,
	ComponentSymbol,
	ComponentSaveObject,
	EraseController,
	RectangleComponent,
	EllipseComponent,
	defaultStroke,
	defaultFill,
	PolygonComponent,
	SplineComponent,
	GroupSaveObject,
	memorySizeOf,
	SaveFileFormat,
	emptySaveState,
	currentSaveVersion,
	loadTextConverter,
	TextProperty,
	ShortComponent,
	OpenComponent,
	ThemeController,
	CommandPaletteController,
	ShortcutsController,
	getLocale,
	setLocale,
	applyTranslations,
	t,
} from "../internal"
import { THEME_GROUPS, THEME_META, ThemeId, getThemeMeta } from "./themeController"

type TabState = {
	id: number
	open: string
	data: SaveFileFormat
	settings: CanvasSettings
	designName?: string
}

/**
 * Discriminated union of every message that travels over the cross-tab BroadcastChannel.
 *
 * Adding a new message type means appending a new variant here; the compiler then forces
 * matching `if (msg.type === ...)` updates in `broadcastChannel.onmessage` and any new
 * `sendBroadcastMessage` call site to provide the right payload.
 */
type ClipboardPayload = {
	components: ComponentSaveObject[]
	selectionPos: SVG.Point
}

export type BroadcastMessage =
	/** Tell the tab whose `tabID === payload` to start blinking its favicon (the user clicked "show" elsewhere). */
	| { readonly from: number; type: "show"; payload: number }
	/** No-op refresh hint - the settings modal re-evaluates its tab list. */
	| { readonly from: number; type: "update" }
	/** Cross-tab clipboard sync after a copy/cut. */
	| { readonly from: number; type: "clipboard"; payload: ClipboardPayload }
	/** "Are you alive?" - broadcast on cold start so other tabs respond and we discover them. */
	| { readonly from: number; type: "probe" }
	/** Reply to a `probe`. `payload` carries back the original probe sender so unrelated tabs ignore it. */
	| { readonly from: number; type: "probe-response"; payload: number }

/**
 * @deprecated kept for source-level compatibility with code that still references the
 * historical "stringly typed" message shape. New code should use {@link BroadcastMessage}.
 */
export type MessageData = BroadcastMessage

export type CanvasSettings = {
	gridVisible?: boolean
	majorGridSizecm?: number
	majorGridSubdivisions?: number
	viewBox?: SVG.Box
	viewZoom?: number
}

export enum Modes {
	DRAG_PAN,
	COMPONENT,
	ERASE,
}

const RECENT_COMPONENTS_KEY = "ctkRecentComponents"
const RECENT_COMPONENTS_MAX = 12

/** Load recently-used component tikz-names (most recent first). Best-effort; never throws. */
function loadRecentComponentNames(): string[] {
	try {
		const arr = JSON.parse(localStorage.getItem(RECENT_COMPONENTS_KEY) || "[]")
		return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string").slice(0, RECENT_COMPONENTS_MAX) : []
	} catch {
		return []
	}
}

/** Record a component as just-used: prepend it to the recents list (deduped, capped). */
function pushRecentComponentName(tikzName: string): void {
	if (!tikzName) return
	const next = [tikzName, ...loadRecentComponentNames().filter((n) => n !== tikzName)].slice(0, RECENT_COMPONENTS_MAX)
	try {
		localStorage.setItem(RECENT_COMPONENTS_KEY, JSON.stringify(next))
	} catch {
		/* localStorage disabled/full - recents are a nice-to-have, don't crash */
	}
}

export class MainController {
	private static _instance: MainController
	public static get instance(): MainController {
		if (!MainController._instance) {
			MainController._instance = new MainController()
		}
		return MainController._instance
	}

	// controllers
	canvasController: CanvasController

	symbolsSVG: SVG.Svg
	symbols: ComponentSymbol[]

	private tabID = -1

	mode = Modes.DRAG_PAN

	private modeSwitchButtons = {
		modeDragPan: null,
		modeDrawLine: null,
		modeEraser: null,
	}

	initPromise: Promise<any>
	isInitDone: boolean = false

	circuitComponents: CircuitComponent[] = []

	static appVersion = "0.0.0"

	/**
	 * Backwards-compatible bridge for code that historically read or wrote
	 * `MainController.instance.darkMode`. The single source of truth is now
	 * {@link ThemeController}; this getter/setter just delegates so existing
	 * callers (e.g. exportController flipping to light during SVG export) keep
	 * working without an extra import.
	 *
	 * Setting `darkMode = false` while a colourful palette (e.g. `peach`) is
	 * active maps to the appropriate "light" pair via `ThemeController.setDark`.
	 */
	public get darkMode(): boolean {
		return ThemeController.instance.isDark
	}
	public set darkMode(value: boolean) {
		ThemeController.instance.setDark(value)
	}

	isMac = false
	selectionController: SelectionController

	broadcastChannel: BroadcastChannel

	public designName: TextProperty

	private db: IDBDatabase

	/**
	 * Init the app.
	 */
	private constructor() {
		MainController._instance = this
		this.isMac = window.navigator.userAgent.toUpperCase().indexOf("MAC") >= 0
		this.broadcastChannel = new BroadcastChannel("circuitikz-designer")

		// Wire up theme + i18n early so the very first paint is in the user's preferred
		// theme and language (avoids a "blue flash, then warm cream" on cold load).
		// ThemeController owns localStorage, the `theme-*`/`ui-*` html classes, and the
		// `data-bs-theme` attribute. It also performs a one-time migration of the legacy
		// `circuitikz-designer-theme` key.
		ThemeController.instance
		// Re-render component themes whenever the active theme changes (e.g. via the picker
		// in the navbar or the command palette). The first paint already runs through the
		// initial theme, so we only need to react to subsequent flips.
		window.addEventListener("theme-changed", () => this.updateComponentTheme())

		let mathJaxPromise = this.loadMathJax()
		let canvasPromise = this.initCanvas()
		let symbolsDBPromise = this.initSymbolDB()
		let fontPromise = Promise.all([document.fonts.load("1em Computer Modern Serif"), loadTextConverter()])

		MainController.appVersion = version

		document.documentElement.lang = getLocale()

		document.addEventListener("DOMContentLoaded", () => {
			for (const element of document.getElementsByClassName("version")) {
				element.textContent = "v" + version
			}
			applyTranslations()
			this.installTopBarPickers()
			this.installCommandPalette()
			ShortcutsController.instance.bind()
			// Mount the UI Mode picker into the slot reserved at the top of the settings
			// modal. Idempotent - calling again just resyncs the current selection.
			ThemeController.instance.installUiModePicker()
		})

		const fileExportName = document.getElementById("exportModalFileBasename") as HTMLInputElement
		this.designName = new TextProperty("Design Name", "")
		this.designName.addChangeListener(() => {
			document.title = this.designName.value + (this.designName.value ? " - " : "") + "CircuiTikZ Designer"
			fileExportName.placeholder =
				MainController.instance.designName.value.replace(/[^a-z0-9]/gi, "_") || "Circuit"

			let tabsObjectStore = MainController.instance.db.transaction("tabs", "readwrite").objectStore("tabs")
			tabsObjectStore.get(this.tabID).onsuccess = function (event) {
				const data = (event.target as IDBRequest).result as TabState
				data.designName = MainController.instance.designName.value
				tabsObjectStore.put(data)
				MainController.instance.sendBroadcastMessage("update")
			}
		})

		this.initModeButtons()

		this.updateTooltips()

		// init exporting
		ExportController.instance
		const exportCircuiTikZButton: HTMLButtonElement = document.getElementById(
			"exportCircuiTikZButton"
		) as HTMLButtonElement
		exportCircuiTikZButton.addEventListener(
			"click",
			ExportController.instance.exportCircuiTikZ.bind(ExportController.instance),
			{
				passive: true,
			}
		)

		const exportSVGButton: HTMLButtonElement = document.getElementById("exportSVGButton") as HTMLButtonElement
		exportSVGButton.addEventListener("click", ExportController.instance.exportSVG.bind(ExportController.instance), {
			passive: true,
		})

		// init save and load
		SaveController.instance
		const saveButton: HTMLButtonElement = document.getElementById("saveButton") as HTMLButtonElement
		saveButton.addEventListener("click", SaveController.instance.save.bind(SaveController.instance), {
			passive: true,
		})

		const loadButton: HTMLButtonElement = document.getElementById("loadButton") as HTMLButtonElement
		loadButton.addEventListener("click", SaveController.instance.load.bind(SaveController.instance), {
			passive: true,
		})

		// Dedicated entry point for CircuiTikZ paste imports - opens the unified modal pre-switched
		// to the Paste tab with the CircuiTikZ format radio already selected.
		ImportController.instance
		ImportReportController.instance // eager-construct so the modal wiring is ready for the first import
		const importTikZButton: HTMLButtonElement = document.getElementById("importTikZButton") as HTMLButtonElement
		importTikZButton.addEventListener(
			"click",
			() => ImportController.instance.open("paste", "tikz"),
			{ passive: true }
		)

		canvasPromise.then(() => {
			EraseController.instance
			SelectionController.instance
			PropertyController.instance
			ComponentPlacer.instance
		})
		this.initPromise = Promise.all([canvasPromise, symbolsDBPromise, mathJaxPromise, fontPromise]).then(() => {
			document.getElementById("loadingSpinner")?.classList.add("d-none")
			this.initAddComponentOffcanvas()
			this.initShortcuts()

			// Prevent "normal" browser menu
			document
				.getElementById("canvas")
				.addEventListener("contextmenu", (evt) => evt.preventDefault(), { passive: false })

			this.addSaveStateManagement()

			// prepare symbolDB for colorTheme
			for (const g of this.symbolsSVG.defs().node.querySelectorAll("symbol>g")) {
				this.preprocessSymbolColors(g)
			}

			// Initial component-theme pass - the symbols only know how to recolour their
			// strokes/fills once we ask them to, so do one explicit pass after the SVG DB
			// is ready. Subsequent flips are handled by the `theme-changed` listener
			// installed in the constructor.
			MainController.instance.updateComponentTheme()
			PropertyController.instance.update()
			this.isInitDone = true
		})
	}

	private allTooltips: Tooltip[] = []
	public updateTooltips() {
		var isMobile = window.matchMedia("only screen and (max-width: 760px)").matches
		//enable tooltips globally
		/* tooltip-on-toggleable-element pattern: `data-bs-toggle-second="tooltip"` lets an
		   element carry a Bootstrap tooltip in addition to whatever component its primary
		   `data-bs-toggle` already wires up (e.g. an offcanvas trigger that also tips). */
		const tooltipTriggerList = document.querySelectorAll(
			'[data-bs-toggle="tooltip"],[data-bs-toggle-second="tooltip"]'
		)
		for (const tooltip of this.allTooltips) {
			tooltip.dispose()
		}
		if (isMobile) {
			this.allTooltips = [...tooltipTriggerList].map(
				(tooltipTriggerEl) =>
					new Tooltip(tooltipTriggerEl, {
						fallbackPlacements: [], //always show them exactly where defined
						trigger: "manual",
					})
			)
		} else {
			this.allTooltips = [...tooltipTriggerList].map(
				(tooltipTriggerEl) =>
					new Tooltip(tooltipTriggerEl, {
						fallbackPlacements: [], //always show them exactly where defined
						delay: { show: 1000, hide: 0 },
					})
			)
		}
	}

	private async loadMathJax() {
		var promise = new Promise((resolve) => {
			if (!("MathJax" in window)) {
				;(window as any).MathJax = {
					tex: {
						inlineMath: { "[+]": [["$", "$"]] },
					},
				}
			}
			var script = document.createElement("script")
			script.src = texSvgUrl

			// Never let a blocked / slow / offline CDN stall app init. onInit awaits this promise
			// (initPromise); if MathJax can't load we resolve anyway and labels fall back to plain
			// text in renderMathJax(). Fixes the "spinner hangs / empty component drawer" failure.
			let settled = false
			const finish = () => {
				if (settled) return
				settled = true
				resolve("")
			}
			script.addEventListener("load", finish, false)
			script.addEventListener(
				"error",
				() => {
					console.warn("[CircuiTikZ] MathJax failed to load; math labels fall back to plain text.")
					finish()
				},
				false
			)
			// Hard timeout so a hanging request can't block init forever.
			setTimeout(() => {
				if (!settled) {
					console.warn("[CircuiTikZ] MathJax load timed out; continuing without it.")
					finish()
				}
			}, 8000)

			document.head.appendChild(script)
		})
		return promise
	}

	/**
	 * handle tabs and save state management
	 */
	private addSaveStateManagement() {
		// remove old localStorage data
		localStorage.removeItem("currentProgress")
		localStorage.removeItem("circuit2tikz-designer-grid")
		localStorage.removeItem("circuitikz-designer-grid")
		localStorage.removeItem("circuitikz-designer-saveState")
		sessionStorage.removeItem("circuitikz-designer-tabID")

		const defaultSettings: CanvasSettings = {}

		const IDBrequest = indexedDB.open("circuitikz-designer-db", 1)
		IDBrequest.onerror = function (event) {
			console.error("IndexedDB error")
			console.error(event)
		}
		IDBrequest.onupgradeneeded = function (event) {
			MainController.instance.db = (event.target as IDBOpenDBRequest).result
			if (!MainController.instance.db.objectStoreNames.contains("tabs")) {
				const objectStore = MainController.instance.db.createObjectStore("tabs", { keyPath: "id" })
				objectStore.createIndex("open", "open", { unique: false })
			}
		}
		IDBrequest.onsuccess = function (event) {
			MainController.instance.db = (event.target as IDBOpenDBRequest).result

			window.addEventListener("visibilitychange", (ev) => {
				if (document.visibilityState == "hidden") {
					MainController.instance.saveCurrentState(false)
				}
			})

			window.addEventListener("beforeunload", (ev) => {
				MainController.instance.saveCurrentState()
			})

			let tabsObjectStore = MainController.instance.db.transaction("tabs", "readwrite").objectStore("tabs")

			// the URL of the current page
			var url = new URL(window.location.href)
			// check if a tabID is requested in the URL, otherwise use the first closed tab
			var requestedID = parseInt(url.searchParams.get("tabID"))

			tabsObjectStore.getAll().onsuccess = function (event) {
				let allTabs: TabState[] = (event.target as IDBRequest).result

				if (Number.isNaN(requestedID)) {
					// no tabID is requested in the URL, so we need to find the first closed tab
					requestedID = allTabs.findIndex((tab) => tab.open == "false")

					if (requestedID < 0) {
						// no closed tab found, use the next available ID
						requestedID = 0
						while (allTabs.find((tab) => tab.id == requestedID)) {
							requestedID++
						}
					}
				}

				let requestedTab = allTabs.find((tab) => tab.id == requestedID)
				if (requestedTab) {
					// if the requested tab is closed, open it
					requestedTab.open = "true"
					MainController.instance.tabID = requestedTab.id
					MainController.instance.designName.updateValue(requestedTab.designName ?? "", true, true)
					CanvasController.instance.setSettings(requestedTab.settings)
					SaveController.instance.loadFromJSON(requestedTab.data)
					tabsObjectStore.put(requestedTab).onsuccess = (event) => {
						MainController.instance.sendBroadcastMessage("update")
					}
				} else {
					// requested tab not found, so we create a new one
					const newEntry: TabState = {
						id: requestedID,
						open: "true",
						data: emptySaveState,
						settings: defaultSettings,
					}
					MainController.instance.tabID = requestedID
					tabsObjectStore.add(newEntry).onsuccess = (event) => {
						// as soon as the tab is created and saved in the db, we can notify the other tabs
						MainController.instance.sendBroadcastMessage("update")
					}
				}
			}
		}

		//settings modal
		const settingsModalEl = document.getElementById("settingsModal") as HTMLDivElement
		const settingsTableBody = document.getElementById("tabManagementTableBody") as HTMLTableSectionElement

		settingsModalEl.addEventListener("show.bs.modal", (event) => {
			this.saveCurrentState(false)
			let tabsObjectStoreRead = MainController.instance.db.transaction("tabs").objectStore("tabs")

			tabsObjectStoreRead.getAll().onsuccess = function (event) {
				settingsTableBody.innerHTML = ""

				const currentData = (event.target as IDBRequest).result as TabState[]

				let totalSize = 0

				for (let i = 0; i < currentData.length; i++) {
					const tabData = currentData[i]
					let row = settingsTableBody.appendChild(document.createElement("tr"))
					row.classList.add("text-end")
					let cell1 = row.appendChild(document.createElement("td"))
					cell1.innerText = tabData.designName || "" + i
					let cell2 = row.appendChild(document.createElement("td"))
					cell2.innerText = countComponents(tabData.data.components) + ""
					let cell3 = row.appendChild(document.createElement("td"))
					let size = memorySizeOf(tabData.data)
					totalSize += size
					cell3.innerText = sizeString(size)
					let cell4 = row.appendChild(document.createElement("td"))
					if (tabData.open == "false") {
						let openButton = cell4.appendChild(document.createElement("button"))
						openButton.classList.add("btn", "btn-primary", "me-2")
						openButton.innerText = "Open"
						openButton.addEventListener("click", () => {
							// set the data in the object store to open
							let allOpen = true
							for (let index = 0; index < tabData.id; index++) {
								// current data will not be stale since the tab management gets updated immediately when something changes
								let current = currentData.find((tab) => tab.id == index)
								if (current) {
									allOpen = allOpen && current.open == "true"
								} else {
									allOpen = false
								}
							}
							if (allOpen) {
								// if possible, don't use the tabID parameter
								window.open(".", "_blank")
							} else {
								window.open(".?tabID=" + tabData.id, "_blank")
							}
						})

						let deleteButton = cell4.appendChild(document.createElement("button"))
						deleteButton.classList.add("btn", "btn-danger", "material-symbols-outlined")
						deleteButton.innerText = "delete"
						deleteButton.addEventListener("click", () => {
							let tabsObjectStore = MainController.instance.db
								.transaction("tabs", "readwrite")
								.objectStore("tabs")
							tabsObjectStore.delete(tabData.id).onsuccess = function () {
								settingsModalEl.dispatchEvent(new Event("show.bs.modal"))
								MainController.instance.sendBroadcastMessage("update")
							}
						})
					} else {
						if (tabData.id == MainController.instance.tabID) {
							let infoButton = cell4.appendChild(document.createElement("button"))
							infoButton.classList.add("btn")
							infoButton.innerText = "This tab"
							infoButton.disabled = true
							let _ = [cell1, cell2, cell3, cell4].forEach((cell) => {
								cell.classList.add("bg-primary")
							})
						} else {
							let closeButton = cell4.appendChild(document.createElement("button"))
							closeButton.classList.add("btn", "btn-primary")
							closeButton.innerText = "Highlight tab"
							closeButton.addEventListener("click", () => {
								// send a message to the broadcast channel to show the tab
								MainController.instance.sendBroadcastMessage("show", tabData.id)
							})
						}
					}
				}
				let row = settingsTableBody.appendChild(document.createElement("tr"))
				let cell1 = row.appendChild(document.createElement("td"))
				cell1.colSpan = 4
				cell1.classList.add("text-center")
				let newTabButton = cell1.appendChild(document.createElement("button"))
				newTabButton.classList.add("btn", "btn-primary")
				newTabButton.innerText = "New tab"
				newTabButton.addEventListener("click", () => {
					// set the data in the object store to open
					let requestedID = 0
					let allOpen = true
					while (true) {
						// continue until no tab is found
						let tab = currentData.find((tab) => tab.id == requestedID)

						if (tab) {
							requestedID++
							allOpen = allOpen && tab.open == "true"
						} else {
							break
						}
					}
					if (allOpen) {
						// if possible, don't use the tabID parameter
						window.open(".", "_blank")
					} else {
						window.open(".?tabID=" + requestedID, "_blank")
					}
				})

				document.getElementById("storageUsed").innerHTML = sizeString(totalSize)
			}
		})

		document.getElementById("probeRefresh").addEventListener("click", () => {
			// set all open states in indexedDB to false, then send a probe message to all tabs
			let tabsObjectStore = MainController.instance.db.transaction("tabs", "readwrite").objectStore("tabs")
			tabsObjectStore.getAll().onsuccess = function (event) {
				let allTabs: TabState[] = (event.target as IDBRequest).result

				let requests: IDBRequest[] = []
				for (const tab of allTabs) {
					if (tab.id == MainController.instance.tabID) {
						// skip this tab
						continue
					}
					if (tab.open == "true") {
						// set the tab to closed in the db, but keep the data (even if the tab is empty)
						tab.open = "false"
						requests.push(tabsObjectStore.put(tab))
					} else {
						// if the tab is already closed and has no data, delete the entry (keeps the db clean)
						if (tab.data.components.length == 0) {
							requests.push(tabsObjectStore.delete(tab.id))
						}
					}
				}
				Promise.all(
					requests.map(
						(r) =>
							new Promise((res, rej) => {
								r.onsuccess = () => res(true)
								r.onerror = () => rej()
							})
					)
				).then(() => {
					// after all tabs are closed (in the db, not the tab in the browser), send a probe message to all tabs
					// this will cause all open tabs to set their state to open=true again
					settingsModalEl.dispatchEvent(new Event("show.bs.modal"))
					setTimeout(() => {
						MainController.instance.sendBroadcastMessage("probe")
					}, 10)
				})
			}
		})

		const favicon = document.getElementById("favicon") as HTMLLinkElement
		const faviconLink = favicon.href
		const faviconAlternate = document.getElementById("faviconAlternate") as HTMLLinkElement
		const alternateLink = faviconAlternate.href
		faviconAlternate.href = " "
		faviconAlternate.disabled = true

		this.broadcastChannel.onmessage = (event) => {
			const msg = event.data as BroadcastMessage

			if (msg.type == "show") {
				const tabID = msg.payload // already typed as number - discriminated union narrowed
				if (tabID == MainController.instance.tabID) {
					const oldTitle = document.title

					let darkMode = true
					const switchFavicon = () => {
						if (darkMode) {
							favicon.href = alternateLink
							document.title = "Click here!"
						} else {
							favicon.href = faviconLink
							document.title = oldTitle
						}
						darkMode = !darkMode
					}
					const interval = setInterval(switchFavicon, 1100)
					switchFavicon()

					// Stop flashing if tab becomes visible
					document.addEventListener("visibilitychange", () => {
						if (!document.hidden) {
							clearInterval(interval)
							darkMode = false
							switchFavicon()
						}
					})
				}
			} else if (msg.type == "update") {
				if (settingsModalEl.classList.contains("show")) {
					settingsModalEl.dispatchEvent(new Event("show.bs.modal"))
				}
			} else if (msg.type == "clipboard") {
				CopyPaste.instance.setClipboard(msg.payload)
			} else if (msg.type == "probe") {
				// also respond with the orginal sender as the payload
				this.sendBroadcastMessage("probe-response", msg.from)
			} else if (msg.type == "probe-response") {
				if (msg.payload != this.tabID) {
					// only handle response if the orignal probe message came from this tab
					return
				}

				// set the indexedDB entry with tabID msg.tabID to open=true
				let tabsObjectStore = MainController.instance.db.transaction("tabs", "readwrite").objectStore("tabs")
				tabsObjectStore.get(msg.from).onsuccess = function (event) {
					const data = (event.target as IDBRequest).result as TabState
					if (data) {
						data.open = "true"
						tabsObjectStore.put(data).onsuccess = function () {
							MainController.instance.sendBroadcastMessage("update")
						}
					}
				}
				if (settingsModalEl.classList.contains("show")) {
					settingsModalEl.dispatchEvent(new Event("show.bs.modal"))
				}
			}
			return false
		}

		function sizeString(size: number) {
			if (size < 1024) {
				return size + " B"
			} else if (size < 1024 * 1024) {
				return (size / 1024).toFixed(2) + " KB"
			} else if (size < 1024 * 1024 * 1024) {
				return (size / (1024 * 1024)).toFixed(2) + " MB"
			} else {
				return (size / (1024 * 1024 * 1024)).toFixed(2) + " GB"
			}
		}

		function countComponents(data: ComponentSaveObject[]) {
			let count = 0
			for (const component of data) {
				if (component.type == "group") {
					count += countComponents((component as GroupSaveObject).components)
				}
				count++
			}
			return count
		}
	}

	// Overloads ensure each `type` requires (or rejects) the matching payload at compile time,
	// so a typo at any send site fails fast rather than silently no-opping at the receiver.
	public sendBroadcastMessage(type: "update" | "probe"): void
	public sendBroadcastMessage(type: "show", payload: number): void
	public sendBroadcastMessage(type: "probe-response", payload: number): void
	public sendBroadcastMessage(type: "clipboard", payload: ClipboardPayload): void
	public sendBroadcastMessage(type: BroadcastMessage["type"], payload?: number | ClipboardPayload): void {
		const message = { from: this.tabID, type, ...(payload !== undefined ? { payload } : {}) } as BroadcastMessage
		this.broadcastChannel.postMessage(message)
	}

	private saveCurrentState(closeTab = true) {
		Undo.instance.addState()
		let tabsObjectStore = MainController.instance.db.transaction("tabs", "readwrite").objectStore("tabs")
		tabsObjectStore.get(this.tabID).onsuccess = function (event) {
			const data = (event.target as IDBRequest).result as TabState
			if (closeTab) {
				data.open = "false"
			}
			data.data = Undo.instance.getCurrentState()
			if (data.data.components.length > 0) {
				data.settings.gridVisible = CanvasController.instance.gridVisible
				data.settings.majorGridSizecm = CanvasController.instance.majorGridSizecm
				data.settings.majorGridSubdivisions = CanvasController.instance.majorGridSubdivisions
				data.settings.viewBox = CanvasController.instance.canvas.viewbox()
				data.settings.viewZoom = CanvasController.instance.currentZoom
				data.designName = MainController.instance.designName.value || undefined
				tabsObjectStore.put(data).onsuccess = function () {
					MainController.instance.sendBroadcastMessage("update")
				}
			} else {
				if (closeTab) {
					// if no data is present, delete the entry (keeps the db clean)
					tabsObjectStore.delete(MainController.instance.tabID).onsuccess = function () {
						MainController.instance.sendBroadcastMessage("update")
					}
				}
			}
		}
	}

	/**
	 * initialises keyboard shortcuts
	 */
	private initShortcuts() {
		// stop reload behaviour
		hotkeys("ctrl+r,command+r", () => false)

		// rotate selection
		hotkeys("ctrl+r,command+r", () => {
			if (this.mode == Modes.COMPONENT) {
				ComponentPlacer.instance.placeRotate(-90)
			} else {
				if (SelectionController.instance.hasSelection()) {
					SelectionController.instance.rotateSelection(-90)
					Undo.instance.addState()
				}
			}
			return false
		})
		hotkeys("ctrl+shift+r,command+shift+r", () => {
			if (this.mode == Modes.COMPONENT) {
				ComponentPlacer.instance.placeRotate(90)
			} else {
				if (SelectionController.instance.hasSelection()) {
					SelectionController.instance.rotateSelection(90)
					Undo.instance.addState()
				}
			}
			return false
		})

		//flip selection
		// Arrow keys nudge the current selection by one minor grid step (Shift = one full major cell).
		hotkeys("up,down,left,right,shift+up,shift+down,shift+left,shift+right", (event, handler) => {
			if (this.mode == Modes.COMPONENT) return
			if (!SelectionController.instance.hasSelection()) return
			event.preventDefault()
			const minorPx = new SVG.Number(
				CanvasController.instance.majorGridSizecm / CanvasController.instance.majorGridSubdivisions,
				"cm"
			).convertToUnit("px").value
			const step = event.shiftKey ? minorPx * CanvasController.instance.majorGridSubdivisions : minorPx
			const k = handler.key
			let d: SVG.Point
			if (k.includes("up")) d = new SVG.Point(0, -step)
			else if (k.includes("down")) d = new SVG.Point(0, step)
			else if (k.includes("left")) d = new SVG.Point(-step, 0)
			else d = new SVG.Point(step, 0)
			SelectionController.instance.moveSelectionRel(d)
			Undo.instance.addState()
			return false
		})
		hotkeys("shift+x", () => {
			if (this.mode == Modes.COMPONENT) {
				ComponentPlacer.instance.placeFlip(true)
			} else {
				if (SelectionController.instance.hasSelection()) {
					SelectionController.instance.flipSelection(true)
					Undo.instance.addState()
				}
			}
			return false
		})
		hotkeys("shift+y", () => {
			if (this.mode == Modes.COMPONENT) {
				ComponentPlacer.instance.placeFlip(false)
			} else {
				if (SelectionController.instance.hasSelection()) {
					SelectionController.instance.flipSelection(false)
					Undo.instance.addState()
				}
			}
			return false
		})

		// select everything
		hotkeys("ctrl+a,command+a", () => {
			SelectionController.instance.selectAll()
			return false
		})

		//undo/redo
		hotkeys("ctrl+z,command+z", () => {
			Undo.instance.undo()
			return false
		})
		hotkeys("ctrl+y,command+y", () => {
			Undo.instance.redo()
			return false
		})
		// Mac's standard redo is ⌘+Shift+Z (⌘Y is non-standard on macOS); Windows also accepts Ctrl+Shift+Z.
		hotkeys("ctrl+shift+z,command+shift+z", () => {
			Undo.instance.redo()
			return false
		})
		document.getElementById("undoButton").addEventListener("click", () => Undo.instance.undo())
		document.getElementById("redoButton").addEventListener("click", () => Undo.instance.redo())

		//copy/paste
		hotkeys("ctrl+c,command+c", () => {
			CopyPaste.instance.copy()
			return false
		})
		hotkeys("ctrl+v,command+v", () => {
			CopyPaste.instance.paste()
			return false
		})
		hotkeys("ctrl+x,command+x", () => {
			CopyPaste.instance.cut()
			return false
		})

		//save/load
		hotkeys("ctrl+s,command+s", () => {
			SaveController.instance.save()
			return false
		})
		hotkeys("ctrl+o,command+o", () => {
			SaveController.instance.load()
			return false
		})
		hotkeys("ctrl+shift+o,command+shift+o", () => {
			ImportController.instance.open("paste", "tikz")
			return false
		})
		hotkeys("ctrl+e,command+e", () => {
			ExportController.instance.exportCircuiTikZ()
			return false
		})
		hotkeys("ctrl+shift+e,command+shift+e", () => {
			ExportController.instance.exportSVG()
			return false
		})

		// mode change
		hotkeys("q", () => {
			document.getElementById("addComponentButton").dispatchEvent(new MouseEvent("click"))
			return false
		})
		hotkeys("esc", () => {
			this.switchMode(Modes.DRAG_PAN)
			return false
		})
		hotkeys("w", () => {
			this.switchMode(Modes.DRAG_PAN)
			ComponentPlacer.instance.placeComponent(new WireComponent())
			return false
		})
		hotkeys("del, backspace", () => {
			if (!SelectionController.instance.hasSelection()) {
				this.switchMode(Modes.ERASE)
			} else {
				SelectionController.instance.removeSelection()
				Undo.instance.addState()
			}
			return false
		})
		hotkeys("t", () => {
			this.switchMode(Modes.DRAG_PAN)
			ComponentPlacer.instance.placeComponent(new RectangleComponent(true))
			return false
		})
		// ? (Shift+/) opens the Help modal, which now leads with the keyboard cheat-sheet.
		hotkeys("shift+/", () => {
			document.getElementById("helpButton")?.click()
			return false
		})

		// handle shortcuts for adding components
		// shortcutDict maps the Shortcut key to the title attribute of the html element where the callback can be found
		var shortcutDict: { shortcut: string; component: string }[] = [
			{ shortcut: "g", component: "Ground" },
			{ shortcut: "alt+g,option+g", component: "Ground (tailless)" },
			{ shortcut: "r", component: "Resistor (american)" },
			{ shortcut: "alt+r,option+r", component: "Resistor (european)" },
			{ shortcut: "c", component: "Capacitor" },
			{ shortcut: "alt+c,option+c", component: "Curved (polarized) capacitor" },
			{ shortcut: "l", component: "Inductor (american)" },
			{ shortcut: "alt+l,option+l", component: "Inductor (cute)" },
			{ shortcut: "d", component: "Empty diode" },
			{ shortcut: "b", component: "NPN" },
			{ shortcut: "alt+b,option+b", component: "PNP" },
			{ shortcut: "n", component: "NMOS" },
			{ shortcut: "alt+n,option+n", component: "PMOS" },
			{ shortcut: "x", component: "Plain style crossing node" },
			{ shortcut: "alt+x,option+x", component: "Jumper-style crossing node" },
			{ shortcut: ".", component: "Connected terminal" },
			{ shortcut: "alt+.,option+.", component: "Unconnected terminal" },
		]
		// when a valid shortcut button is pressed, simulate a click on the corresponding button for the component
		for (const { shortcut, component } of shortcutDict) {
			hotkeys(shortcut, () => {
				this.switchMode(Modes.DRAG_PAN) //switch to standard mode to avoid weird states
				var componentButton = document.querySelector('[title="' + component + '"]')
				var clickEvent = new MouseEvent("mouseup", { view: window, bubbles: true, cancelable: true })
				componentButton?.dispatchEvent(clickEvent)
			})
		}
	}

	/**
	 * Init the canvas controller
	 */
	private async initCanvas() {
		let canvasElement: SVGSVGElement = await waitForElementLoaded("canvas")
		if (canvasElement) this.canvasController = new CanvasController(new SVG.Svg(canvasElement))
	}

	/**
	 * Fetch & parse the symbol(s) svg.
	 */
	private async initSymbolDB() {
		// Fetch symbol DB
		const symbolDBlink: HTMLLinkElement = await waitForElementLoaded("symbolDBlink")
		const response = await fetch(symbolDBlink.href, {
			method: "GET",
			// must match symbolDBlink cors options in order to actually use the preloaded file
			mode: "cors",
			credentials: "same-origin",
		})
		const textContent = await response.text()

		// Parse & add to DOM
		const symbolsDocument: XMLDocument = new DOMParser().parseFromString(textContent, "image/svg+xml")
		const symbolsSVGSVGElement: SVGSVGElement = document.adoptNode(
			symbolsDocument.firstElementChild as SVGSVGElement
		)
		symbolsSVGSVGElement.style.display = "none"
		symbolsSVGSVGElement.setAttribute("id", "symbolDB")
		document.body.appendChild(symbolsSVGSVGElement)

		// Extract symbols
		this.symbolsSVG = new SVG.Svg(symbolsSVGSVGElement)
		const componentsMetadata = Array.from(this.symbolsSVG.node.getElementsByTagName("component"))

		this.symbols = componentsMetadata.flatMap((componentMetadata) => {
			return new ComponentSymbol(componentMetadata)
		})
	}

	/**
	 * Init the mode change buttons.
	 */
	private initModeButtons() {
		this.modeSwitchButtons.modeDragPan = document.getElementById("modeDragPan")
		this.modeSwitchButtons.modeDrawLine = document.getElementById("modeDrawLine")
		this.modeSwitchButtons.modeEraser = document.getElementById("modeEraser")

		this.modeSwitchButtons.modeDragPan.addEventListener("click", () => this.switchMode(Modes.DRAG_PAN), {
			passive: false,
		})
		this.modeSwitchButtons.modeDrawLine.addEventListener(
			"click",
			() => {
				this.switchMode(Modes.DRAG_PAN)
				this.modeSwitchButtons.modeDrawLine.classList.add("selected")
				ComponentPlacer.instance.placeComponent(new WireComponent())
			},
			{ passive: false }
		)
		this.modeSwitchButtons.modeEraser.addEventListener("click", () => this.switchMode(Modes.ERASE), {
			passive: false,
		})

		// "Detect from image" toolbar button - opens the unified import modal jumped
		// straight to the Image tab so the user can drop or browse a snapshot of a
		// hand-drawn or photographed circuit. Replaces the old handwriting placeholder.
		const detectBtn = document.getElementById("modeDetectImage")
		if (detectBtn) {
			detectBtn.addEventListener("click", (ev) => {
				ev.preventDefault()
				ImportController.instance.open("upload")
				// ImportController only knows about "upload"/"paste" - switch to the
				// Image tab manually via the Bootstrap Tab API.
				const imageTabBtn = document.getElementById("importTabImage") as HTMLButtonElement | null
				if (imageTabBtn) Tab.getOrCreateInstance(imageTabBtn).show()
			})
		}
	}

	/** Lightweight toast helper - used for non-blocking informational pings. */
	public static toast(message: string, durationMs = 3500) {
		const host = document.getElementById("toastHost") || (() => {
			const el = document.createElement("div")
			el.id = "toastHost"
			el.style.cssText =
				"position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;pointer-events:none;"
			document.body.appendChild(el)
			return el
		})()
		const toast = document.createElement("div")
		toast.textContent = message
		toast.style.cssText =
			"background:rgba(33,37,41,0.95);color:#fff;padding:10px 16px;border-radius:8px;" +
			"box-shadow:0 4px 12px rgba(0,0,0,0.25);font-size:0.875rem;max-width:480px;" +
			"opacity:0;transform:translateY(8px);transition:opacity 200ms ease-out,transform 200ms ease-out;"
		host.appendChild(toast)
		requestAnimationFrame(() => {
			toast.style.opacity = "1"
			toast.style.transform = "translateY(0)"
		})
		setTimeout(() => {
			toast.style.opacity = "0"
			toast.style.transform = "translateY(8px)"
			setTimeout(() => toast.remove(), 220)
		}, durationMs)
	}

	private addShapeComponentsToOffcanvas(leftOffcanvasAccordion: HTMLDivElement, leftOffcanvasOC: Offcanvas) {
		// Add shapes accordion area
		let groupName = "Basic"
		const collapseGroupID = "collapseGroup-" + groupName.replace(/[^\d\w\-\_]+/gi, "-")

		const accordionGroup = leftOffcanvasAccordion.appendChild(document.createElement("div"))
		accordionGroup.classList.add("accordion-item")

		const accordionItemHeader = accordionGroup.appendChild(document.createElement("h2"))
		accordionItemHeader.classList.add("accordion-header")

		const accordionItemButton = accordionItemHeader.appendChild(document.createElement("button"))
		accordionItemButton.classList.add("accordion-button")
		accordionItemButton.innerText = groupName
		accordionItemButton.setAttribute("aria-controls", collapseGroupID)
		accordionItemButton.setAttribute("aria-expanded", "true")
		accordionItemButton.setAttribute("data-bs-target", "#" + collapseGroupID)
		accordionItemButton.setAttribute("data-bs-toggle", "collapse")
		accordionItemButton.type = "button"

		const accordionItemCollapse = accordionGroup.appendChild(document.createElement("div"))
		accordionItemCollapse.classList.add("accordion-collapse", "collapse", "show")
		accordionItemCollapse.id = collapseGroupID
		accordionItemCollapse.setAttribute("data-bs-parent", "#leftOffcanvasAccordion")

		const accordionItemBody = accordionItemCollapse.appendChild(document.createElement("div"))
		accordionItemBody.classList.add("accordion-body", "iconLibAccordionBody")

		//Add Short
		{
			const addButton: HTMLDivElement = accordionItemBody.appendChild(document.createElement("div"))
			addButton.classList.add("libComponent")
			addButton.setAttribute("searchData", "short path")
			addButton.ariaRoleDescription = "button"
			addButton.title = "Short"

			const listener = (ev: MouseEvent) => {
				ev.preventDefault()

				this.switchMode(Modes.DRAG_PAN)
				let newComponent = new ShortComponent()
				ComponentPlacer.instance.placeComponent(newComponent)

				leftOffcanvasOC.hide()
			}

			addButton.addEventListener("mouseup", listener)
			addButton.addEventListener("touchstart", listener, { passive: false })

			let svgIcon = SVG.SVG().addTo(addButton)
			svgIcon.viewbox(-1, -14, 30, 15)
			svgIcon.line(0, -7, 29, -7).stroke({ color: defaultStroke, width: 2 })
		}

		//Add Open
		{
			const addButton: HTMLDivElement = accordionItemBody.appendChild(document.createElement("div"))
			addButton.classList.add("libComponent")
			addButton.setAttribute("searchData", "open path")
			addButton.ariaRoleDescription = "button"
			addButton.title = "Open"

			const listener = (ev: MouseEvent) => {
				ev.preventDefault()

				this.switchMode(Modes.DRAG_PAN)
				let newComponent = new OpenComponent()
				ComponentPlacer.instance.placeComponent(newComponent)

				leftOffcanvasOC.hide()
			}

			addButton.addEventListener("mouseup", listener)
			addButton.addEventListener("touchstart", listener, { passive: false })

			let svgIcon = SVG.SVG().addTo(addButton)
			svgIcon.viewbox(-1, -14, 30, 15)
			svgIcon.circle(5).fill("none").stroke({ color: defaultStroke, width: 1 }).center(4, -7)
			svgIcon.circle(5).fill("none").stroke({ color: defaultStroke, width: 1 }).center(25, -7)
		}

		//Add Text
		{
			const addButton: HTMLDivElement = accordionItemBody.appendChild(document.createElement("div"))
			addButton.classList.add("libComponent")
			addButton.setAttribute("searchData", "text node")
			addButton.ariaRoleDescription = "button"
			addButton.title = "Text"

			const listener = (ev: MouseEvent) => {
				ev.preventDefault()

				this.switchMode(Modes.DRAG_PAN)
				let newComponent = new RectangleComponent(true)
				ComponentPlacer.instance.placeComponent(newComponent)

				leftOffcanvasOC.hide()
			}

			addButton.addEventListener("mouseup", listener)
			addButton.addEventListener("touchstart", listener, { passive: false })

			let svgIcon = SVG.SVG().addTo(addButton)
			svgIcon.viewbox(-1, -14, 30, 15)
			svgIcon.text((add) => {
				add.tspan("Text").fill({ color: defaultStroke })
			})
		}

		//Add rectangle
		{
			const addButton: HTMLDivElement = accordionItemBody.appendChild(document.createElement("div"))
			addButton.classList.add("libComponent")
			addButton.setAttribute("searchData", "rect rectangle node")
			addButton.ariaRoleDescription = "button"
			addButton.title = "Rectangle/Text"

			const listener = (ev: MouseEvent) => {
				ev.preventDefault()

				this.switchMode(Modes.DRAG_PAN)
				let newComponent = new RectangleComponent(false)
				ComponentPlacer.instance.placeComponent(newComponent)

				leftOffcanvasOC.hide()
			}

			addButton.addEventListener("mouseup", listener)
			addButton.addEventListener("touchstart", listener, { passive: false })

			let svgIcon = SVG.SVG().addTo(addButton)
			svgIcon.viewbox(0, 0, 17, 12)
			svgIcon.rect(15, 10).move(1, 1).fill("none").stroke({
				color: defaultStroke,
				width: 1,
			})
		}
		//Add Ellipse
		{
			const addButton: HTMLDivElement = accordionItemBody.appendChild(document.createElement("div"))
			addButton.classList.add("libComponent")
			addButton.setAttribute("searchData", "ellipse circle node")
			addButton.ariaRoleDescription = "button"
			addButton.title = "Ellipse"

			const listener = (ev: MouseEvent) => {
				ev.preventDefault()
				this.switchMode(Modes.COMPONENT)

				if (ComponentPlacer.instance.component) {
					ComponentPlacer.instance.placeCancel()
				}

				let newComponent = new EllipseComponent()
				ComponentPlacer.instance.placeComponent(newComponent)

				leftOffcanvasOC.hide()
			}

			addButton.addEventListener("mouseup", listener)
			addButton.addEventListener("touchstart", listener, { passive: false })

			let svgIcon = SVG.SVG().addTo(addButton)
			svgIcon.viewbox(0, 0, 17, 12)
			svgIcon.ellipse(15, 10).move(1, 1).fill("none").stroke({
				color: defaultStroke,
				width: 1,
			})
		}

		//Add Polygon
		{
			const addButton: HTMLDivElement = accordionItemBody.appendChild(document.createElement("div"))
			addButton.classList.add("libComponent")
			addButton.setAttribute("searchData", "polygon path")
			addButton.ariaRoleDescription = "button"
			addButton.title = "Polygon"

			const listener = (ev: MouseEvent) => {
				ev.preventDefault()
				this.switchMode(Modes.COMPONENT)

				if (ComponentPlacer.instance.component) {
					ComponentPlacer.instance.placeCancel()
				}

				let newComponent = new PolygonComponent()
				ComponentPlacer.instance.placeComponent(newComponent)

				leftOffcanvasOC.hide()
			}

			addButton.addEventListener("mouseup", listener)
			addButton.addEventListener("touchstart", listener, { passive: false })

			let svgIcon = SVG.SVG().addTo(addButton)
			svgIcon.viewbox(0, 0, 17, 12)
			svgIcon
				.polygon([
					[1, 1],
					[16, 1],
					[15, 11],
					[11, 9],
					[5, 11],
				])
				.fill("none")
				.stroke({
					color: defaultStroke,
					width: 1,
				})
		}

		//Add straight line
		{
			const addButton: HTMLDivElement = accordionItemBody.appendChild(document.createElement("div"))
			addButton.classList.add("libComponent")
			addButton.setAttribute("searchData", "straight line path")
			addButton.ariaRoleDescription = "button"
			addButton.title = "Straight line"

			const listener = (ev: MouseEvent) => {
				ev.preventDefault()

				this.switchMode(Modes.DRAG_PAN)
				let newComponent = new WireComponent(true)
				ComponentPlacer.instance.placeComponent(newComponent)

				leftOffcanvasOC.hide()
			}

			addButton.addEventListener("mouseup", listener)
			addButton.addEventListener("touchstart", listener, { passive: false })

			let svgIcon = SVG.SVG().addTo(addButton)
			svgIcon.viewbox(0, 0, 17, 12)
			svgIcon.line(2, 10, 15, 2).stroke({ color: defaultStroke, width: 1, opacity: 1 })
		}

		//Add cubic spline
		{
			const addButton: HTMLDivElement = accordionItemBody.appendChild(document.createElement("div"))
			addButton.classList.add("libComponent")
			addButton.setAttribute("searchData", "spline curve bezier path stray line")
			addButton.ariaRoleDescription = "button"
			addButton.title = "Cubic spline"

			const listener = (ev: MouseEvent) => {
				ev.preventDefault()
				this.switchMode(Modes.COMPONENT)

				if (ComponentPlacer.instance.component) {
					ComponentPlacer.instance.placeCancel()
				}

				ComponentPlacer.instance.placeComponent(new SplineComponent())

				leftOffcanvasOC.hide()
			}

			addButton.addEventListener("mouseup", listener)
			addButton.addEventListener("touchstart", listener, { passive: false })

			let svgIcon = SVG.SVG().addTo(addButton)
			svgIcon.viewbox(0, 0, 17, 12)
			svgIcon
				.path("M 1 10 C 4 1, 13 1, 16 10")
				.fill("none")
				.stroke({ color: defaultStroke, width: 1, opacity: 1 })
		}

		// Preset curves - drop a ready-made shape in one click instead of placing anchors by hand.
		{
			const curvePresets: {
				titleKey: string
				search: string
				icon: string
				kind: "arc" | "scurve" | "wave" | "hop" | "corner" | "loop" | "double"
			}[] = [
				{ titleKey: "symbols.preset.arc", search: "arc curve spline bend bridge", icon: "M 1 11 C 4 1, 13 1, 16 11", kind: "arc" },
				{ titleKey: "symbols.preset.scurve", search: "s curve spline ess sigmoid", icon: "M 1 11 C 7 11, 10 1, 16 1", kind: "scurve" },
				{
					titleKey: "symbols.preset.wave",
					search: "wave sine spline oscillation curve ac signal",
					icon: "M 1 6 C 3 1, 6 1, 8 6 C 10 11, 13 11, 16 6",
					kind: "wave",
				},
				{ titleKey: "symbols.preset.hop", search: "hop bump crossover cross wire jump bridge semicircle", icon: "M 2 11 C 4 2, 13 2, 15 11", kind: "hop" },
				{ titleKey: "symbols.preset.corner", search: "corner elbow bend right angle 90 routing orthogonal", icon: "M 2 11 C 9 11, 15 9, 15 2", kind: "corner" },
				{ titleKey: "symbols.preset.loop", search: "loop teardrop coil crossover circle", icon: "M 6 11 C 1 2, 15 2, 10 11", kind: "loop" },
				{ titleKey: "symbols.preset.double", search: "double hump bump crossover two wires arch", icon: "M 1 11 C 2 3, 6 3, 8 11 C 10 3, 14 3, 15 11", kind: "double" },
			]
			for (const cp of curvePresets) {
				const addButton: HTMLDivElement = accordionItemBody.appendChild(document.createElement("div"))
				addButton.classList.add("libComponent")
				addButton.setAttribute("searchData", cp.search)
				addButton.ariaRoleDescription = "button"
				addButton.title = t(cp.titleKey)
				addButton.setAttribute("data-i18n-title", cp.titleKey)

				const listener = (ev: MouseEvent) => {
					ev.preventDefault()
					this.switchMode(Modes.COMPONENT)

					if (ComponentPlacer.instance.component) {
						ComponentPlacer.instance.placeCancel()
					}

					ComponentPlacer.instance.placeComponent(SplineComponent.fromPreset(cp.kind))

					leftOffcanvasOC.hide()
				}

				addButton.addEventListener("mouseup", listener)
				addButton.addEventListener("touchstart", listener, { passive: false })

				let svgIcon = SVG.SVG().addTo(addButton)
				svgIcon.viewbox(0, 0, 17, 12)
				svgIcon.path(cp.icon).fill("none").stroke({ color: defaultStroke, width: 1, opacity: 1 })
			}
		}

		//Add straight arrow
		{
			const addButton: HTMLDivElement = accordionItemBody.appendChild(document.createElement("div"))
			addButton.classList.add("libComponent")
			addButton.setAttribute("searchData", "straight arrow path")
			addButton.ariaRoleDescription = "button"
			addButton.title = "Straight arrow"

			const listener = (ev: MouseEvent) => {
				ev.preventDefault()

				this.switchMode(Modes.DRAG_PAN)
				let newComponent = new WireComponent(true, true)
				ComponentPlacer.instance.placeComponent(newComponent)

				leftOffcanvasOC.hide()
			}

			addButton.addEventListener("mouseup", listener)
			addButton.addEventListener("touchstart", listener, { passive: false })

			let svgIcon = SVG.SVG().addTo(addButton)
			svgIcon.viewbox(-1, -1, 12, 6)
			svgIcon
				.polygon([
					[6, 0],
					[10, 2],
					[6, 4],
					[6, 2.2],
					[0, 2.2],
					[0, 1.8],
					[6, 1.8],
				])
				.rotate(-30, 5, 2)
				.fill({ color: defaultStroke })
		}

		//Add arrow
		{
			const addButton: HTMLDivElement = accordionItemBody.appendChild(document.createElement("div"))
			addButton.classList.add("libComponent")
			addButton.setAttribute("searchData", "arrow path")
			addButton.ariaRoleDescription = "button"
			addButton.title = "Arrow"

			const listener = (ev: MouseEvent) => {
				ev.preventDefault()

				this.switchMode(Modes.DRAG_PAN)
				let newComponent = new WireComponent(false, true)
				ComponentPlacer.instance.placeComponent(newComponent)

				leftOffcanvasOC.hide()
			}

			addButton.addEventListener("mouseup", listener)
			addButton.addEventListener("touchstart", listener, { passive: false })

			let svgIcon = SVG.SVG().addTo(addButton)
			svgIcon.viewbox(-1, -2, 12, 8)
			svgIcon
				.polyline([
					[0, 5],
					[5, 5],
					[5, 0],
					[9.1, 0],
				])
				.stroke({ color: defaultStroke, width: 0.5 })
				.fill("none")
			svgIcon
				.polygon([
					[9, -1],
					[10.5, 0],
					[9, 1],
				])
				.fill({ color: defaultStroke })
		}
	}

	/**
	 * Init the left add offcanvas.
	 */
	private async initAddComponentOffcanvas() {
		const leftOffcanvas: HTMLDivElement = document.getElementById("leftOffcanvas") as HTMLDivElement
		const leftOffcanvasOC = new Offcanvas(leftOffcanvas)
		document.getElementById("componentFilterInput").addEventListener("input", this.filterComponents)
		document.getElementById("filterRegexButton").addEventListener("click", this.filterComponents)

		const addComponentButton: HTMLAnchorElement = document.getElementById("addComponentButton") as HTMLAnchorElement
		addComponentButton.addEventListener(
			"click",
			((ev: PointerEvent) => {
				this.switchMode(Modes.DRAG_PAN)
				leftOffcanvasOC.toggle()
				if (leftOffcanvas.classList.contains("showing") && ev.pointerType !== "touch") {
					let searchBar = document.getElementById("componentFilterInput")
					const refocus = () => {
						searchBar.focus()
						leftOffcanvas.removeEventListener("shown.bs.offcanvas", refocus)
					}
					refocus()
					leftOffcanvas.addEventListener("shown.bs.offcanvas", refocus)
				}
			}).bind(this),
			{ passive: true }
		)
		const leftOffcanvasAccordion: HTMLDivElement = document.getElementById(
			"leftOffcanvasAccordion"
		) as HTMLDivElement

		const groupedSymbols: Map<string, ComponentSymbol[]> = this.symbols.reduce(
			(
				groupedSymbols: Map<string, ComponentSymbol[]>,
				symbol: ComponentSymbol
			): Map<string, ComponentSymbol[]> => {
				const key = symbol.groupName || "Unsorted components"
				let group = groupedSymbols.get(key)
				if (group) group.push(symbol)
				else groupedSymbols.set(key, [symbol])
				return groupedSymbols
			},
			new Map()
		)

		this.addShapeComponentsToOffcanvas(leftOffcanvasAccordion, leftOffcanvasOC)

		for (const [groupName, symbols] of groupedSymbols.entries()) {
			const collapseGroupID = "collapseGroup-" + groupName.replace(/[^\d\w\-\_]+/gi, "-")

			const accordionGroup = leftOffcanvasAccordion.appendChild(document.createElement("div"))
			accordionGroup.classList.add("accordion-item")

			const accordionItemHeader = accordionGroup.appendChild(document.createElement("h2"))
			accordionItemHeader.classList.add("accordion-header")

			const accordionItemButton = accordionItemHeader.appendChild(document.createElement("button"))
			accordionItemButton.classList.add("accordion-button", "collapsed")
			accordionItemButton.innerText = groupName
			accordionItemButton.setAttribute("aria-controls", collapseGroupID)
			accordionItemButton.setAttribute("aria-expanded", "false")
			accordionItemButton.setAttribute("data-bs-target", "#" + collapseGroupID)
			accordionItemButton.setAttribute("data-bs-toggle", "collapse")
			accordionItemButton.type = "button"

			const accordionItemCollapse = accordionGroup.appendChild(document.createElement("div"))
			accordionItemCollapse.classList.add("accordion-collapse", "collapse")
			accordionItemCollapse.id = collapseGroupID
			accordionItemCollapse.setAttribute("data-bs-parent", "#leftOffcanvasAccordion")

			const accordionItemBody = accordionItemCollapse.appendChild(document.createElement("div"))
			accordionItemBody.classList.add("accordion-body", "iconLibAccordionBody")

			for (const symbol of symbols) {
				const addButton: HTMLDivElement = accordionItemBody.appendChild(document.createElement("div"))
				addButton.classList.add("libComponent")
				addButton.setAttribute(
					"searchData",
					[symbol.tikzName, symbol.isNodeSymbol ? "node" : "path"]
						.concat(
							symbol.possibleOptions
								.map((option) => option.displayName ?? option.name)
								.concat(
									symbol.possibleEnumOptions.flatMap((enumOption) =>
										enumOption.options.map((option) => option.displayName ?? option.name)
									)
								)
						)
						.join(" ")
				)
				addButton.ariaRoleDescription = "button"
				addButton.title = symbol.displayName || symbol.tikzName

				const listener = (ev: MouseEvent) => {
					ev.preventDefault()
					this.switchMode(Modes.COMPONENT)

					if (ComponentPlacer.instance.component) {
						ComponentPlacer.instance.placeCancel()
					}

					let newComponent: CircuitComponent
					if (symbol.isNodeSymbol) {
						newComponent = new NodeSymbolComponent(symbol)
					} else {
						newComponent = new PathSymbolComponent(symbol)
					}
					ComponentPlacer.instance.placeComponent(newComponent)
					pushRecentComponentName(symbol.tikzName)
					this.renderRecentComponents(leftOffcanvasOC)

					leftOffcanvasOC.hide()
				}

				addButton.addEventListener("mouseup", listener)
				addButton.addEventListener("touchstart", listener, { passive: false })

				let svgIcon = SVG.SVG().addTo(addButton)

				let viewBox = new SVG.Box(symbol._mapping.values().toArray()[0].viewBox)

				//oversize viewbox due to stroke widths
				viewBox.width += symbol.maxStroke
				viewBox.height += symbol.maxStroke
				viewBox.x -= symbol.maxStroke / 2
				viewBox.y -= symbol.maxStroke / 2

				// svg icon should have new size
				svgIcon.viewbox(viewBox).width(viewBox.width).height(viewBox.height)

				let use = svgIcon.use(symbol.symbolElement.id())
				use.width(symbol.viewBox.width).height(symbol.viewBox.height) // use should have original size values
				use.stroke(defaultStroke).fill(defaultFill).node.style.color = defaultStroke
			}
		}

		// Recently-used strip at the very top of the drawer - the parts you reach for, one glance away.
		this.renderRecentComponents(leftOffcanvasOC)
		leftOffcanvas.addEventListener("shown.bs.offcanvas", () => this.renderRecentComponents(leftOffcanvasOC))
	}

	/** Build one clickable component button (icon + place-on-click, records the pick as recently-used). */
	private buildLibComponentButton(symbol: ComponentSymbol, leftOffcanvasOC: Offcanvas): HTMLDivElement {
		const addButton = document.createElement("div")
		addButton.classList.add("libComponent")
		addButton.setAttribute(
			"searchData",
			[symbol.tikzName, symbol.isNodeSymbol ? "node" : "path"]
				.concat(
					symbol.possibleOptions
						.map((option) => option.displayName ?? option.name)
						.concat(
							symbol.possibleEnumOptions.flatMap((enumOption) =>
								enumOption.options.map((option) => option.displayName ?? option.name)
							)
						)
				)
				.join(" ")
		)
		addButton.ariaRoleDescription = "button"
		addButton.title = symbol.displayName || symbol.tikzName

		const listener = (ev: MouseEvent) => {
			ev.preventDefault()
			this.switchMode(Modes.COMPONENT)
			if (ComponentPlacer.instance.component) {
				ComponentPlacer.instance.placeCancel()
			}
			const newComponent: CircuitComponent =
				symbol.isNodeSymbol ? new NodeSymbolComponent(symbol) : new PathSymbolComponent(symbol)
			ComponentPlacer.instance.placeComponent(newComponent)
			pushRecentComponentName(symbol.tikzName)
			this.renderRecentComponents(leftOffcanvasOC)
			leftOffcanvasOC.hide()
		}
		addButton.addEventListener("mouseup", listener)
		addButton.addEventListener("touchstart", listener, { passive: false })

		const svgIcon = SVG.SVG().addTo(addButton)
		const viewBox = new SVG.Box(symbol._mapping.values().toArray()[0].viewBox)
		viewBox.width += symbol.maxStroke
		viewBox.height += symbol.maxStroke
		viewBox.x -= symbol.maxStroke / 2
		viewBox.y -= symbol.maxStroke / 2
		svgIcon.viewbox(viewBox).width(viewBox.width).height(viewBox.height)
		const use = svgIcon.use(symbol.symbolElement.id())
		use.width(symbol.viewBox.width).height(symbol.viewBox.height)
		use.stroke(defaultStroke).fill(defaultFill).node.style.color = defaultStroke
		return addButton
	}

	/**
	 * (Re)render the "Recently used" strip at the very top of the component drawer from the recents
	 * store. A plain (non-collapsing) section so the parts you reach for are always one glance away.
	 * No-op with an empty store, so a brand-new user just sees the normal grouped catalogue.
	 */
	private renderRecentComponents(leftOffcanvasOC: Offcanvas): void {
		const accordion = document.getElementById("leftOffcanvasAccordion")
		if (!accordion) return
		document.getElementById("recentComponentsGroup")?.remove()

		const recents = loadRecentComponentNames()
			.map((name) => this.symbols.find((s) => s.tikzName === name))
			.filter((s): s is ComponentSymbol => !!s)
		if (recents.length === 0) return

		const group = document.createElement("div")
		group.id = "recentComponentsGroup"
		group.classList.add("accordion-item")
		const header = document.createElement("div")
		header.className = "recent-header"
		header.textContent = t("symbols.recent")
		const body = document.createElement("div")
		body.classList.add("accordion-body", "iconLibAccordionBody")
		for (const s of recents) body.appendChild(this.buildLibComponentButton(s, leftOffcanvasOC))
		group.append(header, body)
		accordion.insertBefore(group, accordion.firstChild)
	}

	/**
	 * filter the components in the left OffCanvas to only show what matches the search string (in a new accordeon item)
	 */
	private filterComponents(evt: Event) {
		evt.preventDefault()
		evt.stopPropagation()

		const element = document.getElementById("componentFilterInput") as HTMLInputElement
		const feedbacktext = document.getElementById("invalid-feedback-text")
		const filterWithRegex = document.getElementById("filterRegexButton").classList.contains("active")

		let text = element.value
		let regex = null
		if (filterWithRegex) {
			regex = new RegExp(text, "i")
			element.classList.remove("is-invalid")
			feedbacktext.classList.add("d-none")
		} else {
			try {
				regex = new RegExp(".*" + text.split("").join(".*") + ".*", "i")
				element.classList.remove("is-invalid")
				feedbacktext.classList.add("d-none")
			} catch (e) {
				text = ""
				regex = new RegExp(text, "i")
				element.classList.add("is-invalid")
				feedbacktext.classList.remove("d-none")
			}
		}

		const accordion = document.getElementById("leftOffcanvasAccordion")

		const accordionItems = accordion.getElementsByClassName("accordion-item")
		Array.prototype.forEach.call(accordionItems, (accordionItem: HTMLDivElement, index: number) => {
			const libComponents = accordionItem.getElementsByClassName("libComponent")
			let showCount = 0
			Array.prototype.forEach.call(libComponents, (libComponent: HTMLDivElement) => {
				if (text) {
					if (!(regex.test(libComponent.title) || regex.test(libComponent.getAttribute("searchData")))) {
						libComponent.classList.add("d-none")
						return
					}
				}
				libComponent.classList.remove("d-none")
				showCount++
			})
			if (showCount === 0) {
				accordionItem.classList.add("d-none")
			} else {
				accordionItem.classList.remove("d-none")
			}

			if (text) {
				accordionItem.children[0]?.children[0]?.classList.remove("collapsed")
				accordionItem.children[1]?.classList.add("show")
			} else {
				accordionItem.children[0]?.children[0]?.classList.add("collapsed")
				accordionItem.children[1]?.classList.remove("show")
			}

			if (index === 0) {
				accordionItem.children[0]?.children[0]?.classList.remove("collapsed")
				accordionItem.children[1]?.classList.add("show")
			}
		})
	}

	/**
	 * Refresh the bottom status bar with the current tool, cursor position, zoom, and
	 * component count. Cheap to call - DOM writes are gated behind value diffs so this is
	 * safe to invoke from a high-frequency callback like canvas pointermove.
	 */
	public refreshStatusBar() {
		const bar = document.getElementById("statusBar")
		if (!bar) return
		bar.classList.remove("muted")

		const toolEl = document.getElementById("statusTool")
		if (toolEl) {
			const label =
				this.mode === Modes.DRAG_PAN ? "Pan / Select"
				: this.mode === Modes.ERASE ? "Erase"
				: this.mode === Modes.COMPONENT ?
					ComponentPlacer.instance.component?.displayName ?? "Place"
				:	"-"
			if (toolEl.textContent !== label) toolEl.textContent = label
		}

		const countEl = document.getElementById("statusCount")
		if (countEl) {
			const n = String(this.circuitComponents.length)
			if (countEl.textContent !== n) countEl.textContent = n
		}

		// Hint visibility tracks the component count.
		const hint = document.getElementById("emptyCanvasHint")
		if (hint) hint.classList.toggle("hidden", this.circuitComponents.length > 0)
	}

	/** Update the cursor and zoom readouts. Called from CanvasController via a thin shim. */
	public updateStatusCursor(xCm: number, yCm: number) {
		const el = document.getElementById("statusCursor")
		if (el) el.textContent = `${xCm.toFixed(2)}, ${yCm.toFixed(2)} cm`
	}
	public updateStatusZoom(zoomPercent: number) {
		const el = document.getElementById("statusZoom")
		if (el) el.textContent = `${Math.round(zoomPercent)}%`
	}

	/**
	 * Switches the mode. This deactivates the old controller and activates the new one.
	 */
	public switchMode(newMode: Modes) {
		if (newMode == this.mode) return
		let oldMode = this.mode
		this.mode = newMode

		switch (oldMode) {
			case Modes.DRAG_PAN:
				this.modeSwitchButtons.modeDragPan.classList.remove("selected")
				CanvasController.instance.deactivatePanning()
				SelectionController.instance.deactivateSelection()
				break
			case Modes.ERASE:
				this.modeSwitchButtons.modeEraser.classList.remove("selected")
				EraseController.instance.deactivate()
				break
			case Modes.COMPONENT:
				this.modeSwitchButtons.modeDragPan.classList.remove("selected")
				this.modeSwitchButtons.modeDrawLine.classList.remove("selected")
				ComponentPlacer.instance.placeCancel()
				CanvasController.instance.deactivatePanning()
				break
			default:
				break
		}

		switch (newMode) {
			case Modes.DRAG_PAN:
				this.modeSwitchButtons.modeDragPan.classList.add("selected")
				CanvasController.instance.activatePanning()
				SelectionController.instance.activateSelection()
				break
			case Modes.ERASE:
				this.modeSwitchButtons.modeEraser.classList.add("selected")
				EraseController.instance.activate()
				break
			case Modes.COMPONENT:
				this.modeSwitchButtons.modeDragPan.classList.add("selected")
				CanvasController.instance.activatePanning()
				break
			default:
				break
		}

		this.refreshStatusBar()
	}

	/**
	 * Walk every placed component and re-render its theme-aware visuals (stroke
	 * colour, fill colour, label colour, etc.). Called on cold start once the
	 * symbol DB is ready, and on every {@link ThemeController} `theme-changed`
	 * event afterwards. Cheap to call repeatedly - each component is a no-op if
	 * its colours already match.
	 */
	public updateComponentTheme() {
		for (const instance of this.circuitComponents) {
			instance.updateTheme()
		}
	}

	/**
	 * Backwards-compatible alias for {@link updateComponentTheme}. The old name
	 * lived everywhere (especially in `exportController` which flips `darkMode`
	 * during SVG export); keep it so external callers don't break.
	 */
	public updateTheme() {
		this.updateComponentTheme()
	}

	/**
	 * add missing fill attributes to all symbol db entries where fill is undefined --> needs explicit setting, otherwise the color theme change does strange things.
	 * called once on initialization
	 * @param {Element} node
	 */
	private preprocessSymbolColors(node: Element) {
		//exchange all explicit blacks with defaultStroke and all explicit whites with defaultFill
		node.querySelectorAll("[fill]").forEach((elem) => {
			if (elem.getAttribute("fill") == "#000") {
				elem.setAttribute("fill", defaultStroke)
			} else if (elem.getAttribute("fill") == "#fff") {
				elem.setAttribute("fill", defaultFill)
			}
		})
		node.querySelectorAll("[stroke]").forEach((elem) => {
			if (elem.getAttribute("stroke") == "#000") {
				elem.setAttribute("stroke", defaultStroke)
			} else if (elem.getAttribute("stroke") == "#fff") {
				elem.setAttribute("stroke", defaultFill)
			}
		})

		node.querySelectorAll(".fillable").forEach((elem) => {
			if (elem.getAttribute("fill") == "none") {
				elem.setAttribute("fill", "currentFill")
			}
		})

		if (node.getAttribute("fill") == "#000") {
			node.setAttribute("fill", defaultStroke)
		} else if (node.getAttribute("fill") == "#fff") {
			node.setAttribute("fill", defaultFill)
		}

		if (node.getAttribute("stroke") == "#000") {
			node.setAttribute("stroke", defaultStroke)
		} else if (node.getAttribute("stroke") == "#fff") {
			node.setAttribute("stroke", defaultFill)
		}

		this.addFill(node)
	}

	private addFill(node: Element) {
		let hasFill = node.getAttribute("fill") !== null
		if (hasFill) {
			return
		}
		for (const element of node.children) {
			if (element.nodeName === "g") {
				this.addFill(element)
			} else {
				if (!element.getAttribute("fill")) {
					element.setAttribute("fill", "currentColor")
				}
			}
		}
	}

	/**
	 * Adds a new instance to {@link circuitComponents} and adds its snapping points.
	 */
	/**
	 * Mount the theme + language pickers in the top bar. Both render as small
	 * dropdowns that live alongside the existing help button.
	 */
	private installTopBarPickers() {
		const host = document.getElementById("topBarPickers")
		if (!host) return

		// Theme picker - click opens full menu; use the palette icon as the visible affordance.
		const themeBtn = document.createElement("a")
		themeBtn.className = "toolbarButton material-symbols-outlined"
		themeBtn.role = "button"
		themeBtn.id = "themePickerBtn"
		themeBtn.setAttribute("data-bs-toggle", "tooltip")
		themeBtn.setAttribute("data-bs-placement", "bottom")
		const refreshThemeBtn = () => {
			themeBtn.textContent = themeIconFor(ThemeController.instance.theme)
			themeBtn.setAttribute(
				"data-bs-title",
				`${t("top.theme")}: ${themeLabel(ThemeController.instance.theme)}`
			)
			themeBtn.setAttribute(
				"title",
				`${t("top.theme")}: ${themeLabel(ThemeController.instance.theme)}`
			)
		}
		themeBtn.addEventListener("click", (ev) => {
			const rect = themeBtn.getBoundingClientRect()
			openThemeMenu(rect.left, rect.bottom + 4, () => {
				refreshThemeBtn()
				this.updateTooltips()
			})
			ev.stopPropagation()
		})
		host.appendChild(themeBtn)
		refreshThemeBtn()

		// Language picker.
		const langBtn = document.createElement("a")
		langBtn.className = "toolbarButton"
		langBtn.role = "button"
		langBtn.id = "langPickerBtn"
		langBtn.setAttribute("data-bs-toggle", "tooltip")
		langBtn.setAttribute("data-bs-placement", "bottom")
		langBtn.style.fontFamily = "var(--font-mono)"
		langBtn.style.fontSize = "13px"
		langBtn.style.fontWeight = "600"
		langBtn.style.letterSpacing = "0.08em"
		const refreshLangBtn = () => {
			langBtn.textContent = getLocale().toUpperCase()
			langBtn.setAttribute("data-bs-title", `${t("top.language")}: ${langLabel(getLocale())}`)
			langBtn.setAttribute("title", `${t("top.language")}: ${langLabel(getLocale())}`)
		}
		langBtn.addEventListener("click", (ev) => {
			const rect = langBtn.getBoundingClientRect()
			openLangMenu(rect.left, rect.bottom + 4, () => {
				refreshLangBtn()
				this.updateTooltips()
			})
			ev.stopPropagation()
		})
		host.appendChild(langBtn)
		refreshLangBtn()

		// Command palette opener - visible affordance for users who don't know the shortcut.
		const cmdBtn = document.createElement("a")
		cmdBtn.className = "toolbarButton material-symbols-outlined"
		cmdBtn.role = "button"
		cmdBtn.id = "cmdPaletteBtn"
		cmdBtn.textContent = "search"
		cmdBtn.setAttribute("data-bs-toggle", "tooltip")
		cmdBtn.setAttribute("data-bs-placement", "bottom")
		cmdBtn.setAttribute(
			"data-bs-title",
			`${t("top.search")} (Ctrl/⌘+K)`
		)
		cmdBtn.addEventListener("click", () => CommandPaletteController.instance.open())
		host.appendChild(cmdBtn)

		window.addEventListener("locale-changed", () => {
			refreshThemeBtn()
			refreshLangBtn()
			cmdBtn.setAttribute("data-bs-title", `${t("top.search")} (Ctrl/⌘+K)`)
			this.updateTooltips()
			applyTranslations()
			this.renderEmptyCanvasHint()
		})

		// initial hint render
		this.renderEmptyCanvasHint()
	}

	/** Render the empty-canvas hint with interpolated keyboard shortcut chips. */
	private renderEmptyCanvasHint() {
		const row1 = document.getElementById("hintRow1")
		const row2 = document.getElementById("hintRow2")
		if (!row1 || !row2) return

		const kbd = (label: string) => `<span class="hint-keys"><kbd>${label}</kbd></span>`
		const kbdCombo = (...keys: string[]) =>
			`<span class="hint-keys">${keys.map((k) => `<kbd>${k}</kbd>`).join("+")}</span>`

		row1.innerHTML = t("hint.intro", { q: kbd("Q"), w: kbd("W") })
		row2.innerHTML = t("hint.search", { cmdK: kbdCombo("Ctrl", "K") })
	}

	/**
	 * Register the default set of palette commands. Each feature controller can call
	 * `CommandPaletteController.instance.register(...)` to add its own - this is just
	 * the bootstrapping batch for tools / themes / language / file actions.
	 */
	private installCommandPalette() {
		const cp = CommandPaletteController.instance

		cp.registerMany([
			// --- Tools ---
			{
				id: "tool.pan",
				title: () => t("tool.pan"),
				icon: "drag_pan",
				section: t("cmd.section.tools"),
				shortcut: "Esc",
				keywords: ["select", "auswählen", "verschieben"],
				run: () => this.switchMode(Modes.DRAG_PAN),
			},
			{
				id: "tool.draw",
				title: () => t("tool.draw"),
				icon: "draw",
				section: t("cmd.section.tools"),
				shortcut: "W",
				keywords: ["wire", "draht", "leitung"],
				run: () => {
					this.switchMode(Modes.DRAG_PAN)
					ComponentPlacer.instance.placeComponent(new WireComponent())
				},
			},
			{
				id: "tool.erase",
				title: () => t("tool.erase"),
				icon: "ink_eraser",
				section: t("cmd.section.tools"),
				shortcut: "Del",
				keywords: ["delete", "remove", "löschen", "radieren"],
				run: () => this.switchMode(Modes.ERASE),
			},
			{
				id: "tool.add",
				title: () => t("tool.add"),
				icon: "add",
				section: t("cmd.section.tools"),
				shortcut: "Q",
				keywords: ["component", "library", "bauteil", "bibliothek"],
				run: () => document.getElementById("addComponentButton")?.click(),
			},

			// --- File / Actions ---
			{
				id: "action.save",
				title: () => t("top.save"),
				icon: "save",
				section: t("cmd.section.actions"),
				shortcut: "Ctrl+S",
				keywords: ["speichern"],
				run: () => document.getElementById("saveButton")?.click(),
			},
			{
				id: "action.load",
				title: () => t("top.load"),
				icon: "file_open",
				section: t("cmd.section.actions"),
				shortcut: "Ctrl+O",
				keywords: ["öffnen", "laden"],
				run: () => document.getElementById("loadButton")?.click(),
			},
			{
				id: "action.import",
				title: () => t("top.import"),
				icon: "content_paste_go",
				section: t("cmd.section.actions"),
				shortcut: "Ctrl+Shift+O",
				keywords: ["paste", "tikz", "circuitikz", "einfügen", "importieren"],
				run: () => document.getElementById("importTikZButton")?.click(),
			},
			{
				id: "action.exportTikz",
				title: () => t("top.exportTikz"),
				icon: "code",
				section: t("cmd.section.actions"),
				shortcut: "Ctrl+E",
				keywords: ["latex", "tikz", "exportieren"],
				run: () => document.getElementById("exportCircuiTikZButton")?.click(),
			},
			{
				id: "action.exportSvg",
				title: () => t("top.exportSvg"),
				icon: "image",
				section: t("cmd.section.actions"),
				keywords: ["png", "image", "bild"],
				run: () => document.getElementById("exportSVGButton")?.click(),
			},

			// --- Themes ---
			// Generated from THEME_META so adding a theme is a one-place edit. The
			// command id is `theme.<id>` (one entry per theme) and the run handler
			// just calls ThemeController.setTheme.
			...THEME_META.map((m) => ({
				id: "theme." + m.id,
				title: () => t(m.labelKey),
				icon: m.iconClass,
				section: t("cmd.section.themes"),
				keywords: m.keywords,
				run: () => ThemeController.instance.setTheme(m.id),
			})),
			// --- UI Mode ---
			{
				id: "ui.modern",
				title: () => t("theme.uiModern"),
				icon: "grid_view",
				section: t("cmd.section.themes"),
				run: () => ThemeController.instance.setUiMode("modern"),
			},
			{
				id: "ui.classic",
				title: () => t("theme.uiClassic"),
				icon: "view_list",
				section: t("cmd.section.themes"),
				run: () => ThemeController.instance.setUiMode("classic"),
			},

			// --- Language ---
			{
				id: "lang.en",
				title: () => "English",
				icon: "translate",
				section: t("cmd.section.themes"),
				run: () => setLocale("en"),
			},
			{
				id: "lang.de",
				title: () => "Deutsch",
				icon: "translate",
				section: t("cmd.section.themes"),
				run: () => setLocale("de"),
			},
		])
	}

	public addComponent(circuitComponent: CircuitComponent) {
		this.circuitComponents.push(circuitComponent)
		this.refreshStatusBar()
	}

	/**
	 * Removes an instance from {@link instances} and also removes its snapping points.
	 */
	public removeComponent(circuitComponent: CircuitComponent) {
		const idx = this.circuitComponents.indexOf(circuitComponent)
		if (idx > -1) {
			this.circuitComponents.splice(idx, 1)
			circuitComponent.remove()
		}
		this.refreshStatusBar()
	}
}

// ---- Top-bar picker helpers (module-local) ---------------------------------
//
// The label-key and icon-class lookups previously lived as standalone Records
// here; they are now sourced from {@link THEME_META} in `themeController.ts` so
// adding a theme is a single-file edit. These thin wrappers exist only to keep
// the call-sites readable.

function themeLabel(id: ThemeId): string {
	return t(getThemeMeta(id).labelKey)
}

function themeIconFor(id: ThemeId): string {
	return getThemeMeta(id).iconClass
}

function langLabel(loc: string): string {
	return loc === "de" ? "Deutsch" : "English"
}

/**
 * Render a small floating menu near (x, y); auto-closes on outside click. Items can
 * be normal entries (with click handler), checkmark-rows, or section headers (no
 * onClick). A `null` entry renders as a divider.
 */
type MenuItem =
	| { kind: "header"; label: string }
	| { kind: "divider" }
	| { kind: "item"; label: string; iconHtml?: string; current: boolean; onClick: () => void }

function spawnFloatingMenu(x: number, y: number, items: MenuItem[]): HTMLElement {
	const menu = document.createElement("ul")
	menu.className = "dropdown-menu show"
	menu.style.position = "fixed"
	menu.style.left = `${x}px`
	menu.style.top = `${y}px`
	menu.style.zIndex = "10000"
	menu.style.minWidth = "230px"
	menu.style.maxHeight = "calc(100vh - 80px)"
	menu.style.overflowY = "auto"

	const closeMenu = () => {
		menu.remove()
		document.removeEventListener("mousedown", outside, true)
	}
	const outside = (ev: MouseEvent) => {
		if (!menu.contains(ev.target as Node)) closeMenu()
	}

	for (const it of items) {
		if (it.kind === "header") {
			const li = document.createElement("li")
			li.className = "dropdown-header"
			li.textContent = it.label
			li.style.fontSize = "10px"
			li.style.textTransform = "uppercase"
			li.style.letterSpacing = "0.08em"
			li.style.color = "var(--c-fg-subtle)"
			li.style.fontWeight = "600"
			li.style.paddingTop = "8px"
			menu.appendChild(li)
			continue
		}
		if (it.kind === "divider") {
			const li = document.createElement("li")
			const hr = document.createElement("hr")
			hr.className = "dropdown-divider"
			li.appendChild(hr)
			menu.appendChild(li)
			continue
		}
		const li = document.createElement("li")
		const a = document.createElement("a")
		a.className = "dropdown-item d-flex align-items-center gap-2"
		a.style.cursor = "pointer"
		if (it.current) a.style.background = "var(--c-accent-subtle)"

		const check = document.createElement("span")
		check.textContent = it.current ? "✓" : ""
		check.style.width = "14px"
		check.style.color = "var(--c-accent)"
		check.style.fontWeight = "600"
		a.appendChild(check)

		if (it.iconHtml) {
			const icon = document.createElement("span")
			icon.innerHTML = it.iconHtml
			icon.style.width = "20px"
			icon.style.display = "inline-flex"
			icon.style.alignItems = "center"
			icon.style.color = "var(--c-fg-muted)"
			a.appendChild(icon)
		}

		const label = document.createElement("span")
		label.textContent = it.label
		a.appendChild(label)

		a.addEventListener("mousedown", (ev) => {
			ev.preventDefault()
			it.onClick()
			closeMenu()
		})
		li.appendChild(a)
		menu.appendChild(li)
	}

	document.body.appendChild(menu)
	// Clamp to viewport.
	const rect = menu.getBoundingClientRect()
	if (rect.right > window.innerWidth - 8) {
		menu.style.left = `${window.innerWidth - rect.width - 8}px`
	}
	if (rect.bottom > window.innerHeight - 8) {
		menu.style.top = `${window.innerHeight - rect.height - 8}px`
	}
	setTimeout(() => document.addEventListener("mousedown", outside, true), 0)
	return menu
}

function openThemeMenu(x: number, y: number, refresh: () => void) {
	const tc = ThemeController.instance
	const items: MenuItem[] = []
	const groupLabelKey: Record<string, string> = {
		Modern: "theme.group.modern",
		Coloured: "theme.group.coloured",
		Classic: "theme.group.classic",
	}

	for (let i = 0; i < THEME_GROUPS.length; i++) {
		const g = THEME_GROUPS[i]
		if (i > 0) items.push({ kind: "divider" })
		items.push({ kind: "header", label: t(groupLabelKey[g.label] ?? g.label) })
		for (const themeId of g.themes) {
			items.push({
				kind: "item",
				label: themeLabel(themeId),
				iconHtml: `<span class="material-symbols-outlined" style="font-size:18px;">${themeIconFor(themeId)}</span>`,
				current: tc.theme === themeId,
				onClick: () => {
					tc.setTheme(themeId)
					refresh()
				},
			})
		}
	}

	// UI mode toggle at the bottom.
	items.push({ kind: "divider" })
	items.push({ kind: "header", label: t("theme.group.uiMode") })
	items.push({
		kind: "item",
		label: t("theme.uiModern"),
		current: tc.uiMode === "modern",
		onClick: () => {
			tc.setUiMode("modern")
			refresh()
		},
	})
	items.push({
		kind: "item",
		label: t("theme.uiClassic"),
		current: tc.uiMode === "classic",
		onClick: () => {
			tc.setUiMode("classic")
			refresh()
		},
	})

	spawnFloatingMenu(x, y, items)
}

function openLangMenu(x: number, y: number, refresh: () => void) {
	const cur = getLocale()
	spawnFloatingMenu(x, y, [
		{
			kind: "item",
			label: "English",
			current: cur === "en",
			onClick: () => {
				setLocale("en")
				refresh()
			},
		},
		{
			kind: "item",
			label: "Deutsch",
			current: cur === "de",
			onClick: () => {
				setLocale("de")
				refresh()
			},
		},
	])
}
