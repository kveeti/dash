type TransactionCursorKey = {
	left?: string;
	right?: string;
};

type SuggestionPageCursorKey = {
	beforeDate?: string;
	beforeId?: string;
};

export type TransactionFilters = {
	category_id?: string;
	account_id?: string;
	currency?: string;
	uncategorized?: boolean;
};

export const queryKeyRoots = {
	auth: ["auth"] as const,
	accounts: ["accounts"] as const,
	categories: ["categories"] as const,
	transactions: ["transactions"] as const,
	transaction: ["transaction"] as const,
	transactionFlows: ["transaction-flows"] as const,
	transactionLinkSuggestions: ["transaction-link-suggestions"] as const,
	stats: ["stats"] as const,
	settings: ["settings"] as const,
	fxRates: ["fx-rates"] as const,
	sync: ["sync"] as const,
};

export const queryKeys = {
	auth: () => queryKeyRoots.auth,
	accounts: () => queryKeyRoots.accounts,
	categories: (search?: string) => [...queryKeyRoots.categories, search] as const,
	transactions: (search: string | undefined, filters?: TransactionFilters, cursor?: TransactionCursorKey) =>
		[
			...queryKeyRoots.transactions,
			search,
			filters?.category_id,
			filters?.account_id,
			filters?.currency,
			filters?.uncategorized,
			cursor?.left,
			cursor?.right,
		] as const,
	transaction: (id?: string) => [...queryKeyRoots.transaction, id] as const,
	transactionFlows: (id?: string) => [...queryKeyRoots.transactionFlows, id] as const,
	transactionLinkSuggestions: (id?: string) =>
		[...queryKeyRoots.transactionLinkSuggestions, id] as const,
	transactionLinkSuggestionsPage: (cursor?: SuggestionPageCursorKey) =>
		[
			...queryKeyRoots.transactionLinkSuggestions,
			"page",
			cursor?.beforeDate,
			cursor?.beforeId,
		] as const,
	settings: () => queryKeyRoots.settings,
	fxRates: () => [...queryKeyRoots.fxRates] as const,
	syncPull: (canSync: boolean, salt?: string) =>
		[...queryKeyRoots.sync, "pull", canSync, salt] as const,
	syncPush: (pullReady: boolean) =>
		[...queryKeyRoots.sync, "push", pullReady] as const,
};
