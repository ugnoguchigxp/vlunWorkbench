import { useState } from "react";
import type { AutomatedDiagnosticRun } from "../../api";

export function useAutomatedDiagnosticState() {
	const [automatedDiagnostics, setAutomatedDiagnostics] = useState<
		AutomatedDiagnosticRun[]
	>([]);
	const [automatedDiagnosticLoading, setAutomatedDiagnosticLoading] =
		useState(false);
	return {
		automatedDiagnostics,
		setAutomatedDiagnostics,
		automatedDiagnosticLoading,
		setAutomatedDiagnosticLoading,
	};
}
