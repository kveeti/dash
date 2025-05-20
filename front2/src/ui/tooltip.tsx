import { Tooltip } from "radix-ui";
import { ComponentProps } from "react";

export function TooltipContent({ className, ...props }: ComponentProps<typeof Tooltip.Content>) {
	let _className = "bg-gray-1 py-1 px-2 border border-gray-a4";

	if (className) _className += " " + className;

	return <Tooltip.Content className={_className} {...props} />;
}
