import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";
import { prepareDatabase, startCluster } from "../scripts/db/cluster";

declare module "vitest" {
  export interface ProvidedContext {
    pgPort: number;
  }
}

export default async function setup(project: TestProject) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "timberonline-test-pg-"));
  const port = 55000 + Math.floor(Math.random() * 2000);
  const cluster = await startCluster(dir, port, false);
  await prepareDatabase(cluster, "tmpl");
  project.provide("pgPort", port);
  return async () => {
    await cluster.pg.stop();
    rmSync(dir, { recursive: true, force: true });
  };
}
