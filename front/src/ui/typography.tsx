import type { ComponentProps } from "react";

const headings = {
	1: "text-xl font-medium",
	2: "text-base font-medium",
};

export function Heading({
	level = 1,
	visualLevel = 1,
	...props
}: {
	level?: 1 | 2;
	visualLevel?: 1 | 2;
} & Omit<ComponentProps<"h1">, "className">) {
	const Tag = `h${level}`;

	// @ts-expect-error TODO
	return <Tag className={headings[visualLevel ?? level]} {...props} />;
}
