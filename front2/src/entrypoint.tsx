import { Suspense, useEffect } from "react";
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

const IndexPage = lazyWithPreload(() => import("./authed/index"));
IndexPage.preload();

const TxPage = lazyWithPreload(() => import("./authed/transactions/tx-page"));
TxPage.preload();

const NewTxPage = lazyWithPreload(() => import("./authed/transactions/new-tx-page"));
NewTxPage.preload();

const StatsPage = lazyWithPreload(() => import("./authed/stats/statspage"));
StatsPage.preload();

function Log({ toLog }: { toLog: string }) {
	useEffect(() => {
		console.log(toLog);
	}, []);

	return <></>;
}

function Authed() {
	return (
		<LocaleStuff>
			<Suspense fallback={<Log toLog="upmost" />}>
				<AuthLayout>
					<Suspense fallback={<Log toLog="inner" />}>
						<Switch>
							<Route path="/">
								<IndexPage />
							</Route>
							<Route path="/txs">
								<TxPage />
							</Route>
							<Route path="/txs/new">
								<NewTxPage />
							</Route>
							<Route path="/stats">
								<StatsPage />
							</Route>
							<Route path="*">
								<Redirect href="/" />
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
