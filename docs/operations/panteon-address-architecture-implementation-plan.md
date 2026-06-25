# Panteon Address Architecture - plano de implantacao

Assunto: [Zeus] etapas de implantacao do CEP operacional

Status: `ATIVO / PLANO DE IMPLANTACAO`

Este plano organiza a implantacao da arquitetura de enderecamento do Panteon.
A producao validada em 2026-06-17 e tratada como a cidade marco zero, e cada
recorte futuro deve declarar o CEP operacional antes de virar candidato a
Preview, homologacao ou producao.

## Base oficial

- Cidade marco zero: `PNT-01-00-00-000`.
- Dominio principal preservado: `https://c2x.app.br`.
- Deployment validado: `dpl_4FyaXUbn47T45KBWJNGmA3a8orz5`.
- URL tecnica registrada: `https://careli-hub-hub-i2bs-2hmz65b0s-lucasruas-devs-projects.vercel.app`.
- Documento de arquitetura: `docs/operations/panteon-address-architecture.md`.
- Registry inicial: `docs/operations/panteon-address-registry.json`.
- Template de recorte: `docs/operations/panteon-address-recorte-template.json`.
- Validador local: `scripts/panteon-address-recorte-check.mjs`.

## Principios

- O CEP operacional nao substitui protocolo, Safety Gate, commit limpo,
  rollback, homologacao ou aprovacao humana.
- O CEP operacional roda antes dos Safety Gates para provar escopo de cidade,
  bairro, rua e casa.
- Uma casa so pode ser alterada se estiver declarada no manifesto do recorte.
- Caminhos protegidos continuam protegidos mesmo quando pertencem ao mesmo
  modulo.
- Operacoes com Vercel, Supabase, banco, dominio, alias, producao, migration,
  env ou secret permanecem `BLOQUEADO` ate autorizacao explicita do Lucas.
- O root atual misto nao deve ser usado como fonte de publicacao.

## Status usados

- `CONCLUIDO`: etapa criada e validada localmente.
- `PROXIMO`: etapa pronta para ser executada em seguida.
- `FUTURO`: etapa planejada, mas sem necessidade imediata.
- `EM_VALIDACAO_LOCAL`: etapa autorizada e implementada localmente, aguardando
  validacoes tecnicas antes de qualquer Preview ou producao.
- `VALIDADO_LOCAL`: etapa implementada e validada localmente; publicacao segue
  bloqueada ate autorizacao explicita quando envolver ambiente real.
- `BLOQUEADO_ATE_AUTORIZACAO`: depende de runtime, deploy, ambiente sensivel,
  producao ou alteracao funcional autorizada por Lucas.

## Matriz de implantacao

| Etapa | Nome | Dono | Artefato principal | Status |
| --- | --- | --- | --- | --- |
| 0 | Congelar marco zero | Zeus | Diario e arquitetura | `CONCLUIDO` |
| 1 | Criar fundacao CEP | Zeus | Registry, template e README | `CONCLUIDO` |
| 2 | Criar piloto Hades/Iris | Zeus | Manifesto piloto | `CONCLUIDO` |
| 3 | Criar validador local | Zeus | Script de check | `CONCLUIDO` |
| 4 | Integrar protocolo de recorte | Zeus | Protocolo de recorte | `CONCLUIDO` |
| 5 | Expandir cobertura dos modulos | Zeus + agentes | Registry por modulo | `CONCLUIDO` |
| 6 | Integrar Safety Gates | Zeus | Homologation/Production gates | `CONCLUIDO` |
| 7 | Criar catalogo digital | Zeus | Tela no Operations Center | `VALIDADO_LOCAL` |
| 8 | Automatizar esteira | Zeus | Check em release/CI | `FUTURO` |
| 9 | Treinar agentes por CEP | Zeus | Prompts e handoffs | `FUTURO` |
| 10 | Manter e auditar catalogo | Zeus | Diario, registry e relatorios | `FUTURO` |

## Etapa 0 - congelar marco zero

Status: `CONCLUIDO`

Objetivo:

- Registrar que a versao em producao validada por Lucas e a cidade inicial.

Entradas:

- Confirmacao do Lucas de que a producao atual e o marco zero.
- Deployment validado e dominio principal.

Saidas:

- Cidade `PNT-01-00-00-000`.
- Registro no diario canonico.
- Regra de que qualquer recorte futuro precisa preservar essa base fora do
  escopo autorizado.

Validacao:

- Marco zero documentado em `docs/operations/panteon-address-architecture.md`.

## Etapa 1 - criar fundacao CEP

Status: `CONCLUIDO`

Objetivo:

- Criar a linguagem curta de endereco `PNT-CC-BB-RR-HHH`.

Entradas:

- Decisao do Lucas de usar codigo estilo CEP.
- Decisao do Lucas de reduzir cidade para dois digitos.

Saidas:

- `docs/operations/panteon-address-architecture.md`.
- `docs/operations/panteon-address-registry.json`.
- `docs/operations/panteon-address-recorte-template.json`.
- Ponteiro em `docs/operations/README.md`.

Validacao:

- JSON do registry e do template parseado com sucesso.
- CEPs unicos e no formato oficial.
- Marcadores obrigatorios iniciais encontrados.

## Etapa 2 - criar piloto Hades/Iris

Status: `CONCLUIDO`

Objetivo:

- Provar a arquitetura em um recorte real, sem alterar runtime.

Entradas:

- Casa piloto `PNT-01-10-20-003`.
- Escopo: Hades / Cobranca / Iris embutida.

Saidas:

- `docs/operations/panteon-address-recorte-pilot-hades-iris-embed-20260617.json`.

Validacao:

- Manifesto JSON valido.
- CEPs declarados existentes no registry.
- Marcador obrigatorio do embed encontrado.
- Nenhuma alteracao em `apps/hub/**`.

## Etapa 3 - criar validador local

Status: `CONCLUIDO`

Objetivo:

- Automatizar a primeira trava: manifesto CEP x registry x arquivos alterados.

Entradas:

- Registry inicial.
- Template de recorte.
- Manifesto piloto.

Saidas:

- `scripts/panteon-address-recorte-check.mjs`.

Validacao:

- `node --check scripts/panteon-address-recorte-check.mjs`.
- `node scripts/panteon-address-recorte-check.mjs --self-test`.
- Manifesto piloto aprovado sem diff.
- Manifesto piloto aprovado com arquivo permitido.
- Manifesto piloto bloqueado quando arquivo protegido e informado.

## Etapa 4 - integrar protocolo de recorte

Status: `CONCLUIDO`

Objetivo:

- Tornar o CEP operacional obrigatorio antes de qualquer Preview, homologacao
  ou producao.

Entradas:

- `docs/operations/panteon-recorte-protocols.md`.
- Template CEP.
- Validador local.

Saidas:

- Protocolo exigindo `addressCode`, cidade, bairro, rua, casas autorizadas e
  casas protegidas.
- Checklist com o comando `panteon-address-recorte-check.mjs` antes do Safety
  Gate.
- Handoff padronizado com CEP do recorte.
- Governanca vigente atualizada para exigir CEP em homologacao, producao e
  entrega minima de agentes.

Criterio de saida:

- Todo novo protocolo deve responder "qual cidade, bairro, rua e casa serao
  alterados" antes de entrar na fila de release.

Bloqueio:

- Se o recorte nao tiver CEP, status correto e `BLOQUEADO`.

## Etapa 5 - expandir cobertura dos modulos

Status: `CONCLUIDO`

Objetivo:

- Sair do mapa inicial e cobrir os modulos criticos com ruas e casas
  suficientes para recortes reais.

Ordem sugerida:

1. Home / Panteon Core.
2. Hades.
3. Iris.
4. Hermes.
5. Chronos.
6. Zeus / Operations Center.
7. Atlas.
8. Setup.
9. Apolo e Ares quando houver recorte ativo.

Saidas:

- Novas entradas no registry para telas, componentes, APIs e documentos
  operacionais realmente usados.
- Cada nova casa com owner, paths, allowedChangedPaths, protectedPaths,
  requiredMarkers, forbiddenMarkers, validacoes, dominio e rollback.
