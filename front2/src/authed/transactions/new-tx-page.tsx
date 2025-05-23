import * as ak from "@ariakit/react";
import { parseDateTime } from "@internationalized/date";
import { CalendarIcon } from "@radix-ui/react-icons";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Tooltip } from "radix-ui";
import { FormEvent, startTransition, useId, useState } from "react";
import * as Rac from "react-aria-components";
import { useAsyncList } from "react-stately";

import { api, fetchClient } from "../../api";
import { errorToast } from "../../lib/error-toast";
import { Button, buttonStyles } from "../../ui/button";
import { Checkbox } from "../../ui/checkbox";
import * as Dialog from "../../ui/dialog";
import { IconChevronLeft } from "../../ui/icons/chevron-left";
import { IconChevronRight } from "../../ui/icons/chevron-right";
import { IconChevronsUpDown } from "../../ui/icons/chevrons-up-down";
import { IconPlus } from "../../ui/icons/plus";
import { Error, Input, LabelWrapper, inputStyles, labelStyles } from "../../ui/input";
import { Link } from "../../ui/link";
import { Spinner } from "../../ui/spinner";
import { TooltipContent } from "../../ui/tooltip";
import { useDialog } from "../../ui/use-dialog";
import { useLocaleStuff } from "../use-formatting";

export default function NewTxPage() {
	const mutation = api.useMutation("post", "/transactions");

	function handleSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();

		const data = new FormData(e.currentTarget);

		mutation
			.mutateAsync({
				body: {
					date: new Date(data.get("date") as string).toISOString(),
					amount: Number(data.get("amount") as unknown as string),
					counter_party: data.get("counterParty") as unknown as string,
					additional: data.get("additional") as unknown as string,
					account: data.get("account") as string | null,
					category: data.get("category") as string | null,
				},
			})
			.then(() => {
				e.target.counterParty.value = "";
				e.target.amount.value = "";
				e.target.additional.value = "";
				e.target.counterParty.focus();
			});
	}

	return (
		<main className="w-full max-w-[320px]">
			<div className="flex justify-between gap-3">
				<h1 className="mb-4 text-lg font-medium">new transaction</h1>
				<Link href="/txs/import">import</Link>
			</div>

			<form className="w-full space-y-6" onSubmit={handleSubmit}>
				<Input name="counterParty" label="counter party" autoComplete="off" />

				<Input name="amount" label="amount" autoComplete="off" />

				<DateField name="date" label="date" granularity="minute" />

				<Input name="additional" label="additional" autoComplete="off" />

				<div className="flex items-end gap-3">
					<CategoryField name="category" label="category" />

					<CreateCategory />
				</div>

				<div className="flex items-end gap-3">
					<AccountField name="account" label="account" />

					<CreateAccount />
				</div>

				<div className="mt-6 flex justify-end">
					<Button isLoading={mutation.isPending}>add</Button>
				</div>
			</form>
		</main>
	);
}

export function DateField({
	name,
	label,
	error,
	defaultValue = new Date(),
	granularity,
}: {
	name: string;
	label: string;
	error?: string;
	defaultValue?: Date;
	granularity: "second" | "minute";
}) {
	const { hourCycle } = useLocaleStuff();
	const _defaultValue = parseDateTime(format(defaultValue, "yyyy-MM-dd'T'HH:mm:ss"));

	const id = useId();
	const errorId = error ? id + "-error" : undefined;

	const calCellStyles =
		buttonStyles({ variant: "ghost", size: "icon" }) + " data-selected:bg-gray-a4";

	return (
		<Rac.DatePicker
			granularity={granularity}
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
	label,
	name,
	error,
	defaultValue,
	allowCreate = true,
}: {
	name: string;
	label: string;
	error?: string;
	defaultValue?: {
		id: string;
		name: string;
	} | null;
	allowCreate?: boolean;
}) {
	const [s, setS] = useState<{
		value: string;
		label: string;
	} | null>(defaultValue ? { value: defaultValue.id, label: defaultValue.name } : null);

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
			return;
		}

		setS({ label: existing.name, value: existing.id });
	}

	const id = useId();
	const errorId = error ? id + "-error" : undefined;

	return (
		<div className="w-full">
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
						<ak.SelectLabel className={labelStyles}>{label}</ak.SelectLabel>

						{error && errorId && <Error id={errorId}>{error}</Error>}
					</LabelWrapper>

					<ak.Select
						name={name}
						className={
							"focus2 border-gray-6 flex h-10 w-full items-center justify-between border"
						}
					>
						<span className="ps-3">{s?.label ?? "select an account"}</span>

						<IconChevronsUpDown className="text-gray-a11 me-2 size-5" />
					</ak.Select>

					<ak.SelectPopover
						gutter={4}
						sameWidth
						className="bg-gray-1 border-gray-4 z-10 w-full max-w-[300px] min-w-(--popover-anchor-width) border outline-hidden"
					>
						<div className="relative">
							<ak.Combobox
								className="border-gray-a4 w-full px-3 py-2 outline-hidden"
								autoSelect
								placeholder="search accounts..."
							/>

							{list.isLoading && (
								<div className="absolute top-2 right-2">
									<Spinner />
								</div>
							)}
						</div>

						<ak.ComboboxList>
							{list.items.map((x) => (
								<SelectComboItem key={x.name} value={x.id}>
									{x.name}
								</SelectComboItem>
							))}
						</ak.ComboboxList>
					</ak.SelectPopover>
				</ak.SelectProvider>
			</ak.ComboboxProvider>
		</div>
	);
}

