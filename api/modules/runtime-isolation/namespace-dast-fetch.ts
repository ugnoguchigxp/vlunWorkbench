import type { DastFetch } from "../dast/http-runner";
import type { DockerRuntimeBundleRunner } from "./docker-runtime-bundle-lifecycle";

/**
 * HTTP data plane for passive DAST. The crawler remains bounded server-side,
 * but every target request is executed from the disposable target namespace.
 */
export function createNamespaceDastFetch(params: {
	namespaceOwnerId: string;
	allowedOrigin: string;
	image: string;
	runner: DockerRuntimeBundleRunner;
	dockerBin?: string;
}): DastFetch {
	return async (input, init = {}) => {
		const request = input instanceof Request ? input : new Request(input, init);
		if (new URL(request.url).origin !== params.allowedOrigin) {
			return new Response("namespace_dast_origin_rejected", { status: 403 });
		}
		const headers = [...request.headers.entries()];
		const env: Record<string, string> = {
			VWB_URL: request.url,
			VWB_METHOD: request.method,
			VWB_HEADER_COUNT: String(headers.length),
		};
		for (const [index, [name, value]] of headers.entries()) {
			env[`VWB_HEADER_${index}`] = `${name}: ${value}`;
		}
		const result = await params.runner.run(
			[
				params.dockerBin ?? "docker",
				"run",
				"--rm",
				"--network",
				`container:${params.namespaceOwnerId}`,
				"--user",
				"1000:1000",
				"--read-only",
				"--cap-drop",
				"ALL",
				"--security-opt",
				"no-new-privileges",
				"--memory",
				"128m",
				"--memory-swap",
				"128m",
				"--cpus",
				"0.25",
				"--pids-limit",
				"64",
				"--tmpfs",
				"/tmp:rw,nosuid,nodev,size=32m,uid=1000,gid=1000",
				"--env",
				"VWB_URL",
				"--env",
				"VWB_METHOD",
				"--env",
				"VWB_HEADER_COUNT",
				...headers.flatMap((_, index) => ["--env", `VWB_HEADER_${index}`]),
				params.image,
				"sh",
				"-ceu",
				'set --; i=0; while [ "$i" -lt "$VWB_HEADER_COUNT" ]; do value="$(printenv "VWB_HEADER_$i")"; set -- "$@" -H "$value"; i=$((i+1)); done; curl -sS -i --max-time 15 --max-filesize 1048576 -X "$VWB_METHOD" "$@" "$VWB_URL"',
			],
			{ env },
		);
		if (result.exitCode !== 0) {
			return new Response(result.stderr || "namespace_http_executor_failed", {
				status: 599,
			});
		}
		return parseCurlResponse(result.stdout);
	};
}

function parseCurlResponse(raw: string): Response {
	const boundary = raw.indexOf("\r\n\r\n") >= 0 ? "\r\n\r\n" : "\n\n";
	const splitAt = raw.indexOf(boundary);
	if (splitAt < 0) return new Response(raw, { status: 599 });
	const headerBlock = raw.slice(0, splitAt);
	const body = raw.slice(splitAt + boundary.length);
	const lines = headerBlock.split(/\r?\n/);
	const statusMatch = lines.shift()?.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})/);
	if (!statusMatch) return new Response(raw, { status: 599 });
	const headers = new Headers();
	for (const line of lines) {
		const separator = line.indexOf(":");
		if (separator > 0)
			headers.append(
				line.slice(0, separator),
				line.slice(separator + 1).trim(),
			);
	}
	return new Response(body, { status: Number(statusMatch[1]), headers });
}
