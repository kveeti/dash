import * as Ariakit from "@ariakit/react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import {
	type CSSProperties,
	type KeyboardEvent,
	Fragment,
	type MouseEvent,
	type ReactNode,
	forwardRef,
	startTransition,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import { IconCheck } from "./icons/check";
import { IconChevronRight } from "./icons/chevron-right";

const mobileQuery = "(max-width: 640px)";
const defaultItemSize = 34;
const defaultOverscan = 10;

function cx(...classes: Array<string | false | null | undefined>) {
	return classes.filter(Boolean).join(" ");
}

type UnstableComboboxRenderTrigger = (state: {
	open: boolean;
	mobile: boolean;
}) => Ariakit.MenuButtonProps["render"];

export type UnstableComboboxTrigger =
	| Ariakit.MenuButtonProps["render"]
	| UnstableComboboxRenderTrigger;

export type UnstableComboboxSelectDetails = {
	close: () => void;
	event: MouseEvent<HTMLElement>;
	item: UnstableComboboxItem;
};

export type UnstableComboboxItem = {
	type?: "item";
	id: string;
	label: ReactNode;
	textValue?: string;
	description?: ReactNode;
	keywords?: string[];
	breadcrumb?: ReactNode;
	icon?: ReactNode;
	end?: ReactNode;
	disabled?: boolean;
	checked?: boolean;
	multi?: boolean;
	closeOnSelect?: boolean;
	pageId?: string;
	children?: UnstableComboboxNode[];
	title?: ReactNode;
	placeholder?: string;
	empty?: ReactNode;
	onSelect?: (details: UnstableComboboxSelectDetails) => void;
	render?: (item: UnstableComboboxItem) => ReactNode;
};

export type UnstableComboboxGroup = {
	type: "group";
	id: string;
	label: ReactNode;
	items: UnstableComboboxNode[];
};

export type UnstableComboboxSeparator = {
	type: "separator";
	id?: string;
};

export type UnstableComboboxNode =
	| UnstableComboboxItem
	| UnstableComboboxGroup
	| UnstableComboboxSeparator;

export type UnstableComboboxSearchContext = {
	query: string;
	normalizedQuery: string;
	pageId: string;
	signal: AbortSignal;
};

export type UnstableComboboxSearchSource = {
	id: string;
	label?: ReactNode;
	limit?: number;
	debounceMs?: number;
	enabled?: (context: UnstableComboboxSearchContext) => boolean;
	search: (
		query: string,
		context: UnstableComboboxSearchContext,
	) => UnstableComboboxItem[] | Promise<UnstableComboboxItem[]>;
};

export type UnstableComboboxSearchScope = {
	sources: UnstableComboboxSearchSource[];
};

export type UnstableComboboxPage = {
	id: string;
	title?: ReactNode;
	placeholder?: string;
	empty?: ReactNode;
	items: UnstableComboboxNode[];
	search?: UnstableComboboxSearchScope;
};

export type UnstableComboboxConfig = {
	rootPageId?: string;
	pages: Record<string, UnstableComboboxPage>;
};

export type UnstableComboboxFilterContext = {
	query: string;
	normalizedQuery: string;
};

type BaseProps = {
	trigger: UnstableComboboxTrigger;
	title?: ReactNode;
	placeholder?: string;
	empty?: ReactNode;
	open?: boolean;
	defaultOpen?: boolean;
	onOpenChange?: (open: boolean) => void;
	itemSize?: number;
	overscan?: number;
	className?: string;
	popoverClassName?: string;
	dialogClassName?: string;
	presentation?: "responsive" | "dialog";
	showDialogHeader?: boolean;
	onSearchChange?: (query: string, page: { id: string }) => void;
	filter?: (
		item: Exclude<UnstableComboboxNode, UnstableComboboxSeparator>,
		context: UnstableComboboxFilterContext,
	) => boolean;
};

export type UnstableComboboxProps = BaseProps &
	(
		| {
				config: UnstableComboboxConfig;
				items?: never;
		  }
		| {
				config?: never;
				items: UnstableComboboxNode[];
		  }
	);

type Page = {
	id: string;
	title: ReactNode;
	placeholder: string;
	empty?: ReactNode;
	items: UnstableComboboxNode[];
	search?: UnstableComboboxSearchScope;
};

type PageStackEntry = {
	id: string;
	page?: Page;
};

type Row =
	| { type: "group"; id: string; label: ReactNode }
	| { type: "separator"; id: string }
	| { type: "item"; item: UnstableComboboxItem };

type VirtualRowProps = {
	"data-index": number;
	style: CSSProperties;
};

const menuClass =
	"z-80 flex min-w-[16rem] max-w-[24rem] max-h-[min(26rem,var(--popover-available-height))] flex-col overflow-hidden rounded-md border border-gray-a3 bg-gray-2 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.24),0_3px_8px_-3px_rgba(0,0,0,0.12)] outline-none dark:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.7),0_3px_8px_-3px_rgba(0,0,0,0.45)]";

