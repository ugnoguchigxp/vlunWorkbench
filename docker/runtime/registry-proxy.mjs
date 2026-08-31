import http from "node:http";
import { Readable } from "node:stream";

const port = 4873;
const upstreamOrigin = "https://registry.npmjs.org";
const forwardedRequestHeaders = [
	"accept",
	"accept-encoding",
	"if-match",
	"if-modified-since",
	"if-none-match",
	"user-agent",
];
const forwardedResponseHeaders = [
	"cache-control",
	"content-type",
	"etag",
	"last-modified",
];

const server = http.createServer(async (request, response) => {
	if (request.url === "/-/vwb/health") {
		response.writeHead(200, { "content-type": "application/json" });
		response.end('{"ok":true}');
		return;
	}
	if (request.method !== "GET" && request.method !== "HEAD") {
		response.writeHead(405, { allow: "GET, HEAD" });
		response.end("method_not_allowed");
		return;
	}

	try {
		const incoming = new URL(request.url ?? "/", "http://registry-proxy.local");
		const target = new URL(upstreamOrigin);
		target.pathname = incoming.pathname;
		target.search = incoming.search;
		const headers = new Headers();
		for (const name of forwardedRequestHeaders) {
			const value = request.headers[name];
			if (typeof value === "string") headers.set(name, value);
		}
		const upstream = await fetchFromOfficialRegistry(target, {
			method: request.method,
			headers,
			signal: AbortSignal.timeout(30_000),
		});
		const responseHeaders = {};
		for (const name of forwardedResponseHeaders) {
			const value = upstream.headers.get(name);
			if (value !== null) responseHeaders[name] = value;
		}
		response.writeHead(upstream.status, responseHeaders);
		if (!upstream.body || request.method === "HEAD") {
			response.end();
			return;
		}
		Readable.fromWeb(upstream.body).pipe(response);
	} catch {
		if (!response.headersSent) response.writeHead(502);
		response.end("registry_proxy_upstream_failed");
	}
});

server.listen(port, "0.0.0.0");

for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => server.close(() => process.exit(0)));
}

async function fetchFromOfficialRegistry(target, init) {
	let current = target;
	for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
		const response = await fetch(current, { ...init, redirect: "manual" });
		if (response.status < 300 || response.status >= 400) return response;
		const location = response.headers.get("location");
		if (!location || redirectCount === 3) return response;
		const redirected = new URL(location, current);
		if (redirected.origin !== upstreamOrigin) {
			await response.body?.cancel();
			throw new Error("registry redirect origin rejected");
		}
		await response.body?.cancel();
		current = redirected;
	}
	throw new Error("registry redirect limit exceeded");
}
