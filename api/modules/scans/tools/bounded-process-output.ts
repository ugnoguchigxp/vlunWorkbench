export type BoundedTextResult = {
	text: string;
	bytesRead: number;
	exceeded: boolean;
};

function decodeCompleteUtf8(bytes: Uint8Array): string {
	for (
		let end = bytes.byteLength;
		end >= Math.max(0, bytes.byteLength - 3);
		end--
	) {
		try {
			return new TextDecoder("utf-8", { fatal: true }).decode(
				bytes.subarray(0, end),
			);
		} catch {
			// A byte limit can split one UTF-8 code point; drop only that suffix.
		}
	}
	return "";
}

export async function readBoundedProcessText(
	stream: ReadableStream<Uint8Array> | Response | null | undefined,
	maxBytes: number,
	onLimit?: () => void,
): Promise<BoundedTextResult> {
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
		throw new Error("Process output limit must be a positive safe integer.");
	}
	if (!stream) return { text: "", bytesRead: 0, exceeded: false };

	const readable = stream instanceof Response ? stream.body : stream;
	if (!readable) return { text: "", bytesRead: 0, exceeded: false };
	const reader = readable.getReader();
	const chunks: Uint8Array[] = [];
	let retainedBytes = 0;
	let bytesRead = 0;
	let exceeded = false;

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			bytesRead += value.byteLength;
			const remaining = maxBytes - retainedBytes;
			if (remaining > 0) {
				const retained =
					value.byteLength <= remaining ? value : value.slice(0, remaining);
				chunks.push(retained);
				retainedBytes += retained.byteLength;
			}
			if (bytesRead > maxBytes) {
				exceeded = true;
				onLimit?.();
				await reader.cancel().catch(() => {});
				break;
			}
		}
	} finally {
		reader.releaseLock();
	}

	const combined = new Uint8Array(retainedBytes);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return {
		text: decodeCompleteUtf8(combined),
		bytesRead,
		exceeded,
	};
}
