import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getSystemConfig, setSystemConfig, testApiKey, getApiUsage, chamarApiManual } from "@/lib/access.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2, Plus, Plug, ArrowDown, Workflow, PlayCircle, Activity } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FLUXO_ETAPAS, API_LABEL, FLUXO_PADRAO, parseFlow } from "@/lib/api-flow";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/apis")({
  head: () => ({ meta: [{ title: "APIs do sistema — Admin BilheteIA" }] }),
  component: ApisPage,
});

// Chaves de API conhecidas do sistema (apenas referência de rótulo).
const CHAVES_PADRAO = [
  { chave: "GEMINI_API_KEY", descricao: "Chave da IA (Google Gemini) usada na geração de bilhetes" },
  { chave: "API_FOOTBALL_KEY", descricao: "Chave da API-Football (jogos e odds)" },
];


// API de pagamento (banco) — mantida separada das demais.
const CHAVES_PAGAMENTO = [
  {
    chave: "ASAAS_API_KEY",
    descricao: "Chave de API da sua conta Asaas (Configurações → Integrações → API).",
  },
];

// Provedores (bancos) disponíveis para processar cada forma de pagamento.
const PROVEDORES_PAGAMENTO = [
  { value: "asaas", label: "Asaas" },
];


type ConfigRow = { chave: string; valor: string | null; descricao: string | null };
const ADMIN_EMAIL = "contato@protenexus.com";

function ApisPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const fetchConfig = useServerFn(getSystemConfig);
  const salvar = useServerFn(setSystemConfig);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [novaChave, setNovaChave] = useState("");
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [flow, setFlow] = useState<Record<string, string>>({ ...FLUXO_PADRAO });

  const { data: config, isLoading, error } = useQuery({
    queryKey: ["system-config"],
    queryFn: () => fetchConfig(),
    retry: false,
  });

  const configRows = (Array.isArray(config) ? config : []) as ConfigRow[];

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => setCurrentEmail((data.session?.user.email ?? "").trim().toLowerCase()))
      .catch(() => setCurrentEmail(""));
  }, []);

  useEffect(() => {
    if (Array.isArray(config)) {
      const m: Record<string, string> = {};
      for (const c of config as ConfigRow[]) m[c.chave] = c.valor ?? "";
      setVals((v) => ({ ...m, ...v }));
      const raw = (config as ConfigRow[]).find((c) => c.chave === "API_FLUXO")?.valor;
      setFlow(parseFlow(raw ?? null));
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

  const testar = useServerFn(testApiKey);
  const [testando, setTestando] = useState<string | null>(null);

  // Contagem de chamadas feitas hoje por cada API.
  const fetchUsage = useServerFn(getApiUsage);
  const { data: usage } = useQuery({
    queryKey: ["api-usage"],
    queryFn: () => fetchUsage(),
    retry: false,
    refetchInterval: 30_000,
  });
  const usageMap = (usage ?? {}) as Record<string, { total: number; ultima: string | null }>;

  // Chaves que suportam chamada manual imediata.
  const CHAMAVEIS = new Set(["API_FOOTBALL_KEY", "ODDS_API_KEY", "GEMINI_API_KEY"]);
  const chamarManual = useServerFn(chamarApiManual);
  const [chamando, setChamando] = useState<string | null>(null);

  async function chamarAgora(chave: string) {
    setChamando(chave);
    const tid = toast.loading(`Chamando ${chave}…`);
    try {
      const r = (await chamarManual({ data: { chave } })) as { ok: boolean; info?: string; error?: string };
      if (r.ok) {
        toast.success(r.info ?? "Chamada concluída", { id: tid });
      } else {
        toast.error(r.error ?? "Falha na chamada", { id: tid });
      }
      qc.invalidateQueries({ queryKey: ["api-usage"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao chamar a API", { id: tid });
    } finally {
      setChamando(null);
    }
  }


  async function ativarETestar(chave: string) {
    const valor = vals[chave] ?? "";
    setTestando(chave);
    const tid = toast.loading(`Ativando ${chave}…`);
    try {
      // Salva o valor atual antes de testar (se foi digitado algo).
      if (valor) {
        await salvar({ data: { chave, valor, descricao: existentes.get(chave) ?? "" } });
        qc.invalidateQueries({ queryKey: ["system-config"] });
      }
      const r = (await testar({ data: { chave, valor } })) as { ok: boolean; info?: string; error?: string };
      if (r.ok) {
        toast.success(r.info ?? "API ativada com sucesso", { id: tid });
      } else {
        toast.error(r.error ?? "Falha ao conectar na API", { id: tid });
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao testar a API", { id: tid });
    } finally {
      setTestando(null);
    }
  }


  // Token de validação do webhook: usa o salvo ou gera um automaticamente.
  const webhookToken =
    configRows.find((c) => c.chave === "ASAAS_WEBHOOK_TOKEN")?.valor ?? "";
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const webhookUrl = `${origin}/api/public/webhooks/asaas${
    webhookToken ? `?token=${webhookToken}` : ""
  }`;

  useEffect(() => {
    if (!Array.isArray(config)) return;
    const existing = config.find((c: ConfigRow) => c.chave === "ASAAS_WEBHOOK_TOKEN")?.valor;
    if (!existing) {
      const token =
        (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`).replace(/-/g, "") +
        Math.random().toString(16).slice(2, 10);
      salvar({
        data: {
          chave: "ASAAS_WEBHOOK_TOKEN",
          valor: token,
          descricao: "Token de validação do webhook de pagamento (query ?token=).",
        },
      })
        .then(() => qc.invalidateQueries({ queryKey: ["system-config"] }))
        .catch(() => {});
    }
  }, [config, salvar, qc]);

  const existentes = new Map(configRows.map((c) => [c.chave, c.descricao]));

  const chavesPagamento = new Set(CHAVES_PAGAMENTO.map((c) => c.chave));
  const todasChaves = Array.from(
    new Set([
      ...CHAVES_PADRAO.map((c) => c.chave),
      ...configRows.map((c) => c.chave),
    ]),
  ).filter(
    (c) =>
      !chavesPagamento.has(c) &&
      // chaves internas/derivadas não devem aparecer como cards próprios
      !c.endsWith("_INTERVALO_VALOR") &&
      !c.endsWith("_INTERVALO_UNIDADE") &&
      c !== "ASAAS_WEBHOOK_TOKEN" &&
      c !== "API_FLUXO" &&
      c !== "PIX_PROVEDOR" &&
      c !== "CARTAO_PROVEDOR",
  );


  if (error && currentEmail !== ADMIN_EMAIL) {
    if (currentEmail === null) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-background px-4">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </main>
      );
    }
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
            {/* Fluxo das APIs — editável; muda a execução real */}
            <Card className="border-primary/40 bg-card p-4">
              <div className="mb-1 flex items-center gap-2">
                <Workflow className="h-4 w-4 text-primary" />
                <Label className="text-sm font-semibold">Fluxo das APIs</Label>
              </div>
              <p className="mb-4 text-xs text-muted-foreground">
                Defina qual API faz cada etapa. Ao salvar, o sistema passa a usar
                a API escolhida em cada passo.
              </p>
              <div className="space-y-2">
                {FLUXO_ETAPAS.map((etapa, i) => (
                  <div key={etapa.id}>
                    <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-input/20 p-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{etapa.label}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {etapa.descricao}
                        </p>
                      </div>
                      <Select
                        value={flow[etapa.id] ?? etapa.apis[0]}
                        onValueChange={(v) =>
                          setFlow((f) => ({ ...f, [etapa.id]: v }))
                        }
                      >
                        <SelectTrigger className="w-40 shrink-0 bg-input/40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {etapa.apis.map((api) => (
                            <SelectItem key={api} value={api}>
                              {API_LABEL[api] ?? api}
                            </SelectItem>
                          ))}
                          {etapa.opcional && (
                            <SelectItem value="off">Desligado</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    {i < FLUXO_ETAPAS.length - 1 && (
                      <div className="flex justify-center py-0.5">
                        <ArrowDown className="h-3.5 w-3.5 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <Button
                className="mt-4 w-full"
                disabled={mut.isPending}
                onClick={() =>
                  mut.mutate({
                    chave: "API_FLUXO",
                    valor: JSON.stringify(flow),
                    descricao: "Fluxo: qual API faz cada etapa do sistema.",
                  })
                }
              >
                Salvar fluxo
              </Button>
            </Card>

            {todasChaves.map((chave) => {
              const descricao =
                existentes.get(chave) ??
                CHAVES_PADRAO.find((c) => c.chave === chave)?.descricao ??
                "";
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
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={testando === chave}
                      onClick={() => ativarETestar(chave)}
                    >
                      {testando === chave ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Plug className="mr-2 h-4 w-4" />
                      )}
                      Ativar e testar
                    </Button>
                    {CHAMAVEIS.has(chave) && (
                      <Button
                        variant="default"
                        size="sm"
                        disabled={chamando === chave}
                        onClick={() => chamarAgora(chave)}
                      >
                        {chamando === chave ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <PlayCircle className="mr-2 h-4 w-4" />
                        )}
                        Chamar agora
                      </Button>
                    )}
                    <span className="ml-auto flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      <Activity className="h-3.5 w-3.5" />
                      {usageMap[chave]?.total ?? 0} chamadas hoje
                    </span>
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
              {/* Seletor de banco por forma de pagamento */}
              <Card className="mb-4 border-primary/30 bg-card p-4">
                <Label className="text-sm font-semibold">Banco por forma de pagamento</Label>
                <p className="mb-3 text-xs text-muted-foreground">
                  Escolha qual banco processa o Pix e qual processa o Crédito/Débito.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label className="mb-1 block text-xs text-muted-foreground">Pix</Label>
                    <Select
                      value={
                        configRows.find((c) => c.chave === "PIX_PROVEDOR")?.valor ??
                        PROVEDORES_PAGAMENTO[0].value
                      }
                      onValueChange={(v) =>
                        mut.mutate({
                          chave: "PIX_PROVEDOR",
                          valor: v,
                          descricao: "Banco que processa pagamentos via Pix.",
                        })
                      }
                    >
                      <SelectTrigger className="bg-input/40">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {PROVEDORES_PAGAMENTO.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="mb-1 block text-xs text-muted-foreground">
                      Crédito / Débito
                    </Label>
                    <Select
                      value={
                        configRows.find((c) => c.chave === "CARTAO_PROVEDOR")?.valor ??
                        PROVEDORES_PAGAMENTO[0].value
                      }
                      onValueChange={(v) =>
                        mut.mutate({
                          chave: "CARTAO_PROVEDOR",
                          valor: v,
                          descricao: "Banco que processa pagamentos via Crédito/Débito.",
                        })
                      }
                    >
                      <SelectTrigger className="bg-input/40">
                        <SelectValue placeholder="Selecione" />
                      </SelectTrigger>
                      <SelectContent>
                        {PROVEDORES_PAGAMENTO.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </Card>

              {/* Ambiente do Asaas: Sandbox (teste) ou Produção */}
              <Card className="border-primary/30 bg-card p-4">
                <Label className="text-sm font-semibold">Ambiente do Asaas</Label>
                <p className="mb-2 text-xs text-muted-foreground">
                  Use <b>Sandbox</b> para testar com chaves de homologação. Em
                  produção use a chave real e selecione <b>Produção</b>.
                </p>
                <Select
                  value={
                    (configRows.find((c) => c.chave === "ASAAS_ENV")?.valor ?? "producao")
                  }
                  onValueChange={(v) =>
                    mut.mutate({
                      chave: "ASAAS_ENV",
                      valor: v,
                      descricao: "Ambiente do Asaas: sandbox (teste) ou producao.",
                    })
                  }
                >
                  <SelectTrigger className="bg-input/40">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sandbox">Sandbox (teste)</SelectItem>
                    <SelectItem value="producao">Produção</SelectItem>
                  </SelectContent>
                </Select>
              </Card>

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
                      <Button
                        variant="secondary"
                        size="sm"
                        className="mt-2"
                        disabled={testando === chave}
                        onClick={() => ativarETestar(chave)}
                      >
                        {testando === chave ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Plug className="mr-2 h-4 w-4" />
                        )}
                        Ativar e testar
                      </Button>

                    </Card>
                  );
                })}
              </div>

              {/* URL do webhook para colar no painel do Asaas */}
              <Card className="mt-4 border-primary/30 bg-card p-4">
                <Label className="text-sm font-semibold">URL do Webhook</Label>
                <p className="mb-2 text-xs text-muted-foreground">
                  Configure esta URL no painel do provedor para receber confirmações de pagamento.
                </p>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    readOnly
                    value={webhookUrl}
                    className="bg-input/40 font-mono text-xs"
                  />
                  <Button
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard?.writeText(webhookUrl);
                      toast.success("URL copiada");
                    }}
                  >
                    Copiar
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Token de validação: <span className="font-mono">{webhookToken || "—"}</span>
                </p>
              </Card>
            </div>

          </div>
        )}
      </div>
    </main>
  );
}
