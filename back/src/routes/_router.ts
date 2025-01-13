import { router } from "../trpc.ts";
import { auth_v1 } from "./auth_v1.ts";
import { categories_v1 } from "./categories_v1.ts";
import { transactions_v1 } from "./transactions_v1.ts";

const v1 = router({
	auth: auth_v1,
	transactions: transactions_v1,
	categories: categories_v1,
});

export const rootRouter = router({
	v1,
});

export type Router = typeof rootRouter;
