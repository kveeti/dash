import * as _Dialog from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";

import { Heading } from "./typography";

export const Root = _Dialog.Root;
export const Trigger = _Dialog.Trigger;
export const Close = _Dialog.Close;

export function Content(props: ComponentProps<typeof _Dialog.Content>) {
	return (
		<_Dialog.Content
			{...props}
			className={
				"bg-gray-1 border-gray-a5 w-full border p-4 outline-none" + " " + props.className
			}
		/>
	);
}

export function Title(props: ComponentProps<typeof _Dialog.Title>) {
	return (
		<_Dialog.Title asChild>
			<Heading level={2}>{props.children}</Heading>
		</_Dialog.Title>
	);
}

export function Desc(props: ComponentProps<typeof _Dialog.Description>) {
	return <_Dialog.Description {...props} className="text-gray-11" />;
}
