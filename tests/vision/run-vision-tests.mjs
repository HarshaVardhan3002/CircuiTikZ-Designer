#!/usr/bin/env node
// tests/vision/run-vision-tests.mjs
//
// Top-level runner for the vision/ test suite. Mirrors tests/import/run-import-tests.mjs:
// hand-rolled asserts, exits non-zero on first failure summary.

import { fileURLToPath, pathToFileURL } from "node:url"
import path from "node:path"

const here = path.dirname(fileURLToPath(import.meta.url))
const childTests = [
  "vocabulary.test.mjs",
  "schema.test.mjs",
  "prompt.test.mjs",
  "preprocessor.test.mjs",
  "classifier.test.mjs",
  "storage.test.mjs",
  "mapper.test.mjs",
  "openai-compat.test.mjs",
  "anthropic.test.mjs",
  "gemini.test.mjs",
]

let passes = 0
let failures = 0

for (const t of childTests) {
  const file = path.join(here, t)
  try {
    const mod = await import(pathToFileURL(file).href)
    const { run } = mod
    if (typeof run !== "function") {
      console.error(`  ✗ ${t} did not export a run() function`)
      failures++
      continue
    }
    const result = await run()
    passes += result.passes ?? 0
    failures += result.failures ?? 0
  } catch (err) {
    console.error(`  ✗ ${t} threw at import time: ${err?.message}`)
    failures++
  }
}

console.log(`\n${passes} passed, ${failures} failed (vision)`)
if (failures > 0) process.exit(1)
