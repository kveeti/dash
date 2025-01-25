import { ulid } from "ulid";
import * as v from "valibot";

export const ids = {
	user: "usr",
	transaction: "tx",
	transaction_category: "txc",
	csrf: "csrf",
};

export { ulid as id };

export function idSchema(thing: keyof typeof ids) {
	return v.pipe(
		v.string(),
		v.nonEmpty("required"),
		v.transform((v) => v.slice(ids[thing].length + 1)),
		v.ulid()
	);
}

export function idDb(thing: keyof typeof ids) {
	return ids[thing] + "_";
}
