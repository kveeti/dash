import type { FormEvent } from "react";

import { envs } from "../lib/envs";
import { Button } from "../ui/button";

// TODO: multiple things
export default function ImportTransactions() {
	function onSubmit(e: FormEvent<HTMLFormElement>) {
		e.preventDefault();

		const data = new FormData(e.currentTarget);

		fetch(envs.apiUrl + "/api/v1/transactions/import", {
			method: "POST",
			body: data,
			credentials: "include",
		});
	}

	return (
		<form onSubmit={onSubmit} className="flex flex-col gap-2">
			<input type="file" name="file" className="border-gray-a4 h-10 border px-3 py-2.5" />
			<Button type="submit">import</Button>
		</form>
	);
}