const menuMotionClass =
	"origin-[var(--popover-transform-origin)] scale-[0.99] opacity-0 transition-[scale,opacity] duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] data-[enter]:scale-100 data-[enter]:opacity-100 data-[leave]:scale-[0.99] data-[leave]:opacity-0 motion-reduce:duration-1";

const dialogMotionClass =
	"origin-center scale-[0.97] opacity-0 transition-[transform,scale,opacity] duration-240 ease-[cubic-bezier(0.05,0.95,0.15,1)] data-[enter]:scale-100 data-[enter]:opacity-100 data-[leave]:duration-100 data-[leave]:ease-in data-[leave]:scale-[0.95] data-[leave]:opacity-0 motion-reduce:duration-1 motion-reduce:data-[leave]:duration-1";

const inputClass =
	"h-10 w-full shrink-0 border-0 border-b border-gray-a3 bg-transparent px-3 text-[13px] text-gray-12 outline-none placeholder:text-gray-9";

const listClass =
	"combobox-list-scroll min-h-0 max-h-[min(24rem,var(--popover-available-height))] overflow-x-hidden overflow-y-auto p-1 overscroll-contain";

const itemClass =
	"flex h-full w-full cursor-default items-center gap-2 rounded-sm px-2.5 text-[13px] text-gray-12 outline-none select-none data-[active-item]:bg-gray-a3 data-[disabled]:text-gray-8";

const groupClass =
	"flex h-full items-center px-2.5 text-[10px] font-medium uppercase tracking-[0.06em] text-gray-10 select-none";

function getNodeType(node: UnstableComboboxNode) {
	return node.type ?? "item";
}

function getLabelText(label: ReactNode) {
	return typeof label === "string" || typeof label === "number"
		? String(label)
		: "";
}

function getItemText(item: UnstableComboboxItem) {
	return item.textValue ?? getLabelText(item.label) ?? item.id;
}

function getSearchText(item: UnstableComboboxItem) {
	return [
		item.breadcrumb,
		getItemText(item),
		item.description,
		...(item.keywords ?? []),
	]
		.filter((value): value is string | number => {
			return typeof value === "string" || typeof value === "number";
		})
		.join(" ");
}

function defaultFilter(
	node: Exclude<UnstableComboboxNode, UnstableComboboxSeparator>,
	{ normalizedQuery }: UnstableComboboxFilterContext,
) {
	if (!normalizedQuery) return true;
	if (node.type === "group") {
		return node.items.some((child) => {
			if (getNodeType(child) === "separator") return false;
			return defaultFilter(
				child as Exclude<UnstableComboboxNode, UnstableComboboxSeparator>,
				{ query: normalizedQuery, normalizedQuery },
			);
		});
	}
	return getSearchText(node as UnstableComboboxItem)
		.toLocaleLowerCase()
		.includes(normalizedQuery);
}

function getRows({
	filter,
	items,
	query,
}: {
	filter: NonNullable<BaseProps["filter"]>;
	items: UnstableComboboxNode[];
	query: string;
}) {
	const context: UnstableComboboxFilterContext = {
		query,
		normalizedQuery: query.trim().toLocaleLowerCase(),
	};
	const rows: Row[] = [];

	for (const node of items) {
		const type = getNodeType(node);
		if (type === "separator") {
			rows.push({ type: "separator", id: node.id ?? `separator-${rows.length}` });
			continue;
		}
		if (type === "group") {
			const group = node as UnstableComboboxGroup;
			const childRows = getRows({ filter, items: group.items, query });
			if (!filter(group, context) && !childRows.length) continue;
			if (!childRows.length) continue;
			rows.push({ type: "group", id: group.id, label: group.label });
			rows.push(...childRows);
			continue;
		}
		const item = node as UnstableComboboxItem;
		if (filter(item, context)) rows.push({ type: "item", item });
	}

	return trimSeparators(rows);
}

function trimSeparators(rows: Row[]) {
	const trimmed: Row[] = [];
	for (const row of rows) {
		if (row.type === "separator") {
			if (!trimmed.length) continue;
			if (trimmed[trimmed.length - 1]?.type === "separator") continue;
		}
		trimmed.push(row);
	}
	if (trimmed[trimmed.length - 1]?.type === "separator") trimmed.pop();
	return trimmed;
}

function rowKey(row: Row) {
	if (row.type === "item") return `item-${row.item.id}`;
	return `${row.type}-${row.id}`;
}

function rowSize(row: Row, itemSize: number) {
	if (row.type === "group") return 28;
	if (row.type === "separator") return 9;
	return itemSize;
}

