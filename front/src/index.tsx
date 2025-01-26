import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, loggerLink } from "@trpc/client";
import { type ReactNode, StrictMode, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster, toast } from "sonner";
import SuperJSON from "superjson";
import { registerSW } from "virtual:pwa-register";
import { Redirect, Route, Switch } from "wouter";

import { AuthLayout } from "./authed/layout";
import { envs } from "./lib/envs";
import { lazyWithPreload } from "./lib/lazy";
import { type Me, MeProvider, useMe } from "./lib/me";
import { trpc } from "./lib/trpc";
import { Button } from "./ui/button";
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

RegisterPage.preload();
CategoriesPage.preload();
TransactionsPage.preload();
TransactionStatsPage.preload();
ImportTransactionsPage.preload();
NewTransactionPage.preload();

function Entry() {
	const { me } = useMe();

	return me ? (
		<AuthLayout>
			<Suspense>
				<Switch>
					<Route path="/transactions" component={TransactionsPage} />
					<Route path="/transactions/new" component={NewTransactionPage} />
					<Route path="/transactions/import" component={ImportTransactionsPage} />
					<Route path="/transactions/stats" component={TransactionStatsPage} />
					<Route path="/categories" component={CategoriesPage} />
					<Route path="*">
						<Redirect href="/transactions" />
					</Route>
				</Switch>
			</Suspense>
		</AuthLayout>
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

function UpdateToast({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
	const [isLoading, setIsLoading] = useState(false);
	return (
		<div className="font-default border-gray-a4 bg-gray-1 flex w-[300px] flex-col gap-4 border p-3 text-sm shadow-lg">
			<p>update available!</p>

			<div className="flex justify-end gap-2">
				<Button variant="ghost" size="sm" onClick={onCancel}>
					not yet!
				</Button>
				<Button
					size="sm"
					onClick={() => {
						setIsLoading(true);
						onConfirm();
					}}
					isLoading={isLoading}
				>
					update
				</Button>
			</div>
		</div>
	);
}
const updateSW = registerSW({
	onNeedRefresh() {
		toast.custom(
			(toastId) => (
				<UpdateToast onConfirm={updateSW} onCancel={() => toast.dismiss(toastId)} />
			),
			{ duration: 20000, position: "bottom-right" }
		);
	},
});

const me = (window as any).__ME_LOADER__;
const mePromise = me?.promise;

if (mePromise) {
	mePromise.then(main);
} else {
	main(me?.data);
}
