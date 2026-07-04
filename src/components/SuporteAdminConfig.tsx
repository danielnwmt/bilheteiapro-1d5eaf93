import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Zap, Clock, Save, Loader2, LifeBuoy } from "lucide-react";
import { toast } from "sonner";
import {
  listRespostasRapidas,
  salvarRespostaRapida,
  removerRespostaRapida,
  listSuporteFAQ,
  salvarSuporteFAQ,
  removerSuporteFAQ,
  getSuporteConfig,
  setSuporteConfig,
  type RespostaRapida,
  type SuporteFAQ,
  type SuporteConfig,
} from "@/lib/suporte-conversas.functions";

const DIAS: { k: string; l: string }[] = [
  { k: "seg", l: "Segunda" },
  { k: "ter", l: "Terça" },
  { k: "qua", l: "Quarta" },
  { k: "qui", l: "Quinta" },
  { k: "sex", l: "Sexta" },
  { k: "sab", l: "Sábado" },
  { k: "dom", l: "Domingo" },
];

export function SuporteAdminConfig() {
  const listar = useServerFn(listRespostasRapidas);
  const salvar = useServerFn(salvarRespostaRapida);
  const remover = useServerFn(removerRespostaRapida);
  const lerConfig = useServerFn(getSuporteConfig);
  const gravarConfig = useServerFn(setSuporteConfig);
  const listarFAQ = useServerFn(listSuporteFAQ);
  const salvarFAQ = useServerFn(salvarSuporteFAQ);
  const removerFAQ = useServerFn(removerSuporteFAQ);

  const [respostas, setRespostas] = useState<RespostaRapida[]>([]);
  const [faqs, setFaqs] = useState<SuporteFAQ[]>([]);
  const [novoAtalho, setNovoAtalho] = useState("");
  const [novoTexto, setNovoTexto] = useState("");
  const [faqPergunta, setFaqPergunta] = useState("");
  const [faqResposta, setFaqResposta] = useState("");
  const [faqCategoria, setFaqCategoria] = useState("");
  const [faqTags, setFaqTags] = useState("");
  const [config, setConfig] = useState<SuporteConfig>({ dias: {}, mensagemOffline: "" });
  const [salvandoConfig, setSalvandoConfig] = useState(false);

  useEffect(() => {
    listar().then(setRespostas).catch(() => {});
    listarFAQ().then(setFaqs).catch(() => {});
    lerConfig().then(setConfig).catch(() => {});
  }, [listar, listarFAQ, lerConfig]);

  async function addResposta() {
    if (!novoAtalho.trim() || !novoTexto.trim()) return;
    try {
      await salvar({ data: { atalho: novoAtalho, texto: novoTexto } });
      setNovoAtalho("");
      setNovoTexto("");
      setRespostas(await listar());
      toast.success("Resposta salva");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    }
  }

  async function delResposta(id: string) {
    await remover({ data: { id } });
    setRespostas((r) => r.filter((x) => x.id !== id));
  }

  async function addFAQ() {
    if (!faqPergunta.trim() || !faqResposta.trim()) return;
    try {
      await salvarFAQ({
        data: {
          pergunta: faqPergunta,
          resposta: faqResposta,
          categoria: faqCategoria,
          tags: faqTags.split(",").map((t) => t.trim()).filter(Boolean),
          ativo: true,
          ordem: faqs.length + 1,
        },
      });
      setFaqPergunta("");
      setFaqResposta("");
      setFaqCategoria("");
      setFaqTags("");
      setFaqs(await listarFAQ());
      toast.success("FAQ salvo");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar FAQ");
    }
  }

  async function delFAQ(id: string) {
    await removerFAQ({ data: { id } });
    setFaqs((r) => r.filter((x) => x.id !== id));
  }

  function setDia(k: string, patch: Partial<{ ativo: boolean; inicio: string; fim: string }>) {
    setConfig((c) => {
      const atual = c.dias[k] ?? { ativo: false, inicio: "09:00", fim: "18:00" };
      return { ...c, dias: { ...c.dias, [k]: { ...atual, ...patch } } };
    });
  }

  async function salvarConfig() {
    setSalvandoConfig(true);
    try {
      await gravarConfig({ data: config });
      toast.success("Horário salvo");
    } catch (e: any) {
      toast.error(e?.message ?? "Erro ao salvar");
    }
    setSalvandoConfig(false);
  }

  return (
    <>
      {/* Respostas rápidas */}
      <div className="mt-6 border-t border-border/60 pt-5">
        <div className="mb-1 flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Respostas rápidas</h3>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          O atendente digita <span className="font-mono text-primary">/atalho</span> no chat para inserir o texto.
        </p>

        <div className="space-y-2">
          {respostas.map((r) => (
            <div key={r.id} className="flex items-center gap-2 rounded-lg border border-border/60 px-3 py-2">
              <span className="shrink-0 font-mono text-xs font-semibold text-primary">/{r.atalho}</span>
              <span className="flex-1 truncate text-sm">{r.texto}</span>
              <button onClick={() => delResposta(r.id)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input
            value={novoAtalho}
            onChange={(e) => setNovoAtalho(e.target.value)}
            placeholder="atalho (ex: pix)"
            className="sm:max-w-[160px]"
          />
          <Input
            value={novoTexto}
            onChange={(e) => setNovoTexto(e.target.value)}
            placeholder="Texto da resposta"
            className="flex-1"
          />
          <Button size="sm" onClick={addResposta}>
            <Plus className="mr-1 h-4 w-4" /> Adicionar
          </Button>
        </div>
      </div>

      {/* FAQ determinístico */}
      <div className="mt-6 border-t border-border/60 pt-5">
        <div className="mb-1 flex items-center gap-2">
          <LifeBuoy className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">FAQ do chatbot sem IA</h3>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          O chatbot só responde com textos cadastrados aqui. Se não encontrar resposta, encaminha para um atendente.
        </p>

        <div className="space-y-2">
          {faqs.map((f) => (
            <div key={f.id} className="rounded-lg border border-border/60 px-3 py-2">
              <div className="flex items-center gap-2">
                <span className="flex-1 truncate text-sm font-semibold">{f.pergunta}</span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                  {f.categoria || "geral"}
                </span>
                <button onClick={() => delFAQ(f.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{f.resposta}</p>
            </div>
          ))}
        </div>

        <div className="mt-3 grid gap-2">
          <Input value={faqPergunta} onChange={(e) => setFaqPergunta(e.target.value)} placeholder="Pergunta ou dúvida do cliente" />
          <Input value={faqResposta} onChange={(e) => setFaqResposta(e.target.value)} placeholder="Resposta fixa do bot" />
          <div className="grid gap-2 sm:grid-cols-2">
            <Input value={faqCategoria} onChange={(e) => setFaqCategoria(e.target.value)} placeholder="Categoria (ex: pagamento)" />
            <Input value={faqTags} onChange={(e) => setFaqTags(e.target.value)} placeholder="Tags separadas por vírgula" />
          </div>
          <Button size="sm" onClick={addFAQ} className="w-fit">
            <Plus className="mr-1 h-4 w-4" /> Adicionar FAQ
          </Button>
        </div>
      </div>

      {/* Horário de atendimento */}
      <div className="mt-6 border-t border-border/60 pt-5">
        <div className="mb-1 flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Horário de atendimento</h3>
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          Fora do expediente, o cliente vê a mensagem automática abaixo.
        </p>

        <div className="space-y-2">
          {DIAS.map((d) => {
            const cfg = config.dias[d.k] ?? { ativo: false, inicio: "09:00", fim: "18:00" };
            return (
              <div key={d.k} className="flex items-center gap-3">
                <label className="flex w-28 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={cfg.ativo}
                    onChange={(e) => setDia(d.k, { ativo: e.target.checked })}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                  {d.l}
                </label>
                <Input
                  type="time"
                  value={cfg.inicio}
                  onChange={(e) => setDia(d.k, { inicio: e.target.value })}
                  disabled={!cfg.ativo}
                  className="h-8 w-28"
                />
                <span className="text-muted-foreground">às</span>
                <Input
                  type="time"
                  value={cfg.fim}
                  onChange={(e) => setDia(d.k, { fim: e.target.value })}
                  disabled={!cfg.ativo}
                  className="h-8 w-28"
                />
              </div>
            );
          })}
        </div>

        <div className="mt-4">
          <Label className="mb-1 block text-sm">Mensagem fora do expediente</Label>
          <Input
            value={config.mensagemOffline}
            onChange={(e) => setConfig((c) => ({ ...c, mensagemOffline: e.target.value }))}
            placeholder="Nosso suporte está offline. Responderemos assim que possível."
          />
        </div>

        <Button size="sm" className="mt-4" disabled={salvandoConfig} onClick={salvarConfig}>
          {salvandoConfig ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Salvar horário
        </Button>
      </div>
    </>
  );
}