function getFocusableRowIndexes(rows: Row[]) {
	let first = -1;
	let last = -1;
	for (let index = 0; index < rows.length; index += 1) {
		const row = rows[index]!;
		if (row.type !== "item") continue;
		if (row.item.disabled) continue;
		if (first === -1) first = index;
		last = index;
	}
	return { first, last };
}

function getRowOffsets(rows: Row[], itemSize: number) {
	const offsets = [0];
	for (const row of rows) {
		offsets.push(offsets[offsets.length - 1]! + rowSize(row, itemSize));
	}
	return offsets;
}

type RowGroupRange = {
	endIndex: number;
	id: string;
	label: ReactNode;
	startIndex: number;
};

function getRowGroupRanges(rows: Row[]) {
	const ranges: RowGroupRange[] = [];
	let current: RowGroupRange | null = null;

	rows.forEach((row, index) => {
		if (row.type !== "group") return;
		if (current) current.endIndex = index - 1;
		current = {
			endIndex: rows.length - 1,
			id: row.id,
			label: row.label,
			startIndex: index,
		};
		ranges.push(current);
	});

	return ranges;
}

function pageFromConfigPage(
	page: UnstableComboboxPage | undefined,
	fallback: Pick<Page, "title" | "placeholder" | "empty">,
): Page {
	return {
		id: page?.id ?? "root",
		title: page?.title ?? fallback.title,
		placeholder: page?.placeholder ?? fallback.placeholder,
		empty: page?.empty ?? fallback.empty,
		items: page?.items ?? [],
		search: page?.search,
	};
}

function useMediaQuery(query: string) {
	const [matches, setMatches] = useState(() => {
		if (typeof window === "undefined") return false;
		return window.matchMedia(query).matches;
	});

	useEffect(() => {
		const media = window.matchMedia(query);
		const onChange = (event: MediaQueryListEvent) => {
			setMatches(event.matches);
		};
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, [query]);

	return matches;
}

function useControllableOpen({
	defaultOpen,
	onOpenChange,
	open,
}: Pick<BaseProps, "defaultOpen" | "onOpenChange" | "open">) {
	const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen ?? false);
	const currentOpen = open ?? uncontrolledOpen;
	const setOpen = (nextOpen: boolean) => {
		onOpenChange?.(nextOpen);
		if (open === undefined) setUncontrolledOpen(nextOpen);
	};
	return [currentOpen, setOpen] as const;
}

function renderTrigger(
	trigger: UnstableComboboxTrigger,
	state: { mobile: boolean; open: boolean },
) {
	if (typeof trigger === "function") {
		return (trigger as UnstableComboboxRenderTrigger)(state);
	}
	return trigger;
}

function usePageRows({
	filter,
	page,
	query,
}: {
	filter: NonNullable<BaseProps["filter"]>;
	page: Page;
	query: string;
}) {
	const trimmedQuery = query.trim();
	const localRows = useMemo(
		() =>
			getRows({
				filter,
				items: page.items,
				query,
			}),
		[filter, page.items, query],
	);
	const searchRows = useSearchRows(page, trimmedQuery, localRows);

	if (page.search && trimmedQuery) return searchRows;
	return localRows;
}

function sourceResultToRows(
	source: UnstableComboboxSearchSource,
	items: UnstableComboboxItem[],
) {
	const limited = source.limit ? items.slice(0, source.limit) : items;
	const itemRows = limited.map((item) => ({ type: "item", item }) satisfies Row);
	if (!source.label) return itemRows;
	if (!itemRows.length) return [];
	return [{ type: "group", id: source.id, label: source.label }, ...itemRows];
}

function getEnabledSearchSources(
	sources: UnstableComboboxSearchSource[],
	context: UnstableComboboxSearchContext,
) {
	return sources.filter((source) => source.enabled?.(context) ?? true);
}

function useSearchRows(page: Page, query: string, fallbackRows: Row[]) {
	const [state, setState] = useState<{
		key: string;
		rows: Row[];
	}>({ key: "", rows: [] });

	const sources = page.search?.sources;
	const key = `${page.id}:${query}`;

	useEffect(() => {
		if (!sources?.length || !query) return;

		const controller = new AbortController();
		const sourceResults = new Map<string, UnstableComboboxItem[]>();
		const context: UnstableComboboxSearchContext = {
			query,
			normalizedQuery: query.toLocaleLowerCase(),
			pageId: page.id,
			signal: controller.signal,
		};
		const enabledSources = getEnabledSearchSources(sources, context);
		let pending = enabledSources.length;

		if (!pending) {
			const timeout = window.setTimeout(() => {
				if (!controller.signal.aborted) {
					setState({ key, rows: fallbackRows });
				}
			});
			return () => {
				window.clearTimeout(timeout);
				controller.abort();
			};
		}

		const commit = () => {
			const rows = enabledSources.flatMap((source) =>
				sourceResultToRows(source, sourceResults.get(source.id) ?? []),
			);
			if (rows.length || pending === 0) {
				setState({ key, rows });
			}
		};

		const timeouts = enabledSources.map((source) => {
			return window.setTimeout(() => {
				void Promise.resolve(source.search(query, context))
					.then((items) => {
						if (controller.signal.aborted) return;
						sourceResults.set(source.id, items);
					})
					.catch(() => {
						if (controller.signal.aborted) return;
						sourceResults.set(source.id, []);
					})
					.finally(() => {
						if (controller.signal.aborted) return;
						pending -= 1;
						commit();
					});
			}, source.debounceMs ?? 0);
		});

		return () => {
			for (const timeout of timeouts) {
				window.clearTimeout(timeout);
			}
			controller.abort();
		};
	}, [fallbackRows, key, page.id, query, sources]);

	if (!sources?.length || !query) {
		return [];
	}
	if (state.key !== key) {
		return fallbackRows.length ? fallbackRows : state.rows;
	}
	return state.rows;
}

