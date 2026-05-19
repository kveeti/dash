import * as Ariakit from "@ariakit/react";
import {
	CompositeRenderer,
	type CompositeRendererItemProps,
	type CompositeRendererProps,
} from "@ariakit/react-core/composite/composite-renderer";
import {
	createContext,
	forwardRef,
	useContext,
	useId,
	useMemo,
	type ReactNode,
} from "react";

const SearchableContext = createContext(false);

function cx(...classes: Array<string | false | null | undefined>) {
	return classes.filter(Boolean).join(" ");
}

const menuClass =
	"z-50 min-w-[14rem] max-w-[20rem] max-h-[min(380px,var(--popover-available-height))] overflow-hidden rounded-md border border-gray-a3 bg-gray-2 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.18),0_2px_6px_-2px_rgba(0,0,0,0.06)] dark:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6),0_2px_6px_-2px_rgba(0,0,0,0.4)] outline-none flex flex-col";

const rootMenuAnimationClass =
	"dash-root-menu origin-[var(--popover-transform-origin)] will-change-[transform,opacity]";

const itemClass =
	"flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-[12px] text-gray-12 cursor-default outline-none select-none scroll-m-1 scroll-mt-[var(--combobox-height,_0px)] data-[active-item]:bg-gray-a3";

const comboboxInputClass =
	"bg-gray-2 w-full shrink-0 border-b border-gray-a3 outline-none h-9 px-2.5 text-[13px] text-gray-12 placeholder:text-gray-9";

const searchableSubmenuShift = -40;
const plainSubmenuShift = -4;
const defaultVirtualThreshold = 100;
const defaultVirtualItemSize = 32;
const defaultVirtualOverscan = 24;

export interface NestedMenuProps {
	label?: ReactNode;
	children?: ReactNode | (() => ReactNode);
	searchValue?: string;
	onSearch?: (value: string) => void;
	combobox?: ReactNode;
	trigger?: ReactNode;
	className?: string;
}

export function NestedMenu({
	label,
	children,
	searchValue,
	onSearch,
	combobox,
	trigger,
	className,
}: NestedMenuProps) {
	const parent = Ariakit.useMenuContext();
	const searchable = searchValue != null || !!onSearch || !!combobox;
	const comboboxStore = Ariakit.useComboboxStore({
		resetValueOnHide: true,
		includesBaseElement: false,
		value: searchValue,
		setValue: onSearch,
	});
	const menu = Ariakit.useMenuStore({
		combobox: searchable ? comboboxStore : undefined,
		timeout: 0,
		showTimeout: 0,
		placement: parent ? "right-start" : "bottom-start",
	});

	const element = (
		<>
			<Ariakit.MenuButton
				store={menu}
				className={className}
				render={
					parent ? (
						<SubmenuTriggerItem>
							<span className="flex-1 truncate text-left">{label}</span>
							<span className="text-gray-10">›</span>
						</SubmenuTriggerItem>
					) : (
						(trigger as Ariakit.MenuButtonProps["render"])
					)
				}
			/>
			<Ariakit.Menu
				portal
				overlap
				unmountOnHide
				store={menu}
				gutter={parent ? -4 : 4}
				preventBodyScroll={!parent}
				typeahead={!searchable}
				composite={!searchable}
				shift={
					parent ? (searchable ? searchableSubmenuShift : plainSubmenuShift) : 0
				}
				className={cx(menuClass, !parent && rootMenuAnimationClass)}
			>
				<NestedMenuContent
					combobox={combobox}
					comboboxStore={comboboxStore}
					menu={menu}
					searchable={searchable}
				>
					{children}
				</NestedMenuContent>
			</Ariakit.Menu>
		</>
	);

	return element;
}

type NestedMenuVirtualData<TItem> = {
	data: TItem;
	disabled?: boolean;
};

type NestedMenuVirtualItemProps<TItem> = Omit<
	CompositeRendererItemProps<NestedMenuVirtualData<TItem>>,
	"data" | "disabled" | "index"
>;

