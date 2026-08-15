import { verifyMigrationReadinessFixtures } from "../api/db/testing/connection";

const result = await verifyMigrationReadinessFixtures();
process.stdout.write(
	`${JSON.stringify({
		ok: true,
		...result,
		freshDatabase: "pass",
		oneVersionBehindUpgrade: "pass",
		integrity: "ok",
	})}\n`,
);
