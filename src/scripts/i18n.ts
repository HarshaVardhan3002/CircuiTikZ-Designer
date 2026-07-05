/**
 * Tiny i18n module. Strings are keyed by domain.subdomain and looked up at runtime.
 *
 * The German translations use the standard technical vocabulary from the German
 * electronics / EE community - `Bauteil` for component (not the Anglicism "Komponente"),
 * `Schaltplan` for circuit diagram, `Widerstand` / `Kondensator` / `Spule` for the
 * passive trio, etc. They are deliberately formal-but-direct, matching how a German
 * EE textbook or Würth datasheet would phrase things, rather than literal translations.
 *
 * To add a third language, copy the EN dictionary, translate values in place, and
 * register under a new `Locale` key. Missing keys silently fall back to English.
 */

export type Locale = "en" | "de"

interface Dict {
	[key: string]: string
}

const en: Dict = {
	// --- Top bar ---
	"app.name": "CircuiTikZ Designer",
	"app.version": "Version",
	"top.help": "Help",
	"top.load": "Load",
	"top.save": "Save",
	"top.import": "Import CircuiTikZ",
	"top.exportTikz": "Export CircuiTikZ code",
	"top.exportSvg": "Export as image",
	"top.theme": "Theme",
	"top.language": "Language",
	"top.menu": "Menu",
	"top.search": "Search",

	// --- Themes ---
	"theme.modernLight": "Modern Light",
	"theme.modernDark": "Modern Charcoal",
	"theme.amoled": "AMOLED Black",
	"theme.peach": "Peach",
	"theme.sky": "Sky",
	"theme.forest": "Forest",
	"theme.nord": "Nord",
	"theme.bauhaus": "Bauhaus",
	"theme.classicLight": "Classic Light",
	"theme.classicDark": "Classic Dark",
	"theme.uiModern": "Modern UI",
	"theme.uiClassic": "Classic UI",
	"theme.group.modern": "Modern",
	"theme.group.coloured": "Coloured",
	"theme.group.classic": "Classic",
	"theme.group.uiMode": "UI mode",

	// --- Tools (toolbar) ---
	"tool.add": "Add component",
	"tool.pan": "Pan / Select",
	"tool.draw": "Draw wire",
	"tool.erase": "Erase",
	"tool.detectImage.tooltip": "Detect circuit from image (AI Beta)",
	"tool.detectImage.aria": "Detect circuit from image (AI Beta)",
	"tool.undo": "Undo",
	"tool.redo": "Redo",

	// --- Status bar ---
	"status.tool": "Tool",
	"status.cursor": "Cursor",
	"status.zoom": "Zoom",
	"status.components": "Components",

	// --- Properties pane ---
	"props.title": "Properties",
	"props.selection": "Selection",
	"props.generalSettings": "General settings",
	"props.designName": "Design Name",
	"props.resetView": "Reset view",
	"props.fitView": "Fit view",
	"props.enableGrid": "Enable grid",
	"props.gridCellSize": "Grid cell size",
	"props.gridSubdivisions": "Grid subdivisions",
	"props.currentGridSpacing": "Current grid spacing",
	"props.envPresets": "Environment Variable Presets",
	"props.envChange": "Change environment variables",

	// --- Symbol drawer / categories ---
	"symbols.title": "Symbols",
	"symbols.search": "Search components…",
	"symbols.recent": "Recently used",
	"symbols.basic": "Basic",
	"symbols.line": "Straight line",
	"symbols.arrow": "Straight arrow",
	"symbols.arrowBent": "Bent arrow",
	"symbols.polygon": "Polygon",
	"symbols.spline": "Cubic spline",
	"symbols.rectangle": "Rectangle",
	"symbols.ellipse": "Ellipse",
	"symbols.text": "Text",
	// Preset curve shapes (spline drawer)
	"symbols.preset.arc": "Arc",
	"symbols.preset.scurve": "S-curve",
	"symbols.preset.wave": "Wave",
	"symbols.preset.hop": "Wire hop",
	"symbols.preset.corner": "Rounded corner",
	"symbols.preset.loop": "Loop",
	"symbols.preset.double": "Double hop",

	// --- Empty-canvas hint ---
	"hint.intro": "Press {q} to open the symbol drawer, or {w} to draw a wire.",
	"hint.paste": "Paste CircuiTikZ code with {paste}.",
	"hint.search": "Try {cmdK} for the command palette.",

	// --- Command palette ---
	"cmd.placeholder": "Search tools, components, actions…",
	"cmd.empty": "No matches.",
	"cmd.section.tools": "Tools",
	"cmd.section.components": "Components",
	"cmd.section.actions": "File & Actions",
	"cmd.section.themes": "Themes",
	"cmd.toClose": "to close",
	"cmd.toRun": "to run",
	"cmd.navigate": "to navigate",

	// --- Spline continuity ---
	"spline.continuity.header": "Anchor continuity",
	"spline.continuity.corner": "Corner",
	"spline.continuity.g1": "G¹ smooth",
	"spline.continuity.c1": "C¹ mirror",
	"spline.context.insertBefore": "Insert anchor before",
	"spline.context.insertAfter": "Insert anchor after",
	"spline.context.delete": "Delete anchor",

	// --- Toasts ---
	"toast.copied": "Copied to clipboard",
	"toast.saved": "Saved",

	// --- Common ---
	"common.close": "Close",
	"common.cancel": "Cancel",
	"common.done": "Done",
	"common.apply": "Apply",
	"common.save": "Save",
	"common.delete": "Delete",
	"common.ok": "OK",

	// --- Top bar (extra tooltips and labels) ---
	"top.load.tip": "Load a circuit (part) from a JSON file (Ctrl/⌘ + O)",
	"top.save.tip": "Save the circuit in a JSON file (Ctrl/⌘ + S)",
	"top.import.tip": "Paste CircuiTikZ code to recreate a diagram (Ctrl/⌘ + Shift + O)",
	"top.exportTikz.tip": "Export the circuit as CircuiTikZ code (Ctrl/⌘ + E)",
	"top.exportSvg.tip": "Export the circuit as SVG code (Ctrl/⌘ + Shift + E)",
	"top.tabs": "Tab management",
	"top.settings": "Settings",
	"top.about": "About",

	// --- Symbols drawer ---
	"symbols.regex": "Use regular expression",
	"symbols.invalidRegex": "Please enter a valid (regex) search string!",

	// --- Modals: Import ---
	"modal.import.title": "Import",
	"modal.import.upload": "Upload file",
	"modal.import.paste": "Paste code",
	"modal.import.helpTip": "What can I import?",
	"modal.import.dragDrop": "Drag & Drop here",
	"modal.import.fileTypes": "JSON or CircuiTikZ code",
	"modal.import.browseFile": "Browse file",
	"modal.import.noFile": "No file selected",
	"modal.import.format": "Format:",
	"modal.import.formatAria": "Paste format",
	"modal.import.autoDetect": "Auto-detect",
	"modal.import.removeExisting": "Remove existing components",
	"modal.import.removeExistingTip":
		"If all existing components should be removed before the new components are loaded in or not",

	// --- Modals: Import Report ---
	"modal.report.title": "Import report",
	"modal.report.issues": "Issues",
	"modal.report.source": "Source",
	"modal.report.clickHint": "Click any issue to jump to its line",
	"modal.report.copyLog": "Copy log",
	"modal.report.downloadLog": "Download log",
	"modal.report.retry": "Fix and retry",
	"modal.report.aiRepair": "Repair with AI",
	"modal.report.aiRepairTip": "Send the code and the errors to your configured AI to fix, then re-import",
	"modal.report.aiRepairBusy": "Repairing…",
	"modal.report.aiRepairFailed": "AI repair failed:",

	// --- Modals: Export ---
	"modal.export.title": "Export",
	"modal.export.filename": "Filename",
	"modal.export.fileExt": "Filename extension",
	"modal.export.selectExt": "Select filename extension",
	"modal.export.saveJson": "Save JSON",

	// --- Modals: About ---
	"modal.about.title": "About CircuiTikZ-Designer",

	// --- Modals: Settings (catch-all settings dialog) ---
	"modal.settings.title": "Settings",

	// --- Settings: UI Mode picker ---
	"settings.uiMode.title": "UI mode",
	"settings.uiMode.help":
		"Choose how the interface looks. Modern is the polished default; Classic is the original Bootstrap look kept for parity.",
	"settings.uiMode.label": "Layout",
	"settings.uiMode.modern": "Modern (recommended)",
	"settings.uiMode.classic": "Classic (legacy)",

	// --- Modals: Tab management ---
	"modal.tabs.title": "Tab management",
	"modal.tabs.intro":
		"CircuiTikZ Designer can manage a different canvas for each tab to allow multiple drawings at the same time.",
	"modal.tabs.storage": "Total storage used by CircuiTikZ Designer:",
	"modal.tabs.tab": "Tab",
	"modal.tabs.numComponents": "# components",
	"modal.tabs.storageSize": "Storage size",
	"modal.tabs.refresh": "Refresh",

	// --- Modals: Help ---
	"modal.help.title": "Help",
	"modal.help.general": "General",

	// --- v1.1 UX additions ---
	// Top bar: new dropdown labels.
	"top.importMenu": "Import",
	"top.importMenu.tip": "Import - open a file, paste TikZ, or detect from an image",
	"top.importMenu.file": "From file",
	"top.importMenu.paste": "Paste TikZ",
	"top.importMenu.image": "Detect from image (AI Beta)",
	"top.importMenu.imageHint": "Beta: review model output before accepting.",
	"top.exportMenu": "Export",
	"top.exportMenu.tip": "Export - generate TikZ code or an SVG image",
	"top.exportMenu.tikz": "CircuiTikZ code",
	"top.exportMenu.svg": "SVG image",
	"top.undo.tip": "Undo (Ctrl/⌘ + Z)",
	"top.redo.tip": "Redo (Ctrl/⌘ + Y)",
	// Empty-canvas hint: three "ways to start" rows.
	"hint.way.symbols": "Drag a component from the symbols panel on the left.",
	"hint.way.import": "Open Import - choose a file, paste TikZ, or detect from image.",
	"hint.way.help": "Press {qmark} for the full keyboard shortcut list.",
	// Status bar: AI provider chip.
	"status.ai": "AI Beta",
	// First-visit welcome toast.
	"welcome.title": "Welcome to CircuiTikZ Designer v1.1",
	"welcome.body":
		"Drag a component from the left, or use the Beta image detector for a hand-drawn circuit. Press <kbd>?</kbd> any time for shortcuts.",
	"welcome.action.detect": "Try Beta image detection",
	"welcome.action.shortcuts": "See shortcuts",

	// --- Tooltips / aria-labels wired in the i18n coverage pass ---
	"top.help.tip": "Help menu (?)",
	"top.version.tip": "App version",
	"nav.aiChip.tip": "AI Beta provider configured for Detect from image",
	"tool.drawer.tip": "Open component drawer (Q)",
	"tool.pan.tip": "Pan or zoom the canvas (Esc)",
	"tool.draw.tip": "Draw wires (W)",
	"tool.erase.tip": "Erase components and wires (Del, Backspace)",
	"common.dismiss": "Dismiss",
	"common.toggleNav": "Toggle navigation",
	"common.copyClipboard": "Copy to clipboard",
	"hint.howToStart": "How to start",

	// --- Chat panel (Beta AI assistant) ---
	"chat.greeting":
		"Hi! I am the Beta AI assistant. I can inspect and edit your circuit. Try: “draw an RC low-pass filter”. (Set your AI Beta provider in Settings first.)",
	"chat.toggle": "AI assistant (Beta)",
	"chat.title": "AI Assistant (Beta)",
	"chat.new": "New chat (saves the current one to history)",
	"chat.visualCheck": "Visual check (Beta): screenshot the canvas and have a vision-capable model review what was built",
	"chat.expand": "Expand / collapse the chat window",
	"chat.history": "Chat history",
	"chat.download": "Download this chat",
	"chat.clear": "Clear chat (no save)",
	"chat.placeholder": "Ask the AI Beta assistant to build or edit your circuit…",
	"chat.send": "Send",
	"chat.ctx.empty": "context: empty",
	"chat.ctx.info": "context ~{k}k tok · {n} msgs",
	"chat.ctx.compressing": " · compressing",
	"chat.history.empty": "No saved chats yet. “New chat” saves the current conversation here.",
	"chat.untitled": "(untitled)",
	"chat.history.open": "- click to open",
	"chat.history.download": "Download transcript",
	"chat.apply": "Apply to canvas",
	"chat.applied": "Applied ✓",
	"chat.failed": "Failed",
	"chat.activity.thinking": "thinking…",
	"chat.activity.thinkingStep": "thinking… (step {n})",
	"chat.activity.running": "running {tool}…",

	// --- Log panel ---
	"log.title": "Logs",
	"log.minLevel": "Minimum level",
	"log.record": "Record",
	"log.record.tip": "Download the full log buffer to a file",
	"log.clear": "Clear",
	"log.count": "{n} entries in buffer",

	// --- Keyboard shortcut cheat-sheet (Help modal) ---
	"shortcuts.title": "Keyboard shortcuts",
	"shortcuts.platformNote": "showing {platform} keys",
	"shortcuts.group.file": "File",
	"shortcuts.group.edit": "Edit & selection",
	"shortcuts.group.tools": "Tools & view",
	"shortcuts.group.components": "Place components",
	"shortcuts.load": "Open / load",
	"shortcuts.save": "Save",
	"shortcuts.import": "Import CircuiTikZ",
	"shortcuts.exportTikz": "Export CircuiTikZ",
	"shortcuts.exportSvg": "Export SVG",
	"shortcuts.undo": "Undo",
	"shortcuts.redo": "Redo",
	"shortcuts.copy": "Copy",
	"shortcuts.cut": "Cut",
	"shortcuts.paste": "Paste",
	"shortcuts.selectAll": "Select all",
	"shortcuts.delete": "Delete selection",
	"shortcuts.rotateCcw": "Rotate 90° CCW",
	"shortcuts.rotateCw": "Rotate 90° CW",
	"shortcuts.flipH": "Flip horizontal",
	"shortcuts.flipV": "Flip vertical",
	"shortcuts.nudge": "Nudge selection",
	"shortcuts.nudgeBig": "Nudge by one cell",
	"shortcuts.drawer": "Open component drawer",
	"shortcuts.wire": "Draw wire",
	"shortcuts.text": "Text",
	"shortcuts.select": "Pan / select",
	"shortcuts.finish": "Finish placement",
	"shortcuts.palette": "Command palette",
	"shortcuts.help": "This cheat-sheet",
	"shortcuts.ground": "Ground",
	"shortcuts.resistor": "Resistor",
	"shortcuts.capacitor": "Capacitor",
	"shortcuts.inductor": "Inductor",
	"shortcuts.diode": "Diode",
	"shortcuts.npn": "NPN transistor",
	"shortcuts.nmos": "NMOS transistor",
	"shortcuts.crossing": "Crossing node",
	"shortcuts.terminal": "Terminal",
	"shortcuts.altNote": "Hold Alt (⌥) for the variant — European resistor, PNP, PMOS, etc.",
}

