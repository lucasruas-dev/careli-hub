# CareDesk Operational Memory

Atualizado em: 2026-05-16

Este arquivo deve ser lido antes de qualquer novo trabalho no modulo CareDesk. Ele guarda o contexto combinado com Lucas, as decisoes de arquitetura, o estado atual e o motivo das proximas etapas. A ideia e evitar que um novo agente precise redescobrir o que ja foi explicado.

## Regra De Continuidade

- Antes de alterar CareDesk, ler este arquivo e conferir os arquivos citados.
- Ao fechar um bloco relevante, atualizar este arquivo com: o que mudou, por que mudou, arquivos alterados, validacoes e pendencias.
- Nao alterar estrutura aprovada sem Lucas pedir explicitamente.
- Em caso de duvida de produto, perguntar antes de mexer.
- Usar pt-BR nas conversas com Lucas.

## Visao Do Produto

CareDesk e o coracao operacional de atendimento do Hub. Ele deve ser o canal universal de contato entre operador/Caca e cliente.

Fluxo receptivo:

1. Cliente envia mensagem para o WhatsApp oficial da Careli conectado pela Meta.
2. CareDesk identifica ou cria o contato.
3. CareDesk cria o ticket automaticamente.
4. Caca atende como primeira camada.
5. Se Caca resolver, o ticket registra classificacao, resolucao e metricas.
6. Se Caca nao resolver, faz handoff para suporte humano.
7. Suporte conduz o atendimento pelo cockpit e tudo fica registrado.

Fluxo ativo:

1. Operador busca cliente no futuro CRM/base central de clientes do Hub.
2. Operador abre ticket pelo formulario de atendimento.
3. Formulario exige perfil/motivo, fila, prioridade, SLA e entidades relacionadas quando aplicavel.
4. CareDesk inicia o contato no canal escolhido, principalmente WhatsApp.

## Limites Entre Modulos

CareDesk:

- Dono de tickets, conversas, mensagens, handoff, motivos de atendimento, SLA de atendimento, templates, disparos e KPIs de atendimento.
- Deve enxergar o cliente completo para ajudar o operador.
- Nao deve depender do Guardian para existir.

Guardian:

- E uma visao especializada de cobranca/inadimplencia.
- Enxerga apenas clientes inadimplentes ou em fluxo de cobranca.
- Usa CareDesk para contato com cliente.
- Nao alimenta indicadores do CareDesk.
- Pode abrir ticket no CareDesk com `source_module = guardian` e referencias externas, mas os KPIs de atendimento continuam sendo do CareDesk.

CRM futuro:

- Nome ainda sera definido.
- Sera a base central de contatos/clientes do Hub.
- Deve conversar com C2X Legado.
- Deve armazenar/organizar a vida do cliente: tickets, cobranca, reunioes, parcelas, boletos, contratos, unidades, historico e dados cadastrais.
- Suporte deve enxergar a base toda; Guardian deve enxergar apenas a fatia inadimplente.

## Arquitetura Atual

Banco CareDesk:

- Migration principal: `packages/database/migrations/0011_caredesk_core.sql`.
- Tabelas ja criadas: canais, filas, regras, perfis, contatos, entidades do contato, tickets, participantes, mensagens, anexos, eventos, templates, disparos, destinatarios e sugestoes da Caca.
- Estrutura ja suporta `source_module`, `source_entity_type`, `source_entity_id` e `source_context` para integrar com Guardian, CRM e C2X sem acoplamento direto.

Frontend CareDesk:

- Pagina: `apps/hub/app/caredesk/page.tsx`.
- Componente principal: `apps/hub/modules/caredesk/CareDeskPage.tsx`.
- CareDesk carrega dados das tabelas `caredesk_*`.
- A tela de Atendimento aprovada segue o layout: inbox lateral, chat central e contexto do cliente a direita.
- Board, Disparos, Setup e Relatorios existem como secoes do modulo.

Dados demo:

- Script: `scripts/seed-caredesk-demo.mjs`.
- Usa clientes reais da base C2X sincronizada para montar tickets e conversas demo.
- Nao deve ser tratado como Guardian alimentando o CareDesk.

Validacoes ja executadas apos a ultima mudanca:

- `npm.cmd run check-types:hub`
- `npm.cmd run lint:hub`
- `npm.cmd run build --workspace @repo/hub`
- Verificacao visual em `http://localhost:3001/caredesk`

## Guardian Como Referencia De Cockpit

A tela de cobranca do Guardian e referencia de densidade operacional, nao de acoplamento.

Arquivos importantes para estudar:

- `apps/hub/app/guardian/cobranca/page.tsx`
- `apps/hub/modules/guardian/attendance/AttendancePage.tsx`
- `apps/hub/modules/guardian/attendance/components/ClientDetailPanel.tsx`
- `apps/hub/modules/guardian/attendance/components/InstallmentsCard.tsx`
- `apps/hub/modules/guardian/attendance/components/OperationalTimeline.tsx`
- `apps/hub/modules/guardian/attendance/types.ts`
- `apps/hub/lib/guardian/attendance.ts`
- `apps/hub/lib/guardian/read-model.ts`
- `apps/hub/lib/guardian/asaas.ts`
- `apps/hub/app/api/guardian/asaas/boleto-resend/route.ts`
- `apps/hub/app/api/guardian/d4sign/contracts/[documentId]/route.ts`

