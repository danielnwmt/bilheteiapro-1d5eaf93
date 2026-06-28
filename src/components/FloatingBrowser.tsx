import { useEffect, useRef, useState } from "react";
import { ExternalLink, X, Minus, RotateCw, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  url: string;
  title: string;
  onClose: () => void;
};

/**
 * Janela flutuante interna (mini-browser) arrastável.
 * As casas de aposta bloqueiam exibição em iframe (X-Frame-Options/CSP);
 * quando o site não carrega, oferecemos abrir em nova aba.
 */
export function FloatingBrowser({ url, title, onClose }: Props) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [minimized, setMinimized] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  // Centraliza ao abrir.
  useEffect(() => {
    const w = 420;
    const x = Math.max(12, window.innerWidth - w - 24);
    setPos({ x, y: 80 });
  }, []);

  // Se o iframe não disparar onLoad em 3.5s, provavelmente foi bloqueado.
  useEffect(() => {
    setBlocked(false);
    setLoaded(false);
    const t = setTimeout(() => {
      setBlocked((b) => (loaded ? b : true));
    }, 3500);
    return () => clearTimeout(t);
  }, [url, reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragRef.current) return;
      setPos({ x: e.clientX - dragRef.current.dx, y: e.clientY - dragRef.current.dy });
    }
    function onUp() {
      dragRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  return (
    <div
      className="fixed z-[100] w-[420px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      style={{ left: pos.x, top: pos.y }}
    >
      {/* Barra de título arrastável */}
      <div
        className="flex cursor-grab items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 active:cursor-grabbing"
        onPointerDown={(e) => {
          dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
        }}
      >
        <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate text-sm font-semibold">{title}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
            title="Recarregar"
          >
            <RotateCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setMinimized((m) => !m)}
            className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
            title="Minimizar"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-destructive hover:text-destructive-foreground"
            title="Fechar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {!minimized && (
        <div className="relative h-[70vh] max-h-[600px] bg-background">
          <iframe
            key={reloadKey}
            src={url}
            title={title}
            className="h-full w-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            onLoad={() => {
              setLoaded(true);
              setBlocked(false);
            }}
          />

          {blocked && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-card/95 p-6 text-center">
              <p className="text-sm font-semibold">Esta casa não permite abrir aqui dentro</p>
              <p className="max-w-xs text-xs text-muted-foreground">
                Por segurança, {title} bloqueia ser exibida dentro de outro site. Abra em uma nova
                aba para continuar.
              </p>
              <Button asChild size="sm">
                <a href={url} target="_blank" rel="noopener noreferrer">
                  Abrir em nova aba <ExternalLink className="ml-2 h-3.5 w-3.5" />
                </a>
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
