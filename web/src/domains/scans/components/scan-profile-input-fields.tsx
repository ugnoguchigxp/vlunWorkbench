import { SelectInput, TextArea, TextInput } from "../../../ui";
import { useScans } from "../scans-context";

const safetyCopy = {
	R0: "読み取り専用です。対象コードや実行環境を変更しません。",
	R1: "プロジェクトコードはDocker隔離環境で実行し、終了後に作業領域を破棄します。",
	R2: "許可されたローカル対象に、読み取り専用メソッドと上限付きリクエストだけを送信します。",
	R3: "状態を変更し得る診断です。RoE、使い捨て対象、リセット手順、明示同意が必須です。",
	mixed: "元findingの安全境界を引き継ぎ、隔離環境で再検証します。",
} as const;

export function ScanProfileInputFields() {
	const c = useScans();
	const profile = c.profiles.find((item) => item.id === c.selectedProfileId);
	if (!profile) return null;
	const safetyClass = profile.safetyClass ?? "R0";
	const dynamicOptions = [
		...c.projectDynamicProfiles.map((item) => ({
			id: item.profileId,
			label: `${item.displayName}（保存済み）`,
		})),
		...c.dynamicProfileTemplates
			.filter(
				(template) =>
					!c.projectDynamicProfiles.some(
						(config) => config.profileId === template.id,
					),
			)
			.map((item) => ({ id: item.id, label: item.displayName })),
	];
	const specializedResource =
		profile.id === "dynamic-verification"
			? "dynamic"
			: profile.id === "active-technical-lab"
				? "engagements"
				: profile.id === "business-logic-lab"
					? "businessLogic"
					: null;
	const specializedError = specializedResource
		? c.specializedLaunchErrors[specializedResource]
		: null;

	return (
		<div className="scan-profile-inputs">
			<p className={`scan-safety-note safety-${safetyClass.toLowerCase()}`}>
				<strong>安全区分 {safetyClass}</strong> — {safetyCopy[safetyClass]}
			</p>
			{specializedResource && c.specializedLaunchLoading ? (
				<p className="scan-safety-note">専用プロファイルの候補を取得中です。</p>
			) : null}
			{specializedError ? (
				<p className="scan-inline-error" role="alert">
					{specializedError}
				</p>
			) : null}
			{profile.id === "dependency-supply-chain" ? (
				<div className="scan-profile-input-grid">
					<label htmlFor="supply-chain-verifier">
						<span>provenance検証方式</span>
						<SelectInput
							id="supply-chain-verifier"
							value={c.supplyChainVerifier}
							onChange={(event) =>
								c.setSupplyChainVerifier(
									event.target.value as "cosign" | "slsa",
								)
							}
						>
							<option value="cosign">Cosign（オフライン署名束）</option>
							<option value="slsa">slsa-verifier（source/builder/ref）</option>
						</SelectInput>
					</label>
					<RelativePathInput
						id="attestation-subject"
						label="検証対象ファイル"
						value={c.attestationSubject}
						onChange={c.setAttestationSubject}
						placeholder="dist/app.tar.gz"
					/>
					{c.supplyChainVerifier === "cosign" ? (
						<>
							<RelativePathInput
								id="attestation-bundle"
								label="Cosign SLSA provenance bundle"
								value={c.attestationBundle}
								onChange={c.setAttestationBundle}
								placeholder="attestations/app.bundle.json"
							/>
							<RelativePathInput
								id="trust-policy"
								label="検証用公開鍵"
								value={c.trustPolicy}
								onChange={c.setTrustPolicy}
								placeholder="security/cosign.pub"
							/>
						</>
					) : (
						<>
							<RelativePathInput
								id="slsa-provenance"
								label="SLSA provenance"
								value={c.slsaProvenance}
								onChange={c.setSlsaProvenance}
								placeholder="attestations/app.intoto.jsonl"
							/>
							<RelativePathInput
								id="slsa-policy"
								label="SLSA期待値ポリシー"
								value={c.slsaPolicy}
								onChange={c.setSlsaPolicy}
								placeholder="security/slsa-policy.json"
							/>
						</>
					)}
				</div>
			) : null}
			{profile.id === "release-artifact" ? <ReleaseInputs /> : null}
			{profile.id === "dynamic-verification" ? (
				<div className="scan-profile-input-grid">
					<label htmlFor="dynamic-profile">
						<span>適用可能な動的テスト</span>
						<SelectInput
							id="dynamic-profile"
							value={c.selectedProjectDynamicProfileId}
							onChange={(event) =>
								c.setSelectedProjectDynamicProfileId(event.target.value)
							}
						>
							<option value="">適用可能なテストがありません</option>
							{dynamicOptions.map((item) => (
								<option key={item.id} value={item.id}>
									{item.label}
								</option>
							))}
						</SelectInput>
					</label>
					<Consent
						checked={c.scanProjectCodeExecutionConsent}
						onChange={c.setScanProjectCodeExecutionConsent}
						label="Docker隔離環境でプロジェクトのテストコードを実行することに同意します"
					/>
				</div>
			) : null}
			{profile.id === "runtime-passive" || profile.id === "api-readonly" ? (
				<div className="scan-profile-input-grid">
					<Consent
						checked={c.scanProjectCodeExecutionConsent}
						onChange={c.setScanProjectCodeExecutionConsent}
						label="破棄可能なソースsnapshotからローカル対象を起動することに同意します"
					/>
					{profile.id === "api-readonly" ? (
						<label htmlFor="api-readonly-auth-context">
							<span>認証コンテキスト（任意）</span>
							<SelectInput
								id="api-readonly-auth-context"
								value={c.selectedDastAuthContextId}
								onChange={(event) =>
									c.setSelectedDastAuthContextId(event.target.value)
								}
							>
								<option value="">匿名で実行</option>
								{c.dastAuthContexts
									.filter((item) => item.status === "active")
									.map((item) => (
										<option key={item.id} value={item.id}>
											{item.label} — {item.identityRole}
										</option>
									))}
							</SelectInput>
						</label>
					) : null}
				</div>
			) : null}
			{profile.id === "authenticated-web" ? <AuthenticatedInputs /> : null}
			{profile.id === "active-technical-lab" ? <ActiveInputs /> : null}
			{profile.id === "business-logic-lab" ? <BusinessInputs /> : null}
			{profile.id === "remediation-verification" ? (
				<VerificationInputs />
			) : null}
		</div>
	);
}

