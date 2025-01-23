import { createHTTPHandler } from "@trpc/server/adapters/standalone";
import Busboy from "busboy";
import { IncomingMessage, ServerResponse, createServer as _createServer } from "node:http";
import Papa from "papaparse";

import { verifyToken } from "./auth.ts";
import type { Data } from "./data/data.ts";
import { id } from "./data/id.ts";
import type { Transaction } from "./data/transactions.ts";
import { rootRouter } from "./routes/_router.ts";
import { auth } from "./services/auth.ts";
import { createContext } from "./trpc.ts";

export function createServer({ port, data }: { port: number; data: Data }) {
	const services = {
		auth: auth(data),
	};

	const trpcHandler = createHTTPHandler({
		router: rootRouter,
		createContext: createContext(data, services),
	});

	const s = _createServer((req, res) => {
		res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
		res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
		res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-csrf");
		res.setHeader("Access-Control-Allow-Credentials", "true");

		const isPreflight = req.method === "OPTIONS";
		if (isPreflight) {
			res.writeHead(204);
			res.end();
			return;
		}

		if (req.method === "POST" && req.url?.startsWith("/api/v1/transactions/import")) {
			return handleTransactionImport(data)(req, res);
		}

		return trpcHandler(req, res);
	});

	return {
		start: () => {
			s.listen(port, () => console.log(`listening on port ${port}`));
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

function handleTransactionImport(data: Data) {
	return async (req: IncomingMessage, res: ServerResponse) => {
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

		busboy.on("file", (fieldname, file, filename, encoding, mimetype) => {
			file.on("data", (chunk) => {
				parser.write(chunk.toString());
			});

			file.on("end", () => {
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
			category_name: string;
		}> = [];

		parser.on("data", (row) => {
			const date = row[0];
			const amount = row[1];
			const counterParty = row[2];
			const additional = row[3];
			const categoryName = row[4];

			buffer.push({
				id: id("transaction"),
				date,
				amount,
				counter_party: counterParty,
				additional,
				category_name: categoryName,
				user_id: userId,
				currency: "EUR",
			});

			if (buffer.length > 500) {
				data.transactions.insertMany(buffer).then(() => {
					console.log("inserted 500");
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
				data.transactions.insertMany(buffer).then(() => {
					console.log("inserted last");
				});

				buffer = [];
			}
		});

		req.pipe(busboy);
	};
}
