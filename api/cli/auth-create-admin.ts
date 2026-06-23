import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { AuthService } from "../modules/auth/auth.service";

type CliArgs = {
	email?: string;
	name?: string;
	password?: string;
	passwordFromStdin: boolean;
};

function parseArgs(argv: string[]): CliArgs {
	const args: CliArgs = { passwordFromStdin: false };
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (token === "--email") {
			args.email = argv[i + 1];
			i += 1;
			continue;
		}
		if (token === "--name") {
			args.name = argv[i + 1];
			i += 1;
			continue;
		}
		if (token === "--password") {
			args.password = argv[i + 1];
			i += 1;
			continue;
		}
		if (token === "--password-stdin") {
			args.passwordFromStdin = true;
		}
	}
	return args;
}

async function readPassword(args: CliArgs): Promise<string> {
	if (args.password) {
		return args.password;
	}
	if (args.passwordFromStdin) {
		const chunks: Buffer[] = [];
		for await (const chunk of input) {
			chunks.push(Buffer.from(chunk));
		}
		return Buffer.concat(chunks).toString("utf8").trim();
	}

	const rl = createInterface({ input, output });
	try {
		return (await rl.question("Password: ")).trim();
	} finally {
		rl.close();
	}
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	if (!args.email || !args.name) {
		throw new Error("--email and --name are required.");
	}
	const password = await readPassword(args);
	if (password.length < 8) {
		throw new Error("Password must be at least 8 characters.");
	}

	const env = readAppEnv();
	const db = createDbConnection(env.databaseUrl);
	try {
		const authService = new AuthService(db.db, env);
		const user = await authService.createAdmin({
			email: args.email,
			displayName: args.name,
			password,
		});
		console.log(
			JSON.stringify(
				{
					ok: true,
					user: {
						id: user.id,
						email: user.email,
						displayName: user.displayName,
						role: user.role,
					},
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

await main();
