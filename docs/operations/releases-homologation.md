# Releases de homologacao - Panteon

Este arquivo registra recortes preparados ou publicados em homologacao.
Nao registrar secrets, tokens, senhas, service role, chaves externas ou valores de env.

## 2026-05-20

### [Iris] Fallback de nono digito no envio WhatsApp

- Modulo: `Iris`.
- Ambiente: homologacao `https://homo.c2x.app.br`.
- Tipo: `HOTFIX / META WHATSAPP`.
- Escopo: envio outbound da Iris pela Meta Cloud API.
- Arquivos incluidos: `apps/hub/lib/iris/meta-whatsapp.ts`, `apps/hub/app/api/iris/meta/messages/route.ts`, `docs/operations/engineering-operations.md`, `docs/operations/releases-homologation.md`.
- Arquivos excluidos: Hades, Hermes, Zeus, Atlas, Chronos, Setup, banco, migrations, envs, secrets e producao.
- Decisao tecnica: quando a Meta retornar erro de destinatario nao permitido (`131030`), a Iris tenta automaticamente a variacao brasileira complementar do telefone: com nono digito se o numero veio sem ele, ou sem nono digito se veio com ele.
- Validacoes locais: `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub` passaram com warnings conhecidos.
- Commit publicado: `53906b5 fix(iris): retry whatsapp recipient variants`.
- Deployment homologacao: Vercel Preview `dpl_C4JmAzXQExyzWnz8mst2FW8fcm1B`; URL tecnica `https://careli-hub-hub-i2bs-pehwlghv4-lucasruas-devs-projects.vercel.app`; alias `https://homo.c2x.app.br`.
- Healthchecks: `/iris=200`, `/api/iris/meta/webhook=403` esperado sem challenge, `POST /api/iris/meta/messages=401` esperado sem sessao; logs recentes sem erro critico.
- Riscos conhecidos: o fallback so deve ocorrer nesse erro especifico da Meta; demais erros continuam bloqueando o envio sem segunda tentativa.
- Status: `EM HOMOLOGACAO / AGUARDANDO TESTE OPERACIONAL DO LUCAS`.
