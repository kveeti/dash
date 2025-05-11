import { CheckIcon } from "@radix-ui/react-icons";
import { Checkbox as _Checkbox } from "radix-ui";
import { ComponentProps, useId } from "react";

export function Checkbox(
	props: ComponentProps<typeof _Checkbox.Root> & {
		label?: string;
	}
) {
	const id = useId();

	return (
		<div className="flex items-center">
			<_Checkbox.Root
				id={id}
				{...props}
				className="focus border-gray-a6 flex size-4 items-center justify-center border"
			>
				<_Checkbox.Indicator>
					<CheckIcon className="text-gray-a11" />
				</_Checkbox.Indicator>
			</_Checkbox.Root>

			{props.label && (
				<label htmlFor={id} className="ms-2">
					{props.label}
				</label>
			)}
		</div>
	);
}
