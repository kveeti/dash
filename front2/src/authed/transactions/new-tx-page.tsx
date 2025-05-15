import * as ak from "@ariakit/react";
import { parseDateTime } from "@internationalized/date";
import { CalendarIcon } from "@radix-ui/react-icons";
import { format } from "date-fns";
import { startTransition, useId, useState } from "react";
import * as Rac from "react-aria-components";
import { useAsyncList } from "react-stately";

import { api, fetchClient } from "../../api";
import { Button, buttonStyles } from "../../ui/button";
import { IconChevronLeft } from "../../ui/icons/chevron-left";
import { IconChevronRight } from "../../ui/icons/chevron-right";
import { IconChevronsUpDown } from "../../ui/icons/chevrons-up-down";
import { Error, Input, LabelWrapper, inputStyles, labelStyles } from "../../ui/input";
import { Link } from "../../ui/link";
import { useLocaleStuff } from "../use-formatting";

export default function NewTxPage() {
	const mutation = api.useMutation("post", "/transactions");
	const [localErrors, setLocalErrors] = useState<Record<string, string> | null>(null);
	const [serverErrors, setServerErrors] = useState<Record<string, string> | null>(null);

	function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (mutation.isPending) return;

		const data = Object.fromEntries(new FormData(e.currentTarget));

		let category_key = "category_name";
		let category_value = data.category_name;
		if (data.category_id) {
			category_key = "category_id";
			category_value = data.category_id;
		}

		let account_key = "account_name";
		let account_value = data.account_name;
		if (data.account_id) {
			account_key = "account_id";
			account_value = data.account_id;
		}

		const input = {
			counter_party: data.counter_party,
			amount: Number(data.amount),
			date: new Date(data.date).toISOString(),
			additional: data.additional,
			[category_key]: category_value,
			[account_key]: account_value,
		};

		mutation.mutateAsync({ body: input }).catch((error) => {
			setServerErrors(error.response.data.errors);
		});
	}

	const errors = serverErrors ?? localErrors;

	return (
		<main className="w-full max-w-[320px]">
			<div className="flex justify-between gap-3">
				<h1 className="mb-4 text-lg font-medium">new transaction</h1>
				<Link href="/txs/import">import</Link>
			</div>

			<form className="w-full" onSubmit={handleSubmit}>
				<fieldset className="space-y-3">
					<Input
						label="counter party"
						name="counter_party"
						error={errors?.counter_party}
						autoComplete="off"
					/>
					<Input label="amount" name="amount" error={errors?.amount} autoComplete="off" />
					<DateField label="date" name="date" error={errors?.date} />
					<Input
						label="additional"
						name="additional"
						error={errors?.additional}
						autoComplete="off"
					/>
					<CategoryField error={errors?.category} />
					<AccountField error={errors?.account} />
				</fieldset>

				<div className="mt-6 flex justify-end">
					<Button isLoading={mutation.isPending}>add</Button>
				</div>
			</form>
		</main>
	);
}

