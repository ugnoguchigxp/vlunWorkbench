const scopeKind = process.argv.slice(2).find((value) => !value.startsWith("-"));
if (
	!scopeKind ||
	!["selected_web", "repository_measurement"].includes(scopeKind)
) {
	throw new Error(
		"Expected selected_web or repository_measurement scope kind.",
	);
}
process.stdout.write(
	`${JSON.stringify({
		scopeKind,
		measurementOnly: scopeKind === "repository_measurement",
		note:
			scopeKind === "selected_web"
				? "This is selected Web coverage, not repository-wide coverage."
				: "Repository-wide coverage is measurement-only.",
	})}\n`,
);
