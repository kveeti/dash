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

type LegacyFileKey = "transactionsCsv" | "accountsCsv" | "categoriesCsv" | "linksCsv";

const LEGACY_FILE_FIELDS: Array<{ key: LegacyFileKey; label: string }> = [
	{ key: "transactionsCsv", label: "transactions.csv" },
	{ key: "accountsCsv", label: "accounts.csv" },
	{ key: "categoriesCsv", label: "categories.csv" },
	{ key: "linksCsv", label: "links.csv" },
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
				label="format"
				name="format"
				className="w-full"
				value={format}
				onChange={(event) => {
					setFormat(event.currentTarget.value as CsvFormat);
					setResult(null);
				}}
			>
				<option value="generic">generic (date;amount;counterparty;additional;category;currency?)</option>
				<option value="op">OP bank statement</option>
				<option value="nordea">Nordea bank statement</option>
				<option value="revolut">Revolut export</option>
				<option value="legacy_bundle">legacy export (transactions+accounts+categories+links)</option>
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
			<AccountSelectCreate
				name="account_id"
				disabled={importCsvMutation.isPending}
			/>

			<div>
				<label className="text-gray-11 mb-1 block text-xs">csv file</label>
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
				disabled={importCsvMutation.isPending}
			>
				import
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
				linksCsv,
			] = await Promise.all([
				(files.transactionsCsv as File).text(),
				(files.accountsCsv as File).text(),
				(files.categoriesCsv as File).text(),
				(files.linksCsv as File).text(),
			]);
			const result = await importLegacyBundleMutation.mutateAsync({
				transactionsCsv,
				accountsCsv,
				categoriesCsv,
				linksCsv,
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
					<label className="text-gray-11 mb-1 block text-xs">{label}</label>
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
				disabled={importLegacyBundleMutation.isPending}
			>
				import
			</Button>
		</form>
	);
}

function ImportResultPanel({ result }: { result: ImportResult | null }) {
	if (!result) return null;

	return (
		<div className="border-gray-a4 space-y-2 border p-3">
			<p>
				imported: <strong>{result.imported}</strong>
				{result.skipped > 0 && <>, skipped: {result.skipped}</>}
			</p>
			{typeof result.accounts_imported === "number" && (
				<p className="text-xs">accounts created: {result.accounts_imported}</p>
			)}
			{typeof result.categories_imported === "number" && (
				<p className="text-xs">categories created: {result.categories_imported}</p>
			)}
			{typeof result.links_imported === "number" && (
				<p className="text-xs">links imported: {result.links_imported}</p>
			)}
			{result.errors.length > 0 && (
				<div>
					<p className="text-red-11 text-xs">errors:</p>
					<ul className="text-red-11 max-h-40 overflow-auto text-xs">
						{result.errors.map((error, index) => (
							<li key={`${index}_${error}`}>{error}</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
