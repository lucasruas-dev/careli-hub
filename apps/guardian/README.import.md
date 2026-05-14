# Guardian Import

Fonte importada de `C:\Users\lucas\Documents\Careli_C2x\Sistemas\careli-nexus`.

Este app esta dentro do monorepo do Hub apenas para analise e preparacao da migracao.
Ele nao participa do build, lint ou deploy porque o `package.json` nao expõe scripts.

## Mapa inicial

- `app/page.tsx`: cockpit principal do Guardian com KPIs, filtros e paineis expansivos.
- `app/atendimento/page.tsx`: tela de atendimento.
- `app/desk/page.tsx`: tela de Desk.
- `app/inteligencia/page.tsx`: tela de inteligencia operacional.
- `app/monitoramento/page.tsx`: tela de monitoramento.
- `modules/guardianMockData.ts`: base mockada atual.
- `modules/attendance/data.ts`: transformacao da base mockada em fila operacional.
- `modules/attendance/components`: componentes grandes de atendimento, acordos, parcelas, workflow e conversa.

## Proximo passo tecnico

Antes de ativar o Guardian em `/guardian`, separar:

- camada de dados real do sistema externo;
- contratos de dominio do Guardian;
- shell visual que deve usar o Hub, nao a sidebar/topbar antigas do projeto externo;
- dependencias que precisarao entrar no `apps/hub/package.json`.
