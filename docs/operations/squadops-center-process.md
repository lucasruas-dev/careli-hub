# SquadOps Center - processo operacional

## Objetivo

O SquadOps Center e a camada operacional do Hub para controlar tickets, alertas, atividades, monitoramento, homologacao, releases, deploys, historico e rastreabilidade da engenharia IA Careli.

Ele continua sendo o modulo `SquadOps` do mesmo runtime do Hub, mas com entrada operacional dedicada em `ops.c2x.app.br`. A tela, a governanca, as permissoes e a persistencia ficam concentradas em `/squadops`, sem abrir outros modulos dentro do dominio operacional.

## Separacao de responsabilidades

- `ops.c2x.app.br`: entrada dedicada do SquadOps em producao operacional; abre diretamente `/squadops`, sem sidebar/menu do Hub.
- `ops.c2x.app.br/*`: rotas visuais fora de `/squadops` redirecionam para `/squadops`; APIs continuam protegidas e server-side.
- `c2x.app.br`: Hub principal de producao sem item SquadOps no sidebar/menu.
- `homo.c2x.app.br`: Hub de homologacao sem item SquadOps no sidebar/menu.
- `c2x.app.br/squadops` e `homo.c2x.app.br/squadops`: acesso direto redireciona para `/`; o SquadOps deve ser acessado pelo dominio operacional.

Se a homologacao cair, o SquadOps deve continuar mostrando historico, protocolos, status de release, tickets vinculados, alertas e producao a partir do banco operacional do proprio modulo.

## Fonte da verdade

- Estado operacional atual: Supabase estruturado e APIs reais do Hub.
- Monitoramento realtime: endpoints e healthchecks reais.
- Historico narrativo: `docs/operations/engineering-operations.md`, como memoria viva e fallback controlado.
- Homologacao: registros compartilhados no banco, nao `localStorage`.

## Registro vivo sem deploy

Novas atividades operacionais nao devem depender de commit no Markdown nem de deploy para aparecer na tela.

- A criacao corrente acontece pela API protegida `POST /api/squadops/operations/structured` com `action = create-record`.
- A API grava em `hub_engineering_operation_records` usando service role apenas server-side.
- O banco gera o protocolo `AT-0000` sequencial automaticamente.
- O campo `Necessita deploy` define se o item fica apenas no historico ou entra como candidato para ReleaseOps agrupar em um `DP`.
- O botao `Novo registro` no SquadOps cria o registro vivo e a timeline pode ser atualizada pela API sem publicar novo build.
- O Markdown canonico continua como memoria narrativa, exportacao, auditoria e fallback; ele nao deve ser a fonte principal de estado operacional corrente.

Regra pratica: deploy publica codigo; registro operacional publica dado. Depois desta V1, novas anotacoes, status e evidencias devem nascer no banco e nao em um commit documental obrigatorio.

## Protocolos oficiais

- `TK-0001`: ticket aberto por usuario ou equipe operacional.
- `AT-0001`: atividade tecnica ou operacional.
- `AL-0001`: alerta operacional.
- `DP-0001`: pacote macro de deploy/release.

Os numeros devem ser sequenciais por prefixo, gerados pelo banco central, nunca por memoria local do navegador.

## Campo obrigatorio para agentes

Todo agente que registrar uma atividade precisa declarar:

```text
Necessita deploy: sim|nao
```

Regra:

- `Necessita deploy: nao`: fica no historico, nao entra na fila de ReleaseOps.
- `Necessita deploy: sim`: vira candidato a deploy e pode ser agrupado em um `DP`.

Tambem devem ser registrados:

- modulo;
- tela ou area;
- tipo de alteracao;
- motivo;
- arquivos/modulos afetados;
- validacoes executadas;
- riscos;
- status esperado;
- proxima squad recomendada.

## Fluxo oficial

1. Usuario ou agente abre `TK`, `AT` ou `AL`.
2. Caca/PO AI organiza o relato, mas nao executa acao sensivel.
3. Dev trata a atividade e informa se precisa deploy.
4. ReleaseOps agrupa somente itens com `necessita_deploy = true` em um `DP`.
5. `DP` e publicado em homologacao.
6. Lucas valida item por item em homologacao.
7. Itens aprovados entram no prompt final de producao.
8. Itens reprovados, bloqueados ou pendentes ficam fora da rodada.
9. ReleaseOps publica producao, registra commit, deployment, healthchecks e resultado.
10. Tickets vinculados recebem atualizacao de status quando o protocolo associado muda.

## Status recomendados

### Ticket

- novo;
- em analise;
- em tratativa;
- em homologacao;
- em producao;
- resolvido;
- fechado;
- bloqueado.

### Atividade ou alerta

- registrado;
- em analise;
- em execucao;
- aguardando releaseops;
- em homologacao;
- aprovado;
- reprovado;
- bloqueado;
- em producao;
- finalizado.

### Deploy

- planejado;
- em homologacao;
- homologado parcial;
- homologado completo;
- pronto para producao;
- em producao;
- rollback;
- bloqueado;
- finalizado.

## Modelagem V1

Tabelas operacionais envolvidas:

- `hub_engineering_operation_records`: registros estruturados `AT`.
- `hub_operations_alert_protocols`: alertas `AL` e devolutivas tecnicas.
- `hub_it_tickets`: tickets `TK` abertos pelo time.
- `hub_it_ticket_operation_links`: vinculos entre tickets, atividades e releases.
- `hub_release_protocols`: deploys/releases `DP`.
- `hub_release_protocol_items`: protocolos incluidos no deploy.
- `hub_release_environment_events`: eventos por ambiente.
- `hub_squadops_homologation_reviews`: validacao item a item feita por Lucas.
- `hub_squadops_monitoring_check_runs`: execucoes de monitoramento do SquadOps.
- `hub_squadops_monitoring_checks`: checks reais por execucao do SquadOps.
- `hub_squadops_watcher_notifications`: notificacoes deduplicadas do Ops Watcher do SquadOps.

## Regras de seguranca

- RLS ativo em todas as tabelas expostas.
- `service_role` apenas server-side.
- `authenticated` com politicas por perfil/permissao.
- Sem exposicao de secrets, envs ou payload sensivel.
- Sem deploy automatico ou acao destrutiva disparada por IA.

## Reconciliacao da fila atual

A fila antiga de homologacao do SquadOps nao deve ser apagada. Ela deve ser reconciliada quando a base central existir:

- marcar protocolos ja publicados como `absorvido_em_producao`;
- manter historico original;
- remover apenas da visao de pendencias;
- vincular cada `DP` aos `AT/AL/TK` publicados quando houver evidencia.

## Decisao V1

O SquadOps fica como modulo proprio do mesmo Hub, mas a experiencia operacional publica deve existir apenas em `ops.c2x.app.br`. A independencia vem do dominio dedicado, do render standalone, da fonte de dados operacional, da permissao admin e das tabelas com prefixo `hub_squadops_*`, nao de uma migracao do Hub inteiro.
