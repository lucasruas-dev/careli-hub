# PAN-124: o Panteon dono do cadastro de empreendimentos (plano de 26/09/2026)

> Plano revisado por dois críticos (regressão e dados; produto e regras da casa). Cada fatia é uma versão.
> Toda migration aplicada, escrita no banco e deploy exigem OK do Lucas. Gerado pelo workflow wf_7a7fe705-798.

## Visão
 O Panteon passa a ser a fonte do RÓTULO do empreendimento: nome de mercado, cidade, UF e o agrupamento pai/filho. Passa também a ser a fonte dos campos de cadastro que hoje só existem no C2X (F9) e o dono da edição. O C2X continua READ-ONLY e segue como fonte dos números (unidades e carteira). Toda consulta a ele é casada pelo id (lib/apolo/c2x-pelo-id.ts:266-301).

A SIGLA é a única chave que o Panteon divide com o legado. Hoje ela é o prefixo das unidades dos dois lados, e o C2X a renomeia em cascata, sem auditoria (caso do 30). A versão anterior do plano decidia sozinha que o C2X mandava na sigla. Isso contrariava regras escritas pelo Lucas, e virou a pergunta 1. Até a resposta, F1 a F9 andam, porque nenhuma delas depende da escolha. F10 e F11 esperam.

Cinco princípios ordenam as fatias:
1. **Chave antes de rótulo.** Todo lugar onde o nome virou chave de texto compara o id ANTES de a fonte do nome mudar. Entram nessa lista:
   - propostas filtradas por sigla;
   - o link público do painel do coordenador, feito do slug do nome;
   - 'group:<Nome>' montado ou casado com o nome do pai, inclusive em lib/temis/dados-do-contrato.ts:1454;
   - os ILIKE da esteira no resumo público, no relatório diário às imobiliárias e nas rotas do Asana;
   - o Board;
   - a soma por displayEnterprise.
2. **Paridade.** Cada troca de fonte prova, só com SELECT, que devolve as mesmas linhas, a mesma partição e os mesmos ids de hoje. As únicas diferenças aceitas vêm listadas antes.
3. **Trava e trilha no banco antes da tela.**
4. **Uma fonte só.** ENTERPRISE_GROUPS e ENTERPRISE_MIRRORS são apagadas ao fim da F8b, como combinado em 14/09 (reference_apolo_cadastra_hercules_vende). Não ficam como reserva. E nenhuma tela nova lê o C2X ao vivo (feedback_c2x_so_financeiro_via_carteira): a tela lê o cadastro e o retrato do C2X que o Panteon guarda (F3).
5. **Fronteira com a unificação (PAI É A FONTE).** O PAN-124 não muda o código da unidade (VOC0104 para VLO0104). Isso é a unificação, e remendar só a exibição é o erro que o Lucas já recusou. O PAN-124 entrega a régua por id (sigla do pai, filhos, chave do grupo) que a unificação vai consumir.

Ordem das fatias:
- F1: régua e cache por carimbo;
- F2: trilha e travas (0192);
- F3: vigia no sweep de notificações (0193);
- F4: chave do grupo (0194);
- F5: proposta, documento e envelope pelo id da divisão (0195);
- F6: painel do coordenador, Board, esteira pública, CACÁ e relatórios pelo id;
- F7: catálogo e lista do Apolo pelo cadastro;
- F8a: rótulos crus;
- F8b: Guardian e CACÁ, com as listas fixas apagadas;
- F9: campos de cadastro que só o C2X tem (0196);
- F10: tela de editar (0197);
- F11: sigla de empreendimento com unidades renomeada no C2X (0198, só na opção B);
- F12: Trazer do C2X numa transação (0199);
- F13: varredura opcional.

Correspondência com o plano aprovado:
- etapa 3 = F1, F4, F5, F6, F7, F8a, F8b e F9;
- etapa 5 = F2, F10, F11 e F12;
- etapa 6 = F3.

Cada fatia é uma versão no changelog, sobe sozinha e deixa o sistema coerente. O código novo tolera a migration ausente, no molde da 0170 em lib/hercules/cadastro.ts:87-160.

Numeração: a 0191 já existe em origin/main (0191_quadro_de_assinatura_sem_heranca.sql). As do PAN-124 vão de 0192 a 0199, e o diretório é conferido antes de criar cada uma (skill migration-supabase §2). 

## Fatia 1: F1 · Régua única do cadastro por id, com cache que se renova pelo carimbo (sem migration)
objetivo: Criar UM lugar que responde, pelo c2x_enterprise_id: nome de mercado, sigla do cadastro, pai, filhos, chave do grupo e os grupos derivados de pai_id. Até a F4, a chave do grupo é o nome do pai; depois, a coluna.

Regras que ficam escritas na régua e testadas:
1. Um pai com c2x_enterprise_id vivo e fora de EXCLUDED_ENTERPRISE_IDS continua entrada simples, e o grupo é ADICIONAL. É o que catalogo-empreendimentos.ts:138-169 faz hoje com o VLO 35 ao lado de 'group:Vale do Ouro'. Absorver o 35 tiraria o nome de 693 CADs no Board e 210 propostas VLO da Venda de 4 contas do portal.
2. O LAB 31 continua fora (EXCLUDED_ENTERPRISE_IDS = [2, 31, 34]).
3. Os filhos saem na ordem (ordem, codigo) do cadastro. É a mesma que o Hércules já usa (lib/hercules/expandir-id-do-painel.ts:52, lib/hercules/empreendimentos.ts:144).

Cache de processo:
- mantém o valor anterior se a leitura falhar;
- confere, no máximo a cada 30 s por instância, count(*) e max(atualizado_em) de hercules_empreendimentos, e relê quando mudam;
- não há mais prazo fixo de 10 min para o cadastro. O gatilho da 0192 mantém atualizado_em em toda edição, inclusive por SQL.

A régua reaproveita mapaDeNomesDeMercado (lib/apolo/nome-de-mercado-por-id.ts:47) e carregarCadastroDeEmpreendimentos (lib/hercules/cadastro.ts:107).

Nenhum leitor troca de fonte nesta fatia, exceto um bug medido: o mapa nome->sigla de modules/guardian/attendance/data.ts:781-792 ('Recanto do Pará' vira RDP, 'Lavra do Ouro' vira LDO, 'Lagoa Bonita' vira LAB). Ele serve de matrícula em :200 quando o servidor manda nula (lib/guardian/attendance.ts:1458) e passa a não inventar sigla.

O painel do coordenador saiu desta fatia e foi inteiro para a F6. Assim ele muda uma vez só.
migrations: []
arquivos: apps/hub/lib/hercules/regua-do-cadastro.ts (novo) + regua-do-cadastro.test.ts; apps/hub/lib/hercules/cadastro-em-cache.ts (novo) + cadastro-em-cache.test.ts; apps/hub/lib/apolo/nome-de-mercado-por-id.ts:47-94 (delegar à régua); apps/hub/modules/guardian/attendance/data.ts:200, :773-792; apps/hub/scratchpad/pan124-paridade-regua.ts (só SELECT); apps/hub/lib/changelog/changelog.ts (entrada 0); apps/hub/lib/roadmap/roadmap.ts:101-107 (evidência do PAN-124)
testes: Testes unitários com o fixture do cadastro de 25/09:
- os ids dos grupos batem como CONJUNTO com ENTERPRISE_GROUPS.ids: LOX {1,4}, PDX {7,10}, RDX {13,14,15}, LAB {27,32,33}, VLO {36,37,41};
- a ordem sai do cadastro. Na Lagoa Bonita é LBF, LBP, LBR (medido em 26/09: ordem 0, 1, 2), diferente da constante LBF, LBR, LBP (c2x-analytics.ts:201);
- '35' sai como entrada simples E o grupo Vale do Ouro também;
- o 31 fica fora;
- o nome de mercado bate com nomeDoEmpreendimentoPorId em 38 de 38;
- o cache devolve o anterior quando a leitura falha, não relê antes de 30 s e relê quando o carimbo muda.

Paridade real, só SELECT:
- régua contra ENTERPRISE_GROUPS.ids, como conjunto: 0 divergências;
- régua contra apolo_enterprise_settings.code por id: 0 divergências (o 30 fica fora, sem cadastro).

Fila de atendimento: listar as linhas cuja matrícula vem nula e mostrar que deixam de receber sigla de outro empreendimento.

Rodar check-types, test e lint (apps/hub/package.json:9-11). Procurar @ts-nocheck nos arquivos tocados.
risco/rollback: Risco baixo. A única mudança visível: a fila de atendimento deixa de mostrar sigla inventada quando a matrícula vem nula.

Rollback: Instant Rollback da Vercel ou revert do commit. Nada muda no banco.
OK do Lucas: Deploy (push na main), com a mensagem pro grupo. 

## Fatia 2: F2 · Trilha e travas do cadastro no banco (0192)
objetivo: Antes de existir tela, o banco passa a registrar toda mudança em hercules_empreendimentos, inclusive SQL manual: quem, quando, antes, depois, motivo e origem.

O banco também passa a recusar o que quebra dados sem erro:
- trocar sigla, pai ou tipo de um empreendimento com movimento no Panteon;
- criar neto, ou seja, pôr sob outro pai quem já tem filhos. O gatilho da 0123:73-87 só confere se o NOVO pai é raiz;
- dar o PRIMEIRO filho a um pai que tem movimento. O catálogo mudaria de forma: um produto simples com unidades, como o JDG 40 com 250 unidades, ganharia uma entrada de grupo;
- trocar c2x_enterprise_id;
- gravar sigla fora do formato de apps/hub/lib/hercules/produto-novo.ts:102.

Há uma saída explícita por sessão (set local) para correção assistida pelo Zeus, com OK do Lucas.

Hoje nenhum fluxo do app faz UPDATE nessa tabela. O 'Novo produto' só faz INSERT e desfaz com DELETE (cadastrar-produto-server.ts:538-566, sem nenhum .update no fluxo). Como INSERT não gera trilha, a FK restrict não atrapalha essa compensação.
migrations: ["0192_o_cadastro_do_empreendimento_tem_trilha.sql. Tudo idempotente.\n\n(a) Tabela hercules_empreendimento_alteracoes:\n- colunas id, workspace_id, empreendimento_id uuid (FK on delete restrict), campo, antes, depois, motivo, autor text, alterado_em;\n- origem, com check in ('tela', 'adocao', 'correcao', 'sql');\n- índice (empreendimento_id, alterado_em desc);\n- RLS ligada, sem policy.\n\n(b) Coluna atualizado_por text.\n\n(c) Gatilho BEFORE UPDATE que acerta atualizado_em e atualizado_por. O autor vem de current_setting('panteon.autor', true); sem ele, fica 'sql:' || current_user.\n\n(d) Gatilho AFTER UPDATE que grava uma linha por campo alterado: nome, codigo, pai_id, cidade, uf, tipo_produto, vendendo, ordem, operado_por e, depois da F9, os campos novos.\n\n(e) Função hercules_movimento_do_empreendimento(uuid) returns jsonb, com as contagens do lado Panteon:\n- hercules_unidades, por enterprise_id e por segmento_id;\n- hercules_propostas, por empreendimento_id E por empreendimento_codigo;\n- hercules_reservas, hercules_masterplans, hercules_documentos, temis_envelopes, temis_trabalhos, prometeu_eventos e lsoft_clientes.\nLeva REVOKE EXECUTE de public, anon e authenticated.\n\n(f) Gatilho de guarda BEFORE UPDATE, salvo current_setting('panteon.permite_correcao_assistida', true) = 'sim':\n- recusa neto;\n- c2x_enterprise_id é imutável;\n- codigo, pai_id e tipo_produto só mudam com movimento zero;\n- se o NOVO pai ainda não tem filhos, ele também precisa de movimento zero.\n\n(g) CHECK codigo ~ '^[A-Z][A-Z0-9]{1,5}$', criado NOT VALID e validado na mesma migration."]
arquivos: packages/database/migrations/0192_o_cadastro_do_empreendimento_tem_trilha.sql; docs/operations/engineering-operations.md (registro da migration, skill §7); apps/hub/scratchpad/pan124-paridade-0192.ts (só SELECT)
testes: Antes de aplicar:
- as 38 linhas passam no CHECK;
- tirar um hash das 38 linhas.

