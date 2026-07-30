import http from "node:http";
import https from "node:https";
import type { ValidatedDastTarget } from "./types";

export async function pinnedDastFetch(
	target: ValidatedDastTarget,
	input: string | URL | Request,
	init: RequestInit = {},
): Promise<Response> {
	const url = new URL(
		input instanceof Request ? input.url : input instanceof URL ? input : input,
	);
	if (url.origin !== target.runnerOrigin) {
		throw new Error("pinned_fetch_origin_mismatch");
	}
	const address = target.resolvedAddresses[0];
	if (!address) throw new Error("pinned_fetch_address_unavailable");
	const body = requestBodyBytes(init.body);
	const headers = new Headers(init.headers);
	headers.set("host", url.host);
	headers.delete("transfer-encoding");
	if (body) {
		headers.set("content-length", String(body.byteLength));
	} else {
		headers.delete("content-length");
	}
	return await new Promise<Response>((resolve, reject) => {
		const requestFn = url.protocol === "https:" ? https.request : http.request;
		const request = requestFn(
			{
				protocol: url.protocol,
				hostname: address,
				port: url.port || undefined,
				path: `${url.pathname}${url.search}`,
				method:
					init.method ?? (input instanceof Request ? input.method : "GET"),
				headers: Object.fromEntries(headers.entries()),
				servername: url.hostname,
			},
			(response) => {
				const responseHeaders = new Headers();
				for (let index = 0; index < response.rawHeaders.length; index += 2) {
					responseHeaders.append(
						response.rawHeaders[index] ?? "",
						response.rawHeaders[index + 1] ?? "",
					);
				}
				const status = response.statusCode ?? 500;
				response.resume();
				resolve(
					new Response(null, {
						status,
						statusText: response.statusMessage,
						headers: responseHeaders,
					}),
				);
			},
		);
		request.once("error", reject);
		const abort = () =>
			request.destroy(new DOMException("Aborted", "AbortError"));
		if (init.signal?.aborted) {
			abort();
			return;
		}
		init.signal?.addEventListener("abort", abort, { once: true });
		request.once("close", () =>
			init.signal?.removeEventListener("abort", abort),
		);
		if (body) request.write(body);
		request.end();
	});
}

function requestBodyBytes(
	body: BodyInit | null | undefined,
): Uint8Array | null {
	if (body === undefined || body === null) return null;
	if (typeof body === "string") return new TextEncoder().encode(body);
	if (body instanceof Uint8Array) return body;
	if (body instanceof ArrayBuffer) return new Uint8Array(body);
	throw new Error("pinned_fetch_body_type_unsupported");
}
