import type { MouseEvent } from "react";
import { useCallback, useMemo } from "react";
import { IconCross } from "./icons/cross";
import { IconPlus } from "./icons/plus";
import {
	localSearchSource,
	UnstableCombobox,
	type UnstableComboboxConfig,
	type UnstableComboboxItem,
} from "./unstable-combobox";

type CurrencyItem = {
	id: string;
	name: string;
};

function cx(...classes: Array<string | false | null | undefined>) {
	return classes.filter(Boolean).join(" ");
}

export function CurrencyMultiCombobox({
	currencies,
	value,
	onChange,
	placeholder = "filter by currency...",
	size = "default",
	className,
}: {
	currencies: string[] | undefined;
	value: string[];
	onChange: (value: string[]) => void;
	placeholder?: string;
	size?: "sm" | "default";
	className?: string;
}) {
	const items = useMemo<CurrencyItem[]>(
		() => (currencies ?? []).map((currency) => ({ id: currency, name: currency })),
		[currencies],
	);
	const selectedItems = useMemo(
		() => items.filter((item) => value.includes(item.id)),
		[items, value],
	);
	const removeValue = useCallback(
		(currency: string) => {
			onChange(value.filter((selected) => selected !== currency));
		},
		[onChange, value],
	);

	const config = useMemo<UnstableComboboxConfig>(() => {
		const currencyItems = items.map<UnstableComboboxItem>((item) => ({
			id: `currency:${item.id}`,
			label: <span className="font-mono">{item.name}</span>,
			textValue: item.name,
			checked: value.includes(item.id),
			multi: true,
			onSelect: () => {
				const next = value.includes(item.id)
					? value.filter((selected) => selected !== item.id)
					: [...value, item.id];
				onChange(next);
			},
		}));

		return {
			rootPageId: "root",
			pages: {
				root: {
					id: "root",
					title: "currencies",
					placeholder: "search currencies...",
					empty: "No currencies found.",
					items: currencyItems,
					search: {
						sources: [
							localSearchSource({ id: "currencies", items: currencyItems }),
						],
					},
				},
			},
		};
	}, [items, onChange, value]);

	const handleRemove = (
		event: MouseEvent<HTMLButtonElement>,
		currency: string,
	) => {
		event.preventDefault();
		event.stopPropagation();
		removeValue(currency);
	};

	return (
		<UnstableCombobox
			config={config}
			trigger={({ open }) => (
				<div
					className={cx(
						"focus field-trigger flex h-auto w-full min-w-0 items-center gap-1.5 overflow-hidden py-1",
						size === "sm" ? "px-2 text-sm" : "px-3 text-sm",
						open && "border-gray-a5 bg-gray-a2",
						className,
					)}
				>
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
						{selectedItems.length ? (
							selectedItems.map((currency) => (
								<button
									key={currency.id}
									type="button"
									className="inline-flex h-5 max-w-[10rem] items-center gap-1 bg-gray-a3 px-1.5 text-xs text-gray-12 outline-none hover:bg-gray-a5 focus-visible:ring-1 focus-visible:ring-gray-a7"
									aria-label={`Remove ${currency.name}`}
									onMouseDown={(event) => {
										event.preventDefault();
										event.stopPropagation();
									}}
									onClick={(event) => handleRemove(event, currency.id)}
								>
									<span className="truncate">{currency.name}</span>
									<IconCross className="size-3 shrink-0 text-gray-10" />
								</button>
							))
						) : (
							<span className="truncate text-gray-10">{placeholder}</span>
						)}
					</div>
					<span
						className="border-gray-a4 text-gray-10 flex size-5 shrink-0 items-center justify-center border bg-gray-a2"
						aria-hidden
					>
						<IconPlus className="size-3" />
					</span>
				</div>
			)}
		/>
	);
}
