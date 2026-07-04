import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import logo from "@/assets/bilheteia-logo.png";
import { ShieldCheck, HeartHandshake, Clock, Ban, PhoneCall, AlertTriangle } from "lucide-react";

const SITE = "https://bilheteiapro.lovable.app";

export const Route = createFileRoute("/jogo-responsavel")({
  head: () => ({
    meta: [
      { title: "Jogo Responsável — BilheteIA PRO" },
      {
        name: "description",
        content:
          "Aposte com responsabilidade. Dicas de controle, sinais de alerta e canais de ajuda. Apostas apenas para maiores de 18 anos.",
      },
      { property: "og:title", content: "Jogo Responsável — BilheteIA PRO" },
      {
        property: "og:description",
        content: "Controle, sinais de alerta e onde buscar ajuda. Apostas para maiores de 18 anos.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SITE}/jogo-responsavel` },
    ],
    links: [{ rel: "canonical", href: `${SITE}/jogo-responsavel` }],
  }),
  component: JogoResponsavelPage,
});

const DICAS = [
  { icon: Clock, title: "Defina limites", desc: "Estabeleça um valor máximo e um tempo diário. Nunca ultrapasse o que planejou." },
  { icon: Ban, title: "Nunca persiga perdas", desc: "Tentar recuperar prejuízo apostando mais é o caminho mais rápido para perder o controle." },
  { icon: HeartHandshake, title: "Aposte por diversão", desc: "Apostar não é fonte de renda garantida. Use apenas dinheiro que você pode perder." },
  { icon: ShieldCheck, title: "Faça pausas", desc: "Aposte com a cabeça fria. Evite decisões sob emoção, álcool ou pressão." },
];

const SINAIS = [
  "Apostar mais do que pode perder",
  "Mentir sobre quanto ou quando aposta",
  "Apostar para fugir de problemas ou aliviar ansiedade",
  "Pedir dinheiro emprestado para apostar",
  "Sentir irritação ao tentar parar",
];

function JogoResponsavelPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
        <Link to="/sobre"><img src={logo} alt="BilheteIA PRO" className="h-9 w-auto" /></Link>
        <Link to="/auth"><Button size="sm">Entrar</Button></Link>
      </header>

      <section className="mx-auto max-w-4xl px-4 py-10">
        <div className="text-center">
          <ShieldCheck className="mx-auto mb-3 h-9 w-9 text-primary" />
          <h1 className="text-3xl font-bold sm:text-4xl">Jogo Responsável</h1>
          <p className="mx-auto mt-3 max-w-2xl text-muted-foreground">
            Apostas são uma forma de entretenimento — não de renda. O BilheteIA PRO oferece análises,
            mas a decisão e o risco são sempre seus. Aposte com consciência.
          </p>
        </div>

        <Card className="mt-8 flex items-start gap-3 border-primary/40 bg-primary/5 p-5">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <p className="text-sm">
            <strong>+18.</strong> Apostas são permitidas apenas para maiores de 18 anos. Se você é menor de idade,
            não utilize esta plataforma.
          </p>
        </Card>

        <h2 className="mt-10 text-xl font-bold">Dicas para manter o controle</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {DICAS.map((d) => (
            <Card key={d.title} className="p-5">
              <d.icon className="mb-2 h-6 w-6 text-primary" />
              <h3 className="font-semibold">{d.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{d.desc}</p>
            </Card>
          ))}
        </div>

        <h2 className="mt-10 text-xl font-bold">Sinais de alerta</h2>
        <Card className="mt-4 p-5">
          <ul className="space-y-2 text-sm">
            {SINAIS.map((s) => (
              <li key={s} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> {s}
              </li>
            ))}
          </ul>
        </Card>

        <h2 className="mt-10 text-xl font-bold">Onde buscar ajuda</h2>
        <Card className="mt-4 flex flex-col gap-3 p-5 text-sm">
          <div className="flex items-start gap-3">
            <PhoneCall className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="font-semibold">CVV — Centro de Valorização da Vida</p>
              <p className="text-muted-foreground">Apoio emocional gratuito e sigiloso: ligue <strong>188</strong> (24h) ou acesse cvv.org.br.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <HeartHandshake className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div>
              <p className="font-semibold">Jogadores Anônimos</p>
              <p className="text-muted-foreground">Grupos de apoio para quem sente que perdeu o controle sobre o jogo: jogadoresanonimos.com.br.</p>
            </div>
          </div>
        </Card>

        <div className="mt-10 text-center">
          <Link to="/sobre"><Button variant="outline">Voltar ao início</Button></Link>
        </div>
      </section>
    </div>
  );
}
