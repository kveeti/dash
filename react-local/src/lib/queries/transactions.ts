import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useDb } from "../../providers";
import { id } from "../id";
import type { DbHandle } from "../db";
import { nextSeq } from "../sync";

export function useTransactionsQuery(props: {
	search: string | undefined;
	cursor?: { left: string | undefined, right: string | undefined }
}) {
	const db = useDb()
	let cursor = null;
	if (props.cursor?.left || props.cursor?.right) {
		cursor = {}
		if (props.cursor?.left) {
			cursor.left = props.cursor.left
		} else if (props.cursor?.right) {
			cursor.right = props.cursor.right
		}
	}

	return useQuery({
		queryKey: ["transactions", props.search, cursor?.left, cursor?.right],
		queryFn: () => getTransactions(db, { cursor, search: props.search, limit: 50 }),
		placeholderData: keepPreviousData
	});
}


async function getTransactions(db, opts?: {
	search?: string;
	limit?: number;
	cursor?: { left: string } | { right: string };
}): Promise<TransactionsResult> {
	const limit = opts?.limit ?? 50;

	let sql = `
		select
			t.id, t.date, t.categorize_on, t.amount, t.currency,
			t.counter_party, t.additional, t.notes,
			t.category_id, t.account_id,
			c.name as category_name, c.is_neutral as category_is_neutral,
			a.name as account_name
		from transactions t
		left join categories c on t.category_id = c.id
		left join accounts a on t.account_id = a.id`;

	const params: any[] = [];
	const wheres: string[] = ["t.deleted_at is null"];

	if (opts?.search) {
		wheres.push("(t.counter_party like ? or t.additional like ?)");
		params.push(`%${opts.search}%`, `%${opts.search}%`);
	}

	let direction: "left" | "right" | null = null;
	if (opts?.cursor) {
		if ("left" in opts.cursor) {
			direction = "left";
			wheres.push(
				"(t.date > (select date from transactions where id = ?) or (t.date = (select date from transactions where id = ?) and t.id > ?))",
			);
			params.push(opts.cursor.left, opts.cursor.left, opts.cursor.left);
		} else {
			direction = "right";
			wheres.push(
				"(t.date < (select date from transactions where id = ?) or (t.date = (select date from transactions where id = ?) and t.id < ?))",
			);
			params.push(opts.cursor.right, opts.cursor.right, opts.cursor.right);
		}
	}

	sql += " where " + wheres.join(" and ");

	const order = direction === "left" ? "asc" : "desc";
	sql += ` order by t.date ${order}, t.id ${order} limit ?`;
	params.push(limit + 1);

	let rows = await db.query<TransactionRow>(sql, params);

	const hasMore = rows.length === limit + 1;
	if (hasMore) rows.pop();
	if (direction === "left") rows.reverse();

	let next_id: string | null = null;
	let prev_id: string | null = null;

	if (rows.length >= 2) {
		const firstId = rows[0].id;
		const lastId = rows[rows.length - 1].id;

		if (hasMore && !direction) {
			next_id = lastId;
			prev_id = null;
		} else if (!hasMore && !direction) {
			next_id = null;
			prev_id = null;
		} else if (hasMore && direction) {
			next_id = lastId;
			prev_id = firstId;
		} else if (!hasMore && direction === "left") {
			next_id = lastId;
			prev_id = null;
		} else if (!hasMore && direction === "right") {
			next_id = null;
			prev_id = firstId;
		}
	}

	return { transactions: rows, next_id, prev_id };
}

async function getTransactionById(db: DbHandle, id: string): Promise<TransactionRow | null> {
	const rows = await db.query<TransactionRow>(`
		select
			t.id, t.date, t.categorize_on, t.amount, t.currency,
			t.counter_party, t.additional, t.notes,
			t.category_id, t.account_id,
			c.name as category_name, c.is_neutral as category_is_neutral,
			a.name as account_name
		from transactions t
		left join categories c on t.category_id = c.id
		left join accounts a on t.account_id = a.id
		where t.id = ? and t.deleted_at is null
	`, [id]);
	return rows[0] ?? null;
}

export function useTransactionQuery(id: string | undefined) {
	const db = useDb();
	return useQuery({
		queryKey: ["transaction", id],
		queryFn: () => getTransactionById(db, id!),
		enabled: !!id,
	});
}

export type TransactionsResult = {
	transactions: TransactionRow[];
	next_id: string | null;
	prev_id: string | null;
};

export type Transaction = {
	id: string;
	date: string;
	categorize_on: string | null;
	amount: number;
	currency: string;
	counter_party: string;
	additional: string | null;
	notes: string | null;
	category_id: string | null;
	account_id: string;
};

export type TransactionRow = Transaction & {
	category_name: string | null;
	category_is_neutral: number | null;
	account_name: string;
};

export function useCreateTransactionMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (tx: {
			date: string;
			amount: number;
			currency: string;
			counter_party: string;
			additional?: string;
			notes?: string;
			category_id?: string;
			account_id: string;
		}) => db.withTx(async () => {
			const now = new Date().toISOString();
			const seq = await nextSeq(db);
			await db.exec(
				`insert into transactions
				 (id, created_at, updated_at, date, amount, currency, counter_party, additional, notes, category_id, account_id, local_seq)
				 values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					id(),
					now,
					now,
					tx.date,
					tx.amount,
					tx.currency,
					tx.counter_party,
					tx.additional ?? null,
					tx.notes ?? null,
					tx.category_id ?? null,
					tx.account_id,
					seq,
				]
			);
		}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["transactions"] });
			qc.invalidateQueries({ queryKey: ["transaction"] });
		},
	});
}

export function useUpdateTransactionMutation() {
	const db = useDb();
	const qc = useQueryClient();
	return useMutation({
		mutationFn: ({ txId, tx }: {
			txId: string;
			tx: {
				date: string;
				amount: number;
				currency: string;
				counter_party: string;
				additional?: string;
				notes?: string;
				category_id?: string;
				account_id: string;
			};
		}) => db.withTx(async () => {
			const now = new Date().toISOString();
			const seq = await nextSeq(db);
			await db.exec(
				`update transactions set
 				 updated_at = ?, date = ?, amount = ?, currency = ?,
 				 counter_party = ?, additional = ?, notes = ?, category_id = ?, account_id = ?,
 				 local_seq = ?
 				 where id = ?`,
				[
					now, tx.date, tx.amount, tx.currency,
					tx.counter_party, tx.additional ?? null, tx.notes ?? null,
					tx.category_id ?? null, tx.account_id, seq, txId,
				]
			);
		}),
		onSuccess: () => {
			qc.invalidateQueries({ queryKey: ["transactions"] });
			qc.invalidateQueries({ queryKey: ["transaction"] });
		},
	});
}
