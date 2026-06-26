import { randomInt } from "node:crypto";

const DEFAULT_ADMIN_EMAIL = "admin@example.com";
const DEFAULT_ADMIN_NAME = "Admin User";
const PASSWORD_LENGTH = 12;
const PASSWORD_SETS = [
	"ABCDEFGHJKLMNPQRSTUVWXYZ",
	"abcdefghijkmnopqrstuvwxyz",
	"23456789",
] as const;
const PASSWORD_CHARS = PASSWORD_SETS.join("");

export type SeedArgs = {
	adminEmail: string;
	adminName: string;
	password?: string;
	passwordFromStdin: boolean;
	keepExistingPassword: boolean;
};

function takeValue(argv: string[], index: number, flag: string): string {
	const value = argv[index + 1];
	if (!value || value.startsWith("--")) {
		throw new Error(`${flag} requires a value.`);
	}
	return value;
}

export function parseSeedArgs(argv: string[]): SeedArgs {
	const args: SeedArgs = {
		adminEmail: DEFAULT_ADMIN_EMAIL,
		adminName: DEFAULT_ADMIN_NAME,
		passwordFromStdin: false,
		keepExistingPassword: false,
	};

	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i];
		if (token === "--email") {
			args.adminEmail = takeValue(argv, i, token);
			i += 1;
			continue;
		}
		if (token === "--name") {
			args.adminName = takeValue(argv, i, token);
			i += 1;
			continue;
		}
		if (token === "--password") {
			args.password = takeValue(argv, i, token);
			i += 1;
			continue;
		}
		if (token === "--password-stdin") {
			args.passwordFromStdin = true;
			continue;
		}
		if (token === "--keep-existing-password") {
			args.keepExistingPassword = true;
			continue;
		}
		throw new Error(`Unknown argument: ${token}`);
	}

	return args;
}

export function generateSeedPassword(): string {
	const chars = PASSWORD_SETS.map((set) => set[randomInt(set.length)]);
	while (chars.length < PASSWORD_LENGTH) {
		chars.push(PASSWORD_CHARS[randomInt(PASSWORD_CHARS.length)]);
	}
	for (let i = chars.length - 1; i > 0; i -= 1) {
		const j = randomInt(i + 1);
		[chars[i], chars[j]] = [chars[j], chars[i]];
	}
	return chars.join("");
}
