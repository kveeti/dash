import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { ScrollArea } from "@base-ui/react/scroll-area";
import type {
	ComboboxRootChangeEventDetails,
	ComboboxRootHighlightEventDetails,
	ComboboxRootProps,
} from "@base-ui/react/combobox";
import {
	type ComponentPropsWithoutRef,
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	ComboboxContext,
	type ComboboxContextValue,
	type ComboboxCreateConfig,
	type ComboboxCreateItemContext,
	type ComboboxValue,
	useCombobox,
	useOptionalCombobox,
} from "./combobox-context";

type ComboboxSize = "sm" | "default";
const MOBILE_COMBOBOX_QUERY = "(max-width: 640px)";
const MOBILE_SELECTION_CLOSE_DELAY_MS = 160;

function cx(...classes: Array<string | false | null | undefined>) {
	return classes.filter(Boolean).join(" ");
}

function shouldDelayMobileSelectionClose() {
	return (
		typeof window !== "undefined" &&
		window.matchMedia(MOBILE_COMBOBOX_QUERY).matches
	);
}

function getInputClass(size: ComboboxSize) {
	return cx(
		"bg-gray-1 w-full border-b border-gray-a3 outline-none max-sm:bg-white dark:max-sm:bg-gray-2",
		size === "sm" ? "h-8 px-2 text-sm" : "h-10 px-3 text-sm",
	);
}

function getItemClass(size: ComboboxSize) {
	return cx(
		"data-[highlighted]:bg-gray-a3 hover:bg-gray-a3 flex cursor-default items-center outline-none select-none",
		size === "sm" ? "min-h-8 px-2 py-1 text-sm" : "min-h-8 px-2 py-1 text-sm",
	);
}

type BaseRootProps<
	TItem,
	TMultiple extends boolean | undefined,
> = Omit<
	ComboboxRootProps<TItem, TMultiple>,
	| "children"
	| "defaultValue"
	| "items"
	| "multiple"
	| "onInputValueChange"
	| "onItemHighlighted"
	| "onValueChange"
	| "value"
>;

type RootChildren<TItem, TMultiple extends boolean | undefined> =
	| ReactNode
	| ((
			context: ComboboxContextValue<TItem, ComboboxValue<TItem, TMultiple>>,
	  ) => ReactNode);

type RootCommonProps<
	TItem,
	TMultiple extends boolean | undefined,
> = BaseRootProps<TItem, TMultiple> & {
	children: RootChildren<TItem, TMultiple>;
	create?: ComboboxCreateConfig<TItem>;
	items: TItem[];
	onInputValueChange?: (
		inputValue: string,
		eventDetails: ComboboxRootChangeEventDetails,
	) => void;
	onItemHighlighted?: (
		highlightedValue: TItem | undefined,
		eventDetails: ComboboxRootHighlightEventDetails,
	) => void;
};

export type SingleRootProps<TItem> = RootCommonProps<TItem, false> & {
	multiple?: false;
	onValueChange: (
		value: TItem | null,
		eventDetails: ComboboxRootChangeEventDetails,
	) => void;
	value: TItem | null;
};

export type MultipleRootProps<TItem> = RootCommonProps<TItem, true> & {
	multiple: true;
	onValueChange: (
		value: TItem[],
		eventDetails: ComboboxRootChangeEventDetails,
	) => void;
	value: TItem[];
};

export type RootProps<TItem> =
	| SingleRootProps<TItem>
	| MultipleRootProps<TItem>;

function renderRootChildren<TItem, TMultiple extends boolean | undefined>(
	children: RootChildren<TItem, TMultiple>,
	context: ComboboxContextValue<TItem, ComboboxValue<TItem, TMultiple>>,
) {
	if (typeof children === "function") return children(context);
	return children;
}

