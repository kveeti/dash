import { type ReactNode } from "react";
import { Link as FWLink, useLocation } from "wouter";

export const textLinkStyles =
	"focus text-xs md:text-sm text-current underline -m-2 p-2 hover:bg-gray-a3 inline-block max-w-max";

export const linkStyles = "focus text-xs md:text-sm text-current underline";

export function Link({
	children,
	href,
	className,
	variant = "default",
	...props
}: {
	children: ReactNode;
	href?: string | null;
	className?: string;
	variant?: "text" | "default";
}) {
	const [, setLocation] = useLocation();
	const baseStyles = variant === "default" ? linkStyles : textLinkStyles;

	if (!href) {
		return (
			<a
				role="link"
				aria-disabled="true"
				className={baseStyles + (className ? " " + className : "")}
			>
				{children}
			</a>
		);
	}

	return (
		<FWLink
			href={href}
			className={baseStyles + (className ? " " + className : "")}
			onClick={(e) => {
				// onClick has to be cancelled:
				// for example on transaction pagination, users paginating
				// without moving the mouse will end up more pages ahead
				// than intended
				// - user presses the link -> onMouseDown -> navigation
				// - pagination happens, actual anchor tag changes while
				//   the mouse button is still pressed
				// - user lets go of the mouse button on the anchor
				//   -> onClick triggers on the new anchor tag
				//   triggering another pagination
				// - user is now two pages ahead after "clicking" once
				e.preventDefault();
				return false;
			}}
			onMouseDown={(e) => {
				const url = new URL(String(href), window.location.href);
				if (
					url.origin === window.location.origin &&
					e.button === 0 &&
					!e.altKey &&
					!e.ctrlKey &&
					!e.metaKey &&
					!e.shiftKey
				) {
					e.preventDefault();
					setLocation(href);
				}
			}}
			onTouchStart={(e) => {
				const url = new URL(String(href), window.location.href);
				if (url.origin === window.location.origin) {
					e.preventDefault();
					setLocation(href);
				}
			}}
			onKeyUp={(e) => {
				if (e.key !== "Enter" && e.key !== "Space") return;
				const url = new URL(String(href), window.location.href);
				if (url.origin === window.location.origin) {
					e.preventDefault();
					setLocation(href);
				}
			}}
			{...props}
		>
			{children}
		</FWLink>
	);
}
