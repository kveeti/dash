import { things } from "../../things";
import { Button } from "../../ui/button";
import { AccountField } from "./new-tx-page";

export default function TxImportPage() {
	async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();

		const formData = new FormData(e.currentTarget);
		const account_id = formData.get("account_id");
		formData.delete("account_id");

		await fetch(things.apiBase + "/transactions/import/" + account_id, {
			method: "POST",
			body: formData,
		})
			.then((res) => res.json())
			.then((data) => {
				if (data.error) {
					throw "aaaaaaaa";
				}
				alert("success");
			})
			.catch((error) => {
				alert(error.message);
			});
	}

	return (
		<form onSubmit={onSubmit}>
			<input type="file" name="file" />
			<input type="text" />
			<fieldset>
				<legend>file type</legend>

				<div>
					<input type="radio" id="op" name="file_type" value="op" checked />
					<label htmlFor="op">op</label>
				</div>

				<div>
					<input type="radio" id="csv" name="file_type" value="csv" checked />
					<label htmlFor="csv">csv</label>
				</div>
			</fieldset>

			<AccountField />

			<div className="mt-4 flex justify-end">
				<Button type="submit">import</Button>
			</div>
		</form>
	);
}
