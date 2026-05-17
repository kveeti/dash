import type { ReactNode } from "react";
import { IconChevronLeft } from "./icons/chevron-left";
import { IconChevronRight } from "./icons/chevron-right";
import { FastLink } from "./link";

export function Pagination(props: { prevHref?: string; nextHref?: string }) {
	return (
		<div className="pointer-events-auto flex items-center gap-2 px-3 py-2 sm:px-0">
			<PaginationPrev href={props.prevHref} />
			<PaginationNext href={props.nextHref} />
		</div>
	);
}

export function PaginationLink({
	href,
	className,
	children,
}: {
	href?: string;
	className?: string;
	children: ReactNode;
}) {
	let cls =
		"bg-gray-1 border-gray-a4 focus rounded-md border select-none hover:border-gray-a6 hover:bg-gray-a2 transition-colors aria-disabled:opacity-40 aria-disabled:cursor-not-allowed text-gray-11 hover:text-gray-12";
	if (className) cls += " " + className;

	return (
		<FastLink className={cls} href={href ?? null}>
			{children}
		</FastLink>
	);
}

export function PaginationNext({ className, href }: { className?: string; href?: string }) {
	return (
		<PaginationLink
			href={href}
			className={
				"relative flex h-8 items-center justify-center px-2.5 text-[12px] before:absolute before:-inset-y-2 before:-right-2 before:left-0 before:content-['']" +
				(className ? " " + className : "")
			}
		>
			<span className="me-1">Next</span>
			<IconChevronRight />
		</PaginationLink>
	);
}

export function PaginationPrev({ className, href }: { className?: string; href?: string }) {
	return (
		<PaginationLink
			href={href}
			className={
				"relative flex h-8 items-center justify-center px-2.5 text-[12px] before:absolute before:-inset-y-2 before:right-0 before:-left-2 before:content-['']" +
				(className ? " " + className : "")
			}
		>
			<IconChevronLeft />
			<span className="ms-1">Prev</span>
		</PaginationLink>
	);
}

export function NavPaginationLinks({
	nextHref,
	prevHref,
}: {
	nextHref?: string;
	prevHref?: string;
}) {
	return (
		<div className="pointer-events-auto -me-5 hidden items-center sm:flex">
			<PaginationPrev href={prevHref} className="border-none" />
			<PaginationNext href={nextHref} className="border-none" />
		</div>
	);
}

export function buildPaginatedHref(
	cursorParam: "left" | "right",
	cursorValue: string | null | undefined,
	href: string,
	prevSearchParams: Record<string, string | string[] | undefined>
): string | undefined {
	if (!cursorValue) return undefined;

	const filteredParams: Record<string, string> = {};
	for (const [key, value] of Object.entries(prevSearchParams)) {
		if (value !== undefined) {
			filteredParams[key] = Array.isArray(value) ? value[0] : value;
		}
	}

	const newParams = new URLSearchParams({
		...filteredParams,
		[cursorParam]: cursorValue,
	});

	if (cursorParam === "left") newParams.delete("right");
	else if (cursorParam === "right") newParams.delete("left");

	return `${href}?${newParams.toString()}`;
}
