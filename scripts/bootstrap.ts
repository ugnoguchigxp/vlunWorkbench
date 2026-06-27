import { access, copyFile, readFile } from "node:fs/promises";
import { APP_CONFIG_DEFAULTS } from "../api/config/appDefaults";

type SeedOutput = {
	ok: boolean;
	action?: "created" | "updated";
	user?: {
		email: string;
		displayName: string;
		role: string;
		isActive: boolean;
	};
	password?: string;
	passwordSource?: string;
};

type BootstrapArgs = {
	resetAdminPassword: boolean;
};

const textDecoder = new TextDecoder();

function parseArgs(argv: string[]): BootstrapArgs {
	const args: BootstrapArgs = {
		resetAdminPassword: false,
	};

	for (const token of argv) {
		if (token === "--reset-admin-password") {
			args.resetAdminPassword = true;
			continue;
		}
		throw new Error(`Unknown argument: ${token}`);
	}

	return args;
}

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}

function parseDotEnv(text: string): Record<string, string> {
	const values: Record<string, string> = {};
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		const equalsIndex = line.indexOf("=");
		if (equalsIndex <= 0) continue;
		const key = line.slice(0, equalsIndex).trim();
		let value = line.slice(equalsIndex + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		values[key] = value;
	}
	return values;
}

async function readLocalEnv(): Promise<Record<string, string>> {
	if (!(await fileExists(".env"))) return {};
	return parseDotEnv(await readFile(".env", "utf8"));
}

async function ensureEnvFile(): Promise<"created" | "existing"> {
	if (await fileExists(".env")) {
		return "existing";
	}
	if (!(await fileExists(".env.example"))) {
		throw new Error("Missing .env.example; cannot create local .env.");
	}
	await copyFile(".env.example", ".env");
	return "created";
}

async function runCommand(command: string[]): Promise<string> {
	const proc = Bun.spawn(command, {
		stdout: "pipe",
		stderr: "pipe",
		env: process.env,
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).arrayBuffer(),
		new Response(proc.stderr).arrayBuffer(),
		proc.exited,
	]);
	const stdoutText = textDecoder.decode(stdout).trimEnd();
	const stderrText = textDecoder.decode(stderr).trimEnd();

	if (exitCode !== 0) {
		console.error(`FAIL ${command.join(" ")}`);
		if (stdoutText) console.error(stdoutText);
		if (stderrText) console.error(stderrText);
		process.exit(exitCode);
	}

	return stdoutText;
}

function parseJsonFromOutput<T>(output: string): T {
	const start = output.indexOf("{");
	const end = output.lastIndexOf("}");
	if (start < 0 || end < start) {
		throw new Error("Command did not print a JSON object.");
	}
	return JSON.parse(output.slice(start, end + 1)) as T;
}

function printStep(message: string): void {
	console.log(`OK ${message}`);
}

function printLoginSummary(
	seed: SeedOutput,
	localEnv: Record<string, string>,
): void {
	const appUrl =
		process.env.APP_URL || localEnv.APP_URL || APP_CONFIG_DEFAULTS.appUrl;
	const databaseUrl =
		process.env.DATABASE_URL ||
		localEnv.DATABASE_URL ||
		APP_CONFIG_DEFAULTS.databaseUrl;
	const userEmail = seed.user?.email ?? "admin@example.com";

	console.log("");
	console.log("Bootstrap complete.");
	console.log("");
	console.log("Next:");
	console.log("  bun run dev");
	console.log("");
	console.log("Open:");
	console.log(`  ${appUrl}`);
	console.log("");
	console.log("Login:");
	console.log(`  Email: ${userEmail}`);
	if (seed.password) {
		console.log(`  Password: ${seed.password}`);
	} else {
		console.log("  Password: unchanged");
	}
	console.log("");
	console.log("Database:");
	console.log(`  ${databaseUrl}`);
}

async function main() {
	const args = parseArgs(process.argv.slice(2));

	const envStatus = await ensureEnvFile();
	printStep(
		envStatus === "created"
			? "created .env from .env.example"
			: "found existing .env",
	);

	console.log("Running database migrations...");
	const migrateOutput = await runCommand(["bun", "api/cli/migrate.ts"]);
	if (migrateOutput) console.log(migrateOutput);
	printStep("database migrations finished");

	const seedArgs = ["bun", "api/cli/seed.ts"];
	if (!args.resetAdminPassword) {
		seedArgs.push("--keep-existing-password");
	}
	const seedOutput = await runCommand(seedArgs);
	const seed = parseJsonFromOutput<SeedOutput>(seedOutput);
	if (!seed.ok) {
		throw new Error("Seed command did not report ok: true.");
	}
	printStep(
		seed.action === "created"
			? "created local admin user"
			: "confirmed local admin user",
	);

	const localEnv = await readLocalEnv();
	printLoginSummary(seed, localEnv);
}

await main();
