import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { Input } from "./input";
import { Select } from "./select";
import { Textarea } from "./textarea";
import { DateTimePickerInput } from "./date-picker";
import {
	localSearchSource,
	UnstableCombobox,
	type UnstableComboboxConfig,
	type UnstableComboboxItem,
} from "./unstable-combobox";
import {
	useCategoryOptionsQuery,
	useCreateCategoryMutation,
} from "../lib/queries/categories";
import {
	DEFAULT_CURRENCY,
	normalizeCurrency,
} from "../lib/currency";
import { useCurrencyMetaQuery } from "../lib/queries/currencies";
import {
	useAccountsQuery,
	useCreateAccountMutation,
	type Account,
} from "../lib/queries/accounts";
import { IconChevronsUpDown } from "./icons/chevrons-up-down";
import * as Dialog from "./dialog";
import { buttonStyles } from "./button";
import { useTransientOptions } from "./use-transient-options";

export type TxFormValues = {
	date: string;
	amount: string;
	currency: string;
	counter_party: string;
	additional?: string;
	notes?: string;
	category_id?: string;
	account_id: string;
};

export type TxFormDefaults = {
	date?: Date;
	amount?: number;
	currency?: string;
	counter_party?: string;
	additional?: string;
	notes?: string;
	category_id?: string;
	account_id?: string;
};

export function TransactionForm({
	defaultValues,
	onSubmit,
	isSubmitting = false,
	actions,
}: {
	defaultValues?: TxFormDefaults;
	onSubmit: (values: TxFormValues) => Promise<void>;
	isSubmitting?: boolean;
	actions: ReactNode;
}) {
	const categories = useCategoryOptionsQuery();
	const currencyMeta = useCurrencyMetaQuery();
	const [currency, setCurrency] = useState(
		normalizeCurrency(defaultValues?.currency, DEFAULT_CURRENCY),
	);
	const currencyOptions = useMemo(() => {
		const options = (currencyMeta.data?.map((meta) => meta.currency) ?? [DEFAULT_CURRENCY]);
		if (!options.includes(currency)) {
			options.unshift(currency);
		}
		return options;
	}, [currency, currencyMeta.data]);
	const amountStep = useMemo(() => {
		const minorUnit =
			currencyMeta.data?.find((meta) => meta.currency === currency)?.minor_unit ?? 2;
		return minorUnit === 0 ? "1" : `0.${"0".repeat(Math.max(0, minorUnit - 1))}1`;
	}, [currency, currencyMeta.data]);

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (isSubmitting) return;
		const data = new FormData(e.currentTarget);

		const accountId = (data.get("account_id") as string) || "";
		if (!accountId) {
			alert("select an account");
			return;
		}

		await onSubmit({
			date: new Date(data.get("date") as string).toISOString(),
			amount: String(data.get("amount") ?? ""),
			counter_party: data.get("counter_party") as string,
			additional: (data.get("additional") as string) || undefined,
			notes: (data.get("notes") as string) || undefined,
			currency: normalizeCurrency(data.get("currency") as string, currency),
			category_id: (data.get("category_id") as string) || undefined,
			account_id: accountId,
		});
	}

	const defaultDate = defaultValues?.date
		? dateToDatetimeLocal(defaultValues.date)
		: currentDatetimeLocal();

	return (
		<form className="space-y-3" onSubmit={handleSubmit}>
			<div className="grid grid-cols-2 gap-3">
				<Input
					label="counter party"
					name="counter_party"
					type="text"
					className="w-full"
					required
					autoComplete="off"
					defaultValue={defaultValues?.counter_party}
				/>
				<Input
					label="amount"
					name="amount"
					type="number"
					step={amountStep}
					className="w-full"
					required
					defaultValue={defaultValues?.amount?.toString()}
				/>
			</div>

			<div className="grid grid-cols-2 gap-3">
				<DateTimePickerInput
					label="date"
					name="date"
					className="w-full"
					defaultValue={defaultDate}
					required
				/>
				<Select
					label="currency"
					name="currency"
					value={currency}
					onChange={(e) => {
						setCurrency(normalizeCurrency(e.currentTarget.value, currency));
					}}
				>
					{currencyOptions.map((code) => (
						<option key={code} value={code}>
							{code}
						</option>
					))}
				</Select>
			</div>

			<div className="grid grid-cols-2 gap-3">
				<TransactionCategoryCombobox
					label="category"
					name="category_id"
					defaultValue={defaultValues?.category_id}
					placeholder="select category..."
					items={
						categories.data?.map((category) => ({
							id: category.id,
							label: category.name,
						})) ?? []
					}
					className="w-full"
				/>
				<TransactionAccountCombobox
					label="account"
					name="account_id"
					defaultValue={defaultValues?.account_id}
					defaultCreateCurrency={currency}
					onChange={(account) => {
						if (!account) return;
						setCurrency(normalizeCurrency(account.currency));
					}}
				/>
			</div>

			<Textarea label="additional" name="additional" className="w-full" rows={2} defaultValue={defaultValues?.additional} />
			<Textarea label="notes" name="notes" className="w-full" rows={2} defaultValue={defaultValues?.notes} />

			<div className="flex justify-end gap-2">
				{actions}
			</div>
		</form>
	);
}

