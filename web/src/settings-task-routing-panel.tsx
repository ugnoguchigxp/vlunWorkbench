import { ArrowDown, ArrowUp, Plus, Save, X } from "lucide-react";
import type { LlmThinkingDepth } from "./api";
import { Button, SelectInput } from "./ui";
import {
	ensureRoutes,
	fallbackKey,
	isThinkingModel,
	parseTargetKey,
	targetKey,
	taskLabels,
	thinkingDepthOptions,
	withThinkingDepth,
} from "./settings-panel-model";
import type { SettingsPanelModel } from "./settings-panel";

export function TaskRoutingPanel({ model }: { model: SettingsPanelModel }) {
	const {
		llmSettings,
		targetOptions,
		validationErrors,
		updateRoute,
		addFallback,
		updateFallback,
		moveFallback,
		handleSaveLlmSettings,
		llmSaveDisabled,
	} = model;
	return (
		// biome-ignore lint/complexity/noUselessFragments: Keeps the routing section isolated for future sibling panels.
		<>
			<section className="panel">
				<div className="panel-header">
					<h2>Task Routing</h2>
					<div className="actions">
						<Button
							type="button"
							variant="primary"
							onClick={() => void handleSaveLlmSettings()}
							disabled={llmSaveDisabled}
						>
							<Save className="icon" />
							<span>Save</span>
						</Button>
					</div>
				</div>
				<div className="route-card-list">
					{ensureRoutes(llmSettings?.taskRoutes ?? []).map((route) => (
						<div className="route-card" key={route.task}>
							<div className="route-card-header">
								<div>
									<div className="route-task">{taskLabels[route.task]}</div>
									<small>{route.task}</small>
								</div>
								<div className="actions">
									<Button
										type="button"
										onClick={() => addFallback(route)}
										disabled={targetOptions.length === 0}
									>
										<Plus className="icon" />
										<span>Fallback</span>
									</Button>
								</div>
							</div>
							<div className="route-target-grid">
								<div className="settings-form-field">
									<label htmlFor={`${route.task}-primary`}>Primary Model</label>
									<SelectInput
										id={`${route.task}-primary`}
										value={targetKey(route.primaryTarget)}
										onChange={(event) =>
											updateRoute(route.task, {
												primaryTarget: withThinkingDepth(
													parseTargetKey(event.target.value),
													route.primaryTarget?.thinkingDepth ?? "",
												),
											})
										}
									>
										<option value="">No primary</option>
										{targetOptions.map((option) => (
											<option key={option.key} value={option.key}>
												{option.enabled ? "" : "[disabled] "}
												{option.label}
											</option>
										))}
									</SelectInput>
								</div>
								{route.primaryTarget &&
								isThinkingModel(route.primaryTarget.model) ? (
									<div className="settings-form-field">
										<label htmlFor={`${route.task}-primary-thinking`}>
											Thinking
										</label>
										<SelectInput
											id={`${route.task}-primary-thinking`}
											value={route.primaryTarget.thinkingDepth ?? ""}
											onChange={(event) =>
												updateRoute(route.task, {
													primaryTarget: withThinkingDepth(
														route.primaryTarget ?? null,
														event.target.value as "" | LlmThinkingDepth,
													),
												})
											}
										>
											{thinkingDepthOptions.map((option) => (
												<option
													key={option.value || "auto"}
													value={option.value}
												>
													{option.label}
												</option>
											))}
										</SelectInput>
									</div>
								) : null}
							</div>
							{route.fallbackTargets.length > 0 ? (
								<div className="fallback-list">
									{route.fallbackTargets.map((fallback, index) => (
										<div
											className="fallback-row"
											key={fallbackKey(route, fallback, index)}
										>
											<div className="settings-form-field">
												<label htmlFor={`${route.task}-fallback-${index}`}>
													Fallback {index + 1}
												</label>
												<SelectInput
													id={`${route.task}-fallback-${index}`}
													value={targetKey(fallback)}
													onChange={(event) =>
														updateFallback(
															route,
															index,
															withThinkingDepth(
																parseTargetKey(event.target.value),
																fallback.thinkingDepth ?? "",
															),
														)
													}
												>
													<option value="">Remove fallback</option>
													{targetOptions.map((option) => (
														<option key={option.key} value={option.key}>
															{option.enabled ? "" : "[disabled] "}
															{option.label}
														</option>
													))}
												</SelectInput>
											</div>
											{isThinkingModel(fallback.model) ? (
												<div className="settings-form-field">
													<label
														htmlFor={`${route.task}-fallback-${index}-thinking`}
													>
														Thinking
													</label>
													<SelectInput
														id={`${route.task}-fallback-${index}-thinking`}
														value={fallback.thinkingDepth ?? ""}
														onChange={(event) =>
															updateFallback(
																route,
																index,
																withThinkingDepth(
																	fallback,
																	event.target.value as "" | LlmThinkingDepth,
																),
															)
														}
													>
														{thinkingDepthOptions.map((option) => (
															<option
																key={option.value || "auto"}
																value={option.value}
															>
																{option.label}
															</option>
														))}
													</SelectInput>
												</div>
											) : null}
											<div className="route-icon-actions">
												<Button
													type="button"
													onClick={() => moveFallback(route, index, -1)}
													disabled={index === 0}
												>
													<ArrowUp className="icon" />
												</Button>
												<Button
													type="button"
													onClick={() => moveFallback(route, index, 1)}
													disabled={index === route.fallbackTargets.length - 1}
												>
													<ArrowDown className="icon" />
												</Button>
												<Button
													type="button"
													variant="destructive"
													onClick={() => updateFallback(route, index, null)}
												>
													<X className="icon" />
												</Button>
											</div>
										</div>
									))}
								</div>
							) : null}
						</div>
					))}
				</div>
				{validationErrors.length > 0 ? (
					<div className="settings-validation">
						{validationErrors.map((error) => (
							<div key={error}>{error}</div>
						))}
					</div>
				) : null}
			</section>
		</>
	);
}
