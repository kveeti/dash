import { type RouteDefinition, Navigate } from "@solidjs/router";
import { lazy, Suspense } from "solid-js";

import { Layout } from "./features/layout";

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

export const routes: RouteDefinition[] = [
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