- Cobertura inicial ampliada para Home/Panteon Core, Hades, Iris, Hermes,
  Chronos, Zeus, Atlas, Setup, Apolo e Ares.
- Registry passou de fundacao minima para 53 enderecos operacionais.

Criterio de saida:

- Cada modulo critico deve ter pelo menos cidade, bairro, rua principal e casas
  suficientes para recortes de manutencao sem tocar o modulo inteiro.
- Novas casas futuras devem continuar entrando somente por necessidade real de
  recorte ou rota existente.

Bloqueio:

- Nao inventar casas sem relacao com um recorte real ou rota existente.
- Runtime, Preview, homologacao, producao, Vercel, Supabase, banco, alias,
  dominio, env, secret e migration continuam fora desta etapa.

## Etapa 6 - integrar Safety Gates

Status: `CONCLUIDO`

Objetivo:

- Fazer o CEP virar preflight oficial antes dos gates de homologacao e
  producao.

Entradas:

- `docs/operations/homologation-safety-gate.md`.
- `scripts/homologation-safety-gate.mjs`.
- `docs/operations/production-module-safety-gate.md`.
- `scripts/production-module-safety-gate.mjs`.

Saidas esperadas:

- Manifestos de Safety Gate referenciando o manifesto CEP.
- Falha imediata quando o diff tocar CEP fora do recorte.
- Relatorio do gate mostrando casas autorizadas, casas protegidas e arquivos
  bloqueados.

Saidas realizadas:

- `scripts/homologation-safety-gate.mjs` exige `addressManifest` e roda o
  preflight CEP com `addressCheckFiles` ou `includedFiles`.
- `scripts/production-module-safety-gate.mjs` exige `addressManifest`, roda o
  preflight CEP com `addressCheckFiles` ou diff real do pacote candidato, e
  bloqueia producao quando o check retorna `BLOQUEADO`.
- `docs/operations/homologation-safety-gate.md` e
  `docs/operations/production-module-safety-gate.md` registram o CEP como gate
  obrigatorio.
- `docs/operations/production-module-safety-gate-template.json` inclui os
  campos `addressManifest` e `addressCheckFiles`.

Validacao local:

- `node --check scripts/homologation-safety-gate.mjs`: PASS.
- `node --check scripts/production-module-safety-gate.mjs`: PASS.
- `node scripts/panteon-address-recorte-check.mjs --manifest docs/operations/panteon-address-recorte-pilot-hades-iris-embed-20260617.json --files apps/hub/modules/caredesk/embeds/iris-collection-queue-embed.tsx`: PASS.
- `node scripts/production-module-safety-gate.mjs --self-test`: PASS.
- Teste negativo local do Homologation Safety Gate sem `addressManifest`:
  BLOQUEADO esperado.
- `git diff --check -- docs/operations/engineering-operations.md`: PASS com
  aviso LF/CRLF do Git.
- Trailing whitespace nos arquivos tocados: PASS.
- Parse de `docs/operations/production-module-safety-gate-template.json`: PASS.

Criterio de saida:

- Nenhum pacote candidato deve passar para homologacao/producao sem check CEP
  aprovado.

Bloqueio:

- Uso em deploy, alias, homologacao real ou producao continua sensivel e exige
  autorizacao explicita do Lucas, mesmo com o gate local concluido.

## Etapa 7 - criar catalogo digital no Zeus

Status: `VALIDADO_LOCAL`

Objetivo:

- Transformar o registry em uma tela consultavel no Operations Center.

Funcionalidades planejadas:

- Busca por CEP, modulo, rota, arquivo, owner e status.
- Visualizacao cidade -> bairro -> rua -> casa.
- Link entre CEP, protocolo, deployment e rollback.
- Alerta visual para casa protegida ou recorte bloqueado.
- Geracao assistida de manifesto a partir da casa selecionada.

Dependencias:

- Autorizacao explicita do Lucas para mexer em runtime/UI: recebida em
  2026-06-18 para continuidade local da acao Address.
- Leitura de `docs/architecture/design-guidelines.md`.
- Recorte proprio de Zeus, sem misturar Hades, Iris, Hermes, Chronos ou outros
  modulos.

Saidas validadas localmente:

- `PNT-01-50-30-000`: rua Zeus / Address Catalog.
- `PNT-01-50-30-001`: casa Zeus / Address / Catalogo CEP operacional.
- Aba `Address` no Zeus com resumo, filtros, arvore CEP, detalhes, marcadores
  e copia de semente de manifesto.
- API `/api/zeus/address-catalog` com leitura server-side do registry e
  autorizacao Zeus admin.
- Manifesto `ZEUS-20260618-008-ADDRESS-CATALOG`.

Bloqueio:

- Preview, alias, dominio, producao, banco, env, secret e Vercel seguem
  bloqueados ate nova autorizacao explicita do Lucas.

Validacao local:

- JSON do registry e do manifesto: PASS.
- Lint focado do recorte: PASS.
- `npm.cmd run check-types:hub`: PASS.
- `npm.cmd run build --workspace @repo/hub`: PASS.
- Preflight CEP do manifesto `ZEUS-20260618-008-ADDRESS-CATALOG`: PASS, com
  avisos esperados de baseline OPS divergindo da cidade marco zero.
- `git diff --check` do recorte: PASS.

## Etapa 8 - automatizar esteira

Status: `FUTURO`

Objetivo:

- Rodar o check CEP automaticamente nos fluxos de release.

Saidas esperadas:

- Comando padrao em scripts de release local.
- Evidencia de check CEP no handoff de Preview, homologacao e producao.
- Bloqueio automatico de pacote com diff fora de `allowedChangedPaths`.

Bloqueio:

- CI, deploy, Vercel, env, dominio e producao continuam sensiveis e exigem
  autorizacao explicita quando a acao ultrapassar validacao local.

## Etapa 9 - treinar agentes por CEP

Status: `FUTURO`

Objetivo:

- Fazer cada agente iniciar o trabalho declarando o CEP do recorte.

Saidas esperadas:

- Prompts e handoffs em `docs/operations/` incluindo:
  - CEP do recorte;
  - arquivos autorizados;
  - arquivos protegidos;
  - comando de validacao CEP;
  - Safety Gate seguinte;
  - status final.

Criterio de saida:

- Nenhum agente deve entregar "mudanca de modulo" sem declarar "mudanca na
  casa X".

## Etapa 10 - manter e auditar catalogo

Status: `FUTURO`

Objetivo:

- Preservar o catalogo como fonte confiavel, pequena e auditavel.

Regras:

- Adicionar casas por necessidade real.
- Deprecar enderecos obsoletos em vez de apagar historico relevante.
- Registrar no diario quando uma casa mudar owner, path protegido, dominio de
  release, rollback ou marcador obrigatorio.
- Auditar periodicamente registry x rotas x arquivos existentes.

Saidas esperadas:

- Registry atualizado.
- Diario com decisoes de manutencao.
- Relatorio de casas sem dono, path inexistente ou marcador ausente.

## Definition of Done da implantacao

A arquitetura de CEP operacional esta implantada quando:

- todo recorte novo declara cidade, bairro, rua e casa;
- `panteon-address-recorte-check.mjs` passa antes dos Safety Gates;
- o protocolo de recorte rejeita manifesto sem CEP;
- os modulos criticos possuem casas suficientes no registry;
- Preview, homologacao e producao registram CEP no handoff;
- producao continua exigindo commit limpo, base ativa correta, pacote candidato,
  rollback e aprovacao do Lucas para acao sensivel.

## O que nao fazer

- Nao publicar a partir do root misto.
- Nao usar CEP para contornar Safety Gate.
- Nao mover alias, dominio, env, secret, Supabase, banco, migration, Vercel ou
  producao sem autorizacao explicita do Lucas.
- Nao alterar modulo fora da casa autorizada.
- Nao criar catalogo digital mexendo em runtime sem recorte proprio de Zeus.

## Conclusao

As etapas transformam o CEP operacional em processo: primeiro a linguagem,
depois o piloto, depois a trava local, depois a obrigatoriedade no protocolo,
depois cobertura por modulo, Safety Gates, catalogo digital e automacao. O
impacto pratico e reduzir publicacoes misturadas: cada recorte passa a ter um
endereco claro antes de qualquer movimento de release.