export function NestedMenuVirtualList<TItem>({
	children,
	getKey,
	getDisabled,
	itemSize = defaultVirtualItemSize,
	items,
	overscan = defaultVirtualOverscan,
	threshold = defaultVirtualThreshold,
}: {
	children: (
		item: TItem,
		virtualProps: Partial<NestedMenuVirtualItemProps<TItem>>,
	) => ReactNode;
	getKey?: (item: TItem, index: number) => string;
	getDisabled?: (item: TItem) => boolean;
	itemSize?: number;
	items: TItem[];
	overscan?: number;
	threshold?: number;
}) {
	const searchable = useContext(SearchableContext);
	const combobox = Ariakit.useComboboxContext();
	const menu = Ariakit.useMenuContext();
	const reactId = useId();
	const store = (searchable ? combobox : (menu ?? combobox)) as
		| CompositeRendererProps<NestedMenuVirtualData<TItem>>["store"]
		| undefined;
	const rendererItems = useMemo(
		() =>
			items.map((item, index) => ({
				id: `${reactId}-${getKey?.(item, index) ?? index}`,
				data: item,
				disabled: getDisabled?.(item),
			})),
		[getDisabled, getKey, items, reactId],
	);

	if (!store || items.length <= threshold) {
		return <>{items.map((item) => children(item, {}))}</>;
	}

	return (
		<CompositeRenderer
			store={store}
			items={rendererItems}
			itemSize={itemSize}
			estimatedItemSize={itemSize}
			overscan={overscan}
			initialItems={Math.min(items.length, Math.max(64, overscan * 2))}
		>
			{({ data, disabled: _disabled, index: _index, ...virtualProps }) =>
				children(data, virtualProps)
			}
		</CompositeRenderer>
	);
}

function NestedMenuContent({
	children,
	combobox,
	comboboxStore,
	menu,
	searchable,
}: {
	children?: ReactNode | (() => ReactNode);
	combobox?: ReactNode;
	comboboxStore: Ariakit.ComboboxStore;
	menu: Ariakit.MenuStore;
	searchable: boolean;
}) {
	const mounted = Ariakit.useStoreState(menu, "mounted");
	const shouldRenderChildren = mounted;
	const renderedChildren =
		shouldRenderChildren && typeof children === "function"
			? children()
			: shouldRenderChildren
				? children
				: null;

	return (
		<SearchableContext.Provider value={searchable}>
			{searchable ? (
				<>
					<div className="shrink-0 [&~*]:[--combobox-height:36px]">
						<Ariakit.Combobox
							store={comboboxStore}
							autoSelect
							render={combobox as Ariakit.ComboboxProps["render"]}
							className={comboboxInputClass}
						/>
					</div>
					<Ariakit.ComboboxList
						store={comboboxStore}
						className="scrollbar-hidden nested-menu-scroll overflow-y-auto p-1 flex-1 min-h-0"
					>
						{renderedChildren}
					</Ariakit.ComboboxList>
				</>
			) : (
				<div className="scrollbar-hidden nested-menu-scroll overflow-y-auto p-1">
					{renderedChildren}
				</div>
			)}
		</SearchableContext.Provider>
	);
}

const SubmenuTriggerItem = forwardRef<HTMLDivElement, Ariakit.ComboboxItemProps>(
	function SubmenuTriggerItem({ className, ...props }, ref) {
		const searchable = useContext(SearchableContext);
		if (!searchable) {
			return (
				<Ariakit.MenuItem
					ref={ref}
					focusOnHover
					blurOnHoverEnd={false}
					{...(props as Ariakit.MenuItemProps)}
					className={cx(itemClass, className)}
				/>
			);
		}
		return (
			<Ariakit.ComboboxItem
				ref={ref}
				focusOnHover
				blurOnHoverEnd={false}
				setValueOnClick={false}
				hideOnClick={(event) => {
					const expandable = event.currentTarget.hasAttribute("aria-expanded");
					return !expandable;
				}}
				{...props}
				className={cx(itemClass, className)}
			/>
		);
	},
);

