import { type RouteDefinition, Navigate } from "@solidjs/router";
import { lazy, Suspense } from "solid-js";

import { Layout } from "./features/layout";

const TransactionsPage = lazy(
  () => import("./features/transactions/transactions-page"),
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
    path: "**",
    component: () => <Navigate href="/transactions" />,
  },
];
