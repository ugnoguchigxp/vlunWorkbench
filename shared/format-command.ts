export function formatCommandTokens(tokens: string[]): string {
	return tokens.map(shellQuote).join(" ");
}

function shellQuote(token: string): string {
	if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(token)) return token;
	return `'${token.replaceAll("'", `'"'"'`)}'`;
}
