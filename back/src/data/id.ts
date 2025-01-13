import { customAlphabet } from "nanoid";

const _id = customAlphabet("1234567892abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ", 25);

const splitter = "_";
const things = {
	user: "usr",
	transaction: "tx",
	transaction_category: "txc",
};

export function id(thing: keyof typeof things) {
	return things[thing] + splitter + _id(25);
}