function ReleaseInputs() {
	const c = useScans();
	return (
		<div className="scan-profile-input-grid">
			<label htmlFor="release-input-kind">
				<span>診断対象</span>
				<SelectInput
					id="release-input-kind"
					value={c.releaseInputKind}
					onChange={(event) =>
						c.setReleaseInputKind(
							event.target.value as "filesystem" | "image_ref" | "image_tar",
						)
					}
				>
					<option value="filesystem">既存ビルド成果物</option>
					<option value="image_ref">既存コンテナイメージ</option>
					<option value="image_tar">保存済みimage tar</option>
				</SelectInput>
			</label>
			{c.releaseInputKind === "image_ref" ? (
				<label htmlFor="release-image-ref">
					<span>Image ref</span>
					<TextInput
						id="release-image-ref"
						value={c.imageRef}
						onChange={(event) => c.setImageRef(event.target.value)}
						placeholder="registry.example/app@sha256:..."
					/>
				</label>
			) : null}
			{c.releaseInputKind === "image_tar" ? (
				<label htmlFor="release-image-tar">
					<span>Image tar path</span>
					<TextInput
						id="release-image-tar"
						value={c.imageTar}
						onChange={(event) => c.setImageTar(event.target.value)}
						placeholder="dist/app-image.tar"
					/>
				</label>
			) : null}
		</div>
	);
}

function AuthenticatedInputs() {
	const c = useScans();
	return (
		<div className="scan-profile-input-grid">
			<DastTargetFields />
			<label htmlFor="authenticated-web-context">
				<span>認証コンテキスト</span>
				<SelectInput
					id="authenticated-web-context"
					value={c.selectedDastAuthContextId}
					onChange={(event) =>
						c.setSelectedDastAuthContextId(event.target.value)
					}
				>
					<option value="">Bearer tokenから新規作成</option>
					{c.dastAuthContexts
						.filter(
							(item) =>
								item.status === "active" &&
								item.targetConfigId === c.selectedDastTargetId,
						)
						.map((item) => (
							<option key={item.id} value={item.id}>
								{item.label} — {item.identityRole}
							</option>
						))}
				</SelectInput>
			</label>
			{!c.selectedDastAuthContextId ? (
				<>
					<label htmlFor="authenticated-web-role">
						<span>Identity role</span>
						<TextInput
							id="authenticated-web-role"
							value={c.dastIdentityRole}
							onChange={(event) => c.setDastIdentityRole(event.target.value)}
						/>
					</label>
					<label htmlFor="authenticated-web-token">
						<span>Bearer token</span>
						<TextInput
							id="authenticated-web-token"
							type="password"
							value={c.dastBearerToken}
							onChange={(event) => c.setDastBearerToken(event.target.value)}
							autoComplete="new-password"
						/>
					</label>
				</>
			) : null}
		</div>
	);
}

