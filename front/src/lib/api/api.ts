import { envs } from "../envs";
import { getCsrf } from "./csrf";

type Props = {
	path: string;
	method?: string;
	body?: unknown;
	query?: Record<string, string> | URLSearchParams;
	signal?: AbortSignal;
};

export async function apiRequest<TReturnValue>(props: Props) {
	const fetchProps = {
		credentials: "include",
		signal: props.signal,
		method: props.method ?? "GET",
	} as RequestInit;

	if (
		props.method === "POST" ||
		props.method === "PUT" ||
		props.method === "DELETE" ||
		props.method === "PATCH"
	) {
		fetchProps.headers = {
			"x-csrf-token": getCsrf(),
		};
	}

	if (props.body) {
		if (fetchProps.method === "GET") {
			throw new Error("GET requests cannot have a body");
		}

		if (props.body instanceof FormData) {
			fetchProps.body = props.body;
		} else {
			fetchProps.body = JSON.stringify(props.body);
			fetchProps.headers = { "Content-Type": "application/json" };
		}
	}

	let url = `${envs.apiUrl}${props.path}`;

	if (props.query) {
		if (!(props.query instanceof URLSearchParams)) {
			props.query = new URLSearchParams(props.query);
		}
		url += "?" + props.query.toString();
	}

	return fetch(url, fetchProps)
		.catch(() => {
			throw new Error("network error");
		})
		.then(async (res) => {
			const json = await res.json().catch(() => null);

			if (res.ok) {
				return json as TReturnValue;
			} else {
				throw new ApiError(
					res.status,
					json,
					json?.error.message ?? "unexpected server error"
				);
			}
		});
}

export class ApiError extends Error {
	constructor(
		public status: number,
		public data: {
			details: Record<string, string> | null;
			message: string;
		},
		message: string
	) {
		super(message);
	}
}
