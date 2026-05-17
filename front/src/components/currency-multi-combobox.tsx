import type { MouseEvent } from "react";
import { useMemo } from "react";
import { Combobox } from "./combobox";
import { IconCheck } from "./icons/check";
import { IconCross } from "./icons/cross";
import { IconPlus } from "./icons/plus";

type CurrencyItem = {
	id: string;
	name: string;
};

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
	const removeValue = (currency: string) =>
		onChange(value.filter((selected) => selected !== currency));

	const handleRemove = (
		event: MouseEvent<HTMLButtonElement>,
		currency: string,
	) => {
		event.preventDefault();
		event.stopPropagation();
		removeValue(currency);
	};

	return (
		<Combobox.Root
			multiple
			items={items}
			value={selectedItems}
			onValueChange={(next) => onChange(next.map((item) => item.id))}
			itemToStringLabel={(item) => item.name}
			isItemEqualToValue={(item, selected) => item.id === selected.id}
			autoHighlight
		>
			<Combobox.Trigger<CurrencyItem, CurrencyItem[]>
				nativeButton={false}
				render={<div />}
				className={
					"focus field-trigger flex h-auto w-full min-w-0 items-center gap-1.5 overflow-hidden py-1 " +
					(size === "sm" ? "px-2 text-sm" : "px-3 text-sm") +
					(className ? ` ${className}` : "")
				}
			>
				{({ selectedValue }) => (
					<>
						<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
							{selectedValue.length ? (
								selectedValue.map((currency) => (
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
					</>
				)}
			</Combobox.Trigger>
			<Combobox.Content
				searchPlaceholder="search currencies..."
				empty="No currencies found."
				size={size}
			>
				<Combobox.List<CurrencyItem>>
					{(item, index, context) => {
						const selected =
							Array.isArray(context.value) &&
							context.value.some((selectedItem) => selectedItem.id === item.id);

						return (
							<Combobox.Item key={item.id} value={item} size={size} index={index}>
								<span
									data-combobox-keep-open
									className="-my-2 -ml-2 mr-0 flex size-9 shrink-0 items-center justify-center text-gray-11"
									aria-hidden
								>
									<span className="border-gray-a5 bg-gray-1 flex size-4 items-center justify-center border">
										{selected && <IconCheck />}
									</span>
								</span>
								<span className="truncate">{item.name}</span>
							</Combobox.Item>
						);
					}}
				</Combobox.List>
			</Combobox.Content>
		</Combobox.Root>
	);
}
