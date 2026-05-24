import type { MouseEvent } from "react";
import { useCallback, useMemo, useRef } from "react";
import { useCreateTagMutation } from "../lib/queries/tags";
import { IconCross } from "./icons/cross";
import { IconPlus } from "./icons/plus";
import {
	localSearchSource,
	UnstableCombobox,
	type UnstableComboboxConfig,
	type UnstableComboboxItem,
} from "./unstable-combobox";
import { useTransientOptions } from "./use-transient-options";

type TagItem = {
	id: string;
	name: string;
};

function tagItemKey(item: TagItem) {
	return item.id;
}

function cx(...classes: Array<string | false | null | undefined>) {
	return classes.filter(Boolean).join(" ");
}

export function TagMultiCombobox({
	items,
	value,
	onChange,
	placeholder = "filter by tag...",
	size = "default",
	className,
	creatable = true,
}: {
	items: TagItem[];
	value: string[];
	onChange: (value: string[]) => void | Promise<void>;
	placeholder?: string;
	size?: "sm" | "default";
	className?: string;
	disabled?: boolean;
	creatable?: boolean;
}) {
	const createTag = useCreateTagMutation();
	const creatingRef = useRef(false);
	const keepTransientItem = useCallback(
		(item: TagItem) => value.includes(item.id),
		[value],
	);
	const tagOptions = useTransientOptions(items, tagItemKey, keepTransientItem);
	const displayItems = tagOptions.options;
	const selectedItems = useMemo(
		() => displayItems.filter((item) => value.includes(item.id)),
		[displayItems, value],
	);
	const uniqueNextValue = useCallback(
		(nextId: string) => Array.from(new Set([...value, nextId])),
		[value],
	);
	const removeValue = useCallback(
		(tagId: string) => onChange(value.filter((selectedId) => selectedId !== tagId)),
		[onChange, value],
	);

	const handleCreateTag = useCallback(
		async (rawName: string) => {
			if (creatingRef.current) return;

			const name = rawName.trim().replace(/\s+/g, " ");
			if (!name) return;

			const existing = displayItems.find(
				(item) => item.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase(),
			);
			if (existing) {
				await onChange(uniqueNextValue(existing.id));
				return;
			}

			creatingRef.current = true;
			try {
				const newId = await createTag.mutateAsync(name);
				tagOptions.add({ id: newId, name });
				await onChange(uniqueNextValue(newId));
			} finally {
				creatingRef.current = false;
			}
		},
		[createTag, displayItems, onChange, tagOptions, uniqueNextValue],
	);

	const config = useMemo<UnstableComboboxConfig>(() => {
		const tagItems = displayItems.map<UnstableComboboxItem>((item) => ({
			id: `tag:${item.id}`,
			label: item.name,
			textValue: item.name,
			checked: value.includes(item.id),
			multi: true,
			onSelect: () => {
				const next = value.includes(item.id)
					? value.filter((selectedId) => selectedId !== item.id)
					: [...value, item.id];
				void onChange(next);
			},
		}));

		return {
			rootPageId: "root",
			pages: {
				root: {
					id: "root",
					title: "tags",
					placeholder: "search tags...",
					empty: "No tags found.",
					items: tagItems,
					search: { sources: [localSearchSource({ id: "tags", items: tagItems })] },
					queryNodes: creatable
						? [
								{
									id: "create-tag",
									placement: "after-results",
									when: ({ query, hasExactMatch }) =>
										query.trim().length > 0 && !hasExactMatch(),
									getNodes: ({ normalizedQuery, query }) => [
										{
											type: "group",
											id: "create-tag",
											label: "Create",
											items: [
												{
													id: `tag:create:${normalizedQuery}`,
													label: (
														<span className="flex min-w-0 items-center gap-1">
															<span className="text-gray-8">#</span>
															<span className="truncate">
																Create "{query.trim()}"
															</span>
														</span>
													),
													textValue: query,
													onSelect: ({ close }) => {
														close();
														void handleCreateTag(query);
													},
												},
											],
										},
									],
								},
							]
						: undefined,
				},
			},
		};
	}, [creatable, displayItems, handleCreateTag, onChange, value]);

	const handleRemove = (
		event: MouseEvent<HTMLButtonElement>,
		tagId: string,
	) => {
		event.preventDefault();
		event.stopPropagation();
		void removeValue(tagId);
	};

	return (
		<UnstableCombobox
			config={config}
			trigger={({ open }) => (
				<div
					className={cx(
						"focus field-trigger flex h-auto w-full min-w-0 items-center gap-1.5 overflow-hidden py-1",
						size === "sm" ? "px-2 text-sm" : "px-3 text-sm",
						open && "border-gray-a5 bg-gray-a2",
						className,
					)}
				>
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
						{selectedItems.length ? (
							selectedItems.map((tag) => (
								<button
									key={tag.id}
									type="button"
									className="inline-flex h-5 max-w-[10rem] items-center gap-1 bg-gray-a3 px-1.5 text-xs text-gray-12 outline-none hover:bg-gray-a5 focus-visible:ring-1 focus-visible:ring-gray-a7"
									aria-label={`Remove ${tag.name}`}
									onMouseDown={(event) => {
										event.preventDefault();
										event.stopPropagation();
									}}
									onClick={(event) => handleRemove(event, tag.id)}
								>
									<span className="truncate">{tag.name}</span>
									<IconCross className="size-3 shrink-0 text-gray-10" />
								</button>
							))
						) : (
							<span className="truncate text-gray-10">{placeholder}</span>
						)}
					</div>
					<span
						className="border-gray-a4 text-gray-10 flex size-5 shrink-0 items-center justify-center border bg-gray-a2"
						aria-hidden
					>
						<IconPlus className="size-3" />
					</span>
				</div>
			)}
		/>
	);
}

export function TagChips({
	tags,
	onRemove,
}: {
	tags: Array<{ id: string; name: string }>;
	onRemove?: (tagId: string) => void;
}) {
	if (!tags.length) return null;

	return (
		<div className="flex min-w-0 flex-wrap gap-1">
			{tags.map((tag) => (
				<span
					key={tag.id}
					className="inline-flex max-w-full items-center gap-1 border border-gray-a4 px-1.5 text-[11px] leading-5 text-gray-11"
				>
					<span className="truncate">{tag.name}</span>
					{onRemove && (
						<button
							type="button"
							className="text-gray-9 hover:text-gray-12"
							onClick={() => onRemove(tag.id)}
							aria-label={`Remove ${tag.name}`}
						>
							x
						</button>
					)}
				</span>
			))}
		</div>
	);
}
