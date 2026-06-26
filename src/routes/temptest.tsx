import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TODAS_LIGAS, RECURSO_LABELS, recursosVazios } from "@/lib/planos";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/temptest")({
  component: TempTest,
});

function TempTest() {
  const [open, setOpen] = useState(false);
  const [novo, setNovo] = useState(() => ({
    plano: "",
    nome: "",
    preco: "",
    descricao: "",
    historicoDias: 15,
    ligas: [] as string[],
    recursos: recursosVazios() as Record<string, boolean>,
  }));

  function toggleNovoLiga(liga: string) {
    setNovo((s) => ({
      ...s,
      ligas: s.ligas.includes(liga) ? s.ligas.filter((l) => l !== liga) : [...s.ligas, liga],
    }));
  }
  function toggleNovoRecurso(key: string) {
    setNovo((s) => ({ ...s, recursos: { ...s.recursos, [key]: !s.recursos[key] } }));
  }

  return (
    <main className="min-h-screen bg-background p-10">
      <Button onClick={() => setOpen(true)}>Adicionar plano</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Novo plano</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <Input value={novo.nome} onChange={(e) => setNovo((s) => ({ ...s, nome: e.target.value }))} />
            <div>
              <Label>Ligas</Label>
              <div className="flex flex-wrap gap-2">
                {TODAS_LIGAS.map((liga) => (
                  <button key={liga} type="button" onClick={() => toggleNovoLiga(liga)}>
                    {liga}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Recursos</Label>
              <div className="flex flex-wrap gap-2">
                {RECURSO_LABELS.map((r) => (
                  <button key={r.key} type="button" onClick={() => toggleNovoRecurso(r.key)}>
                    {r.label} {String(!!novo.recursos[r.key])}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
