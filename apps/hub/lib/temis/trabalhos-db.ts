// A LEITURA E A ESCRITA DOS TRABALHOS DA TÊMIS — num lugar só.
//
// ⚠️ O CARD ANDA SOZINHO, E QUEM O FAZ ANDAR É ESTA CAMADA. Pedido do Lucas (02/09/2026): *"queria
// que isso andasse sozinho"*. Marcar a última atividade do estágio avança o card na mesma chamada:
// se o avanço dependesse de a tela pedir, uma tela nova (ou uma rota, ou um script) marcaria a
// atividade e deixaria o card para trás — e o board mostraria como pendente o que já acabou.
//
// ⚠️ E O `estagio_desde` REINICIA A CADA AVANÇO. É dele que os prazos contam. Sem reiniciar, um card
// que passou uma semana na entrada chegaria à confecção já atrasado, e o vermelho apareceria em quem
// pegou o trabalho, não em quem o deixou parado.

import { createApoloAdminClient } from "@/lib/apolo/server";

import { type ContratoNoCard, contratosDasPropostas } from "./contrato-guardado-db";
import { registrarPassagemDeEtapa } from "./passagem-de-etapa-db";
import {
  type EstagioDoTrabalho,
  type TipoDeTrabalho,
  type Trabalho,
  podeAvancar,
  proximoEstagio,
} from "./trabalhos";

export type CanalDoTrabalho = "coordenador" | "hercules" | "iris";

type LinhaCrua = {
  atividades_feitas: string[];
  canal: string;
  cliente_cpf: null | string;
  cliente_nome: string;
  criado_em: string;
  enterprise_codigo: string;
  enterprise_id: string;
  enterprise_nome: string;
  estagio: string;
  estagio_desde: string;
  evidencia_path: null | string;
  id: string;
  iris_ticket_id: null | string;
  observacao: null | string;
  proposta_id: null | string;
  tipo: string;
  trabalho_origem_id: null | string;
  unidade: string;
};

export type TrabalhoDoBoard = Trabalho & {
  canal: CanalDoTrabalho;
  /**
   * Os contratos JÁ GERADOS desta proposta, do mais novo para o mais antigo.
   *
   * ⚠️ É ISTO QUE ANEXA O DOCUMENTO AO CARD. O elo é `proposta_id`, presente nas duas tabelas —
   * nenhuma coluna nova, nenhuma migration. Sem ele o board dizia "Gerar o contrato pela minuta do
   * empreendimento" como atividade a marcar e não sabia se o papel existia: o jurídico marcava o
   * item olhando a memória, e o card andava para "Em assinatura" sem nada para despachar.
   *
   * ⚠️ VEM VAZIO NO CARD SEM PROPOSTA, e isso é o normal de hoje: os quatro cards antigos do Garden
   * e da Lavra nasceram antes do elo (`proposta_id` nulo). A lista vazia é a resposta certa para
   * eles — não é erro.
   */
  contratos: ContratoNoCard[];
  evidenciaPath: null | string;
  irisTicketId: null | string;
  /**
   * A proposta do Hercules que originou o trabalho.
   *
   * ⚠️ SOBE ATE O BOARD, e nao para no insert: e por este id que a Temis vai buscar cliente,
   * compradores com participacao, condicoes, plano, cronograma e o PDF que o cliente ja recebeu.
   * Nenhuma TELA dela consome o campo ainda — o Lucas pediu "somente entregar o contrato na Temis,
   * depois vamos trabalhar nela" —, mas o dado chega inteiro em quem ler o board, que e o que faz
   * o "depois" ser possivel sem uma segunda migration.
   */
  propostaId: null | string;
};

const CAMPOS =
  "id, tipo, estagio, estagio_desde, enterprise_id, enterprise_codigo, enterprise_nome, unidade, cliente_nome, cliente_cpf, atividades_feitas, observacao, canal, iris_ticket_id, evidencia_path, trabalho_origem_id, proposta_id, criado_em";

