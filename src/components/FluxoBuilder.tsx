import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Hand, MessageSquareText, ListChecks, Plus, Trash2 } from "lucide-react";

export type Fluxo = { saudacao: string; opcoes: { label: string; resposta: string }[]; mensagens?: string[] };

type Point = { x: number; y: number };
type Linha = { from: Point; to: Point };

// Pequeno "nó" do canvas, no estilo de um construtor de fluxo.
function No({
  titulo,
  icon,
  children,
  nodeRef,
}: {
  titulo: string;
  icon: React.ReactNode;
  children?: React.ReactNode;
  nodeRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={nodeRef}
      className="w-[230px] shrink-0 rounded-xl border border-border/70 bg-card shadow-sm"
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs font-semibold">
        {icon}
        {titulo}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

// Ponto de conexão (bolinha) na borda do nó.
function Porta({ side, anchorRef }: { side: "left" | "right"; anchorRef: React.Ref<HTMLSpanElement> }) {
  return (
    <span
      ref={anchorRef}
      className={`absolute top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-background bg-primary ${
        side === "left" ? "-left-1.5" : "-right-1.5"
      }`}
    />
  );
}

export function FluxoBuilder({
  fluxo,
  setFluxo,
}: {
  fluxo: Fluxo;
  setFluxo: React.Dispatch<React.SetStateAction<Fluxo>>;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<HTMLSpanElement | null>(null);
  const msgInRef = useRef<HTMLSpanElement | null>(null);
  const msgOutRef = useRef<HTMLSpanElement | null>(null);
  const escInRef = useRef<HTMLSpanElement | null>(null);
  const optOutRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const respInRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const extraInRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const extraOutRefs = useRef<(HTMLSpanElement | null)[]>([]);


  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const medir = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wr = wrap.getBoundingClientRect();
    const ponto = (el: HTMLElement | null): Point | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - wr.left, y: r.top + r.height / 2 - wr.top };
    };
    const novas: Linha[] = [];
    const push = (a: HTMLElement | null, b: HTMLElement | null) => {
      const pa = ponto(a);
      const pb = ponto(b);
      if (pa && pb) novas.push({ from: pa, to: pb });
    };
    push(startRef.current, msgInRef.current);
    push(msgOutRef.current, escInRef.current);
    fluxo.opcoes.forEach((_, i) => push(optOutRefs.current[i], respInRefs.current[i]));
    setLinhas(novas);
    setSize({ w: wrap.scrollWidth, h: wrap.scrollHeight });
  }, [fluxo.opcoes]);

  useLayoutEffect(() => {
    medir();
  }, [medir, fluxo]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => medir());
    ro.observe(wrap);
    window.addEventListener("resize", medir);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", medir);
    };
  }, [medir]);

  return (
    <div className="overflow-x-auto rounded-xl border border-border/60 bg-muted/20">
      <div ref={wrapRef} className="relative flex min-h-[520px] min-w-max items-start gap-16 p-10">

        <svg
          className="pointer-events-none absolute left-0 top-0"
          width={size.w}
          height={size.h}
        >
          {linhas.map((l, i) => (
            <path
              key={i}
              d={`M ${l.from.x} ${l.from.y} C ${l.from.x + 50} ${l.from.y}, ${l.to.x - 50} ${l.to.y}, ${l.to.x} ${l.to.y}`}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth={2}
              opacity={0.6}
            />
          ))}
        </svg>

        {/* Início */}
        <div className="relative">
          <No titulo="Iniciar" icon={<Hand className="h-3.5 w-3.5 text-primary" />}>
            <p className="text-xs text-muted-foreground">Cliente abre o chat</p>
            <Porta side="right" anchorRef={startRef} />
          </No>
        </div>

        {/* Enviar mensagem (saudação) */}
        <div className="relative">
          <No titulo="Enviar mensagem" icon={<MessageSquareText className="h-3.5 w-3.5 text-primary" />}>
            <Input
              value={fluxo.saudacao}
              onChange={(e) => setFluxo((f) => ({ ...f, saudacao: e.target.value }))}
              placeholder="Olá! Selecione uma opção:"
              className="text-xs"
            />
            <Porta side="left" anchorRef={msgInRef} />
            <Porta side="right" anchorRef={msgOutRef} />
          </No>
        </div>

        {/* Pedir para escolher */}
        <div className="relative">
          <No titulo="Pedir para escolher" icon={<ListChecks className="h-3.5 w-3.5 text-primary" />}>
            <div className="space-y-2">
              {fluxo.opcoes.map((op, i) => (
                <div key={i} className="relative flex items-center gap-1">
                  <Input
                    value={op.label}
                    onChange={(e) =>
                      setFluxo((f) => ({
                        ...f,
                        opcoes: f.opcoes.map((o, j) => (j === i ? { ...o, label: e.target.value } : o)),
                      }))
                    }
                    placeholder={`Opção ${i + 1}`}
                    className="h-8 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => setFluxo((f) => ({ ...f, opcoes: f.opcoes.filter((_, j) => j !== i) }))}
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <span
                    ref={(el) => {
                      optOutRefs.current[i] = el;
                    }}
                    className="absolute -right-[26px] top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-background bg-primary"
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-primary"
                onClick={() => setFluxo((f) => ({ ...f, opcoes: [...f.opcoes, { label: "", resposta: "" }] }))}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Opção
              </Button>
            </div>
            <Porta side="left" anchorRef={escInRef} />
          </No>
        </div>

        {/* Respostas automáticas */}
        <div className="flex flex-col gap-4">
          {fluxo.opcoes.length === 0 ? (
            <p className="self-center text-xs text-muted-foreground">Adicione opções</p>
          ) : (
            fluxo.opcoes.map((op, i) => (
              <div key={i} className="relative">
                <No titulo="Enviar mensagem" icon={<MessageSquareText className="h-3.5 w-3.5 text-primary" />}>
                  <Input
                    value={op.resposta}
                    onChange={(e) =>
                      setFluxo((f) => ({
                        ...f,
                        opcoes: f.opcoes.map((o, j) => (j === i ? { ...o, resposta: e.target.value } : o)),
                      }))
                    }
                    placeholder="Um atendente vai te chamar…"
                    className="text-xs"
                  />
                  <span
                    ref={(el) => {
                      respInRefs.current[i] = el;
                    }}
                    className="absolute -left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-background bg-primary"
                  />
                </No>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
