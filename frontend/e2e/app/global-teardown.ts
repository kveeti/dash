import { execFileSync } from "node:child_process";

export default function globalTeardown() {
  const port = process.env.PGPORT ?? "5557";
  const adminURL = `postgres://postgres:postgres@127.0.0.1:${port}/postgres`;
  execFileSync("psql", [
    adminURL,
    "-c",
    "drop database if exists dash_e2e with (force)",
  ]);
}
