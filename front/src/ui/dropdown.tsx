import * as _Dropdown from "@radix-ui/react-dropdown-menu";
import type { ComponentProps } from "react";

export const Root = _Dropdown.Root;
export const Trigger = _Dropdown.Trigger;

export function Content(props: ComponentProps<typeof _Dropdown.Content>) {
	return (
		<_Dropdown.Portal>
			<_Dropdown.Content
				{...props}
				className={
					"bg-gray-1 border-gray-5 min-w-[10rem] border p-1" +
					(props.className ? " " + props.className : "")
				}
			/>
		</_Dropdown.Portal>
	);
}

export function Item(props: ComponentProps<typeof _Dropdown.Item>) {
	return (
		<_Dropdown.Item
			{...props}
			className="data-highlighted:bg-gray-a5 flex cursor-default items-center p-2 outline-none select-none"
		/>
	);
}
