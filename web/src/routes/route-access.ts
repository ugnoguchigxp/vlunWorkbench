const sessionCheckedPathPrefixes = ["/protected"] as const;

export function requiresSessionCheck(pathname: string): boolean {
	return (
		pathname === "/login" ||
		sessionCheckedPathPrefixes.some(
			(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
		)
	);
}
