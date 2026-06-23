import type {
	ButtonHTMLAttributes,
	InputHTMLAttributes,
	ReactNode,
	SelectHTMLAttributes,
	TextareaHTMLAttributes,
} from "react";

type ButtonVariant =
	| "primary"
	| "secondary"
	| "destructive"
	| "outline"
	| "ghost"
	| "link";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: ButtonVariant;
	full?: boolean;
};

const buttonVariantClass: Record<ButtonVariant, string> = {
	primary: "primary",
	secondary: "secondary",
	destructive: "destructive",
	outline: "variant-outline",
	ghost: "ghost",
	link: "link",
};

export function Button({
	variant = "outline",
	full = false,
	className,
	...props
}: ButtonProps) {
	return (
		<button
			{...props}
			className={[
				"demo-button",
				buttonVariantClass[variant],
				full ? "full" : "",
				className ?? "",
			]
				.filter(Boolean)
				.join(" ")}
		/>
	);
}

export function IconButton({
	className,
	...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
	return (
		<button
			{...props}
			className={["demo-icon-button", className ?? ""]
				.filter(Boolean)
				.join(" ")}
		/>
	);
}

export function TextInput({
	className,
	...props
}: InputHTMLAttributes<HTMLInputElement>) {
	return (
		<input
			{...props}
			className={["demo-input", className ?? ""].filter(Boolean).join(" ")}
		/>
	);
}

export function SelectInput({
	className,
	children,
	...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
	return (
		<select
			{...props}
			className={["demo-input", className ?? ""].filter(Boolean).join(" ")}
		>
			{children}
		</select>
	);
}

export function TextArea({
	className,
	...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
	return (
		<textarea
			{...props}
			className={["demo-textarea", className ?? ""].filter(Boolean).join(" ")}
		/>
	);
}
