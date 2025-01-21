import { type ReactNode } from "react";
import { Link as FWLink, useLocation } from "wouter";

export const textLinkStyles =
	"focus text-xs md:text-sm text-current underline -m-2 p-2 hover:bg-gray-a3 inline-block max-w-max";

export const linkStyles = "focus text-xs md:text-sm text-current underline";

export function Link({
	children,
	href,
	className,
	...props
}: {
	children: ReactNode;
	href?: string | null;
	className?: string;
}) {
	const [, setLocation] = useLocation();

	if (!href) {
		return (
			<a
				role="link"
				aria-disabled="true"
				className={linkStyles + (className ? " " + className : "")}
			>
				{children}
			</a>
		);
	}

	return (
		<FWLink
			href={href}
			className={linkStyles + (className ? " " + className : "")}
			onClick={(e) => {
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
				console.log("onTouchStart");

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

export function TextLink({
	children,
	href,
	className,
	...props
}: {
	children: ReactNode;
	href?: string | null;
	className?: string;
}) {
	const [, setLocation] = useLocation();

	if (!href) {
		return (
			<a role="link" aria-disabled="true" className={textLinkStyles}>
				{children}
			</a>
		);
	}

	return (
		<FWLink
			href={href}
			className={textLinkStyles + " " + className}
			onClick={(e) => {
				if (e.defaultPrevented) return false;
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
			{...props}
		>
			{children}
		</FWLink>
	);
}
