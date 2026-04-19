import type { ReactNode } from "react";

export function Empty(props: { children: ReactNode }) {
	return <p className="text-gray-10 mt-8 text-center" > {props.children} </p>;
}
