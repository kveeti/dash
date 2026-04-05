import { Redirect, Route, Switch } from "wouter";
import { TransactionsPage } from "./pages/transactions-page/transactions-page.tsx";
import { AddTransactionsPage } from "./pages/add-transactions-page/add-transactions-page.tsx";
import { CategoriesPage } from "./pages/categories-page/categories-page.tsx";
import { Layout } from "./layout.tsx";

export function Entrypoint() {
  return (
    <Layout>
      <Switch>
        <Route path="/txs" component={TransactionsPage} />
        <Route path="/txs/new" component={AddTransactionsPage} />
        <Route path="/cats" component={CategoriesPage} />

        <Route path="*">
          <Redirect href="/txs" />
        </Route>
      </Switch>
    </Layout>
  );
}

