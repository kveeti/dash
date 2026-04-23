import { useMemo, useState, type ReactNode } from "react";
import { Input } from "./input";
import { Select } from "./select";
import { Textarea } from "./textarea";
import { DateTimePickerInput } from "./date-picker";
import { AccountSelectCreate } from "./account-select-create";
import { CategoryCombobox } from "./category-combobox";
import { useCategoryOptionsQuery } from "../lib/queries/categories";
import {
	COMMON_CURRENCIES,
	DEFAULT_CURRENCY,
	normalizeCurrency,
} from "../lib/currency";

export type TxFormValues = {
	date: string;
	amount: number;
	currency: string;
	counter_party: string;
	additional?: string;
	notes?: string;
	category_id?: string;
	account_id: string;
};

export type TxFormDefaults = {
	date?: string;
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
	const [selectedCategoryId, setSelectedCategoryId] = useState(
		defaultValues?.category_id ?? "",
	);
	const [currency, setCurrency] = useState(
		normalizeCurrency(defaultValues?.currency, DEFAULT_CURRENCY),
	);
	const currencyOptions = useMemo(() => {
		const options = [...COMMON_CURRENCIES];
		if (!options.includes(currency as (typeof COMMON_CURRENCIES)[number])) {
			options.unshift(currency);
		}
		return options;
	}, [currency]);

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const data = new FormData(e.currentTarget);

		const accountId = (data.get("account_id") as string) || "";
		if (!accountId) {
			alert("select an account");
			return;
		}

		await onSubmit({
			date: new Date(data.get("date") as string).toISOString(),
			amount: Number(data.get("amount")),
			counter_party: data.get("counter_party") as string,
			additional: (data.get("additional") as string) || undefined,
			notes: (data.get("notes") as string) || undefined,
			currency: normalizeCurrency(data.get("currency") as string, currency),
			category_id: selectedCategoryId || (data.get("category_id") as string) || undefined,
			account_id: accountId,
		});
	}

	const defaultDate = defaultValues?.date
		? isoToDatetimeLocal(defaultValues.date)
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
					step="0.01"
					className="w-full"
					required
					defaultValue={defaultValues?.amount}
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
				<CategoryCombobox
					label="category"
					name="category_id"
					value={selectedCategoryId}
					onChange={setSelectedCategoryId}
					creatable
					placeholder="select category..."
					items={
						categories.data?.map((category) => ({
							id: category.id,
							value: category.id,
							label: category.name,
						})) ?? []
					}
					className="w-full"
				/>
				<AccountSelectCreate
					name="account_id"
					defaultValue={defaultValues?.account_id}
					disabled={isSubmitting}
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

function currentDatetimeLocal(): string {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function isoToDatetimeLocal(iso: string): string {
	const d = new Date(iso);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
