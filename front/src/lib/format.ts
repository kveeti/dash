export function formatCurrency(value: number, currency: string) {
	return Intl.NumberFormat(undefined, {
		currency,
		style: "currency",
		currencyDisplay: "narrowSymbol",
		maximumFractionDigits: 2,
		minimumFractionDigits: 2,
	}).format(value);
}