// eslint-disable-next-line react-refresh/only-export-components
export function localSearchSource({
	id,
	items,
	label,
	limit,
	breadcrumb,
}: {
	id: string;
	items: UnstableComboboxItem[];
	label?: ReactNode;
	limit?: number;
	breadcrumb?: ReactNode;
}): UnstableComboboxSearchSource {
	const indexed = items.map((item) => ({
		item,
		search: getSearchText(item).toLocaleLowerCase(),
	}));
	return {
		id,
		label,
		limit,
		search: (_query, context) => {
			const tokens = context.normalizedQuery.split(/\s+/).filter(Boolean);
			return indexed
				.filter(({ search }) => tokens.every((token) => search.includes(token)))
				.map(({ item }) => ({
					...item,
					breadcrumb: item.breadcrumb ?? breadcrumb,
				}));
		},
	};
}

export function UnstableCombobox({
	config,
	defaultOpen,
	empty = "No results",
	filter = defaultFilter,
	itemSize = defaultItemSize,
	items,
	onOpenChange,
	onSearchChange,
	open,
	overscan = defaultOverscan,
	presentation = "responsive",
	placeholder = "Search...",
	showDialogHeader = false,
	title = "Command menu",
	trigger,
	className,
	popoverClassName,
	dialogClassName,
}: UnstableComboboxProps) {
	const mobile = useMediaQuery(mobileQuery);
	const [currentOpen, setOpen] = useControllableOpen({
		defaultOpen,
		onOpenChange,
		open,
	});
	const fallback = useMemo(
		() => ({ title, placeholder, empty }),
		[empty, placeholder, title],
	);
	const pages = config?.pages;
	const rootPageId = config?.rootPageId ?? "root";
	const rootPage = useMemo<Page>(() => {
		if (config) return pageFromConfigPage(pages?.[rootPageId], fallback);
		return {
			id: "root",
			title,
			placeholder,
			empty,
			items: items ?? [],
		};
	}, [config, empty, fallback, items, pages, placeholder, rootPageId, title]);

	if (presentation === "dialog" || mobile) {
		return (
			<MobileCombobox
				className={className}
				dialogClassName={dialogClassName}
				filter={filter}
				itemSize={itemSize}
				onOpenChange={setOpen}
				onSearchChange={onSearchChange}
				open={currentOpen}
				overscan={overscan}
				pages={pages}
				rootPage={rootPage}
				showHeader={showDialogHeader}
				trigger={trigger}
			/>
		);
	}

	return (
		<DesktopCombobox
			className={className}
			filter={filter}
			itemSize={itemSize}
			onSearchChange={onSearchChange}
			onOpenChange={setOpen}
			open={currentOpen}
			overscan={overscan}
			page={rootPage}
			pages={pages}
			popoverClassName={popoverClassName}
			trigger={trigger}
		/>
	);
}

function DesktopCombobox({
	className,
	filter,
	itemSize,
	onSearchChange,
	onOpenChange,
	open,
	overscan,
	page,
	pages,
	popoverClassName,
	trigger,
}: {
	className?: string;
	filter: NonNullable<BaseProps["filter"]>;
	itemSize: number;
	onSearchChange?: BaseProps["onSearchChange"];
	onOpenChange: (open: boolean) => void;
	open: boolean;
	overscan: number;
	page: Page;
	pages?: Record<string, UnstableComboboxPage>;
	popoverClassName?: string;
	trigger: UnstableComboboxTrigger;
}) {
	return (
		<DesktopMenu
			className={className}
			filter={filter}
			itemSize={itemSize}
			onSearchChange={onSearchChange}
			onOpenChange={onOpenChange}
			open={open}
			overscan={overscan}
			page={page}
			pages={pages}
			popoverClassName={popoverClassName}
			trigger={renderTrigger(trigger, { mobile: false, open })}
		/>
	);
}