Depois de aplicar (skill §4):
- conferir o schema objeto por objeto;
- relrowsecurity = true;
- get_advisors: rls_enabled_no_policy aparece como INFO, e isso é o esperado.

Prova viva em begin ... rollback:
- update do nome do TST 9001 gera 1 linha de trilha com origem 'sql';
- update da sigla do GDN (404 unidades) é RECUSADO;
- pôr o LAB (pai de LBF, LBP e LBR) sob outro pai é RECUSADO;
- pôr o TST 9001 sob o JDG 40 (com unidades e sem filhos) é RECUSADO;
- com a saída explícita, passa;
- um insert de produto não é afetado e pode ser apagado em seguida;
- depois do rollback, 0 linhas na trilha.

Paridade: o hash das 38 linhas é igual antes e depois.

hercules_movimento_do_empreendimento dá zero para o PDI (43) e o RPS (14), e 404 unidades para o GDN.
risco/rollback: Risco: um gatilho mal escrito bloquear o INSERT de produto novo. Mitigação: os gatilhos são só de UPDATE, e a prova viva exercita insert e delete.

Correção manual futura passa a exigir a saída explícita, documentada no cabeçalho em ATENCAO.

Rollback: drop dos gatilhos, da função e da tabela. O SQL de desfazer vai no cabeçalho.
OK do Lucas: Aplicar a 0192 em produção e rodar a prova viva em begin/rollback. Não há deploy de código; só o registro no diário. 

## Fatia 3: F3 · Vigia do C2X no sweep de notificações, com retrato, silêncio e fechamento (0193)
objetivo: É a etapa 6, trazida para cedo para cobrir o próprio projeto.

**Onde roda.** No sweep de notificações (lib/notifications/sweep.ts:24-31, cron de 15 min), e NÃO no incremental do Apolo. Motivo: o PAN-080 vai desligar /api/apolo/sync/c2x/incremental (roadmap.ts:808-815). Duas leituras:
1. Evento, a cada rodada: audits com id > cursor e auditable_type = 'Enterprise'. É uma consulta leve por faixa de id; o cursor é max(ultima_auditoria_id) do retrato.
2. Estado, 1 vez por dia, na janela e com a porteira de sweepHadesCriticalDigest (sweep.ts:202-240).

**O que compara:**
(a) o C2X contra o RETRATO que o Panteon já viu (nome, sigla, cidade, UF e, depois da F9, os campos do legado), e nunca o nome do C2X contra o do Panteon, que diferem de propósito em 18 de 34;
(b) id vivo no C2X sem cadastro;
(c) coerência interna do Panteon: o prefixo de hercules_unidades.codigo contra a sigla do cadastro do empreendimento onde a linha mora. Quando houver segmento_id, vale o segmento, já pensando na unificação. Para id sem cadastro, compara com a sigla do C2X;
(d) sigla do cadastro contra a sigla do C2X do mesmo id. É alarme ou 'divergência aceita', conforme a pergunta 1 (coluna no retrato).

**Silêncio.** Quando o valor novo do C2X, normalizado, já é igual ao do cadastro ou a um valor da trilha, o retrato só se atualiza e não vira aviso. É a Nívea acompanhando no legado o que mudou no Panteon.

**Um aviso por id.** Os motivos do mesmo id viram um alerta só. O fingerprint é 'cadastro-c2x:<id>:<motivos e valores ordenados>'.

**Notificação.** Só quando o protocolo NASCE (occurrence_count = 1 depois de syncOperationAlertProtocols, alert-protocols.ts:168-225) ou quando o retrato muda. O motivo: publishHubNotification não tem dedup (publish.ts:64-104).

**Fechamento.** Quando a checagem diária acha os dois lados iguais, ou a divergência aceita, fecha o protocolo como 'tratado' por updateOperationAlertFeedback (alert-protocols.ts:249-300), com o texto 'fechado pelo vigia'.

**Nomes anteriores.** O retrato guarda os nomes anteriores do C2X. A F6 usa isso para manter os links antigos do painel.
migrations: ["0193_o_retrato_do_c2x_que_o_panteon_ja_viu.sql. Idempotente.\n\nTabela hercules_empreendimentos_c2x_retrato:\n- workspace_id;\n- enterprise_id text PK (o id do C2X);\n- codigo, nome, cidade, uf;\n- nomes_anteriores text[] default '{}' e siglas_anteriores text[] default '{}';\n- sigla_divergente_aceita boolean default false;\n- prefixos_divergentes int;\n- ultima_auditoria_id bigint;\n- visto_em timestamptz.\n\nRLS ligada, sem policy. Aceita ids sem cadastro (2, 30, 34).\n\nO primeiro preenchimento vem do estado atual do C2X, para as 18 diferenças intencionais de nome não virarem alarme."]
arquivos: apps/hub/lib/apolo/vigia-do-cadastro.ts (novo, puro) + vigia-do-cadastro.test.ts; apps/hub/lib/apolo/vigia-do-cadastro-servidor.ts (novo); apps/hub/lib/notifications/sweep.ts:24-31, :202-240, :292; apps/hub/lib/notifications/publish.ts:64; apps/hub/lib/operations/monitoring.ts:16-26 (tipo 'cadastro_divergente'; alert_type é text); apps/hub/lib/operations/alert-protocols.ts:168-225, :249-300; apps/hub/lib/guardian/c2x-analytics.ts:36-63 (lista única dos ids de teste do C2X: 2 e 34); apps/hub/scratchpad/pan124-vigia-ensaio.ts (só SELECT); packages/database/migrations/0193_o_retrato_do_c2x_que_o_panteon_ja_viu.sql
testes: Testes unitários com fixtures reais:
- a auditoria 34214 (43: RDV para PDI) gera 1 alerta com 2 motivos (sigla e nome);
- o renome do 42 gera só o de nome;
- um renome no C2X igual ao valor do cadastro não gera alerta e só atualiza o retrato;
- o protocolo fecha quando os lados batem;
- a notificação sai só no nascimento do protocolo;
- a metadata nunca leva o JSON cru da auditoria (o SQL lê só json_extract de $.name, $.code e $.city_id).

Ensaio real, só leitura. Esperado 1 aviso, sobre o id 30, com 2 motivos: sem cadastro, e 31 de 31 hercules_unidades com ADT contra ACT no C2X. Também esperado:
- 2 e 34 ignorados;
- TST 9001 ignorado pela marca 'ZZ ' (lib/assinatura/clicksign/envelope.ts:1050-1052);
- 0 avisos de sigla, cidade ou UF.

Custo:
- rodada sem auditoria nova: 1 consulta por faixa de id no C2X;
- checagem diária: 37 empreendimentos, mais os nomes de 5.574 unidades do C2X e das 5.541 do Panteon, paginadas pelo teto de 1.000 do PostgREST.

A varredura do vigia fica em try/catch próprio e devolve 0 se falhar, porque o sweep junta as varreduras num Promise.all (sweep.ts:31).
risco/rollback: Riscos e mitigações:
- Ruído: coberto pelo retrato, pelo silêncio, por um aviso por id e pela notificação só no nascimento.
- Derrubar as outras varreduras do sweep: coberto pelo try/catch próprio e por um orçamento de tempo.
- Dado pessoal: coberto pelo json_extract.
- O cron aceita x-vercel-cron forjável (reference_cron_x_vercel_cron_spoofavel). Forjar só antecipa uma rodada idempotente.

Rollback: revert do código. A tabela fica e não afeta nada.
OK do Lucas: Aplicar a 0193 e fazer o deploy. Confirmar o aviso que o bootstrap vai gerar: 1, sobre o 30, com 2 motivos. Registrar no PAN-080 que o vigia lê audits pelo sweep, e não pelo incremental. 

## Fatia 4: F4 · A chave do grupo não é o nome (0194)
objetivo: O id 'group:<Nome>' está gravado em 25 lugares:
- settings 2, esteira 2 (conferido em 26/09: 'group:Lagoa Bonita' = 2), cad_log_erros 2;
- temis_assinantes 1;
- apolo_relationships.metadata 10;
- apolo_entities.metadata 8.

A fatia congela a chave numa coluna e troca TODO leitor que monta ou casa 'group:' com o nome editável do pai. A F4 começa pelo grep. Medido em 26/09:

Montam 'group:' + nome:
- lib/temis/dados-do-contrato.ts:1453-1455 (escopoDaVenda :1422, que decide em :1321 qual CAD é desta venda);
- lib/apolo/catalogo-empreendimentos.ts:151;
- lib/apolo/empreendimentos.ts:1344;
- lib/temis/cadeia-do-contrato.ts:265 e :412.

Casam pelo nome:
- lib/apolo/c2x-pelo-id.ts:169-188 e :232;
- lib/apolo/c2x-pelo-id-servidor.ts:242;
- lib/apolo/coordenador-do-empreendimento.ts:133-161, inclusive a reserva por ENTERPRISE_GROUPS em :152-161;
- lib/apolo/habilitacao-pelo-cadastro.ts:122, pelo mesmo idsDoC2xDoPedido.

Usa o texto do id como nome: lib/temis/trabalho-servico.ts:789. Passa a mostrar o nome atual do pai, achado pela chave.

Não casam pelo nome (conferidos, ficam):
- lib/temis/alcance-da-estrutura.ts:114 e :211;
- lib/temis/estrutura-servico.ts:394, :485, :598 e :1782 (resolvem pelo código);
- lib/hercules/estoque-da-situacao.ts:182;
- lib/apolo/incorporador/operacao-do-produto.ts:162 e operacao-do-produto-servidor.ts:126.

Nenhum id gravado muda.
migrations: ["0194_a_chave_do_grupo_nao_e_o_nome.sql. Idempotente.\n\n- Coluna chave_do_grupo text.\n- Backfill das 5 raízes com filhos: LOX 'Lavra do Ouro', RDX 'Rio de Pedras', PDX 'Portal dos Vales', LAB 'Lagoa Bonita' e VLO 'Vale do Ouro'. As 5 são idênticas a ENTERPRISE_GROUPS.display (c2x-analytics.ts:197-212).\n- Índice único parcial (workspace_id, lower(chave_do_grupo)) where not null.\n- Gatilho que recusa alterar a chave depois de preenchida, salvo a saída explícita da 0192.\n- Um grupo novo recebe a chave com o nome do pai no dia do primeiro filho, dentro da função da 0197.\n- comment on column: 'NÃO É O NOME'."]
arquivos: packages/database/migrations/0194_a_chave_do_grupo_nao_e_o_nome.sql; apps/hub/lib/hercules/cadastro.ts:40-160 (coluna nova, tolerando a ausência); apps/hub/lib/hercules/empreendimentos.ts (tipo LinhaDeEmpreendimento); apps/hub/lib/hercules/regua-do-cadastro.ts; apps/hub/lib/temis/dados-do-contrato.ts:1422-1457; apps/hub/lib/apolo/c2x-pelo-id.ts:169-188, :232; apps/hub/lib/apolo/c2x-pelo-id-servidor.ts:242; apps/hub/lib/apolo/coordenador-do-empreendimento.ts:133-161; apps/hub/lib/apolo/habilitacao-pelo-cadastro.ts:122; apps/hub/lib/temis/cadeia-do-contrato.ts:265, :412; apps/hub/lib/temis/trabalho-servico.ts:789; apps/hub/lib/apolo/catalogo-empreendimentos.ts:151; apps/hub/lib/apolo/empreendimentos.ts:1344; apps/hub/lib/apolo/esteira-cad.ts:227-281; testes vizinhos (c2x-pelo-id.test.ts, coordenador-do-empreendimento.test.ts, teste novo de escopoDaVenda); apps/hub/scratchpad/pan124-paridade-grupo.ts (só SELECT)
testes: Paridade real, só SELECT. Para cada um dos 25 ids 'group:' gravados, estas leituras devolvem exatamente o mesmo conjunto antes e depois:
- divisoesDoGrupo;
- idsDoC2xDoPedido;
- o alias da Têmis;
- escopoDaVenda, para as vendas da Lagoa Bonita, incluindo as 2 CADs 'group:Lagoa Bonita'.

