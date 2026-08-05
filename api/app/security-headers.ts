type CspDirectives = Record<string, string[]>;

export const appContentSecurityPolicy: CspDirectives = {
	defaultSrc: ["'self'"],
	baseUri: ["'self'"],
	connectSrc: ["'self'"],
	fontSrc: ["'self'", "data:"],
	formAction: ["'self'"],
	frameAncestors: ["'self'"],
	imgSrc: ["'self'", "data:", "blob:"],
	manifestSrc: ["'self'"],
	objectSrc: ["'none'"],
	scriptSrc: ["'self'"],
	styleSrc: ["'self'", "'unsafe-inline'"],
	workerSrc: ["'self'", "blob:"],
};

export const viteDevContentSecurityPolicy: CspDirectives = {
	...appContentSecurityPolicy,
	connectSrc: [
		"'self'",
		"ws:",
		"http://localhost:5173",
		"http://127.0.0.1:5173",
	],
	scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
};

const toKebabCase = (value: string): string =>
	value.replace(/[A-Z]+(?![a-z])|[A-Z]/g, (match, offset) =>
		offset ? `-${match.toLowerCase()}` : match.toLowerCase(),
	);

export function serializeContentSecurityPolicy(policy: CspDirectives): string {
	return Object.entries(policy)
		.map(
			([directive, values]) => `${toKebabCase(directive)} ${values.join(" ")}`,
		)
		.join("; ");
}
