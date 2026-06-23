import type { Context } from "hono";

type RateLimiterOptions = {
	windowMs: number;
	limit: number;
	message?: string;
	keyGenerator?: (c: Context) => string;
	trustProxy?: boolean;
};

export const rateLimiter = (options: RateLimiterOptions) => {
	const store = new Map<string, { count: number; resetAt: number }>();

	setInterval(
		() => {
			const now = Date.now();
			for (const [key, value] of store.entries()) {
				if (value.resetAt <= now) {
					store.delete(key);
				}
			}
		},
		5 * 60 * 1000,
	).unref?.();

	const readDirectRemoteIp = (c: Context): string | null => {
		const env = c as {
			env?: { incoming?: { socket?: { remoteAddress?: string } } };
		};
		const remoteAddress = env.env?.incoming?.socket?.remoteAddress;
		if (typeof remoteAddress === "string" && remoteAddress.length > 0) {
			return remoteAddress;
		}
		return null;
	};

	const readClientIp = (c: Context): string | null => {
		if (!options.trustProxy) {
			return readDirectRemoteIp(c);
		}
		const cfConnectingIp = c.req.header("cf-connecting-ip");
		if (cfConnectingIp) return cfConnectingIp.trim();
		const forwarded = c.req.header("x-forwarded-for");
		if (forwarded) {
			const first = forwarded.split(",")[0]?.trim();
			if (first) return first;
		}
		const realIp = c.req.header("x-real-ip");
		if (realIp) return realIp.trim();
		return readDirectRemoteIp(c);
	};

	const keyFromContext = (c: Context): string => {
		if (options.keyGenerator) {
			return options.keyGenerator(c);
		}
		const ip = readClientIp(c);
		if (ip) return `ip:${ip}`;
		return "global";
	};

	return async (c: Context, next: () => Promise<void>) => {
		const key = keyFromContext(c);
		const now = Date.now();
		const existing = store.get(key);

		if (!existing || existing.resetAt <= now) {
			store.set(key, { count: 1, resetAt: now + options.windowMs });
			await next();
			return;
		}

		if (existing.count >= options.limit) {
			return c.json(
				{
					message: options.message ?? "Too many requests",
				},
				429,
			);
		}
		existing.count += 1;
		await next();
	};
};
