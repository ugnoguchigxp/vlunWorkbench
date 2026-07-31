import {
	Bell,
	Calendar,
	Check,
	Copy,
	Info,
	LoaderCircle,
	Mail,
	MoreHorizontal,
	Settings,
	ShieldCheck,
	SlidersHorizontal,
	Star,
	X,
} from "lucide-react";
import type { CSSProperties, Dispatch, SetStateAction } from "react";
import {
	type ShowcaseDensity,
	type ShowcaseFontSize,
	type ShowcaseRadius,
	type ShowcaseSettings,
	type ShowcaseTheme,
	showcaseDensityOptions,
	showcaseFontSizeOptions,
	showcaseRadiusOptions,
	showcaseThemeOptions,
} from "../showcase-settings-context";

type ShowcaseAppearanceContentProps = {
	settings: ShowcaseSettings;
	setTheme: (theme: ShowcaseTheme) => void;
	setDensity: (density: ShowcaseDensity) => void;
	setRadius: (radius: ShowcaseRadius) => void;
	setFontSize: (fontSize: ShowcaseFontSize) => void;
	resetSettings: () => void;
	progress: number;
	setProgress: Dispatch<SetStateAction<number>>;
	copied: boolean;
	setCopied: Dispatch<SetStateAction<boolean>>;
};

