export type AccentOption = {
  id: string;
  nome: string;
  primary: string;
  foreground: string;
  swatch: string;
};

export const ACCENTS: AccentOption[] = [
  { id: "verde", nome: "Verde", primary: "oklch(0.78 0.19 145)", foreground: "oklch(0.16 0.04 150)", swatch: "#22c55e" },
  { id: "azul", nome: "Azul", primary: "oklch(0.65 0.2 250)", foreground: "oklch(0.98 0.01 250)", swatch: "#3b82f6" },
  { id: "roxo", nome: "Roxo", primary: "oklch(0.62 0.24 300)", foreground: "oklch(0.98 0.01 300)", swatch: "#9b59ff" },
  { id: "rosa", nome: "Rosa", primary: "oklch(0.68 0.23 350)", foreground: "oklch(0.98 0.01 350)", swatch: "#ec4899" },
  { id: "laranja", nome: "Laranja", primary: "oklch(0.72 0.2 55)", foreground: "oklch(0.16 0.04 55)", swatch: "#f97316" },
  { id: "amarelo", nome: "Amarelo", primary: "oklch(0.85 0.18 95)", foreground: "oklch(0.2 0.04 95)", swatch: "#eab308" },
  { id: "vermelho", nome: "Vermelho", primary: "oklch(0.63 0.24 25)", foreground: "oklch(0.98 0.01 25)", swatch: "#ef4444" },
  { id: "ciano", nome: "Ciano", primary: "oklch(0.72 0.13 195)", foreground: "oklch(0.16 0.04 195)", swatch: "#06b6d4" },
];

const KEY = "app-accent";

export function applyAccent(id: string) {
  const a = ACCENTS.find((x) => x.id === id) ?? ACCENTS[0];
  const root = document.documentElement;
  root.style.setProperty("--primary", a.primary);
  root.style.setProperty("--primary-foreground", a.foreground);
  root.style.setProperty("--ring", a.primary);
  root.style.setProperty("--sidebar-primary", a.primary);
  root.style.setProperty("--chart-1", a.primary);
}

export function getAccent(): string {
  if (typeof window === "undefined") return ACCENTS[0].id;
  return localStorage.getItem(KEY) ?? ACCENTS[0].id;
}

export function setAccent(id: string) {
  localStorage.setItem(KEY, id);
  applyAccent(id);
}
