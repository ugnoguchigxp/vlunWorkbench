import { TriangleAlert } from "lucide-react";
import type { ScanRun } from "../../../api";
import { buildScanFailureDisplay } from "../scan-failure-display";

export function ScanFailurePanel({ scan }: { scan: ScanRun | null }) {
	const failure = buildScanFailureDisplay(scan);
	if (!failure || !scan) return null;
	const headingId = `scan-failure-${scan.id}`;
	return (
		<section className="workspace-scan-failure" aria-labelledby={headingId}>
			<header>
				<TriangleAlert aria-hidden="true" />
				<div>
					<span>スキャン未完了</span>
					<h2 id={headingId}>{failure.title}</h2>
				</div>
			</header>
			<p>{failure.explanation}</p>
			<div className="workspace-scan-failure-action">
				<strong>次に行うこと</strong>
				<p>{failure.nextAction}</p>
			</div>
			<p className="workspace-scan-failure-assurance">{failure.assurance}</p>
			{failure.terminationReason ||
			failure.reasonCodes.length > 0 ||
			failure.technicalMessage ? (
				<details>
					<summary>技術情報を表示</summary>
					<dl>
						{failure.terminationReason ? (
							<>
								<dt>終了理由</dt>
								<dd>
									<code>{failure.terminationReason}</code>
								</dd>
							</>
						) : null}
						{failure.reasonCodes.length > 0 ? (
							<>
								<dt>原因コード</dt>
								<dd>
									<code>{failure.reasonCodes.join(", ")}</code>
								</dd>
							</>
						) : null}
						{failure.technicalMessage ? (
							<>
								<dt>実行メッセージ</dt>
								<dd>{failure.technicalMessage}</dd>
							</>
						) : null}
					</dl>
				</details>
			) : null}
		</section>
	);
}
