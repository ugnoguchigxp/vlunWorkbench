import { describe, expect, it } from "bun:test";
import { IntegrationClientRepository } from "./integration-client.repository";
import {
	IntegrationClientAuthenticationError,
	IntegrationClientService,
} from "./integration-client.service";
import { generateIntegrationToken } from "./integration-client-token";

function repositoryWithClient(overrides?: {
	active?: boolean;
	expiresAt?: Date | null;
	tokenHash?: string;
	ownerActive?: boolean;
}) {
	const generated = generateIntegrationToken();
	let touched = false;
	const repository = new IntegrationClientRepository({} as never);
	repository.findByTokenPrefix = async () => ({
		id: "client-1",
		name: "NightWorkers",
		ownerUserId: "user-1",
		tokenPrefix: generated.tokenPrefix,
		tokenHash: overrides?.tokenHash ?? generated.tokenHash,
		scopes: [
			"nightworkers:security-scan:read",
			"nightworkers:security-scan:read",
		],
		allowedRoots: ["/workspace"],
		rateLimitPolicy: { limit: 5, windowMs: 1_000 },
		active: overrides?.active ?? true,
		expiresAt: overrides?.expiresAt ?? null,
		lastUsedAt: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	});
	repository.touchLastUsed = async () => {
		touched = true;
	};
	repository.findOwnerUser = async () => ({
		id: "user-1",
		isActive: overrides?.ownerActive ?? true,
	}) as never;
	return {
		generated,
		repository,
		wasTouched: () => touched,
	};
}

describe("IntegrationClientService authentication", () => {
	it("authenticates a hashed token and normalizes its policy", async () => {
		const fixture = repositoryWithClient();
		const service = new IntegrationClientService(fixture.repository);

		const authenticated = await service.authenticate(fixture.generated.token);

		expect(authenticated.id).toBe("client-1");
		expect(authenticated.scopes).toEqual([
			"nightworkers:security-scan:read",
		]);
		expect(authenticated.allowedRoots).toEqual(["/workspace"]);
		expect(authenticated.rateLimitPolicy).toEqual({
			limit: 5,
			windowMs: 1_000,
		});
		expect(fixture.wasTouched()).toBe(true);
	});

	it("rejects revoked and expired credentials without touching last-used", async () => {
		for (const fixture of [
			repositoryWithClient({ active: false }),
			repositoryWithClient({ expiresAt: new Date(Date.now() - 1_000) }),
		]) {
			const service = new IntegrationClientService(fixture.repository);
			await expect(service.authenticate(fixture.generated.token)).rejects.toBeInstanceOf(
				IntegrationClientAuthenticationError,
			);
			expect(fixture.wasTouched()).toBe(false);
		}
	});

	it("rejects a credential whose owner has been deactivated", async () => {
		const fixture = repositoryWithClient({ ownerActive: false });
		const service = new IntegrationClientService(fixture.repository);

		await expect(service.authenticate(fixture.generated.token)).rejects.toMatchObject(
			{ code: "inactive" },
		);
		expect(fixture.wasTouched()).toBe(false);
	});

	it("rejects a token whose stored hash does not match", async () => {
		const fixture = repositoryWithClient({
			tokenHash: generateIntegrationToken().tokenHash,
		});
		const service = new IntegrationClientService(fixture.repository);

		await expect(service.authenticate(fixture.generated.token)).rejects.toMatchObject(
			{ code: "invalid" },
		);
		expect(fixture.wasTouched()).toBe(false);
	});
});
