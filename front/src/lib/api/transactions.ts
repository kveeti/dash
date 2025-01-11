import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { formatCurrency } from "../format";
import { type ApiError, apiRequest } from "./api";

export function useImportTransactions<TResponse extends void, TRequest extends FormData>() {
	return useMutation<TResponse, ApiError, TRequest>({
		mutationKey: ["transactions/import"],
		mutationFn: (data) =>
			apiRequest<TResponse>({
				path: "/v1/transactions/import",
				method: "POST",
				body: data,
			}),
	});
}

export function useTransactions(searchParams: URLSearchParams) {
	return useQuery({
		queryKey: ["transactions", searchParams.toString()],
		queryFn: async () => {
			const res = await apiRequest<{
				next_id: string | null;
				prev_id: string | null;
				transactions: Array<{
					id: string;
					date: string;
					amount: number;
					currency: string;
					counter_party: string;
					additional: string;
					category?: {
						id: string;
						name: string;
						isExpense: boolean;
					};
					links: Array<{
						created_at: string;
						transaction: {
							id: string;
							date: string;
							amount: number;
							counter_party: string;
							additional: string;
						};
					}>;
				}>;
			}>({
				path: "/v1/transactions",
				query: searchParams,
			});

			return {
				...res,
				transactions: res.transactions.map((tx) => ({
					...tx,
					date: new Date(tx.date),
					formattedAmount: formatCurrency(tx.amount, tx.currency),
				})),
			};
		},
	});
}

export function useLinkTransactions<
	TResponse extends void,
	TRequest extends {
		transaction_a_id: string;
		transaction_b_id: string;
	},
>() {
	return useMutation<TResponse, ApiError, TRequest>({
		mutationKey: ["transactions/links"],
		mutationFn: (data) =>
			apiRequest({
				path: "/v1/transactions/links",
				method: "POST",
				body: data,
			}),
	});
}

export function useCreateTransaction<
	TResponse extends void,
	TRequest extends {
		date: string;
		amount: number;
		currency: string;
		counter_party: string;
		additional: string | null;
		category_name: string | null;
	},
>() {
	return useMutation<TResponse, ApiError, TRequest>({
		mutationKey: ["create transaction"],
		mutationFn: (data) =>
			apiRequest({
				path: "/v1/transactions",
				method: "POST",
				body: data,
			}),
	});
}

export function useUpdateTransaction<
	TResponse extends void,
	TRequest extends {
		date: string;
		amount: number;
		currency: string;
		counter_party: string;
		additional: string;
		category_name: string;
	},
>(transactionId: string) {
	const qc = useQueryClient();
	return useMutation<TResponse, ApiError, TRequest>({
		mutationKey: ["update transaction"],
		mutationFn: (data) =>
			apiRequest({
				path: "/v1/transactions/" + transactionId,
				method: "PATCH",
				body: data,
			}),
		onSuccess: () => {
			qc.invalidateQueries({
				queryKey: ["transactions"],
			});

			qc.invalidateQueries({
				queryKey: ["categories"],
			});
		},
	});
}

export function useTransactionStats() {
	return useQuery({
		queryKey: ["transcationStats"],
		queryFn: () =>
			apiRequest<{
				transactions: Array<{
					id: string;
					date: string;
					amount: number;
					currency: string;
					counter_party: string;
					additional: string;
					category?: {
						id: string;
						name: string;
						isExpense: boolean;
					};
					links: Array<{
						created_at: string;
						transaction: {
							id: string;
							date: string;
							amount: number;
							counter_party: string;
							additional: string;
						};
					}>;
				}>;
			}>({
				path: "/v1/transactions/stats",
			}),
	});
}
