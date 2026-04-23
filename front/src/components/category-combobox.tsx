import { PopupCombobox } from "./popup-combobox";
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
		<PopupCombobox
			items={items}
			value={selectedItem}
			onValueChange={(next) => {
				setOptimisticDisplay(null);
				onChange(next?.id ?? "");
			}}
			getItemKey={(item) => item.id}
			renderItem={(item) => (
				item.creatable ? (
					<div className="flex w-full items-center justify-between gap-2">
						<span className="truncate">Create "{item.creatable}"</span>
						<span className="text-xs text-gray-10">new</span>
					</div>
				) : (
					<span className="truncate">{item.label}</span>
				)
			)}
			itemToStringLabel={(item) => item.label}
			isItemEqualToValue={(item, selected) => item.id === selected.id}
			creatable={creatable ? {
				createItem: (rawQuery) => ({
					id: `create:${rawQuery.toLocaleLowerCase()}`,
					value: `create:${rawQuery.toLocaleLowerCase()}`,
					label: `Create "${rawQuery}"`,
					creatable: rawQuery,
				}),
				isCreateItem: (item) => Boolean(item.creatable),
				isExistingItemMatch: (item, normalizedQuery) =>
					item.label.trim().toLocaleLowerCase() === normalizedQuery,
				onCreateRequest: async (rawQuery) => {
					if (creatingRef.current) return;

					const name = rawQuery.trim();
					if (!name) return;

					const existing = items.find(
						(item) => item.label.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
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
				getCreateQuery: (item) => item.creatable ?? "",
			} : undefined}
			name={name}
			required={required}
			disabled={disabled}
			placeholder={"select category..."}
			inputPlaceholder={"search categories..."}
			size={size}
			className={className}
			emptyState={(
				<p className="p-2 text-gray-10">
					No categories found.
				</p>
			)}
		/>
	);

	if (!label) return root;

	return (
		<div>
			<label className="text-gray-11 mb-1 block text-xs">{label}</label>
			{root}
		</div>
	);
}
