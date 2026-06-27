import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSystemConfig, setSystemConfig } from "@/lib/access.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, Plus, Clock } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/apis")({
  head: () => ({ meta: [{ title: "APIs do sistema — Admin BilheteIA" }] }),
  component: ApisPage,
});

// Chaves de API conhecidas do sistema (apenas referência de rótulo).
const CHAVES_PADRAO = [
  { chave: "GEMINI_API_KEY", descricao: "Chave da IA (Google Gemini) usada na geração de bilhetes" },
  { chave: "API_FOOTBALL_KEY", descricao: "Chave da API-Football (jogos e odds)" },
  { chave: "ODDS_API_KEY", descricao: "Chave da The Odds API" },
];

// API de pagamento (banco) — mantida separada das demais.
const CHAVES_PAGAMENTO = [
  {
    chave: "INFINITEPAY_HANDLE",
    descricao: "Sua InfiniteTag da InfinitePay (handle, sem o $). Ex: minhaloja",
  },
];

type ConfigRow = { chave: string; valor: string | null; descricao: string | null };

function ApisPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const fetchConfig = useServerFn(getSystemConfig);
  const salvar = useServerFn(setSystemConfig);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [novaChave, setNovaChave] = useState("");

  const { data: config, isLoading, error } = useQuery({
    queryKey: ["system-config"],
    queryFn: () => fetchConfig(),
    retry: false,
  });

  const configRows = (Array.isArray(config) ? config : []) as ConfigRow[];

  useEffect(() => {
    if (Array.isArray(config)) {
      const m: Record<string, string> = {};
      for (const c of config as ConfigRow[]) m[c.chave] = c.valor ?? "";
      setVals((v) => ({ ...m, ...v }));
    }
  }, [config]);

  const mut = useMutation({
    mutationFn: (v: { chave: string; valor: string; descricao?: string }) => salvar({ data: v }),
    onSuccess: () => {
      toast.success("Configuração salva");
      qc.invalidateQueries({ queryKey: ["system-config"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar"),
  });

  const existentes = new Map(configRows.map((c) => [c.chave, c.descricao]));
  const chavesPagamento = new Set(CHAVES_PAGAMENTO.map((c) => c.chave));
  const todasChaves = Array.from(
    new Set([
      ...CHAVES_PADRAO.map((c) => c.chave),
      ...configRows.map((c) => c.chave),
    ]),
  ).filter((c) => !chavesPagamento.has(c));

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="max-w-md border-border/60 bg-card p-8 text-center">
          <p className="font-semibold">Acesso restrito</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Apenas administradores podem editar as APIs do sistema.
          </p>
          <Button className="mt-6" onClick={() => router.navigate({ to: "/" })}>Voltar</Button>
        </Card>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 py-10">
        <Button variant="ghost" size="sm" className="mb-6" onClick={() => router.navigate({ to: "/admin" })}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Painel
        </Button>

        <h1 className="mb-2 text-2xl font-bold">APIs do sistema</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Edite as chaves de integração usadas pelo sistema.
        </p>

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            {todasChaves.map((chave) => {
              const descricao =
                existentes.get(chave) ??
                CHAVES_PADRAO.find((c) => c.chave === chave)?.descricao ??
                "";
              const chaveValor = `${chave}_INTERVALO_VALOR`;
              const chaveUnidade = `${chave}_INTERVALO_UNIDADE`;
              return (
                <Card key={chave} className="border-border/60 bg-card p-4">
                  <Label className="text-sm font-semibold">{chave}</Label>
                  {descricao && <p className="mb-2 text-xs text-muted-foreground">{descricao}</p>}
                  <div className="flex gap-2">
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={vals[chave] ?? ""}
                      onChange={(e) => setVals((v) => ({ ...v, [chave]: e.target.value }))}
                      className="bg-input/40"
                    />
                    <Button
                      disabled={mut.isPending}
                      onClick={() => mut.mutate({ chave, valor: vals[chave] ?? "", descricao })}
                    >
                      Salvar
                    </Button>
                  </div>

                  <div className="mt-3 flex items-center gap-2 border-t border-border/40 pt-3">
                    <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <Label className="shrink-0 text-xs text-muted-foreground">
                      Intervalo de chamada
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      placeholder="ex: 60"
                      value={vals[chaveValor] ?? ""}
                      onChange={(e) =>
                        setVals((v) => ({ ...v, [chaveValor]: e.target.value }))
                      }
                      className="bg-input/40"
                    />
                    <Select
                      value={vals[chaveUnidade] ?? "minutos"}
                      onValueChange={(u) =>
                        setVals((v) => ({ ...v, [chaveUnidade]: u }))
                      }
                    >
                      <SelectTrigger className="w-32 bg-input/40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="segundos">Segundos</SelectItem>
                        <SelectItem value="minutos">Minutos</SelectItem>
                        <SelectItem value="horas">Horas</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      disabled={mut.isPending}
                      onClick={() => {
                        mut.mutate({
                          chave: chaveValor,
                          valor: vals[chaveValor] ?? "",
                          descricao: `Intervalo entre chamadas da ${chave}`,
                        });
                        mut.mutate({
                          chave: chaveUnidade,
                          valor: vals[chaveUnidade] ?? "minutos",
                          descricao: `Unidade do intervalo da ${chave}`,
                        });
                      }}
                    >
                      Salvar
                    </Button>
                  </div>
                </Card>
              );
            })}



            <Card className="border-dashed border-border/60 bg-card p-4">
              <Label className="mb-2 block text-sm font-semibold">Nova chave</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="NOME_DA_CHAVE"
                  value={novaChave}
                  onChange={(e) => setNovaChave(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))}
                  className="bg-input/40"
                />
                <Button
                  variant="outline"
                  disabled={!novaChave}
                  onClick={() => {
                    setVals((v) => ({ ...v, [novaChave]: "" }));
                    setNovaChave("");
                  }}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </Card>

            {/* API de pagamento (banco) — seção separada das demais */}
            <div className="pt-6">
              <h2 className="mb-1 text-lg font-bold">API de pagamento (banco)</h2>
              <p className="mb-4 text-sm text-muted-foreground">
                Credenciais de recebimento. Mantidas separadas das demais integrações.
              </p>
              <div className="space-y-4">
                {CHAVES_PAGAMENTO.map(({ chave, descricao: desc }) => {
                  const descricao = existentes.get(chave) ?? desc ?? "";
                  return (
                    <Card key={chave} className="border-primary/30 bg-card p-4">
                      <Label className="text-sm font-semibold">{chave}</Label>
                      {descricao && <p className="mb-2 text-xs text-muted-foreground">{descricao}</p>}
                      <div className="flex gap-2">
                        <Input
                          type="text"
                          placeholder="sua-infinitetag"
                          value={vals[chave] ?? ""}
                          onChange={(e) => setVals((v) => ({ ...v, [chave]: e.target.value }))}
                          className="bg-input/40"
                        />
                        <Button
                          disabled={mut.isPending}
                          onClick={() => mut.mutate({ chave, valor: vals[chave] ?? "", descricao })}
                        >
                          Salvar
                        </Button>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