Conferir letra a letra que as 5 chaves batem com as strings gravadas.

Testes unitários: renomear o pai no fixture não muda as divisões, o escopo da venda, o alias da Têmis nem o rótulo de trabalho-servico, que passa a ser o nome novo.

Prova viva em begin/rollback: alterar a chave do LAB é recusado.
risco/rollback: Risco: a grafia da chave diferir da gravada. A prova compara com as strings gravadas, e normalizar() ignora caixa e acento.

Rollback: revert do código. Enquanto ninguém renomear um pai, o nome ainda é igual à chave. A coluna fica.
OK do Lucas: Aplicar a 0194 (inclui a escrita de 5 linhas) e fazer o deploy. 

## Fatia 5: F5 · Proposta, documento e envelope sabem o id da divisão (0195)
objetivo: Tirar de 5 leituras do portal o filtro pela sigla gravada (.in('empreendimento_codigo', codes)):
- apps/hub/app/api/incorporador/venda/route.ts:254;
- venda/historico/route.ts:104;
- lib/apolo/incorporador/assinaturas.ts:1408;
- lib/apolo/incorporador/imobiliarias-do-produto.ts:467;
- lib/apolo/incorporador/documentos.ts:297.
Hoje os codes vêm do catálogo ao vivo do C2X (escopo.ts:78-95). No próximo renome lá, as propostas antigas somem da Mesa sem erro.

**Fonte do id.** Vem da UNIDADE. Medido em 26/09: 100% das 4.946 propostas, dos 51 documentos e dos 24 envelopes têm unidade_id. Onde há cadastro, hercules_unidades.enterprise_id bate com o id da sigla em 100% dos casos. Não se usa lista fixa de siglas.

**Escritor dos envelopes.** Hoje grava a SIGLA: lib/assinatura/envio-db.ts:258 (enterpriseId: preparo.identidade.empreendimento) e :777 (insert). Medido em 26/09: 8 de 24 envelopes com sigla (VOC 2, VOL 5, VOR 1), 3 deles nascidos em 25/09. O escritor passa a gravar o id da divisão.

**Unificação.** Quando a unidade tiver segmento_id, o id da divisão é o c2x_enterprise_id do segmento. Assim o gatilho continua certo depois da unificação.
migrations: ["0195_a_proposta_sabe_o_id_da_divisao.sql. Idempotente.\n\n- Coluna enterprise_id text em hercules_propostas e em hercules_documentos, com o significado de 'id da DIVISÃO'. Não é o uuid do pai, que continua em empreendimento_id. O comment on column diz isso.\n- Índices (workspace_id, enterprise_id, etapa) e (workspace_id, enterprise_id).\n- Gatilho BEFORE INSERT OR UPDATE OF unidade_id, empreendimento_codigo em hercules_propostas e hercules_documentos. Quando enterprise_id vier nulo, preenche nesta ordem:\n  1. pela unidade: o c2x_enterprise_id do segmento_id, se houver; senão, hercules_unidades.enterprise_id;\n  2. pelo cadastro (codigo para c2x_enterprise_id), só como reserva.\n- Gatilho BEFORE INSERT OR UPDATE em temis_envelopes: enterprise_id não numérico com unidade_id vira o id pela unidade. É o cinto de segurança enquanto o escritor antigo existir.\n\nArquivo de dados .dados.sql:\n- backfill por join em unidade_id, com a sigla só de reserva. Aplicado DEPOIS do deploy que conserta envio-db.ts:258/:777;\n- as contagens são refeitas na hora de aplicar."]
arquivos: packages/database/migrations/0195_a_proposta_sabe_o_id_da_divisao.sql; packages/database/migrations/0195_a_proposta_sabe_o_id_da_divisao.dados.sql (padrão de 0178_desconto_do_plano.dados-garden.sql); apps/hub/app/api/incorporador/venda/route.ts:93, :247-262; apps/hub/app/api/incorporador/venda/historico/route.ts:104; apps/hub/lib/apolo/incorporador/assinaturas.ts:1401-1408; apps/hub/lib/apolo/incorporador/imobiliarias-do-produto.ts:443-467; apps/hub/lib/apolo/incorporador/documentos.ts:297; apps/hub/app/api/incorporador/venda/proposta/route.ts:311-328, :1468, :2019 (gravar enterprise_id); escritores de hercules_documentos (grep por insert em hercules_documentos); apps/hub/lib/assinatura/envio-db.ts:258, :777; apps/hub/lib/apolo/incorporador/escopo.ts:78-140 (devolver também os ids das divisões do escopo); apps/hub/lib/hercules/banco-em-memoria.para-teste.ts e os testes das rotas de venda e do envio; apps/hub/scratchpad/pan124-paridade-propostas.ts (só SELECT)
testes: Antes e depois, só SELECT:
- a contagem por empreendimento_codigo é igual à contagem pelo enterprise_id mapeado (recontar; 26/09: 4.946 propostas e 51 documentos);
- 0 nulos;
- 0 envelopes com sigla;
- as 49 propostas órfãs dão 30, 2 e 34 pela unidade;
- cruzar com hercules_unidades: 0 divergências.

Paridade de tela: para cada sessão real do portal (apolo_incorporador_empreendimentos, só leitura) e cada empreendimento, o conjunto de ids de proposta devolvido pelo filtro velho e pelo novo é IDÊNTICO nas 5 leituras.

Na transição, o leitor usa: enterprise_id in (ids) OU (enterprise_id nulo E empreendimento_codigo in codes).

Testes unitários:
- a proposta nativa nasce com enterprise_id;
- o envelope novo nasce com o id, e não com a sigla;
- a paginação (teto de 1.000) continua;
- .in() segue em lotes de 100.

Revisão adversarial antes do deploy.
risco/rollback: Risco: uma proposta sumir da Mesa se o backfill errar. O OR com a sigla segura a transição, e a prova é feita por conjunto de ids.

Rollback: revert do código, que volta ao filtro por sigla. As colunas e os gatilhos ficam e não afetam nada. O SQL de desfazer vai no cabeçalho.
OK do Lucas: Aplicar a 0195, fazer o deploy (conserto do escritor e leitores com OR) e depois aplicar o .dados.sql. É escrita em cerca de 4.950 propostas, 51 documentos e 8 envelopes. 

## Fatia 6: F6 · Painel do coordenador, Board, esteira pública, CACÁ e relatórios comparam id, não nome (sem migration)
objetivo: **Painel do coordenador (público, app/publico/painel/page.tsx:20-22).** Hoje o empreendimento é achado pelo slug do nome do C2X:
- painel-coordenador.ts:252-260 monta o slug;
- page.tsx:95 monta ?emp=;
- app/publico/cads/[empreendimento]/page.tsx:19 redireciona para lá;
- acharEmpreendimento cai em lista[0] sem erro (:283-289).
Se o nome trocar de fonte (F7) ou for renomeado (F10), o link salvo abre OUTRO empreendimento, com nomes de cliente. O que muda:
- ?emp= passa a aceitar o id do empreendimento ou do grupo;
- os links antigos continuam valendo por apelido derivado, sem lista fixa: slug do nome atual e dos anteriores do C2X (retrato da F3), do nome do Panteon e dos nomes antigos da trilha (0192), e do rótulo gravado para ids sem C2X, como hoje (:250-253);
- slug que não casa mostra o seletor, nunca lista[0];
- agrupa pelos 5 grupos do cadastro (pai_id), e não só pelo Vale do Ouro de GRUPOS_C2X (:30-34);
- resolve 'group:*' pela chave. Hoje é descartado por Number() em :204-205 e :225-226 (2 CADs e 10 vínculos da Lagoa Bonita);
- o nome exibido é o de mercado do pai, sem sufixo de divisão;
- carregarNomes (:110-134) passa a ler a régua.

**Os demais leitores que usavam o nome como chave:**
- seletor e recorte do Board: board-do-servidor.ts:603-626, :862-869, :1008-1029; board-do-portal.ts:215;
- resumo público de CADs e a tool da CACÁ: cads-publico-resumo.ts:46, :135 e executors.ts:962;
- relatório diário às imobiliárias: relatorio-imobiliaria.ts:121, que alimenta relatorio-diario/route.ts:53-88;
- rotas do Asana: comparativo/route.ts:79, :92 e diagnostico/route.ts:101;
- soma de vendas por displayEnterprise: c2x-analytics.ts:929-947, que alimenta executors.ts:317-333;
- termo livre: c2x-analytics.ts:659 e c2x-builder.ts:177, :302;
- agrupamento das CADs na CACÁ: cad-source.ts:85-92.
O termo é resolvido contra o cadastro (nome ou sigla, sem acento) em ids, com grupo e divisões, e tudo passa pelo canonizador (empreendimento-equivalencia.ts:48). O texto fica só de reserva quando o termo não resolve.

**Fora do escopo, conferido.** Os .eq('empreendimento') de boletos_parcelas, boletos_documentos e lsoft_* (app/api/incorporador/boletos/route.ts:651, lib/apolo/boletos/documentos.ts:36, lib/lsoft/classificacao.ts:140) casam a chave própria dessas tabelas, e não o nome do cadastro.
migrations: []
arquivos: apps/hub/lib/apolo/painel-coordenador.ts:30-34, :94, :110-134, :178-289; apps/hub/app/publico/painel/page.tsx:95, :188-224; apps/hub/app/publico/cads/[empreendimento]/page.tsx:19; apps/hub/lib/apolo/board-do-servidor.ts:603-626, :712, :862-869, :1008-1029; apps/hub/lib/apolo/incorporador/board-do-portal.ts:215; apps/hub/lib/apolo/cads-publico-resumo.ts:10-17, :46, :135; apps/hub/lib/apolo/relatorio-imobiliaria.ts:119-121; apps/hub/app/api/apolo/asana/comparativo/route.ts:74-92; apps/hub/app/api/apolo/asana/diagnostico/route.ts:96-101; apps/hub/lib/iris/caca/executors.ts:317-333, :962; apps/hub/lib/guardian/c2x-analytics.ts:659, :929-947; apps/hub/lib/analytics/c2x-builder.ts:177, :302; apps/hub/lib/analytics/cad-source.ts:85-92; apps/hub/lib/apolo/empreendimento-equivalencia.ts:48; apps/hub/scratchpad/pan124-paridade-painel-e-board.ts (só SELECT)
testes: Painel, paridade real só com SELECT. Para cada slug que listarEmpreendimentos devolve hoje, o painel novo abre o empreendimento que contém os MESMOS ids, nas 4 abas (CAD, imobiliárias, assinatura e sinal; page.tsx:188-224).

As únicas diferenças aceitas são ids da mesma família que passam a somar, listados com as contagens. Por exemplo:
- VOR 41: 1 CAD e 1 vínculo; no C2X, 4 pedidos e 3 contratos; no Panteon, 5 propostas e 1 envelope;
- as divisões de Lavra, Portal, Rio de Pedras e Lagoa Bonita;
- os 'group:Lagoa Bonita'.
Recontar na hora.

Outros casos do painel:
- ?emp=lagoa-bonita abre o grupo Lagoa Bonita, e não o LAB 31;
- ?emp=residencial-villa-paris continua abrindo o 38;
- um slug inexistente mostra o seletor.

Demais leitores:
- Board: para cada recorte real do portal e cada opção do seletor, o mesmo conjunto de cards;
- resumo de CADs: para os 37 empreendimentos, pedido nas duas grafias, a contagem nova é maior ou igual à velha, com as diferenças listadas;
- relatório de imobiliária: 'Residencial Villa Paris' e 'Villa Paris' devolvem as mesmas 64 CADs do 38;
- Asana, comparativo e diagnóstico: as mesmas linhas;
- CACÁ: as mesmas somas por grupo;
- termo livre: 'Recanto do
risco/rollback: Risco: um card ou CAD sumir de um filtro. A prova é por conjunto de ids, e a linha sem enterprise_id cai no texto, como hoje.

