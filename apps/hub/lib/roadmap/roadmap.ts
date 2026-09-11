// O ROADMAP DO PANTEON — a fonte única do que foi feito, do que está sendo feito e do que falta.
//
// Lucas (11/09/2026): *"quero criar essa tela de backlog, roadmap... assim a gente sabe o que fez o
// que está para ser feito e o que estamos fazendo"* e *"podemos criar um arquivo de roadmap e
// backlog que durante a nossa interação eu vou apontar, para vc, coloca isso no back, enfim,
// podemos ter essa interação e esse arquivo alimentar a tela"*.
//
// ⚠️ É UM ARQUIVO, E NÃO UMA TABELA, e isso foi decisão dele. O molde é o mesmo do
// `lib/changelog/changelog.ts`: um array tipado que a tela lê. As vantagens são concretas —
// o histórico do backlog fica no git (dá para ver quando um item nasceu e quando mudou de
// situação), o typecheck recusa um valor inventado em `situacao`, e eu edito no meio da conversa
// sem migration nem OK de banco.
//
// ⚠️ QUEM ESCREVE AQUI SOU EU, no fluxo do trabalho. Quando o Lucas diz "coloca isso no back", o
// item entra; quando uma entrega sobe, a situação vira `entregue` e ganha `entregueEm`. A tela do
// Zeus é leitura — ela mostra, não edita. Um board editável exigiria banco, e aí o arquivo e o
// banco discordariam no primeiro dia.
//
// ⚠️ TODO ITEM TEM `evidencia`, e ela não é enfeite: é o que separa backlog de lista de desejos.
// Sem poder apontar o commit, o arquivo, a migration ou a resposta do Lucas que originou o item,
// ele provavelmente não deveria existir.
//
// A numeração é estável: `PAN-014` continua sendo o mesmo item amanhã, para dar para falar dele
// por id. Item novo entra com o próximo número livre; item que sai vira `entregue`, não some.

/** Onde o item está. A tela agrupa por isto, e a ordem aqui é a ordem de leitura. */
export type SituacaoDoItem =
  /** Espera decisão ou ação de alguém — não é falta de tempo, é falta de resposta. */
  | "bloqueado"
  /** Começado e não terminado. Deve haver poucos: muitos "fazendo" é trabalho picado. */
  | "fazendo"
  /** Nada impede, é só fazer. */
  | "proximo"
  /** Depende de algo que ainda não existe (a migração do financeiro, uma decisão futura). */
  | "depois"
  /** Está no ar ou commitado. Fica no arquivo: o que foi feito é metade do valor de um roadmap. */
  | "entregue";

export type ItemDoRoadmap = {
  /** Estável para sempre: dá para dizer "PAN-014" e os dois saberem do que se fala. */
  id: string;
  titulo: string;
  /** Temis, Hercules, Apolo, Iris, Hades, Prometeu, Infra, Zeus. */
  modulo: string;
  situacao: SituacaoDoItem;
  /** Por que isso importa, em linguagem de negócio. Item sem porquê não sobrevive a uma semana. */
  porque: string;
  /** Onde está a prova: commit, arquivo, migration, memória, ou a resposta PNN do Lucas. */
  evidencia: string;
  /** O que impede. Só faz sentido em `bloqueado` e `depois`. */
  bloqueio?: string;
  /** Quando entrou no ar. Só em `entregue`. */
  entregueEm?: string;
};

/**
 * A FRENTE EM QUE ESTAMOS AGORA — e este campo existe por um pedido específico.
 *
 * Lucas (11/09/2026): *"o legal é que eu posso apontar para vc qual das frentes que estamos
 * trabalhando ou trabalhou para que você também tem essa visão"*.
 *
 * ⚠️ ISTO NÃO É DECORAÇÃO DA TELA: é o que me diz, ao abrir uma sessão nova, onde o trabalho
 * parou — sem o Lucas ter que recontar. O `situacao: "fazendo"` diz quais itens estão abertos;
 * isto diz qual é o ASSUNTO, que é outra coisa: dá para ter três itens em "fazendo" e a frente
 * ser um quarto, ainda sem item escrito.
 *
 * Quando ele disser "estamos na frente X", eu troco aqui e marco os itens correspondentes.
 */
export const FRENTE_ATUAL = {
  desde: "2026-09-11",
  itens: ["PAN-106", "PAN-107", "PAN-104", "PAN-105"] as readonly string[],
  porque:
    "Lucas: 'bora construir isso hoje então, foco'. A plataforma de atendimento ao usuário interno " +
    "com agente de nível 1 — mas começando pelo que para o silêncio, que é a causa medida das " +
    "críticas: o chamado nascia sem avisar ninguém, e a cobrança de quem cobrava era descartada " +
    "porque o destinatário era o dono, e os 30 parados não têm dono. O agente com ferramentas vem " +
    "depois, com a fila destravada e com métrica que não mente.",
  titulo: "Plataforma de atendimento ao usuário interno",
} as const;

