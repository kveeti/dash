import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import ConnectionsPage from "../../src/features/connections/connections-page";
import { I18n } from "../../src/features/i18n/use-i18n";
import InboxPage from "../../src/features/inbox/inbox-page";
import TransactionsPage from "../../src/features/transactions/transactions-page";

import "../../src/styles.css";

const params = new URLSearchParams(window.location.search);
const Page = params.has("connections")
  ? ConnectionsPage
  : params.has("transactions")
    ? TransactionsPage
    : InboxPage;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <I18n>
        <Page />
      </I18n>
    </QueryClientProvider>
  </StrictMode>,
);
