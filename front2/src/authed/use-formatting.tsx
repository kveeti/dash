import { ReactNode, useMemo } from "react";

import { createContext } from "../lib/create-context";

const [useContext, context] = createContext<ReturnType<typeof useLocaleStuffValue>>();

export const useLocaleStuff = useContext;
export function LocaleStuff({ children }: { children: ReactNode }) {
	const value = useLocaleStuffValue();
	return <context.Provider value={value}>{children}</context.Provider>;
}

function useLocaleStuffValue() {
	const locale = "fi-FI";
	const timeZone = undefined;
	const hourCycle: 12 | 24 = 24;

	const resolvedOptions = useMemo(
		() => new Intl.DateTimeFormat(locale, { timeZone }).resolvedOptions(),
		[locale, timeZone]
	);

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
		[locale]
	);

	return {
		formatAmount: amountFormatter.format,
		hourCycle,
		timeZone: resolvedOptions.timeZone,
	};
}
