## Objetivo
No builder de fluxo (admin/suporte), deixar as **linhas de conexão editáveis**: o admin arrasta da "porta" de uma opção até uma caixa de mensagem para definir qual caixa aquela opção dispara. Hoje cada opção tem uma caixa de resposta fixa (1:1, não editável). O cliente passa a seguir a ligação desenhada.

## O que muda para o usuário
- Cada opção ("Financeiro", "Ouvidoria"…) tem uma bolinha (porta) à direita.
- Arrastar dessa porta até a porta esquerda de uma caixa "Enviar mensagem" cria/atualiza a linha.
- A caixa ligada vira a resposta que o cliente recebe ao escolher a opção.
- Sem ligação = comportamento padrão (chama atendente).
- Marcador "Ouvidoria" continua funcionando.

```text
Iniciar → Saudação → Pedir para escolher
                          ├── Financeiro ─┐
                          └── Ouvidoria ──┼─→ (arraste p/ qualquer caixa)
                                          └─→ Caixa "Aguarde, atendente…"
```

## Modelo de dados
`Fluxo.opcoes[i]` ganha `destino?: string` (id da caixa alvo). Caixas endereçáveis: `msg` (saudação) e `extra-<n>` (caixas adicionais). O texto mostrado ao cliente passa a vir da caixa apontada por `destino`; se não houver `destino`, usa `op.resposta` (compatibilidade).

Salvo em `SUPORTE_FLUXO` (mesma chave). `getSuporte` já sanitiza o fluxo — incluir `destino` na leitura.

## Builder (FluxoBuilder.tsx)
- Tornar o SVG interativo (pointer events na porta da opção).
- Estado de "ligação em andamento": ao `pointerdown` numa porta de opção, desenhar linha até o cursor; ao soltar sobre a porta de uma caixa, gravar `destino` naquela opção.
- Clicar numa linha existente permite remover/religar.
- Linhas passam a ser derivadas de `destino` (não mais 1:1 automático). Manter auto-layout das posições.

## Cliente (SuporteChat.tsx)
- Em `escolherOpcao`, se a opção tem `destino`, mostrar o texto da caixa alvo em vez de `op.resposta`.
- Restante do fluxo (ouvidoria, chamar atendente) inalterado.

## Arquivos
- `src/components/FluxoBuilder.tsx` — conexões arrastáveis, tipo `Fluxo` com `destino`.
- `src/components/SuporteChat.tsx` — seguir `destino`.
- `src/lib/access.functions.ts` — incluir `destino` na leitura do fluxo.
- `src/routes/_authenticated/admin/suporte.tsx` — incluir `destino` ao salvar.