export function Root<TItem>(props: SingleRootProps<TItem>): ReactNode;
export function Root<TItem>(props: MultipleRootProps<TItem>): ReactNode;
export function Root<TItem>(props: RootProps<TItem>) {
	const {
		children,
		create,
		defaultOpen = false,
		items,
		multiple,
		open: openProp,
		onInputValueChange,
		onItemHighlighted,
		onOpenChange,
		onValueChange,
		value,
		...rootProps
	} = props;
	const [inputValue, setInputValue] = useState("");
	const [highlightedItem, setHighlightedItem] = useState<TItem | undefined>();
	const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
	const delayedCloseTimeoutRef = useRef<number | null>(null);
	const open = openProp ?? uncontrolledOpen;

	const trimmedInputValue = inputValue.trim();
	const normalizedInputValue =
		create?.normalizeInputValue?.(trimmedInputValue) ??
		trimmedInputValue.toLocaleLowerCase();
	const createItemContext = useMemo<ComboboxCreateItemContext<TItem>>(
		() => ({
			inputValue,
			items,
			normalizedInputValue,
			trimmedInputValue,
		}),
		[inputValue, items, normalizedInputValue, trimmedInputValue],
	);
	const createItem = useMemo(
		() => create?.getItem(createItemContext) ?? null,
		[create, createItemContext],
	);
	const itemsForView = useMemo(
		() => (createItem ? [...items, createItem] : items),
		[createItem, items],
	);

	const isCreateItem = useCallback(
		(item: TItem) => Boolean(create?.isItem(item)),
		[create],
	);

	const requestCreate = useCallback<
		ComboboxContextValue<TItem, ComboboxValue<TItem, boolean>>["requestCreate"]
	>(
		(source, item = createItem) => {
			if (!create || !item || !create.isItem(item)) return false;

			const query = create.getQuery?.(item, createItemContext) ?? trimmedInputValue;
			if (!query) return false;

			void create.onRequest(query, {
				...createItemContext,
				item,
				source,
			});
			return true;
		},
		[create, createItem, createItemContext, trimmedInputValue],
	);

	const clearDelayedClose = useCallback(() => {
		if (delayedCloseTimeoutRef.current === null) return;

		window.clearTimeout(delayedCloseTimeoutRef.current);
		delayedCloseTimeoutRef.current = null;
	}, []);

	useEffect(() => clearDelayedClose, [clearDelayedClose]);

	const handleInputValueChange = (
		nextInputValue: string,
		eventDetails: ComboboxRootChangeEventDetails,
	) => {
		setInputValue(nextInputValue);
		onInputValueChange?.(nextInputValue, eventDetails);
	};

	const handleItemHighlighted = (
		item: TItem | undefined,
		eventDetails: ComboboxRootHighlightEventDetails,
	) => {
		setHighlightedItem(item);
		onItemHighlighted?.(item, eventDetails);
	};

	const handleOpenChange = (
		nextOpen: boolean,
		eventDetails: ComboboxRootChangeEventDetails,
	) => {
		clearDelayedClose();
		onOpenChange?.(nextOpen, eventDetails);
		if (!eventDetails.isCanceled && openProp === undefined) {
			setUncontrolledOpen(nextOpen);
		}
	};

	const closeAfterSelection = (eventDetails: ComboboxRootChangeEventDetails) => {
		if (eventDetails.reason !== "item-press") return;
		const target = eventDetails.event.target;
		if (
			target instanceof Element &&
			target.closest("[data-combobox-keep-open]")
		) {
			return;
		}

		if (multiple && shouldDelayMobileSelectionClose()) {
			clearDelayedClose();
			delayedCloseTimeoutRef.current = window.setTimeout(() => {
				delayedCloseTimeoutRef.current = null;
				handleOpenChange(false, eventDetails);
			}, MOBILE_SELECTION_CLOSE_DELAY_MS);
			return;
		}

		handleOpenChange(false, eventDetails);
	};

	const context: ComboboxContextValue<TItem, TItem | TItem[] | null> = {
		...createItemContext,
		createItem,
		highlightedItem,
		isCreateItem,
		open,
		requestCreate,
		value,
	};

	return (
		<ComboboxContext.Provider
			value={context as ComboboxContextValue<unknown, unknown>}
		>
			<BaseCombobox.Root<TItem, boolean>
				{...(rootProps as BaseRootProps<TItem, boolean>)}
				multiple={multiple}
				open={open}
				items={itemsForView}
				value={value}
				onInputValueChange={handleInputValueChange}
				onItemHighlighted={handleItemHighlighted}
				onOpenChange={handleOpenChange}
				onValueChange={(nextValue, eventDetails) => {
					if (multiple) {
						const nextItems = nextValue as TItem[];
						const selectedCreateItem = nextItems.find(isCreateItem);
						if (
							selectedCreateItem &&
							requestCreate("item", selectedCreateItem)
						) {
							closeAfterSelection(eventDetails);
							return;
						}

						onValueChange(nextItems, eventDetails);
						closeAfterSelection(eventDetails);
						return;
					}

					const nextItem = nextValue as TItem | null;
					if (nextItem && isCreateItem(nextItem)) {
						if (requestCreate("item", nextItem)) return;
					}

					onValueChange(nextItem, eventDetails);
				}}
			>
				{renderRootChildren(children as RootChildren<TItem, boolean>, context)}
			</BaseCombobox.Root>
		</ComboboxContext.Provider>
	);
}

