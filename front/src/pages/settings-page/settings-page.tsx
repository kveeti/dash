import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { Button } from "../../components/button";
import { Input } from "../../components/input";
import { Select } from "../../components/select";
import { DatePickerInput } from "../../components/date-picker";
import { Spinner } from "../../components/spinner";
import {
	useAppSettingsQuery,
	useFxRatesQuery,
	useImportFxRatesCsvMutation,
	useDeleteFxRatesMutation,
	useUpdateConversionPolicyMutation,
	useUpdateReportingCurrencyMutation,
	useUpsertFxRateMutation,
	type FxCsvImportResult,
	FX_ANCHOR_CURRENCY,
} from "../../lib/queries/settings";
import { getUiStorage, idb, uiStorageDefaults } from "../../lib/local-storage";
import { normalizeCurrency } from "../../lib/currency";
import { useCurrencyMetaQuery } from "../../lib/queries/currencies";

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
	const uiStorage = useLiveQuery(getUiStorage, [], "loading");

	if (uiStorage === "loading") {
		return (
			<div className="pt-4">
				<Spinner />
			</div>
		);
	}

	return <SyncSectionLoggedInContent uiStorage={uiStorage} />;
}

function SyncSectionLoggedInContent({
	uiStorage,
}: {
	uiStorage: Awaited<ReturnType<typeof getUiStorage>>;
}) {
	const syncState = uiStorage?.sync_state;

	return (
		<div className="pt-2 space-y-6">
			{syncState === "enabled" ? (
				<div className="space-y-2 pt-1">
					<p>Syncing enabled</p>
					<p className="text-xs text-gray-10">
						Dash will authenticate and sync when this browser is online.
					</p>

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
					<p>Syncing is not configured on this device.</p>
					<EnableSyncingForm uiStorage={uiStorage} />
				</div>
			)}
			<PasskeySection uiStorage={uiStorage} />
		</div>
	);
}

function EnableSyncingForm({
	uiStorage,
}: {
	uiStorage: Awaited<ReturnType<typeof getUiStorage>>;
}) {
	const [error, setError] = useState<string | null>(null);

	return (
		<form
			className="space-y-2"
			onSubmit={async (ev) => {
				ev.preventDefault();
				setError(null);
				try {
					await idb.uiStorage.put({
						...(uiStorage ?? uiStorageDefaults),
						sync_state: "enabled",
					});
				} catch (error) {
					setError((error as Error).message);
				}
			}}
		>
			<p className="text-xs text-gray-10">
				This keeps the app usable offline. Server login and encrypted row sync
				start automatically once the browser is online.
			</p>
			<Button>Start syncing</Button>
			{error ? <p className="text-xs text-red-11">{error}</p> : null}
		</form>
	);
}

function PasskeySection({
	uiStorage,
}: {
	uiStorage: Awaited<ReturnType<typeof getUiStorage>>;
}) {
	return (
		<div className="space-y-2 border border-gray-a4 p-3">
			<p className="text-sm">Passkey unlock</p>
			<p className="text-xs text-gray-10">
				The local SQLite key is wrapped by this device's passkey PRF.
			</p>
			<p className="text-xs text-gray-10">
				Recovery words are only shown during setup. To rotate the passkey,
				clear this browser profile and recover from the 24 words.
			</p>
			<p className="text-xs text-gray-10">
				Passkey credential:{" "}
				{uiStorage?.passkey_credential_id ? "configured" : "missing"}
			</p>
		</div>
	);
}

