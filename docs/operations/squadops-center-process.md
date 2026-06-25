# Zeus / Operations Center - processo operacional

## Objetivo

Zeus / Operations Center e a camada operacional do Panteon para controlar tickets, alertas, atividades, monitoramento, homologacao, releases, deploys, historico e rastreabilidade da engenharia IA Careli.

Ele continua no mesmo runtime do Panteon, mas com entrada operacional dedicada em `ops.c2x.app.br`. A tela, a governanca, as permissoes e a persistencia ficam concentradas em `/zeus`, com `/squadops` mantido apenas como rota legada de compatibilidade.

## Separacao de responsabilidades

- `ops.c2x.app.br`: entrada dedicada do Zeus em producao operacional; abre diretamente `/zeus`, sem sidebar/menu do Panteon.
- `ops.c2x.app.br/*`: rotas visuais fora de `/zeus` redirecionam para `/zeus`; APIs continuam protegidas e server-side.
- `c2x.app.br`: Panteon principal de producao sem item Zeus no sidebar/menu comum.
- `homo.c2x.app.br`: Panteon de homologacao sem item Zeus no sidebar/menu comum.
- `c2x.app.br/zeus`, `homo.c2x.app.br/zeus` e equivalentes legados `/squadops`: acesso direto redireciona para `/`; Zeus deve ser acessado pelo dominio operacional.

Se a homologacao cair, Zeus deve continuar mostrando historico, protocolos, status de release, tickets vinculados, alertas e producao a partir do banco operacional do proprio modulo.

## Fonte da verdade

- Estado operacional atual: Supabase estruturado e APIs reais do Panteon.
- Monitoramento realtime: endpoints e healthchecks reais.
- Historico narrativo: `docs/operations/engineering-operations.md`, como memoria viva e fallback controlado.
- Homologacao: registros compartilhados no banco, nao `localStorage`.

## Registro vivo sem deploy

Novas atividades operacionais nao devem depender de commit no Markdown nem de deploy para aparecer na tela.

- A criacao corrente acontece pela API protegida `POST /api/zeus/operations/structured` com `action = create-record`; `/api/squadops/operations/structured` permanece compatibilidade tecnica.
- A API grava em `hub_engineering_operation_records` usando service role apenas server-side.
- O banco ainda gera o protocolo legado `AT-0000` para registros estruturados do Zeus ate migration autorizada. A regra canonica aprovada em 2026-05-20 reserva `AT` para atendimentos Iris e move novas atividades operacionais Zeus para `OP`.
- O campo `Necessita deploy` define se o item fica apenas no historico ou entra como candidato para o Zeus agrupar em um `DP`.
- O botao `Novo registro` no Zeus cria o registro vivo e a timeline pode ser atualizada pela API sem publicar novo build.
- O Markdown canonico continua como memoria narrativa, exportacao, auditoria e fallback; ele nao deve ser a fonte principal de estado operacional corrente.

Regra pratica: deploy publica codigo; registro operacional publica dado. Depois desta V1, novas anotacoes, status e evidencias devem nascer no banco e nao em um commit documental obrigatorio.

## Regra para Zeus

Quando Lucas autorizar `Zeus` a executar ou publicar um recorte do proprio modulo, o agente assume tambem a reconciliacao operacional da tela.

O comportamento obrigatorio e:

- nao encerrar a entrega apenas com mensagem no chat;
- nao considerar o Markdown como suficiente para atualizar a tela;
- criar ou atualizar o registro vivo em `hub_engineering_operation_records`;
- reconciliar os protocolos afetados `AT/CB/TI/OP/AL/DP` para o status real;
- preencher commit, deployment, ambiente, validacoes, healthchecks e riscos quando existirem;
- atualizar a visao estruturada de releases quando o recorte tiver deploy;
- confirmar que a timeline do Operations Center passa a exibir o movimento recente;
- registrar a decisao final no diario canonico `docs/operations/engineering-operations.md`.

Quando o proprio `Zeus` executar o fluxo completo autorizado por Lucas - implementacao, validacao, registro, commit, publicacao e reconciliacao da tela Zeus -, o registro final deve ficar `EM PRODUCAO`. Nao deixar como `AGUARDANDO RELEASEOPS` se o agente assumiu a operacao de ponta a ponta.

Use `AGUARDANDO RELEASEOPS`, `BLOQUEADO`, `EM HOMOLOGACAO` ou outro status intermediario apenas quando existir dependencia real fora do Zeus ou quando Lucas decidir adiar a publicacao/revisao. Use `FINALIZADO` para decisao/processo sem mudanca de tela ou sem necessidade de publicacao.

## Sync local do diario para o banco

Enquanto ainda existirem registros append-only no Markdown canonico, a sincronizacao para o Supabase pode rodar na maquina local do Lucas.

- Watcher: `scripts/squadops-sync-operations-watch.mjs`.
- Execucao unica: `npm.cmd run squadops:sync`.
- Execucao continua: `npm.cmd run squadops:sync:watch`.
- Wrapper Windows: `scripts/squadops-sync-watch.ps1`.
- Instalador de tarefa no logon: `scripts/install-squadops-sync-watch-task.ps1`.
- Se o Windows negar a tarefa agendada, o instalador cria um inicializador na pasta Startup do usuario.
- Log local: `.codex-logs/squadops-sync-watch.log` e `.codex-logs/squadops-sync-watch-task.log`.

Regra de seguranca:

- O endpoint padrao e local: `http://localhost:3001/api/zeus/operations/structured`.
- Para importar o arquivo da maquina, o Panteon local precisa estar rodando, porque a API local le o arquivo local.
- Endpoint remoto so deve ser usado com `SQUADOPS_SYNC_BEARER`; ele nao deve ser o caminho padrao para importar o arquivo local, porque producao le o arquivo empacotado no ultimo deploy.
- A rotina nao executa deploy, nao altera secrets, nao roda migration e nao chama agentes; ela apenas dispara o sync estruturado ja protegido pela API do Zeus.

