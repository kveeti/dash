import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from "react";
import { getDb } from "./lib/db";
import { getSyncConfig, sync } from "./lib/sync";

const queryClient = new QueryClient()

const SCHEMA_VERSION = 1;

export function Providers(props: { children: ReactNode }) {
  return (
    <I18nProvider>
      <DbProvider>
        <QueryClientProvider client={queryClient}>
          <AutoSync />
          {props.children}
        </QueryClientProvider>
      </DbProvider>
    </I18nProvider>
  );
}

function AutoSync() {
  const db = useDb();
  const qc = useQueryClient();
  const syncingRef = useRef(false);

  useEffect(() => {
    async function doSync() {
      const config = getSyncConfig();
      if (!config) return;

      if (syncingRef.current) return;
      syncingRef.current = true;

      try {
        const result = await sync(db, config, SCHEMA_VERSION);
        if (result.pulled > 0) {
          qc.invalidateQueries();
        }
      } catch (e) {
        console.error("auto-sync failed:", e);
      } finally {
        syncingRef.current = false;
      }
    }

    // sync immediately on mount
    doSync();

    // sync when a write happens (debounced 1s to batch rapid writes)
    let dirtyTimeout: ReturnType<typeof setTimeout> | null = null;
    function onDirty() {
      if (dirtyTimeout) clearTimeout(dirtyTimeout);
      dirtyTimeout = setTimeout(doSync, 1_000);
    }
    window.addEventListener("dash-sync-dirty", onDirty);

    // also sync every 30s while tab is visible (catch anything missed)
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        doSync();
      }
    }, 30_000);

    return () => {
      clearInterval(interval);
      window.removeEventListener("dash-sync-dirty", onDirty);
      if (dirtyTimeout) clearTimeout(dirtyTimeout);
    };
  }, [db, qc]);

  return null;
}


const DbContext = createContext<ReturnType<typeof getDb> | null>(null);

function DbProvider(props: { children: ReactNode }) {
  const db = getDb();

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
        weekday: "short"
      }),
    [locale]
  );

  const weekdayShortDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        month: "numeric",
        day: "numeric",
        weekday: "short"
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
