import type { ReactNode } from "react";
import c from "./spinner.module.css";

export function Spinner({
	children,
	isLoading,
}: {
	children: ReactNode;
	isLoading?: boolean;
}) {
	if (!isLoading) return children;

	const spinner = (
		<span className={c.spinner}>
			<span className={c.leaf} />
			<span className={c.leaf} />
			<span className={c.leaf} />
			<span className={c.leaf} />
			<span className={c.leaf} />
			<span className={c.leaf} />
			<span className={c.leaf} />
			<span className={c.leaf} />
		</span>
	);

	if (children === undefined) return spinner;

	return (
		<span className={c.wrapper}>
			<span aria-hidden="true" className={c.childrenWrapper}>
				{children}
			</span>

			<span className={c.spinnerWrapper}>{spinner}</span>
		</span>
	);
}
