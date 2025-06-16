import { errorToast } from "../lib/error-toast";
import { useMe } from "../lib/me";
import { trpc } from "../lib/trpc";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Link } from "../ui/link";
import { Heading } from "../ui/typography";

export default function RegisterPage() {
	const t = trpc.useUtils();
	const register = trpc.v1.auth.register.useMutation({
		onSuccess: () => t.v1.users.me.invalidate(),
	});
	const { setMe } = useMe();

	function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (register.isPending) return;

		const form = event.currentTarget;

		const username = form.username.value as string;
		const password = form.password.value as string;

		register
			.mutateAsync({ username, password })
			.then(setMe)
			.catch(errorToast("error registering"));
	}

	return (
		<div className="fixed right-0 bottom-65 left-0 mx-auto w-full max-w-75 px-2 md:relative md:top-28">
			<hgroup className="space-y-2">
				<Heading>register</Heading>

				<p className="text-gray-11">
					already have an account?{" "}
					<Link variant="text" href="/login">
						login
					</Link>
				</p>
			</hgroup>

			<hr className="bg-gray-4 my-5 h-px w-full border-none" />

			<form onSubmit={handleSubmit} className="space-y-5">
				<Input
					type="username"
					label="username"
					id="username"
					name="username"
					placeholder="john.doe"
					autoComplete="off"
					autoCapitalize="none"
					autoCorrect="off"
				/>

				<Input
					type="password"
					label="password"
					id="password"
					name="password"
					placeholder="••••••••"
					autoComplete="off"
				/>

				<Button type="submit" isLoading={register.isPending}>
					register
				</Button>
			</form>
		</div>
	);
}