function mapear(l: LinhaCrua): TrabalhoDoBoard {
  return {
    atividadesFeitas: Array.isArray(l.atividades_feitas) ? l.atividades_feitas : [],
    canal: l.canal as CanalDoTrabalho,
    clienteCpf: l.cliente_cpf,
    clienteNome: l.cliente_nome,
    // Preenchido só em `trabalhosDoBoard`, numa consulta por lote — ver a nota do campo.
    contratos: [],
    criadoEm: l.criado_em,
    empreendimentoCodigo: l.enterprise_codigo,
    empreendimentoNome: l.enterprise_nome,
    estagio: l.estagio as EstagioDoTrabalho,
    estagioDesde: l.estagio_desde,
    evidenciaPath: l.evidencia_path,
    id: l.id,
    irisTicketId: l.iris_ticket_id,
    observacao: l.observacao,
    propostaId: l.proposta_id,
    tipo: l.tipo as TipoDeTrabalho,
    trabalhoOrigemId: l.trabalho_origem_id,
    unidade: l.unidade,
  };
}

/**
 * Tudo que está no board. Finalizado entra também: some da fila, não do histórico.
 *
 * `enterpriseId` é o filtro da tela interna (um empreendimento por vez). `enterpriseIds` é o do
 * portal comercial (Hércules, 02/09/2026): o coordenador enxerga VÁRIOS, e a lista chega pronta da
 * sessão assinada — quem chama já passou pelo escopo; aqui é só o recorte.
 *
 * ⚠️ LISTA VAZIA DEVOLVE VAZIO SEM CONSULTAR. "Nenhum empreendimento" tem que virar "nenhum
 * trabalho", nunca "todos": é a diferença entre um filtro que recorta e um filtro que sumiu.
 *
 * ⚠️ O `.in()` do PostgREST vai na URL e estoura com listas grandes (em outros cantos do repo a
 * regra é lote de 100). Aqui são os empreendimentos de UMA pessoa — uns 15 no máximo —, então a
 * lista passa inteira. Se um dia a fonte mudar para algo maior, lotear.
 */
export async function trabalhosDoBoard(input?: {
  enterpriseId?: string;
  enterpriseIds?: string[];
}): Promise<TrabalhoDoBoard[]> {
  if (input?.enterpriseIds && input.enterpriseIds.length === 0) return [];

  const supabase = createApoloAdminClient();
  if (!supabase) return [];

  let consulta = supabase
    .from("temis_trabalhos")
    .select(CAMPOS)
    .eq("workspace_id", "careli")
    .order("estagio_desde", { ascending: true });

  if (input?.enterpriseId) consulta = consulta.eq("enterprise_id", input.enterpriseId);
  if (input?.enterpriseIds) consulta = consulta.in("enterprise_id", input.enterpriseIds);

  const { data, error } = await consulta;
  // ⚠️ LISTA VAZIA POR ERRO É INDISTINGUÍVEL DE FILA VAZIA, e o board diz "Nada aqui" nas duas. Foi
  // assim que o Lucas passou a tarde de 06/09 achando que os pedidos não chegavam à Têmis — ali a
  // causa era outra (um filtro invisível), mas o silêncio desta linha é a mesma armadilha: uma
  // coluna que mudou de nome derrubaria o board inteiro sem deixar rastro. Devolver vazio continua
  // certo — board quebrado é pior que board vazio —, o que faltava era o log.
  if (error) {
    console.error("[temis] falha ao ler o board", error);
    return [];
  }
  if (!data) return [];

  const trabalhos = (data as LinhaCrua[]).map(mapear);

  // ⚠️ UMA CONSULTA A MAIS PARA O BOARD INTEIRO, e não uma por card. O board tem sete linhas hoje e
  // não deve passar de algumas dezenas, mas "uma consulta por card" é o tipo de conta que só dói
  // quando a fila cresce — e aí ninguém liga o board lento a esta linha. `contratosDasPropostas`
  // já sai sem consultar quando nenhum card tem proposta, que é o caso do board antigo.
  const contratos = await contratosDasPropostas(
    supabase,
    trabalhos.map((t) => t.propostaId ?? "").filter(Boolean),
  );

  for (const trabalho of trabalhos) {
    if (trabalho.propostaId) {
      trabalho.contratos = contratos.get(trabalho.propostaId) ?? [];
    }
  }

  return trabalhos;
}

