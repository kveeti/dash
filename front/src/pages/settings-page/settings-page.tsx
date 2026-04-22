import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Button } from "../../components/button";
import { Input } from "../../components/input";
import { Select } from "../../components/select";
import { Spinner } from "../../components/spinner";
import {
	createDekSeed,
	createLocalWrapKey,
	decodeDekSeedFromWords,
	encodeDekSeedAsWords,
	importDekFromSeed,
	unwrapSeedFromStorage,
	wrapSeedForStorage,
} from "../../lib/crypt";
import {
	useAppSettingsQuery,
	useFxRatesQuery,
	useImportFxRatesCsvMutation,
	useUpdateConversionPolicyMutation,
	useUpdateReportingCurrencyMutation,
	useUpsertFxRateMutation,
	type ConversionMode,
	type FxCsvImportResult,
	FX_ANCHOR_CURRENCY,
} from "../../lib/queries/settings";
import { loginWithSeed } from "../../lib/queries/auth";
import { idb, uiStorageDefaults, type UiStorage } from "../../lib/sync";
import { COMMON_CURRENCIES, normalizeCurrency } from "../../lib/currency";

export function SettingsPage() {
	return (
		<div className="pt-14 space-y-8 max-w-[35rem] w-full mx-auto">
			<h1 className="font-medium text-2xl font-cool">Settings</h1>

			<SyncSection />
			<CurrencySection />
		</div>
	);
}

function SyncSection() {
	return (
		<div>
			<h2 className="text-2xl font-cool">Sync</h2>

			<SyncSectionContent />
		</div>
	);
}

function SyncSectionContent() {
	const uiStorage = useLiveQuery(
		async () => {
			return await idb.uiStorage
				.where("id")
				.equals(uiStorageDefaults.id)
				.first();
		},
		[],
		"loading",
	);

	if (uiStorage === "loading") {
		return (
			<div className="pt-4">
				<Spinner />
			</div>
		);
	}

	return <SyncSectionLoggedInContent uiStorage={uiStorage} />;
}

async function saveSeedAsSyncKey(
	uiStorage: UiStorage | undefined,
	seed: Uint8Array<ArrayBuffer>,
) {
	await loginWithSeed(seed);
	const dek = await importDekFromSeed(seed);
	const localWrapKey = await createLocalWrapKey();
	const wrappedDekSeed = await wrapSeedForStorage(seed, localWrapKey);
	await idb.uiStorage.put({
		...(uiStorage ?? uiStorageDefaults),
		dek,
		local_wrap_key: localWrapKey,
		wrapped_dek_seed: wrappedDekSeed,
		sync_state: "enabled",
	});
}

function SyncSectionLoggedInContent({
	uiStorage,
}: {
	uiStorage: UiStorage | undefined;
}) {
	const syncState = uiStorage?.sync_state;

	return (
		<div className="pt-2 space-y-6">
			{syncState === "enabled" ? (
				<div className="space-y-2 pt-1">
					<p>Syncing enabled</p>

					<Button
						variant="outline"
						onClick={async () => {
							await idb.uiStorage.put({
								...(uiStorage ?? uiStorageDefaults),
								sync_state: "paused",
							});
						}}
					>
						Pause syncing
					</Button>
				</div>
			) : syncState === "paused" ? (
				<div className="space-y-2 pt-1">
					<p>Syncing paused</p>
					<Button
						variant="outline"
						onClick={async () => {
							await idb.uiStorage.put({
								...(uiStorage ?? uiStorageDefaults),
								sync_state: "enabled",
							});
						}}
					>
						Resume syncing
					</Button>
				</div>
			) : (
				<div className="pb-1 space-y-6">
					<p>Syncing disabled on this device.</p>
					<EnableSyncingForm uiStorage={uiStorage} />
					<p className="text-xs text-gray-10">
						This stores a local non-extractable encryption key in this browser.
					</p>
				</div>
			)}
			<BackupKeySection uiStorage={uiStorage} />
		</div>
	);
}

