import { useMutation, useQueryClient } from "@tanstack/react-query";

import { type ApiError, apiRequest } from "./api";
import { setCsrf } from "./csrf";

export function useLogin<
	TOkResponse extends {
		user_id: string;
		username: string;
		csrf_token: string;
	},
	TVariables extends { username: string; password: string },
>() {
	const qc = useQueryClient();

	return useMutation<TOkResponse, ApiError, TVariables>({
		mutationKey: ["auth/login"],
		mutationFn: (data) =>
			apiRequest<TOkResponse>({
				path: "/v1/auth/login",
				method: "POST",
				body: data,
			}),
		onSuccess(data) {
			qc.setQueryData(["users/@me"], () => ({
				user_id: data.user_id,
				username: data.username,
			}));
			setCsrf(data.csrf_token);
		},
	});
}

export function useRegister<
	TOkResponse extends {
		user_id: string;
		username: string;
		csrf_token: string;
	},
	TVariables extends { username: string; password: string },
>() {
	const qc = useQueryClient();

	return useMutation<TOkResponse, ApiError, TVariables>({
		mutationKey: ["auth/register"],
		mutationFn: (data) =>
			apiRequest<TOkResponse>({
				path: "/v1/auth/register",
				method: "POST",
				body: data,
			}),
		onSuccess(data) {
			qc.setQueryData(["users/@me"], () => ({
				user_id: data.user_id,
				username: data.username,
			}));
			setCsrf(data.csrf_token);
		},
	});
}