export function ShowcaseAppearanceContent(
	props: ShowcaseAppearanceContentProps,
) {
	const {
		settings,
		setTheme,
		setDensity,
		setRadius,
		setFontSize,
		resetSettings,
		progress,
		setProgress,
		copied,
		setCopied,
	} = props;
	return (
		<>
			<section
				className="showcase-settings-panel"
				aria-labelledby="appearance-heading"
			>
				<div className="showcase-settings-header">
					<div>
						<h2 id="appearance-heading">Appearance Controls</h2>
						<p>Theme tokens persisted by React Context and localStorage.</p>
					</div>
					<button
						type="button"
						className="demo-button variant-outline"
						onClick={resetSettings}
					>
						Reset
					</button>
				</div>
				<div className="settings-grid">
					<label className="settings-field" htmlFor="showcase-theme">
						<span>Theme Color</span>
						<select
							id="showcase-theme"
							value={settings.theme}
							onChange={(event) =>
								setTheme(event.target.value as ShowcaseTheme)
							}
						>
							{showcaseThemeOptions.map((option) => (
								<option key={option.value} value={option.value}>
									{option.label}
								</option>
							))}
						</select>
					</label>
					<div className="settings-field">
						<span>Density</span>
						<div className="settings-button-row">
							{showcaseDensityOptions.map((option) => (
								<button
									type="button"
									key={option.value}
									className={settings.density === option.value ? "active" : ""}
									aria-pressed={settings.density === option.value}
									onClick={() => setDensity(option.value as ShowcaseDensity)}
								>
									{option.label}
								</button>
							))}
						</div>
					</div>
					<div className="settings-field">
						<span>Corner Radius</span>
						<div className="settings-button-row">
							{showcaseRadiusOptions.map((option) => (
								<button
									type="button"
									key={option.value}
									className={settings.radius === option.value ? "active" : ""}
									aria-pressed={settings.radius === option.value}
									onClick={() => setRadius(option.value as ShowcaseRadius)}
								>
									{option.label}
								</button>
							))}
						</div>
					</div>
					<div className="settings-field">
						<span>Font Size</span>
						<div className="settings-button-row">
							{showcaseFontSizeOptions.map((option) => (
								<button
									type="button"
									key={option.value}
									className={settings.fontSize === option.value ? "active" : ""}
									aria-pressed={settings.fontSize === option.value}
									onClick={() => setFontSize(option.value as ShowcaseFontSize)}
								>
									{option.label}
								</button>
							))}
						</div>
					</div>
				</div>
				<div className="theme-preview-row">
					{showcaseThemeOptions.map((option) => (
						<button
							type="button"
							key={option.value}
							className={
								settings.theme === option.value
									? "theme-swatch active"
									: "theme-swatch"
							}
							aria-label={option.label}
							aria-pressed={settings.theme === option.value}
							onClick={() => setTheme(option.value as ShowcaseTheme)}
							style={
								{
									"--swatch-color": option.swatch,
								} as CSSProperties & Record<"--swatch-color", string>
							}
						/>
					))}
				</div>
			</section>

			<section className="showcase-section" aria-labelledby="actions-heading">
				<h2 id="actions-heading">Actions & Feedback</h2>
				<div className="button-row">
					<button type="button" className="demo-button primary">
						<Check className="icon" />
						Default
					</button>
					<button type="button" className="demo-button secondary">
						<Settings className="icon" />
						Secondary
					</button>
					<button type="button" className="demo-button destructive">
						<X className="icon" />
						Destructive
					</button>
					<button type="button" className="demo-button variant-outline">
						<SlidersHorizontal className="icon" />
						Outline
					</button>
					<button type="button" className="demo-button ghost">
						Ghost
					</button>
					<button type="button" className="demo-button link">
						Link
					</button>
					<button type="button" className="demo-button primary" disabled>
						Disabled
					</button>
					<button
						type="button"
						className="demo-icon-button"
						aria-label="More actions"
						title="More actions"
					>
						<MoreHorizontal className="icon" />
					</button>
					<button
						type="button"
						className="demo-icon-button"
						aria-label="Notifications"
						title="Notifications"
					>
						<Bell className="icon" />
					</button>
				</div>
				<div className="badge-row">
					<span className="demo-badge default">Default</span>
					<span className="demo-badge secondary">Secondary</span>
					<span className="demo-badge variant-outline">Outline</span>
					<span className="demo-badge destructive">Destructive</span>
					<span className="demo-badge success">Success</span>
				</div>
				<div className="feedback-grid">
					<div className="demo-alert info">
						<Info className="icon" />
						<div>
							<strong>System notice</strong>
							<span>Background sync is current.</span>
						</div>
					</div>
					<div className="demo-alert success">
						<ShieldCheck className="icon" />
						<div>
							<strong>Verified</strong>
							<span>Production checks completed.</span>
						</div>
					</div>
					<div className="demo-toast">
						<Bell className="icon" />
						<span>Notification toast</span>
						<button type="button" aria-label="Dismiss notification">
							<X className="icon" />
						</button>
					</div>
				</div>
				<div className="feedback-grid compact">
					<div className="progress-block">
						<div>
							<span>Usage</span>
							<strong>{progress}%</strong>
						</div>
						<div className="progress-track">
							<div
								className="progress-fill"
								style={{ width: `${progress}%` }}
							/>
						</div>
						<button
							type="button"
							className="demo-button secondary"
							onClick={() => setProgress((value) => (value + 10) % 110)}
						>
							Simulate Progress
						</button>
					</div>
					<div
						className="skeleton-stack"
						role="img"
						aria-label="Skeleton preview"
					>
						<span />
						<span />
						<span />
					</div>
					<div className="spinner-row">
						<LoaderCircle className="spinner-icon" />
						<span>Loading state</span>
					</div>
				</div>
			</section>

			<section className="showcase-section" aria-labelledby="cards-heading">
				<h2 id="cards-heading">Cards & Content</h2>
				<div className="component-grid">
					<article className="demo-card">
						<header>
							<h3>Project Update</h3>
							<p>Latest milestones achieved this week.</p>
						</header>
						<p>
							The template keeps routing, querying, table primitives, optional
							auth, and a compact Hono API surface.
						</p>
						<footer>
							<button type="button" className="demo-button variant-outline">
								Cancel
							</button>
							<button type="button" className="demo-button primary">
								Deploy
							</button>
						</footer>
					</article>

					<article className="demo-card highlighted">
						<header className="card-header-row">
							<h3>Statistics</h3>
							<span className="demo-badge variant-outline">Live</span>
						</header>
						<div className="metric-row">
							<div>
								<span>Revenue</span>
								<strong>{new Intl.NumberFormat("en-US").format(42800)}</strong>
							</div>
							<div>
								<span>Updated</span>
								<strong>
									{new Intl.DateTimeFormat("en-US", {
										month: "short",
										day: "numeric",
									}).format(new Date("2026-06-13T00:00:00+09:00"))}
								</strong>
							</div>
						</div>
						<button
							type="button"
							className="demo-button secondary full"
							onClick={() => {
								setCopied(true);
								window.setTimeout(() => setCopied(false), 1200);
							}}
						>
							<Copy className="icon" />
							{copied ? "Copied" : "Copy Report"}
						</button>
					</article>

					<article className="demo-card profile-card">
						<header className="profile-header">
							<div className="avatar">TU</div>
							<div>
								<h3>Team Profile</h3>
								<p>@template-team - Verified</p>
							</div>
						</header>
						<ul className="demo-list">
							<li>
								<Mail className="icon" />
								<span>template@example.com</span>
							</li>
							<li>
								<Calendar className="icon" />
								<span>Joined Jun 2026</span>
							</li>
							<li>
								<Star className="icon" />
								<span>Design system maintainer</span>
							</li>
						</ul>
					</article>
				</div>
			</section>
		</>
	);
}
