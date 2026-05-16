import { Combobox } from "./combobox";
import { IconChevronsUpDown } from "./icons/chevrons-up-down";
import { useCreateCategoryMutation } from "../lib/queries/categories";
import { useEffect, useMemo, useRef, useState } from "react";

export type CategoryComboboxItem = {
	id: string;
	value: string;
	label: string;
	creatable?: string;
};

export function CategoryCombobox({
	items,
	value,
	onChange,
	name,
	label,
	required = false,
	disabled = false,
	size = "default",
	className,
	creatable = false,
}: {
	items: CategoryComboboxItem[];
	value: string;
	onChange: (value: string) => void;
	name?: string;
	label?: string;
	required?: boolean;
	disabled?: boolean;
	size?: "sm" | "default";
	className?: string;
	creatable?: boolean;
}) {
	const createCategory = useCreateCategoryMutation();
	const creatingRef = useRef(false);
	const [optimisticDisplay, setOptimisticDisplay] = useState<CategoryComboboxItem | null>(null);
	const selectedItem = useMemo(() => {
		const found = items.find((item) => item.id === value);
		if (found) return found;

		if (optimisticDisplay) {
			if (optimisticDisplay.id === value) return optimisticDisplay;
			if (!value && creatingRef.current) return optimisticDisplay;
		}

		return null;
	}, [items, optimisticDisplay, value]);

	useEffect(() => {
		if (!optimisticDisplay) return;
		if (!value && !creatingRef.current) {
			setOptimisticDisplay(null);
			return;
		}

		const hasResolvedItem = items.some((item) => item.id === value);
		if (hasResolvedItem) {
			setOptimisticDisplay(null);
		}
	}, [items, optimisticDisplay, value]);

	const root = (
		<Combobox.Root
			items={items}
			value={selectedItem}
			onValueChange={(next) => {
				setOptimisticDisplay(null);
				onChange(next?.id ?? "");
			}}
			itemToStringLabel={(item) => item.label}
			isItemEqualToValue={(item, selected) => item.id === selected.id}
			create={
				creatable
					? {
							getItem: ({
								items,
								normalizedInputValue,
								trimmedInputValue,
							}) => {
								if (!trimmedInputValue) return null;

								const hasExactMatch = items.some(
									(item) =>
										item.label.trim().toLocaleLowerCase() ===
										normalizedInputValue,
								);
								if (hasExactMatch) return null;

								return {
									id: `create:${trimmedInputValue.toLocaleLowerCase()}`,
									value: `create:${trimmedInputValue.toLocaleLowerCase()}`,
									label: `Create "${trimmedInputValue}"`,
									creatable: trimmedInputValue,
								};
							},
							isItem: (item) => Boolean(item.creatable),
							onRequest: async (rawQuery) => {
								if (creatingRef.current) return;

								const name = rawQuery.trim();
								if (!name) return;

								const existing = items.find(
									(item) =>
										item.label.trim().toLocaleLowerCase() ===
										name.toLocaleLowerCase(),
								);
								if (existing) {
									setOptimisticDisplay(existing);
									onChange(existing.id);
									return;
								}

								creatingRef.current = true;
								setOptimisticDisplay({
									id: "__creating__",
									value: "__creating__",
									label: name,
								});
								try {
									const newId = await createCategory.mutateAsync({
										name,
										is_neutral: false,
									});
									setOptimisticDisplay({
										id: newId,
										value: newId,
										label: name,
									});
									onChange(newId);
								} finally {
									creatingRef.current = false;
								}
							},
							getQuery: (item) => item.creatable ?? "",
						}
					: undefined
			}
			name={name}
			required={required}
			disabled={disabled}
			autoHighlight
		>
			<Combobox.Trigger<CategoryComboboxItem, CategoryComboboxItem | null>
				className={
					"focus border-gray-6 bg-gray-1 data-[popup-open]:bg-gray-a2 data-[disabled]:opacity-60 flex w-full min-w-0 items-center justify-between gap-2 overflow-hidden border " +
					(size === "sm"
						? "h-8 pl-2.5 pr-2 text-sm"
						: "h-10 pl-3 pr-2.5 text-sm") +
					(className ? ` ${className}` : "")
				}
			>
				{({ selectedValue }) => (
					<>
						<span className="truncate text-gray-12">
							{selectedValue?.label ?? (
								<span className="text-gray-10">select category...</span>
							)}
						</span>
						<Combobox.Icon className="text-gray-10 flex shrink-0">
							<IconChevronsUpDown />
						</Combobox.Icon>
					</>
				)}
			</Combobox.Trigger>
			<Combobox.Content
				searchPlaceholder="search categories..."
				empty="No categories found."
				size={size}
			>
				<Combobox.List<CategoryComboboxItem>>
					{(item) => (
						<Combobox.Item key={item.id} value={item} size={size}>
							{item.creatable ? (
								<div className="flex w-full items-center justify-between gap-2">
									<span className="truncate">Create "{item.creatable}"</span>
									<span className="text-xs text-gray-10">new</span>
								</div>
							) : (
								<span className="min-w-0 flex-1 truncate">{item.label}</span>
							)}
						</Combobox.Item>
					)}
				</Combobox.List>
			</Combobox.Content>
		</Combobox.Root>
	);

	if (!label) return root;

	return (
		<div>
			<label className="text-gray-11 mb-1 block text-xs">{label}</label>
			{root}
		</div>
	);
}
