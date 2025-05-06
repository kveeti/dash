import { parseDateTime } from "@internationalized/date";
import { CalendarIcon } from "@radix-ui/react-icons";
import { format } from "date-fns";
import { useDeferredValue, useId, useState } from "react";
import * as Rac from "react-aria-components";
import { useAsyncList } from "react-stately";

import { api, fetchClient } from "../../api";
import { Button, buttonStyles } from "../../ui/button";
import { IconCheck } from "../../ui/icons/check";
import { IconChevronLeft } from "../../ui/icons/chevron-left";
import { IconChevronRight } from "../../ui/icons/chevron-right";
import { Error, Input, LabelWrapper, inputStyles, labelStyles } from "../../ui/input";
import { useLocaleStuff } from "../use-formatting";

// maybe support creating accounts and categories
// with a plus button & dialog instead of this monstrosity
// this works tho
const custom = "__CUSTOM__DO__NOT__USE__OR__YOU__WILL__BE__FIRED__";

export default function NewTransaction() {
	const mutation = api.useMutation("post", "/transactions");
	const [localErrors, setLocalErrors] = useState<Record<string, string> | null>(null);
	const [serverErrors, setServerErrors] = useState<Record<string, string> | null>(null);

	function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (mutation.isPending) return;

		const formData = new FormData(e.currentTarget);
		const data = Object.fromEntries(formData);

		const input = {
			counter_party: data.counter_party,
			amount: Number(data.amount),
			date: new Date(data.date).toISOString(),
			additional: data.additional,
			// i dont like this
			category_name: data.category_name.replace(custom, ""),
			account_name: data.account_name.replace(custom, ""),
		};

		mutation.mutateAsync({ body: input }).catch((error) => {
			setServerErrors(error.response.data.errors);
		});
	}

	const errors = serverErrors ?? localErrors;

	return (
		<main className="w-full max-w-[320px]">
			<h1 className="mb-4 text-lg font-medium">new transaction</h1>

			<form className="w-full" onSubmit={handleSubmit}>
				<fieldset className="space-y-3">
					<Input
						label="counter party"
						name="counter_party"
						error={errors?.counter_party}
					/>
					<Input label="amount" name="amount" error={errors?.amount} />
					<DateField label="date" name="date" error={errors?.date} />
					<CategoryField
						label="category"
						name="category_name"
						error={errors?.category_name}
					/>
					<Input label="additional" name="additional" error={errors?.additional} />
					<AccountField label="account" name="account_name" />
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

function AccountField({ name, label, error }: { name?: string; label: string; error?: string }) {
	const id = useId();
	const errorId = error ? id + "-error" : undefined;

	let { contains } = Rac.useFilter({ sensitivity: "base" });

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

	const [selectedKey, setSelectedKey] = useState<string | null>(null);

	// i dont like this
	const items = useDeferredValue([
		...list.items,
		...(!list.items.length ? [{ id: custom, name: `create "${list.filterText}"` }] : []),
	]);
	function onSelectionChange(key: string) {
		if (key === custom) {
			list.remove(key);
			const newKey = custom + list.filterText;
			list.insert(0, {
				id: newKey,
				name: list.filterText,
			});
			setSelectedKey(newKey);
			return;
		}

		setSelectedKey(key);
	}

	return (
		<Rac.Select
			name={name}
			placeholder="select an account"
			selectedKey={selectedKey}
			onSelectionChange={onSelectionChange}
		>
			<LabelWrapper>
				<Rac.Label className={labelStyles}>{label}</Rac.Label>

				{error && errorId && <Error id={errorId}>{error}</Error>}
			</LabelWrapper>

			<Rac.Button className={buttonStyles({ variant: "outline" }) + " w-full justify-start"}>
				<Rac.SelectValue />
			</Rac.Button>

			<Rac.Popover className="bg-gray-1 border-gray-4 w-(--trigger-width) border outline-hidden">
				<Rac.Autocomplete
					inputValue={list.filterText}
					onInputChange={list.setFilterText}
					filter={contains}
				>
					<Rac.TextField aria-label="search accounts...">
						<Rac.Input
							placeholder="search accounts..."
							autoFocus
							className="border-gray-4 h-10 w-full border-b px-3 outline-hidden placeholder:opacity-80"
						/>
					</Rac.TextField>

					<Rac.ListBox className="w-full" items={items}>
						{(thing) => <SelectItem>{thing.name}</SelectItem>}
					</Rac.ListBox>
				</Rac.Autocomplete>
			</Rac.Popover>
		</Rac.Select>
	);
}

function CategoryField({ name, label, error }: { name?: string; label: string; error?: string }) {
	const id = useId();
	const errorId = error ? id + "-error" : undefined;

	let { contains } = Rac.useFilter({ sensitivity: "base" });

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

	const [selectedKey, setSelectedKey] = useState<string | null>(null);

	// i dont like this
	const items = useDeferredValue([
		...list.items,
		...(!list.items.length ? [{ id: custom, name: `create "${list.filterText}"` }] : []),
	]);
	function onSelectionChange(key: string) {
		if (key === custom) {
			list.remove(key);
			const newKey = custom + list.filterText;
			list.insert(0, {
				id: newKey,
				name: list.filterText,
			});
			setSelectedKey(newKey);
			return;
		}

		setSelectedKey(key);
	}

	return (
		<Rac.Select
			name={name}
			placeholder="select a category"
			selectedKey={selectedKey}
			onSelectionChange={onSelectionChange}
		>
			<LabelWrapper>
				<Rac.Label className={labelStyles}>{label}</Rac.Label>

				{error && errorId && <Error id={errorId}>{error}</Error>}
			</LabelWrapper>

			<Rac.Button className={buttonStyles({ variant: "outline" }) + " w-full justify-start"}>
				<Rac.SelectValue />
			</Rac.Button>

			<Rac.Popover className="bg-gray-1 border-gray-4 w-(--trigger-width) border outline-hidden">
				<Rac.Autocomplete
					inputValue={list.filterText}
					onInputChange={list.setFilterText}
					filter={contains}
				>
					<Rac.TextField aria-label="search categories...">
						<Rac.Input
							placeholder="search categories..."
							autoFocus
							className="border-gray-4 h-10 w-full border-b px-3 outline-hidden placeholder:opacity-80"
						/>
					</Rac.TextField>

					<Rac.ListBox className="w-full" items={items}>
						{(thing) => <SelectItem>{thing.name}</SelectItem>}
					</Rac.ListBox>
				</Rac.Autocomplete>
			</Rac.Popover>
		</Rac.Select>
	);
}
function SelectItem(props: Rac.ListBoxItemProps & { children: string }) {
	return (
		<Rac.ListBoxItem
			{...props}
			textValue={props.children}
			className="group focus:bg-gray-a5 data-focused:bg-gray-a4 flex w-full cursor-default items-center gap-2 px-4 py-2 outline-hidden select-none"
		>
			{({ isSelected }) => (
				<>
					<span className="flex flex-1 items-center gap-2 truncate">
						{props.children}
					</span>
					<span className="flex w-5 items-center">{isSelected && <IconCheck />}</span>
				</>
			)}
		</Rac.ListBoxItem>
	);
}
