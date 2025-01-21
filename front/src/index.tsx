import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, loggerLink } from "@trpc/client";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import SuperJSON from "superjson";
import { Redirect, Route, Switch } from "wouter";

import { CategoriesPage } from "./authed/categories-page/categories-page";
import { AuthLayout } from "./authed/layout";
import NewTransactionPage from "./authed/new-transaction-page/new-transaction-page";
import { TransactionStatsPage } from "./authed/transaction-stats-page/transaction-stats-page";
import TransactionsPage from "./authed/transactions-page/transactions-page";
import { type Me, MeProvider, useMe } from "./lib/me";
import { trpc } from "./lib/trpc";
import "./styles.css";
import LoginPage from "./unauthed/login-page";
import RegisterPage from "./unauthed/register-page";

function Entry() {
	const { me } = useMe();

	return me ? (
		<AuthLayout>
			<Switch>
				<Route path="/transactions" component={TransactionsPage} />
				<Route path="/transactions/new" component={NewTransactionPage} />
				<Route path="/transactions/stats" component={TransactionStatsPage} />

				<Route path="/categories" component={CategoriesPage} />

				<Route path="*">
					<Redirect href="/transactions" />
				</Route>
			</Switch>
		</AuthLayout>
	) : (
		<Switch>
			<Route path="/login">
				<LoginPage />
			</Route>
			<Route path="/register">
				<RegisterPage />
			</Route>

			<Route path="*">
				<Redirect href="/login" />
			</Route>
		</Switch>
	);
}

function main(initialMe: Me | null) {
	const qc = new QueryClient();

	const trpcClient = trpc.createClient({
		links: [
			loggerLink({
				enabled: (op) =>
					process.env.NODE_ENV === "development" ||
					(op.direction === "down" && op.result instanceof Error),
			}),
			httpBatchLink({
				url: "http://localhost:8000",
				fetch: async (url, init) =>
					fetch(url, {
						...init,
						credentials: "include",
						headers: {
							...init?.headers,
							"x-csrf": initialMe?.csrf ?? "",
						},
					}),
				transformer: SuperJSON,
			}),
		],
	});

	createRoot(document.getElementById("root")!).render(
		<StrictMode>
			<Toaster position="top-center" richColors theme="system" />
			<MeProvider initialMe={initialMe}>
				<trpc.Provider client={trpcClient} queryClient={qc}>
					<QueryClientProvider client={qc}>
						<Entry />
					</QueryClientProvider>
				</trpc.Provider>
			</MeProvider>
		</StrictMode>
	);
}

const me = (window as any).__ME_LOADER__;
const mePromise = me?.promise;

mePromise ? mePromise.then(main) : main(me?.data);
