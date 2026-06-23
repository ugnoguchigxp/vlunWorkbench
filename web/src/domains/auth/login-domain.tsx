import { ArrowRight, AtSign, Database, KeyRound, Shield } from "lucide-react";
import { useForm } from "react-hook-form";
import { Button, TextInput } from "../../ui";

type LoginFormValues = {
	email: string;
	password: string;
};

type LoginDomainSectionProps = {
	active: boolean;
	busy: boolean;
	onLogin: (params: LoginFormValues) => Promise<boolean>;
};

export const LoginDomainSection = ({
	active,
	busy,
	onLogin,
}: LoginDomainSectionProps) => {
	const {
		register,
		handleSubmit,
		resetField,
		formState: { isSubmitting },
	} = useForm<LoginFormValues>({
		defaultValues: {
			email: "",
			password: "",
		},
	});

	const submitLogin = async (values: LoginFormValues) => {
		const ok = await onLogin({
			email: values.email.trim(),
			password: values.password,
		});
		if (ok) {
			resetField("password");
		}
	};

	if (!active) return null;

	return (
		<main className="auth-shell">
			<section className="auth-panel">
				<div className="auth-panel-header">
					<div className="auth-brand-row">
						<div className="auth-logo">
							<Database className="icon" />
						</div>
						<div>
							<h1>Hono Standard</h1>
							<p>ログイン</p>
						</div>
					</div>
					<div className="auth-accent-line" />
				</div>
				<form className="auth-form" onSubmit={handleSubmit(submitLogin)}>
					<label htmlFor="login-email">Email</label>
					<div className="auth-input-wrap">
						<AtSign className="icon" />
						<TextInput
							id="login-email"
							type="email"
							placeholder="admin@example.com"
							autoComplete="username"
							{...register("email", { required: true })}
						/>
					</div>
					<label htmlFor="login-password">Password</label>
					<div className="auth-input-wrap">
						<KeyRound className="icon" />
						<TextInput
							id="login-password"
							type="password"
							placeholder="********"
							autoComplete="current-password"
							{...register("password", { required: true })}
						/>
					</div>
					<Button
						type="submit"
						variant="primary"
						full
						className="auth-submit"
						disabled={busy || isSubmitting}
					>
						<Shield className="icon" />
						<span>ログイン</span>
						<ArrowRight className="icon" />
					</Button>
				</form>
			</section>
		</main>
	);
};
