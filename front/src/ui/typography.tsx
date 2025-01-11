import type { ComponentProps } from "react";

const headings = {
	1: "text-xl font-medium",
	2: "text-md font-medium",
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

	// @ts-ignore TODO
	return <Tag className={headings[level]} {...props} />;
}
