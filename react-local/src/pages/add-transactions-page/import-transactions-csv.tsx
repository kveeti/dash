import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "../../components/button";
import { Input } from "../../components/input";
import { Select } from "../../components/select";
import { useAccountsQuery, useCreateAccountMutation } from "../../lib/queries/accounts";
import { type CsvFormat, type ImportResult, importCsv } from "../../lib/queries/import";
import { useDb } from "../../providers";

export function ImportTransactionsCSV() {
	const db = useDb();
	const qc = useQueryClient();
	const [fileText, setFileText] = useState<string | null>(null);
	const [fileName, setFileName] = useState("");
	const [importing, setImporting] = useState(false);
	const [result, setResult] = useState<ImportResult | null>(null);

	const [showNewAccount, setShowNewAccount] = useState(false);
	const newAccountRef = useRef<HTMLInputElement>(null);

	const accounts = useAccountsQuery();
	const createAccount = useCreateAccountMutation();

	async function handleNewAccount() {
		const name = newAccountRef.current?.value.trim();
		if (!name) return;
		await createAccount.mutateAsync(name);
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

	async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		const form = e.currentTarget;
		const data = new FormData(form);

		if (!fileText) return;

		const accountId = data.get("account_id") as string;
		if (!accountId) {
			alert("select an account");
			return;
		}

		const account = accounts.data?.find((a) => a.id === accountId);
		if (!account) return;

		const format = data.get("format") as CsvFormat;

		setImporting(true);
		setResult(null);

		try {
			const res = await importCsv(db, fileText, format, account.name);
			setResult(res);
			qc.invalidateQueries({ queryKey: ["transactions"] });
			qc.invalidateQueries({ queryKey: ["categories"] });
			qc.invalidateQueries({ queryKey: ["accounts"] });
		} catch (e: any) {
			setResult({ imported: 0, skipped: 0, errors: [e.message] });
		} finally {
			setImporting(false);
		}
	}

	return (
		<div>
			<form className="space-y-4" onSubmit={handleSubmit}>
				<Select label="format" name="format" className="w-full">
					<option value="generic">generic (date;amount;counterparty;additional;category)</option>
					<option value="op">OP bank statement</option>
				</Select>

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
							<Button size="sm" type="button" onClick={handleNewAccount}>
								add
							</Button>
						</div>
					) : (
						<Select name="account_id" className="w-full" required>
							<option value="">select...</option>
							{accounts.data?.map((a) => (
								<option key={a.id} value={a.id}>{a.name}</option>
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

				<Button type="submit" className="w-full" disabled={!fileText || importing}>
					{importing ? "importing..." : "import"}
				</Button>
			</form>

			{result && (
				<div className="border-gray-a4 mt-4 space-y-2 border p-3">
					<p>
						imported: <strong>{result.imported}</strong>
						{result.skipped > 0 && <>, skipped: {result.skipped}</>}
					</p>
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
