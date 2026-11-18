/**
 * Lokale ontwikkeldatabase (embedded Postgres 17). Gebruik: npm run db:local
 * Draait door tot Ctrl+C. Data staat in .data/pg (niet in Git).
 */
import path from "node:path";
import { prepareDatabase, startCluster } from "./cluster";

const port = Number(process.env.LOCAL_PG_PORT ?? 54329);
const dir = path.join(process.cwd(), ".data", "pg");

const cluster = await startCluster(dir, port, true);
const done = await prepareDatabase(cluster, "timberonline");
console.log(`Lokale Postgres op poort ${port}. Nieuwe migraties: ${done.length ? done.join(", ") : "geen"}`);
console.log(`DATABASE_URL=${cluster.url("timberonline")}`);
const stop = async () => {
  await cluster.pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