const de: Dict = {
	// --- Top bar ---
	"app.name": "CircuiTikZ Designer",
	"app.version": "Version",
	"top.help": "Hilfe",
	"top.load": "Öffnen",
	"top.save": "Speichern",
	"top.import": "CircuiTikZ importieren",
	"top.exportTikz": "Als CircuiTikZ-Code exportieren",
	"top.exportSvg": "Als Bild exportieren",
	"top.theme": "Erscheinungsbild",
	"top.language": "Sprache",
	"top.menu": "Menü",
	"top.search": "Suche",

	// --- Themes ---
	"theme.modernLight": "Modern Hell",
	"theme.modernDark": "Modern Anthrazit",
	"theme.amoled": "AMOLED Schwarz",
	"theme.peach": "Pfirsich",
	"theme.sky": "Himmelblau",
	"theme.forest": "Wald",
	"theme.nord": "Nord",
	"theme.bauhaus": "Bauhaus",
	"theme.classicLight": "Klassisch Hell",
	"theme.classicDark": "Klassisch Dunkel",
	"theme.uiModern": "Modernes UI",
	"theme.uiClassic": "Klassisches UI",
	"theme.group.modern": "Modern",
	"theme.group.coloured": "Farbig",
	"theme.group.classic": "Klassisch",
	"theme.group.uiMode": "UI-Modus",

	// --- Tools (toolbar) ---
	// Bauteil = component (the standard EE term; "Komponente" is software-flavoured).
	// Verschieben = pan, Auswählen = select, Zeichnen = draw, Radieren = erase (the
	// canonical translation of an eraser tool - distinct from "Löschen" which is delete).
	"tool.add": "Bauteil hinzufügen",
	"tool.pan": "Verschieben / Auswählen",
	"tool.draw": "Draht zeichnen",
	"tool.erase": "Radieren",
	"tool.detectImage.tooltip": "Schaltung aus Bild erkennen (KI Beta)",
	"tool.detectImage.aria": "Schaltung aus Bild erkennen (KI Beta)",
	"tool.undo": "Rückgängig",
	"tool.redo": "Wiederherstellen",

	// --- Status bar ---
	"status.tool": "Werkzeug",
	"status.cursor": "Position",
	"status.zoom": "Zoom",
	"status.components": "Bauteile",

	// --- Properties pane ---
	// Schaltplan = circuit diagram. Raster = grid (the standard CAD term - DIN 6789, etc.).
	"props.title": "Eigenschaften",
	"props.selection": "Auswahl",
	"props.generalSettings": "Allgemeine Einstellungen",
	"props.designName": "Schaltplan­name",
	"props.resetView": "Ansicht zurücksetzen",
	"props.fitView": "An Inhalt anpassen",
	"props.enableGrid": "Raster anzeigen",
	"props.gridCellSize": "Rasterweite",
	"props.gridSubdivisions": "Raster­unterteilungen",
	"props.currentGridSpacing": "Aktueller Rasterabstand",
	"props.envPresets": "Umgebungsvariablen-Vorlagen",
	"props.envChange": "Umgebungsvariablen ändern",

	// --- Symbol drawer / categories ---
	"symbols.title": "Bauteile",
	"symbols.search": "Bauteile suchen…",
	"symbols.recent": "Zuletzt verwendet",
	"symbols.basic": "Grundformen",
	"symbols.line": "Gerade Linie",
	"symbols.arrow": "Gerader Pfeil",
	"symbols.arrowBent": "Abgewinkelter Pfeil",
	"symbols.polygon": "Polygon",
	"symbols.spline": "Bézier-Kurve",
	"symbols.rectangle": "Rechteck",
	"symbols.ellipse": "Ellipse",
	"symbols.text": "Text",
	// Vorgefertigte Kurvenformen (Spline-Schublade)
	"symbols.preset.arc": "Bogen",
	"symbols.preset.scurve": "S-Kurve",
	"symbols.preset.wave": "Welle",
	"symbols.preset.hop": "Drahtbrücke",
	"symbols.preset.corner": "Abgerundete Ecke",
	"symbols.preset.loop": "Schleife",
	"symbols.preset.double": "Doppelbrücke",

	// --- Empty-canvas hint ---
	"hint.intro": "{q} öffnet die Bauteilbibliothek, {w} startet das Drahtwerkzeug.",
	"hint.paste": "Mit {paste} CircuiTikZ-Code einfügen.",
	"hint.search": "Mit {cmdK} die Befehlspalette öffnen.",

	// --- Command palette ---
	"cmd.placeholder": "Werkzeuge, Bauteile, Aktionen suchen…",
	"cmd.empty": "Keine Treffer.",
	"cmd.section.tools": "Werkzeuge",
	"cmd.section.components": "Bauteile",
	"cmd.section.actions": "Datei & Aktionen",
	"cmd.section.themes": "Erscheinungsbild",
	"cmd.toClose": "Schließen",
	"cmd.toRun": "Ausführen",
	"cmd.navigate": "Navigieren",

	// --- Spline continuity ---
	// Stetigkeit is the standard German math/EE term for continuity. Eckpunkt is a
	// corner-vertex. Glatt = smooth (geometrically). Spiegelung = mirror (in the
	// "point-mirror" sense used in geometry, exactly the C¹ semantic).
	"spline.continuity.header": "Stetigkeit am Stützpunkt",
	"spline.continuity.corner": "Eckpunkt",
	"spline.continuity.g1": "G¹ glatt",
	"spline.continuity.c1": "C¹ Spiegelung",
	"spline.context.insertBefore": "Stützpunkt davor einfügen",
	"spline.context.insertAfter": "Stützpunkt danach einfügen",
	"spline.context.delete": "Stützpunkt löschen",

	// --- Toasts ---
	"toast.copied": "In die Zwischenablage kopiert",
	"toast.saved": "Gespeichert",

	// --- Common ---
	"common.close": "Schließen",
	"common.cancel": "Abbrechen",
	"common.done": "Fertig",
	"common.apply": "Anwenden",
	"common.save": "Speichern",
	"common.delete": "Löschen",
	"common.ok": "OK",

	// --- Top bar (extra tooltips and labels) ---
	"top.load.tip": "Schaltplan (oder Teil davon) aus JSON-Datei öffnen (Strg/⌘ + O)",
	"top.save.tip": "Schaltplan als JSON-Datei speichern (Strg/⌘ + S)",
	"top.import.tip": "CircuiTikZ-Code einfügen, um ein Diagramm wiederherzustellen (Strg/⌘ + Umschalt + O)",
	"top.exportTikz.tip": "Schaltplan als CircuiTikZ-Code exportieren (Strg/⌘ + E)",
	"top.exportSvg.tip": "Schaltplan als SVG-Code exportieren (Strg/⌘ + Umschalt + E)",
	"top.tabs": "Tab-Verwaltung",
	"top.settings": "Einstellungen",
	"top.about": "Über",

	// --- Symbols drawer ---
	"symbols.regex": "Regulären Ausdruck verwenden",
	"symbols.invalidRegex": "Bitte einen gültigen (Regex-)Suchausdruck eingeben!",

	// --- Modals: Import ---
	"modal.import.title": "Importieren",
	"modal.import.upload": "Datei hochladen",
	"modal.import.paste": "Code einfügen",
	"modal.import.helpTip": "Was kann ich importieren?",
	"modal.import.dragDrop": "Hier ablegen",
	"modal.import.fileTypes": "JSON- oder CircuiTikZ-Code",
	"modal.import.browseFile": "Datei auswählen",
	"modal.import.noFile": "Keine Datei ausgewählt",
	"modal.import.format": "Format:",
	"modal.import.formatAria": "Einfügeformat",
	"modal.import.autoDetect": "Automatisch erkennen",
	"modal.import.removeExisting": "Vorhandene Bauteile entfernen",
	"modal.import.removeExistingTip":
		"Legt fest, ob alle vorhandenen Bauteile vor dem Laden der neuen Bauteile entfernt werden sollen",

	// --- Modals: Import Report ---
	"modal.report.title": "Importbericht",
	"modal.report.issues": "Hinweise",
	"modal.report.source": "Quelltext",
	"modal.report.clickHint": "Hinweis anklicken, um zur Zeile zu springen",
	"modal.report.copyLog": "Protokoll kopieren",
	"modal.report.downloadLog": "Protokoll herunterladen",
	"modal.report.retry": "Korrigieren und erneut versuchen",
	"modal.report.aiRepair": "Mit KI reparieren",
	"modal.report.aiRepairTip": "Code und Fehler an die konfigurierte KI senden, reparieren und neu importieren",
	"modal.report.aiRepairBusy": "Repariere…",
	"modal.report.aiRepairFailed": "KI-Reparatur fehlgeschlagen:",

	// --- Modals: Export ---
	"modal.export.title": "Exportieren",
	"modal.export.filename": "Dateiname",
	"modal.export.fileExt": "Dateiendung",
	"modal.export.selectExt": "Dateiendung auswählen",
	"modal.export.saveJson": "JSON speichern",

	// --- Modals: About ---
	"modal.about.title": "Über CircuiTikZ-Designer",

	// --- Modals: Settings (catch-all settings dialog) ---
	"modal.settings.title": "Einstellungen",

	// --- Settings: UI Mode picker ---
	"settings.uiMode.title": "UI-Modus",
	"settings.uiMode.help":
		"Wie soll die Oberfläche aussehen? „Modern“ ist der polierte Standard; „Klassisch“ behält den ursprünglichen Bootstrap-Look bei.",
	"settings.uiMode.label": "Layout",
	"settings.uiMode.modern": "Modern (empfohlen)",
	"settings.uiMode.classic": "Klassisch (Legacy)",

	// --- Modals: Tab management ---
	"modal.tabs.title": "Tab-Verwaltung",
	"modal.tabs.intro":
		"Der CircuiTikZ Designer kann pro Browser-Tab eine eigene Zeichenfläche verwalten, sodass mehrere Schaltpläne gleichzeitig bearbeitet werden können.",
	"modal.tabs.storage": "Insgesamt vom CircuiTikZ Designer belegter Speicher:",
	"modal.tabs.tab": "Tab",
	"modal.tabs.numComponents": "Bauteile",
	"modal.tabs.storageSize": "Speichergröße",
	"modal.tabs.refresh": "Aktualisieren",

	// --- Modals: Help ---
	"modal.help.title": "Hilfe",
	"modal.help.general": "Allgemein",

	// --- v1.1 UX additions ---
	// Top bar: neue Dropdown-Beschriftungen.
	"top.importMenu": "Importieren",
	"top.importMenu.tip": "Importieren - Datei öffnen, TikZ einfügen oder aus Bild erkennen",
	"top.importMenu.file": "Aus Datei",
	"top.importMenu.paste": "TikZ einfügen",
	"top.importMenu.image": "Aus Bild erkennen (KI Beta)",
	"top.importMenu.imageHint": "Beta: Modellergebnis vor dem Übernehmen prüfen.",
	"top.exportMenu": "Exportieren",
	"top.exportMenu.tip": "Exportieren - TikZ-Code oder SVG-Bild erzeugen",
	"top.exportMenu.tikz": "CircuiTikZ-Code",
	"top.exportMenu.svg": "SVG-Bild",
	"top.undo.tip": "Rückgängig (Strg/⌘ + Z)",
	"top.redo.tip": "Wiederherstellen (Strg/⌘ + Y)",
	// Empty-canvas hint: drei „Erste Schritte“-Hinweise.
	"hint.way.symbols": "Ein Bauteil aus der Bauteilbibliothek links auf die Zeichenfläche ziehen.",
	"hint.way.import": "„Importieren“ öffnen - Datei laden, TikZ einfügen oder Beta-Bilderkennung nutzen.",
	"hint.way.help": "{qmark} drücken für die vollständige Tastenkürzel-Übersicht.",
	// Status bar: KI-Anbieter-Chip.
	"status.ai": "KI Beta",
	// Begrüßungs-Toast beim ersten Besuch.
	"welcome.title": "Willkommen beim CircuiTikZ Designer v1.1",
	"welcome.body":
		"Ein Bauteil aus der linken Leiste ziehen - oder die Beta-Bilderkennung für ein Foto einer handgezeichneten Schaltung nutzen. Mit <kbd>?</kbd> jederzeit die Tastenkürzel anzeigen.",
	"welcome.action.detect": "Beta-Bilderkennung ausprobieren",
	"welcome.action.shortcuts": "Tastenkürzel anzeigen",

	// --- In der i18n-Abdeckung ergänzte Tooltips / Aria-Labels ---
	"top.help.tip": "Hilfe-Menü (?)",
	"top.version.tip": "App-Version",
	"nav.aiChip.tip": "KI-Beta-Anbieter für die Bilderkennung konfiguriert",
	"tool.drawer.tip": "Bauteilbibliothek öffnen (Q)",
	"tool.pan.tip": "Zeichenfläche verschieben oder zoomen (Esc)",
	"tool.draw.tip": "Drähte zeichnen (W)",
	"tool.erase.tip": "Bauteile und Drähte radieren (Entf, Rücktaste)",
	"common.dismiss": "Ausblenden",
	"common.toggleNav": "Navigation umschalten",
	"common.copyClipboard": "In die Zwischenablage kopieren",
	"hint.howToStart": "Erste Schritte",

	// --- Chat-Panel (Beta-KI-Assistent) ---
	"chat.greeting":
		"Hallo! Ich bin der Beta-KI-Assistent. Ich kann deine Schaltung inspizieren und bearbeiten. Versuch: „einen RC-Tiefpass zeichnen“. (Zuerst den KI-Beta-Anbieter in den Einstellungen festlegen.)",
	"chat.toggle": "KI-Assistent (Beta)",
	"chat.title": "KI-Assistent (Beta)",
	"chat.new": "Neuer Chat (speichert den aktuellen im Verlauf)",
	"chat.visualCheck": "Sichtprüfung (Beta): Screenshot der Zeichenfläche von einem bildfähigen Modell prüfen lassen",
	"chat.expand": "Chat-Fenster vergrößern / verkleinern",
	"chat.history": "Chat-Verlauf",
	"chat.download": "Diesen Chat herunterladen",
	"chat.clear": "Chat leeren (ohne Speichern)",
	"chat.placeholder": "Den KI-Beta-Assistenten bitten, deine Schaltung zu erstellen oder zu bearbeiten…",
	"chat.send": "Senden",
	"chat.ctx.empty": "Kontext: leer",
	"chat.ctx.info": "Kontext ~{k}k Tok · {n} Nachr.",
	"chat.ctx.compressing": " · wird komprimiert",
	"chat.history.empty": "Noch keine gespeicherten Chats. „Neuer Chat“ sichert das aktuelle Gespräch hier.",
	"chat.untitled": "(ohne Titel)",
	"chat.history.open": "- zum Öffnen klicken",
	"chat.history.download": "Transkript herunterladen",
	"chat.apply": "Auf Zeichenfläche anwenden",
	"chat.applied": "Angewendet ✓",
	"chat.failed": "Fehlgeschlagen",
	"chat.activity.thinking": "denkt nach…",
	"chat.activity.thinkingStep": "denkt nach… (Schritt {n})",
	"chat.activity.running": "führt {tool} aus…",

	// --- Log-Panel ---
	"log.title": "Protokoll",
	"log.minLevel": "Mindeststufe",
	"log.record": "Aufzeichnen",
	"log.record.tip": "Den vollständigen Log-Puffer in eine Datei herunterladen",
	"log.clear": "Leeren",
	"log.count": "{n} Einträge im Puffer",

	// --- Tastenkürzel-Übersicht (Hilfe-Dialog) ---
	"shortcuts.title": "Tastenkürzel",
	"shortcuts.platformNote": "zeige {platform}-Tasten",
	"shortcuts.group.file": "Datei",
	"shortcuts.group.edit": "Bearbeiten & Auswahl",
	"shortcuts.group.tools": "Werkzeuge & Ansicht",
	"shortcuts.group.components": "Bauteile platzieren",
	"shortcuts.load": "Öffnen / laden",
	"shortcuts.save": "Speichern",
	"shortcuts.import": "CircuiTikZ importieren",
	"shortcuts.exportTikz": "CircuiTikZ exportieren",
	"shortcuts.exportSvg": "SVG exportieren",
	"shortcuts.undo": "Rückgängig",
	"shortcuts.redo": "Wiederherstellen",
	"shortcuts.copy": "Kopieren",
	"shortcuts.cut": "Ausschneiden",
	"shortcuts.paste": "Einfügen",
	"shortcuts.selectAll": "Alles auswählen",
	"shortcuts.delete": "Auswahl löschen",
	"shortcuts.rotateCcw": "90° gegen den Uhrzeigersinn drehen",
	"shortcuts.rotateCw": "90° im Uhrzeigersinn drehen",
	"shortcuts.flipH": "Horizontal spiegeln",
	"shortcuts.flipV": "Vertikal spiegeln",
	"shortcuts.nudge": "Auswahl verschieben",
	"shortcuts.nudgeBig": "Um eine Zelle verschieben",
	"shortcuts.drawer": "Bauteilbibliothek öffnen",
	"shortcuts.wire": "Draht zeichnen",
	"shortcuts.text": "Text",
	"shortcuts.select": "Verschieben / auswählen",
	"shortcuts.finish": "Platzierung abschließen",
	"shortcuts.palette": "Befehlspalette",
	"shortcuts.help": "Diese Kurzübersicht",
	"shortcuts.ground": "Masse",
	"shortcuts.resistor": "Widerstand",
	"shortcuts.capacitor": "Kondensator",
	"shortcuts.inductor": "Spule",
	"shortcuts.diode": "Diode",
	"shortcuts.npn": "NPN-Transistor",
	"shortcuts.nmos": "NMOS-Transistor",
	"shortcuts.crossing": "Kreuzungsknoten",
	"shortcuts.terminal": "Anschluss",
	"shortcuts.altNote": "Alt (⌥) gedrückt halten für die Variante — europäischer Widerstand, PNP, PMOS usw.",
}

