import { useState } from "react";
import {
	useAccountsQuery,
	useCreateAccountMutation,
	type Account,
} from "../lib/queries/accounts";
import { DEFAULT_CURRENCY, normalizeCurrency, COMMON_CURRENCIES } from "../lib/currency";
import { Button } from "./button";
import { Input } from "./input";
import { Select } from "./select";

type CreateCurrencyMode = "fixed" | "select";

export function AccountSelectCreate({
	value,
	onChange,
	onAccountResolved,
	name = "account_id",
	label = "account",
	required = true,
	disabled = false,
	createCurrencyMode = "select",
	fixedCreateCurrency = DEFAULT_CURRENCY,
}: {
	value: string;
	onChange: (accountId: string) => void;
	onAccountResolved?: (account: Account | null) => void;
	name?: string;
	label?: string;
	required?: boolean;
	disabled?: boolean;
	createCurrencyMode?: CreateCurrencyMode;
	fixedCreateCurrency?: string;
}) {
	const accounts = useAccountsQuery();
	const createAccount = useCreateAccountMutation();
	const [showNewAccount, setShowNewAccount] = useState(false);
	const [newAccountName, setNewAccountName] = useState("");
	const [newAccountCurrency, setNewAccountCurrency] = useState(DEFAULT_CURRENCY);

	const effectiveNewAccountCurrency =
		createCurrencyMode === "fixed"
			? normalizeCurrency(fixedCreateCurrency, DEFAULT_CURRENCY)
			: normalizeCurrency(newAccountCurrency, DEFAULT_CURRENCY);

	function handleSelectAccount(accountId: string) {
		onChange(accountId);
		const account = accounts.data?.find((row) => row.id === accountId) ?? null;
		onAccountResolved?.(account);
	}

	async function handleCreateAccount() {
		const name = newAccountName.trim();
		if (!name) return;
		const currency = effectiveNewAccountCurrency;
		const accountId = await createAccount.mutateAsync({
			name,
			currency,
		});

		onChange(accountId);
		onAccountResolved?.({
			id: accountId,
			name,
			currency,
		});

		setNewAccountName("");
		setShowNewAccount(false);
	}

	return (
		<div>
			<div className="mb-1 flex items-center justify-between">
				<label className="text-gray-11 text-xs">{label}</label>
				<button
					type="button"
					className="text-gray-11 text-xs underline"
					disabled={disabled || createAccount.isPending}
					onClick={() => setShowNewAccount((current) => !current)}
				>
					{showNewAccount ? "cancel" : "+ new"}
				</button>
			</div>

			{showNewAccount ? (
				<div className="flex gap-1">
					<Input
						type="text"
						className="flex-1"
						placeholder="name"
						value={newAccountName}
						onChange={(event) => setNewAccountName(event.currentTarget.value)}
						disabled={disabled || createAccount.isPending}
					/>

					{createCurrencyMode === "select" ? (
						<Select
							value={effectiveNewAccountCurrency}
							onChange={(event) =>
								setNewAccountCurrency(
									normalizeCurrency(
										event.currentTarget.value,
										effectiveNewAccountCurrency,
									),
								)
							}
							className="w-24"
							disabled={disabled || createAccount.isPending}
						>
							{COMMON_CURRENCIES.map((code) => (
								<option key={code} value={code}>
									{code}
								</option>
							))}
						</Select>
					) : null}

					<Button
						size="sm"
						type="button"
						onClick={handleCreateAccount}
						isLoading={createAccount.isPending}
						disabled={disabled || createAccount.isPending || !newAccountName.trim()}
					>
						add
					</Button>
				</div>
			) : (
				<Select
					name={name}
					className="w-full"
					required={required}
					value={value}
					onChange={(event) => handleSelectAccount(event.currentTarget.value)}
					disabled={disabled}
				>
					<option value="">select...</option>
					{accounts.data?.map((account) => (
						<option key={account.id} value={account.id}>{`${account.name} (${account.currency})`}</option>
					))}
				</Select>
			)}
		</div>
	);
}
