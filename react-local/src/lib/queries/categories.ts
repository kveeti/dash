import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDb } from "../../providers";
import type { DbHandle } from "../db";
import { id } from "../id";

export type CategoryWithCount = {
	id: string;
	name: string;
	is_neutral: number;
	tx_count: number;
};

export function useCategoriesQuery(search?: string) {
	const db = useDb();
	return useQuery({
		queryKey: ["categories", search],
		queryFn: () => getCategories(db, search),
	});
}

export function useCreateCategoryMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (cat: { name: string; is_neutral: boolean }) => createCategory(db, cat),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
	});
}

export function useUpdateCategoryMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ id, ...cat }: { id: string; name: string; is_neutral: boolean }) =>
			updateCategory(db, id, cat),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
	});
}

export function useDeleteCategoryMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (id: string) => deleteCategory(db, id),
		onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
	});
}

async function getCategories(db: DbHandle, search?: string) {
	if (search) {
		return db.query<CategoryWithCount>(
			`select c.id, c.name, c.is_neutral, count(t.id) as tx_count
			 from categories c
			 left join transactions t on c.id = t.category_id
			 where c.name like ?
			 group by c.id
			 order by c.name`,
			[`%${search}%`]
		);
	}
	return db.query<CategoryWithCount>(
		`select c.id, c.name, c.is_neutral, count(t.id) as tx_count
		 from categories c
		 left join transactions t on c.id = t.category_id
		 group by c.id
		 order by c.name`
	);
}

async function createCategory(
	db: DbHandle,
	cat: { name: string; is_neutral: boolean }
) {
	const now = new Date().toISOString();
	await db.exec(
		"insert into categories (id, created_at, name, is_neutral) values (?, ?, ?, ?)",
		[id(), now, cat.name, cat.is_neutral ? 1 : 0]
	);
}

async function updateCategory(
	db: DbHandle,
	categoryId: string,
	cat: { name: string; is_neutral: boolean }
) {
	const now = new Date().toISOString();
	await db.exec(
		"update categories set name = ?, is_neutral = ?, updated_at = ? where id = ?",
		[cat.name, cat.is_neutral ? 1 : 0, now, categoryId]
	);
}

async function deleteCategory(
	db: DbHandle,
	categoryId: string
): Promise<boolean> {
	const rows = await db.query<{ c: number }>(
		"select count(*) as c from transactions where category_id = ?",
		[categoryId]
	);
	if (rows[0].c > 0) return false;
	await db.exec("delete from categories where id = ?", [categoryId]);
	return true;
}

export async function getOrCreateCategoryByName(
	db: DbHandle,
	name: string
): Promise<string> {
	const rows = await db.query<{ id: string }>("select id from categories where name = ?", [name]);
	if (rows.length > 0) return rows[0].id;

	const newId = id();
	const now = new Date().toISOString();
	await db.exec(
		"insert into categories (id, created_at, name, is_neutral) values (?, ?, ?, ?)",
		[newId, now, name, 0]
	);
	return newId;
}
