// ============================================================
// BilheteIA PRO — cluster launcher
// Sobe várias cópias do servidor SSR (uma por núcleo) que
// compartilham a mesma porta via o módulo cluster do Node.
// Assim o app usa vários vCPUs em vez de um só — MAS limitado
// pela RAM disponível, porque cada worker é um SSR completo
// (~300-400 MB). Rodar workers demais em VPS pequena causa OOM.
// ============================================================
import cluster from "node:cluster";
import os from "node:os";
import { existsSync } from "node:fs";

const ENTRY = existsSync(".output/server/index.mjs")
  ? "./.output/server/index.mjs"
  : "./serve.mjs";

const cpus = os.availableParallelism
  ? os.availableParallelism()
  : os.cpus().length;

// RAM disponível informada pelo entrypoint (senão usa a RAM livre do SO).
const availMb =
  Number(process.env.BILHETEIA_AVAIL_MB) ||
  Math.round(os.freemem() / (1024 * 1024)) ||
  2048;

// Reserva ~1 GB pra Postgres/Auth/API/nginx e ~400 MB por worker Node.
const MEM_PER_WORKER_MB = Number(process.env.MEM_PER_WORKER_MB) || 400;
const RESERVED_MB = Number(process.env.RESERVED_MB) || 1024;
const byMem = Math.floor((availMb - RESERVED_MB) / MEM_PER_WORKER_MB);

// Nº de workers: env WEB_CONCURRENCY manda; senão o menor entre CPUs, limite de
// memória e 8. Nunca menos que 1.
let workers =
  Number(process.env.WEB_CONCURRENCY) ||
  Math.min(cpus, byMem > 0 ? byMem : 1, 8);
workers = Math.max(1, workers);

if (cluster.isPrimary && workers > 1) {
  console.log(
    `>> Cluster: ${workers} workers (CPUs=${cpus}, RAM disp.=${availMb}MB, limite por mem=${byMem})`,
  );
  for (let i = 0; i < workers; i++) cluster.fork();

  cluster.on("exit", (worker, code, signal) => {
    console.error(
      `>> Worker ${worker.process.pid} caiu (${signal || code}); reiniciando...`,
    );
    cluster.fork();
  });
} else {
  if (workers === 1) console.log(">> Rodando app em processo único (RAM limitada).");
  await import(ENTRY);
}
