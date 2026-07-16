import { type ReactNode, useMemo } from "react";

import { createContext } from "../../lib/create-context";

const [useContext, context] = createContext<ReturnType<typeof useI18nValue>>();

type Currencies = Array<{ code: string; exponent: number }>;

export const useI18n = useContext;
export function I18n({
  children,
  currencies,
}: {
  children: ReactNode;
  currencies: Currencies;
}) {
  const value = useI18nValue({ currencies });
  return <context.Provider value={value}>{children}</context.Provider>;
}

function useI18nValue(props: { currencies: Currencies }) {
  const locale = "fi-FI";
  const timeZone = undefined;
  const hourCycle: 12 | 24 = 24;

  const resolvedOptions = useMemo(
    () => new Intl.DateTimeFormat(locale, { timeZone }).resolvedOptions(),
    [locale, timeZone],
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
    [locale],
  );

  const shortDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
    [locale],
  );

  const longDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    [locale],
  );

  const percentFormatter = new Intl.NumberFormat(undefined, {
    style: "percent",
    maximumFractionDigits: 0,
    signDisplay: "always",
  });

  const formattersByCurrency = useMemo(() => {
    const formatters: Record<string, (amount: number) => string> = {};

    for (const { code, exponent } of props.currencies) {
      if (formatters[code])
        throw new Error(`Formatter for ${code} already defined`);
      const formatter = new Intl.NumberFormat(locale, {
        style: "currency",
        currency: code,
      });
      formatters[code] = (amount) => formatter.format(amount / 10 ** exponent);
    }

    return formatters;
  }, [props.currencies, locale]);

  return {
    f: {
      amount: (amount: number, isoCurrency: string) =>
        formattersByCurrency[isoCurrency](amount),
      percent: percentFormatter.format,
      shortDate: shortDateFormatter.format,
      longDate: longDateFormatter.format,
    },
    hourCycle,
    timeZone: resolvedOptions.timeZone,
  };
}