type TriggerProps<TItem, TValue> = Omit<
	ComponentPropsWithoutRef<typeof BaseCombobox.Trigger>,
	"children"
> & {
	children:
		| ReactNode
		| ((
				context: ComboboxContextValue<TItem, TValue> & { selectedValue: TValue },
		  ) => ReactNode);
};

export function Trigger<
	TItem = unknown,
	TValue = TItem | TItem[] | null,
>({ children, ...props }: TriggerProps<TItem, TValue>) {
	const context = useCombobox<TItem, TValue>();

	if (typeof children !== "function") {
		return <BaseCombobox.Trigger {...props}>{children}</BaseCombobox.Trigger>;
	}

	return (
		<BaseCombobox.Trigger {...props}>
			<BaseCombobox.Value>
				{(selectedValue: TValue) =>
					children({
						...context,
						value: selectedValue,
						selectedValue,
					})
				}
			</BaseCombobox.Value>
		</BaseCombobox.Trigger>
	);
}

export function Input({
	onKeyDown,
	...props
}: ComponentPropsWithoutRef<typeof BaseCombobox.Input>) {
	const context = useOptionalCombobox();

	const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		onKeyDown?.(event);
		if (event.defaultPrevented || event.key !== "Enter") return;
		if (!context?.createItem || context.highlightedItem) return;

		if (context.requestCreate("input")) {
			event.preventDefault();
		}
	};

	return <BaseCombobox.Input {...props} onKeyDown={handleKeyDown} />;
}

type ContentProps<TItem> = Omit<
	ComponentPropsWithoutRef<typeof BaseCombobox.Popup>,
	"children"
> & {
	children: ReactNode;
	empty?: ReactNode | ((context: ComboboxContextValue<TItem, TItem | TItem[] | null>) => ReactNode);
	inputClassName?: string;
	inputProps?: Omit<
		ComponentPropsWithoutRef<typeof BaseCombobox.Input>,
		"className" | "placeholder"
	>;
	positionerClassName?: string;
	positionerProps?: Omit<
		ComponentPropsWithoutRef<typeof BaseCombobox.Positioner>,
		"className"
	>;
	searchPlaceholder?: string;
	size?: ComboboxSize;
};

