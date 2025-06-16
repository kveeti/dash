import { Tooltip } from "radix-ui";
import type { ReactNode } from "react";

export default function Providers({ children }: { children: ReactNode }) {
	return <Tooltip.TooltipProvider>{children}</Tooltip.TooltipProvider>;
}
