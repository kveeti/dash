import { type RouteDefinition, Navigate } from "@solidjs/router";
import { lazy, Suspense } from "solid-js";

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

export const routes: RouteDefinition[] = [
  {
    path: "/inbox",
    component: () => (
      <Layout>
        <Suspense fallback={<p>loading…</p>}>
          <InboxPage />
        </Suspense>
      </Layout>
    ),
  },
  {
    path: "/transactions",
    component: () => (
      <Layout>
        <Suspense fallback={<p>transactions page loading...</p>}>
          <TransactionsPage />
        </Suspense>
      </Layout>
    ),
  },
  {
    path: "/transactions/new",
    component: () => (
      <Layout>
        <Suspense fallback={<p>loading…</p>}>
          <NewTransactionPage />
        </Suspense>
      </Layout>
    ),
  },
  {
    path: "/stats",
    component: () => (
      <Layout>
        <Suspense fallback={<p>loading…</p>}>
          <StatsPage />
        </Suspense>
      </Layout>
    ),
  },
  {
    path: "/imports",
    component: () => (
      <Layout>
        <Suspense fallback={<p>loading…</p>}>
          <ImportsPage />
        </Suspense>
      </Layout>
    ),
  },
  {
    path: "/imports/:id",
    component: () => (
      <Layout>
        <Suspense fallback={<p>loading…</p>}>
          <ImportReportPage />
        </Suspense>
      </Layout>
    ),
  },
  {
    path: "**",
    component: () => <Navigate href="/transactions" />,
  },
];
