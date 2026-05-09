import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEncrypted } from "../../encrypted-context";
import {
	createCategory,
	deleteCategory,
	getOrCreateCategoryByName,
	listCategories,
	listCategoryOptions,
	updateCategory,
	type CategoryInput,
	type CategoryOption,
	type CategoryWithCount,
} from "../db/categories";
import { broadcastDbChange } from "../db-change-broadcast";
import { queryKeys, queryKeyRoots } from "./query-keys";

export type { CategoryOption, CategoryWithCount };
export { getOrCreateCategoryByName };

function invalidateCategoriesQuery(qc: ReturnType<typeof useQueryClient>) {
	qc.invalidateQueries({ queryKey: queryKeyRoots.categories });
	broadcastDbChange(["categories"]);
}

export function useCategoriesQuery(search?: string) {
	const { db } = useEncrypted();
	return useQuery({
		queryKey: queryKeys.categories(search),
		queryFn: () => listCategories(db, search),
	});
}

export function useCategoryOptionsQuery() {
	const { db } = useEncrypted();
	return useQuery({
		queryKey: [...queryKeyRoots.categories, "options"],
		queryFn: () => listCategoryOptions(db),
	});
}

export function useCreateCategoryMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (cat: CategoryInput) => createCategory(db, cat),
		onSuccess: () => invalidateCategoriesQuery(qc),
	});
}

export function useUpdateCategoryMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({
			id,
			...cat
		}: {
			id: string;
			name: string;
			is_neutral: boolean;
		}) => updateCategory(db, id, cat),
		onSuccess: () => invalidateCategoriesQuery(qc),
	});
}

export function useDeleteCategoryMutation() {
	const { db } = useEncrypted();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => deleteCategory(db, id),
		onSuccess: () => invalidateCategoriesQuery(qc),
	});
}