export function Content<TItem = unknown>({
	children,
	className,
	empty,
	inputClassName,
	inputProps,
	positionerClassName,
	positionerProps,
	searchPlaceholder = "search...",
	size = "default",
	...props
}: ContentProps<TItem>) {
	return (
		<BaseCombobox.Portal>
			<BaseCombobox.Backdrop className="hidden max-sm:fixed max-sm:inset-0 max-sm:block max-sm:bg-transparent max-sm:transition-opacity max-sm:duration-100 max-sm:data-[ending-style]:opacity-0 max-sm:data-[starting-style]:opacity-0" />
			<BaseCombobox.Positioner
				{...positionerProps}
				className={cx(
					"z-50 max-sm:!fixed max-sm:!left-4 max-sm:!right-4 max-sm:!top-[24vh] max-sm:!bottom-auto max-sm:!transform-none",
					positionerClassName,
				)}
				sideOffset={positionerProps?.sideOffset ?? 4}
			>
				<BaseCombobox.Popup
					{...props}
					className={cx(
						"bg-gray-1 border-gray-a3 w-[var(--anchor-width)] max-h-[20rem] origin-[var(--transform-origin)] border shadow-lg will-change-[scale,opacity] max-sm:origin-center",
						"scale-100 opacity-100 transition-[scale,opacity] duration-350 ease-[cubic-bezier(0.16,1,0.3,1)]",
						"data-[starting-style]:scale-[0.99] data-[starting-style]:opacity-0",
						"data-[ending-style]:scale-[0.99] data-[ending-style]:opacity-0",
						"max-sm:duration-300 max-sm:ease-[cubic-bezier(0.4,0,0.2,1)]",
						"max-sm:data-[starting-style]:scale-97 max-sm:data-[ending-style]:scale-97 max-sm:data-[ending-style]:duration-120",
						"motion-reduce:duration-1 motion-reduce:data-[ending-style]:duration-1",
						"max-sm:flex max-sm:max-h-[52vh] max-sm:w-auto max-sm:flex-col max-sm:bg-white max-sm:shadow-2xl dark:max-sm:bg-gray-2",
						className,
					)}
				>
					<Input
						{...inputProps}
						className={cx(getInputClass(size), inputClassName)}
						placeholder={searchPlaceholder}
						autoComplete={inputProps?.autoComplete ?? "off"}
					/>
					{empty && <Empty<TItem>>{empty}</Empty>}
					{children}
				</BaseCombobox.Popup>
			</BaseCombobox.Positioner>
		</BaseCombobox.Portal>
	);
}

type ListProps<TItem> = Omit<
	ComponentPropsWithoutRef<typeof BaseCombobox.List>,
	"children"
> & {
	children?:
		| ReactNode
		| ((
				item: TItem,
				index: number,
				context: ComboboxContextValue<TItem, TItem | TItem[] | null>,
		  ) => ReactNode);
};

export function List<TItem = unknown>({
	children,
	className,
	...props
}: ListProps<TItem>) {
	const context = useCombobox<TItem>();

	return (
		<ScrollArea.Root className="relative max-h-[14rem] min-h-0 overflow-hidden max-sm:max-h-none max-sm:flex-1">
			<ScrollArea.Viewport className="max-h-[inherit] min-h-0 overscroll-contain max-sm:h-full">
				<ScrollArea.Content style={{ minWidth: "100%" }}>
					<BaseCombobox.List
						{...props}
						className={cx("m-0 p-0", className)}
					>
						{typeof children === "function"
							? (item: TItem, index: number) => children(item, index, context)
							: children}
					</BaseCombobox.List>
				</ScrollArea.Content>
			</ScrollArea.Viewport>
			<ScrollArea.Scrollbar className="flex w-1.5 justify-center bg-transparent p-px opacity-0 transition-opacity duration-100 data-[hovering]:opacity-100 data-[scrolling]:opacity-100">
				<ScrollArea.Thumb className="bg-gray-a7 w-1 rounded-full" />
			</ScrollArea.Scrollbar>
		</ScrollArea.Root>
	);
}

type ItemProps<TItem> = Omit<
	ComponentPropsWithoutRef<typeof BaseCombobox.Item>,
	"value"
> & {
	size?: ComboboxSize;
	value: TItem;
};

export function Item<TItem = unknown>({
	children,
	className,
	size = "default",
	value,
	...props
}: ItemProps<TItem>) {
	return (
		<BaseCombobox.Item
			{...props}
			value={value}
			className={cx(getItemClass(size), className)}
		>
			{children}
		</BaseCombobox.Item>
	);
}

type ValueProps<TValue> = Omit<
	ComponentPropsWithoutRef<typeof BaseCombobox.Value>,
	"children"
