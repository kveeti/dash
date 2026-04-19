import type { ReactNode } from "react";

import c from "./spinner.module.css";

export function ConditionalSpinner({
	children,
	isLoading,
}: {
	children: ReactNode;
	isLoading?: boolean;
}) {
	if (!isLoading) return children;

	if (children === undefined) return <Spinner />;

	return (
		<span className={c.wrapper}>
			<span aria-hidden="true" className={c.childrenWrapper}>
				{children}
			</span>

			<span className={c.spinnerWrapper}>
				<Spinner />
			</span>
		</span>
	);
}

export function Spinner() {
	return (
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
}
