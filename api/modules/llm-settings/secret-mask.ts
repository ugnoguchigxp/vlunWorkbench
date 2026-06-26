export const SECRET_MASK = "********";

export function isMaskedSecret(value: unknown): boolean {
	return value === SECRET_MASK;
}

export function maskSecret(value: string | null | undefined): string {
	return value ? SECRET_MASK : "";
}
