export const APP_CONFIG_DEFAULTS = {
	nodeEnv: "development",
	host: "127.0.0.1",
	port: 5173,
	databaseUrl: "data/sqlite.db",
	jwtSecret: "hono-standard-dev-jwt-secret-change-this-for-production",
	jwtAccessExpiresIn: "15m",
	jwtRefreshExpiresIn: "7d",
	appUrl: "http://localhost:5173",
	corsOrigins: ["http://localhost:5173"],
	trustProxy: true,
	cookieSameSite: "lax",
} as const;
