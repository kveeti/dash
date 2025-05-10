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

	const shortDateFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(locale, {
				month: "numeric",
				day: "numeric",
			}),
		[locale]
	);

	const longDateFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(locale, {
				month: "numeric",
				day: "numeric",
				year: "2-digit",
			}),
		[locale]
	);

	const sidebarDateFormatter = useMemo(
		() =>
			new Intl.DateTimeFormat(locale, {
				month: "short",
				day: "numeric",
				year: "numeric",
				minute: "numeric",
				hour: "numeric",
				second: "numeric",
			}),
		[locale]
	);

	return {
		f: {
			amount: amountFormatter,
			shortDate: shortDateFormatter,
			longDate: longDateFormatter,
			sidebarDate: sidebarDateFormatter,
		},
		hourCycle,
		timeZone: resolvedOptions.timeZone,
	};
}
