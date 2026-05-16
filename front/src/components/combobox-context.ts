import { createContext, useContext } from "react";

export type ComboboxValue<TItem, TMultiple extends boolean | undefined> =
	TMultiple extends true ? TItem[] : TItem | null;

export type ComboboxCreateItemContext<TItem> = {
	items: readonly TItem[];
	inputValue: string;
	trimmedInputValue: string;
	normalizedInputValue: string;
};

export type ComboboxCreateRequestDetails<TItem> =
	ComboboxCreateItemContext<TItem> & {
		item: TItem | null;
		source: "input" | "item";
	};

export type ComboboxCreateConfig<TItem> = {
	getItem: (context: ComboboxCreateItemContext<TItem>) => TItem | null;
	isItem: (item: TItem) => boolean;
	onRequest: (
		query: string,
		details: ComboboxCreateRequestDetails<TItem>,
	) => void | Promise<void>;
	getQuery?: (
		item: TItem,
		context: ComboboxCreateItemContext<TItem>,
	) => string;
	normalizeInputValue?: (inputValue: string) => string;
};

export type ComboboxContextValue<TItem, TValue> =
	ComboboxCreateItemContext<TItem> & {
		createItem: TItem | null;
		highlightedItem: TItem | undefined;
		isCreateItem: (item: TItem) => boolean;
		open: boolean;
		requestCreate: (
			source: ComboboxCreateRequestDetails<TItem>["source"],
			item?: TItem | null,
		) => boolean;
		value: TValue;
	};

export const ComboboxContext =
	createContext<ComboboxContextValue<unknown, unknown> | null>(null);

export function useCombobox<TItem, TValue = TItem | TItem[] | null>() {
	const context = useContext(ComboboxContext);
	if (!context) {
		throw new Error("useCombobox must be used within Combobox.Root");
	}

	return context as ComboboxContextValue<TItem, TValue>;
}

export function useOptionalCombobox<
	TItem,
	TValue = TItem | TItem[] | null,
>() {
	return useContext(ComboboxContext) as ComboboxContextValue<
		TItem,
		TValue
	> | null;
}
