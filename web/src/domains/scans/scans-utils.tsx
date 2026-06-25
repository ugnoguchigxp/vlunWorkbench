import { CheckCircle2, Clock, XCircle } from "lucide-react";

export const formatDateTime = (value: string | null | undefined): string => {
	if (!value) return "-";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export const getSeverityClass = (
	severity: string | null | undefined,
): string => {
	switch ((severity || "unknown").toLowerCase()) {
		case "critical":
			return "sev-critical";
		case "high":
			return "sev-high";
		case "medium":
			return "sev-medium";
		case "low":
			return "sev-low";
		default:
			return "sev-info";
	}
};

export const StatusIcon = ({ status }: { status: string }) => {
	if (status === "completed")
		return <CheckCircle2 className="icon text-emerald-600" />;
	if (status === "failed") return <XCircle className="icon text-red-600" />;
	if (status === "running")
		return <Clock className="icon text-yellow-600 animate-spin" />;
	return <Clock className="icon text-slate-400" />;
};

export const durationSeconds = (
	startedAt: string | null | undefined,
	createdAt: string,
	completedAt: string | null | undefined,
) => {
	if (!completedAt) return null;
	const start = new Date(startedAt || createdAt).getTime();
	const end = new Date(completedAt).getTime();
	return Number.isNaN(start) || Number.isNaN(end)
		? null
		: `${((end - start) / 1000).toFixed(1)}s`;
};

export const shortPath = (path: unknown) =>
	typeof path === "string" ? path.split("/").slice(-2).join("/") : "";
