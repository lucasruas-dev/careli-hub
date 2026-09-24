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

import type { SupabaseClient } from "@supabase/supabase-js";

import { createApoloAdminClient } from "@/lib/apolo/server";
import { type EnvelopeDaProposta, envelopeQueSegura } from "@/lib/assinatura/envio-db";
// A régua de "esta venda está morta" mora num lugar só, e é pura — ver `VENDA_DESFEITA`.
import { VENDA_DESFEITA } from "@/lib/hercules/acao-de-cancelamento";
import {
  motivoDoReflexo,
  refletirCardNaVenda,
  registrarReflexoQueNaoAndou,
} from "@/lib/hercules/reflexo-da-temis-server";

import { type ContratoNoCard, contratosDasPropostas } from "./contrato-guardado-db";
import { registrarPassagemDeEtapa } from "./passagem-de-etapa-db";
import {
  ESTAGIOS_ENCERRADOS,
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
  /** 0172. Só vem na leitura do board, e só com a coluna: ausente = a Careli (nulo). */
  operado_por?: null | string;
  proposta_id: null | string;
  tipo: string;
  trabalho_origem_id: null | string;
  unidade: string;
};

/**
 * O "1/5" DO CARD — quantas assinaturas já saíram, e se algum convite não chegou.
 *
 * Lucas (12/09/2026): *"no card, gostaria de ter essa visão de quantas assinaturas já foram feitas,
 * tipo 1/5"*, e, no mesmo dia, sobre o contrato da Beatriz: *"nesse caso tinha que voltar com o erro
 * de e-mail"*. O envelope dela dizia "Parcialmente assinado" e ninguém sabia por quê — o convite do
 * segundo signatário tinha voltado com `550 5.1.1 ... NoSuchUser` quatro segundos depois do envio, e
 * essa notícia estava guardada no nosso banco desde então, sem um único leitor.
 *
 * ⚠️ `total` É QUEM FOI CONVIDADO, `assinaram` É QUEM ASSINOU, E AS DUAS FONTES SÃO DIFERENTES.
 * `temis_envelopes.signatarios` congela a lista do envio (ATENÇÃO 2 da migration 0149) e não tem
 * campo de "assinou"; quem assinou só se sabe pelos eventos. Ver `contarAssinaturasDasPropostas`.
 *
 * ⚠️ ESTE É O RESUMO DO CARD, NÃO O DIÁRIO. O log linha a linha (enviado, visualizado, e-mail não
 * entregue, assinado) é da TELA de trabalho, que o busca de `diarioDaProposta` ao abrir um card só.
 * Aqui cabe o que dá para ler de um quadro inteiro de uma vez.
 */
export type ContagemDeAssinaturas = {
  /** Quantos dos convidados já assinaram. */
  assinaram: number;
  /**
   * Algum convite voltou sem ser entregue?
   *
   * ⚠️ É O SINAL DE QUE NÃO ADIANTA ESPERAR. Um contrato "parcialmente assinado" cujo convite
   * quicou não está devagar: ele não chegou, e a ação é corrigir o e-mail e reenviar.
   */
  conviteNaoEntregue: boolean;
  /** O estado CRU do envelope (a língua da casa, `EstadoDaAssinatura`) — para a cor do selo. */
  estado: string;
  /** Quantos foram convidados a assinar naquele envio. */
  total: number;
};

