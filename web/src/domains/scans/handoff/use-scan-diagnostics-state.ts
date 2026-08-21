import { useState } from "react";
import type {
	AttackSurfaceItem,
	AutomatedDiagnosticRun,
	DiagnosticReport,
	ScanReview,
	ScanReviewFindingFilter,
	SecurityCheckResult,
} from "../../../api";

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

export function useScanDiagnosticsState() {
	const automatedDiagnosticState = useAutomatedDiagnosticState();
	const [improvementRequestLoading, setImprovementRequestLoading] =
		useState(false);
	const [attackSurfaceItems, setAttackSurfaceItems] = useState<
		AttackSurfaceItem[]
	>([]);
	const [securityCheckResults, setSecurityCheckResults] = useState<
		SecurityCheckResult[]
	>([]);
	const [diagnosticReports, setDiagnosticReports] = useState<
		DiagnosticReport[]
	>([]);
	const [diagnosticLoading, setDiagnosticLoading] = useState(false);
	const [scanReviewLoading, setScanReviewLoading] = useState(false);
	const [scanReviewFindingFilter, setScanReviewFindingFilter] =
		useState<ScanReviewFindingFilter>("all");
	const [scanReviews, setScanReviews] = useState<ScanReview[]>([]);

	return {
		...automatedDiagnosticState,
		attackSurfaceItems,
		diagnosticLoading,
		diagnosticReports,
		improvementRequestLoading,
		scanReviewFindingFilter,
		scanReviewLoading,
		scanReviews,
		securityCheckResults,
		setAttackSurfaceItems,
		setDiagnosticLoading,
		setDiagnosticReports,
		setImprovementRequestLoading,
		setScanReviewFindingFilter,
		setScanReviewLoading,
		setScanReviews,
		setSecurityCheckResults,
	};
}

export type ScanDiagnosticsState = ReturnType<typeof useScanDiagnosticsState>;
