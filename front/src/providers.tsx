import {
	MutationCache,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getDb } from "./lib/db";
import { queryKeyRoots } from "./lib/queries/query-keys";
import { normalizeCurrency } from "./lib/currency";
import { I18nProvider as AriaI18nProvider } from 'react-aria-components/I18nProvider';
import { importDekFromSeed } from "./lib/crypto";
import { WebAuthnGate } from "./webauthn-gate";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			networkMode: "always",
		},
		mutations: {
			networkMode: "always",
		},
	},
	mutationCache: new MutationCache({
		onSuccess: () => {
			queryClient.invalidateQueries({
				queryKey: queryKeyRoots.sync,
				exact: false,
			});
		},
	}),
});

export function Providers(props: { children: ReactNode }) {
	return (
		<I18nProvider>
			<QueryClientProvider client={queryClient}>
				<WebAuthnGate>
					{(masterDek) => (
						<CryptoProvider masterDek={masterDek}>
							<DbProvider masterDek={masterDek}>
								{props.children}
							</DbProvider>
						</CryptoProvider>
					)}
				</WebAuthnGate>
			</QueryClientProvider>
		</I18nProvider>
	);
}

const DbContext = createContext<ReturnType<typeof getDb> | null>(null);

function DbProvider(props: { children: ReactNode; masterDek: Uint8Array<ArrayBuffer> }) {
	const db = useMemo(() => getDb(props.masterDek), [props.masterDek]);

	return <DbContext.Provider value={db}>{props.children}</DbContext.Provider>;
}

export function useDb() {
	const context = useContext(DbContext);
	if (!context) throw new Error("useDb must be used within a DbProvider!");
	return context;
}

type CryptoContextValue = {
	masterDek: Uint8Array<ArrayBuffer>;
	syncContentKey: CryptoKey;
};

const CryptoContext = createContext<CryptoContextValue | null>(null);

function CryptoProvider(props: {
	children: ReactNode;
	masterDek: Uint8Array<ArrayBuffer>;
}) {
	const [syncContentKey, setSyncContentKey] = useState<CryptoKey | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		importDekFromSeed(props.masterDek)
			.then((key) => {
				if (!cancelled) setSyncContentKey(key);
			})
			.catch((err: unknown) => {
				if (!cancelled) setError((err as Error).message);
			});
		return () => {
			cancelled = true;
		};
	}, [props.masterDek]);

	const value = useMemo(() => {
		if (!syncContentKey) return null;
		return {
			masterDek: props.masterDek,
			syncContentKey,
		};
	}, [syncContentKey, props.masterDek]);

	if (error) {
		return <div className="p-6 text-sm text-red-11">{error}</div>;
	}
	if (!value) {
		return <div className="p-6 text-sm text-gray-10">Preparing crypto...</div>;
	}

	return <CryptoContext.Provider value={value}>{props.children}</CryptoContext.Provider>;
}

export function useCrypto() {
	const context = useContext(CryptoContext);
	if (!context) throw new Error("useCrypto must be used within a CryptoProvider!");
	return context;
}

const I18NContext = createContext<ReturnType<typeof useI18nValue> | null>(null);

export function useI18n() {
	const context = useContext(I18NContext);
	if (!context) throw new Error("useI18n must be used within a I18nProvider!");
	return context;
}

export function I18nProvider({ children }: { children: ReactNode }) {
	const value = useI18nValue();
	return (
		<AriaI18nProvider locale={value.locale}>
			<I18NContext.Provider value={value}>{children}</I18NContext.Provider>
		</AriaI18nProvider>
	);
}

function useI18nValue() {
	const locale = "fi-FI";
	const timeZone = "Europe/Helsinki";
	const hourCycle: 12 | 24 = 24;

	const resolvedOptions = useMemo(
		() => new Intl.DateTimeFormat(locale, { timeZone }).resolvedOptions(),
		[locale, timeZone],
	);

	const formatAmount = (amount: number, currency: string) => {
		const currencyCode = normalizeCurrency(currency);
		return new Intl.NumberFormat(locale, {
			signDisplay: "auto",
			minimumFractionDigits: 2,
			maximumFractionDigits: 2,
			currencyDisplay: "symbol",
			style: "currency",
			currency: currencyCode,
		}).format(amount);
	};

	const shortDateFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(locale, {
				month: "numeric",
				day: "numeric",
			}),
		[locale],
	);

	const longDateFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(locale, {
				month: "numeric",
				day: "numeric",
				year: "numeric",
			}),
		[locale],
	);

	const weekdayLongDateFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(locale, {
				month: "numeric",
				day: "numeric",
				year: "numeric",
				weekday: "short",
			}),
		[locale],
	);

	const weekdayShortDateFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(locale, {
				month: "numeric",
				day: "numeric",
				weekday: "short",
			}),
		[locale],
	);

	const countFormatter = useMemo(
		() =>
			new Intl.NumberFormat(undefined, {
				notation: "compact",
				maximumFractionDigits: 1,
			}),
		[locale],
	);

	return {
		f: {
			amount: formatAmount,
			shortDate: shortDateFormatter,
			longDate: longDateFormatter,
			weekdayLongDate: weekdayLongDateFormatter,
			weekdayShortDate: weekdayShortDateFormatter,
			count: countFormatter,
		},
		hourCycle,
		timeZone: timeZone ?? resolvedOptions.timeZone,
		locale: locale ?? resolvedOptions.locale,
	};
}
