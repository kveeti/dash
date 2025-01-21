import { errorToast } from "../lib/error-toast";
import { useMe } from "../lib/me";
import { trpc } from "../lib/trpc";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { TextLink } from "../ui/link";
import { Heading } from "../ui/typography";

export default function LoginPage() {
	const t = trpc.useUtils();
	const login = trpc.v1.auth.login.useMutation({
		onSuccess: () => t.v1.auth.me.invalidate(),
	});
	const { setMe } = useMe();

	function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (login.isPending) return;

		const form = event.currentTarget as HTMLFormElement;

		const username = form.username.value as string;
		const password = form.password.value as string;

		login.mutateAsync({ username, password }).then(setMe).catch(errorToast("error logging in"));
	}

	return (
		<div className="fixed right-0 bottom-28 left-0 mx-auto w-full max-w-75 px-2 md:relative md:top-28">
			<hgroup className="space-y-2">
				<Heading>login</Heading>

				<p className="text-gray-11">
					no account yet? <TextLink href="/register">register</TextLink>
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

				<Button type="submit" isLoading={login.isPending}>
					login
				</Button>
			</form>
		</div>
	);
}
