import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Palette, Check } from "lucide-react";
import { ACCENTS, getAccent, setAccent } from "@/lib/accent";

export function AccentPicker() {
  const [sel, setSel] = useState<string>(ACCENTS[0].id);

  useEffect(() => {
    setSel(getAccent());
  }, []);

  return (
    <Card className="border-border/60 bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <Palette className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-muted-foreground">Cor do sistema</h2>
      </div>
      <div className="flex flex-wrap gap-3">
        {ACCENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            title={a.nome}
            onClick={() => {
              setAccent(a.id);
              setSel(a.id);
            }}
            className="relative h-9 w-9 rounded-full border-2 border-border transition-transform hover:scale-110"
            style={{ background: a.swatch }}
          >
            {sel === a.id && (
              <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
            )}
          </button>
        ))}
      </div>
    </Card>
  );
}