O link do painel passa a mostrar o empreendimento inteiro onde antes mostrava uma divisão. Isso é o que a regra manda, e é anunciado.

Rollback: revert.
OK do Lucas: Deploy, com a mensagem pro grupo: o painel do coordenador passa a mostrar o empreendimento inteiro (Lavra do Ouro, Portal dos Vales, Rio de Pedras, Lagoa Bonita e Vale do Ouro com o VOR), e os links antigos continuam valendo. 

## Fatia 7: F7 · Catálogo e lista do Apolo tiram nome e grupo do cadastro (coração da etapa 3, sem migration)
objetivo: **Catálogo** (lib/apolo/catalogo-empreendimentos.ts:106-172):
- agrupa pela régua da F1, não mais pela sigla (:131-141);
- name = nome do cadastro em caixa alta (:29);
- id do grupo = 'group:' + chave_do_grupo (F4), idêntico ao de hoje;
- o VLO 35 continua entrada simples ao lado do grupo, e o 31 continua fora;
- codes e stageIds continuam vindo do C2X pelo id;
- os filhos seguem a ordem do cadastro. A única mudança de ordem é a Lagoa Bonita: LBF, LBP, LBR, a mesma do Hércules.

**Lista do Apolo** (lib/apolo/empreendimentos.ts:305-322, :1288-1358, :1396-1409):
- nome, cidade, UF e grupo pelo cadastro, casados pelo id;
- o espelho é achado pelo id (MIRROR_ENTERPRISE_IDS, c2x-analytics.ts:152-155);
- o VLO continua com o id 35;
- toda linha passa a levar panteonId, o uuid do hercules_empreendimentos, inclusive as linhas 'group:*' de LOX, PDX, RDX e Lagoa Bonita. É a porta da F10.

Reserva: um id do C2X sem cadastro (30) continua com o nome do C2X. Sem o cadastro, vale o último valor bom do cache.

O painel do coordenador saiu desta fatia; foi para a F6.
migrations: []
arquivos: apps/hub/lib/apolo/catalogo-empreendimentos.ts:29, :96-172; apps/hub/lib/apolo/empreendimentos.ts:305-385, :1288-1358, :1396-1409; apps/hub/app/api/apolo/empreendimentos/route.ts:31-51; apps/hub/lib/apolo/catalogo-empreendimentos.test.ts e catalogo-empreendimentos.pelo-id.test.ts; apps/hub/lib/apolo/c2x-pelo-id-servidor.catalogo-real.test.ts; apps/hub/scratchpad/pan124-paridade-catalogo.ts (só SELECT)
testes: Paridade real do catálogo, para os 37 ids do C2X, antes e depois:
- os mesmos ids de entrada, inclusive '35' e 'group:Vale do Ouro';
- os mesmos codes e stageIds como CONJUNTO;
- a ordem muda só na Lagoa Bonita (listada);
- só 4 nomes diferentes: 20, 28, 38 e 42.

Lista do Apolo:
- as mesmas linhas e os mesmos números de cenário;
- nomes diferentes só em 20, 28, 31, 38 e 42;
- panteonId presente em 100% das linhas com cadastro.

codigosDaSessao (escopo.ts:78) dá o mesmo conjunto para todas as sessões reais.

A chave de cache da Vendas que depende da ordem (expandir-id-do-painel.ts:32-37) só perde uma vez o cache da Lagoa Bonita.

Revisão adversarial antes do deploy: varrer todo consumidor de catalogo.name (reference_camada_nova_exige_varrer_leitores).
risco/rollback: Risco médio: o catálogo tem cerca de 30 consumidores. A F6 já tirou os que comparam texto, e a revisão varre o resto.

Rollback: revert do commit. Só há código.
OK do Lucas: Deploy, com a mensagem pro grupo dizendo os nomes que mudam na tela (REP, VDP, RVP, ACP e LAB) e a ordem nova das glebas da Lagoa Bonita. 

## Fatia 8: F8a · Rótulos crus do C2X nas telas e PDFs do Apolo e do portal (sem migration)
objetivo: Trocar e.name e divulgation_name pelo nome de mercado lido pelo id (régua da F1). O nome do C2X fica de reserva só para os ids sem cadastro.

Pontos:
- linha do tempo: timeline.ts:162, :257;
- histórico do portal: historico.ts:206, :250;
- PDF do dossiê: hades/dossie/dados.ts:187;
- grafo da imobiliária: server.ts:1513-1530 (o SELECT passa a trazer e.id);
- carteira: carteira.ts:278;
- extrato: extrato.ts:186-187;
- PDF do extrato do cliente: extrato-cliente-c2x.ts:168-169;
- seletor do painel de contratos: painel-contratos.ts:203-232. O cache de 30 min (:63) passa a usar o cadastro em cache, renovado pelo carimbo;
- seletor da gestão: gestao.ts:145-153;
- importador de unidades: cadastrar-unidades-server.ts:50-53. Muda só o rótulo;
- vitrine e Setup do Prometeu: credenciamento.ts:179, :194; publico/cad/dados.ts:482, :542-548; imobiliaria-cadastro.ts:25; app/api/prometeu/empreendimentos/route.ts:4;
- aviso ao coordenador: disparo-credenciamento.ts:176-183;
- nome que a CACÁ fala ao cliente: executors.ts:677-718, :815-861.

A CAD nova passa a nascer com o nome de mercado ('Villa Paris'). Isso só é seguro DEPOIS da F6, que tirou o relatório às imobiliárias e as rotas do Asana do ILIKE sobre esse texto.
migrations: []
arquivos: apps/hub/lib/apolo/timeline.ts:162, :257; apps/hub/lib/apolo/incorporador/historico.ts:206, :250; apps/hub/lib/hades/dossie/dados.ts:187; apps/hub/lib/apolo/server.ts:1513-1530; apps/hub/lib/apolo/carteira.ts:278; apps/hub/lib/apolo/extrato.ts:186-187; apps/hub/lib/apolo/extrato-cliente-c2x.ts:168-169; apps/hub/lib/apolo/assinaturas/painel-contratos.ts:63, :203-232; apps/hub/lib/apolo/incorporador/gestao.ts:145-153; apps/hub/lib/apolo/cadastrar-unidades-server.ts:50-53; apps/hub/lib/apolo/credenciamento.ts:179, :194; apps/hub/lib/publico/cad/dados.ts:482, :542-548; apps/hub/lib/apolo/imobiliaria-cadastro.ts:25; apps/hub/app/api/prometeu/empreendimentos/route.ts:4; apps/hub/lib/apolo/disparo-credenciamento.ts:176-183; apps/hub/lib/iris/caca/executors.ts:677-718, :815-861
testes: Paridade: para cada tela e PDF, os mesmos registros antes e depois (mesma contagem e mesmos ids).

Só o texto do empreendimento muda, e só para:
- os ids 20, 28, 31, 38 e 42;
- as grafias de divulgação (MLN; RDP, RPS e RPC; EDL; 2 glebas da Lagoa Bonita).

Gerar localmente o dossiê e o extrato em PDF de um cliente do TST 9001 e comparar campo a campo.

Testes unitários de cada mapeador com o fixture do cadastro.
risco/rollback: PDFs e mensagens NOVOS saem com o nome do Panteon; os já gerados não mudam.

Rollback: revert.
OK do Lucas: Deploy. 

## Fatia 9: F8b · Guardian e CACÁ agrupam pelo id e rotulam pelo cadastro; ENTERPRISE_GROUPS e ENTERPRISE_MIRRORS são apagadas (sem migration)
objetivo: **Como o Guardian agrupa hoje** (conferido em lib/guardian/overview.ts:305-320):
- LOU e LOS viram 'Lavra do Ouro';
- PDV e PVS viram 'Portal dos Vales';
- RDP, RPS e RPC viram 'Rio de Pedras';
- VOC, VOL e VOR caem no else com o mesmo e.name 'VALE DO OURO', e o GROUP BY enterprise_name os funde (:443, :461, :492-495, :513);
- só as glebas da Lagoa Bonita ficam separadas ('Lagoa Bonita - LBF', :312).
O snapshot corrente de c2x_guardian_enterprise_performance tem 18 linhas.

**Regra nova, com a MESMA partição:**
- agrupa pelo PAI no cadastro (id) em LOX, PDX, RDX e VLO;
- mantém a quebra por gleba só na Lagoa Bonita, escrita no código pelo id do pai e não pela sigla;
- o rótulo vem do cadastro. 'Lagoa Bonita · LBF' gera o mesmo slug lagoa-bonita-lbf.

A mesma regra vale para:
- lib/guardian/attendance.ts:177-192, usado em :356 e :542;
- lib/apolo/server.ts:361-375, que é só reserva.

displayEnterprise (c2x-analytics.ts:229-252) recebe os grupos da régua. Os chamadores já são async: c2x-analytics.ts:514, :694, :851; c2x-builder.ts:272-303; query-panteon.ts:180; painel-de-produtos.ts:180; esteira-cad.ts:227.

**Listas fixas.** Ao fim da fatia, ENTERPRISE_GROUPS e ENTERPRISE_MIRRORS são APAGADAS, como combinado em 14/09 (reference_apolo_cadastra_hercules_vende). Antes, o grep lista e converte todo consumidor. O espelho passa a ser 'pai com c2x_enterprise_id próprio e com filhos' (VLO 35 e LAB 31).

Ficam:
- ENTERPRISE_SUB_ALIASES, reduzida a apelido->id, porque é vocabulário de busca; code e label saem da régua;
- EXCLUDED_ENTERPRISE_IDS, porque é filtro de leitura do legado.

**Partida a frio sem o cadastro.** A tela avisa 'agrupamento indisponível' e lista pelo id do C2X, sem cair numa lista velha e sem esconder a cobrança.

**read-model-sync.ts:214** grava enterprise_group_key estável pelo id. Nenhuma leitura usa essa coluna; lib/guardian/read-model.ts:126-130 lê só o snapshot corrente.
migrations: []
arquivos: apps/hub/lib/guardian/overview.ts:305-320, :443-532, :690-714, :774-821; apps/hub/lib/guardian/attendance.ts:177-192, :356, :542; apps/hub/lib/apolo/server.ts:361-375, :2006; apps/hub/lib/guardian/c2x-analytics.ts:152-155, :195-252, :514, :694, :851; apps/hub/lib/analytics/c2x-builder.ts:272-303; apps/hub/lib/analytics/query-panteon.ts:180; apps/hub/lib/apolo/incorporador/painel-de-produtos.ts:180; apps/hub/lib/apolo/esteira-cad.ts:227; apps/hub/lib/apolo/empreendimentos.ts:1292-1338 (espelho pelo cadastro); apps/hub/lib/guardian/read-model-sync.ts:214; todo consumidor restante de ENTERPRISE_GROUPS e ENTERPRISE_MIRRORS (grep no início da fatia); apps/hub/lib/guardian/c2x-analytics.test.ts; apps/hub/scratchpad/pan124-paridade-guardian.ts (só SELECT)
testes: Paridade real sobre o snapshot corrente do Guardian:
- as MESMAS 18 linhas;
- as mesmas somas de carteira, vencido e recuperação por linha;
- os rótulos que mudam, listados.
Se o número de linhas mudar, a prova falha. Ela não é ajustada ao número novo.

Fila de atendimento: as mesmas linhas e a mesma partição.

CACÁ, vendas por empreendimento: as mesmas somas.

Depois de apagar as constantes, check-types prova que não sobrou import. O teste 'semente = fixture' não existe mais; entra a paridade contra o banco no scratchpad.

Revisão adversarial antes do deploy.
risco/rollback: Risco: a partição mudar sem querer, porque o CASE escolhia divulgation_name ou name conforme o ponto. A prova é de partição e soma, não de texto.

Rollback: revert do commit, que devolve as constantes.
OK do Lucas: Deploy. 

