import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  createBackup,
  restoreBackup,
  backupToDrive,
  getDriveStatus,
  saveDriveCredentials,
  getDriveAuthUrl,
  exchangeDriveCode,
  disconnectDrive,
  getBackupSchedule,
  saveBackupSchedule,
  type BackupFile,
} from "@/lib/backup.functions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Link2,
  Unlink,
  CheckCircle2,
  Clock,
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
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");

  // Agendamento do backup automático.
  const [autoEnabled, setAutoEnabled] = useState(false);
  const [autoTime, setAutoTime] = useState("03:00");
  const [autoFreq, setAutoFreq] = useState<"daily" | "weekly">("daily");
  const [autoWeekday, setAutoWeekday] = useState(0);

  const doBackup = useServerFn(createBackup);
  const doDrive = useServerFn(backupToDrive);
  const doRestore = useServerFn(restoreBackup);
  const doStatus = useServerFn(getDriveStatus);
  const doSaveCreds = useServerFn(saveDriveCredentials);
  const doAuthUrl = useServerFn(getDriveAuthUrl);
  const doExchange = useServerFn(exchangeDriveCode);
  const doDisconnect = useServerFn(disconnectDrive);
  const doGetSchedule = useServerFn(getBackupSchedule);
  const doSaveSchedule = useServerFn(saveBackupSchedule);

  const redirectUri =
    typeof window !== "undefined" ? `${window.location.origin}/admin/backup` : "";

  const statusQuery = useQuery({
    queryKey: ["drive-status"],
    queryFn: () => doStatus(),
  });
  const status = statusQuery.data;

  const scheduleQuery = useQuery({
    queryKey: ["backup-schedule"],
    queryFn: () => doGetSchedule(),
  });
  useEffect(() => {
    const s = scheduleQuery.data;
    if (s) {
      setAutoEnabled(s.enabled);
      setAutoTime(s.time);
      setAutoFreq(s.freq);
      setAutoWeekday(s.weekday);
    }
  }, [scheduleQuery.data]);

  const mutSchedule = useMutation({
    mutationFn: () =>
      doSaveSchedule({
        data: { enabled: autoEnabled, time: autoTime, freq: autoFreq, weekday: autoWeekday },
      }),
    onSuccess: () => {
      toast.success("Agendamento salvo.");
      scheduleQuery.refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar agendamento"),
  });



  const mutSaveCreds = useMutation({
    mutationFn: () => doSaveCreds({ data: { clientId, clientSecret } }),
    onSuccess: () => {
      toast.success("Credenciais salvas.");
      setClientSecret("");
      statusQuery.refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao salvar credenciais"),
  });

  const mutConnect = useMutation({
    mutationFn: () => doAuthUrl({ data: { redirectUri } }),
    onSuccess: (r: any) => {
      window.location.href = r.url;
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao iniciar conexão"),
  });

  const mutExchange = useMutation({
    mutationFn: (code: string) => doExchange({ data: { code, redirectUri } }),
    onSuccess: () => {
      toast.success("Google Drive conectado!");
      statusQuery.refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao conectar", { duration: 10000 }),
  });

  const mutDisconnect = useMutation({
    mutationFn: () => doDisconnect(),
    onSuccess: () => {
      toast.success("Google Drive desconectado.");
      statusQuery.refetch();
    },
    onError: (e: any) => toast.error(e?.message ?? "Erro ao desconectar"),
  });

  // Captura o ?code= retornado pelo Google após o consentimento.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      window.history.replaceState({}, "", "/admin/backup");
      mutExchange.mutate(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


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
          <div className="mb-1 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Conexão com o Google Drive</h2>
            {status?.connected ? (
              <span className="flex items-center gap-1 text-sm text-primary">
                <CheckCircle2 className="h-4 w-4" /> Conectado
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">Não conectado</span>
            )}
          </div>
          <p className="mb-4 text-sm text-muted-foreground">
            Conecte sua conta Google para enviar os backups (funciona em instalação
            local). Crie credenciais OAuth no Google Cloud e use esta URL de redirecionamento:
          </p>
          <code className="mb-4 block break-all rounded bg-muted px-3 py-2 text-xs">
            {redirectUri}
          </code>

          {status?.connected ? (
            <Button
              variant="outline"
              disabled={mutDisconnect.isPending}
              onClick={() => mutDisconnect.mutate()}
            >
              {mutDisconnect.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Unlink className="mr-2 h-4 w-4" />
              )}
              Desconectar
            </Button>
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="gdrive-id">Client ID</Label>
                  <Input
                    id="gdrive-id"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                    placeholder="xxxxx.apps.googleusercontent.com"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="gdrive-secret">Client Secret</Label>
                  <Input
                    id="gdrive-secret"
                    type="password"
                    value={clientSecret}
                    onChange={(e) => setClientSecret(e.target.value)}
                    placeholder={status?.hasCredentials ? "•••••• (salvo)" : "GOCSPX-..."}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  disabled={mutSaveCreds.isPending || !clientId || !clientSecret}
                  onClick={() => mutSaveCreds.mutate()}
                >
                  {mutSaveCreds.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <KeyRound className="mr-2 h-4 w-4" />
                  )}
                  Salvar credenciais
                </Button>
                <Button
                  disabled={mutConnect.isPending || mutExchange.isPending || !status?.hasCredentials}
                  onClick={() => mutConnect.mutate()}
                >
                  {mutConnect.isPending || mutExchange.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Link2 className="mr-2 h-4 w-4" />
                  )}
                  Conectar Google Drive
                </Button>
              </div>
            </div>
          )}
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
