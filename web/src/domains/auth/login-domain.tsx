import { ArrowRight, AtSign, Database, KeyRound, Shield } from "lucide-react";
import { useForm } from "react-hook-form";

type LoginFormValues = {
	email: string;
	password: string;
	redirectTo?: string;
};

type LoginDomainSectionProps = {
	active: boolean;
	busy: boolean;
	redirectTo?: string;
	onLogin: (params: LoginFormValues) => Promise<boolean>;
};

export const LoginDomainSection = ({
	active,
	busy,
	redirectTo,
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
			redirectTo,
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
						<input
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
						<input
							id="login-password"
							type="password"
							placeholder="********"
							autoComplete="current-password"
							{...register("password", { required: true })}
						/>
					</div>
					<button
						type="submit"
						className="auth-submit"
						disabled={busy || isSubmitting}
					>
						<Shield className="icon" />
						<span>ログイン</span>
						<ArrowRight className="icon" />
					</button>
				</form>
			</section>
		</main>
	);
};
