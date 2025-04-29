import { parseDateTime } from "@internationalized/date";
import { CalendarIcon } from "@radix-ui/react-icons";
import { format } from "date-fns";
import { useId, useState } from "react";
import * as Rac from "react-aria-components";

import { api } from "../../api";
import { Button, buttonStyles } from "../../ui/button";
import { IconChevronLeft } from "../../ui/icons/chevron-left";
import { IconChevronRight } from "../../ui/icons/chevron-right";
import { Error, Input, LabelWrapper, inputStyles, labelStyles } from "../../ui/input";
import { useLocaleStuff } from "../use-formatting";

export default function NewTransaction() {
	const mutation = api.useMutation("post", "/transactions");
	const [localErrors, setLocalErrors] = useState<Record<string, string> | null>(null);
	const [serverErrors, setServerErrors] = useState<Record<string, string> | null>(null);

	function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
		e.preventDefault();
		if (mutation.isPending) return;

		const formData = new FormData(e.currentTarget);
		const data = Object.fromEntries(formData);

		const input = {
			counter_party: data.counter_party,
			amount: Number(data.amount),
			date: new Date(data.date).toISOString(),
			additional: data.additional,
			category_name: data.category_name,
		};

		mutation.mutateAsync({ body: input }).catch((error) => {
			setServerErrors(error.response.data.errors);
		});
	}

	const errors = serverErrors ?? localErrors;

	return (
		<main className="w-full max-w-[320px]">
			<h1 className="mb-4 text-lg font-medium">new transaction</h1>

			<form className="w-full" onSubmit={handleSubmit}>
				<fieldset className="space-y-3">
					<Input
						label="counter party"
						name="counter_party"
						error={errors?.counter_party}
					/>
					<Input label="amount" name="amount" error={errors?.amount} />
					<DateField label="date" name="date" error={errors?.date} />
					<Input label="category" name="category_name" error={errors?.category_name} />
					<Input label="additional" name="additional" error={errors?.additional} />
				</fieldset>

				<div className="mt-6 flex justify-end">
					<Button isLoading={mutation.isPending}>add</Button>
				</div>
			</form>
		</main>
	);
}

export function DateField({
	error,
	defaultValue = new Date(),
	name,
	label,
}: {
	error?: string;
	defaultValue?: Date | string;
	name?: string;
	label: string;
}) {
	const { hourCycle } = useLocaleStuff();
	const _defaultValue = parseDateTime(format(defaultValue, "yyyy-MM-dd'T'HH:mm:ss"));

	const id = useId();
	const errorId = error ? id + "-error" : undefined;

	const calCellStyles =
		buttonStyles({ variant: "ghost", size: "icon" }) + " data-selected:bg-gray-a4";

	return (
		<Rac.DatePicker
			granularity="second"
			defaultValue={_defaultValue}
			name={name}
			hourCycle={hourCycle}
		>
			<LabelWrapper>
				<Rac.Label className={labelStyles}>{label}</Rac.Label>

				{error && errorId && <Error id={errorId}>{error}</Error>}
			</LabelWrapper>

			<Rac.Group className="flex gap-2">
				<Rac.DateInput
					className={inputStyles + " inline-flex items-center"}
					aria-describedby={errorId}
				>
					{(segment) => (
						<Rac.DateSegment
							segment={segment}
							className={
								"inline p-1 leading-4 caret-transparent outline-none" +
								" data-[type=literal]:p-0" +
								" data-[type=year]:-me-1" +
								" data-focused:bg-gray-a7 data-focused:text-white"
							}
						/>
					)}
				</Rac.DateInput>
				<Rac.Button className={buttonStyles({ variant: "outline", size: "icon" })}>
					<CalendarIcon className="size-4" />
				</Rac.Button>
			</Rac.Group>

			<Rac.Popover>
				<Rac.Dialog>
					<Rac.Calendar className="bg-gray-1 border-gray-4 border shadow-sm">
						<header className="mb-2 flex items-center justify-between gap-2">
							<Rac.Button
								slot="previous"
								className={buttonStyles({ variant: "ghost", size: "icon" })}
							>
								<IconChevronLeft />
							</Rac.Button>
							<Rac.Heading />
							<Rac.Button
								slot="next"
								className={buttonStyles({ variant: "ghost", size: "icon" })}
							>
								<IconChevronRight />
							</Rac.Button>
						</header>
						<Rac.CalendarGrid>
							{(date) => <Rac.CalendarCell className={calCellStyles} date={date} />}
						</Rac.CalendarGrid>
					</Rac.Calendar>
				</Rac.Dialog>
			</Rac.Popover>
		</Rac.DatePicker>
	);
}
