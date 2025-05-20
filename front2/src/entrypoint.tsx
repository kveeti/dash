import { Suspense } from "react";
import { Redirect, Route, Switch } from "wouter";

import { useMe } from "./api";
import { LocaleStuff } from "./authed/use-formatting";
import { lazyWithPreload } from "./lib/lazy-with-preload";
import { things } from "./things";

export function Entrypoint() {
	const me = useMe();

	if (me.data) {
		return <Authed />;
	}

	return <UnAuthed />;
}

const AuthLayout = lazyWithPreload(() => import("./authed/layout"));
AuthLayout.preload();

const TxPage = lazyWithPreload(() => import("./authed/transactions/tx-page"));
TxPage.preload();

const TxImportPage = lazyWithPreload(() => import("./authed/transactions/tx-import-page"));
TxImportPage.preload();

const NewTxPage = lazyWithPreload(() => import("./authed/transactions/new-tx-page"));
NewTxPage.preload();

const StatsPage = lazyWithPreload(() => import("./authed/stats/stats-page"));
StatsPage.preload();

const CatsPage = lazyWithPreload(() => import("./authed/cats-page"));
CatsPage.preload();

function Authed() {
	return (
		<LocaleStuff>
			<Suspense>
				<AuthLayout>
					<Suspense>
						<Switch>
							<Route path="/txs">
								<TxPage />
							</Route>
							<Route path="/txs/import">
								<TxImportPage />
							</Route>
							<Route path="/txs/new">
								<NewTxPage />
							</Route>
							<Route path="/stats">
								<StatsPage />
							</Route>
							<Route path="/cats">
								<CatsPage />
							</Route>
							<Route path="*">
								<Redirect href="/txs" />
							</Route>
						</Switch>
					</Suspense>
				</AuthLayout>
			</Suspense>
		</LocaleStuff>
	);
}

function UnAuthed() {
	return <Redirect href={things.apiBase + "/auth/init"} />;
}
