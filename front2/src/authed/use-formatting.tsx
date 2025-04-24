import { useMemo } from "react";

function useLocale() {
	return "fi-FI";
}

export function useFormatAmount() {
	const locale = useLocale();

	const amountFormatter = useMemo(
		() =>
			new Intl.NumberFormat(locale, {
				signDisplay: "auto",
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
				currencyDisplay: "symbol",
				style: "currency",
				currency: "EUR",
			}),
		[locale],
	);

	return amountFormatter.format;
}
