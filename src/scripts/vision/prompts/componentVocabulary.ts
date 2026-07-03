// src/scripts/vision/prompts/componentVocabulary.ts

export interface VocabularyEntry {
	/** Stable model-facing key, e.g. "resistor". Lower-case kebab. */
	key: string
	/** Human description sent to the model. */
	description: string
	/** Pin names the model may reference, in order. */
	pins: string[]
	/** Internal CircuiTikZ class identifier used by the mapper. */
	internalType: string
}

export interface ComponentVocabulary {
	entries: VocabularyEntry[]
}

export function buildVocabularyFromEntries(entries: VocabularyEntry[]): ComponentVocabulary {
	const seen = new Set<string>()
	for (const e of entries) {
		if (seen.has(e.key)) {
			throw new Error(`duplicate vocabulary key: ${e.key}`)
		}
		seen.add(e.key)
	}
	return { entries: [...entries] }
}

/**
 * Render the vocabulary as a flat block we can paste into the prompt. Keep it
 * compact - the prompt budget for vision LLMs isn't infinite.
 */
export function formatVocabularyForPrompt(v: ComponentVocabulary): string {
	return v.entries
		.map((e) => `- ${e.key}: ${e.description} (pins: ${e.pins.join(", ") || "-"})`)
		.join("\n")
}

/**
 * Browser-only helper. Walks the existing component class registry and produces a vocabulary.
 * Pure-data callers (tests) should use buildVocabularyFromEntries directly.
 *
 * Implementation note: the existing CircuiTikZ-Designer component registry exposes a static
 * map keyed by save-format `id`. Beyond V1's hand-picked subset, this V2 vocabulary covers
 * essentially everything the symbol library already ships (resistors, capacitors, inductors,
 * a full diode family, transistors of every flavour, logic gates, flip-flops, sources,
 * meters, antennas, RF blocks, switches, jumpers, mechanical, tubes, indicators, plus the
 * geometric primitives: wire, cubic spline, rectangle, ellipse, polygon).
 *
 * `internalType` is the lookup key the detection-result mapper hands to the import pipeline.
 * For symbol-backed entries it's the CircuitTikZ tikzName (matches what `toJson()` writes
 * into the `id` field). For geometric primitives it's the corresponding jsonID (`wire`,
 * `cubic-spline`, etc.). The mapper currently writes this verbatim into `type`; later work
 * may translate it into the proper save-object shape, but we keep the strings stable here so
 * that work is purely additive on the import side.
 *
 * Chip-design components are intentionally excluded - that surface is on the strict
 * future-scope list and shouldn't pollute V1 detection vocabulary.
 */
