import { afterEach, describe, expect, it } from "vitest";
import {
	createDbConnection,
	type DbConnection,
	runInProcessDbTransaction,
} from ".";

describe("runInProcessDbTransaction", () => {
	let connection: DbConnection | undefined;

	afterEach(() => {
		connection?.sqlite.close();
		connection = undefined;
	});

	it("returns the result of a synchronous callback", () => {
		const dbConnection = createDbConnection(":memory:");
		connection = dbConnection;

		expect(runInProcessDbTransaction(dbConnection.db, () => 42)).toBe(42);
	});

	it("rejects thenables at runtime even when a callback bypasses type checking", () => {
		const dbConnection = createDbConnection(":memory:");
		connection = dbConnection;
		const unsafeCallback = (() => ({ then: () => undefined })) as () => unknown;

		expect(() =>
			runInProcessDbTransaction(dbConnection.db, unsafeCallback),
		).toThrow("In-process SQLite transaction callbacks must be synchronous.");
	});
});
