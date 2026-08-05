import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Config } from "drizzle-kit";
import { APP_CONFIG_DEFAULTS } from "./api/config/appDefaults";

function loadDotenvValue(key: string): string | undefined {
	const envPath = path.resolve(process.cwd(), ".env");
	if (!existsSync(envPath)) return undefined;
	const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const separator = trimmed.indexOf("=");
		if (separator === -1) continue;
		const name = trimmed.slice(0, separator).trim();
		if (name !== key) continue;
		const value = trimmed.slice(separator + 1).trim();
		return value.replace(/^(['"])(.*)\1$/, "$2");
	}
	return undefined;
}

const databaseUrl =
	process.env.DATABASE_URL ??
	loadDotenvValue("DATABASE_URL") ??
	APP_CONFIG_DEFAULTS.databaseUrl;

export default {
	schema: "./api/db/schema.ts",
	out: "./drizzle",
	dialect: "sqlite",
	dbCredentials: {
		url: databaseUrl,
	},
} satisfies Config;
