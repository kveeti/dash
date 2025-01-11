import { useEffect, useState } from "react";
import * as v from "valibot";

export function cn(...args: any[]): string {
	return args.filter(Boolean).join(" ");
}

export function useDebounce(value: any, delay: number) {
	const [debouncedValue, setDebouncedValue] = useState(value);

	useEffect(() => {
		const handler = setTimeout(() => {
			setDebouncedValue(value);
		}, delay);

		return () => {
			clearTimeout(handler);
		};
	}, [value, delay]);

	return debouncedValue;
}

export type ValibotErrors<TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>> =
	Partial<Record<v.IssueDotPath<TSchema>, string>>;

export function valibotToHumanUnderstandable<
	TSchema extends v.BaseSchema<unknown, unknown, v.BaseIssue<unknown>>,
>(issues: NonNullable<v.SafeParseResult<TSchema>["issues"]>) {
	const flat = v.flatten<TSchema>(issues);
	const errors: ValibotErrors<TSchema> = {};
	for (const key in flat.nested) {
		errors[key as keyof typeof errors] = flat.nested?.[key as keyof typeof flat.nested]?.[0];
	}
	return errors;
}
