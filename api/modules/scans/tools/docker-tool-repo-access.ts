import fs from "node:fs/promises";

type DockerRepoAccessState = {
	activeLeases: number;
	originalMode: number;
	executionMode: number;
};

export type DockerRepoAccessLease = {
	originalMode: number;
	executionMode: number;
	release: () => Promise<void>;
};

const accessStates = new Map<string, DockerRepoAccessState>();
const inputAccessStates = new Map<string, DockerRepoAccessState>();
let accessLock = Promise.resolve();

/**
 * Linux bind mounts retain the host directory owner and mode. Scanner
 * containers run as the fixed uid 65532, while mkdtemp source snapshots are
 * 0700 by default, so the container cannot even stat its read-only mount.
 * Grant only the missing "other" read/traverse bits for the lifetime of all
 * concurrent scanner leases, then restore the exact original mode.
 */
export async function acquireDockerRepoAccess(
	repoPath: string,
): Promise<DockerRepoAccessLease> {
	return await withAccessLock(async () => {
		const canonicalPath = await fs.realpath(repoPath);
		const existing = accessStates.get(canonicalPath);
		if (existing) {
			existing.activeLeases++;
			return createLease(canonicalPath, existing);
		}

		const stat = await fs.stat(canonicalPath);
		if (!stat.isDirectory()) {
			throw new Error("Docker tool repository mount must be a directory.");
		}
		const originalMode = stat.mode & 0o777;
		const executionMode = originalMode | 0o005;
		if (executionMode !== originalMode) {
			await fs.chmod(canonicalPath, executionMode);
		}
		const state = { activeLeases: 1, originalMode, executionMode };
		accessStates.set(canonicalPath, state);
		return createLease(canonicalPath, state);
	});
}

/** Grants the fixed scanner uid read access to a read-only input file. */
export async function acquireDockerInputAccess(
	inputPath: string,
): Promise<DockerRepoAccessLease> {
	return await withAccessLock(async () => {
		const canonicalPath = await fs.realpath(inputPath);
		const existing = inputAccessStates.get(canonicalPath);
		if (existing) {
			existing.activeLeases++;
			return createInputLease(canonicalPath, existing);
		}
		const stat = await fs.stat(canonicalPath);
		if (!stat.isFile()) {
			throw new Error("Docker tool input mount must be a file.");
		}
		const originalMode = stat.mode & 0o777;
		const executionMode = originalMode | 0o004;
		if (executionMode !== originalMode)
			await fs.chmod(canonicalPath, executionMode);
		const state = { activeLeases: 1, originalMode, executionMode };
		inputAccessStates.set(canonicalPath, state);
		return createInputLease(canonicalPath, state);
	});
}

function createLease(
	canonicalPath: string,
	state: DockerRepoAccessState,
): DockerRepoAccessLease {
	let released = false;
	return {
		originalMode: state.originalMode,
		executionMode: state.executionMode,
		release: async () => {
			if (released) return;
			await withAccessLock(async () => {
				if (released) return;
				const current = accessStates.get(canonicalPath);
				if (!current) {
					released = true;
					return;
				}
				current.activeLeases--;
				if (current.activeLeases === 0) {
					await fs.chmod(canonicalPath, current.originalMode);
					accessStates.delete(canonicalPath);
				}
				released = true;
			});
		},
	};
}

function createInputLease(
	canonicalPath: string,
	state: DockerRepoAccessState,
): DockerRepoAccessLease {
	let released = false;
	return {
		originalMode: state.originalMode,
		executionMode: state.executionMode,
		release: async () => {
			if (released) return;
			await withAccessLock(async () => {
				if (released) return;
				const current = inputAccessStates.get(canonicalPath);
				if (!current) return;
				current.activeLeases--;
				if (current.activeLeases === 0) {
					await fs.chmod(canonicalPath, current.originalMode);
					inputAccessStates.delete(canonicalPath);
				}
				released = true;
			});
		},
	};
}

async function withAccessLock<T>(operation: () => Promise<T>): Promise<T> {
	const previous = accessLock;
	let unlock: () => void = () => undefined;
	accessLock = new Promise<void>((resolve) => {
		unlock = resolve;
	});
	await previous;
	try {
		return await operation();
	} finally {
		unlock();
	}
}
