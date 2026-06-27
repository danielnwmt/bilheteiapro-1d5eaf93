import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { createBackup, restoreBackup, backupToDrive, type BackupFile } from "@/lib/backup.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import {
  ArrowLeft,
  Download,
  Upload,
  CloudUpload,
  DatabaseBackup,
  Loader2,
  Users,
  KeyRound,
  Wallet,
  Receipt,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/backup")({
  head: () => ({ meta: [{ title: "Backup — Admin BilheteIA" }] }),
  component: BackupPage,
  errorComponent: () => (
    <main className="min-h-screen bg-background p-10 text-center">
      Erro ao carregar a página de backup.
    </main>
  ),
});

const INCLUI = [
  { icon: Wallet, label: "Bancas (depósitos e entradas)" },
  { icon: Users, label: "Cadastro dos clientes" },
  { icon: KeyRound, label: "Chaves de API" },
  { icon: Receipt, label: "Histórico de pagamento" },
];

function BackupPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);

  const doBackup = useServerFn(createBackup);
  const doDrive = useServerFn(backupToDrive);
  const doRestore = useServerFn(restoreBackup);

  const mutBaixar = useMutation({
    mutationFn: () => doBackup(),
    onSuccess: (backup) => {
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.href = url;
      a.download = `bilheteia-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Backup gerado e baixado.");
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao gerar backup"),
  });

  const mutDrive = useMutation({
    mutationFn: () => doDrive(),
    onSuccess: (r: any) => toast.success(`Backup enviado para o Google Drive: ${r.filename}`),
    onError: (e: any) => toast.error(e?.message ?? "Erro ao enviar para o Drive", { duration: 10000 }),
  });

  const mutRestore = useMutation({
    mutationFn: (backup: BackupFile) => doRestore({ data: { backup } }),
    onSuccess: () => toast.success("Backup restaurado com sucesso."),
    onError: (e: any) => toast.error(e?.message ?? "Erro ao restaurar backup", { duration: 10000 }),
  });

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const backup = JSON.parse(String(reader.result)) as BackupFile;
        if (!backup?.dados) throw new Error("Arquivo inválido");
        mutRestore.mutate(backup);
      } catch {
        toast.error("Arquivo de backup inválido.");
      }
    };
    reader.readAsText(file);
  }

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-10">
        <div className="mb-8 flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => router.navigate({ to: "/admin" })}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Voltar
          </Button>
          <div className="flex items-center gap-2">
            <DatabaseBackup className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold">Backup do sistema</h1>
          </div>
        </div>

        <Card className="mb-6 p-6">
          <h2 className="mb-3 font-semibold">O backup inclui</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {INCLUI.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon className="h-4 w-4 text-primary" /> {label}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="mb-6 p-6">
          <h2 className="mb-1 font-semibold">Fazer backup</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Envie para o Google Drive ou baixe o arquivo para guardar.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button disabled={mutDrive.isPending} onClick={() => mutDrive.mutate()}>
              {mutDrive.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CloudUpload className="mr-2 h-4 w-4" />
              )}
              Enviar para o Google Drive
            </Button>
            <Button variant="outline" disabled={mutBaixar.isPending} onClick={() => mutBaixar.mutate()}>
              {mutBaixar.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              Baixar backup
            </Button>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="mb-1 font-semibold">Restaurar backup</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Selecione um arquivo de backup (.json) para restaurar os dados. Os registros existentes são
            atualizados.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onPickFile}
          />
          {!restoreOpen ? (
            <Button variant="outline" onClick={() => setRestoreOpen(true)}>
              <Upload className="mr-2 h-4 w-4" /> Restaurar a partir de um arquivo
            </Button>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="destructive"
                disabled={mutRestore.isPending}
                onClick={() => fileRef.current?.click()}
              >
                {mutRestore.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="mr-2 h-4 w-4" />
                )}
                Escolher arquivo e restaurar
              </Button>
              <Button variant="ghost" onClick={() => setRestoreOpen(false)}>
                Cancelar
              </Button>
            </div>
          )}
        </Card>
      </div>
    </main>
  );
}
