# Panteon - inventario real do projeto

Assunto: [Zeus] inventario estrutural do Hub

Status: `VALIDADO_LOCAL / SEM DEPLOY`

Protocolo: `OP-20260530-002-ZEUS-INVENTORY`

Escopo:

- workspace vivo do repositorio, excluindo `.git`, `.next`, `.turbo`, `.vercel`, `node_modules`, `dist`, `build`, `coverage`, `.codex-deploy` e `.codex-artifacts`;
- sem leitura de valores de envs, secrets, tokens ou banco;
- sem alteracao de codigo de produto;
- sem Vercel, Supabase, banco, alias, dominio, migration ou deploy.

## Comando base

```powershell
node scripts\panteon-inventory-scan.mjs --format markdown --top 30
```

Resultado-base:

- arquivos avaliados: `621`;
- `apps/hub/app`: `121` arquivos;
- paginas App Router: `31`;
- layouts App Router: `1`;
- route handlers: `89`;
- API routes: `89`.

## Leitura por area

### `apps/hub/app`

Principais concentracoes:

| area | arquivos |
| --- | ---: |
| `api` | 89 |
| `guardian` | 6 |
| `hades` | 6 |
| `chronos` | 2 |
| `agenda`, `apolo`, `ares`, `atlas`, `caredesk`, `compras`, `contatos`, `drive`, `financeiro`, `hermes`, `iris`, `login`, `pulsex`, `setup` | 1 cada |

Diagnostico:

- `app/api` concentra quase toda a superficie App Router;
- existe convivencia entre nomes novos (`hades`, `iris`, `hermes`) e rotas legadas (`guardian`, `caredesk`, `pulsex`);
- a camada `app` ainda serve como transporte, mas o volume de rotas indica risco de regra de negocio dentro de handlers.

Classificacao: `bom` para rotas nomeadas; `ruim` para concentracao de API sem inventario fino por dominio.

### `apps/hub/modules`

| area | arquivos |
| --- | ---: |
| `guardian` | 24 |
| `chronos` | 2 |
| `squadops` | 2 |
| `apolo` | 1 |
| `ares` | 1 |
| `atlas` | 1 |
| `caredesk` | 1 |

Diagnostico:

- os modulos oficiais do Hub nao estao todos refletidos com pasta canonica nova;
- Hades ainda vive tecnicamente em `guardian`;
- Iris ainda vive tecnicamente em `caredesk`;
- Zeus ainda vive tecnicamente em `squadops`;
- Hermes vive majoritariamente fora de `modules`, em `components/pulsex` e `lib/pulsex`;
- Chronos, Apolo, Ares e Atlas ja tem pasta de modulo, mas ainda com paginas grandes.

Classificacao: `bom` por dominios nomeados; `critico` para decomposicao de paginas gigantes e aliases legados sem camada de migracao planejada.

### `apps/hub/lib`

| area | arquivos |
| --- | ---: |
| `squadops` | 10 |
| `pulsex` | 9 |
| `guardian` | 8 |
| `iris` | 6 |
| `atlas` | 5 |
| `chronos` | 5 |
| `operations` | 4 |
| `apolo` | 3 |
| `ares` | 3 |
| `hub-it-tickets` | 3 |
| `hub-ai` | 2 |
| `setup` | 2 |
| `supabase` | 2 |

Diagnostico:

- a separacao por dominio existe, mas ainda nao segue plenamente `domain/application/repositories/integrations/contracts`;
- `hub-ai` e a base operacional da Athena;
- `supabase` fica transversal e precisa continuar tratado como area sensivel;
- `hub-it-tickets` aparece sem owner canonico no manifesto atual e deve ser mapeado para Zeus ou camada compartilhada.

Classificacao: `bom` como base modular; `ruim` para arquivos server grandes e libs compartilhadas sem owner explicito.

### `apps/hub/components`

| area | arquivos |
| --- | ---: |
| `pulsex` | 18 |
| `guardian` | 7 |
| `hub-support` | 5 |
| arquivos soltos | 4 |

Diagnostico:

- Hermes esta fortemente representado em `components/pulsex`;
- Hades mantem componentes em `components/guardian`;
- `hub-support` deve ser tratado como area Zeus/shared e precisa de owner explicito no manifesto.

Classificacao: `bom` para agrupamentos existentes; `ruim` para ownership de componentes compartilhados.

