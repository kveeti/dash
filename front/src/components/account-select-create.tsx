import { Dialog } from "@base-ui/react/dialog";
import {
	useCallback,
	useMemo,
	useRef,
	useState,
	type FormEvent,
} from "react";
import {
	useAccountsQuery,
	useCreateAccountMutation,
	type Account,
} from "../lib/queries/accounts";
import { DEFAULT_CURRENCY, normalizeCurrency } from "../lib/currency";
import { useCurrencyMetaQuery } from "../lib/queries/currencies";
import { IconChevronsUpDown } from "./icons/chevrons-up-down";
import { Select } from "./select";
import { Input } from "./input";
import { buttonStyles } from "./button";
import { useTransientOptions } from "./use-transient-options";
import {
	localSearchSource,
	UnstableCombobox,
	type UnstableComboboxConfig,
	type UnstableComboboxItem,
} from "./unstable-combobox";

type AccountItem = {
	value: string;
	label: string;
	currency?: string;
	account?: Account;
	creatable?: string;
};

function accountItemKey(item: AccountItem) {
	return item.value;
}

function cx(...classes: Array<string | false | null | undefined>) {
	return classes.filter(Boolean).join(" ");
}

export function AccountSelectCreate({
	defaultValue,
	onChange,
	name = "account_id",
	label = "account",
	required = true,
	defaultCreateCurrency = DEFAULT_CURRENCY,
}: {
	defaultValue?: string;
	onChange?: (account: Account | null) => void;
	name?: string;
	label?: string;
	required?: boolean;
	defaultCreateCurrency?: string;
}) {
	const accounts = useAccountsQuery();
	const createAccount = useCreateAccountMutation();
	const currencyMeta = useCurrencyMetaQuery();
	const [selectedAccountValue, setSelectedAccountValue] = useState(defaultValue ?? "");
	const [openDialog, setOpenDialog] = useState(false);
	const [createFormKey, setCreateFormKey] = useState(0);
	const [createFormDefaults, setCreateFormDefaults] = useState({
		name: "",
		externalId: "",
		currency: normalizeCurrency(defaultCreateCurrency, DEFAULT_CURRENCY),
	});
	const hiddenAccountIdRef = useRef<HTMLInputElement | null>(null);
	const createInputRef = useRef<HTMLInputElement | null>(null);

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
	const keepTransientItem = useCallback(
		(item: AccountItem) => item.value === selectedAccountValue,
		[selectedAccountValue],
	);
	const accountOptions = useTransientOptions(
		baseItems,
		accountItemKey,
		keepTransientItem,
	);

	const selectedItem = useMemo<AccountItem | null>(() => {
		const account = accountOptions.options.find(
			(item) => item.value === selectedAccountValue,
		);
		if (account) {
			return account;
		}

		if (!selectedAccountValue) return null;
		return {
			value: selectedAccountValue,
			label: selectedAccountValue,
		};
	}, [accountOptions.options, selectedAccountValue]);
	const handleSelectAccount = useCallback((account: Account | null) => {
		const nextId = account?.id ?? "";
		if (hiddenAccountIdRef.current) {
			hiddenAccountIdRef.current.value = nextId;
		}
		setSelectedAccountValue(nextId);
		onChange?.(account);
	}, [onChange]);

	const openCreateDialog = useCallback((rawName: string) => {
		const defaultCurrency = normalizeCurrency(
			defaultCreateCurrency,
			DEFAULT_CURRENCY,
		);
		setCreateFormDefaults({
			name: rawName,
			externalId: "",
			currency: defaultCurrency,
		});
		setCreateFormKey((prev) => prev + 1);
		setOpenDialog(true);
	}, [defaultCreateCurrency]);

	const config = useMemo<UnstableComboboxConfig>(() => {
		const accountItems = accountOptions.options.map<UnstableComboboxItem>(
			(item) => ({
				id: `account:${item.value}`,
				label: item.label,
				textValue: item.label,
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
			rootPageId: "root",
			pages: {
				root: {
					id: "root",
					title: "account",
					placeholder: "search accounts...",
					empty: "No accounts found.",
					items: accountItems,
					search: {
						sources: [
							localSearchSource({ id: "accounts", items: accountItems }),
						],
					},
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
				},
			},
		};
	}, [
		accountOptions.options,
		handleSelectAccount,
		openCreateDialog,
		selectedAccountValue,
	]);

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

	return (
		<div>
			<label className="field-label">{label}</label>
			<input
				ref={hiddenAccountIdRef}
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
						className={cx(
							"focus field-trigger flex h-9 w-full min-w-0 items-center justify-between gap-2 overflow-hidden pl-3 pr-2.5 text-sm",
							open && "border-gray-a5 bg-gray-a2",
						)}
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
				<Dialog.Portal>
					<Dialog.Backdrop className="data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 transition-opacity duration-150 ease-[cubic-bezier(0.16,1,0.3,1)] bg-gray-a6 dark:bg-black-a7 supports-[-webkit-touch-callout:none]:absolute fixed inset-0" />
					<Dialog.Popup
						initialFocus={createInputRef}
						className="duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0 data-[ending-style]:scale-[0.985] data-[ending-style]:opacity-0 transition-all bg-gray-2 border-gray-a3 fixed top-1/2 left-1/2 w-[24rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 border p-5 shadow-[0_24px_64px_-12px_rgba(0,0,0,0.18),0_2px_8px_-2px_rgba(0,0,0,0.08)] dark:shadow-[0_24px_64px_-12px_rgba(0,0,0,0.7),0_2px_8px_-2px_rgba(0,0,0,0.4)]"
					>
						<Dialog.Title className="text-base font-medium">
							Create new account
						</Dialog.Title>
						<Dialog.Description className="mt-1 text-xs text-gray-10">
							Add an account and select it.
						</Dialog.Description>
						<form
							key={createFormKey}
							className="mt-3 space-y-3"
							onSubmit={handleCreateAccountSubmit}
						>
							<Input
								ref={createInputRef}
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
					</Dialog.Popup>
				</Dialog.Portal>
			</Dialog.Root>
		</div>
	);
}
