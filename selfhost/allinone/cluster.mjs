// ============================================================
// BilheteIA PRO — cluster launcher
// Sobe várias cópias do servidor SSR (uma por núcleo) que
// compartilham a mesma porta via o módulo cluster do Node.
// Assim o app usa todos os vCPUs em vez de um só.
// ============================================================
import cluster from "node:cluster";
import os from "node:os";
import { existsSync } from "node:fs";

const ENTRY = existsSync(".output/server/index.mjs")
  ? "./.output/server/index.mjs"
  : "./serve.mjs";

// Nº de workers: env WEB_CONCURRENCY, senão nº de núcleos (máx. 8).
const cpus = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
const workers = Math.max(1, Number(process.env.WEB_CONCURRENCY) || Math.min(cpus, 8));

if (cluster.isPrimary && workers > 1) {
  console.log(`>> Cluster: iniciando ${workers} workers (${cpus} núcleos)`);
  for (let i = 0; i < workers; i++) cluster.fork();

  cluster.on("exit", (worker, code, signal) => {
    console.error(`>> Worker ${worker.process.pid} caiu (${signal || code}); reiniciando...`);
    cluster.fork();
  });
} else {
  await import(ENTRY);
}
