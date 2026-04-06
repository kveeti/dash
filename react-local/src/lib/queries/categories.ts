import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useDb } from "../../providers";
import type { DbHandle } from "../db";
import { id } from "../id";
import { nextSeq } from "../sync";

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
			 left join transactions t on c.id = t.category_id and t.deleted_at is null
			 where c.deleted_at is null and c.name like ?
			 group by c.id
			 order by c.name`,
			[`%${search}%`]
		);
	}
	return db.query<CategoryWithCount>(
		`select c.id, c.name, c.is_neutral, count(t.id) as tx_count
		 from categories c
		 left join transactions t on c.id = t.category_id and t.deleted_at is null
		 where c.deleted_at is null
		 group by c.id
		 order by c.name`
	);
}

async function createCategory(
	db: DbHandle,
	cat: { name: string; is_neutral: boolean }
) {
	await db.withTx(async () => {
		const now = new Date().toISOString();
		const seq = await nextSeq(db);
		await db.exec(
			"insert into categories (id, created_at, updated_at, name, is_neutral, local_seq) values (?, ?, ?, ?, ?, ?)",
			[id(), now, now, cat.name, cat.is_neutral ? 1 : 0, seq]
		);
	});
}

async function updateCategory(
	db: DbHandle,
	categoryId: string,
	cat: { name: string; is_neutral: boolean }
) {
	await db.withTx(async () => {
		const now = new Date().toISOString();
		const seq = await nextSeq(db);
		await db.exec(
			"update categories set name = ?, is_neutral = ?, updated_at = ?, local_seq = ? where id = ?",
			[cat.name, cat.is_neutral ? 1 : 0, now, seq, categoryId]
		);
	});
}

async function deleteCategory(
	db: DbHandle,
	categoryId: string
): Promise<boolean> {
	return db.withTx(async () => {
		const rows = await db.query<{ c: number }>(
			"select count(*) as c from transactions where category_id = ? and deleted_at is null",
			[categoryId]
		);
		if (rows[0].c > 0) return false;
		const now = new Date().toISOString();
		const seq = await nextSeq(db);
		await db.exec(
			"update categories set deleted_at = ?, updated_at = ?, local_seq = ? where id = ?",
			[now, now, seq, categoryId]
		);
		return true;
	});
}

export async function getOrCreateCategoryByName(
	db: DbHandle,
	name: string
): Promise<string> {
	return db.withTx(async () => {
		const rows = await db.query<{ id: string }>(
			"select id from categories where name = ? and deleted_at is null",
			[name],
		);
		if (rows.length > 0) return rows[0].id;

		const newId = id();
		const now = new Date().toISOString();
		const seq = await nextSeq(db);
		await db.exec(
			"insert into categories (id, created_at, updated_at, name, is_neutral, local_seq) values (?, ?, ?, ?, ?, ?)",
			[newId, now, now, name, 0, seq]
		);
		return newId;
	});
}
