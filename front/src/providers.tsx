import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Tooltip } from "radix-ui";
import type { ReactNode } from "react";
import { Toaster } from "sonner";

const qc = new QueryClient();

export function Providers({ children }: { children: ReactNode }) {
	return (
		<>
			<Toaster position="top-center" richColors theme="system" />
			<QueryClientProvider client={qc}>
				<Tooltip.TooltipProvider>{children}</Tooltip.TooltipProvider>
			</QueryClientProvider>
		</>
	);
}