export type NovoTrabalho = {
  /**
   * Quem abriu, quando o pedido nasceu de uma sessão de usuário.
   *
   * ⚠️ AS COLUNAS SEMPRE EXISTIRAM E NINGUÉM AS PREENCHIA — `aberto_por` e `venda_id` estão em
   * `temis_trabalhos` desde que a tabela nasceu, e a auditoria da casa já tinha registrado a falta.
   * Um trabalho sem autor é um documento que ninguém pediu; sem `venda_id`, é um contrato que a
   * Têmis não consegue ligar de volta à venda que o originou — e ela precisa dessa volta para saber
   * o cliente, as condições e o lote sem o operador digitar tudo de novo.
   */
  abertoPor?: null | string;
  canal: CanalDoTrabalho;
  clienteCpf: null | string;
  clienteNome: string;
  empreendimentoCodigo: string;
  empreendimentoId: string;
  empreendimentoNome: string;
  evidenciaPath?: null | string;
  irisTicketId?: null | string;
  observacao?: null | string;
  tipo: TipoDeTrabalho;
  trabalhoOrigemId?: null | string;
  unidade: string;
  /**
   * A PROPOSTA do Hercules. E este o vinculo que funciona hoje.
   *
   * `vendaId` aponta para `hercules_vendas`, que tem ZERO linhas — toda tentativa de gravar ali o
   * id de uma proposta viola a chave estrangeira, e foi assim que as duas vendas despachadas em
   * 05/09/2026 nao abriram card nenhum (ver a migration 0134).
   */
  propostaId?: null | string;
  vendaId?: null | string;
};

/**
 * Abre uma solicitação.
 *
 * ⚠️ A REGRA DO RASTRO É CONFERIDA AQUI E NO BANCO, e a repetição é deliberada. O CHECK da tabela é
 * a garantia; esta conferência é o que devolve uma frase legível em vez de um erro de constraint que
 * o operador não sabe o que fazer com.
 */
export async function abrirTrabalho(
  novo: NovoTrabalho,
): Promise<{ erro: string; ok: false } | { id: string; ok: true }> {
  if (novo.canal === "iris" && (!novo.irisTicketId || !novo.evidenciaPath)) {
    return {
      erro: "solicitação pelo atendimento exige o ticket da Iris e a evidência do pedido do cliente",
      ok: false,
    };
  }

  const supabase = createApoloAdminClient();
  if (!supabase) return { erro: "sem acesso ao banco", ok: false };

  const { data, error } = await supabase
    .from("temis_trabalhos")
    .insert({
      aberto_por: novo.abertoPor ?? null,
      canal: novo.canal,
      cliente_cpf: novo.clienteCpf,
      cliente_nome: novo.clienteNome,
      enterprise_codigo: novo.empreendimentoCodigo,
      enterprise_id: novo.empreendimentoId,
      enterprise_nome: novo.empreendimentoNome,
      evidencia_path: novo.evidenciaPath ?? null,
      iris_ticket_id: novo.irisTicketId ?? null,
      observacao: novo.observacao ?? null,
      proposta_id: novo.propostaId ?? null,
      tipo: novo.tipo,
      trabalho_origem_id: novo.trabalhoOrigemId ?? null,
      unidade: novo.unidade,
      venda_id: novo.vendaId ?? null,
      workspace_id: "careli",
    })
    .select("estagio, id")
    .single<{ estagio: null | string; id: string }>();

  if (error || !data) return { erro: error?.message ?? "não consegui abrir", ok: false };

  // ⚠️ O NASCIMENTO DO CARD É UMA PASSAGEM COM `de` NULO, e não uma linha ausente. Sem ela, a aba
  // Histórico começaria a contar a vida do trabalho no primeiro avanço — e "quando este pedido
  // chegou à Têmis" é a primeira pergunta de qualquer conferência de prazo.
  //
  // ⚠️ E O DESTINO VEM DO BANCO, NÃO DE UMA CONSTANTE DAQUI. O insert não escreve `estagio`: quem
  // decide é o DEFAULT da coluna (`analise`, desde a 0150). Repetir a palavra aqui criaria uma
  // segunda fonte da verdade, que só divergiria no dia em que o default mudasse. Destino em branco
  // (leitura que voltou vazia) não vira linha — `registrarPassagemDeEtapa` sai calada.
  await registrarPassagemDeEtapa(supabase, {
    de: null,
    origem: "abertura",
    para: data.estagio ?? "",
    propostaId: novo.propostaId ?? null,
    quem: novo.abertoPor ?? null,
    trabalhoId: data.id,
    trabalhoTipo: novo.tipo,
  });

  return { id: data.id, ok: true };
}