function DesktopMenu({
	className,
	filter,
	itemSize,
	onSearchChange,
	onOpenChange,
	open,
	overscan,
	page,
	pages,
	popoverClassName,
	trigger,
}: {
	className?: string;
	filter: NonNullable<BaseProps["filter"]>;
	itemSize: number;
	onSearchChange?: BaseProps["onSearchChange"];
	onOpenChange?: (open: boolean) => void;
	open?: boolean;
	overscan: number;
	page: Page;
	pages?: Record<string, UnstableComboboxPage>;
	popoverClassName?: string;
	trigger?: Ariakit.MenuButtonProps["render"];
}) {
	const parent = Ariakit.useMenuContext();
	const [query, setQuery] = useState("");
	const combobox = Ariakit.useComboboxStore({
		includesBaseElement: false,
		resetValueOnHide: true,
		value: query,
		setValue: (value) => {
			setQuery(value);
			startTransition(() => {
				onSearchChange?.(value, { id: page.id });
			});
		},
	});
	const rows = usePageRows({ filter, page, query });

	return (
		<Ariakit.MenuProvider
			combobox={combobox}
			open={open}
			setOpen={onOpenChange}
			placement={parent ? "right-start" : "bottom-start"}
			showTimeout={80}
			timeout={80}
		>
			<Ariakit.MenuButton className={className} render={trigger} />
			<Ariakit.Menu
				portal
				overlap={!!parent}
				unmountOnHide
				gutter={parent ? -4 : 4}
				shift={parent ? -42 : 0}
				preventBodyScroll={!parent}
				typeahead={false}
				composite={false}
				className={cx(
					menuClass,
					menuMotionClass,
					!parent && "dash-root-menu",
					popoverClassName,
				)}
			>
				<div className="shrink-0">
					<Ariakit.Combobox
						store={combobox}
						autoSelect
						placeholder={page.placeholder}
						className={inputClass}
					/>
				</div>
				<VirtualRows
					combobox={combobox}
					itemSize={itemSize}
					overscan={overscan}
					rows={rows}
				>
					{(row, rowProps) => (
						<DesktopRow
							filter={filter}
							itemSize={itemSize}
							onSearchChange={onSearchChange}
							overscan={overscan}
							pages={pages}
							parentCombobox={combobox}
							row={row}
							rowProps={rowProps}
						/>
					)}
				</VirtualRows>
				{!rows.length && <EmptyState>{page.empty}</EmptyState>}
			</Ariakit.Menu>
		</Ariakit.MenuProvider>
	);
}

function DesktopRow({
	filter,
	itemSize,
	onSearchChange,
	overscan,
	pages,
	parentCombobox,
	row,
	rowProps,
}: {
	filter: NonNullable<BaseProps["filter"]>;
	itemSize: number;
	onSearchChange?: BaseProps["onSearchChange"];
	overscan: number;
	pages?: Record<string, UnstableComboboxPage>;
	parentCombobox: Ariakit.ComboboxStore;
	row: Row;
	rowProps: VirtualRowProps;
}) {
	if (row.type === "group") {
		return (
			<Ariakit.ComboboxGroupLabel className={groupClass} {...rowProps}>
				{row.label}
			</Ariakit.ComboboxGroupLabel>
		);
	}
	if (row.type === "separator") {
		return (
			<Ariakit.MenuSeparator
				className="my-1 border-gray-a3"
				{...rowProps}
			/>
		);
	}

	const targetPage = getTargetPage(row.item, pages);
	if (targetPage) {
		return (
			<DesktopMenu
				filter={filter}
				itemSize={itemSize}
				onSearchChange={onSearchChange}
				overscan={overscan}
				page={targetPage}
				pages={pages}
				trigger={
					<DesktopSubmenuTrigger
						combobox={parentCombobox}
						item={row.item}
						{...rowProps}
					/>
				}
			/>
		);
	}
	return (
		<ComboboxActionItem
			combobox={parentCombobox}
			item={row.item}
			rowProps={rowProps}
		/>
	);
}

function getTargetPage(
	item: UnstableComboboxItem,
	pages?: Record<string, UnstableComboboxPage>,
) {
	if (item.pageId && pages?.[item.pageId]) {
		return pageFromConfigPage(pages[item.pageId], {
			title: item.title ?? item.label,
			placeholder: item.placeholder ?? "Search...",
			empty: item.empty,
		});
	}
	if (item.children?.length) {
		return {
			id: item.id,
			title: item.title ?? item.label,
			placeholder: item.placeholder ?? "Search...",
			empty: item.empty,
			items: item.children,
		} satisfies Page;
	}
	return null;
}

type DesktopSubmenuTriggerProps = Omit<
	Ariakit.ComboboxItemProps,
	"children" | "store" | "value"
