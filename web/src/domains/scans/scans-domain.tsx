import {
	AlertTriangle,
	Brain,
	CheckCircle,
	CheckCircle2,
	ChevronRight,
	Clock,
	Code,
	Cpu,
	ExternalLink,
	FileText,
	Info,
	Play,
	RefreshCw,
	Shield,
	Sparkles,
	XCircle,
} from "lucide-react";
import { useEffect, useState, useCallback } from "react";
import {
	fetchFinding,
	fetchFindingReviews,
	fetchProjects,
	fetchScanFindings,
	fetchScans,
	triggerFindingReview,
	type Finding,
	type FindingEvidence,
	type FindingReview,
	type Project,
	type ScanRun,
} from "../../api";
import { Button, SelectInput } from "../../ui";

type ScansDomainSectionProps = {
	active: boolean;
	busy: boolean;
	runWithBusy: (task: () => Promise<void>) => Promise<boolean>;
	setErrorText: (text: string | null) => void;
};

const formatDateTime = (value: string | null | undefined): string => {
	if (!value) return "-";
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	return date.toLocaleString();
};

export const ScansDomainSection = ({
	active,
	busy,
	runWithBusy,
	setErrorText,
}: ScansDomainSectionProps) => {
	const [projects, setProjects] = useState<Project[]>([]);
	const [selectedProjectId, setSelectedProjectId] = useState<string>("");
	const [scanRuns, setScanRuns] = useState<ScanRun[]>([]);
	const [selectedScanRunId, setSelectedScanRunId] = useState<string>("");
	const [findings, setFindings] = useState<Finding[]>([]);
	const [selectedFindingId, setSelectedFindingId] = useState<string>("");
	const [selectedFindingDetails, setSelectedFindingDetails] = useState<{
		finding: Finding;
		evidence: FindingEvidence[];
		latestReview: FindingReview | null;
	} | null>(null);
	const [allReviews, setAllReviews] = useState<FindingReview[]>([]);
	const [reviewLoading, setReviewLoading] = useState(false);

	// Load projects on active
	useEffect(() => {
		if (!active) return;
		void (async () => {
			try {
				setErrorText(null);
				const projs = await fetchProjects();
				setProjects(projs);
				if (projs.length > 0 && !selectedProjectId) {
					setSelectedProjectId(projs[0].id);
				}
			} catch (err) {
				setErrorText(
					err instanceof Error ? err.message : "Failed to load projects.",
				);
			}
		})();
	}, [active, setErrorText, selectedProjectId]);

	// Load scans when selected project changes
	useEffect(() => {
		if (!selectedProjectId || !active) return;
		void (async () => {
			try {
				setErrorText(null);
				const runs = await fetchScans(selectedProjectId);
				setScanRuns(runs);
				if (runs.length > 0) {
					setSelectedScanRunId(runs[0].id);
				} else {
					setSelectedScanRunId("");
					setFindings([]);
					setSelectedFindingId("");
					setSelectedFindingDetails(null);
				}
			} catch (err) {
				setErrorText(
					err instanceof Error ? err.message : "Failed to load scans.",
				);
			}
		})();
	}, [selectedProjectId, active, setErrorText]);

	// Load findings when selected scan run changes
	useEffect(() => {
		if (!selectedScanRunId || !active) return;
		void (async () => {
			try {
				setErrorText(null);
				const fnds = await fetchScanFindings(selectedScanRunId);
				setFindings(fnds);
				if (fnds.length > 0) {
					setSelectedFindingId(fnds[0].id);
				} else {
					setSelectedFindingId("");
					setSelectedFindingDetails(null);
				}
			} catch (err) {
				setErrorText(
					err instanceof Error ? err.message : "Failed to load findings.",
				);
			}
		})();
	}, [selectedScanRunId, active, setErrorText]);

	// Helper to load finding details and history
	const loadFindingDetails = useCallback(
		async (findingId: string, quiet = false) => {
			const fetchAction = async () => {
				const res = await fetchFinding(findingId);
				setSelectedFindingDetails(res);
				try {
					const reviewsRes = await fetchFindingReviews(findingId);
					setAllReviews(reviewsRes.reviews);
				} catch (e) {
					console.error("Failed to fetch all reviews", e);
					setAllReviews([]);
				}
			};

			if (quiet) {
				try {
					await fetchAction();
				} catch (err) {
					console.error("Failed to silently reload finding details:", err);
				}
			} else {
				await runWithBusy(fetchAction);
			}
		},
		[runWithBusy],
	);

	// Load finding details when finding selection changes
	useEffect(() => {
		if (!selectedFindingId || !active) return;
		void loadFindingDetails(selectedFindingId);
	}, [selectedFindingId, active, loadFindingDetails]);

	// Polling loop for active review
	useEffect(() => {
		if (!selectedFindingId || !active) return;

		let isMounted = true;
		let pollInterval: ReturnType<typeof setInterval> | null = null;

		const poll = async () => {
			try {
				const res = await fetchFinding(selectedFindingId);
				if (!isMounted) return;

				setSelectedFindingDetails(res);

				// If the latest review is done (no longer running), stop polling
				if (res.latestReview?.status !== "running") {
					if (pollInterval) {
						clearInterval(pollInterval);
						pollInterval = null;
					}
					// Also refresh the history list
					const reviewsRes = await fetchFindingReviews(selectedFindingId);
					if (isMounted) {
						setAllReviews(reviewsRes.reviews);
					}
				}
			} catch (error) {
				console.error("Failed to poll finding review:", error);
			}
		};

		if (selectedFindingDetails?.latestReview?.status === "running") {
			pollInterval = setInterval(poll, 2500);
		}

		return () => {
			isMounted = false;
			if (pollInterval) {
				clearInterval(pollInterval);
			}
		};
	}, [selectedFindingId, selectedFindingDetails?.latestReview?.status, active]);

	const handleTriggerReview = async () => {
		if (!selectedFindingId) return;
		setErrorText(null);
		setReviewLoading(true);
		try {
			const res = await triggerFindingReview(selectedFindingId);
			if (res.ok) {
				// Refresh finding details immediately
				await loadFindingDetails(selectedFindingId, true);
			} else {
				setErrorText(res.error || "Failed to trigger LLM review.");
			}
		} catch (err) {
			setErrorText(
				err instanceof Error ? err.message : "Failed to trigger LLM review.",
			);
		} finally {
			setReviewLoading(false);
		}
	};

	const getSeverityClass = (sev: string | null | undefined): string => {
		const s = (sev || "unknown").toLowerCase();
		if (s === "critical") return "sev-critical";
		if (s === "high") return "sev-high";
		if (s === "medium") return "sev-medium";
		if (s === "low") return "sev-low";
		return "sev-info";
	};

	const getStatusIcon = (status: string) => {
		if (status === "completed")
			return <CheckCircle2 className="icon text-emerald-600" />;
		if (status === "failed") return <XCircle className="icon text-red-600" />;
		if (status === "running")
			return <Clock className="icon text-yellow-600 animate-spin" />;
		return <Clock className="icon text-slate-400" />;
	};

	if (!active) return null;

	return (
		<main className="scans-layout">
			{/* Project and Scan Run Selector */}
			<section className="scans-panel">
				<div className="scans-panel-header">
					<h2>Scans</h2>
					<div className="form-stack" style={{ padding: 0 }}>
						<label htmlFor="project-select">
							<span>Select Project</span>
							<SelectInput
								id="project-select"
								value={selectedProjectId}
								onChange={(e) => setSelectedProjectId(e.target.value)}
							>
								<option value="" disabled>
									-- Select Project --
								</option>
								{projects.map((p) => (
									<option key={p.id} value={p.id}>
										{p.name}
									</option>
								))}
							</SelectInput>
						</label>
					</div>
				</div>

				<div className="scans-list">
					{scanRuns.length > 0 ? (
						scanRuns.map((run) => (
							<button
								key={run.id}
								type="button"
								className={`scan-item ${
									selectedScanRunId === run.id ? "active" : ""
								}`}
								onClick={() => setSelectedScanRunId(run.id)}
							>
								<div className="finding-meta-row">
									<strong style={{ fontSize: "14px", color: "#1e293b" }}>
										{run.profile}
									</strong>
									<span
										className={`scan-status-badge badge-${
											run.status || "queued"
										}`}
									>
										{run.status || "queued"}
									</span>
								</div>
								<small>{formatDateTime(run.createdAt)}</small>
							</button>
						))
					) : (
						<div className="tree-info" style={{ padding: "20px" }}>
							No scans found for this project.
						</div>
					)}
				</div>
			</section>

			{/* Findings List */}
			<section className="scans-panel">
				<div className="scans-panel-header">
					<h2>Findings</h2>
					<small style={{ color: "#64748b" }}>
						{findings.length} findings found
					</small>
				</div>

				<div className="scans-list">
					{findings.length > 0 ? (
						findings.map((fnd) => (
							<button
								key={fnd.id}
								type="button"
								className={`finding-item ${
									selectedFindingId === fnd.id ? "active" : ""
								}`}
								onClick={() => setSelectedFindingId(fnd.id)}
							>
								<div className="finding-meta-row">
									<span
										className={`severity-badge ${getSeverityClass(fnd.severity)}`}
									>
										{fnd.severity}
									</span>
									<span style={{ fontSize: "11px", color: "#64748b" }}>
										{fnd.sourceTool}
									</span>
								</div>
								<h4 className="finding-title">{fnd.title}</h4>
								{fnd.primaryLocation?.path ? (
									<div className="finding-loc">
										{typeof fnd.primaryLocation.path === "string"
											? fnd.primaryLocation.path.split("/").slice(-2).join("/")
											: ""}
										{fnd.primaryLocation.startLine
											? `:${fnd.primaryLocation.startLine}`
											: ""}
									</div>
								) : null}
							</button>
						))
					) : (
						<div className="tree-info" style={{ padding: "20px" }}>
							Select a scan run to view findings.
						</div>
					)}
				</div>
			</section>

			{/* Finding Details & LLM Review Details */}
			<section className="scans-panel scans-detail-col">
				<div className="scans-panel-header">
					<h2>Finding Analysis & LLM Review</h2>
				</div>

				{selectedFindingDetails ? (
					<div className="scans-detail-scroll">
						{/* Title Section */}
						<div className="detail-section">
							<div
								style={{
									display: "flex",
									alignItems: "center",
									gap: "10px",
									flexWrap: "wrap",
								}}
							>
								<span
									className={`severity-badge ${getSeverityClass(
										selectedFindingDetails.finding.severity,
									)}`}
									style={{ fontSize: "12px", padding: "4px 8px" }}
								>
									{selectedFindingDetails.finding.severity}
								</span>
								<span
									style={{
										fontSize: "13px",
										fontWeight: "600",
										color: "#475569",
									}}
								>
									Tool: {selectedFindingDetails.finding.sourceTool}
								</span>
								<span
									style={{
										fontSize: "13px",
										color: "#64748b",
										fontFamily: "monospace",
									}}
								>
									Rule: {selectedFindingDetails.finding.ruleId}
								</span>
							</div>
							<h1
								style={{
									margin: "8px 0 4px",
									fontSize: "20px",
									fontWeight: "800",
									color: "#0f172a",
									lineHeight: "1.3",
								}}
							>
								{selectedFindingDetails.finding.title}
							</h1>
							<p style={{ margin: 0, fontSize: "14px", color: "#334155" }}>
								{selectedFindingDetails.finding.description}
							</p>
						</div>

						{/* Primary Location and Evidence Code Snippet */}
						{selectedFindingDetails.finding.primaryLocation ? (
							<div className="detail-section">
								<h3 className="detail-section-title">Primary Location</h3>
								<div className="code-snippet-box">
									<div className="code-snippet-header">
										<div className="code-snippet-title">
											{String(
												selectedFindingDetails.finding.primaryLocation.path,
											)}
											{selectedFindingDetails.finding.primaryLocation.startLine
												? `#L${selectedFindingDetails.finding.primaryLocation.startLine}`
												: ""}
											{selectedFindingDetails.finding.primaryLocation.endLine &&
											selectedFindingDetails.finding.primaryLocation.endLine !==
												selectedFindingDetails.finding.primaryLocation.startLine
												? `-L${selectedFindingDetails.finding.primaryLocation.endLine}`
												: ""}
										</div>
									</div>
									<pre className="code-snippet-body">
										<code>
											{selectedFindingDetails.evidence.find(
												(ev) => ev.kind === "source-location" && ev.snippet,
											)?.snippet ||
												(typeof selectedFindingDetails.finding.metadata
													?.snippet === "string"
													? selectedFindingDetails.finding.metadata.snippet
													: "") ||
												"// Snippet not available"}
										</code>
									</pre>
								</div>
							</div>
						) : null}

						{/* LLM Review Actions and Results */}
						<div className="detail-section">
							<h3 className="detail-section-title">LLM Finding Review</h3>

							<div
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center",
									gap: "12px",
									flexWrap: "wrap",
									marginBottom: "10px",
								}}
							>
								<div
									style={{ display: "flex", alignItems: "center", gap: "8px" }}
								>
									<Brain
										className="icon text-teal-700"
										style={{ width: "20px", height: "20px" }}
									/>
									<strong style={{ fontSize: "15px", color: "#0f172a" }}>
										Review Status:
									</strong>
									{selectedFindingDetails.latestReview ? (
										<span
											className={`reviewer-header-badge reviewer-badge-${selectedFindingDetails.latestReview.status}`}
										>
											{getStatusIcon(
												selectedFindingDetails.latestReview.status,
											)}
											<span style={{ textTransform: "capitalize" }}>
												{selectedFindingDetails.latestReview.status}
											</span>
										</span>
									) : (
										<span
											style={{
												fontSize: "14px",
												color: "#64748b",
												fontStyle: "italic",
											}}
										>
											No reviews conducted yet
										</span>
									)}
								</div>

								<Button
									type="button"
									variant="primary"
									onClick={() => void handleTriggerReview()}
									disabled={
										busy ||
										reviewLoading ||
										selectedFindingDetails.latestReview?.status === "running"
									}
									style={{
										display: "inline-flex",
										alignItems: "center",
										gap: "6px",
									}}
								>
									{reviewLoading ||
									selectedFindingDetails.latestReview?.status === "running" ? (
										<RefreshCw className="icon animate-spin" />
									) : (
										<Sparkles className="icon" />
									)}
									<span>Run LLM Review</span>
								</Button>
							</div>

							{selectedFindingDetails.latestReview ? (
								<div
									style={{
										display: "flex",
										flexDirection: "column",
										gap: "16px",
									}}
								>
									{/* Review Info Bar */}
									<div className="review-header-panel">
										<div className="review-meta">
											<div className="review-meta-item">
												<strong>LLM Service:</strong>{" "}
												{selectedFindingDetails.latestReview.provider} /{" "}
												{selectedFindingDetails.latestReview.model}
											</div>
											<div className="review-meta-item">
												<strong>Started:</strong>{" "}
												{formatDateTime(
													selectedFindingDetails.latestReview.startedAt,
												)}
											</div>
											{selectedFindingDetails.latestReview.completedAt ? (
												<div className="review-meta-item">
													<strong>Completed:</strong>{" "}
													{formatDateTime(
														selectedFindingDetails.latestReview.completedAt,
													)}
												</div>
											) : null}
										</div>
									</div>

									{selectedFindingDetails.latestReview.status === "failed" &&
									selectedFindingDetails.latestReview.errorMessage ? (
										<div
											style={{
												background: "#fef2f2",
												border: "1px solid #fee2e2",
												borderRadius: "8px",
												padding: "12px 16px",
												color: "#b91c1c",
												fontSize: "13px",
											}}
										>
											<strong style={{ display: "block", marginBottom: "4px" }}>
												Review Failed Error:
											</strong>
											{selectedFindingDetails.latestReview.errorMessage}
										</div>
									) : null}

									{selectedFindingDetails.latestReview.status ===
									"completed" ? (
										<>
											{/* Assessment Cards Grid */}
											<div className="assessment-grid">
												{/* False Positive Assessment */}
												{selectedFindingDetails.latestReview
													.falsePositiveAssessment ? (
													<div className="assessment-card">
														<div className="assessment-card-header">
															<span className="assessment-card-title">
																False Positive
															</span>
															<span
																className={`assessment-card-value val-fp-${selectedFindingDetails.latestReview.falsePositiveAssessment.level}`}
															>
																{
																	selectedFindingDetails.latestReview
																		.falsePositiveAssessment.level
																}
															</span>
														</div>
														<p className="assessment-card-reasoning">
															{
																selectedFindingDetails.latestReview
																	.falsePositiveAssessment.reasoning
															}
														</p>
													</div>
												) : null}

												{/* Evidence Strength */}
												{selectedFindingDetails.latestReview
													.evidenceStrength ? (
													<div className="assessment-card">
														<div className="assessment-card-header">
															<span className="assessment-card-title">
																Evidence Strength
															</span>
															<span
																className={`assessment-card-value val-strength-${selectedFindingDetails.latestReview.evidenceStrength.level}`}
															>
																{
																	selectedFindingDetails.latestReview
																		.evidenceStrength.level
																}
															</span>
														</div>
														<p className="assessment-card-reasoning">
															{
																selectedFindingDetails.latestReview
																	.evidenceStrength.reasoning
															}
														</p>
													</div>
												) : null}

												{/* Confidence Adjustment */}
												{selectedFindingDetails.latestReview
													.confidenceAdjustment ? (
													<div className="assessment-card">
														<div className="assessment-card-header">
															<span className="assessment-card-title">
																Confidence Adj.
															</span>
															<span
																className={`assessment-card-value val-adj-${selectedFindingDetails.latestReview.confidenceAdjustment}`}
															>
																{
																	selectedFindingDetails.latestReview
																		.confidenceAdjustment
																}
															</span>
														</div>
														<p className="assessment-card-reasoning">
															The reviewer suggested a{" "}
															<strong>
																{
																	selectedFindingDetails.latestReview
																		.confidenceAdjustment
																}
															</strong>{" "}
															to the tool's finding confidence rating based on
															the evidence structure.
														</p>
													</div>
												) : null}
											</div>

											{/* Likely Impact */}
											{selectedFindingDetails.latestReview.likelyImpact ? (
												<div className="detail-section">
													<div
														style={{
															display: "flex",
															alignItems: "center",
															gap: "6px",
															fontWeight: "700",
															fontSize: "13px",
															color: "#475569",
														}}
													>
														<AlertTriangle className="icon" />
														<span>LIKELY IMPACT & SEVERITY ASSESSMENT</span>
													</div>
													<div
														style={{
															background: "#fff",
															border: "1px solid #e2e8f0",
															borderRadius: "8px",
															padding: "12px 16px",
															fontSize: "13px",
															color: "#334155",
															lineHeight: "1.5",
														}}
													>
														{selectedFindingDetails.latestReview.likelyImpact}
													</div>
												</div>
											) : null}

											{/* Remediation Direction */}
											{selectedFindingDetails.latestReview
												.remediationDirection ? (
												<div className="detail-section">
													<div
														style={{
															display: "flex",
															alignItems: "center",
															gap: "6px",
															fontWeight: "700",
															fontSize: "13px",
															color: "#475569",
														}}
													>
														<Code className="icon" />
														<span>REMEDIATION DIRECTION</span>
													</div>
													<pre className="remediation-box">
														<code>
															{
																selectedFindingDetails.latestReview
																	.remediationDirection
															}
														</code>
													</pre>
												</div>
											) : null}

											{/* Reviewer Notes */}
											{selectedFindingDetails.latestReview.reviewerNotes &&
											selectedFindingDetails.latestReview.reviewerNotes.length >
												0 ? (
												<div className="detail-section">
													<div
														style={{
															display: "flex",
															alignItems: "center",
															gap: "6px",
															fontWeight: "700",
															fontSize: "13px",
															color: "#475569",
														}}
													>
														<Info className="icon" />
														<span>ADDITIONAL REVIEWER NOTES</span>
													</div>
													<ul className="notes-list">
														{selectedFindingDetails.latestReview.reviewerNotes.map(
															(note, idx) => (
																// biome-ignore lint/suspicious/noArrayIndexKey: index is safe here
																<li key={idx}>{note}</li>
															),
														)}
													</ul>
												</div>
											) : null}
										</>
									) : null}

									{/* Historical Reviews List */}
									{allReviews.length > 1 ? (
										<div
											className="detail-section"
											style={{ marginTop: "10px" }}
										>
											<h4
												style={{
													fontSize: "12px",
													fontWeight: "700",
													color: "#64748b",
													textTransform: "uppercase",
													letterSpacing: "0.05em",
												}}
											>
												Prior Reviews History ({allReviews.length})
											</h4>
											<div
												style={{
													display: "flex",
													flexDirection: "column",
													gap: "6px",
													maxHeight: "150px",
													overflowY: "auto",
													border: "1px solid #e2e8f0",
													borderRadius: "8px",
													padding: "8px",
													background: "#f8fafc",
												}}
											>
												{allReviews.map((rev) => (
													<div
														key={rev.id}
														style={{
															display: "flex",
															justifyContent: "space-between",
															alignItems: "center",
															fontSize: "12px",
															padding: "6px",
															borderRadius: "4px",
															border:
																rev.id ===
																selectedFindingDetails.latestReview?.id
																	? "1px solid #cbd5e1"
																	: "1px solid transparent",
															background:
																rev.id ===
																selectedFindingDetails.latestReview?.id
																	? "#fff"
																	: "transparent",
														}}
													>
														<span style={{ color: "#334155" }}>
															{rev.provider} ({rev.model}) -{" "}
															{formatDateTime(rev.completedAt || rev.createdAt)}
														</span>
														<span
															className={`scan-status-badge badge-${rev.status}`}
															style={{ fontSize: "10px", padding: "1px 5px" }}
														>
															{rev.status}
														</span>
													</div>
												))}
											</div>
										</div>
									) : null}
								</div>
							) : null}
						</div>
					</div>
				) : (
					<div
						className="tree-info"
						style={{ padding: "40px 20px", textAlign: "center" }}
					>
						Select a finding from the list to view its details and
						trigger/review LLM assessments.
					</div>
				)}
			</section>
		</main>
	);
};