## Protocolos oficiais

- `AT-0001`: atendimento Iris como canal externo oficial e raiz de comunicacao externa.
- `CB-0001`: cobranca/Hades, com vinculo ao `AT` raiz quando nascer de atendimento ou comunicacao externa.
- `TI-000001`: ticket tecnico interno, suporte, bug ou melhoria operacional.
- `OP-0001`: atividade operacional Zeus, dados, infra, suporte ou governanca, sem virar `AT` quando for trabalho interno.
- `AL-0001`: alerta operacional.
- `DP-0001`: pacote macro de deploy/release.

Iris e o canal externo oficial do Panteon. Toda comunicacao externa deve passar por ela e gerar ou reutilizar um `AT` como protocolo raiz. Internamente, cada setor continua com seu protocolo proprio e rastreavel: Hades usa `CB`, Financeiro, Compras e Contratos terao seus prefixos proprios quando forem construidos, e Zeus usa `OP`, `TI`, `AL` ou `DP` conforme a natureza interna do trabalho. Quando uma atividade setorial depender de contato externo, o protocolo do setor deve ficar vinculado ao `AT` raiz, sem trocar a identidade do setor.

`TK` fica legado e nao deve ser usado para novos registros. Protocolos `AT` antigos do Zeus ficam preservados como historico, sem renumeracao. A migracao tecnica que muda geracao real de `hub_engineering_operation_records` de `AT` para `OP` e a criacao de sequencias/vinculos `AT/CB` para Iris/Cobranca dependem de migration autorizada por Lucas.

Os numeros devem ser sequenciais por prefixo, gerados pelo banco central, nunca por memoria local do navegador.

## Campo obrigatorio para agentes

Todo agente que registrar uma atividade precisa declarar:

```text
Necessita deploy: sim|nao
```

Regra:

- `Necessita deploy: nao`: fica no historico, nao entra na fila de deploy do Zeus.
- `Necessita deploy: sim`: vira candidato a deploy e pode ser agrupado pelo Zeus em um `DP`.

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
2. Athena/PO AI organiza o relato, mas nao executa acao sensivel.
3. Dev/agente do modulo trata a atividade e informa se precisa deploy.
4. O agente do modulo agrupa os itens do proprio modulo em um pacote `DP` ou pacote equivalente de homologacao.
5. O agente do modulo publica o recorte em homologacao quando Lucas autorizar e registra commit, deployment, validacoes, riscos e status no Zeus/Operations Center.
6. Lucas valida item por item em homologacao.
7. Itens aprovados ficam `PRONTO PARA PRODUCAO` por modulo e geram handoff/prompt de release para o Zeus.
8. Itens reprovados, bloqueados ou pendentes ficam fora da rodada e permanecem no modulo de origem.
9. O Zeus publica producao somente dos recortes homologados por modulo, registra commit, deployment, healthchecks e resultado.
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
- `hub_squadops_homologation_reviews`: validacao item a item feita por Lucas; nome legado mantido ate migration autorizada.
- `hub_squadops_monitoring_check_runs`: execucoes de monitoramento do Zeus; nome legado mantido ate migration autorizada.
- `hub_squadops_monitoring_checks`: checks reais por execucao do Zeus; nome legado mantido ate migration autorizada.
- `hub_squadops_watcher_notifications`: notificacoes deduplicadas do Ops Watcher do Zeus; nome legado mantido ate migration autorizada.

## Sincronizacao do diario canonico

O `docs/operations/engineering-operations.md` continua sendo memoria narrativa e fallback, mas o Operations Center deve operar a partir da base estruturada.

Fluxo recomendado:

- registros novos devem nascer direto na base via `Novo registro` sempre que possivel;
- quando o Markdown for alterado por agente, o sync deve enviar o conteudo do arquivo para `POST /api/zeus/operations/structured` com `action=sync-markdown-content`;
- o watcher local pode usar esse modo para enviar o arquivo local para a API protegida, sem depender do servidor remoto ler um arquivo empacotado no ultimo deploy;
- a tela deve mostrar a hora do ultimo sync registrado em `hub_engineering_operation_sync_runs`;
- se o automatico falhar, Lucas pode usar `Importar arquivo local` na tela e selecionar `docs/operations/engineering-operations.md`;
- o sync deve reconciliar conflito de protocolo sem sobrescrever registro vivo diferente: se o protocolo ja existir com outro `source_key`, somente registros equivalentes por hash/titulo devem ser fundidos; caso contrario, o banco gera novo protocolo sequencial.

## Regras de seguranca

- RLS ativo em todas as tabelas expostas.
- `service_role` apenas server-side.
- `authenticated` com politicas por perfil/permissao.
- Sem exposicao de secrets, envs ou payload sensivel.
- Sem deploy automatico ou acao destrutiva disparada por IA.

## Reconciliacao da fila atual

A fila antiga de homologacao de Zeus nao deve ser apagada. Ela deve ser reconciliada quando a base central existir:

- marcar protocolos ja publicados como `absorvido_em_producao`;
- manter historico original;
- remover apenas da visao de pendencias;
- vincular cada `DP` aos `AT/CB/TI/OP/AL` publicados quando houver evidencia.

## Decisao V1

Zeus fica como modulo proprio do mesmo Panteon, mas a experiencia operacional publica deve existir apenas em `ops.c2x.app.br`. A independencia vem do dominio dedicado, do render standalone, da fonte de dados operacional, da permissao admin e das tabelas legadas com prefixo `hub_squadops_*`, nao de uma migracao destrutiva do Panteon inteiro.
