import { normalizeAgenticAnswerMarkdown } from "../../agentic-markdown";
import type { Artifact } from "../../api";
import { MarkdownEditor } from "../../components/markdown-editor";

const renderArtifactContent = (artifact: Artifact): string => {
	if (typeof artifact.content === "string") return artifact.content;
	return JSON.stringify(artifact.content, null, 2);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const formatArtifactCell = (value: unknown): string => {
	if (value === null || value === undefined) return "";
	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return String(value);
	}
	return JSON.stringify(value);
};

type ArtifactTable = {
	columns: string[];
	rows: unknown[][];
};

const toUniqueColumnLabels = (columns: string[]): string[] => {
	const counts = new Map<string, number>();
	return columns.map((column, index) => {
		const label = column.trim() || `Column ${index + 1}`;
		const count = counts.get(label) ?? 0;
		counts.set(label, count + 1);
		return count === 0 ? label : `${label} ${count + 1}`;
	});
};

const toArtifactTable = (content: unknown): ArtifactTable | null => {
	if (Array.isArray(content)) {
		if (content.length === 0) return { columns: [], rows: [] };
		if (content.every(isRecord)) {
			const columnKeys = Array.from(
				new Set(content.flatMap((row) => Object.keys(row))),
			);
			return {
				columns: toUniqueColumnLabels(columnKeys),
				rows: content.map((row) => columnKeys.map((column) => row[column])),
			};
		}
		if (content.every(Array.isArray)) {
			const [firstRow, ...bodyRows] = content;
			return {
				columns: toUniqueColumnLabels(
					firstRow.map((value, index) =>
						String(value ?? `Column ${index + 1}`),
					),
				),
				rows: bodyRows,
			};
		}
		return { columns: ["Value"], rows: content.map((value) => [value]) };
	}

	if (!isRecord(content)) return null;
	const columnsValue = content.columns;
	const rowsValue = content.rows;
	if (!Array.isArray(columnsValue) || !Array.isArray(rowsValue)) return null;
	const columns = toUniqueColumnLabels(
		columnsValue.map((column, index) => {
			if (typeof column === "string") return column;
			if (isRecord(column) && typeof column.label === "string")
				return column.label;
			if (isRecord(column) && typeof column.key === "string") return column.key;
			return `Column ${index + 1}`;
		}),
	);
	const columnKeys = columnsValue.map((column, index) => {
		if (typeof column === "string") return column;
		if (isRecord(column) && typeof column.key === "string") return column.key;
		if (isRecord(column) && typeof column.label === "string")
			return column.label;
		return columns[index] ?? `Column ${index + 1}`;
	});
	return {
		columns,
		rows: rowsValue.map((row) => {
			if (Array.isArray(row)) return row;
			if (isRecord(row)) return columnKeys.map((key) => row[key]);
			return [row];
		}),
	};
};

type ChartDatum = { label: string; value: number };

const toChartData = (content: unknown): ChartDatum[] => {
	const data =
		isRecord(content) && Array.isArray(content.data) ? content.data : content;
	if (Array.isArray(data) && data.every(isRecord)) {
		return data
			.map((row, index): ChartDatum | null => {
				const labelEntry = Object.entries(row).find(
					([, value]) => typeof value === "string",
				);
				const valueEntry = Object.entries(row).find(
					([, value]) => typeof value === "number",
				);
				const value = valueEntry?.[1];
				if (typeof value !== "number") return null;
				return {
					label:
						typeof labelEntry?.[1] === "string"
							? labelEntry[1]
							: `Item ${index + 1}`,
					value,
				};
			})
			.filter((item): item is ChartDatum => item !== null);
	}
	if (
		isRecord(content) &&
		Array.isArray(content.labels) &&
		Array.isArray(content.values)
	) {
		const labels = content.labels;
		return content.values
			.map((value, index): ChartDatum | null =>
				typeof value === "number"
					? {
							label: String(labels[index] ?? `Item ${index + 1}`),
							value,
						}
					: null,
			)
			.filter((item): item is ChartDatum => item !== null);
	}
	return [];
};

