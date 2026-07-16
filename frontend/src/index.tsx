import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Redirect, Route, Router, Switch } from "wouter";

import { useCurrenciesQuery } from "./api/currencies";

import "./index.css";
import { I18n } from "./features/i18n/use-i18n";
import { Layout } from "./features/layout";

const InboxPage = lazy(() => import("./features/inbox/inbox-page"));
const TransactionsPage = lazy(
  () => import("./features/transactions/transactions-page"),
);
const NewTransactionPage = lazy(
  () => import("./features/transactions/new-transaction-page"),
);
const ImportsPage = lazy(() => import("./features/imports/imports-page"));
const ImportReportPage = lazy(
  () => import("./features/imports/import-report-page"),
);
const StatsPage = lazy(() => import("./features/stats/stats-page"));

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
        <Layout>
          <Suspense fallback={<p>loading…</p>}>
            <Switch>
              <Route path="/inbox" component={InboxPage} />
              <Route path="/transactions" component={TransactionsPage} />
              <Route path="/transactions/new" component={NewTransactionPage} />
              <Route path="/imports" component={ImportsPage} />
              <Route path="/imports/:id" component={ImportReportPage} />
              <Route path="/stats" component={StatsPage} />
              <Route>
                <Redirect to="/transactions" />
              </Route>
            </Switch>
          </Suspense>
        </Layout>
      </Router>
    </I18n>
  );
}
