import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { createContext, useContext, useMemo, useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { getDb } from "./lib/db";
import type { SyncAuth } from "./lib/sync-auth";
import { getPersistedAuth, getPersistedDek, persistDek, clearAuth as clearAuthStorage } from "./lib/sync-auth";
import { runSync, clearSyncState } from "./lib/sync-engine";

export type SyncStatus = "unconfigured" | "locked" | "idle" | "syncing" | "error";

// Debounced sync trigger — will be wired up by SyncAuthProvider
let _debouncedSync: (() => void) | null = null;

const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onSuccess: () => {
      // Trigger debounced sync after any successful mutation
      _debouncedSync?.();
    },
  }),
})

export function Providers(props: { children: ReactNode }) {
  return (
    <I18nProvider>
      <DbProvider>
        <SyncAuthProvider>
          <QueryClientProvider client={queryClient}>
            {props.children}
          </QueryClientProvider>
        </SyncAuthProvider>
      </DbProvider>
    </I18nProvider>
  );
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

// --- Sync ---

const LS_LAST_SYNC_AT = "dash_last_sync_at";
const LS_SYNC_SERVER_URL = "dash_sync_server_url";
const SYNC_INTERVAL_MS = 5 * 60 * 1000;

export function getSyncServerUrl(): string {
  return localStorage.getItem(LS_SYNC_SERVER_URL) ?? "";
}

export function setSyncServerUrl(url: string) {
  localStorage.setItem(LS_SYNC_SERVER_URL, url.replace(/\/$/, ""));
}

interface SyncContextValue {
  auth: SyncAuth | null;
  setAuth: (auth: SyncAuth | null) => void;
  status: SyncStatus;
  error: string | null;
  lastSyncAt: Date | null;
  sync: () => Promise<void>;
  logout: () => void;
  forceReset: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

function SyncAuthProvider({ children }: { children: ReactNode }) {
  const db = useDb();
  const [auth, setAuthState] = useState<SyncAuth | null>(null);
  const setAuth = useCallback((a: SyncAuth | null) => {
    setAuthState(a);
    if (a) persistDek(a.dek);
  }, []);

  const [status, setStatus] = useState<SyncStatus>(() => {
    const persisted = getPersistedAuth();
    return persisted ? "locked" : "unconfigured";
  });
  const [error, setError] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(() => {
    const stored = localStorage.getItem(LS_LAST_SYNC_AT);
    return stored ? new Date(stored) : null;
  });
  const syncingRef = useRef(false);

  // Auto-recover DEK from IDB on mount
  useEffect(() => {
    if (auth) return; // already unlocked
    const persisted = getPersistedAuth();
    if (!persisted) return;
    getPersistedDek().then((dek) => {
      if (dek) {
        setAuthState({ ...persisted, dek });
      }
    });
  }, []); // mount only

  // Update status when auth changes
  useEffect(() => {
    if (auth) {
      setStatus("idle");
      setError(null);
    } else {
      const persisted = getPersistedAuth();
      setStatus(persisted ? "locked" : "unconfigured");
    }
  }, [auth]);

  const sync = useCallback(async () => {
    if (!auth || syncingRef.current) return;
    const serverUrl = getSyncServerUrl();
    if (!serverUrl) return;

    syncingRef.current = true;
    setStatus("syncing");
    setError(null);

    try {
      const result = await runSync(db, auth.dek, serverUrl, auth.token);
      if (result.error) {
        setStatus("error");
        setError(result.error);
      } else {
        setStatus("idle");
        const now = new Date();
        setLastSyncAt(now);
        localStorage.setItem(LS_LAST_SYNC_AT, now.toISOString());
        if (result.pulled > 0) {
          queryClient.invalidateQueries();
        }
      }
    } catch (e: any) {
      setStatus("error");
      setError(e.message ?? String(e));
    } finally {
      syncingRef.current = false;
    }
  }, [auth, db]);

  const logout = useCallback(() => {
    clearAuthStorage();
    clearSyncState();
    setAuth(null);
    setStatus("unconfigured");
    setError(null);
    setLastSyncAt(null);
    localStorage.removeItem(LS_LAST_SYNC_AT);
  }, [setAuth]);

  const forceReset = useCallback(async () => {
    clearSyncState();
    await sync();
  }, [sync]);

  // Debounced sync: triggered by mutations via MutationCache
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    _debouncedSync = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        sync();
      }, 2000);
    };
    return () => {
      _debouncedSync = null;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [sync]);

  // Auto-sync: on unlock, every 5 min, on tab focus
  useEffect(() => {
    if (!auth) return;

    sync();

    const interval = setInterval(sync, SYNC_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [auth, sync]);

  // SSE: listen for push notifications from other devices
  useEffect(() => {
    if (!auth) return;
    const serverUrl = getSyncServerUrl();
    if (!serverUrl) return;

    const controller = new AbortController();
    let running = true;

    (async () => {
      while (running) {
        try {
          const res = await fetch(`${serverUrl}/sync/events`, {
            headers: { Authorization: `Bearer ${auth.token}` },
            signal: controller.signal,
          });
          if (!res.ok || !res.body) break;

          const reader = res.body.getReader();
          const decoder = new TextDecoder();

          while (running) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            if (text.includes("event:sync") || text.includes("event: sync")) {
              sync();
            }
          }
        } catch (e: any) {
          if (e.name === "AbortError") break;
          // Reconnect after 5s on error
          await new Promise(r => setTimeout(r, 5000));
        }
      }
    })();

    return () => {
      running = false;
      controller.abort();
    };
  }, [auth, sync]);

  return (
    <SyncContext.Provider value={{ auth, setAuth, status, error, lastSyncAt, sync, logout, forceReset }}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSyncAuth() {
  const context = useContext(SyncContext);
  if (!context) throw new Error("useSyncAuth must be used within SyncAuthProvider");
  return context;
}

export function useSync() {
  return useSyncAuth();
}

// --- I18n ---

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
