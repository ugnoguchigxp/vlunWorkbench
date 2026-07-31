export type ShowcaseRow = {
	component: string;
	category: string;
	status: string;
};

export const visibleComponents = [
	"Button",
	"IconButton",
	"Badge",
	"Alert",
	"NotificationToast",
	"Card",
	"Avatar",
	"Input",
	"InputGroup",
	"InputOtp",
	"Textarea",
	"Select",
	"Combobox",
	"Checkbox",
	"RadioGroup",
	"Switch",
	"Tabs",
	"Breadcrumb",
	"Accordion",
	"DropdownMenu",
	"Pagination",
	"ViewSwitcher",
	"Dialog",
	"Drawer",
	"Popover",
	"Tooltip",
	"Progress",
	"Skeleton",
	"Spinner",
	"Table",
	"MiniTable",
	"List",
	"FileTree",
	"DateFormat",
	"NumberFormat",
] as const;

export function getComponentCategory(component: string) {
	if (
		[
			"Button",
			"IconButton",
			"Badge",
			"Alert",
			"NotificationToast",
			"Progress",
			"Skeleton",
			"Spinner",
		].includes(component)
	) {
		return "Actions & Feedback";
	}
	if (
		[
			"Input",
			"InputGroup",
			"InputOtp",
			"Textarea",
			"Select",
			"Combobox",
			"Checkbox",
			"RadioGroup",
			"Switch",
		].includes(component)
	) {
		return "Forms";
	}
	if (
		[
			"Tabs",
			"Breadcrumb",
			"Accordion",
			"DropdownMenu",
			"Pagination",
			"ViewSwitcher",
		].includes(component)
	) {
		return "Navigation";
	}
	if (["Dialog", "Drawer", "Popover", "Tooltip"].includes(component)) {
		return "Overlays";
	}
	if (["Table", "MiniTable", "List", "FileTree"].includes(component)) {
		return "Data Display";
	}
	return "Content";
}

export function getComponentStatus(component: string) {
	const category = getComponentCategory(component);
	if (category === "Navigation" || category === "Overlays") {
		return "Interactive";
	}
	if (category === "Actions & Feedback" || category === "Forms") {
		return "Ready";
	}
	return "Documented";
}
