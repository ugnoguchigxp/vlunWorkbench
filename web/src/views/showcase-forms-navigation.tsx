import { Link } from "@tanstack/react-router";
import { ChevronDown, Grid2X2, List, Mail, Search } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { defaultShowcaseTableSearch } from "../showcase-table-search";

type ShowcaseFormsNavigationProps = {
	selectedFramework: string;
	setSelectedFramework: Dispatch<SetStateAction<string>>;
	notificationsEnabled: boolean;
	setNotificationsEnabled: Dispatch<SetStateAction<boolean>>;
	acceptedTerms: boolean;
	setAcceptedTerms: Dispatch<SetStateAction<boolean>>;
	selectedPlan: string;
	setSelectedPlan: Dispatch<SetStateAction<string>>;
	activeTab: "account" | "password" | "settings";
	setActiveTab: Dispatch<SetStateAction<"account" | "password" | "settings">>;
	openAccordion: string;
	setOpenAccordion: Dispatch<SetStateAction<string>>;
	menuOpen: boolean;
	setMenuOpen: Dispatch<SetStateAction<boolean>>;
	activePage: number;
	setActivePage: Dispatch<SetStateAction<number>>;
	activeView: "grid" | "list";
	setActiveView: Dispatch<SetStateAction<"grid" | "list">>;
};

