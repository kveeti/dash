import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { Redirect, Route, Switch } from "wouter";

import { AuthLayout } from "./authed/layout";
import NewTransactionPage from "./authed/new-transaction-page/new-transaction-page";
import TransactionsPage from "./authed/transactions-page/transactions-page";
import { createContext } from "./lib/create-context";
import "./styles.css";
import LoginPage from "./unauthed/login-page";
import RegisterPage from "./unauthed/register-page";

const [useMe, meContext] = createContext<{
	me: { id: string; username: string } | null;
	setMe: (user: { id: string; username: string } | null) => void;
}>();

function MeProvider({ children }: { children: React.ReactNode }) {
	const [me, setMe] = useState<{ id: string; username: string } | null>(
		(window as any).__ME__.data as any
	);

	return <meContext.Provider value={{ setMe, me }}>{children}</meContext.Provider>;
}

function Entry() {
	const { me } = useMe();

	return me ? (
		<AuthLayout>
			<Switch>
				<Route path="/">home</Route>
				<Route path="/transactions">
					<TransactionsPage />
				</Route>
				<Route path="/transactions/new">
					<NewTransactionPage />
				</Route>

				<Route path="*">
					<Redirect href="/" />
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

await window.__ME__.promise;

const qc = new QueryClient();

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Toaster position="top-center" richColors theme="system" />
		<MeProvider>
			<QueryClientProvider client={qc}>
				<Entry />
			</QueryClientProvider>
		</MeProvider>
	</StrictMode>
);