export function buildBrowserVocabulary(): ComponentVocabulary {
	const v: VocabularyEntry[] = [
		// ======================== Original V1 entries ========================
		// Kept verbatim so anything depending on these keys keeps working.
		{ key: "resistor",        description: "Two-terminal resistor",                 pins: ["a", "b"],         internalType: "resistor" },
		{ key: "capacitor",       description: "Two-terminal non-polarised capacitor",  pins: ["a", "b"],         internalType: "capacitor" },
		{ key: "polar-capacitor", description: "Polarised electrolytic capacitor",      pins: ["+", "-"],         internalType: "polar-capacitor" },
		{ key: "inductor",        description: "Two-terminal inductor",                 pins: ["a", "b"],         internalType: "inductor" },
		{ key: "diode",           description: "Standard diode",                        pins: ["A", "K"],         internalType: "diode" },
		{ key: "led",             description: "Light-emitting diode",                  pins: ["A", "K"],         internalType: "led" },
		{ key: "voltage-source",  description: "Independent voltage source",            pins: ["+", "-"],         internalType: "vsource" },
		{ key: "current-source",  description: "Independent current source",            pins: ["+", "-"],         internalType: "isource" },
		{ key: "battery",         description: "Battery / cell",                        pins: ["+", "-"],         internalType: "battery1" },
		{ key: "ground",          description: "Ground / earth reference",              pins: ["p"],              internalType: "ground" },
		{ key: "switch",          description: "Single-pole single-throw switch",       pins: ["a", "b"],         internalType: "switch" },
		{ key: "lamp",            description: "Incandescent lamp / bulb",              pins: ["a", "b"],         internalType: "lamp" },
		{ key: "bjt-npn",         description: "NPN bipolar junction transistor",       pins: ["B", "C", "E"],    internalType: "bjt-npn" },
		{ key: "bjt-pnp",         description: "PNP bipolar junction transistor",       pins: ["B", "C", "E"],    internalType: "bjt-pnp" },
		{ key: "mosfet-n",        description: "N-channel enhancement-mode MOSFET",     pins: ["G", "D", "S"],    internalType: "nmos" },
		{ key: "mosfet-p",        description: "P-channel enhancement-mode MOSFET",     pins: ["G", "D", "S"],    internalType: "pmos" },
		{ key: "op-amp",          description: "Operational amplifier (3-terminal)",    pins: ["+", "-", "out"],  internalType: "op-amp" },
		{ key: "voltmeter",       description: "Voltmeter",                             pins: ["+", "-"],         internalType: "voltmeter" },
		{ key: "ammeter",         description: "Ammeter",                               pins: ["+", "-"],         internalType: "ammeter" },
		{ key: "junction",        description: "Wire junction (visible dot)",           pins: ["p"],              internalType: "junction" },

		// ======================== Resistive bipoles ========================
		{ key: "variable-resistor",  description: "Variable resistor (rheostat)",                pins: ["a", "b"],     internalType: "variable american resistor" },
		{ key: "potentiometer",      description: "Three-terminal potentiometer",                pins: ["a", "b", "w"], internalType: "american potentiometer" },
		{ key: "photoresistor",      description: "Light-dependent resistor (LDR)",              pins: ["a", "b"],     internalType: "photoresistor" },
		{ key: "thermistor",         description: "Generic thermistor",                          pins: ["a", "b"],     internalType: "thermistor" },
		{ key: "thermistor-ptc",     description: "Positive-temperature-coefficient thermistor", pins: ["a", "b"],     internalType: "thermistor ptc" },
		{ key: "thermistor-ntc",     description: "Negative-temperature-coefficient thermistor", pins: ["a", "b"],     internalType: "thermistor ntc" },
		{ key: "varistor",           description: "Voltage-dependent resistor",                  pins: ["a", "b"],     internalType: "varistor" },
		{ key: "mov",                description: "Metal-oxide varistor (surge suppressor)",     pins: ["a", "b"],     internalType: "mov" },
		{ key: "memristor",          description: "Memristor",                                   pins: ["a", "b"],     internalType: "memristor" },
		{ key: "generic-bipole",     description: "Generic symmetric two-terminal element",      pins: ["a", "b"],     internalType: "generic" },

		// ======================== Capacitive / dynamic ========================
		{ key: "curved-capacitor",   description: "Curved (polarised) capacitor",                pins: ["+", "-"],     internalType: "curved capacitor" },
		{ key: "electrolytic-capacitor", description: "Electrolytic capacitor (with case)",      pins: ["+", "-"],     internalType: "ecapacitor" },
		{ key: "variable-capacitor", description: "Variable / trimmer capacitor",                pins: ["a", "b"],     internalType: "variable capacitor" },
		{ key: "piezoelectric",      description: "Piezoelectric element",                       pins: ["a", "b"],     internalType: "piezoelectric" },
		{ key: "ferroelectric-capacitor", description: "Ferroelectric capacitor",                pins: ["a", "b"],     internalType: "ferrocap" },
		{ key: "capacitive-sensor",  description: "Capacitive sensor",                           pins: ["a", "b"],     internalType: "capacitive sensor" },

		// ======================== Inductors / transformers ========================
		{ key: "cute-inductor",      description: "Inductor (cute / curly style)",               pins: ["a", "b"],     internalType: "cute inductor" },
		{ key: "american-inductor",  description: "American-style inductor (loops)",             pins: ["a", "b"],     internalType: "american inductor" },
		{ key: "european-inductor",  description: "European-style inductor (rectangle)",         pins: ["a", "b"],     internalType: "european inductor" },
		{ key: "variable-inductor",  description: "Variable inductor",                           pins: ["a", "b"],     internalType: "variable american inductor" },
		{ key: "inductive-sensor",   description: "Inductive sensor",                            pins: ["a", "b"],     internalType: "american inductive sensor" },
		{ key: "choke",              description: "Choke / cute choke inductor",                 pins: ["a", "b"],     internalType: "cute choke" },
		{ key: "transformer",        description: "Two-winding transformer",                     pins: ["A1", "A2", "B1", "B2"], internalType: "transformer" },
		{ key: "transformer-core",   description: "Transformer with iron core",                  pins: ["A1", "A2", "B1", "B2"], internalType: "transformer core" },
		{ key: "gyrator",            description: "Gyrator",                                     pins: ["A1", "A2", "B1", "B2"], internalType: "gyrator" },

		// ======================== Diodes (full family) ========================
		{ key: "schottky-diode",     description: "Schottky diode",                              pins: ["A", "K"],     internalType: "empty Schottky diode" },
		{ key: "zener-diode",        description: "Zener diode",                                 pins: ["A", "K"],     internalType: "empty Zener diode" },
		{ key: "tunnel-diode",       description: "Tunnel diode",                                pins: ["A", "K"],     internalType: "empty tunnel diode" },
		{ key: "photo-diode",        description: "Photodiode",                                  pins: ["A", "K"],     internalType: "empty photodiode" },
		{ key: "laser-diode",        description: "Laser diode",                                 pins: ["A", "K"],     internalType: "empty laser diode" },
		{ key: "varicap",            description: "Varicap (variable-capacitance) diode",        pins: ["A", "K"],     internalType: "empty varcap" },
		{ key: "tvs-diode",          description: "Transient-voltage-suppression diode",         pins: ["A", "K"],     internalType: "empty TVS diode" },
		{ key: "shockley-diode",     description: "Shockley diode",                              pins: ["A", "K"],     internalType: "empty Shockley diode" },
		{ key: "bidirectional-diode", description: "Bidirectional diode",                        pins: ["A", "K"],     internalType: "empty bidirectionaldiode" },
		{ key: "triac",              description: "Triac (bidirectional thyristor)",             pins: ["A1", "A2", "G"], internalType: "empty triac" },
		{ key: "thyristor",          description: "Thyristor / SCR",                             pins: ["A", "K", "G"], internalType: "empty thyristor" },
		{ key: "put",                description: "Programmable unijunction transistor",         pins: ["A", "K", "G"], internalType: "empty put" },
		{ key: "gto",                description: "Gate turn-off thyristor",                     pins: ["A", "K", "G"], internalType: "empty gto" },

		// ======================== Transistors (extended) ========================
		{ key: "nmos-depletion",     description: "N-channel depletion-mode MOSFET",             pins: ["G", "D", "S"], internalType: "nmosd" },
		{ key: "pmos-depletion",     description: "P-channel depletion-mode MOSFET",             pins: ["G", "D", "S"], internalType: "pmosd" },
		{ key: "nfet",               description: "N-channel FET (enhancement)",                 pins: ["G", "D", "S"], internalType: "nfet" },
		{ key: "nfet-depletion",     description: "N-channel FET (depletion)",                   pins: ["G", "D", "S"], internalType: "nfetd" },
		{ key: "pfet",               description: "P-channel FET (enhancement)",                 pins: ["G", "D", "S"], internalType: "pfet" },
		{ key: "pfet-depletion",     description: "P-channel FET (depletion)",                   pins: ["G", "D", "S"], internalType: "pfetd" },
		{ key: "njfet",              description: "N-channel JFET",                              pins: ["G", "D", "S"], internalType: "njfet" },
		{ key: "pjfet",              description: "P-channel JFET",                              pins: ["G", "D", "S"], internalType: "pjfet" },
		{ key: "n-igbt",             description: "N-channel IGBT",                              pins: ["G", "C", "E"], internalType: "nigbt" },
		{ key: "p-igbt",             description: "P-channel IGBT",                              pins: ["G", "C", "E"], internalType: "pigbt" },
		{ key: "n-ujt",              description: "N-type unijunction transistor",               pins: ["E", "B1", "B2"], internalType: "nujt" },
		{ key: "p-ujt",              description: "P-type unijunction transistor",               pins: ["E", "B1", "B2"], internalType: "pujt" },
		{ key: "hemt",               description: "High-electron-mobility transistor",           pins: ["G", "D", "S"], internalType: "hemt" },
		{ key: "isfet",              description: "Ion-sensitive FET",                           pins: ["G", "D", "S"], internalType: "isfet" },

		// ======================== Sources & generators ========================
		{ key: "ac-voltage-source",  description: "Sinusoidal (AC) voltage source",              pins: ["+", "-"],     internalType: "sinusoidal voltage source" },
		{ key: "ac-current-source",  description: "Sinusoidal (AC) current source",              pins: ["+", "-"],     internalType: "sinusoidal current source" },
		{ key: "square-voltage-source", description: "Square-wave voltage source",               pins: ["+", "-"],     internalType: "square voltage source" },
		{ key: "triangle-voltage-source", description: "Triangle-wave voltage source",           pins: ["+", "-"],     internalType: "vsourcetri" },
		{ key: "dc-voltage-source",  description: "DC voltage source",                           pins: ["+", "-"],     internalType: "dcvsource" },
		{ key: "dc-current-source",  description: "DC current source",                           pins: ["+", "-"],     internalType: "dcisource" },
		{ key: "noise-voltage-source", description: "Noise voltage source",                      pins: ["+", "-"],     internalType: "noise voltage source" },
		{ key: "noise-current-source", description: "Noise current source",                      pins: ["+", "-"],     internalType: "noise current source" },
		{ key: "controlled-voltage-source", description: "Controlled (dependent) voltage source", pins: ["+", "-"],   internalType: "european controlled voltage source" },
		{ key: "controlled-current-source", description: "Controlled (dependent) current source", pins: ["+", "-"],   internalType: "european controlled current source" },
		{ key: "vcvs",               description: "Voltage-controlled voltage source",           pins: ["+", "-"],     internalType: "american controlled voltage source" },
		{ key: "vccs",               description: "Voltage-controlled current source",           pins: ["+", "-"],     internalType: "american controlled current source" },
		{ key: "ccvs",               description: "Current-controlled voltage source",           pins: ["+", "-"],     internalType: "cute european controlled voltage source" },
		{ key: "cccs",               description: "Current-controlled current source",           pins: ["+", "-"],     internalType: "cute european controlled current source" },
		{ key: "photovoltaic",       description: "Photovoltaic cell / source",                  pins: ["+", "-"],     internalType: "pvsource" },
		{ key: "photovoltaic-module", description: "Photovoltaic (solar) module",                pins: ["+", "-"],     internalType: "pvmodule" },
		{ key: "solar-cell",         description: "Solar-driven battery / solar cell",           pins: ["+", "-"],     internalType: "solar" },
		{ key: "battery-multi",      description: "Multi-cell battery",                          pins: ["+", "-"],     internalType: "battery" },
		{ key: "nullator",           description: "Nullator (zero-value source)",                pins: ["a", "b"],     internalType: "nullator" },
		{ key: "norator",            description: "Norator (free-value source)",                 pins: ["a", "b"],     internalType: "norator" },

		// ======================== Logic gates (american & european & IEEE) ========================
		{ key: "and-gate",           description: "AND gate (American style)",                   pins: ["in1", "in2", "out"], internalType: "american and port" },
		{ key: "or-gate",            description: "OR gate (American style)",                    pins: ["in1", "in2", "out"], internalType: "american or port" },
		{ key: "not-gate",           description: "NOT gate / inverter (American style)",        pins: ["in", "out"],         internalType: "american not port" },
		{ key: "nand-gate",          description: "NAND gate (American style)",                  pins: ["in1", "in2", "out"], internalType: "american nand port" },
		{ key: "nor-gate",           description: "NOR gate (American style)",                   pins: ["in1", "in2", "out"], internalType: "american nor port" },
		{ key: "xor-gate",           description: "XOR gate (American style)",                   pins: ["in1", "in2", "out"], internalType: "american xor port" },
		{ key: "xnor-gate",          description: "XNOR gate (American style)",                  pins: ["in1", "in2", "out"], internalType: "american xnor port" },
		{ key: "buffer-gate",        description: "Buffer / non-inverting gate",                 pins: ["in", "out"],         internalType: "american buffer port" },
		{ key: "schmitt-trigger",    description: "Non-inverting Schmitt trigger",               pins: ["in", "out"],         internalType: "schmitt" },
		{ key: "inverting-schmitt",  description: "Inverting Schmitt trigger",                   pins: ["in", "out"],         internalType: "invschmitt" },
		{ key: "and-gate-european",  description: "AND gate (European DIN/IEC style)",           pins: ["in1", "in2", "out"], internalType: "european and port" },
		{ key: "or-gate-european",   description: "OR gate (European DIN/IEC style)",            pins: ["in1", "in2", "out"], internalType: "european or port" },
		{ key: "not-gate-european",  description: "NOT gate (European DIN/IEC style)",           pins: ["in", "out"],         internalType: "european not port" },
		{ key: "nand-gate-european", description: "NAND gate (European DIN/IEC style)",          pins: ["in1", "in2", "out"], internalType: "european nand port" },
		{ key: "nor-gate-european",  description: "NOR gate (European DIN/IEC style)",           pins: ["in1", "in2", "out"], internalType: "european nor port" },
		{ key: "xor-gate-european",  description: "XOR gate (European DIN/IEC style)",           pins: ["in1", "in2", "out"], internalType: "european xor port" },
		{ key: "xnor-gate-european", description: "XNOR gate (European DIN/IEC style)",          pins: ["in1", "in2", "out"], internalType: "european xnor port" },
		{ key: "buffer-gate-european", description: "Buffer (European style)",                   pins: ["in", "out"],         internalType: "european buffer port" },
		{ key: "transmission-gate",  description: "Transmission gate (IEEE)",                    pins: ["in", "out", "ctl"],  internalType: "ieee tgate" },

		// ======================== Flip-flops ========================
		{ key: "latch-d",            description: "D-type latch",                                pins: ["D", "Q", "Qn"],            internalType: "latch" },
		{ key: "flipflop-sr",        description: "SR flip-flop",                                pins: ["S", "R", "Q", "Qn"],       internalType: "flipflop SR" },
		{ key: "flipflop-d",         description: "Edge-triggered D flip-flop",                  pins: ["D", "CLK", "Q", "Qn"],     internalType: "flipflop D" },
		{ key: "flipflop-t",         description: "Edge-triggered T flip-flop",                  pins: ["T", "CLK", "Q", "Qn"],     internalType: "flipflop T" },
		{ key: "flipflop-jk",        description: "Edge-triggered JK flip-flop",                 pins: ["J", "K", "CLK", "Q", "Qn"], internalType: "flipflop JK" },

		// ======================== Switches & buttons ========================
		{ key: "spst-switch",        description: "Single-pole single-throw switch (SPST)",      pins: ["a", "b"],         internalType: "switch" },
		{ key: "spdt-switch",        description: "Single-pole double-throw switch (SPDT)",      pins: ["a", "b", "c"],    internalType: "spdt" },
		{ key: "closing-switch",     description: "Closing (make) switch",                       pins: ["a", "b"],         internalType: "closing switch" },
		{ key: "opening-switch",     description: "Opening (break) switch",                      pins: ["a", "b"],         internalType: "opening switch" },
		{ key: "normally-open",      description: "Normally-open switch",                        pins: ["a", "b"],         internalType: "normal open switch" },
		{ key: "normally-closed",    description: "Normally-closed switch",                      pins: ["a", "b"],         internalType: "normal closed switch" },
		{ key: "push-button",        description: "Push-button switch (normally open)",          pins: ["a", "b"],         internalType: "push button" },
		{ key: "push-button-nc",     description: "Push-button switch (normally closed)",        pins: ["a", "b"],         internalType: "normally closed push button" },
		{ key: "toggle-switch",      description: "Toggle switch",                               pins: ["a", "b"],         internalType: "toggle switch" },
		{ key: "reed-switch",        description: "Reed (magnetic) switch",                      pins: ["a", "b"],         internalType: "reed" },
		{ key: "cute-spdt-up",       description: "Cute SPDT switch, up position",               pins: ["a", "b", "c"],    internalType: "cute spdt up" },
		{ key: "cute-spdt-mid",      description: "Cute SPDT switch, mid position",              pins: ["a", "b", "c"],    internalType: "cute spdt mid" },
		{ key: "cute-spdt-down",     description: "Cute SPDT switch, down position",             pins: ["a", "b", "c"],    internalType: "cute spdt down" },
		{ key: "proximity-switch",   description: "Proximity switch / proximeter",               pins: ["a", "b"],         internalType: "proximeter" },
		{ key: "relay",              description: "Electromechanical relay",                     pins: ["a", "b"],         internalType: "relais" },

		// ======================== Jumpers / connectors ========================
		{ key: "bare-jumper",        description: "Bare jumper",                                 pins: ["a", "b"],         internalType: "bare jumper" },
		{ key: "open-jumper",        description: "Open jumper",                                 pins: ["a", "b"],         internalType: "open jumper" },
		{ key: "closed-jumper",      description: "Closed jumper",                               pins: ["a", "b"],         internalType: "closed jumper" },
		{ key: "open-solder-jumper", description: "Open solder jumper",                          pins: ["a", "b"],         internalType: "open solder jumper" },
		{ key: "closed-solder-jumper", description: "Closed solder jumper",                      pins: ["a", "b"],         internalType: "closed solder jumper" },
		{ key: "bnc-connector",      description: "BNC connector",                               pins: ["sig", "shield"],  internalType: "bnc" },
		{ key: "iec-connector",      description: "IEC 60617 connector",                         pins: ["a", "b"],         internalType: "iecconnshape" },
		{ key: "iec-female-left",    description: "IEC 60617 female socket (left side)",         pins: ["p"],              internalType: "iecsocketL" },
		{ key: "iec-female-right",   description: "IEC 60617 female socket (right side)",        pins: ["p"],              internalType: "iecsocketR" },
		{ key: "iec-male-left",      description: "IEC 60617 male plug (left side)",             pins: ["p"],              internalType: "iecplugL" },
		{ key: "iec-male-right",     description: "IEC 60617 male plug (right side)",            pins: ["p"],              internalType: "iecplugR" },
		{ key: "terminal-open",      description: "Open (unconnected) terminal",                 pins: ["p"],              internalType: "ocirc" },
		{ key: "terminal-diamond",   description: "Diamond-square terminal",                     pins: ["p"],              internalType: "diamondpole" },
		{ key: "terminal-square",    description: "Square-shape terminal",                       pins: ["p"],              internalType: "squarepole" },

		// ======================== Indicators / instruments / probes ========================
		{ key: "ohmmeter",           description: "Ohm meter",                                   pins: ["+", "-"],         internalType: "ohmmeter" },
		{ key: "round-meter",        description: "Generic round meter (label-driven)",          pins: ["+", "-"],         internalType: "rmeter" },
		{ key: "round-meter-arrow",  description: "Round meter with deflection arrow",           pins: ["+", "-"],         internalType: "rmeterwa" },
		{ key: "square-meter",       description: "Generic square meter",                        pins: ["+", "-"],         internalType: "smeter" },
		{ key: "current-probe",      description: "QUCS-style current probe",                    pins: ["+", "-"],         internalType: "qiprobe" },
		{ key: "voltage-probe",      description: "QUCS-style voltage probe",                    pins: ["+", "-"],         internalType: "qvprobe" },
		{ key: "power-probe",        description: "QUCS-style power probe",                      pins: ["+", "-"],         internalType: "qpprobe" },
		{ key: "oscilloscope",       description: "Oscilloscope / oscope",                       pins: ["+", "-"],         internalType: "oscope" },
		{ key: "current-tap",        description: "Current tap / current probe",                 pins: ["a", "b"],         internalType: "currtap" },
		{ key: "current-loop",       description: "Current loop (symbolic)",                     pins: ["a", "b"],         internalType: "iloop" },
		{ key: "fuse",               description: "Fuse",                                        pins: ["a", "b"],         internalType: "fuse" },
		{ key: "fuse-asymmetric",    description: "Asymmetric fuse",                             pins: ["a", "b"],         internalType: "afuse" },
		{ key: "fuse-wiggly",        description: "Wiggly-line fuse",                            pins: ["a", "b"],         internalType: "wfuse" },
		{ key: "bulb",               description: "Bulb (lamp variant)",                         pins: ["a", "b"],         internalType: "bulb" },
		{ key: "neon-lamp",          description: "Neon lamp",                                   pins: ["a", "b"],         internalType: "neonlampcc" },
		{ key: "spark-gap",          description: "Spark gap (unenclosed)",                      pins: ["a", "b"],         internalType: "sparkgap" },
		{ key: "surge-arrester",     description: "Gas-filled surge arrester",                   pins: ["a", "b"],         internalType: "european gas filled surge arrester" },
		{ key: "loudspeaker",        description: "Loudspeaker",                                 pins: ["+", "-"],         internalType: "loudspeaker" },
		{ key: "microphone",         description: "Microphone",                                  pins: ["+", "-"],         internalType: "mic" },
		{ key: "buzzer",             description: "Buzzer",                                      pins: ["+", "-"],         internalType: "buzzer" },
		{ key: "thermocouple",       description: "Thermocouple",                                pins: ["+", "-"],         internalType: "thermocouple" },

		// ======================== Grounds & supplies ========================
		{ key: "ground-tailless",    description: "Tailless ground",                             pins: ["p"],              internalType: "tlground" },
		{ key: "ground-reference",   description: "Reference ground",                            pins: ["p"],              internalType: "rground" },
		{ key: "ground-signal",      description: "Signal ground",                               pins: ["p"],              internalType: "sground" },
		{ key: "ground-thick",       description: "Thicker tailless reference ground",           pins: ["p"],              internalType: "tground" },
		{ key: "ground-noiseless",   description: "Noiseless ground",                            pins: ["p"],              internalType: "nground" },
		{ key: "ground-protective",  description: "Protective ground (PE)",                      pins: ["p"],              internalType: "pground" },
		{ key: "ground-chassis",     description: "Chassis ground",                              pins: ["p"],              internalType: "cground" },
		{ key: "ground-earth",       description: "Earth ground (European style)",               pins: ["p"],              internalType: "eground" },
		{ key: "vcc",                description: "VCC / VDD positive supply rail",              pins: ["p"],              internalType: "vcc" },
		{ key: "vee",                description: "VEE / VSS negative supply rail",              pins: ["p"],              internalType: "vee" },

		// ======================== Antennas / RF ========================
		{ key: "antenna",            description: "Generic antenna",                             pins: ["p"],              internalType: "bareantenna" },
		{ key: "antenna-din",        description: "DIN-style antenna (triangle)",                pins: ["p"],              internalType: "dinantenna" },
		{ key: "antenna-tx",         description: "Transmitting antenna",                        pins: ["p"],              internalType: "bareTXantenna" },
		{ key: "antenna-rx",         description: "Receiving antenna",                           pins: ["p"],              internalType: "bareRXantenna" },
		{ key: "antenna-loop",       description: "Loop antenna (legacy with tails)",            pins: ["p"],              internalType: "antenna" },
		{ key: "transmission-line",  description: "Transmission line",                           pins: ["a", "b"],         internalType: "tline" },
		{ key: "microstrip-line",    description: "Microstrip transmission line",                pins: ["a", "b"],         internalType: "mstline" },
		{ key: "microstrip-stub",    description: "Microstrip linear stub",                      pins: ["p"],              internalType: "mslstub" },
		{ key: "microstrip-port",    description: "Microstrip port",                             pins: ["p"],              internalType: "msport" },
		{ key: "match",              description: "Impedance match",                             pins: ["p"],              internalType: "match" },

		// ======================== Block diagram / signal processing ========================
		{ key: "amplifier",          description: "Amplifier (single-input)",                    pins: ["in", "out"],      internalType: "amp" },
		{ key: "instrumentation-amp", description: "Instrumentation amplifier",                  pins: ["+", "-", "out"],  internalType: "iamp" },
		{ key: "vga",                description: "Variable-gain amplifier (VGA)",               pins: ["in", "out", "ctl"], internalType: "vamp" },
		{ key: "fd-op-amp",          description: "Fully differential op-amp",                   pins: ["+", "-", "+out", "-out"], internalType: "fd op amp" },
		{ key: "transconductance-amp", description: "Transconductance amplifier",                pins: ["+", "-", "out"],  internalType: "gm amp" },
		{ key: "buffer-block",       description: "Buffer block (block-diagram)",                pins: ["in", "out"],      internalType: "buffer" },
		{ key: "mixer",              description: "Frequency mixer",                             pins: ["A", "B", "out"],  internalType: "mixer" },
		{ key: "adder",              description: "Summing junction / adder",                    pins: ["A", "B", "out"],  internalType: "adder" },
		{ key: "oscillator",         description: "Oscillator block",                            pins: ["out"],            internalType: "oscillator" },
		{ key: "circulator",         description: "RF circulator",                               pins: ["A", "B", "C"],    internalType: "circulator" },
		{ key: "wilkinson-divider",  description: "Wilkinson power divider",                     pins: ["in", "out1", "out2"], internalType: "wilkinson" },
		{ key: "splitter",           description: "Resistive power splitter",                    pins: ["in", "out1", "out2"], internalType: "splitter" },
		{ key: "coupler",            description: "Directional coupler",                         pins: ["A", "B", "C", "D"], internalType: "coupler" },
		{ key: "lowpass",            description: "Lowpass filter (block)",                      pins: ["in", "out"],      internalType: "lowpass" },
		{ key: "highpass",           description: "Highpass filter (block)",                     pins: ["in", "out"],      internalType: "highpass" },
		{ key: "bandpass",           description: "Bandpass filter (block)",                     pins: ["in", "out"],      internalType: "bandpass" },
		{ key: "bandstop",           description: "Bandstop / notch filter (block)",             pins: ["in", "out"],      internalType: "bandstop" },
		{ key: "allpass",            description: "Allpass filter (block)",                      pins: ["in", "out"],      internalType: "allpass" },
		{ key: "vco",                description: "Voltage-controlled oscillator",               pins: ["ctl", "out"],     internalType: "vco" },
		{ key: "adc",                description: "Analog-to-digital converter",                 pins: ["in", "out"],      internalType: "adc" },
		{ key: "dac",                description: "Digital-to-analog converter",                 pins: ["in", "out"],      internalType: "dac" },
		{ key: "dsp",                description: "Digital-signal-processor block",              pins: ["in", "out"],      internalType: "dsp" },
		{ key: "fft",                description: "FFT block",                                   pins: ["in", "out"],      internalType: "fft" },
		{ key: "phase-shifter",      description: "Phase shifter",                               pins: ["in", "out"],      internalType: "phaseshifter" },
		{ key: "saturation",         description: "Saturation block",                            pins: ["in", "out"],      internalType: "saturation" },
		{ key: "sigmoid",            description: "Sigmoid block",                               pins: ["in", "out"],      internalType: "sigmoid" },
		{ key: "detector",           description: "Detector block",                              pins: ["in", "out"],      internalType: "detector" },
		{ key: "fiber",              description: "Optical fiber",                               pins: ["in", "out"],      internalType: "fiber" },
		{ key: "crystal-oscillator", description: "Crystal-based generator (quartz)",            pins: ["a", "b"],         internalType: "qgenerator" },
		{ key: "clock-generator",    description: "Clock generator",                             pins: ["out"],            internalType: "cgenerator" },
		{ key: "block-generator",    description: "Generic block generator",                     pins: ["out"],            internalType: "bgenerator" },
		{ key: "ac-dc-converter",    description: "Single-phase AC/DC converter",                pins: ["in", "out"],      internalType: "sacdc" },
		{ key: "dc-ac-converter",    description: "Single-phase DC/AC converter (inverter)",     pins: ["in", "out"],      internalType: "sdcac" },
		{ key: "ac-ac-converter",    description: "Single-phase AC/AC converter",                pins: ["in", "out"],      internalType: "sacac" },
		{ key: "dc-dc-converter",    description: "Single-wire DC/DC converter",                 pins: ["in", "out"],      internalType: "sdcdc" },
		{ key: "three-phase-ac-dc",  description: "Three-phase AC/DC converter",                 pins: ["in", "out"],      internalType: "tacdc" },
		{ key: "three-phase-dc-ac",  description: "Three-phase DC/AC converter",                 pins: ["in", "out"],      internalType: "tdcac" },
		{ key: "three-phase-ac-ac",  description: "Three-phase AC/AC converter",                 pins: ["in", "out"],      internalType: "tacac" },

		// ======================== Mechanical analogues ========================
		{ key: "spring",             description: "Mechanical stiffness / spring",               pins: ["a", "b"],         internalType: "spring" },
		{ key: "damper",             description: "Mechanical damping",                          pins: ["a", "b"],         internalType: "damper" },
		{ key: "inerter",            description: "Mechanical inerter",                          pins: ["a", "b"],         internalType: "inerter" },
		{ key: "mass",               description: "Mechanical mass",                             pins: ["a", "b"],         internalType: "mass" },

		// ======================== Tubes ========================
		{ key: "tube-diode",         description: "Vacuum tube diode",                           pins: ["A", "K"],         internalType: "diodetube" },
		{ key: "triode",             description: "Triode",                                      pins: ["A", "K", "G"],    internalType: "triode" },
		{ key: "tetrode",            description: "Tetrode",                                     pins: ["A", "K", "G1", "G2"], internalType: "tetrode" },
		{ key: "pentode",            description: "Pentode",                                     pins: ["A", "K", "G1", "G2", "G3"], internalType: "pentode" },
		{ key: "magnetron",          description: "Magnetron",                                   pins: ["A", "K"],         internalType: "magnetron" },

		// ======================== Wiring helpers / annotations ========================
		{ key: "wire",               description: "Multi-segment wire / connection",             pins: ["a", "b"],         internalType: "wire" },
		{ key: "spline",             description: "Free-form curved annotation (cubic Bézier)",  pins: ["a", "b"],         internalType: "cubic-spline" },
		{ key: "rectangle",          description: "Rectangle / box (annotation, IC outline)",    pins: ["p"],              internalType: "rect" },
		{ key: "ellipse",            description: "Ellipse / circle (annotation)",               pins: ["p"],              internalType: "ellipse" },
		{ key: "polygon",            description: "Closed polygon (annotation)",                 pins: ["p"],              internalType: "polygon" },
		{ key: "short",              description: "Short (zero-impedance) connector",            pins: ["a", "b"],         internalType: "short" },
		{ key: "open",               description: "Open (no connection) marker",                 pins: ["a", "b"],         internalType: "open" },
		{ key: "crossing-jump",      description: "Wire crossing with jump",                     pins: ["p"],              internalType: "jump crossing" },
		{ key: "crossing-plain",     description: "Plain wire crossing (no jump)",               pins: ["p"],              internalType: "plain crossing" },
		{ key: "current-arrow",      description: "Current/voltage arrow annotation",            pins: ["p"],              internalType: "currarrow" },

		// ======================== Misc / power ========================
		{ key: "barrier",            description: "Optical / electrical barrier",                pins: ["a", "b"],         internalType: "barrier" },
		{ key: "open-barrier",       description: "Open barrier",                                pins: ["a", "b"],         internalType: "openbarrier" },
		{ key: "squid",              description: "SQUID (superconducting quantum)",             pins: ["a", "b"],         internalType: "squid" },
		{ key: "power-block",        description: "Power-supply block",                          pins: ["in", "out"],      internalType: "power" },
		{ key: "tv-set",             description: "Television (TV set)",                         pins: ["p"],              internalType: "tvset" },
		{ key: "video-camera",       description: "Video camera",                                pins: ["p"],              internalType: "camera" },
		{ key: "trx",                description: "HAM-radio transceiver",                       pins: ["p"],              internalType: "trx" },
		{ key: "swr-meter",          description: "Standing-wave-ratio meter",                   pins: ["in", "out"],      internalType: "swr" },
	]
	return buildVocabularyFromEntries(v)
}