### `packages`

| package | arquivos |
| --- | ---: |
| `uix` | 58 |
| `database` | 51 |
| `shared` | 12 |
| `auth` | 7 |
| `realtime` | 6 |
| `eslint-config` | 5 |
| `typescript-config` | 4 |

Diagnostico:

- `packages/uix` e `packages/database` sao as maiores areas transversais;
- qualquer mudanca nessas pastas deve ser tratada como recorte compartilhado e passar por Zeus;
- `packages/realtime` tem relacao natural com Hermes;
- `packages/shared/src/modules` e `packages/shared/src/permissions` conectam Panteon e Setup.

Classificacao: `bom`, desde que os recortes compartilhados tenham protocolo proprio.

## Arquivos grandes

Limiares usados:

- `atencao`: 500 a 999 linhas;
- `ruim`: 1000 a 1999 linhas;
- `critico`: 2000+ linhas.

Resumo:

- `atencao`: 47 arquivos;
- `ruim`: 33 arquivos;
- `critico`: 22 arquivos.

Top riscos estruturais:

| classificacao | linhas | owner | arquivo |
| --- | ---: | --- | --- |
| critico | 22k+ | Zeus | `docs/operations/engineering-operations.md` |
| critico | 13051 | Iris | `apps/hub/modules/caredesk/IrisPage.tsx` |
| critico | 10461 | Zeus | `apps/hub/modules/squadops/ZeusPage.tsx` |
| critico | 6996 | Chronos | `apps/hub/modules/chronos/ChronosPage.tsx` |
| critico | 6452 | sem owner | `package-lock.json` |
| critico | 5457 | Zeus | `docs/operations/releases-homologation.md` |
| critico | 5332 | Apolo | `apps/hub/modules/apolo/ApoloPage.tsx` |
| critico | 4595 | Chronos | `apps/hub/lib/chronos/server.ts` |
| critico | 3951 | Apolo | `apps/hub/lib/apolo/server.ts` |
| critico | 3593 | Atlas | `apps/hub/modules/atlas/AtlasPage.tsx` |
| critico | 3336 | Ares | `apps/hub/modules/ares/AresPage.tsx` |
| critico | 3287 | Zeus | `apps/hub/modules/squadops/HubItTicketsBoard.tsx` |
| critico | 3257 | Hades | `apps/hub/modules/guardian/attendance/components/WhatsAppConversationPanel.tsx` |
| critico | 3178 | Setup | `apps/hub/app/setup/page.tsx` |
| critico | 3117 | Chronos | `apps/hub/modules/chronos/ChronosExternalRoomPage.tsx` |
| critico | 2931 | Iris | `apps/hub/lib/iris/caca-agent.ts` |
| critico | 2554 | Ares | `apps/hub/lib/ares/server.ts` |
| critico | 2488 | Hermes | `apps/hub/components/pulsex/pulsex-workspace.tsx` |
| critico | 2340 | Iris | `apps/hub/lib/iris/meta-inbound-processor.ts` |
| critico | 2325 | sem owner | `apps/guardian/modules/attendance/components/WhatsAppConversationPanel.tsx` |
| critico | 2059 | Iris | `apps/hub/app/api/iris/tickets/route.ts` |
| critico | 2037 | Setup | `apps/hub/lib/setup/data.ts` |

Leitura:

- `engineering-operations.md` e `releases-homologation.md` sao grandes por natureza documental; devem continuar append-only, mas podem ganhar indices derivados sem apagar historico;
- as maiores paginas de produto sao Iris, Zeus, Chronos, Apolo, Atlas e Ares;
- `server.ts` grandes indicam dominio e integracao misturados;
- `apps/guardian/**` esta fora do boundary manifest atual e precisa ser classificado como legado Hades ou legado externo antes de qualquer recorte.

## Imports entre owners

Edges resolvidos pelo scanner:

