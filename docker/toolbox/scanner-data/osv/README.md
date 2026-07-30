# Prepared OSV database

`bun run scanner-data:prepare` downloads the eight pinned OSV ecosystem dumps
into `osv-scanner/<ecosystem>/all.zip`, validates archive integrity and a sample
record, and records one digest and record count per ecosystem in manifest v2.
The database itself is a build artifact and is intentionally not committed.
