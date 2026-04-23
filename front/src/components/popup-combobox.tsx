import { Combobox } from "@base-ui/react/combobox";
import type { ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import { IconChevronsUpDown } from "./icons/chevrons-up-down";

type PopupComboboxSize = "sm" | "default";

type PopupComboboxCreatable<TItem> = {
	createItem: (query: string) => TItem;
	isCreateItem: (item: TItem) => boolean;
	isExistingItemMatch: (item: TItem, normalizedQuery: string) => boolean;
	onCreateRequest: (query: string) => void | Promise<void>;
	getCreateQuery?: (item: TItem) => string;
};

export function PopupCombobox<TItem>({
	items,
	value,
	onValueChange,
	getItemKey,
	renderItem,
	itemToStringLabel,
	isItemEqualToValue,
	name,
	required,
	disabled,
	autoHighlight = true,
	placeholder = "select...",
	inputPlaceholder = "search...",
	size = "default",
	className,
	emptyState,
	creatable,
}: {
	items: TItem[];
	value: TItem | null;
	onValueChange: (value: TItem | null) => void;
	getItemKey: (item: TItem) => string;
	renderItem: (item: TItem) => ReactNode;
	itemToStringLabel: (item: TItem) => string;
	isItemEqualToValue: (item: TItem, selected: TItem) => boolean;
	name?: string;
	required?: boolean;
	disabled?: boolean;
	autoHighlight?: boolean;
	placeholder?: string;
	inputPlaceholder?: string;
	size?: PopupComboboxSize;
	className?: string;
	emptyState?: ReactNode;
	creatable?: PopupComboboxCreatable<TItem>;
}) {
	const [query, setQuery] = useState("");
	const highlightedItemRef = useRef<TItem | undefined>(undefined);

	const trimmedQuery = query.trim();
	const normalizedQuery = trimmedQuery.toLocaleLowerCase();

	const itemsForView = useMemo(() => {
		if (!creatable || !trimmedQuery) return items;

		const hasExactMatch = items.some((item) =>
			creatable.isExistingItemMatch(item, normalizedQuery),
		);
		if (hasExactMatch) return items;

		return [...items, creatable.createItem(trimmedQuery)];
	}, [creatable, items, normalizedQuery, trimmedQuery]);

	const baseTriggerClass =
		size === "sm"
			? "focus border-gray-6 bg-gray-1 h-8 border pl-2.5 pr-2 text-sm"
			: "focus border-gray-6 bg-gray-1 h-10 border pl-3 pr-2.5 text-sm";
	const baseInputClass =
		size === "sm"
			? "bg-gray-1 h-8 w-full border-b border-gray-a3 px-2 text-sm outline-none"
			: "bg-gray-1 h-10 w-full border-b border-gray-a3 px-3 text-sm outline-none";
	const baseItemClass =
		"data-[highlighted]:bg-gray-a3 flex min-h-8 cursor-default items-center px-2 py-1 text-sm outline-none select-none";

	return (
		<Combobox.Root
			items={itemsForView}
			value={value}
			name={name}
			required={required}
			disabled={disabled}
			autoHighlight={autoHighlight}
			onValueChange={(next) => {
				if (!next) {
					onValueChange(null);
					return;
				}

				if (creatable && creatable.isCreateItem(next)) {
					const createQuery = creatable.getCreateQuery?.(next) ?? trimmedQuery;
					if (createQuery) {
						creatable.onCreateRequest(createQuery);
						return;
					}
				}

				onValueChange(next);
			}}
			onInputValueChange={(nextValue) => {
				setQuery(nextValue);
			}}
			onItemHighlighted={(item) => {
				highlightedItemRef.current = item;
			}}
			isItemEqualToValue={isItemEqualToValue}
			itemToStringLabel={itemToStringLabel}
		>
			<Combobox.Trigger
				className={
					"flex w-full min-w-0 items-center justify-between gap-2 overflow-hidden data-[popup-open]:bg-gray-a2 data-[disabled]:opacity-60 " +
					baseTriggerClass +
					(className ? ` ${className}` : "")
				}
			>
				<span className="truncate [[data-placeholder]_&]:text-gray-10">
					<Combobox.Value placeholder={placeholder} />
				</span>
				<Combobox.Icon className="text-gray-10 flex shrink-0">
					<IconChevronsUpDown />
				</Combobox.Icon>
			</Combobox.Trigger>

			<Combobox.Portal>
				<Combobox.Positioner className="z-50" sideOffset={4}>
					<Combobox.Popup
						className={
							"bg-gray-1 border-gray-a3 w-[var(--anchor-width)] max-h-[20rem] border shadow-lg " +
							"duration-80 ease-[cubic-bezier(0.43,0.07,0.59,0.94)] origin-[var(--transform-origin)] transition-[transform,scale,opacity] data-[ending-style]:scale-99 data-[ending-style]:opacity-0 data-[starting-style]:scale-99 data-[starting-style]:opacity-0"
						}
					>
						<Combobox.Input
							className={baseInputClass}
							placeholder={inputPlaceholder}
							autoComplete="off"
							onKeyDown={(event) => {
								if (event.key !== "Enter" || !creatable) return;
								if (highlightedItemRef.current) return;
								if (!trimmedQuery) return;

								const hasExactMatch = items.some((item) =>
									creatable.isExistingItemMatch(item, normalizedQuery),
								);
								if (hasExactMatch) return;

								event.preventDefault();
								creatable.onCreateRequest(trimmedQuery);
							}}
						/>
						{emptyState &&
							<Combobox.Empty>
								{emptyState}
							</Combobox.Empty>
						}
						<Combobox.List
							className="m-0 max-h-[14rem] overflow-y-auto p-0"
						>
							{(item: TItem) => (
								<Combobox.Item
									key={getItemKey(item)}
									value={item}
									className={baseItemClass}
								>
									{renderItem(item)}
								</Combobox.Item>
							)}
						</Combobox.List>
					</Combobox.Popup>
				</Combobox.Positioner>
			</Combobox.Portal>
		</Combobox.Root>
	);
}