type CategoryItem = {
	id: string;
	label: string;
};

function categoryItemKey(item: CategoryItem) {
	return item.id;
}

function TransactionCategoryCombobox({
	className,
	defaultValue,
	disabled = false,
	items,
	label,
	name,
	placeholder = "select category...",
	required = false,
}: {
	className?: string;
	defaultValue?: string;
	disabled?: boolean;
	items: CategoryItem[];
	label?: string;
	name?: string;
	placeholder?: string;
	required?: boolean;
}) {
	const createCategory = useCreateCategoryMutation();
	const [selectedCategoryValue, setSelectedCategoryValue] = useState(
		defaultValue ?? "",
	);
	const categoryOptions = useTransientOptions(
		items,
		categoryItemKey,
		useCallback(
			(item: CategoryItem) => item.id === selectedCategoryValue,
			[selectedCategoryValue],
		),
	);
	const selectedItem =
		categoryOptions.options.find((item) => item.id === selectedCategoryValue) ??
		null;

	const createCategoryFromQuery = useCallback(
		async (rawName: string) => {
			if (createCategory.isPending) return;

			const name = rawName.trim();
			if (!name) return;

			const existing = categoryOptions.options.find(
				(item) => item.label.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
			);
			if (existing) {
				setSelectedCategoryValue(existing.id);
				return;
			}

			const newId = await createCategory.mutateAsync({
				name,
				is_neutral: false,
			});
			categoryOptions.add({ id: newId, label: name });
			setSelectedCategoryValue(newId);
		},
		[categoryOptions, createCategory],
	);

	const config = useMemo<UnstableComboboxConfig>(() => {
		const categoryItems: UnstableComboboxItem[] = categoryOptions.options.map(
			(item) => ({
				id: item.id,
				label: item.label,
				checked: item.id === selectedCategoryValue,
				onSelect: ({ close }) => {
					setSelectedCategoryValue(item.id);
					close();
				},
			}),
		);

		return {
			pages: {
				root: {
					id: "root",
					title: "category",
					placeholder: "search categories...",
					empty: "No categories found.",
					items: categoryItems,
					queryNodes: [
						{
							id: "create-category",
							placement: "after-results",
							when: ({ query, hasExactMatch }) =>
								query.trim().length > 0 && !hasExactMatch(),
							getNodes: ({ normalizedQuery, query }) => [
								{
									type: "group",
									id: "create-category",
									label: "Create",
									items: [
										{
											id: `category:create:${normalizedQuery}`,
											label: `Create "${query.trim()}"`,
											textValue: query,
											onSelect: ({ close }) => {
												close();
												void createCategoryFromQuery(query);
											},
										},
									],
								},
							],
						},
					],
					search: {
						sources: [
							localSearchSource({
								id: "category",
								items: categoryItems,
							}),
						],
					},
				},
			},
		};
	}, [categoryOptions.options, createCategoryFromQuery, selectedCategoryValue]);

	const root = (
		<>
			{name && (
				<input
					type="hidden"
					name={name}
					value={selectedCategoryValue}
					required={required}
					readOnly
				/>
			)}
			<UnstableCombobox
				config={config}
				trigger={({ open }) => (
					<button
						type="button"
						disabled={disabled}
						className={
							"focus field-trigger data-[disabled]:opacity-60 flex h-9 w-full min-w-0 items-center justify-between gap-2 overflow-hidden pl-2.5 pr-2 text-sm" +
							(className ? ` ${className}` : "")
						}
						data-disabled={disabled ? "" : undefined}
						aria-expanded={open}
					>
						<span className="truncate text-gray-12">
							{selectedItem?.label ?? (
								<span className="text-gray-10">{placeholder}</span>
							)}
						</span>
						<span className="text-gray-10 flex shrink-0">
							<IconChevronsUpDown />
						</span>
					</button>
				)}
			/>
		</>
	);

	if (!label) return root;

	return (
		<div>
			<label className="field-label">{label}</label>
			{root}
		</div>
	);
}

