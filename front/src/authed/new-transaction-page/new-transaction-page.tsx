import { type FormEvent, useState } from "react";
import * as v from "valibot";

import { useCreateTransaction } from "../../lib/api/transactions";
import { valibotToHumanUnderstandable } from "../../lib/utils";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Heading } from "../../ui/typography";
import { AmountAndCurrencyField, CategoryField, DateField } from "./new-transaction-fields";

const schema = v.object({
	counter_party: v.pipe(v.string(), v.nonEmpty("required")),
	amount: v.pipe(v.string(), v.transform(parseFloat), v.number("required")),
	currency: v.pipe(v.string(), v.nonEmpty()),
	date: v.pipe(
		v.string(),
		v.nonEmpty(),
		v.transform((v) => new Date(v).toISOString())
	),
	additional: v.pipe(
		v.string(),
		v.transform((v) => v || null)
	),
	category_name: v.pipe(
		v.string(),
		v.transform((v) => v || null)
	),
});

export default function NewTransactionPage() {
	const mutation = useCreateTransaction();
	const [localErrors, setLocalErrors] = useState<Record<string, string> | null>(null);

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (mutation.isPending) return;

		const formData = new FormData(event.currentTarget);
		const data = Object.fromEntries(formData);

		const res = v.safeParse(schema, data);
		if (!res.success) {
			setLocalErrors(valibotToHumanUnderstandable(res.issues));
			return;
		}

		mutation.mutateAsync(res.output).then(() => setLocalErrors(null));
	}

	const errors = mutation.error?.data?.details ?? localErrors;

	return (
		<main className="w-full px-2 py-6 md:pt-4">
			<div className="mx-auto max-w-100">
				<Heading>new transaction</Heading>

				<form onSubmit={onSubmit} className="flex flex-col gap-4 pt-5">
					<Input
						label="counter party"
						error={errors?.counter_party}
						name="counter_party"
						autoComplete="off"
					/>

					<AmountAndCurrencyField amountError={errors?.amount} />

					<DateField error={errors?.date} />

					{/* TODO: textarea might be better */}
					<Input label="additional" name="additional" error={errors?.additional} />

					<CategoryField error={errors?.category_name} />

					<div className="flex justify-end">
						<Button isLoading={mutation.isPending}>create</Button>
					</div>
				</form>
			</div>
		</main>
	);
}
