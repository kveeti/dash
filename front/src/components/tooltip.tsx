import { Tooltip, TooltipAnchor, useTooltipStore } from "@ariakit/react/tooltip";
import type { TooltipStoreProps } from "@ariakit/react/tooltip";
import type { ReactNode } from "react";

const tooltipClass =
	"z-80 origin-[var(--popover-transform-origin)] scale-[0.975] opacity-0 rounded-md border border-gray-a3 bg-gray-2 px-2 py-1 text-[11px] text-gray-12 shadow-[0_12px_32px_-12px_rgba(0,0,0,0.24),0_3px_8px_-3px_rgba(0,0,0,0.12)] outline-none transition-[scale,opacity] duration-90 ease-[cubic-bezier(0.16,1,0.3,1)] data-[enter]:scale-100 data-[enter]:opacity-100 data-[leave]:scale-[0.975] data-[leave]:opacity-0 motion-reduce:duration-1 dark:shadow-[0_12px_32px_-12px_rgba(0,0,0,0.7),0_3px_8px_-3px_rgba(0,0,0,0.45)]";

export function AppTooltip({
	children,
	content,
	className = "",
	placement = "top",
}: {
	children: ReactNode;
	content: ReactNode;
	className?: string;
	placement?: TooltipStoreProps["placement"];
}) {
	const store = useTooltipStore({
		placement,
		showTimeout: 250,
		hideTimeout: 0,
	});

	return (
		<>
			<TooltipAnchor
				store={store}
				render={<span tabIndex={0} />}
				className={
					"focus cursor-help rounded-sm underline decoration-gray-a7 decoration-dotted underline-offset-2 " +
					className
				}
			>
				{children}
			</TooltipAnchor>
			<Tooltip store={store} unmountOnHide gutter={6} className={tooltipClass}>
				{content}
			</Tooltip>
		</>
	);
}
