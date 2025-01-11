import { getData } from "./data/data.ts";
import * as _ from "./envs.ts";
import { createServer } from "./server.ts";

const data = await getData();

const server = createServer({ port: 8000, data });

server.start();

process.on("SIGINT", server.close);
process.on("SIGTERM", server.close);
