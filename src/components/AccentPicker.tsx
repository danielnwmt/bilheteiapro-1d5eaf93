import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Palette, Check } from "lucide-react";
import { ACCENTS, getAccent, setAccent } from "@/lib/accent";

function Swatches({ sel, onPick }: { sel: string; onPick: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-3">
      {ACCENTS.map((a) => (
        <button
          key={a.id}
          type="button"
          title={a.nome}
          onClick={() => onPick(a.id)}
          className="relative h-9 w-9 rounded-full border-2 border-border transition-transform hover:scale-110"
          style={{ background: a.swatch }}
        >
          {sel === a.id && (
            <Check className="absolute inset-0 m-auto h-4 w-4 text-white drop-shadow" />
          )}
        </button>
      ))}
    </div>
  );
}

export function AccentPicker({ compact = false }: { compact?: boolean }) {
  const [sel, setSel] = useState<string>(ACCENTS[0].id);

  useEffect(() => {
    setSel(getAccent());
  }, []);

  const pick = (id: string) => {
    setAccent(id);
    setSel(id);
  };

  if (compact) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm">
            <Palette className="mr-2 h-4 w-4" /> Cor
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto" align="end">
          <p className="mb-3 text-sm font-medium">Cor do sistema</p>
          <Swatches sel={sel} onPick={pick} />
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <Card className="border-border/60 bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <Palette className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-muted-foreground">Cor do sistema</h2>
      </div>
      <Swatches sel={sel} onPick={pick} />
    </Card>
  );
}
