# BilheteIA PRO — Instalação 100% local (self-hosted)

Sobe **tudo dentro da sua VPS**: banco de dados, autenticação, API e o app.
Nada depende mais do Lovable Cloud.

## Pré-requisitos
- Docker + Docker Compose instalados
- Portas liberadas no firewall: **8000** (API) e **3000** (App)

## Instalar
```bash
cd selfhost
bash setup.sh
```
Na primeira vez ele pergunta o IP/domínio público, portas e o admin.
Tudo o mais (chaves, senhas, JWT) é gerado automaticamente em `selfhost/.env`.

Ao final:
- App: `http://SEU_IP:3000`
- Admin: `contato@protenexus.com` / `admin.1234` (ou o que você definiu)

## Atualizar o app (mantendo o banco local)
```bash
cd selfhost
git pull
docker compose up -d --build app
```

## Reaplicar schema / recriar admin (sem apagar dados)
```bash
cd selfhost
docker compose cp pre.sql    db:/tmp/pre.sql    && docker compose exec -T db psql -U postgres -d postgres -f /tmp/pre.sql
docker compose cp admin.sql  db:/tmp/admin.sql
docker compose exec -T db psql -U postgres -d postgres -v admin_email=contato@protenexus.com -v admin_password=admin.1234 -f /tmp/admin.sql
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
