import type { ComponentProps } from "react";

import c from "./button.module.css";
import { ConditionalSpinner } from "./spinner";

type Props = {
	size?: "default" | "lg" | "icon";
	variant?: "default" | "destructive" | "ghost";
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
	let _className = c.button;

	if (className) {
		_className += " " + className;
	}

	if (variant) {
		_className += " " + c["variant-" + variant];
	}

	if (size) {
		_className += " " + c["size-" + size];
	}

	return (
		<button className={_className} {...props} aria-busy={isLoading && "true"}>
			<ConditionalSpinner isLoading={isLoading}>{children}</ConditionalSpinner>
		</button>
	);
}
