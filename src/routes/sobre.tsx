import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import logo from "@/assets/bilheteia-logo.png";
import {
  Sparkles,
  Target,
  LineChart,
  Wallet,
  Flame,
  ShieldCheck,
  Zap,
  Trophy,
  ArrowRight,
  Check,
} from "lucide-react";

const SITE = "https://bilheteiapro.lovable.app";

export const Route = createFileRoute("/sobre")({
  head: () => ({
    meta: [
      { title: "BilheteIA PRO — Análises esportivas com estatística real" },
      {
        name: "description",
        content:
          "Plataforma de análise de apostas esportivas com estatísticas reais, odds reais e cálculo de valor. Monte bilhetes inteligentes e gerencie sua banca.",
      },
      { property: "og:title", content: "BilheteIA PRO — Análises esportivas com estatística real" },
      {
        property: "og:description",
        content:
          "Estatísticas reais + odds reais + cálculo de valor esperado. Monte bilhetes inteligentes e gerencie sua banca com o BilheteIA PRO.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE}/sobre` },
    ],
    links: [{ rel: "canonical", href: `${SITE}/sobre` }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "BilheteIA PRO",
          applicationCategory: "SportsApplication",
          operatingSystem: "Web",
          offers: { "@type": "Offer", price: "29.90", priceCurrency: "BRL" },
        }),
      },
    ],
  }),
  component: LandingPage,
});

const RECURSOS = [
  { icon: Target, title: "Bilhetes inteligentes", desc: "Monte bilhetes na odd que você quiser, com seleções ranqueadas por confiança e valor." },
  { icon: Flame, title: "Melhores Picks do Dia", desc: "As melhores seleções dos jogos de hoje, ranqueadas por valor esperado (EV) e confiança." },
  { icon: LineChart, title: "Dashboard e estatísticas", desc: "Acompanhe lucro, ROI, taxa de acerto e sequências com gráficos em tempo real." },
  { icon: Wallet, title: "Gestão de banca", desc: "Registre entradas e depósitos e visualize a evolução da sua banca." },
  { icon: Zap, title: "Estatística real, sem achismo", desc: "Odds reais, dados reais e cálculo local de probabilidade. Nada de palpite aleatório." },
  { icon: Trophy, title: "Principais campeonatos", desc: "Brasileirão, Libertadores, Champions, Premier League e muito mais." },
];

function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <img src={logo} alt="BilheteIA PRO" className="h-9 w-auto" />
        <nav className="flex items-center gap-2">
          <Link to="/precos"><Button variant="ghost" size="sm">Planos</Button></Link>
          <Link to="/auth"><Button size="sm">Entrar</Button></Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-4 py-16 text-center">
        <Badge variant="outline" className="mb-4 gap-1"><Sparkles className="h-3 w-3" /> Estatística real, sem IA de achismo</Badge>
        <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">
          Análises esportivas com estatística real e cálculo de valor
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-muted-foreground">
          O BilheteIA PRO combina odds reais e dados reais para gerar bilhetes inteligentes,
          identificar valor nas apostas e ajudar você a gerenciar sua banca com disciplina.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link to="/auth"><Button size="lg" className="gap-2">Começar agora <ArrowRight className="h-4 w-4" /></Button></Link>
          <Link to="/precos"><Button size="lg" variant="outline">Ver planos</Button></Link>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">Apostas para maiores de 18 anos. Jogue com responsabilidade.</p>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {RECURSOS.map((r) => (
            <Card key={r.title} className="p-5">
              <r.icon className="mb-3 h-6 w-6 text-primary" />
              <h3 className="font-semibold">{r.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{r.desc}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-16">
        <Card className="p-8 text-center">
          <ShieldCheck className="mx-auto mb-3 h-8 w-8 text-primary" />
          <h2 className="text-2xl font-bold">Como funciona</h2>
          <div className="mt-6 grid gap-4 text-left sm:grid-cols-3">
            {[
              ["1. Escolha o alvo", "Defina a odd, o período e os campeonatos que quer analisar."],
              ["2. Receba a análise", "O robô calcula probabilidade, valor e confiança de cada seleção."],
              ["3. Aposte com valor", "Monte o bilhete e acompanhe seu desempenho no dashboard."],
            ].map(([t, d]) => (
              <div key={t}>
                <div className="flex items-center gap-2 font-semibold"><Check className="h-4 w-4 text-primary" /> {t}</div>
                <p className="mt-1 text-sm text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>
          <div className="mt-8">
            <Link to="/auth"><Button size="lg" className="gap-2">Criar minha conta <ArrowRight className="h-4 w-4" /></Button></Link>
          </div>
        </Card>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:flex-row">
          <span>© {new Date().getFullYear()} BilheteIA PRO</span>
          <nav className="flex items-center gap-4">
            <Link to="/precos" className="hover:text-foreground">Planos</Link>
            <Link to="/jogo-responsavel" className="hover:text-foreground">Jogo Responsável</Link>
            <Link to="/auth" className="hover:text-foreground">Entrar</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
