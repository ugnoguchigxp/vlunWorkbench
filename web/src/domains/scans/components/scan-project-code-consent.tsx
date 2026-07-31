export function ScanProjectCodeConsent(props: {
	checked: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<label className="scan-project-code-consent">
			<input
				type="checkbox"
				checked={props.checked}
				onChange={(event) => props.onChange(event.target.checked)}
			/>
			Java の Maven/Gradle
			自動起動で、対象プロジェクトのコードを実行することに同意する（sandbox
			未構成時は実行されません）
		</label>
	);
}
