import { toast } from "sonner";

import { ApiError } from "./api/api";

export function errorToast(message: string, options?: { id?: string | number }) {
	return (error: unknown) => {
		console.log(JSON.stringify(error));

		toast.error(message, {
			description: error instanceof ApiError ? error.data?.error?.message : String(error),
			id: options?.id,
		});
	};
}