> & {
	combobox?: Ariakit.ComboboxStore;
	item: UnstableComboboxItem;
};

const DesktopSubmenuTrigger = forwardRef<
	HTMLDivElement,
	DesktopSubmenuTriggerProps
>(function DesktopSubmenuTrigger(
	{ className, combobox, item, ...props },
	ref,
) {
	return (
		<Ariakit.ComboboxItem
			ref={ref}
			store={combobox}
			value={getSearchText(item)}
			focusOnHover
			blurOnHoverEnd={false}
			setValueOnClick={false}
			hideOnClick={false}
			disabled={item.disabled}
			{...props}
			className={cx(itemClass, className)}
		>
			<ItemContent item={item} trailing={<IconChevronRight />} />
		</Ariakit.ComboboxItem>
	);
});

function ComboboxActionItem({
	combobox,
	item,
	mobile,
	onNavigate,
	rowProps,
}: {
	combobox: Ariakit.ComboboxStore;
	item: UnstableComboboxItem;
	mobile?: boolean;
	onNavigate?: () => void;
	rowProps?: VirtualRowProps;
}) {
	const menu = Ariakit.useMenuContext();
	const close = () => menu?.hideAll();
	const closeOnSelect = item.closeOnSelect ?? !item.multi;

	return (
		<Ariakit.ComboboxItem
			store={combobox}
			value={getSearchText(item)}
			focusOnHover
			blurOnHoverEnd={false}
			setValueOnClick={false}
			hideOnClick={false}
			disabled={item.disabled}
			className={cx(itemClass, mobile && "px-3")}
			{...rowProps}
			onClick={(event) => {
				if (item.disabled) return;
				if (onNavigate) {
					onNavigate();
					return;
				}
				item.onSelect?.({ close, event, item });
				if (closeOnSelect) close();
			}}
		>
			<ItemContent item={item} />
		</Ariakit.ComboboxItem>
	);
}

function ItemContent({
	item,
	trailing,
}: {
	item: UnstableComboboxItem;
	trailing?: ReactNode;
}) {
	if (item.render) return item.render(item);
	return (
		<>
			{item.multi && (
				<span
					className="border-gray-a5 bg-gray-2 flex size-4 shrink-0 items-center justify-center border"
					aria-hidden
				>
					{item.checked && <IconCheck />}
				</span>
			)}
			{item.icon && <span className="shrink-0 text-gray-11">{item.icon}</span>}
			{item.breadcrumb && (
				<span className="shrink-0 text-[10px] text-gray-10">
					{item.breadcrumb}
				</span>
			)}
			<span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
			{item.description && (
				<span className="ml-auto min-w-0 truncate text-[11px] text-gray-10">
					{item.description}
				</span>
			)}
			{item.end}
			{!item.multi && item.checked && (
				<span className="shrink-0 text-gray-11">
					<IconCheck />
				</span>
			)}
			{trailing && <span className="shrink-0 text-gray-10">{trailing}</span>}
		</>
	);
}

function EmptyState({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-20 items-center justify-center px-3 py-4 text-[13px] text-gray-10">
			{children}
		</div>
	);
}