## Fatia 10: F9 · Os campos de cadastro que só o C2X tem vêm para o Panteon (0196)
objetivo: Duas regras do Lucas pedem isto:
- 21/09 (feedback_cadastro_do_empreendimento_no_banco): 'todos os dados de cadastro do empreendimento tem que estar dentro do banco; se não tiver, criar as tabelas e fazer a importação';
- 18/09 (feedback_c2x_so_financeiro_via_carteira): nenhuma tela nova lê o C2X ao vivo.
Não há item no roadmap para esses campos: grep em roadmap.ts por divulga, entrega, PRICE, SACOOC, focal e captador não achou nada. Eles entram no PAN-124.

**Colunas no cadastro:**
- nome de divulgação;
- previsão de entrega;
- tipo do empreendimento no C2X;
- os players como ENTIDADES do Apolo (incorporador, gerente e captador), casados por apolo_source_links 'c2x/users/<id>', como faz lib/temis/dados-do-contrato.ts:1459, e nunca pelo nome.

Contato focal: vira vínculo a uma entidade quando ela existe; senão, fica como pendência. Telefone e e-mail nunca são copiados para coluna.

**Ficam fora:**
- a tabela PRICE/SACOOC, que é dado financeiro e fica na carteira;
- os planos, que já têm duas fontes e item próprio.

**Importação única.** Script no scratchpad: primeiro o ensaio, depois a escrita com OK, em lotes, conferindo o error de cada escrita e gravando trilha com origem 'adocao'.

**Depois:** o Panteon é o dono e NÃO há sync. O PAN-080 vai desligar os syncs não financeiros. O vigia (F3) passa a comparar esses campos com o retrato.

Prioridade: players e previsão de entrega, que alimentam documento e regra. Os leitores ao vivo desses campos que alimentam documento passam a ler o cadastro; os demais ficam listados na evidência.
migrations: ['0196_os_campos_do_legado_moram_no_cadastro.sql. Idempotente.\n\n- Colunas em hercules_empreendimentos: nome_de_divulgacao text, previsao_de_entrega date, tipo_no_c2x text, incorporador_entity_id uuid, gerente_entity_id uuid, captador_entity_id uuid, contato_focal_entity_id uuid. As FKs vão para apolo_entities com on delete set null.\n- A 0192 é estendida (create or replace do gatilho de trilha) para registrar esses campos.\n- Nenhum dado é escrito na migration; a importação é um passo à parte, com OK.']
arquivos: packages/database/migrations/0196_os_campos_do_legado_moram_no_cadastro.sql; apps/hub/lib/hercules/cadastro.ts (colunas novas, tolerando a ausência); apps/hub/lib/hercules/regua-do-cadastro.ts; apps/hub/scratchpad/pan124-importar-campos-do-legado.ts (ensaio só SELECT; escrita só com OK); leitores ao vivo de divulgation_name, expected_delivery_date e dos players que alimentam documento (grep no início da fatia); apps/hub/lib/apolo/vigia-do-cadastro.ts (campos novos no retrato); apps/hub/lib/roadmap/roadmap.ts:101-107
testes: Ensaio, só SELECT: por id, o que seria gravado, mostrando só ids de entidade e datas, nunca dado pessoal. Mais:
- a contagem de players do C2X sem entidade correspondente, que vira pendência;
- 0 casamentos pelo nome.

Depois da importação:
- contagens por coluna;
- a trilha registra origem 'adocao'.

Paridade: um documento gerado localmente para o TST 9001 sai igual antes e depois, ou só com os campos que antes vinham vazios.
risco/rollback: Risco: ligar a entidade errada a um player. Coberto pelo casamento só por apolo_source_links, e pela revisão do ensaio antes da escrita.

Rollback: revert do código. As colunas ficam, e a importação se desfaz pela trilha.
OK do Lucas: Aplicar a 0196, depois a importação (escrita em produção, com OK próprio), depois o deploy. 

## Fatia 11: F10 · Tela de editar o cadastro do empreendimento (etapa 5, 0197)
objetivo: ESPERA A PERGUNTA 1 (quem manda na sigla). O resto da tela não depende dela.

**Porta.** GET e PATCH pelo uuid do hercules_empreendimentos, vindo do panteonId que a lista leva desde a F7. Isso inclui os pais que só existem como linha 'group:*' (LOX, PDX, RDX e Lagoa Bonita; empreendimentos.ts:1344).

**Onde fica.** Aba Cadastro da ficha (EnterpriseDetail, empreendimentos-view.tsx:731; aba em :847):
- em cima, o card 'Cadastro no Panteon', editável, entregue por slot SÓ no EnterpriseDetail. A CadastroTab (:938) é a mesma do portal (CadastroDoProduto.tsx:67) e não ganha edição;
- embaixo, o card do C2X lê o RETRATO da F3, e não o C2X ao vivo, e mostra só o que diverge. Os campos do legado já vieram na F9.

**Campos:**
- nome (só pai e simples);
- sigla, com cadeado mostrando o motivo e as contagens;
- cidade e UF (autocomplete de NovoProduto.tsx:15);
- pai, com cadeado;
- tipo, com cadeado;
- vendendo e ordem;
- os campos da F9;
- coordenador do empreendimento;
- histórico da trilha.

**Coordenador.** Grava na chave que o leitor usa (coordenador-do-empreendimento.ts:263-296):
- 'group:' + chave_do_grupo para LOX, PDX, RDX e Lagoa Bonita;
- '35' para o VLO, pai com id vivo e entrada própria;
- o c2x id para simples e divisão.
A tela mostra quais divisões herdam.

**Antes de ligar a tela, os settings duplicados do pai.** Medido em 26/09:
- 'group:Lagoa Bonita' com credenciamento_ativo = true;
- 31 com credenciamento_ativo = false;
- 'group:Vale do Ouro' com credenciamento_ativo = true e sem coordenador;
- 35 com coordenador e credenciamento ativo.
Primeiro medir que leitor lê cada linha. Depois fundir, preservando o valor que cada leitor vê hoje, com OK por escrita. Se dois leitores veem valores diferentes do mesmo campo, isso vira pergunta.

**PATCH:**
- exige authorizeApoloCoordenacao (auth.ts:77);
- no salvar, e só nele, confere ao vivo no C2X enterprise_unities e acquisition_requests do id, inclusive canceladas. Falha fechada: sem resposta do C2X, sigla, pai e tipo ficam travados;
- no Panteon, confere hercules_movimento_do_empreendimento, também do NOVO pai quando ele ainda não tem filhos;
- grava pela função da 0197 numa transação, settings incluído.

**Cache.** Sem aviso de 10 ou 30 min: o carimbo (F1) renova as outras instâncias pela primeira leitura depois de 30 s; a leitura seguinte já vê o novo.

**Sigla, conforme a pergunta 1:**
- (A) livre com a trava de movimento, e prefixoSugerido (app/api/apolo/empreendimentos/unidades/cadastrar/route.ts:121, :161; cadastrar-unidades-server.ts:386-388) passa a usar a sigla do cadastro pelo id;
- (B) só a sigla que o C2X já tem, com a mensagem 'troque primeiro no C2X'.

**Outras mudanças:**
- o link curto do espelho aceita o apelido de um nome anterior da trilha (app/e/[link]/page.tsx:59-74);
- 'Novo produto' (novo/route.ts:30) passa a authorizeApoloCoordenacao;
- o changelog diz o processo em uma linha: nome se muda no Panteon; no C2X, só se o boleto precisar.

Padrão visual: grafite com preto, ícones mais que texto, sem o dourado #A07C3B e sem travessão.
migrations: ["0197_editar_o_empreendimento_numa_transacao.sql. Idempotente (create or replace).\n\nFunção hercules_editar_empreendimento(p_id uuid, p_mudancas jsonb, p_settings jsonb, p_autor text, p_motivo text) returns jsonb. Ela:\n- marca set_config('panteon.autor', ..., true) e set_config('panteon.origem', 'tela', true);\n- aplica só os campos permitidos;\n- quando o nome do pai muda, reescreve na mesma transação o nome dos filhos que seguem '<nome antigo do pai> · <SIGLA>';\n- quando a sigla do filho muda, reescreve o sufixo do nome dele;\n- quando o pai recebe o primeiro filho, preenche chave_do_grupo com o nome do pai;\n- grava o settings na chave certa (group:chave, 35 ou c2x id) e realinha settings.code.\n\nREVOKE EXECUTE de public, anon e authenticated."]
arquivos: packages/database/migrations/0197_editar_o_empreendimento_numa_transacao.sql; apps/hub/app/api/apolo/empreendimentos/cadastro-do-panteon/route.ts (novo; GET e PATCH pelo uuid); apps/hub/lib/hercules/editar-empreendimento.ts (novo, puro) + editar-empreendimento.test.ts; apps/hub/lib/hercules/editar-empreendimento-server.ts (novo); apps/hub/modules/apolo/blocks/empreendimentos/cadastro-no-panteon.tsx (novo); apps/hub/modules/apolo/blocks/empreendimentos/empreendimentos-view.tsx:731, :847, :938, :991; apps/hub/modules/incorporador/hercules/janela-do-cadastro.tsx:162, :328 (reuso); apps/hub/modules/apolo/blocks/empreendimentos/politica-comercial-tab.tsx:144-197 (reuso da busca de entidade); apps/hub/lib/apolo/enterprise-settings.ts:164-212; apps/hub/lib/apolo/coordenador-do-empreendimento.ts:239-296 (teste de ida e volta); apps/hub/app/e/[link]/page.tsx:59-74; apps/hub/lib/hercules/link-do-espelho.ts:64-72; apps/hub/lib/hercules/cadastrar-produto-server.ts:297-301 (siglas antigas entram na reserva); apps/hub/app/api/apolo/empreendimentos/novo/route.ts:30; apps/hub/app/api/apolo/empreendimentos/unidades/cadastrar/route.ts:121, :161 e apps/hub/lib/apolo/cadastrar-unidades-server.ts:386-388 (só na opção A); apps/hub/scratchpad/pan124-settings-do-pai.ts (só SELECT)
testes: Testes unitários da regra de trava (função pura):
- GDN, 404 unidades: sigla travada;
- PDI, 0 e 0: livre (e, na opção B, só com a sigla do C2X);
- LOX, 574 propostas: pai e sigla travados;
- JDG 40 recebendo filho: recusado;
- neto: recusado;
- nome repetido entre raízes: recusado;
- sigla reservada: recusada, mas não as siglas antigas do próprio id.

Ida e volta do coordenador: para cada chave de vínculo em uso ('group:Lagoa Bonita', 35, 27, 32, 33 e os demais), o coordenador salvo pela tela é o que coordenadoresDosPedidos devolve.

O link do espelho abre com o nome antigo.

Prova viva da 0197 em begin/rollback:
- renomear o VLO renomeia VOC, VOL e VOR e grava 4 linhas de trilha;
- o settings é gravado na chave certa;
- rollback.

Tela: validar no dev server apontado para ESTE worktree. O Lucas faz os cliques.

Paridade: depois do deploy, nenhum dado muda até alguém salvar.

Revisão adversarial antes do deploy.
risco/rollback: Risco: gravar o coordenador numa chave que ninguém lê, o que repetiria o incidente de 24/09. Coberto pelo teste de ida e volta.

O operador perde o 'Novo produto'. Ele nunca foi usado: a sequence está com is_called = false.

Rollback: revert do código; a função fica sem uso. Uma edição feita se desfaz pela tela e fica na trilha.
OK do Lucas: Resposta à pergunta 1. OK para cada fusão de settings do pai. Aplicar a 0197 e rodar a prova viva. Depois, deploy. A primeira edição real em produção é feita pelo Lucas. 

## Fatia 12: F11 · Sigla de empreendimento com unidades que o C2X renomeou (0198 só na opção B)
objetivo: Das 4 trocas de sigla auditadas, 3 foram em empreendimento com unidades:
- 30 LAG para ADT (16/07);
- 42 ADC para ACP (15/08, 120 unidades);
- 30 ADT para ACT (21/09, 41 unidades no C2X).
Só o 43 tinha 0. O C2X renomeia em cascata. No plano anterior, esse caso comum caía em beco sem saída: a 0192 trava, a F10 recusa e a adoção do 30 recusa.