function EnableSyncingForm({
	uiStorage,
}: {
	uiStorage: UiStorage | undefined;
}) {
	const [error, setError] = useState<string | null>(null);

	return (
		<form
			className="space-y-2"
			onSubmit={async (ev) => {
				ev.preventDefault();
				setError(null);
				try {
					const seed = createDekSeed();
					await saveSeedAsSyncKey(uiStorage, seed);
				} catch (error) {
					setError((error as Error).message);
				}
			}}
		>
			<Button>Start syncing</Button>
			{error ? <p className="text-xs text-red-11">{error}</p> : null}
		</form>
	);
}

function BackupKeySection({ uiStorage }: { uiStorage: UiStorage | undefined }) {
	const [words, setWords] = useState<string>("");
	const [importError, setImportError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	return (
		<div className="space-y-2 border border-gray-a4 p-3">
			<p className="text-sm">Backup key (24 words)</p>
			<p className="text-xs text-gray-10">
				Use this to restore syncing key on another device.
			</p>
			<p className="text-xs text-gray-10">
				Import replaces this device's current sync key.
			</p>

			<div className="flex gap-2">
				<Button
					variant="outline"
					disabled={busy}
					onClick={async () => {
						setImportError(null);
						setBusy(true);
						try {
							if (!uiStorage?.local_wrap_key || !uiStorage?.wrapped_dek_seed) {
								throw new Error("No backup key available on this device yet.");
							}
							const seed = await unwrapSeedFromStorage(
								uiStorage.wrapped_dek_seed,
								uiStorage.local_wrap_key,
							);
							setWords(await encodeDekSeedAsWords(seed));
						} catch (error) {
							setImportError((error as Error).message);
						} finally {
							setBusy(false);
						}
					}}
				>
					Export words
				</Button>
				{words ? (
					<Button
						variant="outline"
						disabled={busy}
						onClick={async () => {
							try {
								await navigator.clipboard.writeText(words);
							} catch {
								// no-op clipboard failures
							}
						}}
					>
						Copy
					</Button>
				) : null}
			</div>

			{words ? (
				<textarea
					readOnly
					value={words}
					className="w-full min-h-20 border border-gray-a5 p-2 text-xs rounded"
				/>
			) : null}

			<form
				className="space-y-2"
				onSubmit={async (event) => {
					event.preventDefault();
					setImportError(null);
					setBusy(true);
					try {
						if (uiStorage?.dek) {
							const ok = window.confirm(
								"Replace current sync key on this device with imported words?",
							);
							if (!ok) return;
						}
						const seed = await decodeDekSeedFromWords(words);
						await saveSeedAsSyncKey(uiStorage, seed);
					} catch (error) {
						setImportError((error as Error).message);
					} finally {
						setBusy(false);
					}
				}}
			>
				<Input
					label="Import words"
					value={words}
					onChange={(event) => setWords(event.currentTarget.value)}
					placeholder="24 words separated by spaces"
				/>
				<Button disabled={busy || !words.trim()}>Import words</Button>
			</form>

			{importError ? <p className="text-xs text-red-11">{importError}</p> : null}
		</div>
	);
}

function CurrencySection() {
	const settings = useAppSettingsQuery();
	const updateReportingCurrency = useUpdateReportingCurrencyMutation();
	const updateConversionPolicy = useUpdateConversionPolicyMutation();
	const upsertFxRate = useUpsertFxRateMutation();
	const importFxRatesCsv = useImportFxRatesCsvMutation();
	const [reportingCurrency, setReportingCurrency] = useState("");
	const [conversionMode, setConversionMode] = useState<ConversionMode | "">("");
	const [maxStalenessDays, setMaxStalenessDays] = useState("");

	const currentReportingCurrency =
		reportingCurrency ||
		settings.data?.reporting_currency ||
		COMMON_CURRENCIES[0];
	const currentConversionMode: ConversionMode =
		conversionMode || settings.data?.conversion_mode || "strict";
	const currentMaxStalenessDays =
		maxStalenessDays || String(settings.data?.max_staleness_days ?? 7);
	const fxRates = useFxRatesQuery();

	if (settings.isLoading) {
		return (
			<div>
				<h2 className="text-2xl font-cool">Currency</h2>
				<div className="pt-4">
					<Spinner />
				</div>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			<h2 className="text-2xl font-cool">Currency</h2>
			<p className="text-xs text-gray-10">
				FX rates are stored against anchor currency {FX_ANCHOR_CURRENCY}. Stats can
				convert everything into the selected reporting currency.
			</p>

			<form
				className="space-y-2"
				onSubmit={async (event) => {
					event.preventDefault();
					await updateReportingCurrency.mutateAsync(currentReportingCurrency);
					setReportingCurrency("");
				}}
			>
				<Select
					label="Reporting currency"
					value={currentReportingCurrency}
					onChange={(e) =>
						setReportingCurrency(normalizeCurrency(e.currentTarget.value))
					}
				>
					{COMMON_CURRENCIES.map((currencyCode) => (
						<option key={currencyCode} value={currencyCode}>
							{currencyCode}
						</option>
					))}
				</Select>
				<Button
					type="submit"
					disabled={
						updateReportingCurrency.isPending ||
						currentReportingCurrency === settings.data?.reporting_currency
					}
				>
					save reporting currency
				</Button>
			</form>

			<form
				className="space-y-2 border border-gray-a4 p-3"
				onSubmit={async (event) => {
					event.preventDefault();
					await updateConversionPolicy.mutateAsync({
						maxStalenessDays: Number(currentMaxStalenessDays),
						conversionMode: currentConversionMode,
					});
					setConversionMode("");
					setMaxStalenessDays("");
				}}
			>
				<p className="text-xs text-gray-10">Conversion fallback policy</p>
				<div className="grid grid-cols-2 gap-2">
					<Select
						label="Mode"
						value={currentConversionMode}
						onChange={(e) =>
							setConversionMode(e.currentTarget.value as ConversionMode)
						}
					>
						<option value="strict">strict</option>
						<option value="lenient">lenient</option>
					</Select>
					<Input
						label="Max stale days"
						type="number"
						min="0"
						step="1"
						value={currentMaxStalenessDays}
						onChange={(e) => setMaxStalenessDays(e.currentTarget.value)}
						required
					/>
				</div>
				<Button
					type="submit"
					disabled={
						updateConversionPolicy.isPending ||
						(currentConversionMode === settings.data?.conversion_mode &&
							Number(currentMaxStalenessDays) ===
							(settings.data?.max_staleness_days ?? 7))
					}
				>
					save conversion policy
				</Button>
			</form>

			<AddFxRateForm
				onAdd={async (input) => {
					await upsertFxRate.mutateAsync(input);
				}}
				pending={upsertFxRate.isPending}
			/>
			<ImportFxRatesCsvForm
				defaultAgainstCurrency={FX_ANCHOR_CURRENCY}
				onImport={async (input) =>
					importFxRatesCsv.mutateAsync({
						text: input.text,
						againstCurrency: input.againstCurrency,
					})
				}
				pending={importFxRatesCsv.isPending}
			/>

			<div className="space-y-2">
				<p className="text-sm">latest FX rates to {FX_ANCHOR_CURRENCY}</p>
				{fxRates.data?.length ? (
					<ul className="text-xs space-y-1">
						{fxRates.data.map((row) => (
							<li
								key={`${row.rate_date}_${row.currency}`}
								className="font-mono"
							>
								{row.rate_date} {row.currency}/{FX_ANCHOR_CURRENCY} = {row.rate_to_anchor}
							</li>
						))}
					</ul>
				) : (
					<p className="text-xs text-gray-10">no rates saved yet</p>
				)}
			</div>
		</div>
	);
}

function AddFxRateForm({
	onAdd,
	pending,
}: {
	onAdd: (input: {
		rateDate: string;
		currency: string;
		rateToAnchor: number;
	}) => Promise<void>;
	pending: boolean;
}) {
	const defaultDate = new Date().toISOString().slice(0, 10);
	return (
		<form
			className="space-y-2 border border-gray-a4 p-3"
			onSubmit={async (event) => {
				event.preventDefault();
				const data = new FormData(event.currentTarget);
				await onAdd({
					rateDate: String(data.get("rateDate")),
					currency: String(data.get("currency")),
					rateToAnchor: Number(data.get("rateToAnchor")),
				});
				event.currentTarget.reset();
			}}
		>
			<p className="text-xs text-gray-10">
				Add or update FX rate (currency to {FX_ANCHOR_CURRENCY})
			</p>
			<div className="grid grid-cols-2 gap-2">
				<Input name="rateDate" type="date" defaultValue={defaultDate} required />
				<Select name="currency" required>
					{COMMON_CURRENCIES.filter((code) => code !== FX_ANCHOR_CURRENCY).map(
						(currencyCode) => (
							<option key={currencyCode} value={currencyCode}>
								{currencyCode}
							</option>
						),
					)}
				</Select>
			</div>
			<Input
				name="rateToAnchor"
				type="number"
				step="0.000001"
				min="0"
				placeholder={`rate to ${FX_ANCHOR_CURRENCY}`}
				required
			/>
			<Button type="submit" disabled={pending}>
				{pending ? "saving..." : "save FX rate"}
			</Button>
		</form>
	);
}

function ImportFxRatesCsvForm({
	defaultAgainstCurrency,
	onImport,
	pending,
}: {
	defaultAgainstCurrency: string;
	onImport: (input: {
		text: string;
		againstCurrency: string;
	}) => Promise<FxCsvImportResult>;
	pending: boolean;
}) {
	const [againstCurrency, setAgainstCurrency] = useState(defaultAgainstCurrency);
	const [fileText, setFileText] = useState<string | null>(null);
	const [fileName, setFileName] = useState("");
	const [result, setResult] = useState<FxCsvImportResult | null>(null);

	function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
		const file = event.target.files?.[0];
		if (!file) return;
		setFileName(file.name);

		const reader = new FileReader();
		reader.onload = () => {
			setFileText(String(reader.result ?? ""));
		};
		reader.readAsText(file);
	}

	return (
		<form
			className="space-y-2 border border-gray-a4 p-3"
			onSubmit={async (event) => {
				event.preventDefault();
				if (!fileText) return;
				try {
					const imported = await onImport({
						text: fileText,
						againstCurrency: normalizeCurrency(againstCurrency),
					});
					setResult(imported);
				} catch (error) {
					setResult({
						imported: 0,
						skipped: 0,
						errors: [error instanceof Error ? error.message : String(error)],
					});
				}
			}}
		>
			<p className="text-xs text-gray-10">
				Import FX CSV format: first column date (`YYYY-MM-DD`), following columns currency
				codes (for example `USD,SEK`) with rates against selected currency. If selected
				currency is not {FX_ANCHOR_CURRENCY}, the file must also include an
				{` ${FX_ANCHOR_CURRENCY} `}column for conversion.
			</p>
			<div className="grid grid-cols-2 gap-2">
				<Select
					label="Against currency"
					value={againstCurrency}
					onChange={(e) =>
						setAgainstCurrency(normalizeCurrency(e.currentTarget.value))
					}
				>
					{COMMON_CURRENCIES.map((currencyCode) => (
						<option key={currencyCode} value={currencyCode}>
							{currencyCode}
						</option>
					))}
				</Select>
			</div>
			<div>
				<label className="text-gray-11 mb-1 block text-xs">CSV file</label>
				<Input type="file" accept=".csv,.txt" className="w-full p-2" onChange={handleFile} />
				{fileName && <p className="text-xs text-gray-10 mt-1">{fileName}</p>}
			</div>
			<Button type="submit" disabled={pending || !fileText}>
				{pending ? "importing..." : "import fx rates csv"}
			</Button>
			{result && (
				<div className="text-xs space-y-1">
					<p>
						imported: <strong>{result.imported}</strong>
						{result.skipped > 0 && <>, skipped: {result.skipped}</>}
					</p>
					{result.errors.length > 0 && (
						<ul className="text-red-11 max-h-32 overflow-auto">
							{result.errors.slice(0, 15).map((error, idx) => (
								<li key={`${idx}_${error}`}>{error}</li>
							))}
						</ul>
					)}
				</div>
			)}
		</form>
	);
}