function VirtualRows({
	children,
	combobox,
	itemSize,
	overscan,
	rows,
}: {
	children: (row: Row, rowProps: VirtualRowProps) => ReactNode;
	combobox: Ariakit.ComboboxStore;
	itemSize: number;
	overscan: number;
	rows: Row[];
}) {
	const scrollRef = useRef<HTMLDivElement>(null);
	const id = useId();
	const focusableIndexes = useMemo(() => getFocusableRowIndexes(rows), [rows]);
	const rowOffsets = useMemo(() => getRowOffsets(rows, itemSize), [itemSize, rows]);
	const groupRanges = useMemo(() => getRowGroupRanges(rows), [rows]);
	const virtualizer = useVirtualizer({
		count: rows.length,
		getItemKey: (index) => `${id}-${rowKey(rows[index]!)}`,
		getScrollElement: () => scrollRef.current,
		estimateSize: (index) => rowSize(rows[index]!, itemSize),
		rangeExtractor: (range) => {
			const indexes = defaultRangeExtractor(range);
			if (focusableIndexes.first !== -1) indexes.push(focusableIndexes.first);
			if (focusableIndexes.last !== -1) indexes.push(focusableIndexes.last);
			return Array.from(new Set(indexes)).sort((a, b) => a - b);
		},
		overscan,
		useFlushSync: false,
	});
	const virtualRows = virtualizer.getVirtualItems();
	const groupedVirtualRows = new Map<
		number,
		{ range: RowGroupRange; virtualRows: typeof virtualRows }
	>();
	const directVirtualRows: typeof virtualRows = [];

	for (const virtualRow of virtualRows) {
		const groupRange = groupRanges.find(
			(range) =>
				virtualRow.index >= range.startIndex &&
				virtualRow.index <= range.endIndex,
		);
		if (!groupRange) {
			directVirtualRows.push(virtualRow);
			continue;
		}
		const group = groupedVirtualRows.get(groupRange.startIndex);
		if (group) {
			group.virtualRows.push(virtualRow);
		} else {
			groupedVirtualRows.set(groupRange.startIndex, {
				range: groupRange,
				virtualRows: [virtualRow],
			});
		}
	}

	const getVirtualRowProps = (
		virtualRow: (typeof virtualRows)[number],
		top = virtualRow.start,
	): VirtualRowProps => ({
		"data-index": virtualRow.index,
		style: {
			height: virtualRow.size,
			left: 0,
			position: "absolute",
			top: 0,
			transform: `translateY(${top}px)`,
			width: "100%",
		},
	});

	const renderVirtualRow = (
		virtualRow: (typeof virtualRows)[number],
		top = virtualRow.start,
	) => {
		const row = rows[virtualRow.index]!;
		return (
			<Fragment key={virtualRow.key}>
				{children(row, getVirtualRowProps(virtualRow, top))}
			</Fragment>
		);
	};

	return (
		<Ariakit.ComboboxList
			ref={scrollRef}
			store={combobox}
			alwaysVisible
			className={listClass}
		>
			<div
				role="presentation"
				style={{
					height: virtualizer.getTotalSize(),
					position: "relative",
					width: "100%",
				}}
			>
				{directVirtualRows.map((virtualRow) => renderVirtualRow(virtualRow))}
				{Array.from(groupedVirtualRows.values()).map(({ range, virtualRows }) => {
					const groupStart = rowOffsets[range.startIndex]!;
					const groupHeight =
						rowOffsets[range.endIndex + 1]! - rowOffsets[range.startIndex]!;
					return (
						<Ariakit.ComboboxGroup
							key={`${id}-group-${range.id}`}
							store={combobox}
							style={
								{
									height: groupHeight,
									left: 0,
									position: "absolute",
									top: 0,
									transform: `translateY(${groupStart}px)`,
									width: "100%",
								} satisfies CSSProperties
							}
						>
							<Ariakit.ComboboxGroupLabel
								className={groupClass}
								style={
									{
										height: rowSize(rows[range.startIndex]!, itemSize),
										left: 0,
										position: "absolute",
										top: 0,
										width: "100%",
									} satisfies CSSProperties
								}
							>
								{range.label}
							</Ariakit.ComboboxGroupLabel>
							{virtualRows
								.filter((virtualRow) => virtualRow.index !== range.startIndex)
								.map((virtualRow) =>
									renderVirtualRow(
										virtualRow,
										rowOffsets[virtualRow.index]! - groupStart,
									),
								)}
						</Ariakit.ComboboxGroup>
					);
				})}
			</div>
		</Ariakit.ComboboxList>
	);
}

function MobileCombobox({
	className,
	dialogClassName,
	filter,
	itemSize,
	onSearchChange,
	onOpenChange,
	open,
	overscan,
	pages,
	rootPage,
	showHeader,
	trigger,
}: {
	className?: string;
	dialogClassName?: string;
	filter: NonNullable<BaseProps["filter"]>;
	itemSize: number;
	onSearchChange?: BaseProps["onSearchChange"];
	onOpenChange: (open: boolean) => void;
	open: boolean;
	overscan: number;
	pages?: Record<string, UnstableComboboxPage>;
	rootPage: Page;
	showHeader: boolean;
	trigger: UnstableComboboxTrigger;
}) {
	const [stack, setStack] = useState<PageStackEntry[]>([{ id: rootPage.id }]);
	const dialog = Ariakit.useDialogStore({
		open,
		setOpen: (nextOpen) => {
			if (nextOpen) setStack([{ id: rootPage.id }]);
			onOpenChange(nextOpen);
		},
	});
	const dialogOpen = Ariakit.useStoreState(dialog, "open");
	const currentPageEntry = stack[stack.length - 1] ?? { id: rootPage.id };
	const currentPage =
		currentPageEntry.id === rootPage.id
			? rootPage
			: pages?.[currentPageEntry.id]
				? pageFromConfigPage(pages[currentPageEntry.id], {
						title: currentPageEntry.page?.title ?? rootPage.title,
						placeholder:
							currentPageEntry.page?.placeholder ?? rootPage.placeholder,
						empty: currentPageEntry.page?.empty,
					})
				: (currentPageEntry.page ?? rootPage);
	const close = () => dialog.hide();

	return (
		<>
			<Ariakit.DialogDisclosure
				store={dialog}
				className={className}
				render={renderTrigger(trigger, { mobile: true, open: dialogOpen })}
			/>
			<Ariakit.Dialog
				store={dialog}
				portal
				unmountOnHide
				preventBodyScroll
				backdrop={false}
				className={cx(
					"fixed top-2 left-2 right-2 z-80 flex max-h-[calc(100dvh-1rem)] flex-col overflow-hidden rounded-lg border border-gray-a4 bg-gray-2 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.28),0_4px_12px_-4px_rgba(0,0,0,0.14)] outline-none dark:shadow-[0_24px_64px_-12px_rgba(0,0,0,0.75),0_4px_12px_-4px_rgba(0,0,0,0.45)]",
					dialogMotionClass,
					dialogClassName,
				)}
				aria-label={
					!showHeader && typeof rootPage.title === "string"
						? rootPage.title
						: undefined
				}
			>
				<MobilePage
					close={close}
					filter={filter}
					itemSize={itemSize}
					onBack={
						stack.length > 1
							? () => setStack((pages) => pages.slice(0, -1))
							: undefined
					}
					onPush={(nextPage) =>
						setStack((stack) => [...stack, { id: nextPage.id, page: nextPage }])
					}
					onSearchChange={onSearchChange}
					overscan={overscan}
					page={currentPage}
					pages={pages}
					showHeader={showHeader}
				/>
			</Ariakit.Dialog>
		</>
	);
}

