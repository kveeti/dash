import * as Ariakit from "@ariakit/react";
import { parseDateTime } from "@internationalized/date";
import { CheckIcon } from "@radix-ui/react-icons";
import { format } from "date-fns";
import { type ComponentProps, startTransition, useId, useMemo, useState } from "react";
import * as Rac from "react-aria-components";

import { trpc } from "../../lib/trpc";
import { useDebounce } from "../../lib/utils";
import { Error, Input, LabelWrapper, inputStyles, labelStyles } from "../../ui/input";

export function CategoryField({ error, defaultValue }: { error?: string; defaultValue?: string }) {
	const [inputValue, setInputValue] = useState(defaultValue ?? "");
	const search = useDebounce(inputValue, 200);
	const isStale = search !== inputValue;
	const categories = trpc.v1.categories.query.useQuery({ query: search });

	const matches = useMemo(
		() =>
			(categories.data ?? [])
				.filter((category) =>
					category.name.toLowerCase().includes(inputValue.toLowerCase())
				)
				.map((category) => category.name),
		[categories.data, inputValue]
	);

	const id = useId();
	const errorId = error ? id + "-error" : undefined;

	return (
		<div>
			<Ariakit.ComboboxProvider
				defaultValue={defaultValue}
				setValue={(value) => {
					startTransition(() => setInputValue(value));
				}}
			>
				<LabelWrapper>
					<Ariakit.ComboboxLabel className={labelStyles}>category</Ariakit.ComboboxLabel>

					{errorId && error && <Error id={errorId}>{error}</Error>}
				</LabelWrapper>
				<Ariakit.Combobox
					className={inputStyles}
					autoSelect
					autoComplete="list"
					name="category_name"
					aria-describedby={errorId}
				/>
				<ComboboxPopover gutter={4} sameWidth>
					{matches.length ? (
						matches.map((match) => (
							<ComboboxItem key={match} value={match}>
								{match}
							</ComboboxItem>
						))
					) : !isStale && !categories.isFetching && inputValue.length > 0 ? (
						<ComboboxItem value={inputValue}>create "{inputValue}"</ComboboxItem>
					) : null}
				</ComboboxPopover>
			</Ariakit.ComboboxProvider>
		</div>
	);
}

export function ComboboxItem({ className, ...props }: Ariakit.ComboboxItemProps) {
	return (
		<Ariakit.ComboboxItem
			className={
				"flex scroll-m-2 items-center gap-2 p-2 outline-hidden" +
				" " +
				"data-active-item:bg-gray-5 data-active:bg-gray-5 hover:bg-gray-5" +
				" " +
				className
			}
			{...props}
		/>
	);
}

export function ComboboxPopover({ className, ...props }: Ariakit.ComboboxPopoverProps) {
	return (
		<Ariakit.ComboboxPopover
			className={
				"border-gray-a6 bg-gray-1 z-10 flex cursor-default flex-col overflow-auto overscroll-contain border p-1 outline-hidden" +
				" " +
				"max-h-(min(var(--popover-available-height,_19rem),_19rem))" +
				" " +
				className
			}
			{...props}
		/>
	);
}

export function DateField({
	error,
	defaultValue = new Date(),
}: {
	error?: string;
	defaultValue?: Date | string;
}) {
	const _defaultValue = parseDateTime(format(defaultValue, "yyyy-MM-dd'T'HH:mm:ss"));

	const id = useId();
	const errorId = error ? id + "-error" : undefined;

	return (
		<Rac.DateField granularity="second" defaultValue={_defaultValue} name="date">
			<LabelWrapper>
				<Rac.Label className={labelStyles}>date</Rac.Label>

				{error && errorId && <Error id={errorId}>{error}</Error>}
			</LabelWrapper>

			<Rac.DateInput
				className={inputStyles + " inline-flex items-center"}
				aria-describedby={errorId}
			>
				{(segment) => (
					<Rac.DateSegment
						segment={segment}
						className={
							"inline p-1 leading-4 caret-transparent outline-none" +
							" " +
							"data-[type=literal]:p-0" +
							" " +
							"data-[type=year]:-me-1" +
							" " +
							"data-focused:bg-gray-a7 data-focused:text-white"
						}
					/>
				)}
			</Rac.DateInput>
		</Rac.DateField>
	);
}

export function AmountAndCurrencyField({
	amountError,
	defaultValue,
	defaultCurrency = "EUR",
}: {
	amountError?: string;
	defaultValue?: number;
	defaultCurrency?: string;
}) {
	const [selectedCurrencyValue, setSelectedCurrencyValue] = useState(defaultCurrency);
	const currencyOptions = [
		{ value: "EUR", label: "EUR €" },
		{ value: "SEK", label: "SEK kr" },
		{ value: "USD", label: "USD $" },
		{ value: "GBP", label: "GBP £" },
	];
	const selectedCurrency = currencyOptions.find((o) => o.value === selectedCurrencyValue);

	return (
		<div className="flex items-end">
			<Input
				label="amount"
				name="amount"
				type="number"
				className="-me-px w-full"
				step={0.0000000000000000000000000000000001}
				defaultValue={defaultValue}
				error={amountError}
			/>

			<Ariakit.SelectProvider
				defaultValue={defaultCurrency}
				value={selectedCurrencyValue}
				setValue={setSelectedCurrencyValue}
			>
				<Ariakit.Select
					name="currency"
					className={
						inputStyles + " flex w-full max-w-max items-center justify-between gap-3"
					}
				>
					{selectedCurrency?.label ?? ""}
					<Ariakit.SelectArrow />
				</Ariakit.Select>

				<Ariakit.SelectPopover className="border-gray-a6 bg-gray-1 z-10 block w-max cursor-default border p-1 outline-none">
					{currencyOptions.map((opt) => (
						<SelectItem key={opt.value} value={opt.value} id={opt.value}>
							<CheckIcon
								className={"invisible me-2 in-aria-selected:visible"}
								aria-hidden="true"
							/>
							<span>{opt.label}</span>
						</SelectItem>
					))}
				</Ariakit.SelectPopover>
			</Ariakit.SelectProvider>
		</div>
	);
}

function SelectItem({ className, ...props }: ComponentProps<typeof Ariakit.SelectItem>) {
	return (
		<Ariakit.SelectItem
			{...props}
			className={
				"relative flex scroll-m-2 items-center p-2 outline-hidden" +
				" " +
				"data-active-item:bg-gray-a5" +
				" " +
				"hover:bg-gray-a5" +
				(className ? " " + className : "")
			}
		/>
	);
}
