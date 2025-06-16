import "dotenv/config";
import * as v from "valibot";

import { valibotToHumanUnderstandable } from "./utils.ts";

const schema = v.object({
	secret: v.pipe(v.string(), v.nonEmpty()),
	pgUrl: v.pipe(v.string(), v.nonEmpty()),
	frontUrl: v.pipe(v.string(), v.nonEmpty()),
	useSecureCookie: v.boolean(),
});

const _envs = {
	secret: process.env.SECRET!,
	pgUrl: process.env.PG_URL!,
	useSecureCookie: process.env.USE_SECURE_COOKIE === "true",
	frontUrl: process.env.FRONT_URL,
};

const res = v.safeParse(schema, _envs);
if (!res.success) {
	throw new Error(
		"invalid envs\n" +
			JSON.stringify(valibotToHumanUnderstandable<typeof schema>(res.issues), null, 2)
	);
}

export const envs = res.output;
