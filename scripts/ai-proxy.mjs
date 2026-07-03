#!/usr/bin/env node
// Local CORS proxy for the in-app AI provider (chat + "Detect from image").
//
// Why this exists: the editor calls the AI endpoint from the browser (localhost:1234). Remote
// OpenAI-compatible gateways like GWDG chat-ai do NOT send CORS headers, so the browser blocks the
// response and the app shows "Failed to fetch". This proxy runs server-side (no CORS rules apply),
// forwards your request to the upstream, and adds permissive CORS headers on the way back. SSE
// streaming passes through unchanged.
//
//   node scripts/ai-proxy.mjs                                  # 127.0.0.1/::1 :8787 -> chat-ai.academiccloud.de
//   PORT=9000 UPSTREAM=https://some.host node scripts/ai-proxy.mjs
//
// Then in Settings -> AI Provider set:  Base URL = http://localhost:8787/v1   (keep your key + model).
//
// Every request prints a [proxy] line so you can see it arrive and see GWDG's status code.

import http from "node:http"
import https from "node:https"

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787
const UPSTREAM = new URL(process.env.UPSTREAM || "https://chat-ai.academiccloud.de")
const client = UPSTREAM.protocol === "http:" ? http : https

// Per-request CORS: echo the caller's Origin (so credentialed fetches are allowed) and echo whatever
// headers the preflight asked for (so it can never fail on an unlisted header). Allow-Credentials is
// only valid with a specific origin, so we add it only when an Origin is present.
function corsHeaders(req) {
	const origin = req.headers.origin
	const h = {
		"Access-Control-Allow-Origin": origin || "*",
		"Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
		"Access-Control-Allow-Headers": req.headers["access-control-request-headers"] || "*",
		"Access-Control-Allow-Private-Network": "true",
		"Access-Control-Max-Age": "86400",
		Vary: "Origin",
	}
	if (origin) h["Access-Control-Allow-Credentials"] = "true"
	return h
}

const server = http.createServer((req, res) => {
	const cors = corsHeaders(req)
	process.stderr.write(`[proxy] ${req.method} ${req.url}  origin=${req.headers.origin || "-"}\n`)

	// CORS preflight — answer it ourselves, never forward.
	if (req.method === "OPTIONS") {
		res.writeHead(204, cors)
		res.end()
		return
	}

	// Forward everything (incl. Authorization + Content-Type); fix the Host, drop browser-only headers.
	const headers = { ...req.headers }
	delete headers.origin
	delete headers.referer
	headers.host = UPSTREAM.host

	const upstreamReq = client.request(
		{
			protocol: UPSTREAM.protocol,
			hostname: UPSTREAM.hostname,
			port: UPSTREAM.port || (UPSTREAM.protocol === "http:" ? 80 : 443),
			method: req.method,
			path: req.url,
			headers,
		},
		(upstreamRes) => {
			process.stderr.write(`[proxy]   -> upstream ${upstreamRes.statusCode}\n`)
			// Strip any CORS headers the upstream set, so OURS are the only ones (no duplicates, which
			// the browser rejects as "multiple values").
			const out = { ...upstreamRes.headers }
			for (const k of Object.keys(out)) {
				if (k.toLowerCase().startsWith("access-control-")) delete out[k]
			}
			res.writeHead(upstreamRes.statusCode || 502, { ...out, ...cors })
			upstreamRes.pipe(res)
		}
	)

	upstreamReq.on("error", (e) => {
		process.stderr.write(`[proxy]   -> upstream ERROR ${e.message}\n`)
		res.writeHead(502, { "Content-Type": "application/json", ...cors })
		res.end(JSON.stringify({ error: "proxy_upstream_error", message: e.message }))
	})

	req.pipe(upstreamReq)
})

// Bind dual-stack (no host arg) so the browser reaches us whether Windows resolves `localhost`
// to 127.0.0.1 or ::1. An IPv4-only bind ("127.0.0.1") gets refused when localhost -> ::1.
server.listen(PORT, () => {
	process.stderr.write(`AI CORS proxy listening on http://localhost:${PORT}  ->  ${UPSTREAM.origin}\n`)
	process.stderr.write(`Watch this window: every request from the app prints a [proxy] line.\n`)
})