Conceitos reutilizaveis no CareDesk:

- Cockpit do operador.
- Dados 360 do cliente.
- Carteira/unidades/contratos/parcelas.
- Timeline operacional.
- Acoes assistidas: boleto, contrato, promessa, acordo, observacao, retorno.
- IA como copiloto contextual.

Coisas que nao devem ser copiadas diretamente:

- KPIs financeiros do Guardian.
- Fila de inadimplencia como fonte universal.
- Linguagem que diga que Guardian alimenta CareDesk.

## Setup Do CareDesk

O Hub ja tem Setup Central para setores, colaboradores, modulos e permissoes. O CareDesk deve herdar isso quando precisar de pessoas, setores e permissao de modulo.

O Setup do CareDesk deve cuidar apenas da configuracao operacional do atendimento:

- Filas de atendimento.
- Motivos/perfis de atendimento.
- Categorias e subcategorias.
- Prioridade padrao.
- SLA de primeira resposta.
- SLA de resolucao.
- Campos obrigatorios por motivo.
- Canal permitido.
- Regras de roteamento.
- Regras de handoff Caca -> humano.
- Templates e mensagens padrao.
- Configuracao da Caca do CareDesk.
- Politicas de disparo em massa.

Motivo de atendimento e fundamental para metricas. Nao deve ficar solto em texto livre.

## Caca E Agentes

Direcao de produto:

- Ter uma agente virtual por modulo.
- Ter uma agente/coordenadora geral fazendo gerenciamento entre modulos.
- A Caca do Guardian ficou boa como referencia de experiencia.
- CareDesk deve ter sua propria Caca, focada em atendimento, triagem, resposta inicial, classificacao, sugestao de resolucao e handoff.

Regra de seguranca:

- A Caca pode sugerir e preparar acoes.
- Acoes sensiveis, como envio de boleto, devem manter confirmacao humana e log/auditoria.
- Credenciais e chamadas Asaas/D4Sign devem ficar server-side.

## Metricas Necessarias

CareDesk precisa medir atendimento, nao financeiro do Guardian.

Metricas principais:

- Tempo ate primeira resposta.
- Tempo de atendimento total.
- Tempo em cada fila.
- Tempo em Caca.
- Tempo em atendimento humano.
- Tempo entre respostas.
- Quantidade de interacoes por ticket.
- Taxa de resolucao pela Caca.
- Taxa de handoff para humano.
- Taxa de reabertura.
- Motivos de atendimento por volume.
- SLA vencido por fila/motivo/operador.
- Tickets por canal.
- Resolucao por motivo.

Gaps atuais:

- Ainda nao existe tabela propria para motivos/categorias historicas alem de `caredesk_ticket_profiles`.
- Ainda nao existe tabela propria de metricas/agregados de atendimento.
- Ainda nao existe fluxo real Meta WhatsApp.
- Ainda nao existe CRM/base central do cliente.

## Proximo Caminho Recomendado

Minha recomendacao de ordem:

1. Consolidar esta memoria como fonte de contexto do modulo.
2. Evoluir o Setup do CareDesk para configurar motivos/perfis de atendimento usando as tabelas existentes primeiro.
3. Adicionar, se necessario, uma migration pequena para separar motivo/categoria quando `caredesk_ticket_profiles` nao for suficiente.
4. Criar a camada de metricas do CareDesk a partir de tickets, mensagens e eventos.
5. Enriquecer a tela de Atendimento com o cockpit de contexto: tickets anteriores, status de cobranca, boletos, contratos, unidades e timeline.
6. Depois disso, desenhar o CRM/base de clientes para nao construir o CareDesk preso em dados temporarios.

## Estado Da Decisao Atual

Lucas aprovou a tela de Atendimento anterior como base visual:

- Lista de conversas a esquerda.
- Chat central.
- Contexto do cliente a direita.
- Formulario/modal de abertura de ticket para fluxo ativo.

Nada dessa estrutura deve ser substituido por uma tela diferente sem validacao do Lucas.

## Atualizacao 2026-05-16 - Setup de motivos/perfis

O que mudou:

- `apps/hub/modules/caredesk/CareDeskPage.tsx` agora carrega todos os registros de `caredesk_ticket_profiles`, alem de tickets, filas, canais, templates e disparos.
- A aba Setup ganhou uma area operacional de motivos/perfis com lista filtravel por fila e formulario real para criar/editar motivo, categoria, prioridade, SLA, status e campos obrigatorios.
- O salvamento usa a tabela existente `caredesk_ticket_profiles`; criacao usa `upsert` por `queue_id,slug` e edicao usa `update` por `id`.
- A estrutura aprovada de Atendimento foi preservada.

Validacoes:

- `npm.cmd run check-types:hub`
- `npm.cmd run lint:hub`
- `npm.cmd run build --workspace @repo/hub`
- Verificacao visual em `http://localhost:3001/caredesk`: Setup abriu, carregou 15 motivos reais, edicao preencheu o formulario e nao houve erro de console.

Pendencias recomendadas:

- Testar salvamento real com usuario `admin` ou `leader` autenticado para confirmar a policy de RLS em `caredesk_ticket_profiles`.
- Evoluir metricas agregadas do CareDesk a partir de tickets, mensagens e eventos.
- Depois enriquecer Atendimento com contexto 360 do cliente sem acoplar CareDesk ao Guardian.