| edge | ocorrencias | leitura |
| --- | ---: | --- |
| Hades -> Athena | 4 | esperado quando IA/copilot for declarada |
| Iris -> Hades | 4 | risco operacional; Iris depende de Asaas/attendance de Hades |
| Apolo -> Hades | 3 | risco operacional; Apolo reutiliza db/types/componentes de Guardian/Hades |
| Chronos -> Hermes | 3 | esperado para chamada/media, mas deve ser declarado |
| Athena -> Hades | 2 | IA global lendo Hades; exige contrato de modulo |
| Hermes -> Athena | 2 | esperado para painel Athena, desde que declarado |
| Setup -> Panteon | 2 | esperado para shell/shared |
| Hades -> Iris | 1 | risco de acoplamento direto entre atendimento financeiro e CareDesk |
| Chronos -> Apolo | 1 | risco de dependencia de tipos fora do modulo |
| Zeus -> Panteon | 1 | esperado para shell |

Exemplos de risco que devem virar backlog de fronteira:

- `apps/hub/modules/guardian/attendance/AttendancePage.tsx` importa `@/modules/caredesk/IrisPage`;
- `apps/hub/modules/apolo/ApoloPage.tsx` importa componentes/tipos de `guardian`;
- `apps/hub/app/api/iris/attendant/route.ts` importa `guardian/asaas` e `guardian/attendance`;
- `apps/hub/modules/chronos/ChronosExternalRoomPage.tsx` importa componentes de `pulsex`;
- `apps/hub/modules/chronos/ChronosPage.tsx` importa tipos de `apolo`.

Classificacao:

- `excelente`: o scanner ja consegue detectar cross-owner resolvido pelo manifesto.
- `bom`: imports de shell e Athena podem ser declarados em `allowedLayers`.
- `ruim`: Iris/Hades/Apolo estao acoplados diretamente.
- `critico`: Hades importando pagina Iris inteira indica fronteira de produto quebrada.

## Nomes sensiveis

O scanner detectou nomes de arquivos sensiveis, sem ler nem imprimir valores:

- `.env.example`
- `.env.homolog.example`
- `apps/hub/.env.example`
- `apps/hub/.env.local`

Status: `BLOQUEADO` para qualquer alteracao, leitura de valores, publicacao, rotacao ou sincronizacao de envs sem autorizacao expressa do Lucas.

## Validacao local

- `node --check scripts\panteon-inventory-scan.mjs`: OK;
- `node scripts\panteon-inventory-scan.mjs --format markdown --top 30`: OK, retornando `621` arquivos avaliados;
- `node scripts\panteon-recorte-manifest-check.mjs --manifest docs\operations\panteon-recorte-manifest-op-20260530-002-inventory.json`: PASS;
- `node scripts\panteon-boundary-check.mjs --module zeus --files <arquivos-do-recorte>`: PASS;
- `git diff --check` no pacote de inventario: OK, com aviso esperado de LF/CRLF no diario;
- `rg -n "\s+$"` nos novos arquivos/docs do recorte: sem ocorrencias.

## Prioridade recomendada

1. `Zeus` como piloto de decomposicao: `ZeusPage.tsx` e `HubItTicketsBoard.tsx` sao grandes, mas pertencem ao dominio de controle que estamos estruturando agora.
2. `Iris` como segundo alvo: `IrisPage.tsx` e rotas Meta/tickets estao criticas, mas tem alto risco operacional e dependencias Hades.
3. `Chronos` deve ficar congelado no curto prazo, porque acabou de virar marco de producao com Google Agenda restaurado.
4. `Hades` precisa receber protocolo de fronteira com Iris antes de qualquer refatoracao de attendance.
5. `Hermes` deve declarar dependencias com Athena e Chronos quando envolver chamadas/media.
6. `Apolo` e `Ares` precisam decompor `Page.tsx` e `server.ts`, mas sem mexer em legado C2X/banco sem autorizacao.

## Proximas acoes

- atualizar o boundary manifest para mapear `hub-support`, `hub-it-tickets`, `apps/guardian/**` e shared packages quando virarem recorte;
- criar backlog de fronteira cross-owner por modulo;
- escolher o piloto somente com autorizacao explicita do Lucas;
- para o piloto Zeus, iniciar por blocos: `helpdesk`, `deploys`, `timeline`, `audits`, `records`, `database-monitoring`, `worktrees`, `recortes`, `incidents`.

Conclusao:

- O Hub ja e modular por nome, mas ainda nao por fronteira interna suficiente.
- O maior risco pratico hoje e a combinacao de paginas gigantes, APIs volumosas e imports diretos entre modulos.
- A acao agora nao e sair refatorando tudo: e escolher um piloto, criar protocolo e aplicar os gates antes de qualquer alteracao de produto.