export interface NestedMenuItemProps
	extends Omit<Ariakit.ComboboxItemProps, "store"> {
	closeAllOnClick?: boolean;
	checked?: boolean;
	multi?: boolean;
}

export const NestedMenuItem = forwardRef<HTMLDivElement, NestedMenuItemProps>(
	function NestedMenuItem(
		{ closeAllOnClick, checked, multi, className, children, onClick, ...props },
		ref,
	) {
		const menu = Ariakit.useMenuContext();
		const searchable = useContext(SearchableContext);

		const content = (
			<>
				{multi && (
					<span
						className="border-gray-a5 bg-gray-2 mr-1 flex size-4 shrink-0 items-center justify-center border"
						aria-hidden
					>
						{checked && (
							<svg
								width="10"
								height="10"
								viewBox="0 0 15 15"
								fill="none"
								xmlns="http://www.w3.org/2000/svg"
							>
								<path
									d="M11.4669 3.72684C11.7558 3.91574 11.8369 4.30308 11.648 4.59198L7.39799 11.092C7.29783 11.2452 7.13556 11.3467 6.95402 11.3699C6.77247 11.3931 6.58989 11.3355 6.45446 11.2124L3.70446 8.71241C3.44905 8.48022 3.43023 8.08494 3.66242 7.82953C3.89461 7.57412 4.28989 7.55529 4.5453 7.78749L6.75292 9.79441L10.6018 3.90792C10.7907 3.61902 11.178 3.53795 11.4669 3.72684Z"
									fill="currentColor"
									fillRule="evenodd"
									clipRule="evenodd"
								/>
							</svg>
						)}
					</span>
				)}
				<span className="flex-1 truncate text-left">{children}</span>
				{!multi && checked && (
					<svg
						width="14"
						height="14"
						viewBox="0 0 15 15"
						fill="none"
						xmlns="http://www.w3.org/2000/svg"
						className="text-gray-11 shrink-0"
					>
						<path
							d="M11.4669 3.72684C11.7558 3.91574 11.8369 4.30308 11.648 4.59198L7.39799 11.092C7.29783 11.2452 7.13556 11.3467 6.95402 11.3699C6.77247 11.3931 6.58989 11.3355 6.45446 11.2124L3.70446 8.71241C3.44905 8.48022 3.43023 8.08494 3.66242 7.82953C3.89461 7.57412 4.28989 7.55529 4.5453 7.78749L6.75292 9.79441L10.6018 3.90792C10.7907 3.61902 11.178 3.53795 11.4669 3.72684Z"
							fill="currentColor"
							fillRule="evenodd"
							clipRule="evenodd"
						/>
					</svg>
				)}
			</>
		);

		if (!searchable) {
			return (
				<Ariakit.MenuItem
					ref={ref as React.Ref<HTMLDivElement>}
					focusOnHover
					blurOnHoverEnd={false}
					{...(props as Ariakit.MenuItemProps)}
					className={cx(itemClass, className)}
					onClick={(event) => {
						onClick?.(event);
						if (closeAllOnClick) menu?.hideAll();
					}}
				>
					{content}
				</Ariakit.MenuItem>
			);
		}

		return (
			<Ariakit.ComboboxItem
				ref={ref}
				focusOnHover
				blurOnHoverEnd={false}
				setValueOnClick={false}
				{...props}
				className={cx(itemClass, className)}
				hideOnClick={(event) => {
					if (event.currentTarget.hasAttribute("aria-expanded")) return false;
					if (multi) return false;
					if (closeAllOnClick) {
						menu?.hideAll();
						return true;
					}
					return true;
				}}
				onClick={onClick}
			>
				{content}
			</Ariakit.ComboboxItem>
		);
	},
);

export function NestedMenuSeparator() {
	return <Ariakit.MenuSeparator className="my-1 border-gray-a3" />;
}

export function NestedMenuEmpty({ children }: { children: ReactNode }) {
	return <div className="px-2.5 py-1.5 text-[12px] text-gray-10">{children}</div>;
}