export function ShowcaseFormsNavigation(props: ShowcaseFormsNavigationProps) {
	const {
		selectedFramework,
		setSelectedFramework,
		notificationsEnabled,
		setNotificationsEnabled,
		acceptedTerms,
		setAcceptedTerms,
		selectedPlan,
		setSelectedPlan,
		activeTab,
		setActiveTab,
		openAccordion,
		setOpenAccordion,
		menuOpen,
		setMenuOpen,
		activePage,
		setActivePage,
		activeView,
		setActiveView,
	} = props;
	return (
		<>
			<section className="showcase-section" aria-labelledby="forms-heading">
				<h2 id="forms-heading">Forms & Selection</h2>
				<div className="demo-card form-card">
					<div className="form-column">
						<label htmlFor="showcase-email">Email Address</label>
						<div className="input-group">
							<Mail className="icon" />
							<input
								id="showcase-email"
								placeholder="name@example.com"
								type="email"
							/>
						</div>

						<label htmlFor="showcase-framework">Framework</label>
						<select
							id="showcase-framework"
							className="demo-input"
							value={selectedFramework}
							onChange={(event) => setSelectedFramework(event.target.value)}
						>
							<option>React</option>
							<option>SvelteKit</option>
							<option>Astro</option>
							<option>Remix</option>
						</select>

						<label htmlFor="showcase-search">Searchable Select</label>
						<div className="input-group">
							<Search className="icon" />
							<input id="showcase-search" defaultValue={selectedFramework} />
							<ChevronDown className="icon" />
						</div>

						<label htmlFor="showcase-notes">Textarea</label>
						<textarea
							id="showcase-notes"
							className="demo-textarea"
							defaultValue="Reusable form controls with compact spacing."
						/>
					</div>
					<div className="switch-column">
						<label className="switch-row">
							<input
								type="checkbox"
								checked={acceptedTerms}
								onChange={(event) => setAcceptedTerms(event.target.checked)}
							/>
							<span>Checkbox</span>
						</label>
						<label className="switch-row">
							<input
								type="checkbox"
								checked={notificationsEnabled}
								onChange={(event) =>
									setNotificationsEnabled(event.target.checked)
								}
							/>
							<span>Switch</span>
						</label>
						<fieldset className="radio-group">
							<legend>Radio Group</legend>
							<label>
								<input
									type="radio"
									name="plan"
									value="starter"
									checked={selectedPlan === "starter"}
									onChange={(event) => setSelectedPlan(event.target.value)}
								/>
								<span>Starter</span>
							</label>
							<label>
								<input
									type="radio"
									name="plan"
									value="team"
									checked={selectedPlan === "team"}
									onChange={(event) => setSelectedPlan(event.target.value)}
								/>
								<span>Team</span>
							</label>
							<label>
								<input
									type="radio"
									name="plan"
									value="enterprise"
									checked={selectedPlan === "enterprise"}
									onChange={(event) => setSelectedPlan(event.target.value)}
								/>
								<span>Enterprise</span>
							</label>
						</fieldset>
						<fieldset className="otp-row">
							<legend className="sr-only">One-time passcode</legend>
							<input
								aria-label="Digit 1"
								defaultValue="2"
								inputMode="numeric"
							/>
							<input
								aria-label="Digit 2"
								defaultValue="4"
								inputMode="numeric"
							/>
							<input
								aria-label="Digit 3"
								defaultValue="8"
								inputMode="numeric"
							/>
							<input
								aria-label="Digit 4"
								defaultValue="6"
								inputMode="numeric"
							/>
						</fieldset>
						<div className="scale-input">
							<label htmlFor="showcase-scale">Scale Input</label>
							<input id="showcase-scale" type="range" min="0" max="100" />
						</div>
					</div>
				</div>
			</section>

			<section className="showcase-section" aria-labelledby="nav-heading">
				<h2 id="nav-heading">Navigation & Disclosure</h2>
				<nav className="breadcrumb" aria-label="Breadcrumb">
					<Link to="/">Home</Link>
					<span>/</span>
					<Link to="/showcase" search={defaultShowcaseTableSearch}>
						Showcase
					</Link>
					<span>/</span>
					<strong>Components</strong>
				</nav>
				<div className="nav-layout-grid">
					<div className="tabs-card">
						<div className="tabs-list" role="tablist" aria-label="Example tabs">
							<button
								type="button"
								role="tab"
								className={activeTab === "account" ? "active" : ""}
								aria-selected={activeTab === "account"}
								onClick={() => setActiveTab("account")}
							>
								Account
							</button>
							<button
								type="button"
								role="tab"
								className={activeTab === "password" ? "active" : ""}
								aria-selected={activeTab === "password"}
								onClick={() => setActiveTab("password")}
							>
								Password
							</button>
							<button
								type="button"
								role="tab"
								className={activeTab === "settings" ? "active" : ""}
								aria-selected={activeTab === "settings"}
								onClick={() => setActiveTab("settings")}
							>
								Settings
							</button>
						</div>
						<div className="tab-content">
							{activeTab === "account" ? (
								<>
									<h3>Account Information</h3>
									<input className="demo-input" defaultValue="Template User" />
									<input className="demo-input" defaultValue="@template-user" />
								</>
							) : null}
							{activeTab === "password" ? (
								<>
									<h3>Password Security</h3>
									<input className="demo-input" type="password" />
									<input className="demo-input" type="password" />
								</>
							) : null}
							{activeTab === "settings" ? (
								<>
									<h3>Global Settings</h3>
									<label className="switch-row split">
										<span>Public Profile</span>
										<input type="checkbox" />
									</label>
								</>
							) : null}
						</div>
					</div>

					<div className="disclosure-stack">
						{["tokens", "layout", "forms"].map((item) => (
							<div className="accordion-item" key={item}>
								<button
									type="button"
									aria-expanded={openAccordion === item}
									onClick={() =>
										setOpenAccordion(openAccordion === item ? "" : item)
									}
								>
									<span>{getAccordionLabel(item)}</span>
									<ChevronDown className="icon" />
								</button>
								{openAccordion === item ? (
									<p>{getAccordionContent(item)}</p>
								) : null}
							</div>
						))}
					</div>
				</div>
				<div className="toolbar-row">
					<div className="menu-wrap">
						<button
							type="button"
							className="demo-button variant-outline"
							aria-expanded={menuOpen}
							onClick={() => setMenuOpen((value) => !value)}
						>
							Menu
							<ChevronDown className="icon" />
						</button>
						{menuOpen ? (
							<div className="dropdown-panel">
								<button type="button">Edit</button>
								<button type="button">Duplicate</button>
								<button type="button">Archive</button>
							</div>
						) : null}
					</div>
					<fieldset className="view-switcher">
						<legend className="sr-only">View switcher</legend>
						<button
							type="button"
							className={activeView === "grid" ? "active" : ""}
							aria-pressed={activeView === "grid"}
							onClick={() => setActiveView("grid")}
						>
							<Grid2X2 className="icon" />
						</button>
						<button
							type="button"
							className={activeView === "list" ? "active" : ""}
							aria-pressed={activeView === "list"}
							onClick={() => setActiveView("list")}
						>
							<List className="icon" />
						</button>
					</fieldset>
					<nav className="pagination-row" aria-label="Pagination">
						{[1, 2, 3, 4].map((page) => (
							<button
								type="button"
								key={page}
								className={activePage === page ? "active" : ""}
								onClick={() => setActivePage(page)}
							>
								{page}
							</button>
						))}
					</nav>
				</div>
			</section>
		</>
	);
}

function getAccordionLabel(item: string) {
	if (item === "tokens") {
		return "Design Tokens";
	}
	if (item === "layout") {
		return "Layout";
	}
	return "Forms";
}

function getAccordionContent(item: string) {
	if (item === "tokens") {
		return "Color, radius, spacing, and typography primitives.";
	}
	if (item === "layout") {
		return "Cards, panels, sections, and dense application surfaces.";
	}
	return "Fields, selection controls, and validation states.";
}
