import { Redirect, Route, Switch } from "wouter";
import { TransactionsPage } from "./pages/transactions-page/transactions-page.tsx";
import { AddTransactionsPage } from "./pages/add-transactions-page/add-transactions-page.tsx";
import { CategoriesPage } from "./pages/categories-page/categories-page.tsx";
import { Layout } from "./layout.tsx";
import { SettingsPage } from "./pages/settings-page/settings-page.tsx";
import { StatsPage } from "./pages/stats-page/stats-page.tsx";

export function Entrypoint() {
	return (
		<Layout>
			<Switch>
				<Route path="/stats" component={StatsPage} />
				<Route path="/txs" component={TransactionsPage} />
				<Route path="/txs/new" component={AddTransactionsPage} />
				<Route path="/cats" component={CategoriesPage} />
				<Route path="/settings" component={SettingsPage} />

				<Route path="*">
					<Redirect href="/txs" />
				</Route>
			</Switch>
		</Layout>
	);
}
