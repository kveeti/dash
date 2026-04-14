import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { getDb } from "./lib/db";
import { getHLCGenerator } from "./lib/hlc";

const queryClient = new QueryClient();

export function Providers(props: { children: ReactNode }) {
  return (
    <I18nProvider>
      <DbProvider>
        <QueryClientProvider client={queryClient}>
          {props.children}
        </QueryClientProvider>
      </DbProvider>
    </I18nProvider>
  );
}

const DbContext = createContext<ReturnType<typeof getDb> | null>(null);
const clientId = "client-1";

function DbProvider(props: { children: ReactNode }) {
  const db = useMemo(() => getDb({ hlc: getHLCGenerator(clientId) }), []);

  return (
    <DbContext.Provider value={db}>
      {props.children}
    </DbContext.Provider>
  );
}

export function useDb() {
  const context = useContext(DbContext);
  if (!context) throw new Error("useDb must be used within a DbProvider!");
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
  return <I18NContext.Provider value={value}>{children}</I18NContext.Provider>;
}

function useI18nValue() {
  const locale = "fi-FI";
  const timeZone = "Europe/Helsinki";
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

  const weekdayLongDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "numeric",
        day: "numeric",
        year: "numeric",
        weekday: "short",
      }),
    [locale]
  );

  const weekdayShortDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "numeric",
        day: "numeric",
        weekday: "short",
      }),
    [locale]
  );

  const countFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        notation: "compact",
        maximumFractionDigits: 1,
      }),
    [locale]
  );

  return {
    f: {
      amount: amountFormatter,
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
