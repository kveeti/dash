import { useState, type FormEvent } from "react";
import { Button } from "../../components/button";
import { Input } from "../../components/input";
import { Select } from "../../components/select";
import { AccountSelectCreate } from "../../components/account-select-create";
import { useAccountsQuery } from "../../lib/queries/accounts";
import {
	type CsvFormat,
	type ImportResult,
	useImportCsvMutation,
	useImportLegacyCsvBundleMutation,
} from "../../lib/queries/import";

type LegacyFileKey = "transactionsCsv" | "accountsCsv" | "categoriesCsv";

const LEGACY_FILE_FIELDS: Array<{ key: LegacyFileKey; label: string }> = [
	{ key: "transactionsCsv", label: "transactions.csv" },
	{ key: "accountsCsv", label: "accounts.csv" },
	{ key: "categoriesCsv", label: "categories.csv" },
];

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

function getFailedResult(error: unknown): ImportResult {
	return {
		imported: 0,
		skipped: 0,
		errors: [getErrorMessage(error)],
	};
}

export function ImportTransactionsCSV() {
	const [format, setFormat] = useState<CsvFormat>("generic");
	const [result, setResult] = useState<ImportResult | null>(null);

	return (
		<div className="space-y-4">
			<Select
				label="Format"
				name="format"
				className="w-full"
				value={format}
				onChange={(event) => {
					setFormat(event.currentTarget.value as CsvFormat);
					setResult(null);
				}}
			>
				<option value="generic">Generic (date;amount;counterparty;additional;category;currency?)</option>
				<option value="op">OP bank statement</option>
				<option value="nordea">Nordea bank statement</option>
				<option value="revolut">Revolut export</option>
				<option value="legacy_bundle">Legacy export (transactions + accounts + categories)</option>
			</Select>

			{format === "legacy_bundle" ? (
				<LegacyImportForm onResult={setResult} />
			) : (
				<StandardImportForm format={format} onResult={setResult} />
			)}

			<ImportResultPanel result={result} />
		</div>
	);
}

function StandardImportForm({
	format,
	onResult,
}: {
	format: Exclude<CsvFormat, "legacy_bundle">;
	onResult: (result: ImportResult | null) => void;
}) {
	const importCsvMutation = useImportCsvMutation();
	const accounts = useAccountsQuery();

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (importCsvMutation.isPending) return;
		const data = new FormData(event.currentTarget);
		const file = data.get("csv_file");
		if (!(file instanceof File) || file.size === 0) return;
		const selectedAccountId = (data.get("account_id") as string) || "";
		if (!selectedAccountId) {
			alert("select an account");
			return;
		}
		const account = accounts.data?.find((row) => row.id === selectedAccountId) ?? null;
		if (!account) {
			alert("selected account not found");
			return;
		}

		onResult(null);
		try {
			const result = await importCsvMutation.mutateAsync({
				text: await file.text(),
				format,
				account: {
					id: selectedAccountId,
					currency: account.currency,
				},
			});
			onResult(result);
		} catch (error) {
			onResult(getFailedResult(error));
		}
	}

	return (
		<form className="space-y-4" onSubmit={handleSubmit}>
			<AccountSelectCreate name="account_id" />

			<div>
				<label className="field-label">CSV file</label>
				<Input
					name="csv_file"
					type="file"
					accept=".csv,.txt"
					className="w-full p-2"
					required
				/>
			</div>

			<Button
				type="submit"
				className="w-full"
				isLoading={importCsvMutation.isPending}
			>
				Import
			</Button>
		</form>
	);
}

function LegacyImportForm({
	onResult,
}: {
	onResult: (result: ImportResult | null) => void;
}) {
	const importLegacyBundleMutation = useImportLegacyCsvBundleMutation();

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (importLegacyBundleMutation.isPending) return;
		const data = new FormData(event.currentTarget);
		const files = Object.fromEntries(
			LEGACY_FILE_FIELDS.map(({ key }) => [key, data.get(key)]),
		) as Record<LegacyFileKey, FormDataEntryValue | null>;
		const missing = LEGACY_FILE_FIELDS.find(({ key }) => {
			const file = files[key];
			return !(file instanceof File) || file.size === 0;
		});
		if (missing) {
			alert(`select ${missing.label}`);
			return;
		}

		onResult(null);
		try {
			const [
				transactionsCsv,
				accountsCsv,
				categoriesCsv,
			] = await Promise.all([
				(files.transactionsCsv as File).text(),
				(files.accountsCsv as File).text(),
				(files.categoriesCsv as File).text(),
			]);
			const result = await importLegacyBundleMutation.mutateAsync({
				transactionsCsv,
				accountsCsv,
				categoriesCsv,
			});
			onResult(result);
		} catch (error) {
			onResult(getFailedResult(error));
		}
	}

	return (
		<form className="space-y-4" onSubmit={handleSubmit}>
			{LEGACY_FILE_FIELDS.map(({ key, label }) => (
				<div key={key}>
					<label className="field-label">{label}</label>
					<Input
						name={key}
						type="file"
						accept=".csv,.txt"
						className="w-full p-2"
						required
					/>
				</div>
			))}

			<Button
				type="submit"
				className="w-full"
				isLoading={importLegacyBundleMutation.isPending}
			>
				Import bundle
			</Button>
		</form>
	);
}

function ImportResultPanel({ result }: { result: ImportResult | null }) {
	if (!result) return null;
	const hasErrors = result.errors.length > 0;

	return (
		<div className="rounded-md border border-gray-a4 p-4 space-y-3">
			<div className="flex flex-wrap items-center gap-2">
				<ResultChip label="Imported" value={result.imported} tone="positive" />
				{(result.deduped ?? 0) > 0 && (
					<ResultChip label="Deduped" value={result.deduped ?? 0} tone="neutral" />
				)}
				{result.skipped > 0 && (
					<ResultChip label="Skipped" value={result.skipped} tone="neutral" />
				)}
				{typeof result.accounts_imported === "number" && (
					<ResultChip
						label="New accounts"
						value={result.accounts_imported}
						tone="neutral"
					/>
				)}
				{typeof result.categories_imported === "number" && (
					<ResultChip
						label="New categories"
						value={result.categories_imported}
						tone="neutral"
					/>
				)}
				{hasErrors && (
					<ResultChip
						label="Errors"
						value={result.errors.length}
						tone="negative"
					/>
				)}
			</div>
			{hasErrors && (
				<details className="text-[12px]">
					<summary className="cursor-pointer text-gray-11 hover:text-gray-12">
						Show errors
					</summary>
					<ul className="text-red-11 mt-2 max-h-40 overflow-auto space-y-0.5">
						{result.errors.map((error, index) => (
							<li key={`${index}_${error}`}>{error}</li>
						))}
					</ul>
				</details>
			)}
		</div>
	);
}

function ResultChip({
	label,
	value,
	tone,
}: {
	label: string;
	value: number;
	tone: "positive" | "neutral" | "negative";
}) {
	const cls =
		tone === "positive"
			? "border-green-a4 bg-green-a2 text-green-11"
			: tone === "negative"
				? "border-red-a4 bg-red-a2 text-red-11"
				: "border-gray-a4 bg-gray-a2 text-gray-11";
	return (
		<span
			className={
				"inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] " +
				cls
			}
		>
			<span>{label}</span>
			<span className="num font-medium">{value}</span>
		</span>
	);
}