function MobilePage({
	close,
	filter,
	itemSize,
	onBack,
	onPush,
	onSearchChange,
	overscan,
	page,
	pages,
	showHeader,
}: {
	close: () => void;
	filter: NonNullable<BaseProps["filter"]>;
	itemSize: number;
	onBack?: () => void;
	onPush: (page: Page) => void;
	onSearchChange?: BaseProps["onSearchChange"];
	overscan: number;
	page: Page;
	pages?: Record<string, UnstableComboboxPage>;
	showHeader: boolean;
}) {
	const [query, setQuery] = useState("");
	const combobox = Ariakit.useComboboxStore({
		includesBaseElement: false,
		resetValueOnHide: true,
		value: query,
		setValue: (value) => {
			setQuery(value);
			startTransition(() => {
				onSearchChange?.(value, { id: page.id });
			});
		},
	});
	const rows = usePageRows({ filter, page, query });

	const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key !== "Backspace") return;
		if (query.length > 0) return;
		if (!onBack) return;
		event.preventDefault();
		onBack();
	};

	return (
		<div className="flex max-h-[min(34rem,calc(100dvh-1rem))] min-h-0 flex-col">
			{showHeader && (
				<div className="flex h-11 shrink-0 items-center border-b border-gray-a3 px-3">
					<Ariakit.DialogHeading className="min-w-0 flex-1 truncate text-center text-[13px] font-medium text-gray-12">
						{page.title}
					</Ariakit.DialogHeading>
				</div>
			)}
			<Ariakit.Combobox
				store={combobox}
				autoSelect
				autoFocus
				placeholder={page.placeholder}
				className={inputClass}
				onKeyDown={onInputKeyDown}
			/>
			<VirtualRows
				combobox={combobox}
				itemSize={itemSize}
				overscan={overscan}
				rows={rows}
			>
				{(row, rowProps) => {
					if (row.type === "group") {
						return (
							<Ariakit.ComboboxGroupLabel className={groupClass} {...rowProps}>
								{row.label}
							</Ariakit.ComboboxGroupLabel>
						);
					}
					if (row.type === "separator") {
						return (
							<Ariakit.Separator
								className="my-1 border-gray-a3"
								{...rowProps}
							/>
						);
					}
					const targetPage = getTargetPage(row.item, pages);
					if (targetPage) {
						return (
							<ComboboxActionItem
								combobox={combobox}
								item={row.item}
								mobile
								onNavigate={() => onPush(targetPage)}
								rowProps={rowProps}
							/>
						);
					}
					return (
						<MobileActionItem
							close={close}
							combobox={combobox}
							item={row.item}
							rowProps={rowProps}
						/>
					);
				}}
			</VirtualRows>
			{!rows.length && <EmptyState>{page.empty}</EmptyState>}
		</div>
	);
}

function MobileActionItem({
	close,
	combobox,
	item,
	rowProps,
}: {
	close: () => void;
	combobox: Ariakit.ComboboxStore;
	item: UnstableComboboxItem;
	rowProps: VirtualRowProps;
}) {
	const closeOnSelect = item.closeOnSelect ?? !item.multi;
	return (
		<Ariakit.ComboboxItem
			store={combobox}
			value={getSearchText(item)}
			focusOnHover
			blurOnHoverEnd={false}
			setValueOnClick={false}
			hideOnClick={false}
			disabled={item.disabled}
			className={cx(itemClass, "px-3")}
			{...rowProps}
			onClick={(event) => {
				if (item.disabled) return;
				item.onSelect?.({ close, event, item });
				if (closeOnSelect) close();
			}}
		>
			<ItemContent item={item} />
		</Ariakit.ComboboxItem>
	);
}
