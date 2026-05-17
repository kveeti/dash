import type { ComponentProps } from "react";

const headings = {
	1: "text-[15px] font-medium tracking-[-0.005em]",
	2: "text-[13px] font-medium tracking-[-0.003em]",
};

export function Heading({
	level = 1,
	visualLevel = 1,
	className,
	...props
}: {
	level?: 1 | 2;
	visualLevel?: 1 | 2;
} & ComponentProps<"h1">) {
	const Tag = `h${level}`;

	return (
		<Tag
			// @ts-expect-error -- ?
			className={headings[level ?? visualLevel] + (className ? " " + className : "")}
			{...props}
		/>
	);
}
