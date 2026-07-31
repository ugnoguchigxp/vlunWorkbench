export type VerifyStep = {
	label: string;
	command: string[];
};

export const VERIFY_STEPS: VerifyStep[] = [
	{
		label: "sqlite-write-boundary",
		command: ["bun", "run", "scripts/check-sqlite-write-boundary.ts"],
	},
	{ label: "s11tnext", command: ["bun", "run", "s11tnext:check"] },
	{ label: "typecheck", command: ["bun", "run", "typecheck"] },
	{ label: "lint", command: ["bun", "run", "lint"] },
	{ label: "format", command: ["bun", "run", "format:check"] },
	{
		label: "source-size-budget",
		command: ["bun", "run", "check:source-size"],
	},
	{
		label: "dependency-override-docs",
		command: ["bun", "run", "check:override-docs"],
	},
	{ label: "test", command: ["bun", "run", "test"] },
	{ label: "build", command: ["bun", "run", "build"] },
	{ label: "bundle-budget", command: ["bun", "run", "check:bundle"] },
	{ label: "dependency-audit", command: ["bun", "run", "check:audit"] },
	{
		label: "artifact-tracking",
		command: ["bun", "run", "check:artifact-tracking"],
	},
];

export const STRICT_VERIFY_COMMANDS = [
	["bun", "run", "verify"],
	["bun", "run", "test:security-capability"],
	["bun", "run", "verify:phase-50-evidence"],
	["bun", "run", "test:coverage"],
	["bun", "run", "test:e2e"],
] as const;