/**
 * Marca (ou desmarca) uma atividade — e faz o card andar quando o estágio acaba.
 *
 * ⚠️ DESMARCAR NÃO FAZ O CARD VOLTAR. Quem já passou de estágio e desmarca uma atividade está
 * corrigindo o registro, não desfazendo trabalho: puxar o card para trás sozinho tiraria da fila de
 * assinatura um documento que já foi despachado.
 */
export async function marcarAtividade(input: {
  atividade: string;
  feita: boolean;
  id: string;
}): Promise<{ erro: string; ok: false } | { andou: boolean; estagio: EstagioDoTrabalho; ok: true }> {
  const supabase = createApoloAdminClient();
  if (!supabase) return { erro: "sem acesso ao banco", ok: false };

  const { data: atual, error: erroLeitura } = await supabase
    .from("temis_trabalhos")
    .select(CAMPOS)
    .eq("id", input.id)
    .single();
  if (erroLeitura || !atual) return { erro: "trabalho não encontrado", ok: false };

  const trabalho = mapear(atual as LinhaCrua);
  const feitas = new Set(trabalho.atividadesFeitas);
  if (input.feita) feitas.add(input.atividade);
  else feitas.delete(input.atividade);

  const depois = { ...trabalho, atividadesFeitas: [...feitas] };
  const avanca = input.feita && podeAvancar(depois);
  const seguinte = avanca ? proximoEstagio(depois.tipo, depois.estagio) : null;

  const mudanca: Record<string, unknown> = {
    atividades_feitas: [...feitas],
    atualizado_em: new Date().toISOString(),
  };
  if (seguinte) {
    mudanca.estagio = seguinte;
    // ⚠️ O RELÓGIO DO PRAZO REINICIA AQUI, e não na criação do card.
    mudanca.estagio_desde = new Date().toISOString();
  }

  const { error } = await supabase.from("temis_trabalhos").update(mudanca).eq("id", input.id);
  if (error) return { erro: error.message, ok: false };

  // ⚠️ SÓ DEPOIS DO `update`, E SÓ QUANDO O CARD ANDOU. Marcar atividade sem fechar o estágio não
  // é passagem de etapa — o card continua onde estava, e uma linha aqui encheria a linha do tempo
  // de eventos que não mudaram nada.
  //
  // ⚠️ SEM AUTOR, E ISSO É HONESTO: esta função recebe o id e a atividade, não a sessão de quem
  // clicou. Vazio é melhor que errado num registro que vai ser lido como prova. Quando a rota que
  // a chama passar a informar quem marcou, o campo já está aqui esperando.
  if (seguinte) {
    await registrarPassagemDeEtapa(supabase, {
      de: trabalho.estagio,
      origem: "atividade",
      para: seguinte,
      propostaId: trabalho.propostaId,
      trabalhoId: input.id,
      trabalhoTipo: depois.tipo,
    });
  }

  return { andou: Boolean(seguinte), estagio: seguinte ?? trabalho.estagio, ok: true };
}
