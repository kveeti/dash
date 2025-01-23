import type { FormEvent } from "react";

import { envs } from "../lib/envs";
import { Button } from "../ui/button";

export function ImportTransactions() {
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
		<form onSubmit={onSubmit}>
			<input type="file" name="file" />
			<Button type="submit">import</Button>
		</form>
	);
}
