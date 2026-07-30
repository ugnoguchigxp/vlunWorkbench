export interface BoundedDiagnostic {
	text: string;
	bytesRead: number;
	truncated: boolean;
}

export async function readBoundedDiagnostic(
	stream: ReadableStream<Uint8Array> | null | undefined,
	maxBytes = 1024 * 1024,
): Promise<BoundedDiagnostic> {
	if (!stream) return { text: "", bytesRead: 0, truncated: false };
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let retained = 0;
	let bytesRead = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			bytesRead += value.byteLength;
			const remaining = maxBytes - retained;
			if (remaining > 0) {
				const chunk =
					value.byteLength <= remaining ? value : value.slice(0, remaining);
				chunks.push(chunk);
				retained += chunk.byteLength;
			}
			if (bytesRead > maxBytes) {
				await reader.cancel().catch(() => {});
				break;
			}
		}
	} finally {
		reader.releaseLock();
	}
	const combined = new Uint8Array(retained);
	let offset = 0;
	for (const chunk of chunks) {
		combined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return {
		text: new TextDecoder().decode(combined),
		bytesRead,
		truncated: bytesRead > maxBytes,
	};
}
