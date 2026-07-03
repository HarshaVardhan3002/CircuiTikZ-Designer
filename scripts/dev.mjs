#!/usr/bin/env node
// One command for local development: starts the Parcel dev server AND the AI CORS proxy together,
// so you never run two separate things. Ctrl+C stops both.
//
//   npm run dev
//
// Then open http://localhost:1234. The in-app AI works out of the box: the CORS proxy runs on :8787,
// so set the AI Base URL to http://localhost:8787/v1 once in Settings and forget it.

import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const children = []
let stopping = false

function stop(code = 0) {
	if (stopping) return
	stopping = true
	for (const c of children) {
		try {
			c.kill()
		} catch {
			/* already gone */
		}
	}
	process.exit(code)
}
process.on("SIGINT", () => stop(0))
process.on("SIGTERM", () => stop(0))

function prefixWrite(stream, tag, chunk) {
	const lines = chunk.toString().split(/\r?\n/)
	const last = lines.pop()
	for (const l of lines) stream.write(tag + l + "\n")
	if (last) stream.write(tag + last)
}

function launch(name, command, args, opts = {}) {
	const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"], ...opts })
	const tag = "[" + name + "] "
	child.stdout.on("data", (d) => prefixWrite(process.stdout, tag, d))
	child.stderr.on("data", (d) => prefixWrite(process.stderr, tag, d))
	child.on("error", (e) => process.stderr.write(tag + "failed to start: " + e.message + "\n"))
	child.on("exit", (code) => {
		process.stderr.write(tag + "exited (" + code + "); shutting everything down.\n")
		stop(code ?? 0)
	})
	children.push(child)
	return child
}

process.stdout.write("CircuiTikZ-Designer dev: starting Parcel + AI CORS proxy…\n")
// AI CORS proxy (zero-dep). node + script path with no shell -> safe with spaces/parens in the path.
launch("proxy", process.execPath, [join(root, "scripts", "ai-proxy.mjs")])
// Parcel dev server via npm (shell:true so `npm` / `npm.cmd` resolves on every platform).
launch("parcel", "npm", ["run", "start"], { shell: true })
process.stdout.write("Open http://localhost:1234  |  AI Base URL: http://localhost:8787/v1  |  Ctrl+C stops both\n")
