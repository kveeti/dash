import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/button";
import { Input } from "../../components/input";
import { Select } from "../../components/select";
import { useAccountsQuery, useCreateAccountMutation } from "../../lib/queries/accounts";
import {
	type CsvFormat,
	type ImportResult,
	importCsv,
	importLegacyCsvBundle,
} from "../../lib/queries/import";
import { useDb } from "../../providers";
import {
	COMMON_CURRENCIES,
	DEFAULT_CURRENCY,
	normalizeCurrency,
} from "../../lib/currency";

type LegacyFileKey = "transactionsCsv" | "accountsCsv" | "categoriesCsv" | "linksCsv";
type LegacyFileValue = { text: string; name: string } | null;
type LegacyFilesState = Record<LegacyFileKey, LegacyFileValue>;

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

export function ImportTransactionsCSV() {
	const db = useDb();
	const qc = useQueryClient();
	const [format, setFormat] = useState<CsvFormat>("generic");
	const [fileText, setFileText] = useState<string | null>(null);
	const [fileName, setFileName] = useState("");
	const [legacyFiles, setLegacyFiles] = useState<LegacyFilesState>({
		transactionsCsv: null,
		accountsCsv: null,
		categoriesCsv: null,
		linksCsv: null,
	});
	const [importing, setImporting] = useState(false);
	const [result, setResult] = useState<ImportResult | null>(null);

	const [showNewAccount, setShowNewAccount] = useState(false);
	const newAccountRef = useRef<HTMLInputElement>(null);
	const [newAccountCurrency, setNewAccountCurrency] = useState(DEFAULT_CURRENCY);

	const accounts = useAccountsQuery();
	const createAccount = useCreateAccountMutation();

	async function handleNewAccount() {
		const name = newAccountRef.current?.value.trim();
		if (!name) return;
		await createAccount.mutateAsync({
			name,
			currency: normalizeCurrency(newAccountCurrency),
		});
		setShowNewAccount(false);
		if (newAccountRef.current) newAccountRef.current.value = "";
	}

	function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (!file) return;

		setFileName(file.name);
		const reader = new FileReader();
		reader.onload = () => setFileText(reader.result as string);
		reader.readAsText(file);
	}

	function handleLegacyFile(
		key: LegacyFileKey,
		e: React.ChangeEvent<HTMLInputElement>,
	) {
		const file = e.target.files?.[0];
		if (!file) return;

		const reader = new FileReader();
		reader.onload = () => {
			setLegacyFiles((prev) => ({
				...prev,
				[key]: { text: reader.result as string, name: file.name },
			}));
		};
		reader.readAsText(file);
	}

	function hasAllLegacyFiles() {
		return (
			!!legacyFiles.transactionsCsv?.text &&
			!!legacyFiles.accountsCsv?.text &&
			!!legacyFiles.categoriesCsv?.text &&
			!!legacyFiles.linksCsv?.text
		);
	}

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = e.currentTarget;
		const data = new FormData(form);
		const selectedFormat = data.get("format") as CsvFormat;

		if (selectedFormat === "legacy_bundle") {
			if (!hasAllLegacyFiles()) {
				alert("select transactions.csv, accounts.csv, categories.csv and links.csv");
				return;
			}

			setImporting(true);
			setResult(null);
			try {
				const res = await importLegacyCsvBundle(db, {
					transactionsCsv: legacyFiles.transactionsCsv!.text,
					accountsCsv: legacyFiles.accountsCsv!.text,
					categoriesCsv: legacyFiles.categoriesCsv!.text,
					linksCsv: legacyFiles.linksCsv!.text,
				});
				setResult(res);
				qc.invalidateQueries({ queryKey: ["transactions"] });
				qc.invalidateQueries({ queryKey: ["categories"] });
				qc.invalidateQueries({ queryKey: ["accounts"] });
				qc.invalidateQueries({ queryKey: ["transaction-links"] });
			} catch (e: unknown) {
				setResult({ imported: 0, skipped: 0, errors: [getErrorMessage(e)] });
			} finally {
				setImporting(false);
			}
			return;
		}

		if (!fileText) return;

		const accountId = data.get("account_id") as string;
		if (!accountId) {
			alert("select an account");
			return;
		}
		const account = accounts.data?.find((a) => a.id === accountId);
		if (!account) return;

		setImporting(true);
		setResult(null);

		try {
			const res = await importCsv(db, fileText, selectedFormat, {
				id: account.id,
				currency: account.currency,
			});
			setResult(res);
			qc.invalidateQueries({ queryKey: ["transactions"] });
			qc.invalidateQueries({ queryKey: ["categories"] });
			qc.invalidateQueries({ queryKey: ["accounts"] });
		} catch (e: unknown) {
			setResult({ imported: 0, skipped: 0, errors: [getErrorMessage(e)] });
		} finally {
			setImporting(false);
		}
	}

	return (
		<div>
			<form className="space-y-4" onSubmit={handleSubmit}>
				<Select
					label="format"
					name="format"
					className="w-full"
					value={format}
					onChange={(e) => setFormat(e.currentTarget.value as CsvFormat)}
				>
					<option value="generic">generic (date;amount;counterparty;additional;category;currency?)</option>
					<option value="op">OP bank statement</option>
					<option value="legacy_bundle">legacy export (transactions+accounts+categories+links)</option>
				</Select>

				{format === "legacy_bundle" ? (
					<>
						<div>
							<label className="text-gray-11 mb-1 block text-xs">transactions.csv</label>
							<Input type="file" accept=".csv,.txt" className="w-full p-2" onChange={(e) => handleLegacyFile("transactionsCsv", e)} />
							{legacyFiles.transactionsCsv?.name && (
								<p className="text-gray-10 mt-1 text-xs">{legacyFiles.transactionsCsv.name}</p>
							)}
						</div>
						<div>
							<label className="text-gray-11 mb-1 block text-xs">accounts.csv</label>
							<Input type="file" accept=".csv,.txt" className="w-full p-2" onChange={(e) => handleLegacyFile("accountsCsv", e)} />
							{legacyFiles.accountsCsv?.name && (
								<p className="text-gray-10 mt-1 text-xs">{legacyFiles.accountsCsv.name}</p>
							)}
						</div>
						<div>
							<label className="text-gray-11 mb-1 block text-xs">categories.csv</label>
							<Input type="file" accept=".csv,.txt" className="w-full p-2" onChange={(e) => handleLegacyFile("categoriesCsv", e)} />
							{legacyFiles.categoriesCsv?.name && (
								<p className="text-gray-10 mt-1 text-xs">{legacyFiles.categoriesCsv.name}</p>
							)}
						</div>
						<div>
							<label className="text-gray-11 mb-1 block text-xs">links.csv</label>
							<Input type="file" accept=".csv,.txt" className="w-full p-2" onChange={(e) => handleLegacyFile("linksCsv", e)} />
							{legacyFiles.linksCsv?.name && (
								<p className="text-gray-10 mt-1 text-xs">{legacyFiles.linksCsv.name}</p>
							)}
						</div>
					</>
				) : (
					<>
						<div>
							<div className="mb-1 flex items-center justify-between">
								<label className="text-gray-11 text-xs">account</label>
								<button
									type="button"
									className="text-gray-11 text-xs underline"
									onClick={() => setShowNewAccount((v) => !v)}
								>
									{showNewAccount ? "cancel" : "+ new"}
								</button>
							</div>
							{showNewAccount ? (
								<div className="flex gap-1">
									<input
										ref={newAccountRef}
										type="text"
										className="focus border-gray-6 bg-gray-1 h-10 flex-1 border px-3"
										placeholder="name"
									/>
									<Select
										value={newAccountCurrency}
										onChange={(e) =>
											setNewAccountCurrency(
												normalizeCurrency(
													e.currentTarget.value,
													newAccountCurrency,
												),
											)
										}
										className="w-24"
									>
										{COMMON_CURRENCIES.map((code) => (
											<option key={code} value={code}>
												{code}
											</option>
										))}
									</Select>
									<Button size="sm" type="button" onClick={handleNewAccount}>
										add
									</Button>
								</div>
							) : (
								<Select name="account_id" className="w-full" required>
									<option value="">select...</option>
									{accounts.data?.map((a) => (
										<option key={a.id} value={a.id}>{`${a.name} (${a.currency})`}</option>
									))}
								</Select>
							)}
						</div>

						<div>
							<label className="text-gray-11 mb-1 block text-xs">csv file</label>
							<Input
								type="file"
								accept=".csv,.txt"
								className="w-full p-2"
								onChange={handleFile}
							/>
							{fileName && <p className="text-gray-10 mt-1 text-xs">{fileName}</p>}
						</div>
					</>
				)}

				<Button
					type="submit"
					className="w-full"
					disabled={
						importing ||
						(format === "legacy_bundle" ? !hasAllLegacyFiles() : !fileText)
					}
				>
					{importing ? "importing..." : "import"}
				</Button>
			</form>

			{result && (
				<div className="border-gray-a4 mt-4 space-y-2 border p-3">
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
								{result.errors.map((err, i) => (
									<li key={i}>{err}</li>
								))}
							</ul>
						</div>
					)}
				</div>
			)}
		</div>
	);
}