Ação só de admin, com prévia das contagens. O que ela faz depende da pergunta 1:

**(B) 'Seguir a sigla do C2X'.** Função da 0198, numa transação:
- reescreve o prefixo de hercules_unidades.codigo das linhas do id, conferindo linha a linha contra o nome da unidade no C2X por origem_c2x_id;
- realinha settings.code;
- grava a trilha com origem 'correcao';
- devolve a lista das cópias que precisam de passo manual: masterplan, pasta do storage e link do espelho.

**(A) 'Aceitar a divergência'.** Marca sigla_divergente_aceita no retrato (0193), sem reescrever nada.

Em ambos os casos, o protocolo do vigia fecha.

Roda no 30 antes da adoção (F12).
migrations: ["0198_seguir_a_sigla_do_c2x.sql, só se a resposta for B.\n\nFunção hercules_seguir_sigla_do_c2x(p_enterprise_id text, p_sigla_antiga text, p_sigla_nova text, p_autor text, p_motivo text) returns jsonb:\n- set_config de autor e origem 'correcao';\n- update de hercules_unidades.codigo, só nas linhas do id com o prefixo antigo;\n- realinha settings.code;\n- devolve as contagens e as cópias com passo manual.\n\nREVOKE EXECUTE de public, anon e authenticated. Com a opção A, esta migration não existe."]
arquivos: packages/database/migrations/0198_seguir_a_sigla_do_c2x.sql (só na opção B); apps/hub/lib/hercules/sigla-com-unidades.ts (novo, puro) + sigla-com-unidades.test.ts; apps/hub/app/api/apolo/empreendimentos/sigla-do-c2x/route.ts (novo; authorizeApoloCoordenacao, só admin); apps/hub/modules/apolo/blocks/empreendimentos/cadastro-no-panteon.tsx (botão pela capacidade); apps/hub/lib/apolo/vigia-do-cadastro.ts (fechar o protocolo); apps/hub/lib/hercules/situacao-da-unidade.ts:271-284 (conferência: a busca casa por linha e origem_c2x_id antes do código)
testes: Testes unitários: a prévia do 30 lista 31 linhas ADT e 0 de outros ids.

Prova viva em begin/rollback no 30:
- 31 linhas reescritas de ADT para ACT;
- a conferência por origem_c2x_id bate 31 de 31;
- nenhuma outra linha é tocada;
- rollback.

Antes, listar os masterplans e os arquivos do espelho do id.
risco/rollback: Risco: um masterplan do Panteon que case pelo código. A situação da unidade não se perde, porque acharUnidade casa por linha e origem_c2x_id antes do código (situacao-da-unidade.ts:271-284). A prévia lista os masterplans do id.

Rollback: a mesma função no sentido inverso, pela trilha.
OK do Lucas: Resposta à pergunta 1. Na opção B: aplicar a 0198, e cada execução é escrita em produção com OK próprio. Depois, deploy. 

## Fatia 13: F12 · Trazer do C2X numa transação (0199)
objetivo: **Botão.** Só de ícone, ao lado de 'Novo produto' (empreendimentos-view.tsx:444-471). Aparece pela capacidade que o servidor manda, ou seja, quando há candidato adotável, no molde do podeMoverCad (board-do-servidor.ts:1052). Abre a JanelaDoCadastro (janela-do-cadastro.tsx:162).

**Candidatos.** Ids do C2X sem cadastro, menos os de teste 2 e 34 (regra do semeador portada para TypeScript: semear-empreendimentos-plano.mjs:74, :146, :211). Hoje só o 30, e ele só entra depois da F11 e da pergunta 2.

**Adoção.** Função SQL numa transação só:
- insert com c2x_enterprise_id explícito;
- trilha com origem 'adocao';
- settings criado desligado, ou só o code realinhado se já existir;
- os campos da F9;
- religa as propostas órfãs do id (empreendimento_id nulo e enterprise_id igual ao id, preenchido pela F5; hoje 49: ACT 31, SDT 16 e TSC 2).
Não há compensação por delete. O molde de cadastrarProduto (cadastrar-produto-server.ts:563-566) bateria na FK restrict da trilha da 0192 e deixaria a adoção pela metade.

**Recusa quando:**
- o id já está no cadastro;
- o id é de teste;
- o id não existe no C2X;
- há prefixo divergente não resolvido pela F11.

**Pergunta 3:**
- Se 'nasce no Panteon e liga depois': a mesma migration traz 'Ligar ao C2X', só admin, que troca o id 100000+ pelo id real. É exceção explícita à imutabilidade da 0192, pela saída explícita, com prévia e trilha.
- Se 'nasce no C2X': a janela de 'Novo produto' diz que ele é para produto sem boleto no C2X, as carteiras do PAN-036 (roadmap.ts:442-447).

O aviso de 'id sem cadastro' do vigia passa a levar o link 'Trazer do C2X'.
migrations: ['0199_trazer_do_c2x_numa_transacao.sql. Idempotente (create or replace).\n\nFunção hercules_adotar_do_c2x(p_enterprise_id text, p_cadastro jsonb, p_autor text) returns jsonb, que faz insert, trilha, settings, campos da F9 e religação numa transação. REVOKE EXECUTE de public, anon e authenticated.\n\nSe a pergunta 3 pedir, a mesma migration traz hercules_ligar_ao_c2x(p_id uuid, p_enterprise_id text, p_autor text, p_motivo text), com a saída explícita da 0192 e o mesmo REVOKE.']
arquivos: packages/database/migrations/0199_trazer_do_c2x_numa_transacao.sql; apps/hub/lib/hercules/adotar-do-c2x.ts (novo, puro) + adotar-do-c2x.test.ts; apps/hub/lib/hercules/adotar-do-c2x-server.ts (novo); apps/hub/app/api/apolo/empreendimentos/adotar/route.ts (novo; GET candidatos, POST adotar; authorizeApoloCoordenacao); apps/hub/modules/apolo/blocks/empreendimentos/empreendimentos-view.tsx:444-471; apps/hub/modules/incorporador/hercules/janela-do-cadastro.tsx:162; apps/hub/lib/apolo/enterprise-settings.ts:164-212; apps/hub/lib/guardian/c2x-analytics.ts:63; scripts/hercules/semear-empreendimentos-plano.mjs:37 (mesma lista de ids de teste); apps/hub/lib/apolo/vigia-do-cadastro.ts (link no aviso)
testes: Testes unitários:
- os candidatos com o fixture de 25/09 são exatamente [30];
- o 30 é recusado enquanto o prefixo não estiver resolvido;
- um id fictício 44 é aceito;
- um id já cadastrado é recusado;
- sem candidato, o botão não aparece.

Prova viva em begin/rollback:
- adoção completa do 30 e conferência de insert, settings e religação;
- uma segunda rodada com falha forçada no meio (conflito de settings) não deixa nada gravado;
- rollback;
- 0 linhas a mais.

Paridade: nada muda até alguém adotar.
risco/rollback: A adoção é difícil de desfazer: depois de religar, as FKs com restrict prendem a linha. Por isso a janela pede confirmação e mostra o que vai ser religado.

Rollback: revert do código. Uma adoção feita só se desfaz por SQL assistido, com OK.
OK do Lucas: Aplicar a 0199 e rodar a prova viva. Depois, deploy. A adoção do 30 depende das perguntas 1 e 2 e da F11, e é escrita em produção. 

## Fatia 14: F13 · Varredura opcional das cópias de rótulo congeladas (sem migration)
objetivo: É a metade que a regra nova não alcança (reference_regra_nova_nao_alcanca_o_passado). Regravar, para o nome de mercado atual, as cópias de texto que alguém exibe ou busca:
- apolo_relationships.label dos vínculos de empreendimento: 91 divergentes (20: 17; 38: 72; 42: 2);
- apolo_esteira.empreendimento: 74 linhas, mais 18 com o nome anterior do 42, mais 3 'EMPREENDIMENTO n';
- apolo_commercial_links.enterprise_name: 483;
- temis_trabalhos.enterprise_nome: 4.

Pré-condição: só depois da F6. Antes de escrever, repetir o grep por .ilike e .eq em 'empreendimento' sobre apolo_esteira. Em 26/09 ele achou:
- cads-publico-resumo.ts:46 e :135;
- relatorio-imobiliaria.ts:121;
- asana/comparativo/route.ts:79 e :92;
- asana/diagnostico/route.ts:101.
Todos passam a id na F6. Se o grep achar outro, a varredura espera.

NÃO toca documento gerado, PDF, contrato nem minuta.

Sugerido junto, fora do PAN-124: TST 9001 com vendendo = false.
migrations: []
arquivos: apps/hub/scratchpad/pan124-varredura-rotulos.ts (lotes de 100, confere o error de cada escrita); docs/operations/engineering-operations.md
testes: - Backup em JSON das linhas antes, no scratchpad da sessão.
- Contagens por id, antes e depois.
- Nenhum dado pessoal impresso.
- Conferir, depois da próxima rodada do sync do Apolo, que a regravação não foi desfeita.
risco/rollback: O sync do Apolo substitui a metadata inteira (reference_apolo_metadata_sync_apaga). Por isso a varredura escreve só colunas, nunca jsonb.

Rollback: restaurar do backup.
OK do Lucas: Cada escrita (4 tabelas e o TST) tem OK próprio. A fatia inteira é opcional. 

## Regras de edição
 - QUEM EDITA: admin e líder (authorizeApoloCoordenacao, apps/hub/lib/apolo/auth.ts:77). O botão aparece pela capacidade que o servidor manda (podeEditar), como podeMoverCad (board-do-servidor.ts:1052); o operador vê só leitura. A mesma régua vale para 'Trazer do C2X' (que só aparece quando há candidato), para 'Seguir a sigla do C2X' (só admin) e para 'Novo produto' no hub. O portal do incorporador não edita.
 - A PORTA É O UUID: a tela acha o registro pelo id do hercules_empreendimentos que a lista leva (panteonId), inclusive nos pais que aparecem como linha 'group:*' (LOX, PDX, RDX e Lagoa Bonita).
 - NOME (pai e empreendimento simples): livre, até 120 caracteres (produto-novo.ts:117). É recusado se repetir o de outra raiz, sem acento e sem caixa, porque o link do espelho e o do painel saem do apelido do nome.
 - NOME DO FILHO: não é digitado. É sempre '<nome do pai> · <SIGLA>', mantido pela função da 0197. O mercado vê o pai (PAI É A FONTE).
 - SIGLA, trava por movimento: só muda com 0 unidades e 0 vendas nos DOIS lados.
- No C2X, conferido ao vivo no salvar, com falha fechada: enterprise_unities e acquisition_requests do id, inclusive canceladas.
- No Panteon: hercules_movimento_do_empreendimento (0192).
Depois da unificação, a unidade do filho passa a ser contada por segmento_id.
 - SIGLA, formato e espaço de nomes: formato ^[A-Z][A-Z0-9]{1,5}$ (CHECK na 0192). É recusada se já existir como sigla atual do C2X, sigla excluída, sigla do cadastro, sigla antiga da trilha ou do retrato, ou numa das já medidas (LAG, ADT, ADC, RDV). As siglas antigas do PRÓPRIO id não contam.
 - SIGLA de id vivo no C2X: depende da pergunta 1.
- (A) o Panteon manda: sigla livre com a trava de movimento, e o vigia mostra a do C2X como divergência aceita.
- (B) o C2X manda: só a sigla que o C2X já tem, com a mensagem 'troque primeiro no C2X'.
Produto nascido no Panteon (id a partir de 100000) segue livre, com a trava e o formato.
 - SIGLA de empreendimento com unidades que o C2X renomeou: não se edita no campo. Vai pela ação da F11: 'Seguir a sigla do C2X' na opção B, ou 'Aceitar a divergência' na opção A. É só para admin, com prévia e trilha 'correcao'.
 - PAI e FILHO: um nível só.