export const PANTEON_ROADMAP: readonly ItemDoRoadmap[] = [
  {
    id: "PAN-001",
    entregueEm: "2026-09-11",
    evidencia: "UPDATE aplicado em produção em 11/09 com OK do Lucas: o card fc996d65 voltou para `analise` com `estagio_desde` = criado_em (08/09 08:22). Varredura depois: os 8 cards estão dentro do caminho do próprio tipo.",
    modulo: "Temis",
    porque: "Uma proposta pode ter DOIS cards (a venda e o pedido de cancelamento dela), e a regra antiga empurrou os dois quando o envelope saiu — cancelamento não percorre aquele estágio. O código já foi consertado hoje; a linha errada continua gravada em produção.",
    situacao: "entregue",
    titulo: "Corrigir o card do Henrique preso em 'Em assinatura'",
  },
  {
    id: "PAN-002",
    bloqueio: "Deploy e migration exigem OK explícito do Lucas a cada vez.",
    evidencia: "git: a branch wip/gerar-proposta está à frente de origin/main (3fcd2970 = v1.310.0). ⚠️ A migration 0152 JÁ FOI APLICADA em produção em 11/09 — o que falta é subir o código e escrever o changelog do deploy.",
    modulo: "Temis",
    porque: "Tudo o que foi feito em 11/09 (tela de análise, contrato editável, congelamento do desconto, o conserto do card que não andava) está commitado e fora do ar. Enquanto não sobe, o operador continua vendo a tela antiga.",
    situacao: "bloqueado",
    titulo: "Subir os commits da Têmis e escrever o changelog do deploy",
  },
  {
    id: "PAN-003",
    bloqueio: "Espera decisão do Lucas: esconder o campo no público ou aceitar o risco.",
    evidencia: "modules/incorporador/hercules/SimuladorDeProposta.tsx — CampoDoLote recebe ajuste/aoMudarAjuste sem olhar ehSimulacao; project_espelho_publico §'PENDENTE, decisão do Lucas'",
    modulo: "Hercules",
    porque: "Quem abrir o link do espelho pode abater o preço e gerar um PDF de simulação com a marca da casa. O campo vem do componente compartilhado com a Mesa de Venda, que passa o ajuste de preço igual nos dois modos.",
    situacao: "bloqueado",
    titulo: "Decidir o campo de desconto na página pública",
  },
  {
    id: "PAN-004",
    bloqueio: "Está com o administrativo para análise.",
    evidencia: "P46: 'está com o adminsitrativo para analisar'; reference_vale_do_ouro_vlo_esta_vivo (67 pedidos de aquisição abertos no VLO)",
    modulo: "Hercules",
    porque: "O pai diz Reservado e o filho diz Disponível, e a AR 4950 tem sinal marcado. Liberar o VOC0305 poria outra venda por cima de um cliente que já pagou sinal — o erro mais caro que esse cadastro duplicado pode produzir.",
    situacao: "bloqueado",
    titulo: "Resolver a divergência VLO0305 × VOC0305",
  },
  {
    id: "PAN-005",
    bloqueio: "O preenchimento é ação do time da Careli; o cadastro de coordenadora como papel próprio ainda não existe no Apolo.",
    evidencia: "P09, P12 e P19 (11/09): a informação passa a viver no Apolo, pode ser importada do C2X, e o cadastro de política é responsabilidade da Careli. packages/database/migrations/0145_comissao_por_empreendimento.sql criou coordenadora_entity_id. O CRECI dela continua sem coluna (variaveis.ts, PENDENTE).",
    modulo: "Hercules",
    porque: "Sem a coordenadora apontada, o contrato de corretagem sai com cinco colchetes no papel (nome, CNPJ, endereço, telefone, e-mail). A coluna existe desde a 0145 e está vazia em todos os empreendimentos.",
    situacao: "bloqueado",
    titulo: "Cadastrar as coordenadoras de vendas e apontar a Gurgel",
  },
  {
    id: "PAN-006",
    bloqueio: "Cadastro no Asaas é ação do administrativo. E as chaves marcadas 'Sensitive' na Vercel chegam VAZIAS ao runtime — têm de ser setadas pelo CLI (reference_vercel_env_sensitive).",
    evidencia: "project_boletos_cer_emissao §'Ainda aberto' (1); project_apolo_boletos_tela (painel /api/boletos/prontidao, 87 CPFs)",
    modulo: "Apolo",
    porque: "São 47 boletos e R$ 196.737,85 parados por cadastro, não por código. A tela mantém o botão de emitir travado de propósito e diz o que falta — conta do Asaas por empreendimento e cliente sem CPF.",
    situacao: "bloqueado",
    titulo: "Destravar a emissão: contas Asaas de Guaimbé e On Sky",
  },
  {
    id: "PAN-007",
    bloqueio: "Pendente com a Amanda — é conferência de contrato contra extrato, não código.",
    evidencia: "reference_vale_do_sol_caixa_numeros, medido em 25/08/2026: R$ 13.596.315,34 contratados × R$ 7.745.484,15 casados com cliente",
    modulo: "Apolo",
    porque: "Têm contrato assinado e nenhuma liberação no extrato CIWEB: ou a obra não começou a medir, ou o contrato não tem par no extrato. São R$ 5,85 mi por liberar, num empreendimento onde o dinheiro que entra é da Caixa, não do cliente.",
    situacao: "bloqueado",
    titulo: "Fechar as 22 unidades do Vale do Sol sem liberação da Caixa",
  },
  {
    id: "PAN-008",
    bloqueio: "Espera a decisão do Lucas: em 25/jul ele optou por mexer só no cockpit e deixar o modal e a CACÁ como estavam",
    evidencia: "memory/reference_iris_vinculo_nome_vazamento.md: '⚠️ NÃO tocado (a decidir depois): o modal de atendimento ATIVO (iris-start-attendance-modal.tsx) ainda deixa o operador BUSCAR por nome e ver a carteira do escolhido'. O arquivo existe em apps/hub/modules/caredesk/blocks/start-attendance/iris-start-attendance-modal.tsx",
    modulo: "Iris",
    porque: "É a última porta aberta do incidente de vazamento de 25/jul. O cockpit já foi trancado para só enriquecer com telefone que casa, mas o modal de atendimento ativo ainda deixa o operador buscar por NOME e ver a carteira de quem ele escolher. Nome é ambíguo: oito entidades começam com Ana Paula.",
    situacao: "bloqueado",
    titulo: "Travar a carteira no modal de iniciar atendimento da Íris",
  },
  {
    id: "PAN-009",
    bloqueio: "O Lucas ainda não autorizou desligar; a solução de produto que ele escolheu foi separar a central do corretor da central do cliente",
    evidencia: "memory/reference_caca_identidade_lembrada_telefone.md (medição de 05/08/2026, regra do Lucas 'atualização é feita manualmente pelo meu time', 'PENDENTE, não autorizado ainda'). A gravação segue viva: apps/hub/lib/iris/caca/executors.ts:1411 chama gravarIdentidadeLembrada",
    modulo: "Iris",
    porque: "A CACÁ grava por 30 dias que aquele telefone é aquele cliente. Quando quem consulta o CPF é o corretor, o parente ou o cônjuge, o telefone dele fica marcado como sendo do cliente e passa a receber parcelas, boletos e carteira sem nova validação. Foram medidos 21 casos com nome divergente.",
    situacao: "bloqueado",
    titulo: "Desligar a identidade lembrada da CACÁ e limpar as 28 marcações",
  },
  {
    id: "PAN-010",
    bloqueio: "Lucas, 15/08: 'depois vou trabalhar nos vinculos, pois estava misturado, com tempo vou dividindo'. Trancar antes disso esconderia a própria fila de 4 das 5 pessoas não admin, a Raiane inclusive (3.164 mensagens em 90 dias)",
    evidencia: "memory/project_iris_rls_bloqueado_vinculos.md; a migration está commitada e não aplicada em packages/database/migrations/0091_caredesk_rls_por_fila.sql (nenhuma menção a 0091 no diário), mais a branch fix/iris-mobile-regua-acesso (commit d11efb4b)",
    modulo: "Iris",
    porque: "Hoje qualquer usuário logado lê todas as conversas de todas as filas pelo PostgREST, Jurídico e RH inclusive, porque a restrição por fila só existe em JavaScript no navegador. No celular nem isso valia. É também pré-requisito do realtime.",
    situacao: "bloqueado",
    titulo: "Aplicar a RLS por fila da Íris (0091) e o fix do /m/iris",
  },
  {
    id: "PAN-011",
    bloqueio: "UPDATE em massa em produção exige OK explícito do Lucas",
    evidencia: "memory/reference_iris_direct_dono_padrao.md, seção Pendente: 'Backfill dos 23 Direct abertos sem dono foi BLOQUEADO pela trava do ambiente (UPDATE em massa). SQL pronto em docs/operations/2026-07-27-direct-dono-raiane-reversao.sql' (o arquivo está na pasta)",
    modulo: "Iris",
    porque: "O Direct é exclusividade da Raiane e a fila já nasce com ela como dona padrão, mas as 23 conversas abertas de antes da mudança continuam órfãs. Sem dono, quem não é dela pode responder e a regra vale só para conversa nova.",
    situacao: "bloqueado",
    titulo: "Backfillar os 23 Direct abertos sem dono",
  },
  {
    id: "PAN-012",
    bloqueio: "As duas configurações (Send-As e filtro nunca-spam) são cliques do Lucas dentro do Gmail da caca@",
    evidencia: "memory/project_iris_email_grupos.md: 'ÚNICO PENDENTE = Send-As de contato@ na caixa caca@ (config do Gmail do Lucas)'; 'FIX pendente do Lucas: criar filtro no Gmail da caca@ ... SEM isso perde mensagem de cliente'; 'FALTA: outbound (hoje outbound_enabled=false) + Fase C + ligar os outros grupos'",
    modulo: "Iris",
    porque: "O e-mail entra na Íris mas não sai com a cara certa: sem o Send-As o remetente vira caca@ em vez de contato@, e sem o filtro de spam mensagem de cliente se perde, porque a busca do Gmail não varre spam. Cobranca@, financeiro@, juridico@ e rh@ ainda não foram ligadas.",
    situacao: "bloqueado",
    titulo: "Fechar o e-mail da Íris: outbound, Send-As e as outras caixas",
  },
  {
    id: "PAN-013",
    bloqueio: "Standby por decisão do Lucas em 26/08, e falta o link de assinatura individual (a D4Sign manda por e-mail)",
    evidencia: "memory/project_caca_cobra_assinatura.md: 'EM STANDBY por decisão do Lucas (26/08/2026). Nada implementado, só o estudo'. Trava técnica registrada: não existe link de assinatura por pessoa",
    modulo: "Iris",
    porque: "São 78 assinaturas cobráveis em 29 pessoas, paradas 13 dias em média. O estudo mostrou que 64% do gargalo é interno (137 contratos com 2 pessoas do backoffice), então a automação destrava 78 e não 215, e o Lucas preferiu parar antes de construir.",
    situacao: "bloqueado",
    titulo: "Retomar a CACÁ cobrando assinatura de contrato",
  },
  {
    id: "PAN-014",
    bloqueio: "Abertura das contas no Asaas, ação administrativa fora do sistema",
    evidencia: "memory/project_boletos_cer_emissao.md, seção 'Ainda aberto', item 1: 'Guaimbé (29) e On Sky (18) — cadastro pendente no Asaas, R$ 196.737,85. Não é código'",
    modulo: "Hades",
    porque: "As duas carteiras estão prontas na tela e não emitem por falta de conta no Asaas: R$ 196.737,85 em 47 boletos parados. Não é código, é cadastro.",
    situacao: "bloqueado",
    titulo: "Cadastrar Guaimbé e On Sky no Asaas para liberar R$ 196 mil",
  },
  {
    id: "PAN-015",
    bloqueio: "Espera decisão comercial do Lucas e a confirmação por escrito de se a taxa da transação volta no estorno integral.",
    evidencia: "reference_pagbank_split_estudo — estudo pedido em 22/08 e aprovado em 23/08 ('otimo'), com artifact publicado",
    modulo: "Hades",
    porque: "O ciclo da casa é dividir o pagamento entre incorporador, coordenadora, corretor, captador e Careli e RETER tudo 7 a 10 dias pelo direito de arrependimento. A varredura de 10 players mostrou que ninguém faz o ciclo inteiro num recurso só; a shortlist é PagBank, Celcoin e Asaas.",
    situacao: "bloqueado",
    titulo: "Escolher o provedor do split de pagamento",
  },
  {
    id: "PAN-016",
    bloqueio: "Push na main é deploy de produção em c2x.app.br e exige OK explícito do Lucas a cada vez (CLAUDE.md §Bloqueio operacional).",
    evidencia: "git rev-list --left-right --count origin/main...HEAD = 0 11, medido em 11/09; origin/main está em 3fcd2970 (10/09 14:42)",
    modulo: "Infra",
    porque: "Todo o trabalho de hoje está só na branch wip/gerar-proposta: a tela de análise da Têmis, o contrato editável, o congelamento de preço da proposta, o runner dos hooks, as três skills e o documento do domínio. Produção segue no commit de ontem.",
    situacao: "bloqueado",
    titulo: "Subir para a main os 11 commits de 11/09",
  },
  {
    id: "PAN-017",
    bloqueio: "Espera retorno do fornecedor desde 31/08. A virada de P58 diminui a urgência: reserva e proposta passam a viver no Panteon.",
    evidencia: "docs/integrations/c2x-panteon-openapi.yaml, enviado ao time do Sulivam em 31/08/2026; project_c2x_openapi_fornecedor",
    modulo: "Infra",
    porque: "Sem elas a reserva do salão é relançada à mão com gargalo de 15 a 20 minutos, o PUT de unidade responde 405 (tabela defasada só se corrige lote a lote pela tela) e a baixa de pagamento é feita pela TELA, com script de navegador e resposta de sucesso que mente.",
    situacao: "bloqueado",
    titulo: "Cobrar do fornecedor do C2X as 19 operações da OpenAPI",
  },
  {
    id: "PAN-018",
    evidencia: "apps/hub/modules/temis/blocks/trabalho/tela-de-trabalho.tsx: bloco 'Quem assina' com o texto 'Trazê-la para esta coluna é a próxima entrega'. A decisão 5 do doc exige mostrar o removido com o aviso ao lado, e não sumir com ele.",
    modulo: "Temis",
    porque: "O Lucas pediu o PDF à direita e, à esquerda, quem assina com ordem, CPF, e-mail e a exclusão. Hoje o PDF está lá e a lista é só uma frase dizendo que ela abre no botão de enviar.",
    situacao: "fazendo",
    titulo: "Trazer quem assina para a etapa 2, com exclusão do signatário",
  },
  {
    id: "PAN-019",
    evidencia: "memory/project_cobranca_motor_ui.md ('Motor da Cobranca, tijolos 2-4 backend PRONTO local, sem deploy'); memory/project_hades_cobranca_design.md ('migration 0036 APLICADA em prod... ⏳ Falta: lib server + tipos, rotas API, cron da régua, UI no atendimento')",
    modulo: "Hades",
    porque: "As três tabelas e o protocolo PR/AC já estão em produção e o backend está escrito, mas fora do ar. Enquanto isso, promessa e acordo de pagamento continuam sendo registro manual avulso, sem entidade e sem protocolo.",
    situacao: "fazendo",
    titulo: "Subir o motor de Acordos e Promessas do Hades",
  },
  {
    id: "PAN-020",
    evidencia: "reference_precedencia_categoria_filho_pai (todas as cadeias escritas até 08/09 fazem dois níveis); P17: 'as unidades do VOL cai em uma conta e a da VOC cai em outra conta'",
    modulo: "Temis",
    porque: "Minuta, vendedora, ordem de assinatura, comissão e entrada mínima vão de categoria DIRETO para o empreendimento e pulam o filho. É o filho que decide de qual conta sai o boleto (VOL numa, VOC noutra); sem ele, a mesma tela obedece duas regras conforme o campo.",
    situacao: "proximo",
    titulo: "Fazer o nível FILHO valer nas cinco cadeias de precedência",
  },
  {
    id: "PAN-021",
    evidencia: "P31: 'a temis vai ter que enxergar a parte financeira que temos hoje no Panteon'; docs/operations/temis-redesenho-decisoes.md §1 ('fio solto declarado no mockup'); hercules_vendas está vazia",
    modulo: "Temis",
    porque: "A etapa Prazo legal só enxerga pagamento que passou pelo legado, e venda nascida no Panteon não chega ao C2X. Sem isso o card nunca fatura sozinho — alguém tem que lançar a entrada à mão no legado só para a Têmis ver.",
    situacao: "proximo",
    titulo: "Fazer a Têmis ler o pagamento da entrada pelo Panteon",
  },
  {
    id: "PAN-022",
    evidencia: "apps/hub/modules/temis/blocks/trabalho/tela-de-trabalho.tsx renderiza <EmConstrucao titulo=\"Em assinatura\"> com exatamente esse texto; pedido do Lucas em 09/09 (docs/operations/temis-redesenho-decisoes.md).",
    modulo: "Temis",
    porque: "É a etapa onde o contrato passa mais tempo e ninguém enxerga nada: quem já assinou, quem só visualizou, e de quem o e-mail voltou. Sem isso a cobrança é feita no escuro.",
    situacao: "proximo",
    titulo: "Montar a tela de monitoramento da etapa Em assinatura",
  },
  {
    id: "PAN-023",
    evidencia: "Solicitação literal em docs/operations/temis-redesenho-decisoes.md; nada no repo chama a Íris a partir da tela de trabalho.",
    modulo: "Temis",
    porque: "O Lucas pediu que o operador cobre o cliente sem sair da tela: um clique abre ticket na Íris com o template de cobrança de assinatura que a casa já tem.",
    situacao: "proximo",
    titulo: "Botão de cobrar assinatura pela Íris, abrindo o ticket do contrato",
  },
  {
    id: "PAN-024",
    evidencia: "P02 (11/09): 'podemos trocar o nome para Pré-faturamento pois assim fazemos a gestão disso'. O código chama de 'Prazo legal' em apps/hub/lib/temis/trabalhos.ts (ESTAGIOS) e o estágio gravado é prazo_legal.",
    modulo: "Temis",
    porque: "O cliente pode pagar a entrada e não assinar, ou assinar e não pagar. Enquanto as duas não fecharem o card fica parado ali, e o nome da etapa tem que dizer que aquilo é gestão, não espera de prazo.",
    situacao: "proximo",
    titulo: "Renomear Prazo legal para Pré-faturamento e separar as duas condições",
  },
  {
    id: "PAN-025",
    evidencia: "Comentário no POST de apps/hub/app/api/temis/trabalho/route.ts: 'O AVISO PARA CORRETOR E IMOBILIÁRIA AINDA NÃO SAI DAQUI'. O texto pronto está em textoDoIndeferimento (lib/temis/indeferimento.ts). Central de Relacionamento para corretor e imobiliária, Panteon para o coordenador.",
    modulo: "Temis",
    porque: "Hoje o indeferimento grava a decisão com motivo e morre na tela: quem vendeu não fica sabendo que o contrato voltou, nem o que corrigir. O motivo já é obrigatório no banco justamente para viajar nessa mensagem.",
    situacao: "proximo",
    titulo: "Disparar o indeferimento para coordenador, corretor e imobiliária",
  },
  {
    id: "PAN-026",
    evidencia: "docs/operations/temis-redesenho-decisoes.md, 'O que continua faltando': 'Régua de política (entrada abaixo do mínimo, prazo acima do plano) ainda não está no parecer'. O dado existe em apolo_enterprise_settings.entrada_minima_percentual (0128).",
    modulo: "Temis",
    porque: "O operador tem que abrir o card e ver o que está fora: entrada abaixo do mínimo do empreendimento, prazo acima do que o plano permite. Sem isso a análise é leitura de números soltos.",
    situacao: "proximo",
    titulo: "Pôr a régua de política no parecer da etapa 1",
  },
  {
    id: "PAN-027",
    evidencia: "apps/hub/lib/temis/analise-do-trabalho.ts: a assinatura de analiseDoTrabalho não recebe o tipo. A apuração de distrato/cancelamento já existe em temis_trabalhos.observacao e é usada só para o bloco do pedido.",
    modulo: "Temis",
    porque: "O tipo já virou etiqueta, mas o conteúdo continua o mesmo nos cinco: um distrato abre mostrando qualificação de comprador e condições de venda, e não o que se desfaz, quanto foi pago e o que se devolve.",
    situacao: "proximo",
    titulo: "Fazer a etapa 1 falar o idioma do tipo do trabalho",
  },
  {
    id: "PAN-028",
    evidencia: "P34 (11/09) contra classificarCancelamento em apps/hub/lib/temis/cancelamento.ts, que decide só por assinou/pagou. A data base já existe: temis_trabalhos.arrependimento_inicio (0150).",
    modulo: "Temis",
    porque: "Dentro do prazo de arrependimento o valor pago volta integralmente, sem retenção. A classificação de hoje tem quatro casos e mandaria esse para distrato com apuração normal.",
    situacao: "proximo",
    titulo: "Devolver 100% quando a desistência cai dentro dos 7 dias",
  },
  {
    id: "PAN-029",
    evidencia: "P41 (11/09): 'pode fazer automaticamente'. O enunciado da própria pergunta registra que hoje não acontece nem automático nem manual.",
    modulo: "Temis",
    porque: "Terminado o cancelamento ou o distrato, o lote tem que voltar ao estoque sozinho. Hoje a caixinha é marcada na Têmis e nada muda do lado da venda: o lote fica preso e a saída é SQL na mão.",
    situacao: "proximo",
    titulo: "Liberar a unidade automaticamente quando o jurídico conclui",
  },
  {
    id: "PAN-030",
    evidencia: "P37 (11/09): 'eu preciso cancelar ele na plataforma de assinatura e enviar o que foi corrigido'. apps/hub/lib/assinatura/clicksign/envelope.ts fala de cancelamento nos comentários mas não expõe função nenhuma que cancele.",
    modulo: "Temis",
    porque: "Corrigir um contrato já enviado exige matar o envelope errado antes de mandar o certo, senão duas versões ficam circulando para assinatura ao mesmo tempo.",
    situacao: "proximo",
    titulo: "Cancelar o envelope na Clicksign no cancelamento por correção",
  },
  {
    id: "PAN-031",
    evidencia: "podeAbrirCessao em apps/hub/lib/temis/cessao.ts tem zero chamadores (busca no repo). docs/operations/temis-redesenho-decisoes.md: 'Cessão não tem cedente nem cessionário em lugar nenhum do repo'.",
    modulo: "Temis",
    porque: "As regras da cessão estão escritas e testadas e não servem a ninguém: não há porta que abra uma, e as duas partes do negócio não existem em lugar nenhum do sistema.",
    situacao: "proximo",
    titulo: "Abrir cessão pela tela, com cedente e cessionário",
  },
  {
    id: "PAN-032",
    evidencia: "packages/database/migrations/0112_hercules_unidades_e_vendas.sql:67 (constraint hercules_unidades_situacao); reference_hercules_unidades_e_um_retrato_parado",
    modulo: "Hercules",
    porque: "O CHECK só aceita quatro estados, e na carga de 01/09 'em negociação' virou 'vendida': o VLO mostra 129 vendidas onde o C2X tem 8 vendidas e 114 em negociação. Rodar o último sync sem consertar isso congela o erro para sempre, porque não haverá outro sync depois.",
    situacao: "proximo",
    titulo: "Abrir 'em negociação' no CHECK de hercules_unidades",
  },
  {
    id: "PAN-033",
    evidencia: "P58: 'Isso aqui vc pode fazer agora, fazer o ultimo sync com o c2x pois apartir de hoje toda reserva, proposta, contratos deve sair do panteon'; scripts/hercules/carregar-unidades-do-c2x.mjs",
    modulo: "Hercules",
    porque: "O Lucas autorizou e marcou a virada: a partir de hoje reserva, proposta e contrato saem do Panteon. O cadastro atual é um retrato tirado à mão em 01/09 16:17, sem cron nenhum, e já esconde estoque — no Vale do Ouro diz 5 disponíveis onde o C2X tem 13. Fazer DEPOIS de abrir o estado 'em negociação'.",
    situacao: "proximo",
    titulo: "Rodar o último sync de unidades do C2X",
  },
  {
    id: "PAN-034",
    evidencia: "/api/incorporador/produtos/painel; reference_hercules_unidades_e_um_retrato_parado ('o painel de Produtos conta os cards por esta tabela — os números dele são de 01/09')",
    modulo: "Hercules",
    porque: "Os cards de estoque do portal contam por hercules_unidades, que é retrato à mão sem cron: mostram o mundo de 01/09 e escondem lote à venda — o erro que custa venda. O espelho público já foi corrigido; este leitor ficou para trás.",
    situacao: "proximo",
    titulo: "Tirar o painel de Produtos do retrato de 01/09",
  },
  {
    id: "PAN-035",
    evidencia: "P49: 'Extamente, vai nascer no hercules dentro do pai'; reference_lagoa_bonita_pai_e_filhos (156 propostas no pai × 536 nos filhos, medido 07/09)",
    modulo: "Hercules",
    porque: "Hoje a reserva nasce no pai (LAB) e a proposta nos filhos, e por isso 43 das 44 'reservas abertas' do masterplan são de lote já vendido numa gleba: o registro do pai fica em 'Reservado' para sempre. O Lucas fechou que a venda nova nasce no Hércules, dentro do pai.",
    situacao: "proximo",
    titulo: "Fazer a venda do Lagoa Bonita nascer no PAI",
  },
  {
    id: "PAN-036",
    evidencia: "P52: 'Esses são os empreendimentos que estão no projeto da Cecilio, ou seja, todo ele estará somente no panteon'; P53: 'Vai ser cadastrado no Panteon'; reference_garden_boletos_decisoes (190 boletos, R$ 529.015,48 em set/2026)",
    modulo: "Hercules",
    porque: "Vale do Sol, Guaimbé, Giant Towers, On Sky, os quatro edifícios da CER e o Garden movimentam R$ 529 mil de boleto por mês sem uma linha em enterprises — hoje vivem só nas tabelas lsoft_* e numa tela de emissão. O Lucas fechou que todo esse projeto existe apenas no Panteon.",
    situacao: "proximo",
    titulo: "Cadastrar no Panteon as nove carteiras que vivem fora do legado",
  },
  {
    id: "PAN-037",
    evidencia: "P51: 'Ele é o proximo empreendimento que vamos lançar, ou seja, no proximo mês vamos ativar ele para recepção de cad'; apolo_enterprise_settings.recepcao_cad",
    modulo: "Hercules",
    porque: "É o próximo empreendimento a lançar, no mês que vem. O RDV já aparece no cadastro do Panteon mas não está entre os 12 com recepcao_cad ligada — enquanto o portão estiver fechado, ninguém consegue cadastrar cliente nele.",
    situacao: "proximo",
    titulo: "Cadastrar o RDV e abrir a recepção de CAD",
  },
  {
    id: "PAN-038",
    evidencia: "project_espelho_publico §PENDENTE; migration 0128 (entrada mínima percentual em apolo_enterprise_settings)",
    modulo: "Hercules",
    porque: "O simulador da página pública usa os 10% padrão da casa, mas a entrada mínima virou dado por empreendimento e o Garden vende a 8%. Assim que o Garden ganhar planos, a página vai exigir entrada indevida do cliente, com a marca da casa em cima.",
    situacao: "proximo",
    titulo: "Ler a entrada mínima do empreendimento no espelho público",
  },
  {
    id: "PAN-039",
    evidencia: "P26 (11/09) contra apps/hub/app/api/incorporador/venda/proposta/route.ts, que chama credenciadoParaVender só com titular.cpf, nas duas passagens (pré-checagem e gravação).",
    modulo: "Hercules",
    porque: "Hoje o sócio ou o segundo comprador entra na proposta sem passar por credenciamento nenhum, e o contrato sai com alguém que a casa não analisou. Cônjuge continua fora: ele faz parte da CAD do titular.",
    situacao: "proximo",
    titulo: "Exigir CAD credenciada de todo proponente, não só do titular",
  },
  {
    id: "PAN-040",
    evidencia: "P32 (11/09) contra conferirReserva em apps/hub/lib/hercules/reserva.ts, que só exige imobiliária, e contra ModalDeReserva.tsx: 'Esta imobiliária não tem corretor cadastrado. A reserva sai no nome dela.'",
    modulo: "Hercules",
    porque: "Reserva sem corretor nomeado quebra comissão e cobrança de andamento. Quando a imobiliária não cadastrou corretor, o sistema deve apontar o representante legal dela em vez de reservar no nome da empresa.",
    situacao: "proximo",
    titulo: "Não deixar reserva nascer sem corretor; cair no representante legal",
  },
  {
    id: "PAN-041",
    evidencia: "P23, P24 e P25 (11/09) contra PRAZOS_SUGERIDOS, PRAZO_PADRAO_EM_DIAS e PRAZO_MAXIMO_EM_DIAS em apps/hub/lib/hercules/reserva.ts, e contra o texto de avisosDaReserva ('volta para a disponibilidade automaticamente').",
    modulo: "Hercules",
    porque: "Quem decide o tempo é o coordenador, caso a caso. Pior: o WhatsApp que sai para o corretor promete que a unidade volta sozinha para a disponibilidade no vencimento, e não existe rotina nenhuma que faça isso.",
    situacao: "proximo",
    titulo: "Tirar o prazo de casa da reserva e da proposta",
  },
  {
    id: "PAN-042",
    evidencia: "P25 (11/09): 'vamos deixar o coordenador decidir se ele mantem em reserva ou se derruba a reserva, ou proposta'. Nenhuma tela do Hércules filtra por validade_em vencida (busca em lib/hercules e modules/incorporador/hercules).",
    modulo: "Hercules",
    porque: "Se nada expira sozinho, alguém precisa ver o que venceu para manter ou derrubar. Sem essa lista o vencimento vira um campo que ninguém olha e a unidade fica presa indefinidamente.",
    situacao: "proximo",
    titulo: "Dar ao coordenador a fila de reservas e propostas vencidas",
  },
  {
    id: "PAN-043",
    evidencia: "P03 e P30 (11/09) contra apolo_enterprise_settings.taxa_cessao (numeric em reais, 0120) e lib/temis/variaveis.ts, onde empreendimento_taxa_cessao é tipo 'dinheiro' com exemplo R$ 500,00. A aba modules/apolo/blocks/empreendimentos/politica-comercial-tab.tsx só tem gestão, entrada e as duas comissões.",
    modulo: "Hercules",
    porque: "Os dois percentuais são do empreendimento e hoje não existem como dado: a taxa de cessão está cadastrada como valor em reais, e a retenção de distrato não está em lugar nenhum. Com eles na política, dá para padronizar ou personalizar por produto.",
    situacao: "proximo",
    titulo: "Pôr % de distrato e % de cessão na Política Comercial",
  },
  {
    id: "PAN-044",
    evidencia: "P43 (11/09): 'essa informação tem que ser colhida na abertura'. docs/operations/dominio-careli.md: busca por dados bancários em lib/temis, lib/hercules, app/api/temis e modules/temis não achou nada. ModalDePedidoDeCancelamento.tsx coleta só motivo e o ajuste da apuração.",
    modulo: "Hercules",
    porque: "O coordenador está com o cliente na linha na hora de abrir o pedido; depois o jurídico caça a informação. Hoje não existe campo, tabela nem tela que guarde conta ou chave PIX de quem está saindo.",
    situacao: "proximo",
    titulo: "Colher os dados bancários na abertura do pedido de distrato",
  },
  {
    id: "PAN-045",
    evidencia: "P42 (11/09): 'tudo vai ocorrer dentro do panteon'. Contra acaoDeCancelamento em apps/hub/lib/hercules/acao-de-cancelamento.ts, que só oferece o pedido quando u.vendaNativa é verdadeiro.",
    modulo: "Hercules",
    porque: "Onze dos treze contratos vivos correm no legado. Quando um deles é distratado, o documento e o controle têm que ficar de um lado só — o Panteon.",
    situacao: "proximo",
    titulo: "Deixar as vendas do C2X abrirem card de distrato na Têmis",
  },
  {
    id: "PAN-046",
    evidencia: "P58 e P44 (11/09): 'Isso aqui vc pode fazer agora, fazer o ultimo sync com o c2x pois apartir de hoje toda reserva, proposta, contratos deve sair do panteon'. Memória reference_hercules_unidades_e_um_retrato_parado.",
    modulo: "Hercules",
    porque: "O cadastro de unidades é um retrato tirado à mão em 01/09 e já esconde estoque. A partir de agora reserva, proposta e contrato nascem no Panteon, então esse é o último acerto com o legado.",
    situacao: "proximo",
    titulo: "Fazer o último sync do hercules_unidades e congelar o retrato",
  },
  {
    id: "PAN-047",
    evidencia: "P49 (11/09): 'vai nascer no hercules dentro do pai'. Memória reference_lagoa_bonita_pai_e_filhos: pai LAB 31 com 495 lotes, filhos LBR/LBP/LBF com 412, e 83 lotes só no pai (P48: ficam só no pai).",
    modulo: "Hercules",
    porque: "Hoje a reserva nasce no pai e a proposta no filho, e o mesmo terreno existe nos dois cadastros com códigos diferentes. Nascer tudo no pai é o que o Vale do Ouro já passou a fazer.",
    situacao: "proximo",
    titulo: "Fazer as vendas novas do Lagoa Bonita nascerem no pai",
  },
  {
    id: "PAN-048",
    evidencia: "memory/reference_apolo_cad_pessoa_trocada.md (ordem do Lucas, 20/jul: 'primeira coisa que vamos fazer é essa correção'); diário engineering-operations.md linha 41227 'DIVIDA — PRIMEIRA TAREFA DE 21/jul'; o motor da correção existe em apps/hub/lib/apolo/cad-diagnostico.ts (classificarCad, veredito 'trocado') exposto em app/api/apolo/asana/diagnostico/route.ts, mas só diagnostica; o comentário de apps/hub/lib/apolo/cadastro-cascata.ts ainda diz que a cascata NÃO pega esse caso e que rodar o diagnóstico 'continua sendo pré-requisito do envio em massa'",
    modulo: "Apolo",
    porque: "A ficha inteira (CPF, RG, nascimento, naturalidade e nome da mãe) saiu do documento do cônjuge, e é dela que nasce a CAD que o cliente assina e o cadastro que sobe ao C2X. Assinar contrato com a identidade trocada é risco jurídico, não detalhe de cadastro.",
    situacao: "proximo",
    titulo: "Corrigir as ~19 fichas de CAD montadas com a pessoa errada",
  },
  {
    id: "PAN-049",
    evidencia: "memory/reference_apolo_dedup_hash_backfill.md: 'Correção de código pendente: a consulta deveria criar a linha da esteira ou recusar antes de cobrar. Eram 6 consultas pagas sem esteira na base' (caso Lucas Henrique Ferreira Fiau, 22/08)",
    modulo: "Apolo",
    porque: "Hoje a consulta aprova, é cobrada e não move nem avisa nada: o operador reconsultou quatro vezes a mesma pessoa. São consultas pagas que aprovam crédito no vácuo, sem ninguém saber.",
    situacao: "proximo",
    titulo: "Barrar consulta de crédito em ficha sem linha na esteira",
  },
  {
    id: "PAN-050",
    evidencia: "memory/reference_disparo_contact_type_whatsapp.md (medido 05/09/2026) e o aviso 'vale varrer os outros leitores'. Ainda com filtro só phone: apps/hub/lib/apolo/disparo-credenciamento.ts:259, apps/hub/lib/hercules/quem-pode-vender.ts:218, apps/hub/app/api/incorporador/venda/cliente/route.ts:132. A regra certa já existe em apps/hub/lib/hercules/telefone-do-aviso.ts",
    modulo: "Apolo",
    porque: "3.941 entidades têm o número gravado só como 'whatsapp' e nenhum 'phone'. Quem filtra só 'phone' fica cego para 69% da base, e o disparo falha parecendo dado faltando do parceiro. Foi assim que cinco de cinco avisos à RAIANE IMOBILIARIA falharam.",
    situacao: "proximo",
    titulo: "Varrer os leitores que buscam telefone só em contact_type=phone",
  },
  {
    id: "PAN-051",
    evidencia: "memory/project_iris_cockpit_cadastro_apolo.md item 3: 'o índice único de documento foi dropado na 0026 e nunca voltou; dedup é opt-in e só 2 de 6 chamadas de createApoloEntity passam'; memory/reference_apolo_dedup_hash_backfill.md ('sem índice único no hash'; merge das duplicatas Lucélia/Ronaldo segue pendente)",
    modulo: "Apolo",
    porque: "Sem índice único no banco e com a dedup opt-in, a mesma pessoa vira duas fichas, e a duplicata nasce presa na esteira sem saber que o crédito já foi aprovado na original. Foi exatamente o caso Lucélia/Ronaldo.",
    situacao: "proximo",
    titulo: "Devolver a unicidade de documento e tornar a dedup obrigatória",
  },
  {
    id: "PAN-052",
    evidencia: "memory/reference_apolo_empreendimento_faltante.md: '/api/apolo/cadastro/salvar (origem cadastro-formulario) NÃO grava... PENDENTE (Lucas adiou): cadastro manual passar a EXIGIR e gravar o empreendimento pro PROSPECT'; repetido em memory/project_esteira_credenciamento_venda.md ('fazer o wizard exigir empreendimento')",
    modulo: "Apolo",
    porque: "Ficha sem empreendimento some do relatório da imobiliária, quebra o aviso ao coordenador e provavelmente some da fila do Prometeu. O portal público já grava; o wizard interno é o buraco que continua produzindo ficha órfã.",
    situacao: "proximo",
    titulo: "Exigir e gravar o empreendimento no cadastro manual de prospect",
  },
  {
    id: "PAN-053",
    evidencia: "docs/operations/dominio-careli.md, respostas do Lucas de 11/09/2026: P12 'Essa informação tem que viver dentro do apolo, sim, vamos ter um cadastro de coordenadoras, podemos importar essa informação do C2X, mas daqui pra frente vamos nascer dentro do apolo'; P20 'aqui no Panteon vamos ter o cadastro correto que é de coordenador comercial'; migration 0145 criou coordenadora_entity_id e nenhum empreendimento está preenchido",
    modulo: "Apolo",
    porque: "Sem nome de coordenadora o bloco 'a. COORDENADORA DE VENDAS' do contrato sai com cinco colchetes. O Lucas decidiu em 11/09 que essa informação passa a nascer no Apolo, e o papel que o C2X chama de 'Gerente' vira 'coordenador comercial' aqui.",
    situacao: "proximo",
    titulo: "Criar o cadastro de coordenadoras de venda dentro do Apolo",
  },
  {
    id: "PAN-054",
    evidencia: "docs/operations/dominio-careli.md P26 (11/09/2026): 'Todos os proponentes precisam ter cads credenciadas para aquele empreendimento. Conjuge não é proponente, ele faz parte da CAD do titular' contra o texto da pergunta, que registra 'Hoje o sistema exige só a do titular'",
    modulo: "Apolo",
    porque: "O sistema hoje libera a venda com a CAD do titular apenas. O Lucas fechou a regra em 11/09: todo proponente precisa da própria CAD credenciada naquele empreendimento, e cônjuge não é proponente, ele faz parte da CAD do titular.",
    situacao: "proximo",
    titulo: "Exigir CAD credenciada de todos os proponentes, não só do titular",
  },
  {
    id: "PAN-055",
    evidencia: "memory/project_apolo_cadastro_prospect.md: 'PJ em prod NÃO funciona (detecção não dispara, MOST classifica cartão CNPJ como genérico; falta detecção por CNPJ + enrich CARELI_PJ_01)' e 'enriquecimento PJ (CARELI_PJ_01 por CNPJ) ainda não wired no código'",
    modulo: "Apolo",
    porque: "O cadastro de PJ (imobiliária, fornecedor, vendedora) não enriquece: a MOST classifica o cartão CNPJ como documento genérico e a detecção não dispara. Quem cadastra empresa preenche tudo à mão.",
    situacao: "proximo",
    titulo: "Ligar o enriquecimento PJ da MOST em produção",
  },
  {
    id: "PAN-056",
    evidencia: "project_backlog_jdg_pos_evento §3; lib/apolo/cadastrar-unidades-server.ts:323 (atualizarUnidades); scripts/hercules/carregar-unidades-do-c2x.mjs ('os valores das unidades do jdg, estão erradas')",
    modulo: "Apolo",
    porque: "Os preços das unidades do JDG estão errados e o Lucas precisa corrigir em massa. A lógica de diff já existe e nunca foi exercitada porque dependia do PUT do C2X, que responde 405 — agora que as unidades moram no Panteon, essa dependência some. Status de venda fica de fora de propósito: planilha velha não pode rebaixar lote vendido.",
    situacao: "proximo",
    titulo: "Dar tela ao importador que atualiza preço, área e matrícula",
  },
  {
    id: "PAN-057",
    evidencia: "project_boletos_cer_emissao §'Ainda aberto' itens 3 e 4 (revisão adversarial de 60 agentes, 37 achados confirmados)",
    modulo: "Apolo",
    porque: "A carga nunca apaga linha removida da planilha, o casamento por semelhança aceitaria pai e filho ('JOSE CARLOS' × 'JOSE CARLOS JUNIOR') e a observação 'já pagou setembro' é texto fixo que não sai sozinho. Em setembro não morderam; na próxima emissão, mordem.",
    situacao: "proximo",
    titulo: "Consertar os 17 achados que mordem na emissão de outubro",
  },
  {
    id: "PAN-058",
    evidencia: "memory/reference_iris_vinculo_nome_vazamento.md, correção proposta (3): 'AUDITAR outros tickets resolvidos por nome (mesmo padrão pode ter vazado mais)'. Não há registro de execução na memória nem no diário",
    modulo: "Iris",
    porque: "O vazamento do AT-000743 foi achado por acaso, quando o Lucas olhou um ticket. A terceira correção proposta na investigação foi varrer os outros atendimentos com o mesmo padrão, e ninguém sabe quantos são.",
    situacao: "proximo",
    titulo: "Auditar os atendimentos antigos resolvidos por nome",
  },
  {
    id: "PAN-059",
    evidencia: "memory/reference_iris_ticket_duplicado_reabertura.md (caso Lena/Marilene, AT-000679 e AT-001434, correção desenhada em 4 passos com OK do Lucas em 29/jul); memory/reference_iris_card_um_por_cliente.md, 26/08: o inbound já escolhe o aberto, mas o caso do antigo reaberto 'segue sem a trava de consolidação'",
    modulo: "Iris",
    porque: "Quando um atendimento encerrado é reaberto por cima de um vivo, o cliente fica com dois cards, as mensagens sem reply se dividem entre eles e dois atendentes respondem em paralelo. A regra do Lucas é um atendimento aberto por cliente.",
    situacao: "proximo",
    titulo: "Consolidar contato com mais de um atendimento aberto",
  },
  {
    id: "PAN-060",
    evidencia: "memory/reference_iris_card_um_por_cliente.md: 'dos 92 contatos com atendimento aberto, 76 têm cadastro e em 60 o nome salvo era o apelido do WhatsApp... ⏳ Pendente: os 60 contatos já gravados com apelido só se corrigem na próxima mensagem, falta um backfill'",
    modulo: "Iris",
    porque: "Regra do Lucas: se o cliente tem cadastro, o nome vem do Apolo. A tela já corrige e o inbound já grava, mas os 60 contatos antigos só se corrigem quando a pessoa mandar mensagem de novo. Até lá busca, relatório e exportação continuam mostrando apelido.",
    situacao: "proximo",
    titulo: "Backfillar os 60 contatos salvos com o apelido do WhatsApp",
  },
  {
    id: "PAN-061",
    evidencia: "apps/hub/modules/caredesk/IrisPage.tsx:2263 ('Carteira em breve') e :2272 ('Historico em breve'), ambos com disabled: true; memory/project_backlog_pendentes.md item 4 ('Aba Carteira no cockpit da Iris, hoje stub em breve; reusar CarteiraTab + redesign completo do cockpit')",
    modulo: "Iris",
    porque: "Os dois atalhos estão desabilitados com o rótulo 'em breve'. O atendente que precisa ver a carteira ou o histórico do cliente sai do cockpit para procurar em outro lugar, que é justamente o que o cockpit existe para evitar.",
    situacao: "proximo",
    titulo: "Ligar as abas Carteira e Histórico do cockpit da Íris",
  },
  {
    id: "PAN-062",
    evidencia: "memory/project_caca_claude_migration.md, ROADMAP do Lucas: '2) ATHENA (cockpits Iris+Hades) migrar pro motor Claude (runClaudeAgent) — PRÓXIMO'; memory/project_backlog_pendentes.md item 5",
    modulo: "Iris",
    porque: "A Athena é a assistente do operador nos cockpits da Íris e do Hades e ainda roda no motor antigo, enquanto a CACÁ já virou agente com ferramentas. É o item 2 do roteiro que o próprio Lucas ordenou.",
    situacao: "proximo",
    titulo: "Migrar a Athena para o motor Claude",
  },
  {
    id: "PAN-063",
    evidencia: "memory/reference_lavra_boletos_menores_agosto.md: 'A próxima emissão em massa repete o erro... A janela para evitar isso fecha na emissão de setembro'. Script pronto e conferido: CORRIGIR-AGUARDANDO-IPCA.js (11 unidades, incluir LOS0603 e LOS0619)",
    modulo: "Hades",
    porque: "52 boletos de agosto saíram abaixo do valor (R$ 2.264,56) porque o cadastro estava defasado havia meses. As parcelas de setembro a dezembro das mesmas 27 unidades continuam defasadas e sem boleto, e a próxima emissão em massa repete o erro com três meses de diferença em vez de dois.",
    situacao: "proximo",
    titulo: "Corrigir as parcelas 09-12 defasadas do Lavra antes da emissão",
  },
  {
    id: "PAN-064",
    evidencia: "memory/project_boletos_cer_emissao.md, 'Ainda aberto' itens 3 e 4: '17 achados da revisão que não mordem nesta emissão mas mordem na de outubro' e o caso VITOR AUGUSTO (Ed. Cristal 201)",
    modulo: "Hades",
    porque: "A revisão da emissão de setembro deixou 17 achados que não morderam naquele mês e mordem no próximo: a carga nunca apaga linha removida da planilha, o casamento por semelhança aceitaria pai e filho, e observações fixas como 'já pagou setembro' não saem sozinhas em outubro.",
    situacao: "proximo",
    titulo: "Blindar a carga dos boletos para a emissão de outubro",
  },
  {
    id: "PAN-065",
    evidencia: "memory/project_hades_pendentes.md: '⬜ Visão geral do /hades/cobranca (aba estratégica, A MAIOR): resumo da carteira em destaque, cockpit de IA/risco, log do workflow, alertas concentrados, recolher a fila diária. Método: mockup, valida, implementa'",
    modulo: "Hades",
    porque: "É a maior peça de UI que ficou de fora do go-live: resumo da carteira, risco e tendência de evasão, log de quem fez o quê e alertas concentrados, com a fila diária recolhida. Hoje o gestor só enxerga a fila do dia.",
    situacao: "proximo",
    titulo: "Construir a aba Visão geral do /hades/cobranca",
  },
  {
    id: "PAN-066",
    evidencia: "docs/operations/temis-redesenho-decisoes.md §'Testes com cliente falso, removidos' — Lucas: 'pode tirar os fakes, deixa só os testes reais'",
    modulo: "Infra",
    porque: "O Supabase falso concorda com quem o escreveu, não com o Postgres — foi por isso que um maybeSingle que ERRA com duas linhas passou meses sem ser notado e deixaria contrato assinado preso, calado. Quatro arquivos da Têmis já saíram; sobram Apolo, Íris e Prometeu.",
    situacao: "proximo",
    titulo: "Varrer os 25 arquivos de teste com Supabase falso",
  },
  {
    id: "PAN-067",
    bloqueio: "Depende de decidir de onde sai o pagamento da venda nascida no Panteon: a carteira do Panteon ainda é alimentada pelo sync do C2X.",
    evidencia: "EtapaDoPrazoLegal em tela-de-trabalho.tsx tem <EmConstrucao titulo=\"A entrada\">. P01 e P31: a Têmis tem que enxergar o financeiro que já existe no Panteon (a carteira alimentada pelo sync), não só o painel de sinal do C2X.",
    modulo: "Temis",
    porque: "Faturado é 7 dias cumpridos MAIS entrada paga (à vista ou a primeira parcela). Hoje a etapa mostra só o contador de dias, e a venda que nasce no Panteon não tem como provar pagamento nenhum.",
    situacao: "depois",
    titulo: "Ler a entrada paga e acender o botão de faturar",
  },
  {
    id: "PAN-068",
    bloqueio: "Depende da % de retenção existir como dado por empreendimento.",
    evidencia: "P04 e P33 (11/09); docs/operations/dominio-careli.md: 'O SISTEMA NÃO CALCULA A RETENÇÃO — não há fórmula, percentual configurável ou tabela em lugar nenhum do repositório'.",
    modulo: "Temis",
    porque: "Hoje é conta à mão do jurídico, marcada como feita. O ato faz parte da entrada e não se retém integralmente por regra, e a devolução pode ser única ou parcelada conforme o acordo — nada disso tem onde ser registrado.",
    situacao: "depois",
    titulo: "Calcular a retenção do distrato e registrar a devolução",
  },
  {
    id: "PAN-069",
    bloqueio: "Depende de existir uma tela que abra cessão.",
    evidencia: "P38, P39 e P40 (11/09). A trava de inadimplência é qualquer parcela vencida e não paga, sem tolerância — é o que lib/temis/cessao.ts já assume e ainda não é exercido por ninguém.",
    modulo: "Temis",
    porque: "Cessão é troca de nome do proponente: preço, reajustes já aplicados e obrigações permanecem os mesmos, e o cedente sai desobrigado ao assinar. Qualquer recálculo a valor de hoje seria um contrato novo disfarçado.",
    situacao: "depois",
    titulo: "Fazer o contrato do cessionário nascer idêntico ao do cedente",
  },
  {
    id: "PAN-070",
    bloqueio: "Precisa ser feito nas cinco de uma vez; mexer em uma só faz a mesma tela obedecer duas regras diferentes.",
    evidencia: "Memória reference_precedencia_categoria_filho_pai (08/09), com a tabela das cinco cadeias e das migrations 0140, 0141, 0142, 0145 e 0128.",
    modulo: "Temis",
    porque: "A regra da casa é categoria, depois filho, depois pai — o menor recorte configurado ganha. O código vai de categoria direto ao empreendimento em minuta, vendedora, ordem de assinatura, comissão e entrada mínima, pulando o filho, que tem cadastro próprio.",
    situacao: "depois",
    titulo: "Implementar o nível do filho nas cinco cadeias de precedência",
  },
  {
    id: "PAN-071",
    bloqueio: "Falta a tabela de anexo por unidade/categoria/empreendimento e o campo de capa na minuta.",
    evidencia: "apps/hub/lib/temis/variaveis.ts: capa_contrato e o grupo de anexo estão com fonte PENDENTE ('tabela a construir'). Memória project_contrato_pecas_anexos: 'Nada disso está construído'.",
    modulo: "Temis",
    porque: "O contrato é capa mais corpo mais anexos, e só o corpo existe. A variável de anexo marca um lugar na cláusula em vez de virar texto, e a quantidade nasce do que foi importado — nada disso tem tabela.",
    situacao: "depois",
    titulo: "Construir a capa e os anexos do contrato",
  },
  {
    id: "PAN-072",
    bloqueio: "Depende de a % de cessão virar campo da política comercial primeiro.",
    evidencia: "P05 (11/09): 'vamos apontar qual a % fica com a careli e qual fica com o incorporador', por empreendimento pai.",
    modulo: "Hercules",
    porque: "A taxa não fica inteira com ninguém: cada empreendimento pai tem a sua divisão, e isso muda o líquido do loteador. Sem o campo, a cessão cobra e ninguém sabe de quem é o dinheiro.",
    situacao: "depois",
    titulo: "Repartir a taxa de cessão entre Careli e incorporador",
  },
  {
    id: "PAN-073",
    bloqueio: "O split só vem para o Panteon com a migração do financeiro, em janeiro.",
    evidencia: "P20 (11/09): 'aqui no Panteon vamos ter o cadastro correto que é de coordenador comercial'. perfilPorPapel em apps/hub/lib/apolo/c2x-write.ts só conhece prospect, imobiliaria e incorporador.",
    modulo: "Hercules",
    porque: "O que o C2X chama de Gerente é um colaborador PJ da Gurgel, cadastrado lá como imobiliária por falta de opção. No Panteon ele precisa do nome certo, porque é dele a % que vai entrar no split.",
    situacao: "depois",
    titulo: "Criar o cadastro de coordenador comercial, o Gerente do split",
  },
  {
    id: "PAN-074",
    bloqueio: "Depende da data de lançamento que o Lucas vai definir no mês que vem",
    evidencia: "docs/operations/dominio-careli.md P51 (11/09/2026): 'Ele é o proximo empreendimento que vamos lançar, ou seja, no proximo mês vamos ativar ele para recepção de cad'",
    modulo: "Apolo",
    porque: "É o próximo empreendimento a lançar. Ele já existe no cadastro do Panteon mas está fora da lista dos 11 que recebem CAD, então nenhuma imobiliária consegue mandar ficha para ele.",
    situacao: "depois",
    titulo: "Ativar a recepção de CAD do Recanto do Vale (RDV 43)",
  },
  {
    id: "PAN-075",
    bloqueio: "Depende do modelo de empreendimento pai/filho do Hércules e da decisão de qual conta emite",
    evidencia: "docs/operations/dominio-careli.md P53 (11/09/2026): 'Vai ser cadastrado no Panteon'; memory/project_apolo_boletos_tela.md (Vale do Sol 102 boletos) e memory/reference_vale_do_sol_caixa_numeros.md",
    modulo: "Apolo",
    porque: "Hoje o Vale do Sol só existe dentro do LSoft e da emissão de boletos, e é a maior carteira da emissão mensal (102 boletos). Sem cadastro no Panteon ele fica fora de unidade, masterplan, espelho e de qualquer visão de produto.",
    situacao: "depois",
    titulo: "Cadastrar o Vale do Sol como empreendimento no Panteon",
  },
  {
    id: "PAN-076",
    bloqueio: "Data posta pelo Lucas: janeiro. Antes é preciso decidir o provedor do split e onde as parcelas passam a viver.",
    evidencia: "P13: 'em janeiro vou migrar a parte financeira para dentro do HUB'; 52 arquivos com getHadesDbPool (37 no Apolo, 6 no Guardian, 4 no Prometeu), medido 11/09",
    modulo: "Hades",
    porque: "É a última função grande que ainda mora no legado, e o Lucas marcou janeiro. Hoje a carteira de cada cliente é alimentada por sync do C2X e 52 arquivos do hub leem o MySQL do legado direto — enquanto isso durar, o Panteon não é fonte da verdade do dinheiro.",
    situacao: "depois",
    titulo: "Migrar o financeiro para dentro do Panteon",
  },
  {
    id: "PAN-077",
    bloqueio: "Depende do financeiro estar dentro do Panteon e do provedor de split escolhido.",
    evidencia: "P13: 'além de apontar esse valor eu vou apontar a divisão desse valo, assim como as demais parcelas da entrada e do financiamento'",
    modulo: "Hades",
    porque: "Hoje o empreendimento guarda só o valor de pré-venda (o ato). Em janeiro passa a guardar também COMO esse valor se divide, e o mesmo para as parcelas da entrada e do financiamento — é o que finalmente responde se o Ato vai inteiro para a cadeia de comissão, em regime de caixa.",
    situacao: "depois",
    titulo: "Cadastrar a divisão do split por parcela",
  },
  {
    id: "PAN-078",
    bloqueio: "O Lucas adiou em P47. Trocar para sale_blocked move o número dos dois painéis de uma vez, então precisa ser decisão, não conserto solto.",
    evidencia: "P47: 'não precisa alterar nada ainda dessa frente'; reference_bi_preco_um_real_esconde_estoque, medido 09/09/2026",
    modulo: "Prometeu",
    porque: "O BI usa price > 1 como prova de que o lote existe comercialmente: os 46 bloqueados do VOL saem da conta e o painel diz 93,7% vendido, enquanto o VOC diz 67,2% tendo vendido praticamente a mesma coisa. Os 46 não têm preço em lugar nenhum, nem no pai.",
    situacao: "depois",
    titulo: "Tirar o preço de R$ 1,00 do denominador do BI",
  },
  {
    id: "PAN-079",
    bloqueio: "Sem data: o lançamento já passou e a fase 2 não acontece. Reabrir só se um novo evento usar o telão do JDG.",
    evidencia: "project_backlog_jdg_pos_evento §1 (material em scripts/prometeu/masterplan-jdg/); P57: 'Acho que não vamos lançar a segunda fase do JDG'",
    modulo: "Prometeu",
    porque: "As quadras 05, 07, 09-11, 30-35 e 38-46 ainda usam o traçado v2, aproximado. Não é urgente: o evento fechou funcionando e a fase 2 foi encerrada de vez, então o mapa não vai crescer nem ser projetado de novo tão cedo.",
    situacao: "depois",
    titulo: "Redesenhar as 20 quadras do JDG com geometria aproximada",
  },
  {
    id: "PAN-080",
    bloqueio: "Depende do último sync de unidades ter rodado e das telas que ainda leem o legado terem sido varridas.",
    evidencia: "vercel.json: /api/guardian/sync/c2x, /api/apolo/sync/c2x e /api/apolo/sync/c2x/incremental; P31: 'a unica coisa que estamos ainda com sync é a parte financeira'",
    modulo: "Infra",
    porque: "Depois do último sync, a única coisa que continua vindo do legado é o financeiro. Hoje três crons ainda batem no MySQL do C2X: o do Hades a cada 15 min, o do Apolo a cada 6 h e o incremental a cada 5 min — leitura que disputa conexão com o Rails de produção sem precisar.",
    situacao: "depois",
    titulo: "Desligar os crons de sync do C2X que não são financeiros",
  },
  {
    id: "PAN-081",
    bloqueio: "Aplicar em produção é operação sensível e ainda espera OK explícito do Lucas.",
    evidencia: "packages/database/migrations/0152_temis_contrato_editado_a_mao.sql (commit fc5fbf81, 11/09); docs/operations/temis-redesenho-decisoes.md §'O contrato editável (aguarda OK)'",
    modulo: "Temis",
    porque: "Sem lugar para a exceção do caso concreto, ela acontece FORA do sistema: alguém baixa o PDF, ajusta no Word e manda assinar, e o papel que foi ao cartório deixa de ser o que o Panteon conhece. A tabela guarda o sha-256 da base para avisar quando o cadastro mudar depois da edição.",
    situacao: "entregue",
    titulo: "Escrever a migration 0152 do contrato editado à mão",
  },
  {
    id: "PAN-082",
    evidencia: "v1.310.0 em 10/09 (apps/hub/lib/changelog/changelog.ts) + packages/database/migrations/0150_temis_cinco_etapas_e_indeferimento.sql, aplicada em produção sobre 8 trabalhos vivos sem tocar estagio_desde. Catálogo de 6 motivos em apps/hub/lib/temis/indeferimento.ts.",
    modulo: "Temis",
    porque: "O quadro terminava em Finalizado no instante da assinatura, e assinar não é vender: faltavam os 7 dias de arrependimento e a entrada paga. Agora o card tem para onde ir depois de assinado, e existe uma coluna para o trabalho recusado.",
    situacao: "entregue",
    titulo: "Quadro da Têmis em cinco etapas, com a coluna de indeferidos",
  },
  {
    id: "PAN-083",
    evidencia: "Commits 59501348 e 8c3c9ee0 + packages/database/migrations/0151_proposta_congela_tabela_e_ajuste.sql; seções de 10 e 11/09 em docs/operations/temis-redesenho-decisoes.md.",
    modulo: "Temis",
    porque: "Quem abria um cancelamento lia uma tela de venda. Agora o tipo é etiqueta no cabeçalho, o pedido é o primeiro bloco, e a proposta congela preço de tabela e ajuste para o desconto ser detectável em vez de tautologia.",
    situacao: "entregue",
    titulo: "Etapa 1 vira parecer de análise, com o pedido e o tipo do trabalho",
  },
  {
    id: "PAN-084",
    evidencia: "Commit fc5fbf81; packages/database/migrations/0152_temis_contrato_editado_a_mao.sql; apps/hub/app/api/temis/contrato/gerar/route.ts usa lerEdicao antes de montar o PDF.",
    modulo: "Temis",
    porque: "Sem lugar para a exceção do caso concreto, ela acontecia fora: alguém baixava o PDF, ajustava no Word e mandava assinar. Agora a edição fica no sistema, faxinada no servidor, com autor e sha-256 da base.",
    situacao: "entregue",
    titulo: "Contrato editável à mão antes de gerar, com aviso de base mudada",
  },
  {
    id: "PAN-085",
    evidencia: "v1.302.0 e v1.303.0; packages/database/migrations/0149_temis_envelopes_de_assinatura.sql; apps/hub/modules/temis/blocks/assinatura/enviar-para-assinatura.tsx.",
    modulo: "Temis",
    porque: "É a ponte que faltava para o contrato sair do Panteon e chegar a quem assina, sem depender do legado nem do D4Sign, que ficou de reserva.",
    situacao: "entregue",
    titulo: "Envio do contrato para a Clicksign, com ordem e e-mail editáveis",
  },
  {
    id: "PAN-086",
    evidencia: "commit d9a9e25a (10/09, v1.308.0); lib/hercules/links-do-empreendimento.ts; P50: 'ele não vai ter espelho, somente grade'",
    modulo: "Hercules",
    porque: "O corretor manda um link sem login com o estoque e a simulação de pagamento. Os 29 empreendimentos sem masterplan abrem na grade — que é exatamente o que o Lucas decidiu para o ACP, então aquele produto já está atendido sem desenhar nada.",
    situacao: "entregue",
    titulo: "Publicar o espelho público com mapa ou grade",
  },
  {
    id: "PAN-087",
    evidencia: "diário docs/operations/engineering-operations.md, 2026-08-21 'A ESTEIRA DA CAD PASSOU A FALAR (v1.174.0/v1.175.0/v1.176.0)'; código em apps/hub/lib/apolo/esteira-avisos.ts (inclui a etapa correcao, linha 57)",
    modulo: "Apolo",
    porque: "Cinco das sete etapas não avisavam ninguém e o corretor nunca tinha sido avisado uma vez sequer (2.249 disparos, zero do tipo corretor). Agora cada movimento da esteira fala, pelo número do Relacionamento, e a tela mostra falha e espera em vez de pintar reprovado como quem espera.",
    situacao: "entregue",
    titulo: "Esteira da CAD passou a avisar corretor e coordenador",
  },
  {
    id: "PAN-088",
    evidencia: "memory/reference_iris_card_um_por_cliente.md (v1.211.0, 26/08/2026): escolherTicketDoInbound com 5 testes em meta-inbound-processor.ts e resolverNomeDoApolo gravando nos dois caminhos do findOrCreateContact",
    modulo: "Iris",
    porque: "Duas correções que o Board sabia menos que a conversa: o reply-context ressuscitava atendimento encerrado por cima de um vivo (dois atendentes em paralelo) e o contato ficava salvo com o apelido do WhatsApp em 60 de 76 casos com cadastro.",
    situacao: "entregue",
    titulo: "Um atendimento aberto por cliente e nome vindo do Apolo",
  },
  {
    id: "PAN-089",
    evidencia: "memory/project_boletos_cer_emissao.md (v1.250.0, 01-02/09/2026), migrations 0114 a 0119, testado de ponta a ponta com boleto real na conta CER",
    modulo: "Hades",
    porque: "Nove carteiras passaram a emitir do zero ao WhatsApp na mesma tela, com histórico por linha e correção sem sair dela. 319 boletos prontos, R$ 889.723,49, e a emissão passou para o financeiro.",
    situacao: "entregue",
    titulo: "Boletos do portal CER: ciclo completo no ar",
  },
  {
    id: "PAN-090",
    evidencia: "commit be310326 (11/09/2026) — scripts/panteon-hook-runner.ps1, 351 linhas. ⚠️ CLAUDE.md ainda declara que o runner 'segue ausente': o texto não foi atualizado no mesmo commit.",
    modulo: "Infra",
    porque: "Entre 23/05 e hoje NADA foi conferido antes de nenhum commit deste repo — .env, chave, senha, marcador de conflito e binário acima de 2 MB passavam direto (já aconteceu duas vezes). O pre-push também barra push na main sem changelog atualizado, que é a regra do Lucas que mais escapa na pressa.",
    situacao: "entregue",
    titulo: "Religar o runner dos hooks de commit e push",
  },
  {
    id: "PAN-091",
    evidencia: ".claude/skills/deploy-panteon/SKILL.md, .claude/skills/migration-supabase/SKILL.md, .claude/skills/medir-antes-de-afirmar/SKILL.md — commit be310326 (11/09)",
    modulo: "Infra",
    porque: "Procedimento que vivia diluído no CLAUDE.md e na memória passa a entrar só quando o assunto aparece. A trava de 'aplicar migration exige OK a cada vez' passa a ser lida na hora de aplicar, e não recuperada de memória.",
    situacao: "entregue",
    titulo: "Carregar deploy, migration e medição como skills",
  },
  {
    id: "PAN-092",
    evidencia: "docs/operations/dominio-careli.md (113 KB, 210 fatos + 58 respostas literais) — commits 3040fe1b, cd5405f3 e 49ca02ce (11/09)",
    modulo: "Infra",
    porque: "O documento passou a ter PRECEDÊNCIA sobre o que foi deduzido do código: onde os dois divergirem, a divergência é defeito a corrigir, não dúvida. É a base de todo este roadmap — empreendimentos, legado, financeiro e cadeia comercial.",
    situacao: "entregue",
    titulo: "Escrever o domínio da Careli com as 58 respostas do Lucas",
  },
  {
    id: "PAN-093",
    evidencia: "Lucas (11/09/2026): 'uma plataforma feita com superagentes para realizar atendimento ao usuario'; e a dor: 'nao estou dando conta de pensar e desenvolver os novos modulos, melhorias e atender a demanda interna nossa (...) estou recebendo muitas criticas'. Medido no mesmo dia: 30 tickets parados em hub_it_tickets, 27,9 dias de idade media, o mais antigo ha 66 dias.",
    modulo: "Zeus",
    porque: "Hoje o usuario preenche um formulario e espera. A plataforma troca isso por uma conversa que resolve na hora ou encaminha sabendo para onde - o ticket vira subproduto do atendimento, e nao o produto. Lucas corrigiu o enquadramento: 'nao queria um canal de abertura de ticket, queria uma plataforma de atendimento ao usuario'.",
    situacao: "proximo",
    titulo: "Chat de atendimento no hub, com agente de nivel 1",
  },
  {
    id: "PAN-094",
    evidencia: "Medido em 11/09/2026: dos 30 em status 'novo', 15 erro, 12 melhoria, 3 bug. hub_it_tickets ja tem a coluna category com esses valores.",
    modulo: "Zeus",
    porque: "Dos 30 chamados parados, 12 sao MELHORIA - nao precisam de conserto nenhum, precisam entrar no backlog e a pessoa saber que foi ouvida. Essa fatia sozinha e 40% da fila, e o agente a resolve so encaminhando direito.",
    situacao: "proximo",
    titulo: "Triagem automatica: duvida, melhoria ou erro",
  },
  {
    id: "PAN-095",
    evidencia: "apps/hub/app/api/squadops/copilot/route.ts (379 linhas) usa completeWithClaude e loadHubCodeContext; hoje autorizado so para admin do Zeus.",
    modulo: "Zeus",
    porque: "Lucas quer o agente 'conhecendo todos os modulos, tendo acesso ao codigo main, para que ele possa fazer um diagnostico preciso'. A peca existe: o copiloto do Zeus ja monta contexto de codigo e fala com o Claude - falta apontar para o usuario em vez de para o admin.",
    situacao: "proximo",
    titulo: "Diagnostico com leitura do codigo, no molde do copiloto do Zeus",
  },
  {
    id: "PAN-096",
    evidencia: "memory/reference_iris_vinculo_nome_vazamento.md (marcado CORRIGIR); e a fala do Lucas pedindo que o agente 'possa olhar o comportamento via banco para identificar o erro'.",
    modulo: "Zeus",
    porque: "O agente vai olhar o banco para diagnosticar. Se ele consultar sem herdar as permissoes de quem abriu o chamado, o atendimento vira porta lateral para dados que a pessoa nao veria pela tela. A casa ja teve vazamento assim na Iris, por vinculo de nome - isso precisa nascer certo, nao ser ajustado depois.",
    situacao: "proximo",
    titulo: "Escopo de dados do agente pela permissao de quem pergunta",
  },
  {
    id: "PAN-097",
    bloqueio: "Depende do chat existir primeiro.",
    evidencia: "Lucas: 'se o agente ainda nao entendeu que ele possa solicitar print, video, evidencia, ou acompanhar o usuario em uma operacao assistida'.",
    modulo: "Zeus",
    porque: "Quando o agente nao entendeu, ele pede em vez de chutar - e um diagnostico com evidencia e o que separa um ticket util de um 'nao funciona'. hub_it_ticket_attachments ja existe.",
    situacao: "depois",
    titulo: "Pedir evidencia na conversa: print, video, operacao assistida",
  },
  {
    id: "PAN-098",
    bloqueio: "Depende da triagem e do diagnostico estarem de pe.",
    evidencia: "Fala do Lucas + o padrao das tres sessoes da casa (memory/project_tres_sessoes_do_lucas.md): Zeus constroi, Dados mede, Plantao corrige.",
    modulo: "Zeus",
    porque: "Lucas pediu 'automacao de correcao'. O que se automatiza com seguranca e tudo ATE a correcao: reproduzir, diagnosticar, achar o arquivo, propor o diff, rodar o teste. Subir sozinho nao - o risco nao e o agente errar, e errar COM CONFIANCA e ninguem perceber ate o cliente ver.",
    situacao: "depois",
    titulo: "Ponte com o plantao: o agente prepara a correcao, o humano aprova",
  },
  {
    id: "PAN-099",
    bloqueio: "Depende do chat e da ligacao ticket-roadmap.",
    evidencia: "Lucas: 'feito as correcoes, ou entregue as melhorias responder o usuario no help'. A ligacao com o roadmap ja existe: o item entregue tem entregueEm.",
    modulo: "Zeus",
    porque: "E o passo que fecha o ciclo e o que mais pesa na percepcao: a critica de hoje e menos sobre demora em corrigir e mais sobre SILENCIO - 28 dias sem nada visivel acontecer.",
    situacao: "depois",
    titulo: "Avisar o usuario quando a correcao ou a melhoria for entregue",
  },
  {
    id: "PAN-100",
    entregueEm: "2026-09-11",
    evidencia: "Commit de 11/09/2026 em lib/hub-it-tickets/server.ts: insertHelpDeskNotification na criacao, com admsDoHelpDesk (operational_profile='adm').",
    modulo: "Zeus",
    porque: "createHubItTicket gravava o chamado e ia embora: ninguem era notificado, e o chamado esperava alguem abrir o board por acaso. E a causa direta dos 27,9 dias de idade media dos 30 parados.",
    situacao: "entregue",
    titulo: "Avisar os adms quando um chamado nasce",
  },
  {
    id: "PAN-101",
    entregueEm: "2026-09-11",
    evidencia: "Medido em 11/09/2026: parados_sem_dono = 30 de 30. Corrigido no mesmo commit: recipientUserIds como rede quando nao ha dono.",
    modulo: "Zeus",
    porque: "A notificacao ia para assigned_to_user_id, que so e preenchido na PRIMEIRA resposta de um adm. Nos 30 parados o campo e nulo em todos - a cobranca do usuario era descartada em silencio. A pessoa era ignorada duas vezes, por construcao.",
    situacao: "entregue",
    titulo: "Cobranca do usuario em chamado sem dono chega a alguem",
  },
  {
    id: "PAN-102",
    entregueEm: "2026-09-11",
    evidencia: "lib/hub-it-tickets/server.ts, parametro veNotaInterna com padrao false: quem esquecer de passar ve menos, nunca mais.",
    modulo: "Zeus",
    porque: "hydrateTicketRows busca os eventos com o client service-role e nao filtrava visible_to_requester - a RLS da 0014 nao protege esse caminho. Nada vazava por um motivo fragil: nenhuma insercao marcava evento como interno. A triagem grava a primeira nota interna da casa, entao o filtro tinha que entrar ANTES dela.",
    situacao: "entregue",
    titulo: "Nota interna para de vazar para o solicitante",
  },
  {
    id: "PAN-103",
    entregueEm: "2026-09-11",
    evidencia: "lib/hub-it-tickets/triagem-automatica.ts + after() na rota POST. Escreve NOTA INTERNA e nao responde o usuario; nunca fecha chamado.",
    modulo: "Zeus",
    porque: "A triagem ja existia e so rodava por clique no board - ou seja, o diagnostico so existia para quem ja tinha ido olhar o chamado, que era justamente o que nao acontecia. Agora dispara na criacao, via after(), fora do caminho da resposta.",
    situacao: "entregue",
    titulo: "Triagem automatica na abertura do chamado",
  },
  {
    id: "PAN-104",
    evidencia: "lib/hub-it-tickets/server.ts:~734 (resolveAdminTicketNextStatus e o carimbo de assigned_to_*). Lucas: 'eu nao quero ficar parando respondendo usuario se foi resolvido ou nao, devolver ele retorna ao usuario'.",
    modulo: "Zeus",
    porque: "Hoje toda resposta administrativa carimba o responsavel e move o status. Um agente conversando por essa porta viraria dono de tudo a cada frase e destruiria as metricas de fila - justamente as que vao provar se o nivel 1 funcionou. Sem isso, o agente nao pode fazer a devolutiva que o Lucas pediu.",
    situacao: "proximo",
    titulo: "Porta de escrita propria para o agente responder o usuario",
  },
  {
    id: "PAN-105",
    bloqueio: "Muda comportamento de producao (fecha chamado de gente). Espera OK do Lucas.",
    evidencia: "server.ts:~499 autoFinalizeStaleValidationRows; 107 eventos de timeout contra 116 fechados, medido em 11/09/2026. So 57 dos 146 tem resolution_summary.",
    modulo: "Zeus",
    porque: "107 dos 116 chamados fechados foram encerrados pela rotina automatica de 3 dias, com ator nulo e a mensagem 'Ticket encerrado' - 92% dos 'Finalizado' sao abandono com outro nome. Enquanto isso existir, o placar do agente vai parecer otimo e nao vai medir nada.",
    situacao: "bloqueado",
    titulo: "Trocar o robo de 3 dias por lembrete honesto",
  },
  {
    id: "PAN-106",
    evidencia:
      "components/hub-support/festo-chat.tsx + app/api/hub/festo/conversa/route.ts + lib/hub-support/festo-agente.ts (11/09/2026). Lucas, vendo o formulario abrir: 'nao foi essa tela que pensei, pensei em um chat'.",
    modulo: "Zeus",
    porque:
      "No formulario o primeiro ato da pessoa ja e abrir chamado: ela descreve o problema para uma fila e vai embora esperando. Na conversa o chamado vira consequencia, e nasce preenchido pelo agente, com a transcricao inteira gravada como nota interna para quem atender.",
    situacao: "fazendo",
    titulo: "Chat do Festos no lugar do formulario de chamado",
  },
  {
    id: "PAN-107",
    evidencia:
      "lib/hub-support/festo-agente.ts: hoje as ferramentas sao abrir_chamado e consultar_meus_chamados. Lucas: 'o agente pode solicitar que ele faca o processo, caminho daquele erro e acompanhar esse olhando dentro do codigo, banco para entender o motivo do erro'.",
    modulo: "Zeus",
    porque:
      "O Festos entende e registra, mas nao APURA: nao le o chamado parecido de outra pessoa, nao confere no banco se o dado existe, nao sabe se aquilo caiu numa versao recente. Enquanto isso, cada relato vira trabalho humano de reproducao, que e a parte cara do atendimento.",
    situacao: "proximo",
    titulo: "Ferramentas de leitura para o Festos apurar durante a conversa",
  },
  {
    id: "PAN-108",
    evidencia:
      "O chat e texto; anexo, print, audio e gravacao de tela continuam so no formulario (hub-ticket-open-form.tsx). Lucas: 'capaz de reconhecer audio, imagem, arquivo prints, gravacao'.",
    modulo: "Zeus",
    porque:
      "Print e gravacao sao o que transforma 'nao funciona' em relato reproduzivel, e hoje quem quer mandar evidencia precisa sair da conversa para o formulario. Audio ainda depende de transcricao, que e outra peca.",
    situacao: "depois",
    titulo: "Print, audio e gravacao dentro da conversa",
  },
  {
    id: "PAN-109",
    bloqueio:
      "Nao existe catalogo de telas no repo: o Festos so poderia explicar o que estiver escrito em algum lugar.",
    evidencia:
      "Lucas, sobre o diagnostico do agente: 'gostei, principalmente a parte de explicar a tela, ficaria show se ele explicasse como funciona'.",
    modulo: "Zeus",
    porque:
      "Boa parte do chamado nao e defeito, e alguem que nao sabe onde fica a acao. Um Festos que explica a tela resolve isso na hora e nao gera fila - mas so consegue explicar o que estiver descrito, e essa descricao ainda nao existe.",
    situacao: "depois",
    titulo: "Festos explicar como a tela funciona",
  },
];

/** Quantos itens em cada situação — o cabeçalho da tela lê daqui. */
export function contarPorSituacao(
  itens: readonly ItemDoRoadmap[] = PANTEON_ROADMAP,
): Record<SituacaoDoItem, number> {
  const zero: Record<SituacaoDoItem, number> = {
    bloqueado: 0,
    depois: 0,
    entregue: 0,
    fazendo: 0,
    proximo: 0,
  };
  for (const i of itens) zero[i.situacao] += 1;
  return zero;
}

/** Os módulos presentes, na ordem em que aparecem. A tela monta os filtros com isto. */
export function modulosDoRoadmap(
  itens: readonly ItemDoRoadmap[] = PANTEON_ROADMAP,
): string[] {
  const vistos: string[] = [];
  for (const i of itens) if (!vistos.includes(i.modulo)) vistos.push(i.modulo);
  return vistos.sort((a, b) => a.localeCompare(b, "pt-BR"));
}
