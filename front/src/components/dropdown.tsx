import { DropdownMenu as _Dropdown } from "radix-ui";
import type { ComponentProps } from "react";

export const Root = _Dropdown.Root;
export const Trigger = _Dropdown.Trigger;

export function Content(props: ComponentProps<typeof _Dropdown.Content>) {
	return (
		<_Dropdown.Portal>
			<_Dropdown.Content
				sideOffset={4}
				{...props}
				className={
					"bg-gray-2 border-gray-a3 min-w-[12rem] border rounded-md p-1 z-80 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.18),0_2px_6px_-2px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_24px_-8px_rgba(0,0,0,0.6),0_2px_6px_-2px_rgba(0,0,0,0.4)]" +
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
			className="text-[13px] h-7 rounded-sm text-gray-12 data-highlighted:bg-gray-a3 flex cursor-default items-center gap-2 px-2 outline-none select-none"
		/>
	);
}