export type TrabalhoDoBoard = Trabalho & {
  /**
   * O contador de assinaturas, quando o card está em "Em assinatura".
   *
   * ⚠️ `null` É O NORMAL, E DIZ APENAS "SEM CONTADOR". Card em outra etapa, card que não é de
   * contrato, proposta sem envelope, leitura que falhou — os quatro chegam aqui como `null`, e o
   * card aparece como aparecia ontem. Diferente de `envelopeVivo` na tela de trabalho, onde o nulo
   * carrega uma decisão (cancelar ou não um envelope pago), este nulo não decide nada: é um selo a
   * menos num quadro que recarrega sozinho a cada minuto.
   *
   * ⚠️ VEM PREENCHIDO SÓ COM `comAssinaturas` — ver a nota do parâmetro em `trabalhosDoBoard`.
   */
  assinaturas: ContagemDeAssinaturas | null;
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
   * Quem confecciona (`temis_trabalhos.operado_por`, 0172): nulo = a Careli; o uuid de um
   * incorporador = o portal dele.
   *
   * ⚠️ É O QUE PÕE O SELO "INCORPORADOR" NO CARD da supervisão da Careli (`?incluir=incorporadores`).
   * Sem a 0172 a coluna não existe e todo card sai nulo, que é a verdade: sem a coluna, ninguém de
   * fora confecciona nada.
   */
  operadoPor: null | string;
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

/**
 * O recorte de DONO que o board aceita: `careli` (padrão), `todos` ou o uuid de um incorporador.
 *
 * ⚠️ `(string & {})` MANTÉM O AUTOCOMPLETAR DAS DUAS PALAVRAS sem fechar o tipo para o uuid.
 */
export type OperadoPorDoBoard = "careli" | "todos" | (string & {});

export type RecorteDoDono =
  | { id: string; tipo: "incorporador" }
  | { tipo: "careli" }
  | { tipo: "nenhum" }
  | { tipo: "todos" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Traduz o `operadoPor` pedido no recorte que a consulta aplica.
 *
 * ⚠️ SÓ `undefined` E `null` VIRAM A CARELI. Nulo é o valor da coluna para "a Careli confecciona"
 * (e o que `operadoPorDoAtor` devolve para o hub). Já a string vazia, ou qualquer coisa que não seja
 * uuid, é um id de incorporador que se perdeu no caminho — e a resposta fail-closed é "nenhum".
 *
 * ⚠️ EXPORTADA PARA O TESTE: é a única parte pura do recorte, e é dela que depende o board da Careli
 * não mostrar o que é da Cecílio.
 */
export function recorteDoDono(operadoPor: null | OperadoPorDoBoard | undefined): RecorteDoDono {
  if (operadoPor === undefined || operadoPor === null) return { tipo: "careli" };
  if (typeof operadoPor !== "string") return { tipo: "nenhum" };

  const valor = operadoPor.trim();
  if (valor === "careli") return { tipo: "careli" };
  if (valor === "todos") return { tipo: "todos" };
  if (UUID.test(valor)) return { id: valor.toLowerCase(), tipo: "incorporador" };
  return { tipo: "nenhum" };
}

/**
 * O erro do Supabase é "a coluna `operado_por` ainda não existe" (migration 0172 pendente)?
 *
 * ⚠️ SÓ PARA ESTA COLUNA, e pelo nome dela na mensagem — a mesma cautela de
 * `ehColunaDaRessalvaAusente` (planos.ts). `42703` (Postgres, no filtro) e `PGRST204` (schema cache,
 * no insert) dizem "coluna não existe" para QUALQUER coluna: engolir os dois sem olhar o nome faria
 * um erro de digitação em outra coluna virar, calado, um board sem recorte de dono.
 */
export function ehColunaDoDonoAusente(erro: unknown): boolean {
  if (!erro || typeof erro !== "object") return false;
  const { code, message } = erro as { code?: unknown; message?: unknown };
  const mensagem = typeof message === "string" ? message.toLowerCase() : "";
  const codigoDeColuna = code === "42703" || code === "PGRST204";
  return codigoDeColuna && mensagem.includes("operado_por");
}

/**
 * Até quando (epoch ms) este processo já sabe que a coluna `operado_por` NÃO existe.
 *
 * ⚠️ POR QUE LEMBRAR (revisão da onda 3, 16/09/2026). O código vai antes da migration 0172, de
 * propósito, e sem memória cada leitura do board pagava DUAS consultas (a primeira falhando com
 * 42703) e uma linha de log. O quadro da Têmis recarrega a cada minuto por aba aberta, e a aba
 * Contratos da Gurgel passa pelo mesmo caminho: o dobro de consultas e de log por pessoa olhando,
 * numa casa que já teve fatura alta por leitura repetida. Lembrando por alguns minutos, a primeira
 * leitura descobre e as seguintes vão direto à consulta sem o filtro.
 *
 * ⚠️ É MEMÓRIA DE PROCESSO, COM PRAZO CURTO: cada instância da Vercel descobre sozinha.
 *
 * (16/09/2026, revisão do conjunto) ⚠️ ELA NÃO DECIDE MAIS O FILTRO DA CARELI NEM O DO INCORPORADOR.
 * A frase antiga ("nesse intervalo nenhum trabalho de incorporador pode ter nascido sem a coluna") era
 * falsa quando o código sobe antes da migration, que é o caminho natural com o deploy automático:
 * `abrirTrabalho` não consulta a memória, então assim que a 0172 entra o card da Cecília já nasce com
 * dono, e a instância que ainda lembrava da ausência entregava esse card (nome e CPF do comprador) no
 * board da Careli e na aba Contratos da Gurgel, por até 5 minutos. Agora a Careli e o incorporador
 * tentam SEMPRE com a coluna (o 42703 é barato) e a memória só serve para: (a) a supervisão
 * (`todos`), que não filtra dono e só perde o selo; (b) não repetir o log a cada leitura.
 */
let colunaDoDonoAusenteAte = 0;
const LEMBRAR_AUSENCIA_MS = 5 * 60 * 1000;

/** Só para teste: esquece o que o processo aprendeu sobre a coluna `operado_por`. */
export function esquecerAusenciaDaColunaDoDono(): void {
  colunaDoDonoAusenteAte = 0;
}

const CAMPOS =
  "id, tipo, estagio, estagio_desde, enterprise_id, enterprise_codigo, enterprise_nome, unidade, cliente_nome, cliente_cpf, atividades_feitas, observacao, canal, iris_ticket_id, evidencia_path, trabalho_origem_id, proposta_id, criado_em";

/**
 * Os campos do BOARD: os de sempre mais o dono (0172).
 *
 * ⚠️ UMA CONSTANTE À PARTE, E NÃO `operado_por` DENTRO DE `CAMPOS`. `marcarAtividade` lê o card com
 * `CAMPOS`; com a coluna ali, marcar atividade quebraria enquanto a 0172 não estiver no banco. O
 * board já sabe cair sem a coluna (ver `trabalhosDoBoard`), então só ele pede.
 */
const CAMPOS_DO_BOARD = `${CAMPOS}, operado_por`;

/** 1.000 é o teto de linhas por resposta do PostgREST (`max-rows`), que corta calado. */
const PAGINA_DO_BOARD = 1000;
/** 50 páginas = 50 mil cards. Passar disso é defeito, e o board devolve o que leu até ali. */
const MAXIMO_DE_PAGINAS_DO_BOARD = 50;

function mapear(l: LinhaCrua): TrabalhoDoBoard {
  return {
    // Preenchido só em `trabalhosDoBoard`, numa consulta por lote — ver a nota do campo.
    assinaturas: null,
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
    // Só a leitura do board pede a coluna (ver `CAMPOS_DO_BOARD`); nas outras, fica nulo.
    operadoPor: typeof l.operado_por === "string" && l.operado_por.trim() ? l.operado_por : null,
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
 *
 * `comAssinaturas` liga o contador "1/5" dos cards em "Em assinatura".
 *
 * ⚠️ ELE É OPCIONAL PORQUE CUSTA DUAS CONSULTAS, e nem todo leitor deste board as quer. Quem chama
 * são dois: o quadro da Têmis (que recarrega sozinho a cada minuto desde 11/09/2026 e pediu o
 * contador) e a aba Contratos do portal comercial (`/api/incorporador/contratos`), que é do
 * coordenador de fora e não pediu nada disso. Ligar para os dois faria a casa pagar, a cada minuto
 * de cada portal aberto, por um selo que só uma das telas desenha — e esta casa já teve fatura alta
 * da Vercel por leitura repetida que ninguém tinha pedido.
 *
 * `operadoPor` é QUEM CONFECCIONA (`temis_trabalhos.operado_por`, migration 0172). Padrão `careli`:
 * só os trabalhos da Careli (coluna nula). Um uuid: só os daquele incorporador. `todos`: sem recorte.
 *
 * ⚠️ O PADRÃO É A CARELI, E ISSO MUDA O BOARD DA CARELI DE PROPÓSITO. Decisão do Lucas (16/09/2026):
 * a venda do time da Cecílio é confeccionada pela Cecílio, no portal. O jurídico da Careli deixa de
 * ver esses cards na fila dele (continua abrindo pelo id, para supervisão). Quem quer tudo pede
 * `todos` explicitamente; nenhum leitor ganha o trabalho de outro dono por esquecer o parâmetro.
 *
 * ⚠️ VALOR TORTO DEVOLVE VAZIO SEM CONSULTAR, pelo mesmo motivo da lista vazia de empreendimentos:
 * um `operadoPor: ""` vindo de uma sessão sem incorporador tem de virar "nada", nunca "todos".
 *
 * ⚠️ TOLERANTE À 0172 NÃO APLICADA. Sem a coluna, nenhum trabalho tem outro dono: o recorte da
 * Careli repete a consulta sem o filtro (o board sai igual ao de hoje) e o de um incorporador
 * devolve vazio.
 */
export async function trabalhosDoBoard(input?: {
  comAssinaturas?: boolean;
  enterpriseId?: string;
  enterpriseIds?: string[];
  operadoPor?: OperadoPorDoBoard;
}): Promise<TrabalhoDoBoard[]> {
  if (input?.enterpriseIds && input.enterpriseIds.length === 0) return [];

  const dono = recorteDoDono(input?.operadoPor);
  if (dono.tipo === "nenhum") return [];

  const supabase = createApoloAdminClient();
  if (!supabase) return [];

  // `comColunaDoDono`: a leitura pede `operado_por` (para o selo do card) e aplica o recorte de dono.
  // Sem a 0172, as duas coisas saem juntas: nem a coluna nem o filtro existem.
  const montar = (comColunaDoDono: boolean, de: number) => {
    let consulta = supabase
      .from("temis_trabalhos")
      .select(comColunaDoDono ? CAMPOS_DO_BOARD : CAMPOS)
      .eq("workspace_id", "careli")
      .order("estagio_desde", { ascending: true })
      // Desempate estável: sem ele, duas páginas podiam repetir ou pular o card do mesmo instante.
      .order("id", { ascending: true });

    if (input?.enterpriseId) consulta = consulta.eq("enterprise_id", input.enterpriseId);
    if (input?.enterpriseIds) consulta = consulta.in("enterprise_id", input.enterpriseIds);

    if (comColunaDoDono && dono.tipo === "careli") consulta = consulta.is("operado_por", null);
    if (comColunaDoDono && dono.tipo === "incorporador") {
      consulta = consulta.eq("operado_por", dono.id);
    }

    return consulta.range(de, de + PAGINA_DO_BOARD - 1);
  };

  /**
   * O board inteiro, de mil em mil (arrumação da onda 3, 16/09/2026).
   *
   * ⚠️ O PostgREST CORTA EM 1.000 LINHAS SEM ERRO. Sem paginar, o card 1.001 da fila sumiria calado,
   * e a supervisão da Careli (`todos`) é a primeira a passar disso. Erro em qualquer página devolve
   * o erro, e quem chama decide (coluna ausente repete sem ela; o resto é board vazio com log).
   */
  const lerTudo = async (
    comColunaDoDono: boolean,
  ): Promise<{ data: LinhaCrua[] | null; error: unknown }> => {
    const linhas: LinhaCrua[] = [];
    for (let pagina = 0; pagina < MAXIMO_DE_PAGINAS_DO_BOARD; pagina += 1) {
      const { data, error } = await montar(comColunaDoDono, pagina * PAGINA_DO_BOARD);
      if (error) return { data: null, error };
      const lidas = (data ?? []) as unknown as LinhaCrua[];
      linhas.push(...lidas);
      if (lidas.length < PAGINA_DO_BOARD) return { data: linhas, error: null };
    }
    console.error("[temis] o board passou do teto de páginas; saiu o que foi lido");
    return { data: linhas, error: null };
  };

  // A memória da ausência (ver `colunaDoDonoAusenteAte`) só pula a consulta que falha na supervisão,
  // que não filtra dono. A Careli e o incorporador tentam sempre com a coluna: um card com dono gravado
  // logo depois da 0172 nunca cai no recorte errado.
  const lembrava = Date.now() < colunaDoDonoAusenteAte;
  const jaSabeQueFalta = dono.tipo === "todos" && lembrava;

  let resposta = await lerTudo(!jaSabeQueFalta);
  if (resposta.error && !jaSabeQueFalta && ehColunaDoDonoAusente(resposta.error)) {
    colunaDoDonoAusenteAte = Date.now() + LEMBRAR_AUSENCIA_MS;
    // Sem a coluna, nada foi confeccionado por incorporador: o dele é vazio, o da Careli é tudo.
    if (dono.tipo === "incorporador") {
      if (!lembrava) console.info("[temis] migration 0172 pendente: board do incorporador sai vazio");
      return [];
    }
    if (!lembrava) console.info("[temis] migration 0172 pendente: board sem o dono do trabalho");
    resposta = await lerTudo(false);
  }

  const { data, error } = resposta;
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

  const trabalhos = data.map(mapear);

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

  if (input?.comAssinaturas) {
    // ⚠️ MAIS DUAS CONSULTAS PARA O QUADRO INTEIRO, E NUNCA UMA POR CARD. O quadro recarrega
    // sozinho a cada minuto; uma consulta por card multiplicaria essa conta pelo tamanho da fila,
    // e é exatamente o tipo de gasto que só aparece na fatura. A leitura é em lote, o cruzamento é
    // em memória.
    const esperando = trabalhos.filter(cardEsperaAssinatura);
    const contagens = await contarAssinaturasDasPropostas(
      supabase,
      esperando.map((t) => t.propostaId ?? ""),
    );
    for (const trabalho of esperando) {
      trabalho.assinaturas = trabalho.propostaId
        ? contagens.get(trabalho.propostaId) ?? null
        : null;
    }
  }

  return trabalhos;
}

/**
 * ESTE CARD MOSTRA CONTADOR DE ASSINATURA?
 *
 * ⚠️ O PORTÃO POR TIPO É O MESMO DO GET DE UM CARD, e existe pela mesma razão: `temis_envelopes`
 * casa por `proposta_id` e NÃO tem `trabalho_id`. Uma proposta tem DOIS cards quando alguém pede o
 * cancelamento da venda (medido em 10/09/2026 na proposta do Henrique, Q01 L05), e sem o portão o
 * card de cancelamento mostraria "1/2" lendo o envelope DA VENDA — um contador certo pregado no
 * card errado, que é pior que contador nenhum.
 *
 * ⚠️ E ISSO DEIXA CESSÃO E CANCELAMENTO POR CORREÇÃO SEM SELO, mesmo eles indo para assinatura
 * (`EXIGE_ASSINATURA`). É a resposta honesta enquanto o envelope não souber de que card ele é: o
 * dia em que `temis_envelopes` ganhar `trabalho_id`, o portão vira esse elo e os três passam a
 * contar.
 */
function cardEsperaAssinatura(trabalho: TrabalhoDoBoard): boolean {
  return (
    trabalho.estagio === "assinatura" &&
    trabalho.tipo === "contrato" &&
    Boolean(trabalho.propostaId)
  );
}

/** O envelope, do jeito que o contador precisa dele: a régua do reenvio mais quem foi convidado. */
type EnvelopeParaContar = EnvelopeDaProposta & {
  proposta_id: null | string;
  /** O `document.key` da Clicksign — o elo que casa com os eventos. Ver `historicoDosEnvelopes`. */
  provedor_documento_id: null | string;
  signatarios: unknown;
};

/**
 * QUANTOS ASSINARAM, DE QUANTOS, EM VÁRIAS PROPOSTAS DE UMA VEZ.
 *
 * ⚠️ O NÚMERO NÃO SAI DE `temis_envelopes` SOZINHO, e foi a primeira coisa conferida: `signatarios`
 * guarda quem foi CONVIDADO (ATENÇÃO 2 da 0149) e não ganha carimbo quando alguém assina, e `estado`
 * só sabe dizer `parcial` — que é "pelo menos um", não "quantos". Para um contrato de cinco pessoas,
 * `parcial` vale para 1/5 e para 4/5 igualmente, e é justamente essa diferença que o Lucas pediu.
 * Então o segundo lote abre o PAYLOAD dos eventos.
 *
 * ⚠️ O QUE CUSTA: uma consulta a `temis_envelopes` (barata, colunas) e uma a
 * `temis_assinatura_eventos` trazendo `payload` jsonb. É a consulta cara das duas — um payload da
 * Clicksign tem o envelope, o documento e o histórico inteiro dentro. Ela vale porque roda uma vez
 * por carga do quadro, e SÓ pelos cards que estão em "Em assinatura" (hoje, uma mão-cheia). Se um
 * dia a coluna "Em assinatura" tiver centenas de cards, o caminho não é lotear mais: é gravar o
 * resumo em `temis_envelopes` quando o webhook chega, e ler daí.
 *
 * ⚠️ E O HISTÓRICO VEM DE DENTRO DO PAYLOAD PORQUE NÃO HÁ WEBHOOK PRÓPRIO DELE. O
 * `tracking_notification_error` do contrato da Beatriz (12/09/2026) NÃO chegou como evento: a tabela
 * tem cinco linhas — upload, dois add_signer, signature_started e sign — e nenhuma dele. Ele veio
 * dentro do `document.events[]` dos eventos seguintes, que a Clicksign manda INTEIRO toda vez. Por
 * isso o que se lê aqui é esse array, e não a coluna `evento` — que nunca vai conter a palavra
 * `tracking_notification_error`, por mais que se procure.
 *
 * ⚠️ NADA AQUI DERRUBA O QUADRO. Toda falha vira log e mapa vazio: o card sem contador é o card de
 * ontem, e um quadro em branco por causa de um selo seria uma troca ruim — a mesma lição de
 * `contratosDasPropostas`.
 */
async function contarAssinaturasDasPropostas(
  sb: SupabaseClient,
  propostaIds: readonly string[],
): Promise<Map<string, ContagemDeAssinaturas>> {
  const porProposta = new Map<string, ContagemDeAssinaturas>();
  const ids = [...new Set(propostaIds.filter(Boolean))];
  if (ids.length === 0) return porProposta;

  const envelopes = await envelopesDasPropostas(sb, ids);
  if (envelopes.size === 0) return porProposta;

  const historicos = await historicoDosEnvelopes(sb, [...envelopes.values()]);

  for (const [propostaId, envelope] of envelopes) {
    const total = Array.isArray(envelope.signatarios) ? envelope.signatarios.length : 0;
    // ⚠️ "0/0" NÃO É CONTADOR, É RUÍDO. Envelope sem signatários congelados é envio que não chegou
    // a montar a lista; o card fica sem selo, que é a frase certa para "não sei de quantos".
    if (total === 0) continue;

    const historico = historicos.get(envelope.id);
    // ⚠️ `assinado` MANDA NA CONTAGEM. Ele é a palavra da casa para "todos assinaram" (a tradução
    // cuida de `closed`, que NÃO é sinônimo — ATENÇÃO 3 da 0149), e um evento perdido no caminho
    // faria o card dizer "4/5" embaixo de um contrato fechado. Para menos, o estado não sabe nada:
    // `parcial` não diz quantos, e por isso não corrige nada aqui.
    const assinaram =
      envelope.estado === "assinado" ? total : Math.min(historico?.assinaram ?? 0, total);

    porProposta.set(propostaId, {
      assinaram,
      conviteNaoEntregue: historico?.conviteNaoEntregue ?? false,
      estado: envelope.estado,
      total,
    });
  }

  return porProposta;
}

/**
 * O envelope que vale, por proposta.
 *
 * ⚠️ A RÉGUA É `envelopeQueSegura`, A MESMA DO ENVIO, DA VOLTA E DA TELA DE TRABALHO. A pergunta
 * "qual é o envelope vivo desta proposta?" já tem uma resposta única e testada; uma segunda escrita
 * aqui voltaria a divergir no dia em que um estado mudasse de lado — e o quadro mostraria um número
 * de um envelope e a tela de trabalho, o de outro.
 *
 * ⚠️ A ORDEM `criado_em desc` NÃO É ENFEITE: `envelopeQueSegura` é um `find`, e devolve o PRIMEIRO
 * que segura. Ela lê "o mais novo que ainda vale" só porque a lista chega nessa ordem.
 */
async function envelopesDasPropostas(
  sb: SupabaseClient,
  propostaIds: readonly string[],
): Promise<Map<string, EnvelopeParaContar>> {
  const escolhido = new Map<string, EnvelopeParaContar>();
  const porProposta = new Map<string, EnvelopeParaContar[]>();

  // ⚠️ LOTE DE 100, e a régua é medida: 700 ids deram 27.670 caracteres de URL e 400 Bad Request em
  // produção. O `.in()` do PostgREST viaja na URL.
  for (let i = 0; i < propostaIds.length; i += 100) {
    const lote = propostaIds.slice(i, i + 100);
    const { data, error } = await sb
      .from("temis_envelopes")
      // As mesmas colunas da guarda do envio, mais `signatarios` (o total), `proposta_id` (o elo
      // com o card) e `provedor_documento_id` (o elo com os eventos — ver `historicoDosEnvelopes`).
      .select(
        "criado_em, envelope_id, estado, falha, id, proposta_id, provedor, provedor_documento_id, signatarios",
      )
      .eq("workspace_id", "careli")
      .in("proposta_id", lote)
      .order("criado_em", { ascending: false })
      // ⚠️ O POSTGREST CORTA EM 1.000 LINHAS SEM AVISAR. Cem propostas com um punhado de envelopes
      // cada não chegam perto disso; o teto está escrito para que o corte, se um dia acontecer,
      // seja um card sem selo e nunca um número menor do que a verdade.
      .limit(1000);

    if (error) {
      console.error("[temis][assinaturas] falha ao ler os envelopes do quadro", error);
      continue;
    }

    for (const linha of (data ?? []) as EnvelopeParaContar[]) {
      if (!linha.proposta_id) continue;
      const lista = porProposta.get(linha.proposta_id) ?? [];
      lista.push(linha);
      porProposta.set(linha.proposta_id, lista);
    }
  }

  for (const [propostaId, linhas] of porProposta) {
    const vivo = envelopeQueSegura(linhas);
    // `envelopeQueSegura` devolve uma das linhas da lista, então o achado abaixo sempre existe —
    // e é ele que carrega `signatarios`, que a régua não conhece.
    const completo = vivo ? linhas.find((l) => l.id === vivo.id) : undefined;
    if (completo) escolhido.set(propostaId, completo);
  }

  return escolhido;
}

/** O que o array de eventos de um envelope diz, resumido para o selo do card. */
type HistoricoDoEnvelope = {
  assinaram: number;
  conviteNaoEntregue: boolean;
};

/**
 * O RESUMO DO HISTÓRICO DE CADA ENVELOPE, lido dos payloads guardados.
 *
 * O mapa sai chaveado pelo `id` da NOSSA linha de `temis_envelopes`, e não por um id do provedor:
 * são duas colunas diferentes que podem ligar o evento ao envelope, e quem chama não precisa saber
 * por qual delas o casamento aconteceu.
 *
 * ⚠️ O CASAMENTO É POR `provedor_documento_id`, E ISSO FOI MEDIDO — A PRIMEIRA VERSÃO DESTE LOTE
 * PROCURAVA POR `envelope_id` E NÃO ACHAVA NADA. Em 12/09/2026, nas 7 linhas de
 * `temis_assinatura_eventos`: `provedor_documento_id` preenchido em 7, `envelope_id` NULO em 7. Um
 * `in("envelope_id", ...)` casava ZERO eventos, e o card do contrato da Beatriz — 1 de 2 assinados,
 * com um convite devolvido — teria saído "0/2 assinaram", sem sinal nenhum de e-mail não entregue.
 * Quem grava o evento é a rota do webhook, que só conhece os ids que a Clicksign mandou, e a
 * Clicksign manda `document.key`. A MESMA ordem de `acharEnvelope` (`estado-db.ts`) e de
 * `payloadMaisRecente` (`diario-do-envelope-db.ts`): primeiro o que casa, depois o que salva.
 *
 * ⚠️ E A SEGUNDA CONSULTA SÓ ACONTECE SE A PRIMEIRA DEIXAR ENVELOPE SEM RESPOSTA. Hoje ela nunca
 * roda — todos casam pelo documento. Ela existe para o dia em que a Clicksign passar a mandar o id
 * do ENVELOPE (a v3 tem os dois conceitos) e é de graça enquanto não mandar.
 *
 * ⚠️ SÓ EVENTO CONFERIDO CONTA, e é a mesma régua de `ultimaAssinaturaDeComprador`: o endpoint do
 * webhook é público, e um POST forjado que não bate o HMAC é REGISTRADO e não aplicado (ATENÇÃO da
 * 0149). Contá-lo aqui deixaria alguém de fora escrever "3/3" no card sem ninguém ter assinado.
 *
 * ⚠️ OS PAYLOADS SE SOMAM, EM VEZ DE VALER SÓ O MAIS NOVO. A Clicksign manda o `document.events[]`
 * INTEIRO em todo evento, então o último payload já traz o histórico completo e a soma dá no mesmo —
 * MENOS no caso que interessa: um payload com forma inesperada (a doc da v3 não mostra um único
 * exemplo do corpo entregue ao endpoint) leria zero e apagaria, do card, assinaturas que os payloads
 * anteriores conhecem. Somar custa uma passada num dado que já está na memória e não custa consulta
 * nenhuma.
 *
 * ⚠️ E ISSO SÓ EXISTE PORQUE O PAYLOAD CRU FOI GUARDADO — decisão da 0149, no molde de
 * `apolo_asaas_eventos`. É o que faz esta leitura acontecer sem migration, sem backfill e sem
 * depender de configurar evento novo na conta da Clicksign.
 */
async function historicoDosEnvelopes(
  sb: SupabaseClient,
  envelopes: readonly EnvelopeParaContar[],
): Promise<Map<string, HistoricoDoEnvelope>> {
  const assinaram = new Map<string, Set<string>>();
  const naoEntregues = new Map<string, Set<string>>();
  const resumo = new Map<string, HistoricoDoEnvelope>();
  if (envelopes.length === 0) return resumo;

  const achou = new Set<string>();

  const passada = async (coluna: "envelope_id" | "provedor_documento_id"): Promise<void> => {
    // Do valor do provedor para as NOSSAS linhas. Lista, e não um id só: nada impede duas linhas
    // de apontarem para o mesmo documento, e a última a ser escrita não tem por que vencer.
    const nossos = new Map<string, string[]>();
    for (const envelope of envelopes) {
      if (achou.has(envelope.id)) continue;
      const valor = envelope[coluna];
      if (!valor) continue;
      nossos.set(valor, [...(nossos.get(valor) ?? []), envelope.id]);
    }

    const valores = [...nossos.keys()];
    // ⚠️ LOTE DE 100, pelo mesmo motivo da consulta dos envelopes: o `.in()` do PostgREST viaja na
    // URL, e 700 ids já deram 27.670 caracteres e 400 Bad Request em produção.
    for (let i = 0; i < valores.length; i += 100) {
      const lote = valores.slice(i, i + 100);
      const { data, error } = await sb
        .from("temis_assinatura_eventos")
        .select(`${coluna}, payload, recebido_em`)
        .in(coluna, lote)
        .eq("assinatura_conferida", true)
        .order("recebido_em", { ascending: false })
        // ⚠️ O POSTGREST CORTA EM 1.000 LINHAS SEM AVISAR — teto explícito para o corte, se um dia
        // acontecer, ser um card sem selo e nunca um número menor do que a verdade.
        .limit(1000);

      if (error) {
        console.error("[temis][assinaturas] falha ao ler os eventos do quadro", error);
        continue;
      }

      for (const bruta of data ?? []) {
        const linha = bruta as Record<string, unknown>;
        const valor = comoTexto(linha[coluna]);
        if (!valor) continue;
        const lido = lerEventosDoPayload(linha.payload);
        for (const nossoId of nossos.get(valor) ?? []) {
          achou.add(nossoId);
          juntar(assinaram, nossoId, lido.assinaram);
          juntar(naoEntregues, nossoId, lido.naoEntregues);
        }
      }
    }
  };

  await passada("provedor_documento_id");
  // Só os que sobraram — hoje, nenhum. Sem envelope pendente a consulta nem é montada.
  if (envelopes.some((e) => !achou.has(e.id) && e.envelope_id)) await passada("envelope_id");

  // ⚠️ O CONVITE QUE QUICOU MAS QUE DEPOIS ASSINOU NÃO ACENDE NADA. Corrigir o e-mail e reenviar é o
  // conserto esperado deste erro, e um selo âmbar eterno faria o quadro cobrar para sempre uma
  // pendência que alguém já resolveu — o jeito mais rápido de ensinar a operação a ignorar o selo.
  for (const nossoId of new Set([...assinaram.keys(), ...naoEntregues.keys()])) {
    const assinou = assinaram.get(nossoId) ?? new Set<string>();
    const quicou = [...(naoEntregues.get(nossoId) ?? [])].filter((quem) => !assinou.has(quem));
    resumo.set(nossoId, { assinaram: assinou.size, conviteNaoEntregue: quicou.length > 0 });
  }

  return resumo;
}

/** Junta as chaves no conjunto daquele envelope, criando-o na primeira vez. */
function juntar(mapa: Map<string, Set<string>>, chave: string, valores: Set<string>): void {
  const conjunto = mapa.get(chave) ?? new Set<string>();
  for (const valor of valores) conjunto.add(valor);
  mapa.set(chave, conjunto);
}

/**
 * O QUE O `document.events[]` DE UM PAYLOAD DIZ.
 *
 * ⚠️ TOLERANTE DE PROPÓSITO, pelo mesmo motivo de `lerEventoDoWebhook`: a doc da v3 lista os 30
 * eventos e não mostra UM exemplo do corpo entregue ao endpoint. O documento aparece na raiz, dentro
 * de `data` (JSON:API, que é o formato da v3) ou dentro de `event` (formato antigo) — procuramos nos
 * três, e o que não for achado não vira palpite: vira zero, e o card fica sem selo.
 *
 * Devolve CHAVES DE PESSOAS, e não números: quem chama soma os payloads de um mesmo envelope, e
 * somar conjuntos é o que impede o reenvio do mesmo webhook de contar a assinatura duas vezes.
 *
 * ⚠️ EXPORTADA SÓ PARA O TESTE, e com motivo: é a única parte pura desta contagem — o resto é
 * consulta —, e é dela que sai o número que o operador lê no card. Ela está presa ao payload REAL
 * do envelope da Beatriz em `trabalhos-db.test.ts`.
 */
export function lerEventosDoPayload(payload: unknown): {
  assinaram: Set<string>;
  naoEntregues: Set<string>;
} {
  const raiz = comoObjeto(payload);
  const documento = primeiroObjeto([
    raiz.document,
    comoObjeto(raiz.data).document,
    comoObjeto(raiz.event).document,
  ]);
  const eventos = Array.isArray(documento.events) ? documento.events : [];

  const assinaram = new Set<string>();
  const naoEntregues = new Set<string>();

  for (const cru of eventos) {
    const evento = comoObjeto(cru);
    const nome = comoTexto(evento.name);
    const dados = comoObjeto(evento.data);
    const signatario = comoObjeto(dados.signer);
    // ⚠️ A CHAVE ANTES DO E-MAIL: é ela que identifica o signatário na Clicksign, e o e-mail pode
    // ter sido corrigido entre o convite que quicou e o que chegou.
    const quem =
      comoTexto(signatario.key) ||
      comoTexto(signatario.email).toLowerCase() ||
      comoTexto(signatario.name).toLowerCase();
    if (!quem) continue;

    // ⚠️ `sign` É UMA PESSOA, NÃO O FIM. Quem fecha o contrato é `close`/`auto_close`, e por isso o
    // fechamento não entra nesta conta — ele é o `estado` do envelope, tratado por quem chamou.
    if (nome === "sign") assinaram.add(quem);
    // O caso medido (12/09/2026, envelope 3e9a331d): `last_status: "bounce"`,
    // `last_bounce_type: "HardBounce"`, `550 5.1.1 ... NoSuchUser`. O nome do evento basta — toda
    // notificação com erro é um convite que não chegou, e o motivo exato é assunto do diário, na
    // tela de trabalho.
    if (nome === "tracking_notification_error") naoEntregues.add(quem);
  }

  return { assinaram, naoEntregues };
}

/** O valor como objeto, ou um objeto vazio. Nunca lança, nunca devolve nulo. */
function comoObjeto(valor: unknown): Record<string, unknown> {
  return valor !== null && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

/**
 * O primeiro candidato que é mesmo um objeto com alguma coisa dentro.
 *
 * ⚠️ NÃO DÁ PARA USAR `??` AQUI, e o repo já pagou por isso: `comoObjeto()` nunca devolve nullish —
 * devolve `{}` —, então `comoObjeto(a) ?? comoObjeto(b)` faz de `b` código morto e só a primeira
 * hipótese é lida de verdade (ver a nota de `lerEventoDoWebhook`).
 */
function primeiroObjeto(candidatos: unknown[]): Record<string, unknown> {
  for (const candidato of candidatos) {
    const objeto = comoObjeto(candidato);
    if (Object.keys(objeto).length > 0) return objeto;
  }
  return {};
}

/** O valor como texto aparado, ou string vazia. */
function comoTexto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
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
  /**
   * QUEM CONFECCIONA: o `apolo_incorporadores.id` quando é o time do incorporador; nulo (ou
   * ausente) quando é a Careli. Vai para `temis_trabalhos.operado_por` (migration 0172).
   *
   * ⚠️ QUEM DECIDE É A ORIGEM DA VENDA (Lucas, 16/09/2026): a rota do portal só preenche quando
   * `portalConfeccionaContrato(slug, tipo)`. A venda da Gurgel no produto da Cecílio fica nula e
   * vai para a Têmis da Careli.
   */
  operadoPor?: null | string;
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

export type OpcoesDaAbertura = {
  /**
   * Com a 0172 pendente, grava o card SEM dono (na fila da Careli) em vez de recusar.
   *
   * ⚠️ SÓ QUEM PEDE EXPLICITAMENTE (revisão da onda 3, 16/09/2026). Foi pensado para a VENDA: as
   * rotas de venda não derrubam a transição quando a Têmis falha, e recusar ali perderia o pedido
   * inteiro. Como padrão, valia também para a abertura LIVRE do portal (`POST
   * /api/incorporador/temis/trabalhos`, texto do corpo): gente de fora escrevia um card na Têmis da
   * Careli, que o portal nem conseguia mais abrir nem desfazer. Sem esta opção, a coluna ausente
   * volta como `colunaDoDonoAusente` e quem chama responde 503.
   */
  semDonoSeFaltarColuna?: boolean;
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
  opcoes: OpcoesDaAbertura = {},
): Promise<{ colunaDoDonoAusente?: true; erro: string; ok: false } | { id: string; ok: true }> {
  if (novo.canal === "iris" && (!novo.irisTicketId || !novo.evidenciaPath)) {
    return {
      erro: "solicitação pelo atendimento exige o ticket da Iris e a evidência do pedido do cliente",
      ok: false,
    };
  }

  const supabase = createApoloAdminClient();
  if (!supabase) return { erro: "sem acesso ao banco", ok: false };

  const linha: Record<string, unknown> = {
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
  };

  // ⚠️ A COLUNA SÓ ENTRA NO INSERT QUANDO HÁ DONO. O trabalho da Careli (nulo) nem cita
  // `operado_por`, e por isso o hub abre card igual ao de hoje com ou sem a migration 0172.
  const operadoPor = typeof novo.operadoPor === "string" ? novo.operadoPor.trim() : "";
  if (operadoPor) linha.operado_por = operadoPor;

  const inserir = (valores: Record<string, unknown>) =>
    supabase
      .from("temis_trabalhos")
      .insert(valores)
      .select("estagio, id")
      .single<{ estagio: null | string; id: string }>();

  let resposta = await inserir(linha);

  // ⚠️ 0172 PENDENTE, SEM A OPÇÃO: RECUSA. O card com dono não pode cair calado na fila da Careli
  // (ver `OpcoesDaAbertura`); quem chama traduz para 503.
  if (
    resposta.error &&
    operadoPor &&
    ehColunaDoDonoAusente(resposta.error) &&
    !opcoes.semDonoSeFaltarColuna
  ) {
    console.error("[temis] migration 0172 pendente: trabalho com dono NÃO aberto", {
      operadoPor,
      propostaId: novo.propostaId ?? null,
      tipo: novo.tipo,
    });
    return {
      colunaDoDonoAusente: true,
      erro: "a Têmis ainda não registra quem confecciona o trabalho (migration 0172 pendente)",
      ok: false,
    };
  }

  // ⚠️ 0172 PENDENTE, COM A OPÇÃO: O CARD NASCE NA FILA DA CARELI, E ISSO GRITA NO LOG. Recusar aqui
  // perderia o pedido inteiro (as rotas de venda não derrubam a transição quando a Têmis falha, e o
  // card simplesmente não existiria); gravar sem dono deixa o contrato visível para alguém
  // redistribuir.
  if (resposta.error && operadoPor && ehColunaDoDonoAusente(resposta.error)) {
    console.error(
      "[temis] migration 0172 pendente: trabalho aberto SEM operado_por, vai para a fila da Careli",
      { operadoPor, propostaId: novo.propostaId ?? null, tipo: novo.tipo },
    );
    const semDono = { ...linha };
    delete semDono.operado_por;
    resposta = await inserir(semDono);
  }

  const { data, error } = resposta;
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
 *
 * ⚠️ E O CARD NÃO ANDA SOBRE VENDA MORTA (`recusaPorVendaDesfeita`). Ver a nota dela: esta função
 * nunca lia `hercules_propostas`, e era por isso que um card de contrato cancelado ou distratado
 * podia atravessar as marcações até "Faturado" mostrando FATURADO sobre uma venda desfeita.
 */
export async function marcarAtividade(input: {
  atividade: string;
  feita: boolean;
  id: string;
  /** Quem marcou: o usuário do hub ou do portal (`idDoAutor`). Vai para a passagem de etapa. */
  quem?: null | string;
  /** O nome de quem marcou (`nomeDoAutor`). Nulo quando não há nome: não se inventa autor. */
  quemNome?: null | string;
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

  // ⚠️ ANTES DE QUALQUER MARCAÇÃO, E NÃO SÓ ANTES DO AVANÇO. Ver `recusaPorVendaDesfeita`.
  const recusa = await recusaPorVendaDesfeita(supabase, trabalho);
  if (recusa) return recusa;

  const feitas = new Set(trabalho.atividadesFeitas);
  if (input.feita) feitas.add(input.atividade);
  else feitas.delete(input.atividade);

  const depois = { ...trabalho, atividadesFeitas: [...feitas] };
  const avanca = input.feita && podeAvancar(depois);
  const seguinte = avanca ? proximoEstagio(depois.tipo, depois.estagio) : null;

  // ⚠️ O PEDIDO NÃO CHEGA A CONCLUÍDO PELA MARCAÇÃO (24/09/2026). O Concluído do card de cancelamento
  // ou de distrato é o botão Concluir (`concluirCancelamentoDoCard`), que derruba a venda, a reserva e
  // devolve o lote pela trava. Pela marcação, o card chegava a "Concluído" com a venda viva, a reserva
  // viva e o lote preso, e o quadro dizia que estava tudo feito. Lucas, 24/09/2026: *"lembrando que
  // quando tem cancelamento a unidade tem que ficar disponivel, tem que ter esse reflexo"*. Medido em
  // 24/09/2026: nunca aconteceu (as 9 passagens "atividade" de pedido são conclusões pelo botão,
  // gravadas com a origem antiga porque a 0177 não está aplicada), e a trava fecha a porta antes.
  // Marcar ou desmarcar sem avançar continua livre.
  if (seguinte === "faturado" && (depois.tipo === "cancelamento" || depois.tipo === "distrato")) {
    return {
      erro: `esta é a última atividade antes de Concluído, e quem conclui o ${depois.tipo === "distrato" ? "distrato" : "cancelamento"} é o botão Concluir, que derruba a venda e solta o lote. Use Concluir no card; nada foi marcado.`,
      ok: false,
    };
  }

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
  // ⚠️ O AUTOR É QUEM A ROTA INFORMA (arrumação da onda 3, 16/09/2026). Até aqui a passagem saía sem
  // "quem" nos dois lados, e o histórico do card não dizia quem fez o card andar. Quem chama sem
  // autor continua gravando vazio: vazio é melhor que errado num registro lido como prova.
  if (seguinte) {
    await registrarPassagemDeEtapa(supabase, {
      de: trabalho.estagio,
      origem: "atividade",
      para: seguinte,
      propostaId: trabalho.propostaId,
      quem: input.quem ?? null,
      quemNome: input.quemNome ?? null,
      trabalhoId: input.id,
      trabalhoTipo: depois.tipo,
    });

    // ⚠️ E A VENDA VAI JUNTO (24/09/2026): Pré-faturamento → Faturado leva a venda de `assinatura`
    // para `faturado`; Contrato → Em assinatura sem envelope leva de `contrato` para `assinatura`. O
    // reflexo nunca escreve o cadastro da unidade nem `data_faturamento` (decisão pendente do Lucas)
    // e nunca desfaz o card: falha vira log.
    const passo = {
      autorNome: input.quemNome ?? null,
      de: trabalho.estagio,
      motivo: motivoDoReflexo(trabalho.estagio, seguinte),
      para: seguinte,
      propostaId: trabalho.propostaId,
      trabalhoTipo: depois.tipo,
    };
    registrarReflexoQueNaoAndou(input.id, passo, await refletirCardNaVenda(supabase, passo));
  }

  return { andou: Boolean(seguinte), estagio: seguinte ?? trabalho.estagio, ok: true };
}

/**
 * O CARD NÃO ANDA QUANDO A VENDA DELE JÁ FOI DESFEITA — a trava na RAIZ do avanço.
 *
 * ⚠️ `marcarAtividade` NUNCA LEU `hercules_propostas`, E ESSE ERA O DEFEITO. Com a venda cancelada
 * ou distratada, as atividades que restaram no card continuavam podendo ser marcadas, `proximoEstagio`
 * levava o card adiante e a última marcação o deixava em **Faturado**: o quadro mostrando FATURADO
 * sobre uma venda morta, e `arrependimento_inicio` contando prazo de um contrato que não existe mais.
 *
 * ⚠️ O CONSERTO É AQUI, E NÃO NO BOTÃO NOVO DE CANCELAR. O estado nasce do pedido pela tela Venda do
 * Hércules desde que ele existe: nas etapas em que o contrato está assinado por todos o motor RECUSA
 * indeferir o card de contrato e só empilha aviso, então o card sobrevive à queda da venda. Consertar
 * só a porta nova deixaria a porta antiga produzindo o mesmo card mentiroso.
 *
 * ⚠️ ALCANCE MEDIDO EM PRODUÇÃO (23/09/2026), ANTES DE ESCREVER A TRAVA: 13 cards têm a venda morta,
 * e os 13 estão em `faturado` (9) ou `indeferido` (4) — nenhum num estágio de onde se ande. Ou seja:
 * NENHUM card mente na tela hoje, e esta trava não muda uma linha do que está lá. Ela fecha o caminho
 * pelo qual o próximo mentiria.
 *
 * ⚠️ CARD JÁ ENCERRADO NÃO É CONSULTADO, DE PROPÓSITO. De `faturado` e `indeferido` não há próximo
 * estágio (`estagiosDoTipo`), então card encerrado não anda de jeito nenhum: travar a marcação dele
 * tiraria de quem arruma registro antigo (os 13 acima, entre eles os 9 pedidos já concluídos, que por
 * definição TÊM a venda desfeita) a correção que nunca fez mal a ninguém.
 *
 * ⚠️ LEITURA QUE FALHA RECUSA, e não deixa passar. "Não consegui perguntar" não é "a venda está
 * viva", e o preço dos dois lados é assimétrico: recusar custa um clique repetido, deixar passar
 * custa um card em Faturado sobre venda distratada, que ninguém desfaz sozinho.
 *
 * ⚠️ VENDA NÃO ENCONTRADA PASSA. `proposta_id` apontando para linha que não existe é elo quebrado, e
 * não venda desfeita: travar por causa dele congelaria o card sem ter medido nada. O log grita.
 */
async function recusaPorVendaDesfeita(
  supabase: SupabaseClient,
  trabalho: Pick<TrabalhoDoBoard, "estagio" | "propostaId">,
): Promise<null | { erro: string; ok: false }> {
  if (!trabalho.propostaId) return null;
  if ((ESTAGIOS_ENCERRADOS as readonly string[]).includes(trabalho.estagio)) return null;

  const { data, error } = await supabase
    .from("hercules_propostas")
    .select("etapa")
    .eq("workspace_id", "careli")
    .eq("id", trabalho.propostaId)
    .maybeSingle<{ etapa: null | string }>();

  if (error) {
    console.error("[temis] não foi possível conferir a venda do card antes de marcar", {
      erro: error.message,
      proposta: trabalho.propostaId,
    });
    return {
      erro: "não foi possível conferir agora se a venda deste card continua de pé; nada foi marcado, tente de novo em instantes",
      ok: false,
    };
  }

  if (!data) {
    console.error("[temis] card com proposta_id sem venda no banco", { proposta: trabalho.propostaId });
    return null;
  }

  const etapa = String(data.etapa ?? "").trim();
  if (!VENDA_DESFEITA.has(etapa)) return null;

  return {
    erro: `a venda deste card já foi ${etapa === "distrato" ? "distratada" : "cancelada"}: o card não anda mais. Indefira o card para ele sair da fila.`,
    ok: false,
  };
}

/**
 * O DONO E O EMPREENDIMENTO DE UM TRABALHO — o que `trabalhoNoAlcance` (ator.ts) precisa para
 * decidir se a rota do portal pode tocar nele.
 *
 * ⚠️ RODA ANTES DA LEITURA DO CARD, nunca depois. É a mesma regra de `unidadeNoEscopo`: conferir o
 * escopo com o card já em mãos é o mesmo que não conferir. Duas colunas, uma linha, nenhum dado do
 * cliente.
 *
 * ⚠️ NULO É "NÃO ACHEI OU NÃO CONSEGUI LER", e quem chama responde 404 nos dois casos. Id que não é
 * uuid (o Postgres recusa com `22P02`) cai aqui calado: é alguém mexendo na URL, não defeito.
 *
 * ⚠️ TOLERANTE À 0172 NÃO APLICADA: sem a coluna, nenhum trabalho tem dono de fora, e o
 * `operado_por` volta nulo (a Careli) — o que faz o portal receber 404 em tudo, como deve.
 */
export async function donoDoTrabalho(
  id: string,
): Promise<null | { enterprise_id: string; operado_por: null | string }> {
  const alvo = typeof id === "string" ? id.trim() : "";
  if (!alvo) return null;

  const supabase = createApoloAdminClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("temis_trabalhos")
    .select("enterprise_id, operado_por")
    .eq("workspace_id", "careli")
    .eq("id", alvo)
    .maybeSingle<{ enterprise_id: null | string; operado_por: null | string }>();

  if (error && ehColunaDoDonoAusente(error)) {
    const semDono = await supabase
      .from("temis_trabalhos")
      .select("enterprise_id")
      .eq("workspace_id", "careli")
      .eq("id", alvo)
      .maybeSingle<{ enterprise_id: null | string }>();
    if (semDono.error || !semDono.data) return null;
    return { enterprise_id: String(semDono.data.enterprise_id ?? ""), operado_por: null };
  }

  if (error) {
    if ((error as { code?: unknown }).code !== "22P02") {
      console.error("[temis] falha ao ler o dono do trabalho", error);
    }
    return null;
  }
  if (!data) return null;

  return { enterprise_id: String(data.enterprise_id ?? ""), operado_por: data.operado_por ?? null };
}
