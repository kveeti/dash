import { Dialog } from "@base-ui/react/dialog";
import {
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
import { DEFAULT_CURRENCY, normalizeCurrency, COMMON_CURRENCIES } from "../lib/currency";
import { PopupCombobox } from "./popup-combobox";
import { Select } from "./select";
import { Input } from "./input";

type AccountItem = {
	value: string;
	label: string;
	currency?: string;
	creatable?: string;
};

export function AccountSelectCreate({
	defaultValue,
	onChange,
	name = "account_id",
	label = "account",
	required = true,
	disabled = false,
	defaultCreateCurrency = DEFAULT_CURRENCY,
}: {
	defaultValue?: string;
	onChange?: (account: Account | null) => void;
	name?: string;
	label?: string;
	required?: boolean;
	disabled?: boolean;
	defaultCreateCurrency?: string;
}) {
	const accounts = useAccountsQuery();
	const createAccount = useCreateAccountMutation();
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

	const accountRows = accounts.data ?? [];

	const selectedItem = useMemo<AccountItem | null>(() => {
		const account = accountRows.find((row) => row.id === selectedAccountValue);
		if (!account) {
			if (!selectedAccountValue) return null;
			return {
				value: selectedAccountValue,
				label: selectedAccountValue,
			};
		}
		return {
			value: account.id,
			label: account.name,
			currency: account.currency,
		};
	}, [accountRows, selectedAccountValue]);

	const baseItems = accountRows.map<AccountItem>((account) => ({
		value: account.id,
		label: account.name,
		currency: account.currency,
	}));

	function handleSelectAccount(account: Account | null) {
		const nextId = account?.id ?? "";
		if (hiddenAccountIdRef.current) {
			hiddenAccountIdRef.current.value = nextId;
		}
		setSelectedAccountValue(nextId);
		onChange?.(account);
	}

	function openCreateDialog(rawName: string) {
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
	}

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
			<label className="text-gray-11 mb-1 block text-xs">{label}</label>
			<input
				ref={hiddenAccountIdRef}
				type="hidden"
				name={name}
				value={selectedAccountValue}
				readOnly
			/>
			<PopupCombobox
				items={baseItems}
				value={selectedItem}
				onValueChange={(next) => {
					if (!next) {
						handleSelectAccount(null);
						return;
					}
					const account = accountRows.find((row) => row.id === next.value) ?? null;
					handleSelectAccount(account);
				}}
				getItemKey={(item) => item.value}
				itemToStringLabel={(item) => item.label}
				isItemEqualToValue={(item, selected) => item.value === selected.value}
				creatable={{
					createItem: (rawQuery) => ({
						value: `create:${rawQuery.toLocaleLowerCase()}`,
						label: `Create "${rawQuery}"`,
						creatable: rawQuery,
					}),
					isCreateItem: (item) => Boolean(item.creatable),
					isExistingItemMatch: (item, normalizedQuery) =>
						item.label.trim().toLocaleLowerCase() === normalizedQuery,
					onCreateRequest: openCreateDialog,
					getCreateQuery: (item) => item.creatable ?? "",
				}}
				renderItem={(item) => (
					item.creatable ? (
						<div className="flex w-full items-center justify-between gap-2">
							<span className="truncate">Create "{item.creatable}"</span>
							<span className="text-xs text-gray-10">new</span>
						</div>
					) : (
						<div className="flex w-full items-center justify-between gap-2">
							<span className="truncate">{item.label}</span>
							<span className="shrink-0 text-xs text-gray-10">
								{item.currency}
							</span>
						</div>
					)
				)}
				required={required}
				disabled={disabled}
				placeholder={"select account..."}
				inputPlaceholder="search accounts..."
				size="default"
				emptyState={(
					<p className="h-8 flex items-center px-3 text-gray-10">
						No accounts found.
					</p>
				)}
			/>

			<Dialog.Root open={openDialog} onOpenChange={setOpenDialog}>
				<Dialog.Portal>
					<Dialog.Backdrop className="data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 opacity-50 transition-opacity duration-100 ease-[cubic-bezier(0.43,0.07,0.59,0.94)] bg-gray-10 dark:bg-[black] supports-[-webkit-touch-callout:none]:absolute fixed inset-0" />
					<Dialog.Popup
						initialFocus={createInputRef}
						className="duration-100 ease-[cubic-bezier(0.43,0.07,0.59,0.94)] data-[starting-style]:scale-95 data-[starting-style]:opacity-0 data-[ending-style]:scale-95 data-[ending-style]:opacity-0 transition-all bg-gray-1 border-gray-a5 fixed top-1/2 left-1/2 w-[24rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 border p-4"
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
								className="focus border-gray-6 bg-gray-1 h-10 w-full border px-3 outline-none"
								defaultValue={createFormDefaults.name}
								onKeyDownCapture={(event) => {
									if (event.key === "Enter") event.stopPropagation();
								}}
								label="Account name"
								name="account-name"
								required
							/>
							<Input
								className="focus border-gray-6 bg-gray-1 h-10 w-full border px-3 outline-none"
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
								disabled={createAccount.isPending}
							>
								{COMMON_CURRENCIES.map((code) => (
									<option key={code} value={code}>
										{code}
									</option>
								))}
							</Select>
							<div className="flex justify-end gap-2">
								<Dialog.Close
									type="button"
									className="focus border-gray-6 bg-gray-1 h-8 border px-3 text-xs"
								>
									cancel
								</Dialog.Close>
								<button
									type="submit"
									className="focus border-gray-6 bg-gray-1 h-8 border px-3 text-xs"
									disabled={createAccount.isPending}
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
