export const GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

export function assertGitObjectId(value: string): string {
	if (!GIT_OBJECT_ID_PATTERN.test(value)) {
		throw new Error("Invalid Git object ID");
	}
	return value;
}
