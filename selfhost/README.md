# BilheteIA PRO — Instalação 100% local (self-hosted)

Sobe **tudo dentro da sua VPS**: banco de dados, autenticação, API e o app.
Nada depende mais do Lovable Cloud.

## Pré-requisitos
- Portas liberadas no firewall: **8000** (API) e **3000** (App)
- Se Docker/Compose não existir, o instalador tenta instalar automaticamente.

## Instalar
```bash
cd selfhost
bash setup.sh
```
Na primeira vez ele pergunta o IP/domínio público, portas e o admin.
Tudo o mais (chaves, senhas, JWT) é gerado automaticamente em `selfhost/.env`.

Instalação automatizada/Localweb pela raiz do projeto:
```bash
bash deploy.sh
```
Esse comando usa banco local por padrão e não fica travado perguntando dados.
Se o painel detectar `docker-compose.yml` automaticamente, ele também sobe banco,
auth, API e app locais; informe `SUPABASE_PUBLIC_URL=http://SEU_IP:8000` quando o
painel permitir variáveis de ambiente.

Ao final:
- App: `http://SEU_IP:3000`
- Admin: `contato@protenexus.com` / `admin.1234` (ou o que você definiu)

## Atualizar o app (mantendo o banco local)
```bash
cd /opt/lovable/app
git pull
bash deploy.sh
```

## Reaplicar schema / recriar admin (sem apagar dados)
```bash
cd selfhost
bash repair-admin.sh
```

## Apagar tudo (zerar)
```bash
cd selfhost
docker compose down -v   # -v remove o banco também
```

## Observações
- As chaves de integração (Gemini, API-Football, etc.) continuam sendo
  configuradas no painel **Admin → APIs do sistema** após instalar.
- Login com Google não funciona no modo local (usa o broker do Lovable);
  use email/senha.
