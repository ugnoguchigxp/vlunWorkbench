export async function emitLifecycleEvent<T>(
	callback: ((event: T) => Promise<void> | void) | undefined,
	event: T,
): Promise<void> {
	try {
		await callback?.(event);
	} catch (error) {
		console.error("Scanner lifecycle event delivery failed.", error);
	}
}
