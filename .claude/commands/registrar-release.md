---
description: Registra um deploy de produção no diário canônico (releases-production.md + engineering-operations.md)
---

Registre o último **deploy de produção** no diário canônico, seguindo a convenção de `docs/operations/`:

1. Em `docs/operations/releases-production.md`, adicione uma entrada com:
   - **data**, **módulo(s)**, **o que subiu** (recortes/bugs/protocolos),
   - **deployment ref** (ex.: `rbscvi7ae`), **rollback ref** (deployment anterior),
   - **healthchecks** (`c2x.app.br` → 200, `ops.c2x.app.br` → 307 intocado),
   - **autorizado por Lucas** (sim/quando).
2. Acrescente uma linha-resumo no diário vivo `docs/operations/engineering-operations.md`.

Use os **refs reais** do deploy que acabou de acontecer — não invente. Se faltar algum dado, pergunte ao Lucas. Não faça novo deploy aqui — só registra o que já foi feito.