function ActiveInputs() {
	const c = useScans();
	return (
		<div className="scan-profile-input-grid">
			<label htmlFor="active-engagement">
				<span>有効な内部RoE</span>
				<SelectInput
					id="active-engagement"
					value={c.selectedAssessmentEngagementId}
					onChange={(event) =>
						c.setSelectedAssessmentEngagementId(event.target.value)
					}
				>
					<option value="">有効なRoEがありません</option>
					{c.assessmentEngagements.map((item) => (
						<option key={item.id} value={item.id}>
							{item.environment} — {item.id}
						</option>
					))}
				</SelectInput>
			</label>
			<DastTargetFields />
			<label className="scan-profile-wide-input" htmlFor="active-plan-json">
				<span>Active診断計画 JSON（kind以下の既存ランナー入力）</span>
				<TextArea
					id="active-plan-json"
					value={c.activeAssessmentPlanJson}
					onChange={(event) =>
						c.setActiveAssessmentPlanJson(event.target.value)
					}
					placeholder='{"kind":"transaction","transaction":{...}}'
					rows={5}
				/>
			</label>
			<Consent
				checked={c.destructiveScanConsent}
				onChange={c.setDestructiveScanConsent}
				label="RoE内の使い捨て対象に状態変更リクエストを送信し、リセットを実行することに同意します"
			/>
		</div>
	);
}

function BusinessInputs() {
	const c = useScans();
	return (
		<div className="scan-profile-input-grid">
			<label htmlFor="business-logic-scenario">
				<span>検証済みシナリオ</span>
				<SelectInput
					id="business-logic-scenario"
					value={c.selectedBusinessLogicScenarioId}
					onChange={(event) =>
						c.setSelectedBusinessLogicScenarioId(event.target.value)
					}
				>
					<option value="">実行可能なシナリオがありません</option>
					{c.businessLogicScenarios.map((item) => (
						<option key={item.id} value={item.id}>
							{item.controlId} — {item.id}
						</option>
					))}
				</SelectInput>
			</label>
			<Consent
				checked={c.destructiveScanConsent}
				onChange={c.setDestructiveScanConsent}
				label="シナリオの状態変更とcleanupを使い捨て対象で実行することに同意します"
			/>
		</div>
	);
}

function VerificationInputs() {
	const c = useScans();
	return (
		<div className="scan-profile-input-grid">
			<label htmlFor="verification-finding">
				<span>修正確認するfinding</span>
				<SelectInput
					id="verification-finding"
					value={c.selectedFindingId}
					onChange={(event) => c.setSelectedFindingId(event.target.value)}
				>
					<option value="">findingを選択</option>
					{c.findings.map((item) => (
						<option key={item.id} value={item.id}>
							[{item.severity}] {item.title}
						</option>
					))}
				</SelectInput>
			</label>
			<label htmlFor="verification-profile">
				<span>再検証方法</span>
				<SelectInput
					id="verification-profile"
					value={c.selectedReproProfile}
					onChange={(event) => c.setSelectedReproProfile(event.target.value)}
				>
					<option value="">適用可能な方法を選択</option>
					{c.reproProfiles
						.filter((item) => item.isApplicable)
						.map((item) => (
							<option key={item.id} value={item.id}>
								{item.displayName}
							</option>
						))}
				</SelectInput>
			</label>
		</div>
	);
}

function DastTargetFields() {
	const c = useScans();
	return (
		<>
			<label htmlFor="profile-dast-target">
				<span>保存済みローカルtarget</span>
				<SelectInput
					id="profile-dast-target"
					value={c.selectedDastTargetId}
					onChange={(event) => {
						c.setSelectedDastTargetId(event.target.value);
						c.setSelectedDastAuthContextId("");
					}}
				>
					<option value="">originから新規作成</option>
					{c.dastTargets.map((item) => (
						<option key={item.id} value={item.id}>
							{item.name} — {item.normalizedOrigin}
						</option>
					))}
				</SelectInput>
			</label>
			{!c.selectedDastTargetId ? (
				<label htmlFor="profile-dast-origin">
					<span>ローカルtarget origin</span>
					<TextInput
						id="profile-dast-origin"
						type="url"
						value={c.dastTargetOrigin}
						onChange={(event) => c.setDastTargetOrigin(event.target.value)}
						placeholder="http://127.0.0.1:3000"
					/>
				</label>
			) : null}
		</>
	);
}

function RelativePathInput(props: {
	id: string;
	label: string;
	value: string;
	placeholder: string;
	onChange: (value: string) => void;
}) {
	return (
		<label htmlFor={props.id}>
			<span>{props.label}（リポジトリ相対）</span>
			<TextInput
				id={props.id}
				value={props.value}
				onChange={(event) => props.onChange(event.target.value)}
				placeholder={props.placeholder}
			/>
		</label>
	);
}

function Consent(props: {
	checked: boolean;
	label: string;
	onChange: (checked: boolean) => void;
}) {
	return (
		<label className="scan-profile-consent">
			<input
				type="checkbox"
				checked={props.checked}
				onChange={(event) => props.onChange(event.target.checked)}
			/>
			<span>{props.label}</span>
		</label>
	);
}
