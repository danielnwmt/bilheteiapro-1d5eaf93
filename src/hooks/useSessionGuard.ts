import { useEffect, useRef } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { registrarPresenca, claimSession } from "@/lib/access.functions";

const IDLE_MS = 30 * 60 * 1000; // 30 minutos sem interação => logout
const HEARTBEAT_MS = 60_000;
const STORAGE_KEY = "bilheteia:sessionId";

function getSessionId() {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(STORAGE_KEY);
  if (!id) {
    id =
      (crypto.randomUUID?.() as string) ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(STORAGE_KEY, id);
  }
  return id;
}

/**
 * - Desloga o usuário após 30 minutos de inatividade.
 * - Mantém apenas 1 conexão ativa por conta (o último login derruba os demais).
 */
export function useSessionGuard() {
  const router = useRouter();
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    let stopped = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let idleCheck: ReturnType<typeof setInterval> | null = null;
    const sessionId = getSessionId();

    const forceLogout = async (mensagem: string) => {
      if (stopped) return;
      stopped = true;
      toast.error(mensagem);
      try {
        await supabase.auth.signOut();
      } catch {
        /* silencioso */
      }
      router.navigate({ to: "/auth", replace: true });
    };

    const markActivity = () => {
      lastActivity.current = Date.now();
    };

    const ping = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session || stopped) return;
      try {
        const res = await registrarPresenca();
        if (res?.activeSession && res.activeSession !== sessionId) {
          await forceLogout("Sua conta foi conectada em outro dispositivo.");
        }
      } catch {
        /* silencioso */
      }
    };

  useEffect(() => {
    let stopped = false;
    let started = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let idleCheck: ReturnType<typeof setInterval> | null = null;
    const sessionId = getSessionId();

    const clearTimers = () => {
      if (heartbeat) clearInterval(heartbeat);
      if (idleCheck) clearInterval(idleCheck);
      heartbeat = null;
      idleCheck = null;
    };

    const forceLogout = async (mensagem: string) => {
      if (stopped) return;
      stopped = true;
      toast.error(mensagem);
      try {
        await supabase.auth.signOut();
      } catch {
        /* silencioso */
      }
      router.navigate({ to: "/auth", replace: true });
    };

    const markActivity = () => {
      lastActivity.current = Date.now();
    };

    const ping = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session || stopped) return;
      try {
        const res = await registrarPresenca();
        if (res?.activeSession && res.activeSession !== sessionId) {
          await forceLogout("Sua conta foi conectada em outro dispositivo.");
        }
      } catch {
        /* silencioso */
      }
    };

    // Inicia os timers/heartbeat quando existe uma sessão ativa. Idempotente.
    const start = async () => {
      if (started || stopped) return;
      const { data } = await supabase.auth.getSession();
      if (!data.session || stopped) return;
      started = true;
      // Este dispositivo assume a sessão ativa.
      try {
        await claimSession({ data: { sessionId } });
      } catch {
        /* silencioso */
      }
      markActivity();
      await ping();

      heartbeat = setInterval(ping, HEARTBEAT_MS);
      idleCheck = setInterval(() => {
        if (Date.now() - lastActivity.current > IDLE_MS) {
          forceLogout("Você foi desconectado por inatividade.");
        }
      }, 30_000);
    };

    const events: (keyof DocumentEventMap)[] = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "click",
    ];
    events.forEach((e) => document.addEventListener(e, markActivity, { passive: true }));

    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVisible);

    // Reage ao login feito na mesma visita (sem reload da página).
    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") {
        start();
      } else if (event === "SIGNED_OUT") {
        started = false;
        clearTimers();
      }
    });

    // Caso já exista sessão no carregamento.
    start();

    return () => {
      stopped = true;
      clearTimers();
      authSub.subscription.unsubscribe();
      events.forEach((e) => document.removeEventListener(e, markActivity));
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);
}
