import { randomUUID } from "node:crypto";

export interface SyncLock {
  id: string;
  token: string;
}

export interface AcquireSyncLockOptions {
  /** Tempo mínimo entre execuções concluídas com sucesso. */
  intervalMinutes: number;
  /** Tempo máximo que uma execução pode manter o lock antes de ser considerada abandonada. */
  ttlSeconds?: number;
}

/**
 * Reserva uma execução de cron de forma atômica no Postgres.
 * Evita a corrida read-then-upsert que permitia duas instâncias chamarem a API ao mesmo tempo.
 */
export async function acquireSyncLock(
  supabaseAdmin: any,
  id: string,
  options: AcquireSyncLockOptions,
): Promise<SyncLock | null> {
  const token = randomUUID();
  const { data, error } = await supabaseAdmin.rpc("acquire_sync_lock", {
    p_id: id,
    p_interval_seconds: Math.max(0, Math.round(options.intervalMinutes * 60)),
    p_ttl_seconds: Math.max(30, Math.round(options.ttlSeconds ?? 600)),
    p_lock_token: token,
  });

  if (error) {
    console.error(`Falha ao adquirir lock ${id}; execução bloqueada por segurança`, error);
    return null;
  }

  return data === true ? { id, token } : null;
}

/** Finaliza o lock. Só o processo dono do token pode liberá-lo. */
export async function releaseSyncLock(
  supabaseAdmin: any,
  lock: SyncLock | null,
  success: boolean,
  errorMessage?: string,
): Promise<void> {
  if (!lock) return;
  const { error } = await supabaseAdmin.rpc("release_sync_lock", {
    p_id: lock.id,
    p_lock_token: lock.token,
    p_success: success,
    p_error: errorMessage?.slice(0, 1000) ?? null,
  });
  if (error) console.error(`Falha ao liberar lock ${lock.id}`, error);
}
