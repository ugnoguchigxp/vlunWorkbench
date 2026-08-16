export async function runPhase55StrictEntryPrerequisites(params: {
	platform: NodeJS.Platform;
	entryReportExists: boolean;
	verifyBaseline: () => Promise<void>;
	runPhase54FullCloseout: () => Promise<void>;
}): Promise<void> {
	if (params.platform !== "linux") {
		throw new Error("phase_55_entry_requires_linux");
	}
	if (params.entryReportExists) {
		throw new Error("phase_55_entry_report_reuse_rejected");
	}
	await params.verifyBaseline();
	await params.runPhase54FullCloseout();
	await params.verifyBaseline();
}
