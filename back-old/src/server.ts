import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import Busboy from "busboy";
import {
	IncomingMessage,
	type RequestListener,
	ServerResponse,
	createServer as _createServer,
} from "node:http";
import Papa from "papaparse";
import * as v from "valibot";

import type { Data } from "./data/data.ts";
import { id } from "./data/id.ts";
import { envs } from "./envs.ts";
import { rootRouter } from "./routes/_router.ts";
import { auth } from "./services/auth.ts";
import { verifyToken } from "./token.ts";
import { createContext } from "./trpc.ts";

export function createServer({ port, data }: { port: number; data: Data }) {
	const services = {
		auth: auth(data),
	};

	const trpcHandler = createHTTPHandler({
		router: rootRouter,
		createContext: createContext(data, services),
	});

	const txImportHandler = handleTransactionImport(data);

	const s = _createServer((req, res) => {
		res.setHeader("Access-Control-Allow-Origin", envs.frontUrl);
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-csrf");
		res.setHeader("Access-Control-Allow-Credentials", "true");

		const isPreflight = req.method === "OPTIONS";
		if (isPreflight) {
			res.writeHead(204);
			res.end();
			return;
		}

		if (req.url?.startsWith("/health")) {
			res.writeHead(200);
			res.end();
			return;
		}

		if (req.method === "POST" && req.url?.startsWith("/api/v1/transactions/import")) {
			return txImportHandler(req, res);
		}

		return trpcHandler(req, res);
	});

	return {
		start: () => {
			s.listen(port, () => console.info(`listening on port ${port}`));
		},
		close: async () => {
			await new Promise<void>((resolve, reject) => {
				s.close((err) => {
					if (err) {
						reject(err);
					} else {
						resolve();
					}
				});
			});
		},
	};
}

function handleTransactionImport(data: Data): RequestListener {
	return (req: IncomingMessage, res: ServerResponse) => {
		void (async () => {
			const cookies = req.headers.cookie;
			if (!cookies) {
				res.writeHead(401);
				res.end();
				return;
			}

			const authCookie = cookies.split("auth=")?.[1]?.split(";")?.[0];
			const userId = await verifyToken(authCookie);
			if (!userId) {
				res.writeHead(401);
				res.end();
				return;
			}

			const busboy = Busboy({ headers: req.headers });

			const parser = Papa.parse(Papa.NODE_STREAM_INPUT);

			busboy.on("file", (_filename, stream, _info) => {
				stream.on("data", (chunk) => {
					parser.write(String(chunk));
				});

				stream.on("end", () => {
					parser.end();
				});
			});

			let buffer: Array<{
				id: string;
				date: Date;
				amount: number;
				currency: string;
				counter_party: string;
				additional: string | null;
				user_id: string;
				category_name?: string;
			}> = [];

			parser.on("data", (row: Array<unknown>) => {
				const res = v.safeParse(rowSchema, {
					date: row[0],
					amount: row[1],
					counter_party: row[2],
					additional: row[3],
					category_name: row[4],
				});
				if (!res.success) {
					console.warn("invalid row", row, res.issues);
					return;
				}

				buffer.push({
					id: id("transaction"),
					...res.output,
					user_id: userId,
					currency: "EUR",
				});

				if (buffer.length > 500) {
					void data.transactions.insertMany(buffer).then(() => {
						console.debug("inserted 500");
					});

					buffer = [];
				}
			});

			parser.on("error", (err) => {
				res.writeHead(500, { "Content-Type": "text/plain" });
				res.end(`Error parsing CSV: ${err.message}`);
			});

			busboy.on("finish", () => {
				res.writeHead(200, { "Content-Type": "text/plain" });
				res.end("CSV uploaded and processed");

				if (buffer.length) {
					void data.transactions.insertMany(buffer).then(() => {
						console.debug("inserted last");
					});

					buffer = [];
				}
			});

			req.pipe(busboy);
		})();
	};
}

const rowSchema = v.object({
	date: v.pipe(
		v.string(),
		v.transform((v) => new Date(v)),
		v.date()
	),
	amount: v.pipe(v.string(), v.transform(Number)),
	counter_party: v.string(),
	additional: v.string(),
	category_name: v.optional(v.string()),
});
