import { Redirect, Route, Switch } from "wouter";
import { TransactionsPage } from "./pages/transactions-page/transactions-page.tsx";
import { AddTransactionsPage } from "./pages/add-transactions-page/add-transactions-page.tsx";
import { CategoriesPage } from "./pages/categories-page/categories-page.tsx";
import { AccountsPage } from "./pages/accounts-page/accounts-page.tsx";
import { Layout } from "./layout.tsx";
import { SettingsPage } from "./pages/settings-page/settings-page.tsx";
import { StatsPage } from "./pages/stats-page/stats-page.tsx";
import { LinkSuggestionsPage } from "./pages/link-suggestions-page/link-suggestions-page.tsx";

export function Entrypoint() {
	return (
		<Layout>
			<Switch>
				<Route path="/stats" component={StatsPage} />
				<Route path="/txs" component={TransactionsPage} />
				<Route path="/txs/link-suggestions" component={LinkSuggestionsPage} />
				<Route path="/txs/new" component={AddTransactionsPage} />
				<Route path="/cats" component={CategoriesPage} />
				<Route path="/accounts" component={AccountsPage} />
				<Route path="/settings" component={SettingsPage} />

				<Route path="*">
					<Redirect href="/txs" />
				</Route>
			</Switch>
		</Layout>
	);
}