const dictionaries: Record<Locale, Dict> = { en, de }

let currentLocale: Locale = readInitialLocale()

function readInitialLocale(): Locale {
	const stored = localStorage.getItem("ctd-locale")
	if (stored === "en" || stored === "de") return stored
	const browser = (navigator.language || "en").toLowerCase()
	if (browser.startsWith("de")) return "de"
	return "en"
}

export function getLocale(): Locale {
	return currentLocale
}

export function setLocale(loc: Locale) {
	currentLocale = loc
	localStorage.setItem("ctd-locale", loc)
	document.documentElement.lang = loc
	applyTranslations()
	window.dispatchEvent(new CustomEvent("locale-changed", { detail: loc }))
}

/**
 * Translate a key. Optional `vars` substitutes `{name}` placeholders.
 * Falls back to the EN dictionary when the active locale is missing the key,
 * and to the raw key when even EN is missing it.
 */
export function t(key: string, vars?: Record<string, string>): string {
	let s = dictionaries[currentLocale]?.[key] ?? dictionaries.en[key] ?? key
	if (vars) {
		for (const k of Object.keys(vars)) {
			s = s.replace(new RegExp(`\\{${k}\\}`, "g"), vars[k])
		}
	}
	return s
}

/**
 * Walk the DOM and replace contents / attrs of any element annotated with
 * `data-i18n`, `data-i18n-title`, `data-i18n-placeholder`, or
 * `data-i18n-aria-label`. Idempotent - safe to call after every locale switch.
 */
export function applyTranslations(root: ParentNode = document) {
	root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
		const key = el.getAttribute("data-i18n")!
		el.textContent = t(key)
	})
	root.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
		const key = el.getAttribute("data-i18n-title")!
		el.setAttribute("data-bs-title", t(key))
		el.setAttribute("title", t(key))
	})
	root.querySelectorAll<HTMLElement>("[data-i18n-placeholder]").forEach((el) => {
		const key = el.getAttribute("data-i18n-placeholder")!
		;(el as HTMLInputElement).placeholder = t(key)
	})
	root.querySelectorAll<HTMLElement>("[data-i18n-aria-label]").forEach((el) => {
		const key = el.getAttribute("data-i18n-aria-label")!
		el.setAttribute("aria-label", t(key))
	})
}
