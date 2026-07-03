import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Hand, MessageSquareText, ListChecks, Plus, Trash2, GripVertical } from "lucide-react";

export type Fluxo = { saudacao: string; opcoes: { label: string; resposta: string }[]; mensagens?: string[] };

type Point = { x: number; y: number };
type Linha = { from: Point; to: Point };
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
  const [pos, setPos] = useState<Record<string, Pos>>(POS_PADRAO);
  const drag = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Garante posição padrão para nós dinâmicos (extras e respostas).
  const posDe = useCallback(
    (id: string, fallback: Pos): Pos => pos[id] ?? fallback,
    [pos],
  );

  const iniciarDrag = useCallback(
    (id: string, fallback: Pos) => (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      const atual = pos[id] ?? fallback;
      drag.current = { id, startX: e.clientX, startY: e.clientY, origX: atual.x, origY: atual.y };
    },
    [pos],
  );

  useEffect(() => {
    const mover = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const nx = Math.max(0, d.origX + (e.clientX - d.startX));
      const ny = Math.max(0, d.origY + (e.clientY - d.startY));
      setPos((p) => ({ ...p, [d.id]: { x: nx, y: ny } }));
    };
    const soltar = () => {
      drag.current = null;
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    return () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
  }, []);

  const medir = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wr = wrap.getBoundingClientRect();
    const ponto = (el: HTMLElement | null): Point | null => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2 - wr.left + wrap.scrollLeft, y: r.top + r.height / 2 - wr.top + wrap.scrollTop };
    };
    const novas: Linha[] = [];
    const push = (a: HTMLElement | null, b: HTMLElement | null) => {
      const pa = ponto(a);
      const pb = ponto(b);
      if (pa && pb) novas.push({ from: pa, to: pb });
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
    fluxo.opcoes.forEach((_, i) => push(optOutRefs.current[i], respInRefs.current[i]));
    setLinhas(novas);
  }, [fluxo.opcoes, fluxo.mensagens]);

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

  return (
    <div
      ref={wrapRef}
      className="relative h-[560px] w-full overflow-auto rounded-xl border border-border/60 bg-muted/20"
      style={{
        backgroundImage:
          "radial-gradient(circle, var(--border) 1px, transparent 1px)",
        backgroundSize: "22px 22px",
      }}
    >
      <div className="relative h-[1200px] w-[1600px]">
        <svg className="pointer-events-none absolute left-0 top-0 h-full w-full">
          {linhas.map((l, i) => (
            <path
              key={i}
              d={`M ${l.from.x} ${l.from.y} C ${l.from.x + 50} ${l.from.y}, ${l.to.x - 50} ${l.to.y}, ${l.to.x} ${l.to.y}`}
              fill="none"
              stroke="var(--primary)"
              strokeWidth={2}
              opacity={0.6}
            />
          ))}
        </svg>

        {/* Início */}
        <No
          titulo="Iniciar"
          icon={<Hand className="h-3.5 w-3.5 text-primary" />}
          pos={posDe("start", POS_PADRAO.start)}
          onDrag={iniciarDrag("start", POS_PADRAO.start)}
        >
          <p className="text-xs text-muted-foreground">Cliente abre o chat</p>
          <Porta side="right" anchorRef={startRef} />
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
          <Porta side="left" anchorRef={msgInRef} />
          <Porta side="right" anchorRef={msgOutRef} />
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
              <Porta side="left" anchorRef={(el) => { extraInRefs.current[i] = el; }} />
              <Porta side="right" anchorRef={(el) => { extraOutRefs.current[i] = el; }} />
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

        {/* Respostas automáticas */}
        {fluxo.opcoes.map((op, i) => {
          const fb = { x: 920, y: 60 + i * 170 };
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
              />
              <Porta side="left" anchorRef={(el) => { respInRefs.current[i] = el; }} />
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
