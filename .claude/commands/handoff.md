---
description: Gera o prompt de handoff de continuidade pro próximo Zeus + atualiza o diário (usar quando a sessão satura)
---

Gere o **handoff de continuidade** pro próximo agente Zeus, seguindo o protocolo de continuidade do projeto. Faça:

1. **Atualize a memória/diário** com o estado atual: o que está no ar, o que falta, refs de deploy/rollback, armadilhas conhecidas.
2. **Escreva um prompt de handoff autossuficiente** e salve em `docs/operations/zeus-new-chat-startup-prompt-<DATA>.md`, no molde do `docs/operations/zeus-new-chat-startup-prompt-2026-06-11.md`. Inclua:
   - Papel (**Zeus**) + a regra "só inicializa, **read-only** até o primeiro comando do Lucas".
   - **Arquivos obrigatórios** de leitura: `CLAUDE.md`, `AGENTS.md`, `docs/operations/README.md`, `docs/operations/engineering-operations.md`.
   - **Estado atual:** o que está **LIVE** em produção (com deployment ref + rollback), o que está em preview/pendente, e os próximos passos.
   - **Armadilhas** conhecidas e o **BLOQUEIO operacional** (nada de deploy/infra/secret sem OK; nunca `ops.c2x.app.br`).
3. Mostre ao Lucas o **caminho do arquivo** + um resumo curto, pra ele colar no chat novo.

Não faça deploy nem commit aqui — só gera o handoff e registra no diário.