- O gatilho da 0123 confere o pai novo; a 0192 recusa neto.
- Entrar, sair ou trocar de pai exige 0 unidades e 0 vendas no filho.
- O pai que recebe o PRIMEIRO filho também precisa de movimento zero, porque o catálogo muda de forma. Se tiver movimento, vira correção assistida.
- O pai de um grupo não perde a chave_do_grupo; grupo novo ganha a chave com o nome do pai no primeiro filho.
 - TIPO (loteamento ou vertical): mesma trava da sigla. VENDENDO e ORDEM: livres; a ordem das divisões na tela sai daqui. CIDADE e UF: livres, com autocomplete.
 - CAMPOS DO LEGADO (F9: divulgação, previsão de entrega, tipo no C2X, incorporador, gerente, captador, contato focal): editáveis no Panteon depois da importação. Os players são entidades do Apolo, nunca texto solto. Telefone e e-mail não viram coluna.
 - COORDENADOR DO EMPREENDIMENTO (settings.coordenador_entity_id): livre. Grava na chave que o leitor usa:
- 'group:' + chave_do_grupo para LOX, PDX, RDX e Lagoa Bonita;
- '35' para o VLO;
- o c2x id para simples e divisão.
O rótulo é distinto da coordenadora de vendas, que continua em Políticas comerciais.
 - NUNCA EDITÁVEIS pela tela: c2x_enterprise_id (a única exceção é 'Ligar ao C2X', se a pergunta 3 pedir, só admin e com trilha) e chave_do_grupo. Não existe excluir empreendimento: desligar é vendendo = false.
 - MOTIVO obrigatório para mudar sigla, pai ou tipo. Toda alteração grava autor, antes, depois e origem (tela, adocao, correcao ou sql). SQL manual também fica registrado, e depende da saída explícita para mexer em sigla, pai ou tipo.
 - DOCUMENTOS JÁ GERADOS NÃO MUDAM: PDF guardado, contrato assinado e nome de arquivo com a sigla (contrato-guardado.ts:197-211). O próximo documento sai com o nome novo. A tela avisa quantas minutas citam o nome antigo e não troca nada sozinha.
 - CÓPIAS DE RÓTULO (vínculos, esteira, commercial_links, prometeu_eventos.config.enterpriseNome, temis_trabalhos.enterprise_nome) ficam como retrato do dia em que foram gravadas. Os leitores leem pelo id desde a F6, inclusive o painel do coordenador, o relatório às imobiliárias e as rotas do Asana. A regravação é a F13, opcional.
 - LINKS: o link do espelho e o do painel do coordenador continuam abrindo com o apelido de um nome anterior (trilha e retrato). Slug que não casa mostra o seletor, nunca outro empreendimento.
 - CRIAR DO ZERO ('Novo produto'): o id vem da sequence, a partir de 100000; a sigla não pode existir em nenhum dos lados nem entre as antigas; o produto não vai ao C2X. O texto da janela e a existência de 'Ligar ao C2X' dependem da pergunta 3.
 - CRIAR A PARTIR DE UM ID DO C2X ('Trazer do C2X'): uma função numa transação. Adota o id; sigla, cidade, UF e campos do legado vêm do C2X; o nome de mercado é editável. Cria o settings desligado ou só realinha o code. Religa as propostas órfãs do id. Recusa id de teste (2, 34), id já cadastrado e prefixo divergente ainda não resolvido pela F11.
 - O C2X É READ-ONLY: nada é escrito lá, e a tela nova não o lê ao vivo para mostrar. Mostra o retrato (F3); só o salvar confere as contagens ao vivo, como trava. Quando o C2X muda, o vigia avisa, a não ser que a mudança só acompanhe o Panteon. Seguir ou não é decisão do admin, pela mesma tela e com as mesmas travas.

## Perguntas ao Lucas
 - QUEM MANDA NA SIGLA de um empreendimento que tem id vivo no C2X? Bloqueia só a F10 (o campo sigla) e a F11. As fatias F1 a F9 andam sem a resposta.

(A) O PANTEON MANDA. É o que as regras escritas indicam: 'quando o legado e o Panteon discordam, vale o Panteon' (24/09) e 'tudo tem que ser alimentado pelo Panteon' (18/09).
- A sigla fica livre na tela, com a trava de movimento.
- As unidades que o Apolo cria no C2X passam a usar a sigla do cadastro (prefixoSugerido, app/api/apolo/empreendimentos/unidades/cadastrar/route.ts:121 e :161).
- O vigia mostra a sigla do C2X como 'divergência aceita', sem alarme.
- Custo: boleto e contrato do C2X continuam saindo com a sigla de lá. A unidade no C2X pode ficar com um prefixo diferente do código do empreendimento lá.

(B) O C2X MANDA.
- O Panteon só aceita a sigla que o C2X já tem.
- O 43 continuaria exigindo que a Nívea trocasse primeiro no C2X.
- Uma troca no C2X em empreendimento com unidades usa 'Seguir a sigla do C2X' (F11), que reescreve o prefixo das unidades do Panteon.
- O PAN-124 promete editar nome, cidade, UF, pai e os campos do legado, e o changelog diz isso com todas as letras.
 - ACT (30, 'ALDEIA DA CACHOEIRA DAS PEDRAS - TERMO DE ADESAO E TRANSFERENCIA'): entra como filho da ACP (42) ou como produto próprio? É a pergunta 5 do plano, registrada em apps/hub/lib/guardian/c2x-analytics.ts:55-62.

Bloqueia só a adoção do 30 (F12) e a religação das 31 propostas dele.

Se for filho: a ACP tem 120 unidades e nenhum filho. Pela trava nova, o primeiro filho de um pai com movimento vira correção assistida pelo Zeus, com OK.

Em qualquer resposta, as 31 hercules_unidades com prefixo ADT (o C2X já as chama de ACT) passam antes pela F11.
 - EMPREENDIMENTO NOVO QUE VAI EMITIR BOLETO NO C2X: ele nasce lá e é trazido pelo 'Trazer do C2X', ou nasce no Panteon e é ligado ao id do C2X depois?

- Se nasce lá: a janela de 'Novo produto' passa a dizer que ele é só para produto sem boleto no C2X (as carteiras do PAN-036).
- Se nasce no Panteon: a F12 ganha 'Ligar ao C2X', que troca o id 100000+ pelo id real. É só para admin, com prévia e trilha, como exceção explícita à imutabilidade da 0192.

Sem uma das duas, o produto criado no Panteon e depois no C2X fica com o vigia avisando para sempre e só se conserta por SQL assistido.

## Decisões padrão
 - NUMERAÇÃO: 0192 a 0199. A 0198 só existe se a resposta à pergunta 1 for B. A 0191 já está em origin/main. O diretório é conferido antes de criar cada arquivo (skill migration-supabase §2).
 - ORDEM: chave antes de rótulo.
- F4, F5 e F6 sobem antes da F7. A F6 agora inclui o painel do coordenador, o relatório às imobiliárias e as rotas do Asana.
- A F8a (a CAD nova nasce com o nome de mercado) só sobe depois da F6.
- A F9 (campos do legado) vem antes da tela, para a tela não ler o C2X ao vivo.
- F10 e F11 esperam a pergunta 1; a F12 espera as perguntas 2 e 3 e a F11.
- O vigia (F3) sobe cedo.
 - A SIGLA saiu das decisões padrão e virou a pergunta 1. Nada de F1 a F9 depende da resposta: as leituras que traduzem sigla->id já casam pelo id (c2x-pelo-id.ts:266-301), e a F5 tira as propostas da sigla.
 - FRONTEIRA COM A UNIFICAÇÃO (PAI É A FONTE): o PAN-124 NÃO muda o código da unidade. Continuam como estão:
- os 6 montadores que cortam 3 letras (empreendimentos.ts:1174, carteira.ts:534, extrato.ts:321, vendas.ts:761, incorporador/contrato.ts:79, contratos.ts:421). Eram 7: o de attendance/data.ts:773 saiu na F1 (commit 0c821b60). Ele inventava a sigla por um mapa nome->sigla quando o servidor mandava a matrícula nula; agora, sem matrícula do servidor, a fila mostra '-';
- os mapas fixos por sigla.
Não é porque estejam certos. O código é a chave viva da unidade (a linha viva ainda é a do filho: 714 linhas com prefixo do filho e 0 segmento_id). Trocar só a exibição para VLO0104 seria o remendo de tela que o Lucas recusou; o conserto é a unificação.
O PAN-124 vai primeiro até a F8b e entrega a régua por id (sigla do pai, filhos, chave do grupo), que a unificação consome.
Quando ela vier:
- o vigia compara o prefixo pelo segmento;
- a trava da sigla do filho conta por segmento_id;
- para LOX, PDX e RDX, o prefixo é a sigla do Panteon por definição.
 - PAINEL DO COORDENADOR: agrupa os 5 empreendimentos pelo pai, porque o coordenador vê UM empreendimento (reference_empreendimento_divisoes_niveis). Mostra o nome de mercado do pai, sem sufixo, e é endereçado pelo id, com os links antigos valendo. A mudança vai na F6 e é anunciada.
 - GUARDIAN (cobrança interna): a partição fica igual à de hoje, 18 linhas. LOX, PDX, RDX e VLO somados pelo pai; as glebas da Lagoa Bonita separadas. Separar as divisões seria decisão à parte, anunciada no changelog.
 - LISTAS FIXAS:
- ENTERPRISE_GROUPS e ENTERPRISE_MIRRORS são apagadas ao fim da F8b; o espelho passa a ser 'pai com c2x id próprio e com filhos';
- ENTERPRISE_SUB_ALIASES fica só como vocabulário de busca por id;
- EXCLUDED_ENTERPRISE_IDS continua [2, 31, 34], porque é filtro de leitura do legado;
- os ids de TESTE (2, 34) viram uma lista única, usada pelo vigia, pelos candidatos e pelo semeador.
Sem cadastro na partida a frio, a tela avisa e lista pelo id do C2X, sem lista velha.
 - ORDEM DAS DIVISÕES: sai do cadastro (ordem, codigo), a mesma do Hércules. A única mudança visível é a Lagoa Bonita no Apolo e no catálogo: LBF, LBP, LBR em vez de LBF, LBR, LBP.
 - CATÁLOGO: por paridade, o VLO 35 continua entrada simples ao lado de 'group:Vale do Ouro'. Juntar as duas entradas é da unificação.
 - CAIXA DO TEXTO: cada tela mantém a convenção que já usa; o catálogo continua em caixa alta (catalogo-empreendimentos.ts:29). Os nomes que mudam de verdade (REP, VDP, RVP, ACP, LAB) são anunciados na F7.
 - PERMISSÃO: coordenação (admin e líder) para editar, trazer do C2X e criar no hub. 'Seguir a sigla do C2X' e 'Ligar ao C2X' são só de admin. 'Novo produto' deixa de aceitar operator; ninguém o usou até hoje (sequence com is_called = false).
 - CHAVE DO GRUPO: congelada numa coluna, e os 25 ids gravados não são migrados. Os settings duplicados do pai (31 contra 'group:Lagoa Bonita'; 'group:Vale do Ouro' contra 35) entram no PAN-124 e são resolvidos antes da F10: medir quem lê, fundir preservando o que cada leitor vê hoje, com OK.
 - VIGIA:
- roda no sweep de notificações, e não no incremental que o PAN-080 vai desligar;
- compara o C2X com o retrato;
- fica em silêncio quando o C2X só acompanha o Panteon;
- um aviso por id;
- notifica os admins só quando o protocolo nasce ou o retrato muda;
- fecha o protocolo sozinho quando os lados batem;
- nunca grava o JSON cru da auditoria;
- ignora 2, 34 e o TST 9001.
A troca do x-vercel-cron por Bearer CRON_SECRET continua fora do escopo.
 - CAMPOS DO LEGADO: divulgação, previsão de entrega, tipo e players vêm para o cadastro na F9, com importação única e sem sync. A tabela PRICE/SACOOC fica no financeiro, e os planos no item próprio.
 - CACHE: o cadastro em cache se renova pelo carimbo (count e max(atualizado_em)), conferido no máximo a cada 30 s por instância. Não é a cada leitura, por custo. Com cadastro guardado, a leitura não espera o banco: devolve o guardado e confere em segundo plano (after()), e o que vier vale a partir da leitura seguinte. Cada ida ao banco tem prazo de 5 s; estourou, fica o anterior. Só a partida a frio espera. O catálogo e o painel de contratos passam a usar esse cache.
 - TST 9001 (vendendo = true em produção): o vigia o ignora. Pôr vendendo = false é sugerido na F13, com OK.
 - PROVAS:
- os testes ficam no repositório, ao lado do código;
- o scratchpad só tem scripts de SELECT (pan124-*.ts), rodados de apps/hub com npx vite-node --config vitest.config.ts;
- nenhum dado pessoal é impresso;
- toda prova viva de migration roda em begin/rollback, com OK;
- prova de partição e de conjunto de ids nunca é ajustada ao número novo.
 - CADA FATIA É UMA VERSÃO: changelog, diário (registrar-release), evidência do PAN-124 no roadmap e mensagem pro grupo. Depois do push, conferir o deployment pelo githubCommitSha.
 - VALIDAÇÃO VISUAL: no dev server apontado para este worktree. O Lucas faz os cliques. Revisão adversarial antes do deploy da F5, F6, F7, F8b e F10.

## O que mudou pela crítica
 - ACEITO (bloqueante, regressão): o painel do coordenador usa o slug do NOME como chave. Conferido em painel-coordenador.ts:252-260 e :283-289 (cai em lista[0]), page.tsx:95 e cads/[empreendimento]/page.tsx:19. Foi inteiro para a F6: endereçado pelo id, links antigos por apelido, sem lista[0] e rótulo do pai. carregarNomes saiu da F7.
REJEITADO nesse item: a 'tabela ou constante de slugs legados'. Os apelidos saem do retrato (F3, com nomes_anteriores) e da trilha (0192), sem lista fixa nova.
 - ACEITO (bloqueante, produto): a sigla mandada pelo C2X saiu das decisões padrão e virou a pergunta 1, com o custo de A e de B. F1 a F9 andam; F10 e F11 esperam. Evidência conferida: prefixoSugerido aceita sobrescrita (unidades/cadastrar/route.ts:121, :161), e acharUnidade casa por origem_c2x_id antes do código (situacao-da-unidade.ts:271-284).
 - ACEITO (produto, agrupar o painel): o painel agrupa os 5 grupos pelo pai e resolve 'group:*'. Conferido que hoje é descartado por Number() em painel-coordenador.ts:204-205 e :225-226. Foi feito na F6, e não na F1, para o painel mudar uma vez só. A prova do VOR nas 4 abas (crítica menor) virou prova das 4 abas para todos os grupos.
 - ACEITO (regressão, Guardian): a F8b partia de premissa falsa. Conferido em overview.ts:305-320: Lavra, Portal, Rio de Pedras e Vale do Ouro já saem fundidos, e só a Lagoa Bonita fica por gleba. A regra foi reescrita para manter as mesmas 18 linhas, e a prova não se ajusta ao número novo. O mesmo vale para attendance.ts:177-192.
 - ACEITO (regressão, F4): dados-do-contrato.ts:1453-1455 monta 'group:' com o nome do pai. Conferido. A F4 agora começa pelo grep e lista o resultado. Entraram também c2x-pelo-id-servidor.ts:242, habilitacao-pelo-cadastro.ts:122 e trabalho-servico.ts:789, que usa o texto do id como nome. Ficam, conferidos, os que casam pelo código.
 - ACEITO (regressão, F6 e F13): relatorio-imobiliaria.ts:121 e asana/comparativo/route.ts:79, :92 usam o texto da esteira como chave. Conferidos, e o grep achou mais um: asana/diagnostico/route.ts:101. Os três foram para a F6. A F8a e a F13 só andam depois. Os .eq('empreendimento') de boletos_* e lsoft_* casam chaves próprias dessas tabelas e ficam fora.
 - ACEITO (regressão, F5), com recontagem em 26/09: 24 envelopes, 8 com sigla (VOC 2, VOL 5, VOR 1), todos com unidade_id; 4.946 propostas e 51 documentos, 0 sem unidade.
- O backfill passa a ser por join na unidade, sem lista fixa.
- O escritor envio-db.ts:258/:777 é consertado antes do .dados.sql.
- O gatilho deriva da unidade (segmento primeiro) e cobre temis_envelopes.
 - ACEITO (regressão, VLO 35 e primeiro filho): a régua da F1 escreve que o pai com id vivo continua entrada simples e o grupo é adicional; o 31 fica fora. A 0192 passa a travar o pai que recebe o primeiro filho quando ele tem movimento (caso JDG 40), com prova viva.
 - ACEITO (regressão, F10 antiga): a adoção vira uma função SQL numa transação (0199), sem compensação por delete. Conferido o molde que não serve em cadastrar-produto-server.ts:563-566. Também conferido que o 'Novo produto' não faz UPDATE, então a trilha não atrapalha a compensação dele.
 - ACEITO EM PARTE (regressão, ordem da Lagoa Bonita): a divergência foi medida em 26/09 (cadastro LBF 0, LBP 1, LBR 2; constante LBF, LBR, LBP). O teste compara como CONJUNTO.
REJEITADO: 'fixar a ordem de hoje é obrigatório'. Fixar exigiria uma constante, e o Hércules já mostra a ordem do cadastro (expandir-id-do-painel.ts:52, empreendimentos.ts:144). Adotamos a do cadastro: uma só em todo o sistema, com a troca anunciada.
 - ACEITO (regressão, notificação diária e 2 alertas no 30): conferido que publishHubNotification não tem dedup (publish.ts:64-104). A notificação sai só quando o protocolo nasce ou o retrato muda. Os motivos do mesmo id viram um aviso só, e o ensaio espera 1 aviso com 2 motivos.
 - ACEITO (produto, sigla com unidades): foi criada a F11, com 'Seguir a sigla do C2X' (0198, opção B) ou 'Aceitar a divergência' (opção A). Roda no 30 antes da adoção. O protocolo do vigia passa a fechar por updateOperationAlertFeedback (alert-protocols.ts:249-300).
 - ACEITO (produto, porta do pai e settings): a F10 usa o uuid (panteonId na lista desde a F7). Conferido que LOX, PDX, RDX e Lagoa Bonita só existem como 'group:*' (empreendimentos.ts:1344). O coordenador grava na chave que coordenadoresDosPedidos lê (coordenador-do-empreendimento.ts:263-296), com teste de ida e volta. Os settings duplicados do pai entram no PAN-124, antes da tela, medidos em 26/09.
 - ACEITO (produto, onde nasce o empreendimento com boleto): virou a pergunta 3. 'Ligar ao C2X' fica condicional, e o botão 'Trazer do C2X' aparece pela capacidade.
 - ACEITO (produto, listas fixas): ENTERPRISE_GROUPS e ENTERPRISE_MIRRORS são apagadas ao fim da F8b, como combinado em 14/09 (memória reference_apolo_cadastra_hercules_vende, conferida). O teste 'semente = fixture' foi trocado por paridade contra o banco.
AJUSTE: na partida a frio, a tela não fica em branco. Ela avisa e lista pelo id do C2X, para não esconder a cobrança.
 - ACEITO EM PARTE (produto, campos que só o C2X tem): criada a F9 (0196), com importação única e players como entidades. O card da tela lê o retrato, não o C2X ao vivo. Conferido que o roadmap não tem item para esses campos.
REJEITADO: 'o sync mantendo-os'. O PAN-080 vai desligar os syncs não financeiros, e o Panteon passa a ser o dono. Quem acompanha o legado é o vigia.
REJEITADO também: trazer a tabela PRICE/SACOOC, que fica como dado financeiro, como a própria crítica admite.
 - ACEITO EM PARTE (produto, PAI É A FONTE): 'os montadores ficam como estão' deixou de ser afirmação sem ressalva. A fronteira com a unificação agora está escrita, com o que muda depois dela (vigia e trava por segmento) e com a ordem (PAN-124 primeiro até a F8b).
REJEITADO: montar na F8a o título com a sigla do pai. A linha viva ainda é a do filho e o código é a chave dela. Trocar só a exibição é o remendo que a regra manda evitar ('se some com a unidade única, o conserto é a unificação').
 - ACEITO (produto, o vigia avisa a Nívea da própria mudança): fica em silêncio quando o valor novo do C2X já é o do cadastro ou da trilha, e fecha o protocolo quando os lados batem. O processo vai em uma linha no changelog da F10.
 - ACEITO (produto, PAN-080): o gatilho de evento saiu do incremental do Apolo (lib/apolo/server.ts deixou de ser tocado) e foi para o sweep de notificações. Conferido em roadmap.ts:808-815 que o incremental está na lista a desligar.
 - ACEITO EM PARTE (produto, cache): a renovação pelo carimbo (count e max(atualizado_em)) entrou na F1 e tirou da F10 o aviso de 10 ou 30 min.
REJEITADO: conferir a cada leitura. O catálogo tem cerca de 30 consumidores, e isso multiplicaria consultas. A conferência é no máximo a cada 30 s por instância, que é consciência de custo.

### Crítica: produto-e-regras
  [bloqueante] A sigla continua mandada pelo C2X por 'decisão padrão'. O caso do 43 volta a exigir a Nívea no C2X
  [importante] Troca de sigla feita no C2X em empreendimento COM unidades (3 das 4 auditadas) não tem caminho, e o 30 não se resolve
  [importante] Painel do coordenador (público): divisões separadas com o mesmo nome, group:* descartado e link pelo slug do NOME, que F7/F9 quebram em silêncio
  [importante] A tela de editar não diz como acha o PAI. O campo coordenador no pai grava onde o leitor não lê
  [importante] Onde nasce um loteamento novo que vai emitir boleto no C2X? Não há caminho para ligar o produto do Panteon ao id do C2X
  [importante] ENTERPRISE_GROUPS e ENTERPRISE_MIRRORS mantidos como 'semente' contrariam o combinado de apagar as listas fixas
  [importante] Os campos que só o C2X tem ficam no C2X, e a tela nova lê o C2X ao vivo. O 'outro item do roadmap' citado não existe
  [importante] PAI É A FONTE: o plano congela os montadores que imprimem VOC0104/LOU0101 e parte do prefixo do filho, sem dizer como convive com a unidade única no pai
  [importante] O vigia avisa a Nívea da própria mudança e o protocolo não fecha: o fluxo esperado vira ruído
  [menor] O gatilho principal do vigia depende do cron incremental que o PAN-080 vai desligar
  [menor] Depois de salvar, telas ficam até 30 min com o nome antigo: 'salvei e não mudou'

### Crítica: regressao-e-dados
  [bloqueante] F7 muda a URL pública do painel do coordenador, que usa o nome como chave. O link antigo cai em silêncio no Vale do Ouro
  [importante] F8b parte da premissa errada sobre como o Guardian agrupa hoje: a partição mudaria de 18 para 22 linhas
  [importante] F4 deixou de fora um leitor que monta 'group:' com o NOME do pai: a CAD some do contrato quando o pai é renomeado
  [importante] F6 e F11: mais dois leitores usam o texto da esteira como chave, e a F8a e a F11 os quebram
  [importante] F5: a lista fixa de envelopes já está defasada, o escritor continua gravando sigla e o gatilho deixa ids nulos
  [importante] F7 e F9 não dizem o que acontece com o pai que tem id próprio no C2X (VLO 35) nem com o produto que recebe o primeiro filho
  [importante] F10 copia a compensação por delete, e ela bate na FK restrict da trilha da F2. Os UPDATEs da adoção também não se desfazem
  [menor] F1: pôr o VOR no grupo muda as 4 abas do painel, e a prova só confere as CADs
  [menor] F7 e F8b: a ordem das glebas da Lagoa Bonita diverge entre o cadastro e a constante
  [menor] F3: o aviso ao admin se repete todo dia, e o 30 gera 2 alertas, não 1
