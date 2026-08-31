import { Download } from "lucide-react";
import { MarkdownEditor } from "../../../components/markdown-editor";
import type { FindingDetailViewModel } from "./finding-detail-view-model";

export function FindingDetailOverview({
	model,
}: {
	model: FindingDetailViewModel;
}) {
	return (
		<div className="finding-detail-overview">
			<section className="finding-detail-section">
				<h3 className="detail-section-title">検出内容</h3>
				<FindingDescriptionMarkdown value={model.description} />
			</section>
			{model.location ? (
				<section className="finding-detail-section">
					<h3 className="detail-section-title">検出位置</h3>
					<code className="finding-location-value">
						{model.location.kind === "web" && model.location.method ? (
							<span className="finding-location-method">
								{model.location.method}
							</span>
						) : null}
						{model.location.path}
						{model.location.kind === "source" && model.location.line
							? `:${model.location.line}`
							: ""}
					</code>
				</section>
			) : null}
			{model.observation ? (
				<section className="finding-detail-section">
					<h3 className="detail-section-title">検出した事実</h3>
					<pre className="finding-observation">
						<code>{model.observation.text}</code>
					</pre>
					{model.observation.truncated ? (
						<p className="finding-observation-note">先頭2,000文字を表示</p>
					) : null}
				</section>
			) : null}
			<details className="finding-technical-details">
				<summary>技術詳細</summary>
				<dl className="finding-technical-grid">
					<DetailItem label="検査ツール" value={model.technical.sourceTool} />
					<DetailItem label="ルール" value={model.technical.ruleId} />
					{model.technical.toolConfidence ? (
						<DetailItem
							label="ツール確度（scanner申告）"
							value={model.technical.toolConfidence}
						/>
					) : null}
					{model.technical.cweIds.length > 0 ? (
						<DetailItem label="CWE" value={model.technical.cweIds.join(", ")} />
					) : null}
					{model.technical.wascIds.length > 0 ? (
						<DetailItem label="WASC" value={model.technical.wascIds.join(", ")} />
					) : null}
					{model.technical.artifacts.length > 0 ? (
						<div className="finding-artifact-list">
							<dt>生の証跡</dt>
							<dd>
								{model.technical.artifacts.map((artifact) => (
									<a
										key={artifact.id}
										href={artifact.href}
										target="_blank"
										rel="noreferrer"
									>
										<Download size={14} />
										{artifact.label}
									</a>
								))}
							</dd>
						</div>
					) : null}
				</dl>
			</details>
		</div>
	);
}

function DetailItem({ label, value }: { label: string; value: string }) {
	return (
		<div>
			<dt>{label}</dt>
			<dd>{value}</dd>
		</div>
	);
}

export function FindingDescriptionMarkdown({ value }: { value: string }) {
	return (
		<MarkdownEditor
			value={value}
			editable={false}
			autoHeight={true}
			className="finding-description-markdown"
		/>
	);
}
