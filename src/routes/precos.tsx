import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import logo from "@/assets/bilheteia-logo.png";
import { Check, Crown, ArrowRight } from "lucide-react";

const SITE = "https://bilheteiapro.lovable.app";

export const Route = createFileRoute("/precos")({
  head: () => ({
    meta: [
      { title: "Planos e Preços — BilheteIA PRO" },
      {
        name: "description",
        content:
          "Conheça os planos do BilheteIA PRO: Start, Pro e Elite. Bilhetes inteligentes, estatísticas avançadas e gestão de banca a partir de R$29,90/mês.",
      },
      { property: "og:title", content: "Planos e Preços — BilheteIA PRO" },
      {
        property: "og:description",
        content: "Start, Pro e Elite: escolha o plano ideal para suas análises esportivas.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE}/precos` },
    ],
    links: [{ rel: "canonical", href: `${SITE}/precos` }],
  }),
  component: PrecosPage,
});

type PlanoView = {
  nome: string;
  preco: string;
  destaque?: boolean;
  descricao: string;
  recursos: string[];
};

const PLANOS: PlanoView[] = [
  {
    nome: "BilheteIA Start",
    preco: "R$ 29,90",
    descricao:
      "Os principais campeonatos brasileiros com análises estatísticas e bilhetes inteligentes.",
    recursos: [
      "Bilhetes inteligentes",
      "Principais campeonatos nacionais",
      "Melhores Picks do Dia",
      "Dashboard e histórico",
    ],
  },
  {
    nome: "BilheteIA Pro",
    preco: "R$ 49,90",
    destaque: true,
    descricao:
      "Acesso às principais ligas do mundo, Melhores Picks e recursos completos de gestão.",
    recursos: [
      "Tudo do Start",
      "Mais campeonatos (internacionais)",
      "Estatísticas avançadas",
      "Gestão de banca",
      "Favoritos",
    ],
  },
  {
    nome: "BilheteIA Elite",
    preco: "R$ 79,90",
    descricao:
      "Todos os campeonatos disponíveis, recursos exclusivos e suporte prioritário.",
    recursos: [
      "Tudo do Pro",
      "Todos os campeonatos",
      "Atualização em tempo real (ao vivo)",
      "Alertas inteligentes",
      "Suporte prioritário",
    ],
  },
];

function PrecosPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <Link to="/sobre"><img src={logo} alt="BilheteIA PRO" className="h-9 w-auto" /></Link>
        <nav className="flex items-center gap-2">
          <Link to="/sobre"><Button variant="ghost" size="sm">Início</Button></Link>
          <Link to="/auth"><Button size="sm">Entrar</Button></Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-12 text-center">
        <Badge variant="outline" className="mb-4 gap-1"><Crown className="h-3 w-3" /> Escolha seu plano</Badge>
        <h1 className="text-3xl font-bold sm:text-4xl">Planos e Preços</h1>
        <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
          Todos os planos incluem análises com estatística e odds reais. Faça upgrade quando quiser.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="grid gap-4 md:grid-cols-3">
          {PLANOS.map((p) => (
            <Card key={p.nome} className={`relative flex flex-col p-6 ${p.destaque ? "border-primary ring-1 ring-primary" : ""}`}>
              {p.destaque && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">Mais popular</Badge>
              )}
              <h2 className="text-xl font-bold">{p.nome}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{p.descricao}</p>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-bold">{p.preco}</span>
                <span className="text-sm text-muted-foreground">/mês</span>
              </div>
              <ul className="mt-5 flex-1 space-y-2 text-sm">
                {p.recursos.map((r) => (
                  <li key={r} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> {r}
                  </li>
                ))}
              </ul>
              <Link to="/auth" className="mt-6">
                <Button className="w-full gap-2" variant={p.destaque ? "default" : "outline"}>
                  Assinar {p.nome} <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </Card>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          Valores em reais (BRL). Descontos disponíveis nos planos semestral e anual. Apostas para maiores de 18 anos —{" "}
          <Link to="/jogo-responsavel" className="underline hover:text-foreground">jogue com responsabilidade</Link>.
        </p>
      </section>
    </div>
  );
}