const getMediaUrl = (content: unknown): string | null => {
	if (!isRecord(content)) return null;
	const url = [
		content.url,
		content.src,
		content.imageUrl,
		content.mediaUrl,
	].find((candidate) => typeof candidate === "string");
	return typeof url === "string" ? url : null;
};

const getCaptionUrl = (content: unknown): string | null => {
	if (!isRecord(content)) return null;
	const url = [
		content.captionsUrl,
		content.captionUrl,
		content.subtitlesUrl,
	].find((candidate) => typeof candidate === "string");
	return typeof url === "string" ? url : null;
};

const getMediaKind = (
	content: unknown,
	url: string,
): "image" | "video" | "audio" | null => {
	if (isRecord(content) && typeof content.mimeType === "string") {
		if (content.mimeType.startsWith("image/")) return "image";
		if (content.mimeType.startsWith("video/")) return "video";
		if (content.mimeType.startsWith("audio/")) return "audio";
	}
	if (/\.(png|jpe?g|gif|webp|avif|svg)(\?.*)?$/i.test(url)) return "image";
	if (/\.(mp4|webm|mov)(\?.*)?$/i.test(url)) return "video";
	if (/\.(mp3|wav|ogg|m4a)(\?.*)?$/i.test(url)) return "audio";
	return null;
};

const ArtifactTableView = ({ table }: { table: ArtifactTable }) => (
	<div className="artifact-table-wrapper">
		<table className="artifact-table">
			<thead>
				<tr>
					{table.columns.map((column) => (
						<th key={column}>{column}</th>
					))}
				</tr>
			</thead>
			<tbody>
				{table.rows.map((row) => (
					<tr key={row.map(formatArtifactCell).join("\u001f")}>
						{table.columns.map((column, columnIndex) => (
							<td key={column}>{formatArtifactCell(row[columnIndex])}</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	</div>
);

const ArtifactChartView = ({ data }: { data: ChartDatum[] }) => {
	const maxValue = Math.max(...data.map((item) => Math.abs(item.value)), 1);
	return (
		<div className="artifact-chart">
			{data.map((item) => (
				<div className="artifact-chart-row" key={`${item.label}-${item.value}`}>
					<span>{item.label}</span>
					<div className="artifact-chart-track">
						<div
							className="artifact-chart-bar"
							style={{
								width: `${Math.max((Math.abs(item.value) / maxValue) * 100, 2)}%`,
							}}
						/>
					</div>
					<strong>{item.value}</strong>
				</div>
			))}
		</div>
	);
};

export const ArtifactPreview = ({ artifact }: { artifact: Artifact }) => {
	const textContent = renderArtifactContent(artifact);
	const mediaUrl = getMediaUrl(artifact.content);
	const mediaKind = mediaUrl ? getMediaKind(artifact.content, mediaUrl) : null;
	const captionUrl = getCaptionUrl(artifact.content);
	if (mediaUrl && mediaKind === "image") {
		return (
			<figure className="artifact-media">
				<img src={mediaUrl} alt={artifact.title ?? artifact.type} />
			</figure>
		);
	}
	if (mediaUrl && mediaKind === "video" && captionUrl) {
		return (
			<figure className="artifact-media">
				<video src={mediaUrl} controls>
					<track kind="captions" src={captionUrl} srcLang="en" />
				</video>
			</figure>
		);
	}
	if (mediaUrl && mediaKind === "audio" && captionUrl) {
		return (
			<figure className="artifact-media">
				<audio src={mediaUrl} controls>
					<track kind="captions" src={captionUrl} srcLang="en" />
				</audio>
			</figure>
		);
	}
	if (artifact.type === "markdown") {
		return (
			<div className="artifact-renderer">
				<MarkdownEditor
					value={normalizeAgenticAnswerMarkdown(textContent)}
					editable={false}
					toolbarMode="hidden"
					autoHeight={true}
					className="wysiwyg-viewer"
				/>
			</div>
		);
	}
	if (artifact.type === "table") {
		const table = toArtifactTable(artifact.content);
		if (table) return <ArtifactTableView table={table} />;
	}
	if (artifact.type === "chart") {
		const data = toChartData(artifact.content);
		if (data.length > 0) return <ArtifactChartView data={data} />;
	}
	return <pre>{textContent}</pre>;
};
