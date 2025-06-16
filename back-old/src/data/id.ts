import { ulid } from "ulid";

const splitter = "_";
const things = {
	user: "usr",
	transaction: "txn",
	transaction_category: "txc",
	csrf: "csrf",
	transactions_links: "txl",
};

export function id(thing: keyof typeof things) {
	return things[thing] + splitter + ulid();
}
