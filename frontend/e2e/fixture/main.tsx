import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { I18n } from "../../src/features/i18n/use-i18n";
import InboxPage from "../../src/features/inbox/inbox-page";

import "../../src/index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <I18n currencies={[{ code: "EUR", exponent: 2 }]}>
        <InboxPage />
      </I18n>
    </QueryClientProvider>
  </StrictMode>,
);
