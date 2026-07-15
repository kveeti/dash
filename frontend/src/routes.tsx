import { type RouteDefinition, Navigate } from "@solidjs/router";
import { type Component, lazy, Suspense } from "solid-js";

import { Layout } from "./features/layout";

const InboxPage = lazy(() => import("./features/inbox/inbox-page"));
const TransactionsPage = lazy(
  () => import("./features/transactions/transactions-page"),
);
const NewTransactionPage = lazy(
  () => import("./features/transactions/new-transaction-page"),
);
const ImportsPage = lazy(() => import("./features/imports/imports-page"));
const StatsPage = lazy(() => import("./features/stats/stats-page"));
const ImportReportPage = lazy(
  () => import("./features/imports/import-report-page"),
);

const page = (Page: Component) => () => (
  <Layout>
    <Suspense fallback={<p>loading…</p>}>
      <Page />
    </Suspense>
  </Layout>
);

export const routes: RouteDefinition[] = [
  { path: "/inbox", component: page(InboxPage) },
  { path: "/transactions", component: page(TransactionsPage) },
  { path: "/transactions/new", component: page(NewTransactionPage) },
  { path: "/stats", component: page(StatsPage) },
  { path: "/imports", component: page(ImportsPage) },
  { path: "/imports/:id", component: page(ImportReportPage) },
  {
    path: "**",
    component: () => <Navigate href="/transactions" />,
  },
];