function CurrencySection() {
	const settings = useAppSettingsQuery();
	const updateReportingCurrency = useUpdateReportingCurrencyMutation();
	const updateConversionPolicy = useUpdateConversionPolicyMutation();
	const upsertFxRate = useUpsertFxRateMutation();
	const importFxRatesCsv = useImportFxRatesCsvMutation();
	const deleteFxRates = useDeleteFxRatesMutation();
	const fxRates = useFxRatesQuery();
	const currencyMeta = useCurrencyMetaQuery();
	const currencyCodes = currencyMeta.data?.map((meta) => meta.currency) ?? [FX_ANCHOR_CURRENCY];

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

	const appSettings = settings.data;
	if (!appSettings) return null;

	return (
		<div className="space-y-4">
			<h2 className="text-2xl font-cool">Currency</h2>
			<p className="text-xs text-gray-10">
				FX rates are stored against anchor currency {FX_ANCHOR_CURRENCY}. Stats can
				convert everything into the selected reporting currency.
			</p>

			<form
				key={`reporting_${appSettings.updated_at}_${appSettings.reporting_currency}`}
				className="space-y-2"
				onSubmit={async (event) => {
					event.preventDefault();
					const data = new FormData(event.currentTarget);
					const nextReportingCurrency = normalizeCurrency(
						String(data.get("reporting_currency") ?? ""),
						appSettings.reporting_currency,
					);
					if (nextReportingCurrency === appSettings.reporting_currency) return;
					await updateReportingCurrency.mutateAsync(nextReportingCurrency);
				}}
			>
				<Select
					label="Reporting currency"
					name="reporting_currency"
					defaultValue={appSettings.reporting_currency}
				>
					{currencyCodes.map((currencyCode) => (
						<option key={currencyCode} value={currencyCode}>
							{currencyCode}
						</option>
					))}
				</Select>
				<Button
					type="submit"
					isLoading={updateReportingCurrency.isPending}
					disabled={updateReportingCurrency.isPending}
				>
					save reporting currency
				</Button>
			</form>

			<form
				key={`conversion_${appSettings.updated_at}_${appSettings.conversion_mode}_${appSettings.max_staleness_days}`}
				className="space-y-2 border border-gray-a4 p-3"
				onSubmit={async (event) => {
					event.preventDefault();
					const data = new FormData(event.currentTarget);
					const conversionMode = String(data.get("conversion_mode"));
					const maxStalenessDays = Number(data.get("max_staleness_days"));
					if (!Number.isFinite(maxStalenessDays)) return;
					if (
						conversionMode === appSettings.conversion_mode &&
						Math.trunc(maxStalenessDays) === appSettings.max_staleness_days
					) {
						return;
					}
					await updateConversionPolicy.mutateAsync({
						maxStalenessDays,
						conversionMode:
							conversionMode === "lenient" ? "lenient" : "strict",
					});
				}}
			>
				<p className="text-xs text-gray-10">Conversion fallback policy</p>
				<div className="grid grid-cols-2 gap-2">
					<Select
						label="Mode"
						name="conversion_mode"
						defaultValue={appSettings.conversion_mode}
					>
						<option value="strict">strict</option>
						<option value="lenient">lenient</option>
					</Select>
					<Input
						label="Max stale days"
						name="max_staleness_days"
						type="number"
						min="0"
						step="1"
						defaultValue={String(appSettings.max_staleness_days)}
						required
					/>
				</div>
				<Button
					type="submit"
					isLoading={updateConversionPolicy.isPending}
					disabled={updateConversionPolicy.isPending}
				>
					save conversion policy
				</Button>
			</form>

			<AddFxRateForm
				currencyCodes={currencyCodes}
				onAdd={async (input) => {
					await upsertFxRate.mutateAsync(input);
				}}
				pending={upsertFxRate.isPending}
			/>
			<ImportFxRatesCsvForm
				defaultAgainstCurrency={FX_ANCHOR_CURRENCY}
				currencyCodes={currencyCodes}
				onImport={async (input) =>
					importFxRatesCsv.mutateAsync({
						text: input.text,
						againstCurrency: input.againstCurrency,
					})
				}
				pending={importFxRatesCsv.isPending}
			/>

			<div className="space-y-2">
				<div className="flex items-center justify-between gap-2">
					<p className="text-sm">latest FX rates in {FX_ANCHOR_CURRENCY}</p>
					<Button
						type="button"
						variant="outline"
						isLoading={deleteFxRates.isPending}
						disabled={deleteFxRates.isPending || !fxRates.data?.length}
						onClick={async () => {
							const ok = window.confirm("Delete all stored FX rates?");
							if (!ok) return;
							await deleteFxRates.mutateAsync();
						}}
					>
						clear rates
					</Button>
				</div>
				{fxRates.data?.length ? (
					<ul className="text-xs space-y-1">
						{fxRates.data.map((row) => (
							<li
								key={`${row.rate_date}_${row.currency}`}
								className="font-mono"
							>
								{row.rate_date} 1 {row.currency} = {row.rate_to_anchor} {FX_ANCHOR_CURRENCY}
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
	currencyCodes,
	onAdd,
	pending,
}: {
	currencyCodes: string[];
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
				Add or update FX rate (1 currency in {FX_ANCHOR_CURRENCY})
			</p>
			<div className="grid grid-cols-2 gap-2">
				<DatePickerInput name="rateDate" defaultValue={defaultDate} required />
				<Select name="currency" required>
					{currencyCodes.filter((code) => code !== FX_ANCHOR_CURRENCY).map(
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
				placeholder={`${FX_ANCHOR_CURRENCY} per 1 currency`}
				required
			/>
			<Button type="submit" isLoading={pending} disabled={pending}>
				save FX rate
			</Button>
		</form>
	);
}

function ImportFxRatesCsvForm({
	defaultAgainstCurrency,
	currencyCodes,
	onImport,
	pending,
}: {
	defaultAgainstCurrency: string;
	currencyCodes: string[];
	onImport: (input: {
		text: string;
		againstCurrency: string;
	}) => Promise<FxCsvImportResult>;
	pending: boolean;
}) {
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
				const data = new FormData(event.currentTarget);
				const againstCurrency = normalizeCurrency(
					String(data.get("against_currency") ?? defaultAgainstCurrency),
					defaultAgainstCurrency,
				);
				try {
					const imported = await onImport({
						text: fileText,
						againstCurrency,
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
				codes (for example `USD,SEK`) where each rate means 1 selected currency equals
				that many column currency units. If selected currency is not {FX_ANCHOR_CURRENCY},
				the file must also include an {` ${FX_ANCHOR_CURRENCY} `}column for conversion.
			</p>
			<div className="grid grid-cols-2 gap-2">
				<Select
					label="Against currency"
					name="against_currency"
					defaultValue={defaultAgainstCurrency}
				>
					{currencyCodes.map((currencyCode) => (
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
			<Button type="submit" isLoading={pending} disabled={pending || !fileText}>
				import fx rates csv
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
