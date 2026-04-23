import type { ComponentProps } from "react";

export function IconChevronsUpDown(props: ComponentProps<"svg">) {
	return (
		<svg
			width="7"
			height="10"
			viewBox="0 0 8 12"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			aria-hidden
			{...props}
		>
			<path d="M0.5 4.5L4 1.5L7.5 4.5" />
			<path d="M0.5 7.5L4 10.5L7.5 7.5" />
		</svg>
	);
}
