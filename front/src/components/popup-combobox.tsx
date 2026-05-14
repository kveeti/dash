import { Combobox } from "@base-ui/react/combobox";
import type { KeyboardEvent, ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
import { IconCheck } from "./icons/check";
import { IconChevronsUpDown } from "./icons/chevrons-up-down";

type PopupComboboxSize = "sm" | "default";

type PopupComboboxCreatable<TItem> = {
	createItem: (query: string) => TItem;
	isCreateItem: (item: TItem) => boolean;
	isExistingItemMatch: (item: TItem, normalizedQuery: string) => boolean;
	onCreateRequest: (query: string) => void | Promise<void>;
	getCreateQuery?: (item: TItem) => string;
};

type PopupComboboxCommonProps<TItem> = {
	items: TItem[];
	onInputValueChange?: (value: string) => void;
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
	children?: ReactNode;
};

type PopupComboboxSingleProps<TItem> = PopupComboboxCommonProps<TItem> & {
	multiple?: false;
	value: TItem | null;
	onValueChange: (value: TItem | null) => void;
};

type PopupComboboxMultipleProps<TItem> = PopupComboboxCommonProps<TItem> & {
	multiple: true;
	value: TItem[];
	onValueChange: (value: TItem[]) => void;
};

type PopupComboboxProps<TItem> =
	| PopupComboboxSingleProps<TItem>
	| PopupComboboxMultipleProps<TItem>;

function getComboboxClasses(size: PopupComboboxSize) {
	return {
		trigger:
			size === "sm"
				? "focus border-gray-6 bg-gray-1 h-8 border pl-2.5 pr-2 text-sm"
				: "focus border-gray-6 bg-gray-1 h-10 border pl-3 pr-2.5 text-sm",
		input:
			size === "sm"
				? "bg-gray-1 h-8 w-full border-b border-gray-a3 px-2 text-sm outline-none"
				: "bg-gray-1 h-10 w-full border-b border-gray-a3 px-3 text-sm outline-none",
		item:
			"data-[highlighted]:bg-gray-a3 flex min-h-8 cursor-default items-center px-2 py-1 text-sm outline-none select-none",
	};
}

export function PopupComboboxTrigger<TValue>({
	children,
	className,
	nativeButton = true,
	size = "default",
}: {
	children: (value: TValue) => ReactNode;
	className?: string;
	nativeButton?: boolean;
	size?: PopupComboboxSize;
}) {
	const triggerClass = getComboboxClasses(size).trigger;

	return (
		<Combobox.Trigger
			nativeButton={nativeButton}
			render={nativeButton ? undefined : <div />}
			className={
				"data-[popup-open]:bg-gray-a2 data-[disabled]:opacity-60 " +
				triggerClass +
				(className ? ` ${className}` : "")
			}
		>
			<Combobox.Value>{(value: TValue) => children(value)}</Combobox.Value>
		</Combobox.Trigger>
	);
}

function DefaultSingleComboboxTrigger<TItem>({
	className,
	itemToStringLabel,
	placeholder,
	size,
}: {
	className?: string;
	itemToStringLabel: (item: TItem) => string;
	placeholder: string;
	size: PopupComboboxSize;
}) {
	return (
		<PopupComboboxTrigger<TItem | null>
			size={size}
			className={
				"flex w-full min-w-0 items-center justify-between gap-2 overflow-hidden " +
				(className ? ` ${className}` : "")
			}
		>
			{(value) => (
				<>
					<span className="truncate [[data-placeholder]_&]:text-gray-10">
						{value ? itemToStringLabel(value) : placeholder}
					</span>
					<Combobox.Icon className="text-gray-10 flex shrink-0">
						<IconChevronsUpDown />
					</Combobox.Icon>
				</>
			)}
		</PopupComboboxTrigger>
	);
}

function DefaultMultipleComboboxTrigger<TItem>({
	className,
	itemToStringLabel,
	placeholder,
	size,
}: {
	className?: string;
	itemToStringLabel: (item: TItem) => string;
	placeholder: string;
	size: PopupComboboxSize;
}) {
	return (
		<PopupComboboxTrigger<TItem[]>
			size={size}
			className={
				"flex w-full min-w-0 items-center justify-between gap-2 overflow-hidden " +
				(className ? ` ${className}` : "")
			}
		>
			{(value) => (
				<>
					<span className="truncate [[data-placeholder]_&]:text-gray-10">
						{value.length
							? value.map((item) => itemToStringLabel(item)).join(", ")
							: placeholder}
					</span>
					<Combobox.Icon className="text-gray-10 flex shrink-0">
						<IconChevronsUpDown />
					</Combobox.Icon>
				</>
			)}
		</PopupComboboxTrigger>
	);
}

function PopupComboboxPopup<TItem>({
	creatable,
	emptyState,
	getItemKey,
	inputClass,
	inputPlaceholder,
	itemClass,
	onInputKeyDown,
	renderItem,
	showItemIndicator,
}: {
	creatable?: PopupComboboxCreatable<TItem>;
	emptyState?: ReactNode;
	getItemKey: (item: TItem) => string;
	inputClass: string;
	inputPlaceholder: string;
	itemClass: string;
	onInputKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
	renderItem: (item: TItem) => ReactNode;
	showItemIndicator: boolean;
}) {
	return (
		<Combobox.Portal>
			<Combobox.Positioner className="z-50" sideOffset={4}>
				<Combobox.Popup
					className={
						"bg-gray-1 border-gray-a3 w-[var(--anchor-width)] max-h-[20rem] border shadow-lg " +
						"duration-80 ease-[cubic-bezier(0.43,0.07,0.59,0.94)] origin-[var(--transform-origin)] transition-[transform,scale,opacity] data-[ending-style]:scale-99 data-[ending-style]:opacity-0 data-[starting-style]:scale-99 data-[starting-style]:opacity-0"
					}
				>
					<Combobox.Input
						className={inputClass}
						placeholder={inputPlaceholder}
						autoComplete="off"
						onKeyDown={onInputKeyDown}
					/>
					{emptyState && <Combobox.Empty>{emptyState}</Combobox.Empty>}
					<Combobox.List className="m-0 max-h-[14rem] overflow-y-auto p-0">
						{(item: TItem) => (
							<Combobox.Item
								key={getItemKey(item)}
								value={item}
								className={itemClass}
							>
								{showItemIndicator && !creatable?.isCreateItem(item) && (
									<Combobox.ItemIndicator
										keepMounted
										className="mr-2 flex size-4 shrink-0 items-center justify-center text-gray-11 opacity-0 data-[selected]:opacity-100"
									>
										<IconCheck />
									</Combobox.ItemIndicator>
								)}
								<div className="min-w-0 flex-1">{renderItem(item)}</div>
							</Combobox.Item>
						)}
					</Combobox.List>
				</Combobox.Popup>
			</Combobox.Positioner>
		</Combobox.Portal>
	);
}

export function PopupCombobox<TItem>(props: PopupComboboxProps<TItem>) {
	const {
		items,
		onInputValueChange,
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
		children,
	} = props;
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
	const classes = getComboboxClasses(size);

	const handleCreateCandidate = (candidate: TItem) => {
		if (!creatable?.isCreateItem(candidate)) return false;
		const createQuery = creatable.getCreateQuery?.(candidate) ?? trimmedQuery;
		if (createQuery) {
			creatable.onCreateRequest(createQuery);
			return true;
		}
		return false;
	};

	const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key !== "Enter" || !creatable) return;
		if (highlightedItemRef.current) return;
		if (!trimmedQuery) return;

		const hasExactMatch = items.some((item) =>
			creatable.isExistingItemMatch(item, normalizedQuery),
		);
		if (hasExactMatch) return;

		event.preventDefault();
		creatable.onCreateRequest(trimmedQuery);
	};

	const handleInputValueChange = (nextValue: string) => {
		setQuery(nextValue);
		onInputValueChange?.(nextValue);
	};

	const handleItemHighlighted = (item: TItem | undefined) => {
		highlightedItemRef.current = item;
	};

	const rootProps = {
		items: itemsForView,
		name,
		required,
		disabled,
		autoHighlight,
		onInputValueChange: handleInputValueChange,
		onItemHighlighted: handleItemHighlighted,
		isItemEqualToValue,
		itemToStringLabel,
	};
	const popupProps = {
		creatable,
		emptyState,
		getItemKey,
		inputClass: classes.input,
		inputPlaceholder,
		itemClass: classes.item,
		onInputKeyDown: handleInputKeyDown,
		renderItem,
	};

	if (props.multiple) {
		return (
			<Combobox.Root<TItem, true>
				{...rootProps}
				multiple
				value={props.value}
				onValueChange={(next) => {
					const createCandidate = next.find((item) =>
						creatable?.isCreateItem(item),
					);
					if (createCandidate && handleCreateCandidate(createCandidate)) return;
					props.onValueChange(next);
				}}
			>
				{children ?? (
					<DefaultMultipleComboboxTrigger
						className={className}
						itemToStringLabel={itemToStringLabel}
						placeholder={placeholder}
						size={size}
					/>
				)}
				<PopupComboboxPopup {...popupProps} showItemIndicator />
			</Combobox.Root>
		);
	}

	return (
		<Combobox.Root
			{...rootProps}
			value={props.value}
			onValueChange={(next) => {
				if (!next) {
					props.onValueChange(null);
					return;
				}

				if (creatable && creatable.isCreateItem(next)) {
					const createQuery = creatable.getCreateQuery?.(next) ?? trimmedQuery;
					if (createQuery) {
						creatable.onCreateRequest(createQuery);
						return;
					}
				}

				props.onValueChange(next);
			}}
		>
			{children ?? (
				<DefaultSingleComboboxTrigger
					className={className}
					itemToStringLabel={itemToStringLabel}
					placeholder={placeholder}
					size={size}
				/>
			)}
			<PopupComboboxPopup {...popupProps} showItemIndicator={false} />
		</Combobox.Root>
	);
}
