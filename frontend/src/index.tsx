import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Route, Router } from "wouter";

import { useBucketsQuery } from "./api/buckets";
import { useCurrenciesQuery } from "./api/currencies";

import "./index.css";
import { I18n } from "./features/i18n/use-i18n";

const InboxPage = lazy(() => import("./features/inbox/inbox-page"));

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Entrypoint />
    </QueryClientProvider>
  </StrictMode>,
);

function Entrypoint() {
  const currenciesQuery = useCurrenciesQuery();

  if (currenciesQuery.isLoading) {
    return "loading currencies...";
  }

  if (currenciesQuery.isError) {
    return "error loading currencies";
  }

  if (!currenciesQuery.data) {
    return "no currencies";
  }

  return (
    <I18n currencies={currenciesQuery.data}>
      <Router>
        <Route path="/inbox" component={InboxPage} />
        {/* <Route path="/transactions" component={TransactionsPage} /> */}
        {/* <Route path="/transactions/new" component={NewTransactionPage} /> */}
        {/* <Route path="/transactions/imports" component={ImportsPage} /> */}
        {/* <Route path="/stats" component={StatsPage} /> */}
      </Router>
    </I18n>
  );
}
