import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, loggerLink } from "@trpc/client";
import { type ReactNode, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import SuperJSON from "superjson";
import { Redirect, Route, Switch } from "wouter";

import { envs } from "./lib/envs";
import { lazyWithPreload } from "./lib/lazy";
import { type Me, MeProvider, useMe } from "./lib/me";
import { trpc } from "./lib/trpc";
import "./styles.css";
/**
 * LoginPage imported eagerly since its the usual landing page
 */
import LoginPage from "./unauthed/login-page";

const RegisterPage = lazyWithPreload(() => import("./unauthed/register-page"));
const NewTransactionPage = lazyWithPreload(
	() => import("./authed/new-transaction-page/new-transaction-page")
);
const ImportTransactionsPage = lazyWithPreload(() => import("./authed/import-transactions-page"));
const CategoriesPage = lazyWithPreload(() => import("./authed/categories-page/categories-page"));
const TransactionsPage = lazyWithPreload(
	() => import("./authed/transactions-page/transactions-page")
);
const TransactionStatsPage = lazyWithPreload(
	() => import("./authed/transaction-stats-page/transaction-stats-page")
);
const SettingsPage = lazyWithPreload(() => import("./authed/settings-page/settings.page"));
const Providers = lazyWithPreload(() => import("./authed/providers"));
const AuthLayout = lazyWithPreload(() =>
	import("./authed/layout").then((m) => ({ default: m.AuthLayout }))
);
const Sw = lazyWithPreload(() => import("./sw"));

RegisterPage.preload();
CategoriesPage.preload();
TransactionsPage.preload();
TransactionStatsPage.preload();
ImportTransactionsPage.preload();
NewTransactionPage.preload();
SettingsPage.preload();
Providers.preload();
AuthLayout.preload();
Sw.preload();

function Entry() {
	const { me } = useMe();

	return me ? (
		<Suspense>
			<AuthLayout>
				<Providers>
					<Switch>
						<Route path="/transactions">
							<Suspense>
								<TransactionsPage />
							</Suspense>
						</Route>
						<Route path="/transactions/new">
							<Suspense>
								<NewTransactionPage />
							</Suspense>
						</Route>
						<Route path="/transactions/import">
							<Suspense>
								<ImportTransactionsPage />
							</Suspense>
						</Route>
						<Route path="/transactions/stats">
							<Suspense>
								<TransactionStatsPage />
							</Suspense>
						</Route>
						<Route path="/categories">
							<Suspense>
								<CategoriesPage />
							</Suspense>
						</Route>
						<Route path="/settings">
							<Suspense>
								<SettingsPage />
							</Suspense>
						</Route>
						<Route path="*">
							<Redirect href="/transactions" />
						</Route>
					</Switch>
				</Providers>
			</AuthLayout>
		</Suspense>
	) : (
		<Switch>
			<Route path="/login">
				<LoginPage />
			</Route>
			<Route path="/register">
				<Suspense>
					<RegisterPage />
				</Suspense>
			</Route>
			<Route path="*">
				<Redirect href="/login" />
			</Route>
		</Switch>
	);
}

function main(initialMe: Me | null) {
	createRoot(document.getElementById("root")!).render(
		<StrictMode>
			<Toaster position="top-center" richColors theme="system" />
			<Suspense>
				<Sw />
			</Suspense>
			<MeProvider initialMe={initialMe}>
				<Trpc>
					<Entry />
				</Trpc>
			</MeProvider>
		</StrictMode>
	);
}

const qc = new QueryClient();

function Trpc({ children }: { children: ReactNode }) {
	const { me } = useMe();

	const trpcClient = trpc.createClient({
		links: [
			loggerLink({
				enabled: (op) =>
					!envs.isProd || (op.direction === "down" && op.result instanceof Error),
			}),
			httpBatchLink({
				url: envs.apiUrl,
				fetch: async (url, init) =>
					fetch(url, {
						...init,
						credentials: "include",
						headers: {
							...init?.headers,
							"x-csrf": me?.csrf ?? "",
						},
					}),
				transformer: SuperJSON,
			}),
		],
	});

	return (
		<trpc.Provider client={trpcClient} queryClient={qc}>
			<QueryClientProvider client={qc}>{children}</QueryClientProvider>
		</trpc.Provider>
	);
}

function getItem(key: string) {
	const value = localStorage.getItem(key);
	if (!value) return undefined;

	return JSON.parse(value);
}

const optimisticMe = getItem("me") as Me;
const me = (window as any).__ME_LOADER__;
const mePromise = me?.promise;

if (!optimisticMe && mePromise) {
	mePromise.then(main);
} else {
	main(me?.data ?? optimisticMe);
}
