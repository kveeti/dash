import type { ComponentProps } from "react";

import { ConditionalSpinner } from "./spinner";

const buttonStyles =
	"relative inline-flex items-center justify-center whitespace-nowrap select-none disabled:pointer-events-none disabled:opacity-50";

const variants = {
	default: "text-gray-12 border-gray-a5 bg-gray-4 focus border",
	ghost: "text-gray-12 hover:bg-gray-3 focus",
	destructive:
		"text-red-12 border-red-a5 bg-red-4 focus-visible:outline-red-10 outline-offset-4 border",
};

const sizes = {
	sm: "h-8 px-2",
	default: "h-10 px-4",
	lg: "h-12 px-4",
	icon: "h-10 w-10",
};

type Props = {
	size?: keyof typeof sizes;
	variant?: keyof typeof variants;
	isLoading?: boolean;
} & ComponentProps<"button">;

export function Button({
	className,
	variant = "default",
	size = "default",
	isLoading,
	children,
	...props
}: Props) {
	let _className = buttonStyles;

	if (className) {
		_className += " " + className;
	}

	if (variant) {
		_className += " " + variants[variant];
	}

	if (size) {
		_className += " " + sizes[size];
	}

	return (
		<button className={_className} {...props} aria-busy={isLoading && "true"}>
			<ConditionalSpinner isLoading={isLoading}>{children}</ConditionalSpinner>
		</button>
	);
}
