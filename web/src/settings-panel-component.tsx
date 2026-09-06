import { useBlocker, useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";
import { isSettingsSectionVisible } from "./settings-navigation-model";
import { useSettingsPanelModel } from "./settings-panel";
import type { SettingsPanelProps } from "./settings-panel-model";
import { SettingsPanelView } from "./settings-panel-view";
import {
	buildSettingsSectionSearch,
	resolveSettingsSection,
} from "./settings-route-search";

export function SettingsPanel(props: SettingsPanelProps) {
	const model = useSettingsPanelModel(props);
	const search = useSearch({ from: "/settings" });
	const navigate = useNavigate({ from: "/settings" });
	const requestedSection = resolveSettingsSection(search);
	const activeSection = isSettingsSectionVisible(
		requestedSection,
		props.isAdmin,
	)
		? requestedSection
		: "overview";
	useEffect(() => {
		if (requestedSection !== activeSection)
			void navigate({
				to: "/settings",
				search: buildSettingsSectionSearch(activeSection),
				replace: true,
			});
	}, [activeSection, navigate, requestedSection]);
	const blocker = useBlocker({
		shouldBlockFn: ({ current, next }) =>
			model.settingsDirty && current.pathname !== next.pathname,
		enableBeforeUnload: model.settingsDirty,
		withResolver: true,
	});
	useEffect(() => {
		if (blocker.status !== "blocked") return;
		if (window.confirm("未保存の変更があります。移動しますか？"))
			blocker.proceed();
		else blocker.reset();
	}, [blocker]);
	useEffect(() => () => props.onDirtyChange(false), [props.onDirtyChange]);
	return (
		<SettingsPanelView
			model={model}
			activeSection={activeSection}
			onSelectSection={(section) =>
				void navigate({
					to: "/settings",
					search: buildSettingsSectionSearch(section),
				})
			}
		/>
	);
}
