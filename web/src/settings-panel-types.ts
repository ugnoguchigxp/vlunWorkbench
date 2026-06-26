export type AppHealth = {
	status: string;
	service: string;
};

export type SourceHealth = {
	service: string;
	git: {
		branch: string;
		commit: string;
	} | null;
};
