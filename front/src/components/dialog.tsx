import * as _Dialog from "@radix-ui/react-dialog";
import type { ComponentProps } from "react";

import { Heading } from "./typography";

export const Root = _Dialog.Root;
export const Trigger = _Dialog.Trigger;
export const Close = _Dialog.Close;

export function Content(props: ComponentProps<typeof _Dialog.Content> & { overlay?: boolean }) {
	return (
		<_Dialog.Portal>
			{props.overlay !== false && (
				<_Dialog.Overlay
					className={
						"fixed inset-0 bg-gray-a4 dark:bg-black-a5" +
						" data-[state=open]:animate-dash-overlay-in" +
						" data-[state=closed]:animate-dash-overlay-out"
					}
				/>
			)}
			<_Dialog.Content
				{...props}
				className={
					"bg-gray-2 border-gray-a3 fixed top-[50%] left-[50%] max-h-[85vh] w-[90vw] max-w-[26rem] transform-[translate(-50%,_-50%)] border rounded-lg p-5 outline-none shadow-[0_24px_64px_-12px_rgba(0,0,0,0.18),0_2px_8px_-2px_rgba(0,0,0,0.08)] dark:shadow-[0_24px_64px_-12px_rgba(0,0,0,0.7),0_2px_8px_-2px_rgba(0,0,0,0.4)]" +
					" data-[state=open]:animate-dash-dialog-in" +
					" data-[state=closed]:animate-dash-dialog-out" +
					" " +
					(props.className ?? "")
				}
			/>
		</_Dialog.Portal>
	);
}

export function Title({ children, ...props }: ComponentProps<typeof _Dialog.Title>) {
	return (
		<_Dialog.Title asChild {...props}>
			<Heading level={2}>{children}</Heading>
		</_Dialog.Title>
	);
}

export function Desc(props: ComponentProps<typeof _Dialog.Description>) {
	return <_Dialog.Description {...props} className="text-gray-11" />;
}
