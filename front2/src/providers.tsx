import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

const qc = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
	return (
		<>
			<Toaster position="top-center" richColors theme="system" />
			<QueryClientProvider client={qc}>{children}</QueryClientProvider>
		</>
	);
}
