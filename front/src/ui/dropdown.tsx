import * as _Dropdown from "@radix-ui/react-dropdown-menu";
import type { ComponentProps } from "react";

export const Root = _Dropdown.Root;
export const Trigger = _Dropdown.Trigger;

export function Content(props: ComponentProps<typeof _Dropdown.Content>) {
	return (
		<_Dropdown.Portal>
			<_Dropdown.Content {...props} className="bg-gray-1 border-gray-5 border p-1" />
		</_Dropdown.Portal>
	);
}

export function Item(props: ComponentProps<typeof _Dropdown.Item>) {
	return (
		<_Dropdown.Item
			{...props}
			className="hover:bg-gray-5 inline-flex w-full cursor-default items-center p-2 outline-none select-none"
		/>
	);
}
