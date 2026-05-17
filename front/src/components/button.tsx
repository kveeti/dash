import type { ButtonHTMLAttributes } from "react";
import { ConditionalSpinner } from "./spinner";

const base =
	"focus relative text-[13px] font-medium rounded-md inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap select-none disabled:pointer-events-none disabled:opacity-40 transition-[background-color,color,border-color,opacity] duration-150 ease-out";

const variants = {
	primary: "bg-gray-12 text-gray-1 hover:bg-gray-11",
	outline: "border border-gray-a5 hover:bg-gray-a3 hover:border-gray-a7",
	ghost: "text-gray-11 hover:bg-gray-a3 hover:text-gray-12",
	destructive: "text-red-11 hover:bg-red-a3",
};

const sizes = {
	sm: "h-7 px-2.5 text-[12px]",
	default: "h-8 px-3",
	icon: "size-8",
};

export function buttonStyles({ variant = "primary", size = "default" } = {}) {
	return base + " " + variants[variant] + " " + sizes[size];
}

export function Button({
	variant = "primary",
	size = "default",
	isLoading,
	className,
	children,
	...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
	variant?: keyof typeof variants;
	size?: keyof typeof sizes;
	isLoading?: boolean;
}) {
	let cls = buttonStyles({ variant, size });
	if (className) cls += " " + className;

	return (
		<button {...props} className={cls} aria-busy={isLoading}>
			<ConditionalSpinner isLoading={isLoading}>{children}</ConditionalSpinner>
		</button>
	);
}
