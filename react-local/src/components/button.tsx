import type { ButtonHTMLAttributes } from "react";
import { ConditionalSpinner } from "./spinner";

const base =
	"focus relative text-xs inline-flex shrink-0 items-center justify-center whitespace-nowrap select-none disabled:pointer-events-none disabled:opacity-40";

const variants = {
	primary: "bg-gray-12 text-gray-1 font-bold",
	outline: "border-gray-a5 border",
	ghost: "text-gray-11 hover:bg-gray-a3",
	destructive: "text-red-11 hover:bg-red-a3",
};

const sizes = {
	sm: "h-8 px-3",
	default: "h-10 px-4",
	icon: "size-10",
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