export function DateField({
	error,
	defaultValue = new Date(),
	name,
	label,
}: {
	error?: string;
	defaultValue?: Date | string;
	name?: string;
	label: string;
}) {
	const { hourCycle } = useLocaleStuff();
	const _defaultValue = parseDateTime(format(defaultValue, "yyyy-MM-dd'T'HH:mm:ss"));

	const id = useId();
	const errorId = error ? id + "-error" : undefined;

	const calCellStyles =
		buttonStyles({ variant: "ghost", size: "icon" }) + " data-selected:bg-gray-a4";

	return (
		<Rac.DatePicker
			granularity="second"
			defaultValue={_defaultValue}
			name={name}
			hourCycle={hourCycle}
		>
			<LabelWrapper>
				<Rac.Label className={labelStyles}>{label}</Rac.Label>

				{error && errorId && <Error id={errorId}>{error}</Error>}
			</LabelWrapper>

			<Rac.Group className="flex gap-2">
				<Rac.DateInput
					className={inputStyles + " inline-flex items-center"}
					aria-describedby={errorId}
				>
					{(segment) => (
						<Rac.DateSegment
							segment={segment}
							className={
								"inline p-1 leading-4 caret-transparent outline-none" +
								" data-[type=literal]:p-0" +
								" data-[type=year]:-me-1" +
								" data-focused:bg-gray-a7 data-focused:text-white"
							}
						/>
					)}
				</Rac.DateInput>
				<Rac.Button className={buttonStyles({ variant: "outline", size: "icon" })}>
					<CalendarIcon className="size-4" />
				</Rac.Button>
			</Rac.Group>

			<Rac.Popover>
				<Rac.Dialog>
					<Rac.Calendar className="bg-gray-1 border-gray-4 border shadow-sm">
						<header className="mb-2 flex items-center justify-between gap-2">
							<Rac.Button
								slot="previous"
								className={buttonStyles({ variant: "ghost", size: "icon" })}
							>
								<IconChevronLeft />
							</Rac.Button>
							<Rac.Heading />
							<Rac.Button
								slot="next"
								className={buttonStyles({ variant: "ghost", size: "icon" })}
							>
								<IconChevronRight />
							</Rac.Button>
						</header>
						<Rac.CalendarGrid>
							{(date) => <Rac.CalendarCell className={calCellStyles} date={date} />}
						</Rac.CalendarGrid>
					</Rac.Calendar>
				</Rac.Dialog>
			</Rac.Popover>
		</Rac.DatePicker>
	);
}

export function AccountField({
	error,
	defaultValue,
}: {
	error?: string;
	defaultValue?: null | {
		id: string;
		name: string;
	};
}) {
	const [s, setS] = useState<{
		custom: boolean;
		value: string;
		label: string;
	} | null>(
		defaultValue ? { custom: false, value: defaultValue.id, label: defaultValue.name } : null
	);

	const list = useAsyncList<{ id: string; name: string }>({
		load: async ({ signal, filterText }) => {
			const res = await fetchClient.GET("/accounts", {
				signal,
				params: { query: { search_text: filterText } },
			});

			if (res.error) {
				throw "error";
			}

			return {
				items: res.data,
			};
		},
	});

	function onSelect(val: string) {
		const existing = list.items.find((x) => x.id === val);

		if (!existing) {
			setS({ custom: true, label: val, value: val });
			return;
		}

		setS({ custom: false, label: existing.name, value: existing.id });
	}

	const id = useId();
	const errorId = error ? id + "-error" : undefined;

	return (
		<ak.ComboboxProvider
			value={list.filterText}
			setValue={(val) => {
				startTransition(() => {
					list.setFilterText(val);
				});
			}}
		>
			<ak.SelectProvider setValue={onSelect} value={s?.value ?? ""}>
				<LabelWrapper>
					<ak.SelectLabel className={labelStyles}>account</ak.SelectLabel>

					{error && errorId && <Error id={errorId}>{error}</Error>}
				</LabelWrapper>

				<ak.Select
					name={s?.custom ? "account_name" : "account_id"}
					className={
						"focus border-gray-6 flex h-10 w-full items-center justify-between border"
					}
				>
					<span className="ps-3">{s?.label ?? "select an account"}</span>

					<IconChevronsUpDown className="text-gray-a11 me-2 size-5" />
				</ak.Select>

				<ak.SelectPopover
					gutter={4}
					sameWidth
					className="bg-gray-1 border-gray-4 z-10 min-w-(--popover-anchor-width) border outline-hidden"
				>
					<ak.Combobox
						className="border-gray-a4 w-full border-b px-3 py-2 outline-hidden"
						autoSelect
						placeholder="search accounts..."
						name="account_name"
					/>

					<ak.ComboboxList>
						{list.items.map((x) => (
							<SelectComboItem key={x.name} value={x.name} />
						))}

						{list.items.length && list.isLoading ? (
							<SelectComboItem>loading</SelectComboItem>
						) : (
							!list.items.length &&
							list.filterText &&
							!list.isLoading &&
							list.filterText === list.filterText && (
								<SelectComboItem value={list.filterText}>
									<p className="max-w-(--popover-anchor-width) truncate">
										create "{list.filterText}"
									</p>
								</SelectComboItem>
							)
						)}
					</ak.ComboboxList>
				</ak.SelectPopover>
			</ak.SelectProvider>
		</ak.ComboboxProvider>
	);
}

