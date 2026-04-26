export const DEFAULT_CURRENCY = "EUR";

export const COMMON_CURRENCIES = [
	"EUR",
	"USD",
	"GBP",
	"SEK",
	"NOK",
	"DKK",
	"CHF",
	"JPY",
	"CAD",
	"AUD",
] as const;

export type CurrencyMeta = {
	currency: string;
	minor_unit: number;
	minor_factor: number;
};

export const DEFAULT_CURRENCY_META: CurrencyMeta[] = [
	{ currency: "BHD", minor_unit: 3, minor_factor: 1000 },
	{ currency: "CAD", minor_unit: 2, minor_factor: 100 },
	{ currency: "CHF", minor_unit: 2, minor_factor: 100 },
	{ currency: "DKK", minor_unit: 2, minor_factor: 100 },
	{ currency: "EUR", minor_unit: 2, minor_factor: 100 },
	{ currency: "GBP", minor_unit: 2, minor_factor: 100 },
	{ currency: "JPY", minor_unit: 0, minor_factor: 1 },
	{ currency: "KWD", minor_unit: 3, minor_factor: 1000 },
	{ currency: "NOK", minor_unit: 2, minor_factor: 100 },
	{ currency: "OMR", minor_unit: 3, minor_factor: 1000 },
	{ currency: "SEK", minor_unit: 2, minor_factor: 100 },
	{ currency: "TND", minor_unit: 3, minor_factor: 1000 },
	{ currency: "USD", minor_unit: 2, minor_factor: 100 },
];

export function normalizeCurrency(
	value: string | null | undefined,
	fallback = DEFAULT_CURRENCY,
): string {
	const cleaned = (value ?? "").trim().toUpperCase();
	if (/^[A-Z]{3}$/.test(cleaned)) return cleaned;
	return fallback;
}

export function parseCurrency(
	value: string | null | undefined,
	fallback = DEFAULT_CURRENCY,
): string {
	const cleaned = (value ?? "").trim().toUpperCase();
	if (!cleaned) return fallback;
	if (!/^[A-Z]{3}$/.test(cleaned)) {
		throw new Error(`invalid currency: ${value}`);
	}
	return cleaned;
}

export function fallbackCurrencyMeta(currency: string): CurrencyMeta {
	const normalized = normalizeCurrency(currency);
	return DEFAULT_CURRENCY_META.find((meta) => meta.currency === normalized) ?? {
		currency: normalized,
		minor_unit: 2,
		minor_factor: 100,
	};
}

export async function getCurrencyMeta(
	db: {
		query: <T = unknown>(sql: string, vars?: unknown[]) => Promise<T[]>;
	},
	currency: string,
): Promise<CurrencyMeta> {
	const normalized = normalizeCurrency(currency);
	const rows = await db.query<CurrencyMeta>(
		`select currency, minor_unit, minor_factor from currency_meta where currency = ? limit 1`,
		[normalized],
	);
	return rows[0] ?? fallbackCurrencyMeta(normalized);
}

export function parseDecimalToMinorUnits(
	value: string,
	meta: Pick<CurrencyMeta, "currency" | "minor_unit">,
): number {
	const trimmed = value.trim().replace(/[–—]/g, "-").replace(",", ".");
	const match = /^([+-])?(\d+)(?:\.(\d*))?$/.exec(trimmed);
	if (!match) throw new Error(`invalid amount: ${value}`);

	const sign = match[1] === "-" ? -1 : 1;
	const whole = match[2];
	const fraction = match[3] ?? "";
	const precision = Math.max(0, Math.trunc(meta.minor_unit));

	if (fraction.length > precision && /[1-9]/.test(fraction.slice(precision))) {
		throw new Error(`${meta.currency} supports ${precision} decimal places`);
	}

	const paddedFraction = fraction.slice(0, precision).padEnd(precision, "0");
	const major = Number.parseInt(whole, 10);
	const minor = paddedFraction ? Number.parseInt(paddedFraction, 10) : 0;
	const factor = 10 ** precision;

	return sign * (major * factor + minor);
}

export function minorUnitsToMajor(
	amountMinor: number,
	meta: Pick<CurrencyMeta, "minor_factor">,
): number {
	return amountMinor / meta.minor_factor;
}
