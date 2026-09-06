import { TextInput } from "./ui";

const toNumber = (value: string, fallback: number): number => {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
};

export function TextSetting({
	id,
	label,
	value,
	onChange,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
}) {
	return (
		<div className="settings-form-field">
			<label htmlFor={id}>{label}</label>
			<TextInput
				id={id}
				value={value}
				onChange={(event) => onChange(event.target.value)}
			/>
		</div>
	);
}

export function RuntimeIsolationTextSetting({
	id,
	label,
	value,
	placeholder = "sha256:... / image@sha256:...",
	onChange,
}: {
	id: string;
	label: string;
	value: string;
	placeholder?: string;
	onChange: (value: string) => void;
}) {
	return (
		<div className="settings-form-field">
			<label htmlFor={id}>{label}</label>
			<TextInput
				id={id}
				value={value}
				placeholder={placeholder}
				onChange={(event) => onChange(event.target.value)}
			/>
		</div>
	);
}

export function dastAuthKeyStatus(
	configured: boolean,
	source: "environment" | "settings" | "none",
): string {
	if (!configured) return "Not configured";
	return source === "environment"
		? "Configured by DAST_AUTH_ENCRYPTION_KEY"
		: "Configured in encrypted runtime settings";
}

export function NumberSetting({
	id,
	label,
	value,
	step,
	onChange,
}: {
	id: string;
	label: string;
	value: number;
	step?: string;
	onChange: (value: number) => void;
}) {
	return (
		<div className="settings-form-field">
			<label htmlFor={id}>{label}</label>
			<TextInput
				id={id}
				type="number"
				min="0"
				step={step ?? "1"}
				value={value}
				onChange={(event) => onChange(toNumber(event.target.value, value))}
			/>
		</div>
	);
}
