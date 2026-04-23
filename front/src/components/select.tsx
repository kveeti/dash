import * as React from "react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { IconChevronDown } from "./icons/chevron-down";

type SelectChangeEvent = {
	currentTarget: {
		value: string;
	};
	target: {
		value: string;
	};
};

type OptionItem = {
	value: string;
	label: React.ReactNode;
	disabled?: boolean;
};

const sizes = {
	sm: {
		trigger: "h-8 pl-2.5 pr-2 text-sm",
		item: "py-1.5 text-sm",
	},
	default: {
		trigger: "h-10 pl-3 pr-2.5 text-base",
		item: "py-2 text-sm",
	},
};

export function Select({
	label,
	size = "default",
	className,
	children,
	name,
	required,
	disabled,
	value,
	defaultValue,
	onChange,
	placeholder,
}: {
	label?: string;
	size?: keyof typeof sizes;
	className?: string;
	children: React.ReactNode;
	name?: string;
	required?: boolean;
	disabled?: boolean;
	value?: string;
	defaultValue?: string;
	onChange?: (event: SelectChangeEvent) => void;
	placeholder?: string;
}) {
	const items = React.useMemo(() => flattenOptions(children), [children]);
	const firstEnabledValue = items.find((item) => !item.disabled)?.value;
	const resolvedDefaultValue =
		defaultValue !== undefined ? defaultValue : firstEnabledValue;
	const triggerClass =
		"w-full focus border-gray-6 bg-gray-1 border flex min-w-0 items-center justify-between gap-2 select-none text-gray-12 data-[popup-open]:bg-gray-2 " +
		sizes[size].trigger +
		(className ? ` ${className}` : "");

	const root = (
		<BaseSelect.Root
			items={items}
			name={name}
			required={required}
			disabled={disabled}
			{...(value !== undefined ? { value } : { defaultValue: resolvedDefaultValue })}
			onValueChange={(next) => {
				onChange?.({
					currentTarget: { value: next ?? "" },
					target: { value: next ?? "" },
				});
			}}
		>
			{label ? <BaseSelect.Label className="text-gray-11 mb-1 block text-xs">{label}</BaseSelect.Label> : null}
			<BaseSelect.Trigger className={triggerClass}>
				<div className="min-w-0 flex-1 overflow-hidden text-left">
					<BaseSelect.Value
						className="block w-full truncate data-[placeholder]:text-gray-10 text-sm"
						placeholder={placeholder ?? "select..."}
					/>
				</div>
				<BaseSelect.Icon className="text-gray-10 flex shrink-0">
					<IconChevronDown width="12" height="12" />
				</BaseSelect.Icon>
			</BaseSelect.Trigger>

			<BaseSelect.Portal>
				<BaseSelect.Positioner className="outline-hidden select-none z-50">
					<BaseSelect.Popup className="group min-w-[var(--anchor-width)] origin-[var(--transform-origin)] bg-gray-1 text-gray-12 shadow-lg outline-1 outline-gray-4 transition-[transform,scale,opacity] data-[ending-style]:scale-90 data-[ending-style]:opacity-0 data-[side=none]:min-w-[calc(var(--anchor-width)+1rem)] data-[side=none]:data-[ending-style]:transition-none data-[starting-style]:scale-90 data-[starting-style]:opacity-0 data-[side=none]:data-[starting-style]:scale-100 data-[side=none]:data-[starting-style]:opacity-100 data-[side=none]:data-[starting-style]:transition-none">
						<BaseSelect.ScrollUpArrow className="top-0 z-[1] flex h-4 w-full cursor-default items-center justify-center bg-gray-1 text-center text-xs before:absolute data-[side=none]:before:top-[-100%] before:left-0 before:h-full before:w-full before:content-['']" />
						<BaseSelect.List className="relative scroll-py-6 overflow-y-auto max-h-[var(--available-height)] z-20">
							{items.map((item) => (
								<BaseSelect.Item
									key={item.value}
									value={item.value}
									disabled={item.disabled}
									className={
										"h-10 data-[disabled]:text-gray-9 data-[disabled]:cursor-not-allowed grid cursor-default grid-cols-[0.75rem_1fr] items-center gap-2 pr-4 pl-2.5 leading-4 outline-hidden select-none group-data-[side=none]:pr-12 data-[highlighted]:relative data-[highlighted]:z-0 data-[highlighted]:text-gray-12 data-[highlighted]:before:absolute data-[highlighted]:before:inset-x-0 data-[highlighted]:before:inset-y-0 data-[highlighted]:before:z-[-1] data-[highlighted]:before:bg-gray-a3 pointer-coarse:text-[0.925rem] " +
										sizes[size].item
									}
								>
									<BaseSelect.ItemIndicator className="col-start-1">
										<CheckIcon className="size-3" />
									</BaseSelect.ItemIndicator>
									<BaseSelect.ItemText className="col-start-2 truncate">
										{item.label}
									</BaseSelect.ItemText>
								</BaseSelect.Item>
							))}
						</BaseSelect.List>
						<BaseSelect.ScrollDownArrow className="bottom-0 z-[1] flex h-4 w-full cursor-default items-center justify-center bg-gray-1 text-center text-xs before:absolute before:left-0 before:h-full before:w-full before:content-[''] data-[side=none]:before:bottom-[-100%]" />
					</BaseSelect.Popup>
				</BaseSelect.Positioner>
			</BaseSelect.Portal>
		</BaseSelect.Root>
	);

	if (!label) return root;

	return <div>{root}</div>;
}

function flattenOptions(children: React.ReactNode): OptionItem[] {
	const items: OptionItem[] = [];

	React.Children.forEach(children, (child) => {
		if (!React.isValidElement(child)) {
			return;
		}

		if (child.type === React.Fragment) {
			const fragment = child as React.ReactElement<{ children?: React.ReactNode }>;
			items.push(...flattenOptions(fragment.props.children));
			return;
		}

		if (child.type !== "option") {
			return;
		}

		const option = child as React.ReactElement<{
			value?: unknown;
			disabled?: boolean;
			children?: React.ReactNode;
		}>;
		const value = stringifyOptionValue(option.props.value);
		items.push({
			value,
			label: option.props.children,
			disabled: Boolean(option.props.disabled),
		});
	});

	return items;
}

function stringifyOptionValue(value: unknown): string {
	if (value == null) return "";
	return String(value);
}

function CheckIcon(props: React.ComponentProps<"svg">) {
	return (
		<svg fill="currentColor" width="10" height="10" viewBox="0 0 10 10" aria-hidden {...props}>
			<path d="M9.1603 1.12218C9.50684 1.34873 9.60427 1.81354 9.37792 2.16038L5.13603 8.66012C5.01614 8.8438 4.82192 8.96576 4.60451 8.99384C4.3871 9.02194 4.1683 8.95335 4.00574 8.80615L1.24664 6.30769C0.939709 6.02975 0.916013 5.55541 1.19372 5.24822C1.47142 4.94102 1.94536 4.91731 2.2523 5.19524L4.36085 7.10461L8.12299 1.33999C8.34934 0.993152 8.81376 0.895638 9.1603 1.12218Z" />
		</svg>
	);
}
