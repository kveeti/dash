import { toast } from "sonner";

export function errorToast(
	message: string,
	options?: { id?: string | number },
) {
	return (error: unknown) => {
		toast.error(message, {
			description: String(error),
			id: options?.id,
		});
	};
}
