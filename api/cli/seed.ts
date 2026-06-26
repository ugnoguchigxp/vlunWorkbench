import { stdin as input } from "node:process";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { AuthService } from "../modules/auth/auth.service";
import {
	generateSeedPassword,
	parseSeedArgs,
	type SeedArgs,
} from "./seed-options";

type PasswordSource = "argument" | "env" | "generated" | "stdin" | "unchanged";

async function readPasswordFromStdin(): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of input) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks).toString("utf8").trim();
}

async function resolvePassword(
	args: SeedArgs,
	existingUser: { id: string } | null,
): Promise<{ password?: string; source: PasswordSource }> {
	if (args.keepExistingPassword && existingUser) {
		return { source: "unchanged" };
	}
	if (args.password) {
		return { password: args.password, source: "argument" };
	}
	if (args.passwordFromStdin) {
		return { password: await readPasswordFromStdin(), source: "stdin" };
	}
	if (process.env.SEED_ADMIN_PASSWORD) {
		return { password: process.env.SEED_ADMIN_PASSWORD, source: "env" };
	}
	return { password: generateSeedPassword(), source: "generated" };
}

export async function main() {
	const args = parseSeedArgs(process.argv.slice(2));
	const env = readAppEnv();
	const db = createDbConnection(env.databaseUrl);

	try {
		const authService = new AuthService(db.db, env);
		const existing = await authService.findUserByEmail(args.adminEmail);
		const passwordResult = await resolvePassword(args, existing);
		if (!passwordResult.password && !existing) {
			throw new Error("A password is required when creating the seed admin.");
		}
		if (passwordResult.password && passwordResult.password.length < 8) {
			throw new Error("Seed admin password must be at least 8 characters.");
		}

		let user = existing;
		let action: "created" | "updated";
		if (!user) {
			if (!passwordResult.password) {
				throw new Error("A password is required when creating the seed admin.");
			}
			user = await authService.createAdmin({
				email: args.adminEmail,
				displayName: args.adminName,
				password: passwordResult.password,
			});
			action = "created";
		} else {
			user = await authService.updateUserProfile(user.id, {
				displayName: args.adminName,
				role: "admin",
			});
			if (!user.isActive) {
				user = await authService.setUserActive(user.id, user.id, true);
			}
			if (passwordResult.password) {
				await authService.resetPassword(user.id, passwordResult.password);
			}
			const refreshed = await authService.findUserById(user.id);
			if (!refreshed) {
				throw new Error("Seed admin was not found after update.");
			}
			user = refreshed;
			action = "updated";
		}

		console.log(
			JSON.stringify(
				{
					ok: true,
					action,
					user: {
						id: user.id,
						email: user.email,
						displayName: user.displayName,
						role: user.role,
						isActive: user.isActive,
					},
					password:
						passwordResult.source === "unchanged"
							? undefined
							: passwordResult.password,
					passwordSource: passwordResult.source,
				},
				null,
				2,
			),
		);
	} finally {
		if (db.ownsConnection) {
			db.sqlite.close(false);
		}
	}
}

if (import.meta.main) {
	await main();
}
