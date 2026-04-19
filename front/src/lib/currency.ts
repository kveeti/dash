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
