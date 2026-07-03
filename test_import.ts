import { parseTikz } from "./src/scripts/import/tikzParser"
import { transformTikzToSaveObjects } from "./src/scripts/import/tikzTransformer"
import { DiagnosticsCollector } from "./src/scripts/import/diagnostics"

const source = "\\draw (0,0) to[R, v=$V_s$] (2,0);"
const collector = new DiagnosticsCollector(source)
const doc = parseTikz(source, collector)
console.log("AST:", JSON.stringify(doc, null, 2))

const saveObjects = transformTikzToSaveObjects(doc, collector)
console.log("SAVE OBJECTS:", JSON.stringify(saveObjects, null, 2))
console.log("ERRORS:", collector.getDiagnostics())
