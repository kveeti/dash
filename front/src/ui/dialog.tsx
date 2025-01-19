import * as _Dialog from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";

import { Heading } from "./typography";

export const Root = _Dialog.Root;
export const Trigger = _Dialog.Trigger;
export const Close = _Dialog.Close;

export function Content(props: ComponentProps<typeof _Dialog.Content>) {
	return (
		<_Dialog.Portal>
			<_Dialog.Overlay className="bg-gray-a4 dark:bg-black-a5 fixed inset-0 backdrop-blur-xs" />
			<_Dialog.Content
				{...props}
				className={
					"bg-gray-1 border-gray-a5 fixed top-[50%] left-[50%] max-h-[85vh] w-[90vw] max-w-[24rem] transform-[translate(-50%,_-50%)] border p-4 outline-none" +
					" " +
					props.className
				}
			/>
		</_Dialog.Portal>
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
