import { Redirect, Route, Switch } from "wouter";
import { useMe } from "./api";
import { lazyWithPreload } from "./lib/lazy-with-preload";
import { Suspense, useEffect } from "react";

export function Entrypoint() {
	const me = useMe();

	if (me.data) {
		return <Authed />;
	}

	return <UnAuthed />;
}

const IndexPage = lazyWithPreload(() => import("./authed/index"));
IndexPage.preload();
const TransactionsPage = lazyWithPreload(
	() => import("./authed/transactions/transactions"),
);
TransactionsPage.preload();
const AuthLayout = lazyWithPreload(() => import("./authed/layout"));
AuthLayout.preload();

function Log({ toLog }: { toLog: string }) {
	useEffect(() => {
		console.log(toLog);
	});

	return <></>;
}

function Authed() {
	return (
		<Suspense fallback={<Log toLog="upmost" />}>
			<AuthLayout>
				<Suspense fallback={<Log toLog="inner" />}>
					<Switch>
						<Route path="/">
							<IndexPage />
						</Route>
						<Route path="/transactions">
							<TransactionsPage />
						</Route>
						<Route path="*">
							<Redirect href="/" />
						</Route>
					</Switch>
				</Suspense>
			</AuthLayout>
		</Suspense>
	);
}

function UnAuthed() {
	return (
		<Switch>
			<Route path="/auth/login"></Route>
			<Route path="*">
				<Redirect href="/auth/login" />
			</Route>
		</Switch>
	);
}
