import { afterAll } from "bun:test";
import { closeOwnedSqliteWriterClients } from "../api/db/writer/client";
import { installBunTestSubprocessCapture } from "./bun-test-subprocess-capture";

installBunTestSubprocessCapture();

afterAll(async () => {
	await closeOwnedSqliteWriterClients();
});