export function CategoryField({
	error,
	defaultValue,
	invisibleLabel,
}: {
	error?: string;
	defaultValue?: null | {
		id: string;
		name: string;
	};
	invisibleLabel?: boolean;
}) {
	const [s, setS] = useState<{
		custom: boolean;
		value: string;
		label: string;
	} | null>(
		defaultValue ? { custom: false, value: defaultValue.id, label: defaultValue.name } : null
	);

	const list = useAsyncList<{ id: string; name: string }>({
		load: async ({ signal, filterText }) => {
			const res = await fetchClient.GET("/categories", {
				signal,
				params: { query: { search_text: filterText } },
			});

			if (res.error) {
				throw "error";
			}

			return {
				items: res.data,
			};
		},
	});

	function onSelect(val: string) {
		const existing = list.items.find((x) => x.id === val);

		if (!existing) {
			setS({ custom: true, label: val, value: val });
			return;
		}

		setS({ custom: false, label: existing.name, value: existing.id });
	}

	const id = useId();
	const errorId = error ? id + "-error" : undefined;

	return (
		<ak.ComboboxProvider
			value={list.filterText}
			setValue={(val) => {
				startTransition(() => {
					list.setFilterText(val);
				});
			}}
		>
			<ak.SelectProvider setValue={onSelect} value={s?.value ?? ""}>
				{!invisibleLabel && (
					<LabelWrapper>
						<ak.SelectLabel className={labelStyles}>category</ak.SelectLabel>

						{error && errorId && <Error id={errorId}>{error}</Error>}
					</LabelWrapper>
				)}

				<ak.Select
					name={s?.custom ? "category_name" : "category_id"}
					className={
						"focus border-gray-6 flex h-10 w-full items-center justify-between border"
					}
				>
					<span className="ps-3">{s?.label ?? "select a category"}</span>

					<IconChevronsUpDown className="text-gray-a11 me-2 size-5" />
				</ak.Select>

				<ak.SelectPopover
					gutter={4}
					sameWidth
					className="bg-gray-1 border-gray-4 z-10 min-w-(--popover-anchor-width) border outline-hidden"
				>
					<ak.Combobox
						className="border-gray-a4 w-full border-b px-3 py-2 outline-hidden"
						autoSelect
						placeholder="search categories..."
						name="category_name"
					/>

					<ak.ComboboxList>
						{list.items.map((x) => (
							<SelectComboItem key={x.name} value={x.name} />
						))}

						{list.items.length && list.isLoading ? (
							<SelectComboItem>loading</SelectComboItem>
						) : (
							!list.items.length &&
							list.filterText &&
							!list.isLoading &&
							list.filterText === list.filterText && (
								<SelectComboItem value={list.filterText}>
									<p className="max-w-(--popover-anchor-width) truncate">
										create "{list.filterText}"
									</p>
								</SelectComboItem>
							)
						)}
					</ak.ComboboxList>
				</ak.SelectPopover>
			</ak.SelectProvider>
		</ak.ComboboxProvider>
	);
}

function SelectComboItem(props: ak.SelectItemProps) {
	return (
		<ak.SelectItem
			{...props}
			className="data-active-item:bg-gray-a4 p-2"
			render={<ak.ComboboxItem />}
		/>
	);
}