> & {
	children?: ReactNode | ((selectedValue: TValue) => ReactNode);
};

export function Value<TValue = unknown>({
	children,
	...props
}: ValueProps<TValue>) {
	return <BaseCombobox.Value {...props}>{children}</BaseCombobox.Value>;
}

type EmptyProps<TItem> = Omit<
	ComponentPropsWithoutRef<typeof BaseCombobox.Empty>,
	"children"
> & {
	children?:
		| ReactNode
		| ((
				context: ComboboxContextValue<TItem, TItem | TItem[] | null>,
		  ) => ReactNode);
};

export function Empty<TItem = unknown>({ children, ...props }: EmptyProps<TItem>) {
	const context = useCombobox<TItem>();
	const renderedChildren =
		typeof children === "function" ? children(context) : children;

	return (
		<BaseCombobox.Empty {...props}>
			<div className={cx("text-gray-10 px-3 py-2 text-sm", props.className)}>
				{renderedChildren}
			</div>
		</BaseCombobox.Empty>
	);
}

export function Label(props: ComponentPropsWithoutRef<typeof BaseCombobox.Label>) {
	return <BaseCombobox.Label {...props} />;
}

export function InputGroup(
	props: ComponentPropsWithoutRef<typeof BaseCombobox.InputGroup>,
) {
	return <BaseCombobox.InputGroup {...props} />;
}

export function Status(
	props: ComponentPropsWithoutRef<typeof BaseCombobox.Status>,
) {
	return <BaseCombobox.Status {...props} />;
}

export function Portal(
	props: ComponentPropsWithoutRef<typeof BaseCombobox.Portal>,
) {
	return <BaseCombobox.Portal {...props} />;
}

export function Backdrop(
	props: ComponentPropsWithoutRef<typeof BaseCombobox.Backdrop>,
) {
	return <BaseCombobox.Backdrop {...props} />;
}

export function Positioner(
	props: ComponentPropsWithoutRef<typeof BaseCombobox.Positioner>,
) {
	return <BaseCombobox.Positioner {...props} />;
}

export function Popup(props: ComponentPropsWithoutRef<typeof BaseCombobox.Popup>) {
	return <BaseCombobox.Popup {...props} />;
}

export function Arrow(props: ComponentPropsWithoutRef<typeof BaseCombobox.Arrow>) {
	return <BaseCombobox.Arrow {...props} />;
}

export function Icon(props: ComponentPropsWithoutRef<typeof BaseCombobox.Icon>) {
	return <BaseCombobox.Icon {...props} />;
}

export function Group(props: ComponentPropsWithoutRef<typeof BaseCombobox.Group>) {
	return <BaseCombobox.Group {...props} />;
}

export function GroupLabel(
	props: ComponentPropsWithoutRef<typeof BaseCombobox.GroupLabel>,
) {
	return <BaseCombobox.GroupLabel {...props} />;
}

export function ItemIndicator(
	props: ComponentPropsWithoutRef<typeof BaseCombobox.ItemIndicator>,
) {
	return <BaseCombobox.ItemIndicator {...props} />;
}

export function Chips(props: ComponentPropsWithoutRef<typeof BaseCombobox.Chips>) {
	return <BaseCombobox.Chips {...props} />;
}

export function Chip(props: ComponentPropsWithoutRef<typeof BaseCombobox.Chip>) {
	return <BaseCombobox.Chip {...props} />;
}

export function ChipRemove(
	props: ComponentPropsWithoutRef<typeof BaseCombobox.ChipRemove>,
) {
	return <BaseCombobox.ChipRemove {...props} />;
}

export function Row(props: ComponentPropsWithoutRef<typeof BaseCombobox.Row>) {
	return <BaseCombobox.Row {...props} />;
}

export function Collection(
	props: ComponentPropsWithoutRef<typeof BaseCombobox.Collection>,
) {
	return <BaseCombobox.Collection {...props} />;
}

export function Clear(props: ComponentPropsWithoutRef<typeof BaseCombobox.Clear>) {
	return <BaseCombobox.Clear {...props} />;
}
