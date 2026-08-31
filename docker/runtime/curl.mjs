#!/usr/bin/env node

const args = process.argv.slice(2);
let includeHeaders = false;
let method = "GET";
let maxTimeSeconds = 15;
let maxFileSize = 1024 * 1024;
let output = "-";
let writeOut = "";
let url = "";
const headers = new Headers();

const requireValue = (option, index) => {
	const value = args[index + 1];
	if (!value) throw new Error(`missing value for ${option}`);
	return value;
};

try {
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "-s" || arg === "-S" || arg === "-sS") continue;
		if (arg === "-i") {
			includeHeaders = true;
			continue;
		}
		if (arg === "-X" || arg === "--request") {
			method = requireValue(arg, index).toUpperCase();
			index += 1;
			continue;
		}
		if (arg === "-H" || arg === "--header") {
			const header = requireValue(arg, index);
			const separator = header.indexOf(":");
			if (separator <= 0) throw new Error("invalid header");
			headers.append(
				header.slice(0, separator).trim(),
				header.slice(separator + 1).trim(),
			);
			index += 1;
			continue;
		}
		if (arg === "--max-time") {
			maxTimeSeconds = Number(requireValue(arg, index));
			index += 1;
			continue;
		}
		if (arg === "--max-filesize") {
			maxFileSize = Number(requireValue(arg, index));
			index += 1;
			continue;
		}
		if (arg === "-o" || arg === "--output") {
			output = requireValue(arg, index);
			index += 1;
			continue;
		}
		if (arg === "-w" || arg === "--write-out") {
			writeOut = requireValue(arg, index);
			index += 1;
			continue;
		}
		if (arg.startsWith("-")) throw new Error(`unsupported option ${arg}`);
		if (url) throw new Error("multiple URLs are not supported");
		url = arg;
	}
	if (!url) throw new Error("URL is required");
	if (!Number.isFinite(maxTimeSeconds) || maxTimeSeconds <= 0) {
		throw new Error("invalid max time");
	}
	if (!Number.isSafeInteger(maxFileSize) || maxFileSize <= 0) {
		throw new Error("invalid max file size");
	}
	if (output !== "-" && output !== "/dev/null") {
		throw new Error("unsupported output path");
	}
	if (writeOut !== "" && writeOut !== "%{http_code}") {
		throw new Error("unsupported write-out format");
	}
	const parsedUrl = new URL(url);
	if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
		throw new Error("unsupported URL protocol");
	}

	const response = await fetch(parsedUrl, {
		method,
		headers,
		redirect: "manual",
		signal: AbortSignal.timeout(Math.ceil(maxTimeSeconds * 1000)),
	});
	const chunks = [];
	let totalBytes = 0;
	if (response.body && method !== "HEAD" && output === "/dev/null") {
		await response.body.cancel();
	} else if (response.body && method !== "HEAD") {
		const reader = response.body.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			totalBytes += value.byteLength;
			if (totalBytes > maxFileSize) {
				await reader.cancel();
				throw new Error("response exceeded max file size");
			}
			chunks.push(Buffer.from(value));
		}
	}
	const body = Buffer.concat(chunks, totalBytes);
	if (includeHeaders) {
		process.stdout.write(
			`HTTP/1.1 ${response.status} ${response.statusText}\r\n`,
		);
		for (const [name, value] of response.headers) {
			if (
				name === "connection" ||
				name === "content-encoding" ||
				name === "content-length" ||
				name === "transfer-encoding"
			) {
				continue;
			}
			process.stdout.write(`${name}: ${value}\r\n`);
		}
		process.stdout.write(`content-length: ${body.length}\r\n\r\n`);
	}
	process.stdout.write(body);
	if (writeOut === "%{http_code}")
		process.stdout.write(String(response.status));
} catch {
	process.stderr.write("curl request failed\n");
	process.exitCode = 1;
}