export function CreateAccount() {
	const mutation = api.useMutation("post", "/accounts");
	const d = useDialog();

	function handleSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		e.stopPropagation();

		const name = new FormData(e.currentTarget).get("name");

		mutation
			.mutateAsync({
				body: { name },
			})
			.then(() => {
				d.close();
			})
			.catch(errorToast("error creating account"));
	}

	return (
		<Dialog.Root {...d.props}>
			<Tooltip.Root>
				<Tooltip.Trigger asChild>
					<Dialog.Trigger asChild>
						<Button size="icon">
							<IconPlus />
						</Button>
					</Dialog.Trigger>
				</Tooltip.Trigger>

				<TooltipContent>new account</TooltipContent>
			</Tooltip.Root>

			<Dialog.Content>
				<Dialog.Title>new account</Dialog.Title>

				<form className="mt-4 space-y-6" onSubmit={handleSubmit}>
					<Input label="name" name="name" autoComplete="off" />

					<div className="flex justify-end gap-3">
						<Dialog.Close asChild>
							<Button variant="ghost">cancel</Button>
						</Dialog.Close>

						<Button type="submit" isLoading={mutation.isPending}>
							add
						</Button>
					</div>
				</form>
			</Dialog.Content>
		</Dialog.Root>
	);
}

export function CreateCategory() {
	const qc = useQueryClient();
	const mutation = api.useMutation("post", "/categories", {
		onSuccess: () => {
			qc.invalidateQueries(api.queryOptions("get", "/categories"));
		},
	});
	const d = useDialog();

	function handleSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();
		e.stopPropagation();
		const data = new FormData(e.currentTarget);

		const name = data.get("name");
		const isNeutral = data.get("isNeutral");

		mutation
			.mutateAsync({
				body: { name, is_neutral: isNeutral === "on" },
			})
			.then(() => {
				d.close();
			})
			.catch(errorToast("error creating category"));
	}

	return (
		<Dialog.Root {...d.props}>
			<Tooltip.Root>
				<Tooltip.Trigger asChild>
					<Dialog.Trigger asChild>
						<Button size="icon">
							<IconPlus />
						</Button>
					</Dialog.Trigger>
				</Tooltip.Trigger>

				<TooltipContent>new category</TooltipContent>
			</Tooltip.Root>
			<Dialog.Content>
				<Dialog.Title>new category</Dialog.Title>

				<form className="mt-4 space-y-6" onSubmit={handleSubmit}>
					<Input label="name" name="name" autoComplete="off" />

					<Checkbox label="is neutral" name="isNeutral" />

					<div className="flex justify-end gap-3">
						<Dialog.Close asChild>
							<Button variant="ghost">cancel</Button>
						</Dialog.Close>

						<Button type="submit" isLoading={mutation.isPending}>
							add
						</Button>
					</div>
				</form>
			</Dialog.Content>
		</Dialog.Root>
	);
}

export function CategoryField({
	name,
	label,
	error,
	defaultValue,
}: {
	name: string;
	label?: string;
	error?: string;
	defaultValue?: null | {
		id: string;
		name: string;
	};
}) {
	const [s, setS] = useState<{
		value: string;
		label: string;
	} | null>(defaultValue ? { value: defaultValue.id, label: defaultValue.name } : null);

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
			return;
		}
		setS({ label: existing.name, value: existing.id });
	}

	const id = useId();
	const errorId = error ? id + "-error" : undefined;

	return (
		<div className="w-full">
			<ak.ComboboxProvider
				value={list.filterText}
				setValue={(val) => {
					startTransition(() => {
						list.setFilterText(val);
					});
				}}
			>
				<ak.SelectProvider setValue={onSelect} value={s?.value ?? ""}>
					{!!label && (
						<LabelWrapper>
							<ak.SelectLabel className={labelStyles}>{label}</ak.SelectLabel>

							{error && errorId && <Error id={errorId}>{error}</Error>}
						</LabelWrapper>
					)}

					<ak.Select
						name={name}
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
						className="bg-gray-1 border-gray-4 z-10 w-[300px] min-w-(--popover-anchor-width) border outline-hidden"
					>
						<div className="relative">
							<ak.Combobox
								className="border-gray-a4 w-full px-3 py-2 outline-hidden"
								autoSelect
								placeholder="search categories..."
							/>

							{list.isLoading && (
								<div className="absolute top-2 right-2">
									<Spinner />
								</div>
							)}
						</div>

						<ak.ComboboxList>
							{list.items.map((x) => (
								<SelectComboItem key={x.name} value={x.id}>
									{x.name}
								</SelectComboItem>
							))}
						</ak.ComboboxList>
					</ak.SelectPopover>
				</ak.SelectProvider>
			</ak.ComboboxProvider>
		</div>
	);
}

export function SelectComboItem(props: ak.SelectItemProps) {
	return (
		<ak.SelectItem
			{...props}
			render={({ children, ...props }) => (
				<ak.ComboboxItem
					{...props}
					className="data-active-item:bg-gray-a4 flex items-center gap-3 p-2"
				>
					<ak.SelectItemCheck /> {children}
				</ak.ComboboxItem>
			)}
		/>
	);
}
