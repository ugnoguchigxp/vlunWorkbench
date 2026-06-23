export type Citation = {
	sourceId: string;
	fragmentId: string;
	uri: string;
	category: string;
	title: string;
	heading?: string;
	locator: string;
	score: number;
};

export type RetrievedFragment = {
	id: string;
	sourceId: string;
	sourceUri: string;
	sourceCategory: string;
	locator: string;
	heading: string | null;
	content: string;
	wikiSlug?: string | null;
	wikiApiPath?: string | null;
	wikiRawPath?: string | null;
	vectorScore?: number;
	textScore?: number;
	trigramScore?: number;
	sourceHitCount?: number;
	combinedScore: number;
};
