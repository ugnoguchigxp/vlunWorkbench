import { afterAll } from "bun:test";
import { closeOwnedSqliteWriterClients } from "../api/db/writer/client";

afterAll(async () => {
	await closeOwnedSqliteWriterClients();
});
