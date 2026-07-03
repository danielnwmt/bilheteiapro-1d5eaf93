import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Hand, MessageSquareText, ListChecks, Plus, Trash2, GripVertical } from "lucide-react";

export type Fluxo = {
  saudacao: string;
  opcoes: { label: string; resposta: string; ouvidoria?: boolean; destino?: string }[];
  mensagens?: string[];
};

type Point = { x: number; y: number };
type Linha = { from: Point; to: Point; optIndex?: number };
type Pos = { x: number; y: number };

// Posições padrão dos nós no canvas.
const POS_PADRAO: Record<string, Pos> = {
  start: { x: 40, y: 60 },
  msg: { x: 320, y: 60 },
  esc: { x: 620, y: 60 },
};

// Nó arrastável do canvas.
function No({
  titulo,
  icon,
  children,
  pos,
  onDrag,
}: {
  titulo: string;
  icon: React.ReactNode;
  children?: React.ReactNode;
  pos: Pos;
  onDrag: (e: React.PointerEvent) => void;
}) {
  return (
    <div
      className="absolute w-[230px] rounded-xl border border-border/70 bg-card shadow-sm"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        onPointerDown={onDrag}
        className="flex cursor-grab items-center gap-2 border-b border-border/60 px-3 py-2 text-xs font-semibold active:cursor-grabbing"
      >
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
        {icon}
        {titulo}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

// Porta de entrada (alvo de conexão). Recebe um id para saber onde a opção liga.
function PortaEntrada({
  portaId,
  anchorRef,
}: {
  portaId: string;
  anchorRef: React.Ref<HTMLSpanElement>;
}) {
  return (
    <span
      ref={anchorRef}
      data-porta-entrada={portaId}
      className="absolute top-1/2 -left-1.5 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-background bg-primary"
    />
  );
}

function PortaSaida({ anchorRef }: { anchorRef: React.Ref<HTMLSpanElement> }) {
  return (
    <span
      ref={anchorRef}
      className="absolute top-1/2 -right-1.5 h-3 w-3 -translate-y-1/2 rounded-full border-2 border-background bg-primary"
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
  const [pos, setPos] = useState<Record<string, Pos>>(POS_PADRAO);
  const drag = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  // Conexão sendo arrastada de uma opção até uma caixa.
  const conn = useRef<{ optIndex: number } | null>(null);
  const [connLinha, setConnLinha] = useState<Linha | null>(null);

  const posDe = useCallback((id: string, fallback: Pos): Pos => pos[id] ?? fallback, [pos]);

  const iniciarDrag = useCallback(
    (id: string, fallback: Pos) => (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      const atual = pos[id] ?? fallback;
      drag.current = { id, startX: e.clientX, startY: e.clientY, origX: atual.x, origY: atual.y };
    },
    [pos],
  );

  // Converte uma coordenada de tela para dentro do canvas.
  const paraCanvas = useCallback((clientX: number, clientY: number): Point | null => {
    const wrap = wrapRef.current;
    if (!wrap) return null;
    const wr = wrap.getBoundingClientRect();
    return { x: clientX - wr.left + wrap.scrollLeft, y: clientY - wr.top + wrap.scrollTop };
  }, []);

  const centro = useCallback((el: HTMLElement | null): Point | null => {
    const wrap = wrapRef.current;
    if (!el || !wrap) return null;
    const wr = wrap.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 - wr.left + wrap.scrollLeft,
      y: r.top + r.height / 2 - wr.top + wrap.scrollTop,
    };
  }, []);

  // Começa a arrastar uma conexão a partir da porta de uma opção.
  const iniciarConexao = useCallback(
    (optIndex: number) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      conn.current = { optIndex };
      const from = centro(optOutRefs.current[optIndex]);
      const to = paraCanvas(e.clientX, e.clientY);
      if (from && to) setConnLinha({ from, to, optIndex });
    },
    [centro, paraCanvas],
  );

  useEffect(() => {
    const mover = (e: PointerEvent) => {
      if (conn.current) {
        const from = centro(optOutRefs.current[conn.current.optIndex]);
        const to = paraCanvas(e.clientX, e.clientY);
        if (from && to) setConnLinha({ from, to, optIndex: conn.current.optIndex });
        return;
      }
      const d = drag.current;
      if (!d) return;
      const nx = Math.max(0, d.origX + (e.clientX - d.startX));
      const ny = Math.max(0, d.origY + (e.clientY - d.startY));
      setPos((p) => ({ ...p, [d.id]: { x: nx, y: ny } }));
    };
    const soltar = (e: PointerEvent) => {
      if (conn.current) {
        const oi = conn.current.optIndex;
        conn.current = null;
        setConnLinha(null);
        const alvo = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest("[data-porta-entrada]") as HTMLElement | null;
        const destino = alvo?.getAttribute("data-porta-entrada") ?? undefined;
        setFluxo((f) => ({
          ...f,
          opcoes: f.opcoes.map((o, j) =>
            j === oi ? { ...o, destino: destino && destino !== `resp-${oi}` ? destino : undefined } : o,
          ),
        }));
        return;
      }
      drag.current = null;
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    return () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
  }, [centro, paraCanvas, setFluxo]);

  const medir = useCallback(() => {
    const novas: Linha[] = [];
    const push = (a: HTMLElement | null, b: HTMLElement | null, optIndex?: number) => {
      const pa = centro(a);
      const pb = centro(b);
      if (pa && pb) novas.push({ from: pa, to: pb, optIndex });
    };
    const extras = fluxo.mensagens ?? [];
    push(startRef.current, msgInRef.current);
    if (extras.length === 0) {
      push(msgOutRef.current, escInRef.current);
    } else {
      push(msgOutRef.current, extraInRefs.current[0]);
      for (let i = 0; i < extras.length - 1; i++) push(extraOutRefs.current[i], extraInRefs.current[i + 1]);
      push(extraOutRefs.current[extras.length - 1], escInRef.current);
    }
    // Cada opção liga à caixa de destino escolhida, ou à sua resposta padrão.
    fluxo.opcoes.forEach((op, i) => {
      let alvo: HTMLElement | null = respInRefs.current[i] ?? null;
      if (op.destino === "msg") alvo = msgInRef.current;
      else if (op.destino) {
        const m = op.destino.match(/^extra-(\d+)$/);
        if (m) alvo = extraInRefs.current[Number(m[1])] ?? alvo;
      }
      push(optOutRefs.current[i], alvo, i);
    });
    setLinhas(novas);
  }, [centro, fluxo.opcoes, fluxo.mensagens]);

  useLayoutEffect(() => {
    medir();
  }, [medir, fluxo, pos]);

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

  const extras = fluxo.mensagens ?? [];

  const pathDe = (l: { from: Point; to: Point }) =>
    `M ${l.from.x} ${l.from.y} C ${l.from.x + 50} ${l.from.y}, ${l.to.x - 50} ${l.to.y}, ${l.to.x} ${l.to.y}`;

  return (
    <div
      ref={wrapRef}
      className="relative h-[560px] w-full overflow-auto rounded-xl border border-border/60 bg-muted/20"
      style={{
        backgroundImage: "radial-gradient(circle, var(--border) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
    >
      <div className="relative h-[1200px] w-[1600px]">
        <svg className="absolute left-0 top-0 h-full w-full">
          {linhas.map((l, i) =>
            l.optIndex !== undefined ? (
              <path
                key={i}
                d={pathDe(l)}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={2.5}
                opacity={0.7}
                className="cursor-pointer"
                style={{ pointerEvents: "stroke" }}
                onClick={() =>
                  setFluxo((f) => ({
                    ...f,
                    opcoes: f.opcoes.map((o, j) => (j === l.optIndex ? { ...o, destino: undefined } : o)),
                  }))
                }
              >
                <title>Clique para remover a ligação</title>
              </path>
            ) : (
              <path
                key={i}
                d={pathDe(l)}
                fill="none"
                stroke="var(--primary)"
                strokeWidth={2}
                opacity={0.6}
                style={{ pointerEvents: "none" }}
              />
            ),
          )}
          {connLinha && (
            <path
              d={pathDe(connLinha)}
              fill="none"
              stroke="var(--primary)"
              strokeWidth={2.5}
              strokeDasharray="5 4"
              opacity={0.9}
              style={{ pointerEvents: "none" }}
            />
          )}
        </svg>

        {/* Início */}
        <No
          titulo="Iniciar"
          icon={<Hand className="h-3.5 w-3.5 text-primary" />}
          pos={posDe("start", POS_PADRAO.start)}
          onDrag={iniciarDrag("start", POS_PADRAO.start)}
        >
          <p className="text-xs text-muted-foreground">Cliente abre o chat</p>
          <PortaSaida anchorRef={startRef} />
        </No>

        {/* Enviar mensagem (saudação) */}
        <No
          titulo="Enviar mensagem"
          icon={<MessageSquareText className="h-3.5 w-3.5 text-primary" />}
          pos={posDe("msg", POS_PADRAO.msg)}
          onDrag={iniciarDrag("msg", POS_PADRAO.msg)}
        >
          <Input
            value={fluxo.saudacao}
            onChange={(e) => setFluxo((f) => ({ ...f, saudacao: e.target.value }))}
            placeholder="Olá! Selecione uma opção:"
            className="text-xs"
          />
          <PortaEntrada portaId="msg" anchorRef={msgInRef} />
          <PortaSaida anchorRef={msgOutRef} />
        </No>

        {/* Caixas extras de mensagem */}
        {extras.map((m, i) => {
          const fb = { x: 320, y: 260 + i * 200 };
          return (
            <No
              key={i}
              titulo="Enviar mensagem"
              icon={<MessageSquareText className="h-3.5 w-3.5 text-primary" />}
              pos={posDe(`extra-${i}`, fb)}
              onDrag={iniciarDrag(`extra-${i}`, fb)}
            >
              <div className="flex items-center gap-1">
                <Input
                  value={m}
                  onChange={(e) =>
                    setFluxo((f) => ({
                      ...f,
                      mensagens: (f.mensagens ?? []).map((x, j) => (j === i ? e.target.value : x)),
                    }))
                  }
                  placeholder="Digite a mensagem…"
                  className="text-xs"
                />
                <button
                  type="button"
                  onClick={() =>
                    setFluxo((f) => ({ ...f, mensagens: (f.mensagens ?? []).filter((_, j) => j !== i) }))
                  }
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              <PortaEntrada portaId={`extra-${i}`} anchorRef={(el) => { extraInRefs.current[i] = el; }} />
              <PortaSaida anchorRef={(el) => { extraOutRefs.current[i] = el; }} />
            </No>
          );
        })}

        {/* Pedir para escolher */}
        <No
          titulo="Pedir para escolher"
          icon={<ListChecks className="h-3.5 w-3.5 text-primary" />}
          pos={posDe("esc", POS_PADRAO.esc)}
          onDrag={iniciarDrag("esc", POS_PADRAO.esc)}
        >
          <div className="space-y-2">
            {fluxo.opcoes.map((op, i) => (
              <div key={i} className="relative space-y-1">
                <div className="flex items-center gap-1">
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
                    onPointerDown={iniciarConexao(i)}
                    title="Arraste até uma caixa para definir a resposta"
                    className="absolute -right-[26px] top-4 h-3.5 w-3.5 cursor-crosshair rounded-full border-2 border-background bg-primary hover:scale-125"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-1.5 pl-0.5 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={Boolean(op.ouvidoria)}
                    onChange={(e) =>
                      setFluxo((f) => ({
                        ...f,
                        opcoes: f.opcoes.map((o, j) => (j === i ? { ...o, ouvidoria: e.target.checked } : o)),
                      }))
                    }
                    className="h-3 w-3 accent-[var(--primary)]"
                  />
                  Ouvidoria (salva reclamação, não vai p/ atendente)
                </label>
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
          <PortaEntrada portaId="esc" anchorRef={escInRef} />
        </No>

        {/* Respostas automáticas (destino padrão de cada opção sem ligação) */}
        {fluxo.opcoes.map((op, i) => {
          const fb = { x: 920, y: 60 + i * 170 };
          const ligada = Boolean(op.destino);
          return (
            <No
              key={i}
              titulo="Enviar mensagem"
              icon={<MessageSquareText className="h-3.5 w-3.5 text-primary" />}
              pos={posDe(`resp-${i}`, fb)}
              onDrag={iniciarDrag(`resp-${i}`, fb)}
            >
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
                disabled={ligada}
              />
              {ligada && (
                <p className="mt-1 text-[10px] text-muted-foreground">Usando a caixa ligada</p>
              )}
              <PortaEntrada portaId={`resp-${i}`} anchorRef={(el) => { respInRefs.current[i] = el; }} />
            </No>
          );
        })}
      </div>

      {/* Botão adicionar caixa (fixo no canto) */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="sticky bottom-3 left-3 z-10 h-9 text-xs shadow-sm"
        onClick={() => setFluxo((f) => ({ ...f, mensagens: [...(f.mensagens ?? []), ""] }))}
      >
        <Plus className="mr-1 h-3.5 w-3.5" /> Adicionar caixa
      </Button>
    </div>
  );
}