type AccountItem = {
	value: string;
	label: string;
	currency?: string;
	account?: Account;
};

function accountItemKey(item: AccountItem) {
	return item.value;
}

function TransactionAccountCombobox({
	defaultCreateCurrency = DEFAULT_CURRENCY,
	defaultValue,
	disabled = false,
	label = "account",
	name = "account_id",
	onChange,
	required = true,
}: {
	defaultCreateCurrency?: string;
	defaultValue?: string;
	disabled?: boolean;
	label?: string;
	name?: string;
	onChange?: (account: Account | null) => void;
	required?: boolean;
}) {
	const accounts = useAccountsQuery();
	const createAccount = useCreateAccountMutation();
	const currencyMeta = useCurrencyMetaQuery();
	const [selectedAccountValue, setSelectedAccountValue] = useState(
		defaultValue ?? "",
	);
	const [openDialog, setOpenDialog] = useState(false);
	const [createFormDefaults, setCreateFormDefaults] = useState({
		name: "",
		externalId: "",
		currency: normalizeCurrency(defaultCreateCurrency, DEFAULT_CURRENCY),
	});
	const accountRows = useMemo(() => accounts.data ?? [], [accounts.data]);
	const currencyCodes =
		currencyMeta.data?.map((meta) => meta.currency) ?? [
			createFormDefaults.currency,
		];
	const baseItems = useMemo(
		() =>
			accountRows.map<AccountItem>((account) => ({
				value: account.id,
				label: account.name,
				currency: account.currency,
				account,
			})),
		[accountRows],
	);
	const accountOptions = useTransientOptions(
		baseItems,
		accountItemKey,
		useCallback(
			(item: AccountItem) => item.value === selectedAccountValue,
			[selectedAccountValue],
		),
	);
	const selectedItem = useMemo<AccountItem | null>(() => {
		const account = accountOptions.options.find(
			(item) => item.value === selectedAccountValue,
		);
		if (account) return account;
		if (!selectedAccountValue) return null;
		return { value: selectedAccountValue, label: selectedAccountValue };
	}, [accountOptions.options, selectedAccountValue]);

	const handleSelectAccount = useCallback((account: Account | null) => {
		setSelectedAccountValue(account?.id ?? "");
		onChange?.(account);
	}, [onChange]);

	const openCreateDialog = useCallback(
		(rawName: string) => {
			setCreateFormDefaults({
				name: rawName.trim(),
				externalId: "",
				currency: normalizeCurrency(defaultCreateCurrency, DEFAULT_CURRENCY),
			});
			setOpenDialog(true);
		},
		[defaultCreateCurrency],
	);

	async function createAccountFromDialog(input: {
		name: string;
		externalId: string;
		currency: string;
	}) {
		if (createAccount.isPending) return;
		const accountName = input.name.trim();
		if (!accountName) return;

		const normalized = accountName.toLocaleLowerCase();
		const existing = accountRows.find(
			(account) => account.name.trim().toLocaleLowerCase() === normalized,
		);
		if (existing) {
			handleSelectAccount(existing);
			setOpenDialog(false);
			return;
		}

		const currency = normalizeCurrency(input.currency, DEFAULT_CURRENCY);
		const externalId = input.externalId.trim() || null;
		const accountId = await createAccount.mutateAsync({
			name: accountName,
			currency,
			external_id: externalId,
		});
		const created: Account = {
			id: accountId,
			name: accountName,
			currency,
			external_id: externalId,
			code: "",
		};
		accountOptions.add({
			value: accountId,
			label: accountName,
			currency,
			account: created,
		});
		handleSelectAccount(created);
		setOpenDialog(false);
	}

	function handleCreateAccountSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		event.stopPropagation();
		const data = new FormData(event.currentTarget);
		void createAccountFromDialog({
			name: String(data.get("account-name") ?? ""),
			externalId: String(data.get("account-external-id") ?? ""),
			currency: String(data.get("account-currency") ?? createFormDefaults.currency),
		});
	}

	const config = useMemo<UnstableComboboxConfig>(() => {
		const accountItems: UnstableComboboxItem[] = accountOptions.options.map(
			(item) => ({
				id: item.value,
				label: item.label,
				description: item.currency,
				keywords: item.currency ? [item.currency] : undefined,
				checked: item.value === selectedAccountValue,
				onSelect: ({ close }) => {
					handleSelectAccount(item.account ?? null);
					close();
				},
			}),
		);

		return {
			pages: {
				root: {
					id: "root",
					title: "account",
					placeholder: "search accounts...",
					empty: "No accounts found.",
					items: accountItems,
					queryNodes: [
						{
							id: "create-account",
							placement: "after-results",
							when: ({ query, hasExactMatch }) =>
								query.trim().length > 0 && !hasExactMatch(),
							getNodes: ({ normalizedQuery, query }) => [
								{
									type: "group",
									id: "create-account",
									label: "Create",
									items: [
										{
											id: `account:create:${normalizedQuery}`,
											label: `Create "${query.trim()}"`,
											textValue: query,
											onSelect: ({ close }) => {
												close();
												openCreateDialog(query);
											},
										},
									],
								},
							],
						},
					],
					search: {
						sources: [
							localSearchSource({
								id: "account",
								items: accountItems,
							}),
						],
					},
				},
			},
		};
	}, [
		accountOptions.options,
		handleSelectAccount,
		openCreateDialog,
		selectedAccountValue,
	]);

	return (
		<div>
			<label className="field-label">{label}</label>
			<input
				type="hidden"
				name={name}
				value={selectedAccountValue}
				required={required}
				readOnly
			/>
			<UnstableCombobox
				config={config}
				trigger={({ open }) => (
					<button
						type="button"
						disabled={disabled}
						className="focus field-trigger data-[disabled]:opacity-60 flex h-9 w-full min-w-0 items-center justify-between gap-2 overflow-hidden pl-3 pr-2.5 text-sm"
						data-disabled={disabled ? "" : undefined}
						aria-expanded={open}
					>
						<span className="truncate text-gray-12">
							{selectedItem?.label ?? (
								<span className="text-gray-10">select account...</span>
							)}
						</span>
						<span className="text-gray-10 flex shrink-0">
							<IconChevronsUpDown />
						</span>
					</button>
				)}
			/>

			<Dialog.Root open={openDialog} onOpenChange={setOpenDialog}>
				<Dialog.Content>
					<Dialog.Title>Create new account</Dialog.Title>
					<Dialog.Desc className="mt-1 text-xs">
						Add an account and select it.
					</Dialog.Desc>
					<form
						className="mt-3 space-y-3"
						onSubmit={handleCreateAccountSubmit}
					>
						<Input
							autoFocus
							defaultValue={createFormDefaults.name}
							onKeyDownCapture={(event) => {
								if (event.key === "Enter") event.stopPropagation();
							}}
							label="Account name"
							name="account-name"
							required
						/>
						<Input
							defaultValue={createFormDefaults.externalId}
							placeholder="optional, e.g. IBAN"
							name="account-external-id"
							label="External id"
						/>
						<Select
							label="Currency"
							name="account-currency"
							defaultValue={createFormDefaults.currency}
							className="w-full"
						>
							{currencyCodes.map((code) => (
								<option key={code} value={code}>
									{code}
								</option>
							))}
						</Select>
						<div className="flex justify-end gap-2">
							<Dialog.Close
								type="button"
								className={buttonStyles({ variant: "outline", size: "sm" })}
							>
								cancel
							</Dialog.Close>
							<button
								type="submit"
								className={buttonStyles({ variant: "primary", size: "sm" })}
							>
								create
							</button>
						</div>
					</form>
				</Dialog.Content>
			</Dialog.Root>
		</div>
	);
}

function currentDatetimeLocal(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function dateToDatetimeLocal(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
