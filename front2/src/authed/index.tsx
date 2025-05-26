import { api } from "../api";
import { things } from "../things";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

export default function IndexPage() {
	return (
		<div className="mt-12 flex flex-col gap-4">
			<NewAccount />

			<Button
				onClick={() =>
					fetch(things.apiBase + "/integrations/sync", {
						method: "POST",
						credentials: "include",
					})
				}
			>
				sync
			</Button>
		</div>
	);
}

function NewAccount() {
	const mutation = api.useMutation("post", "/accounts");

	function onSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();

		const formData = new FormData(e.currentTarget);
		const name = formData.get("name")?.toString() ?? "";

		mutation.mutateAsync({ body: { name } });
	}

	return (
		<form onSubmit={onSubmit} className="flex flex-col gap-2">
			<Input label="name" name="name" />

			<Button type="submit">create</Button>
		</form>
	);
}
