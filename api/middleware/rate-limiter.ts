import type { Context } from "hono";
import { BlockList, isIP } from "node:net";

type RateLimiterOptions = {
	windowMs: number;
	limit: number;
	message?: string;
	keyGenerator?: (c: Context) => string | Promise<string>;
	trustProxy?: boolean;
	trustedProxyCidrs?: readonly string[];
	remoteAddressResolver?: (c: Context) => string | null;
};

export const rateLimiter = (options: RateLimiterOptions) => {
	const store = new Map<string, { count: number; resetAt: number }>();
	const trustedProxies = new BlockList();
	for (const cidr of options.trustedProxyCidrs ?? []) {
		const [address, prefixValue] = cidr.split("/");
		const family = isIP(address);
		const prefix = Number(prefixValue);
		if (
			!family ||
			!Number.isInteger(prefix) ||
			prefix < 0 ||
			prefix > (family === 4 ? 32 : 128)
		) {
			throw new Error(`Invalid trusted proxy CIDR: ${cidr}`);
		}
		trustedProxies.addSubnet(address, prefix, family === 4 ? "ipv4" : "ipv6");
	}

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
		const resolved = options.remoteAddressResolver?.(c);
		if (resolved) return resolved;
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
		const directIp = readDirectRemoteIp(c);
		const directFamily = directIp ? isIP(directIp) : 0;
		const directIsTrusted = Boolean(
			options.trustProxy &&
				directIp &&
				directFamily &&
				trustedProxies.check(directIp, directFamily === 4 ? "ipv4" : "ipv6"),
		);
		if (!directIsTrusted) {
			return directIp;
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
		return directIp;
	};

	const keyFromContext = async (c: Context): Promise<string> => {
		if (options.keyGenerator) {
			return await options.keyGenerator(c);
		}
		const ip = readClientIp(c);
		if (ip) return `ip:${ip}`;
		return "global";
	};

	return async (c: Context, next: () => Promise<void>) => {
		const key = await keyFromContext(c);
		const now = Date.now();
		const existing = store.get(key);

		if (!existing || existing.resetAt <= now) {
			store.set(key, { count: 1, resetAt: now + options.windowMs });
			await next();
			return;
		}

		if (existing.count >= options.limit) {
			const retryAfterSeconds = Math.max(
				1,
				Math.ceil((existing.resetAt - now) / 1000),
			);
			c.header("Retry-After", String(retryAfterSeconds));
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
