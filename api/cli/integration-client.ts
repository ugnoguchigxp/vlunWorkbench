import { parseArgs } from "node:util";
import {
	type NightworkersIntegrationScope,
	nightworkersIntegrationScopeSchema,
} from "../../shared/schemas/nightworkers-security-scan-integration.schema";
import { readAppEnv } from "../app/env";
import { createDbConnection } from "../db";
import { IntegrationClientRepository } from "../modules/integrationClients/integration-client.repository";
import { IntegrationClientService } from "../modules/integrationClients/integration-client.service";

function required(value: string | undefined, name: string): string {
	if (!value?.trim()) throw new Error(`${name} is required.`);
	return value.trim();
}

function publicClient(client: {
	id: string;
	name: string;
	ownerUserId: string;
	tokenPrefix: string;
	scopes: unknown;
	allowedRoots: unknown;
	active: boolean;
	expiresAt: Date | null;
	lastUsedAt: Date | null;
	createdAt: Date;
}) {
	return {
		id: client.id,
		name: client.name,
		ownerUserId: client.ownerUserId,
		tokenPrefix: client.tokenPrefix,
		scopes: client.scopes,
		allowedRoots: client.allowedRoots,
		active: client.active,
		expiresAt: client.expiresAt?.toISOString() ?? null,
		lastUsedAt: client.lastUsedAt?.toISOString() ?? null,
		createdAt: client.createdAt.toISOString(),
	};
}

const parsed = parseArgs({
	args: process.argv.slice(2),
	allowPositionals: true,
	options: {
		name: { type: "string" },
		"owner-user": { type: "string" },
		scope: { type: "string", multiple: true },
		"allowed-root": { type: "string", multiple: true },
		"expires-at": { type: "string" },
		id: { type: "string" },
	},
	strict: true,
});

const command = parsed.positionals[0];
if (!["create", "list", "revoke", "rotate"].includes(command ?? "")) {
	throw new Error("Command must be create, list, revoke, or rotate.");
}

const env = readAppEnv();
const connection = createDbConnection(env.databaseUrl);
const repository = new IntegrationClientRepository(connection.db);
const service = new IntegrationClientService(repository);

try {
	if (command === "create") {
		const scopeInput = parsed.values.scope ?? [];
		const scopes = nightworkersIntegrationScopeSchema
			.array()
			.min(1)
			.parse(scopeInput) as NightworkersIntegrationScope[];
		const expiresAt = parsed.values["expires-at"]
			? new Date(parsed.values["expires-at"])
			: null;
		if (expiresAt && Number.isNaN(expiresAt.getTime())) {
			throw new Error("--expires-at must be an ISO-8601 timestamp.");
		}
		const created = await service.create({
			name: required(parsed.values.name, "--name"),
			ownerUserId: required(parsed.values["owner-user"], "--owner-user"),
			scopes,
			allowedRoots: parsed.values["allowed-root"] ?? [],
			expiresAt,
		});
		console.log(
			JSON.stringify(
				{
					client: publicClient(created.client),
					token: created.token,
					warning:
						"This plaintext token is shown once. Store it in the NightWorkers OS secret store.",
				},
				null,
				2,
			),
		);
	} else if (command === "list") {
		const clients = await repository.list(parsed.values["owner-user"]);
		console.log(
			JSON.stringify(
				{ clients: clients.map((client) => publicClient(client)) },
				null,
				2,
			),
		);
	} else if (command === "revoke") {
		const client = await repository.revoke(required(parsed.values.id, "--id"));
		if (!client) throw new Error("Integration client not found.");
		console.log(JSON.stringify({ client: publicClient(client) }, null, 2));
	} else {
		const rotated = await service.rotate(required(parsed.values.id, "--id"));
		console.log(
			JSON.stringify(
				{
					client: publicClient(rotated.client),
					token: rotated.token,
					warning:
						"This plaintext token is shown once. Replace the NightWorkers OS secret.",
				},
				null,
				2,
			),
		);
	}
} finally {
	connection.sqlite.close();
}
