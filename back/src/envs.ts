import "dotenv/config";
import * as v from "valibot";

import { valibotToHumanUnderstandable } from "./utils.ts";

const schema = v.object({
	secret: v.pipe(v.string(), v.nonEmpty()),
	pgUrl: v.pipe(v.string(), v.nonEmpty()),
	isProd: v.boolean(),
	useSecureCookie: v.boolean(),
});

const isProd = process.env.NODE_ENV === "production";

const _envs = {
	secret: process.env.SECRET!,
	pgUrl: process.env.PG_URL!,
	isProd,
	useSecureCookie: process.env.USE_SECURE_COOKIE === "true",
};

const res = v.safeParse(schema, _envs);
if (!res.success) {
	throw new Error(
		"invalid envs\n" +
			JSON.stringify(valibotToHumanUnderstandable<typeof schema>(res.issues), null, 2)
	);
}

export const envs = res.output;
