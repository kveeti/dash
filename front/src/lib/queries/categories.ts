import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDb } from "../../providers";
import type { DbHandle } from "../db";
import { id } from "../id";
import { queryKeys, queryKeyRoots } from "./query-keys";

export type CategoryWithCount = {
	id: string;
	name: string;
	is_neutral: number;
	tx_count: number;
};

export type CategoryOption = {
	id: string;
	name: string;
};

type CategoryInput = {
	name: string;
	is_neutral: boolean;
};

const SELECT_CATEGORIES_SQL = `select c.id, c.name, c.is_neutral, count(t.id) as tx_count
 from categories c
 left join transactions t on c.id = t.category_id and t._sync_is_deleted = 0
 where c._sync_is_deleted = 0`;
const SELECT_CATEGORY_OPTIONS_SQL = `select id, name
 from categories
 where _sync_is_deleted = 0
 order by name`;

function invalidateCategoriesQuery(qc: ReturnType<typeof useQueryClient>) {
	qc.invalidateQueries({ queryKey: queryKeyRoots.categories });
}

export function useCategoriesQuery(search?: string) {
	const db = useDb();
	return useQuery({
		queryKey: queryKeys.categories(search),
		queryFn: () => getCategories(db, search),
	});
}

export function useCategoryOptionsQuery() {
	const db = useDb();
	return useQuery({
		queryKey: [...queryKeyRoots.categories, "options"],
		queryFn: () => getCategoryOptions(db),
	});
}

export function useCreateCategoryMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (cat: CategoryInput) => createCategory(db, cat),
		onSuccess: () => invalidateCategoriesQuery(qc),
	});
}

export function useUpdateCategoryMutation() {
	const db = useDb();
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
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => deleteCategory(db, id),
		onSuccess: () => invalidateCategoriesQuery(qc),
	});
}

async function getCategories(db: DbHandle, search?: string) {
	if (search) {
		return db.query<CategoryWithCount>(
			`${SELECT_CATEGORIES_SQL} and c.name like ?
			 group by c.id order by c.name`,
			[`%${search}%`],
		);
	}
	return db.query<CategoryWithCount>(
		`${SELECT_CATEGORIES_SQL}
		 group by c.id order by c.name`,
	);
}

async function getCategoryOptions(db: DbHandle): Promise<CategoryOption[]> {
	return db.query<CategoryOption>(SELECT_CATEGORY_OPTIONS_SQL);
}

async function createCategory(db: DbHandle, cat: CategoryInput) {
	const newId = id();
	await db.withTx(async () => {
		const now = new Date().toISOString();
		await db.exec(
			"insert into categories (id, created_at, updated_at, name, is_neutral, _sync_edited_at) values (?, ?, ?, ?, ?, ?)",
			[newId, now, now, cat.name, cat.is_neutral ? 1 : 0, Date.now()],
		);
	});
	return newId;
}

async function updateCategory(
	db: DbHandle,
	categoryId: string,
	cat: CategoryInput,
) {
	await db.withTx(async () => {
		const now = new Date().toISOString();
		await db.exec(
			"update categories set name = ?, is_neutral = ?, updated_at = ?, _sync_status = 1, _sync_edited_at = ? where id = ?",
			[cat.name, cat.is_neutral ? 1 : 0, now, Date.now(), categoryId],
		);
	});
}

async function deleteCategory(
	db: DbHandle,
	categoryId: string,
): Promise<boolean> {
	return db.withTx(async () => {
		const rows = await db.query<{ c: number }>(
			"select count(*) as c from transactions where category_id = ? and _sync_is_deleted = 0",
			[categoryId],
		);
		if (rows[0].c > 0) return false;
		const now = new Date().toISOString();
		await db.exec(
			"update categories set _sync_is_deleted = 1, updated_at = ?, _sync_status = 1, _sync_edited_at = ? where id = ?",
			[now, Date.now(), categoryId],
		);
		return true;
	});
}

export async function getOrCreateCategoryByName(
	db: DbHandle,
	name: string,
): Promise<string> {
	return db.withTx(async () => {
		const rows = await db.query<{ id: string }>(
			"select id from categories where name = ? and _sync_is_deleted = 0",
			[name],
		);
		if (rows.length > 0) return rows[0].id;

		const newId = id();
		const now = new Date().toISOString();
		await db.exec(
			"insert into categories (id, created_at, updated_at, name, is_neutral, _sync_edited_at) values (?, ?, ?, ?, ?, ?)",
			[newId, now, now, name, 0, Date.now()],
		);
		return newId;
	});
}
