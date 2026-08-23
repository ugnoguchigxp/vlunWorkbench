#!/usr/bin/env node

const args = process.argv.slice(2);
let timeoutSeconds = 10;
let output = "-";
let url = "";

try {
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "-q") continue;
		if (arg === "-T") {
			timeoutSeconds = Number(args[index + 1]);
			index += 1;
			continue;
		}
		if (arg === "-O") {
			output = args[index + 1] ?? "";
			index += 1;
			continue;
		}
		if (arg.startsWith("-")) throw new Error("unsupported option");
		if (url) throw new Error("multiple URLs are not supported");
		url = arg;
	}
	if (!url || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
		throw new Error("invalid request");
	}
	if (output !== "-" && output !== "/dev/null") {
		throw new Error("unsupported output path");
	}
	const parsedUrl = new URL(url);
	if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
		throw new Error("unsupported URL protocol");
	}
	const response = await fetch(parsedUrl, {
		redirect: "follow",
		signal: AbortSignal.timeout(Math.ceil(timeoutSeconds * 1000)),
	});
	if (!response.ok) throw new Error("request failed");
	if (output === "/dev/null") {
		await response.body?.cancel();
	} else {
		const chunks = [];
		let totalBytes = 0;
		if (response.body) {
			const reader = response.body.getReader();
			while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				totalBytes += value.byteLength;
				if (totalBytes > 16 * 1024 * 1024) {
					await reader.cancel();
					throw new Error("response too large");
				}
				chunks.push(Buffer.from(value));
			}
		}
		process.stdout.write(Buffer.concat(chunks, totalBytes));
	}
} catch {
	process.exitCode = 1;
}
