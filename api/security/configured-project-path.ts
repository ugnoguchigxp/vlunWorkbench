import { AsyncLocalStorage } from "node:async_hooks";
import { parseAllowedProjectRoots } from "../app/env-normalizers";
import { authorizeProjectPathWithinRoots } from "./project-path-policy";

const projectRootsContext = new AsyncLocalStorage<readonly string[]>();

export function withProjectPathRoots<T>(
	roots: readonly string[],
	operation: () => T,
): T {
	return projectRootsContext.run(roots, operation);
}

/** Host filesystem authority is configuration, never a request parameter. */
export async function authorizeConfiguredProjectPath(
	projectPath: string,
	allowedRoots: readonly string[] = projectRootsContext.getStore() ??
		parseAllowedProjectRoots(process.env.PROJECT_ALLOWED_ROOTS),
) {
	return authorizeProjectPathWithinRoots({ projectPath, allowedRoots });
}
