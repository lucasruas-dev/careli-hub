// A HABILITAÇÃO SEM FILA — a imobiliária que passou a valer num empreendimento sem ninguém decidir no
// Board. Só a regra, sem banco e sem React: o servidor do Board classifica os vínculos com ela e a tela
// escreve o selo com ela, e as duas pontas não podem ter duas definições do que é "sem fila".
//
// ⚠️ POR QUE EXISTE (Lucas, 24/09/2026, "3 - Isso ae"). Duas portas habilitam imobiliária sem passar
// pela fila de validação, e as duas eram INVISÍVEIS no Board:
//   • a AUTOMÁTICA: a imobiliária já credenciada que pede empreendimento novo na página pública é
//     aprovada sozinha (regra do Lucas de 15/08). Medido em 24/09/2026: 59 imobiliárias, 37 nos últimos
//     30 dias, nenhuma na tela (a CONECTTA IMOVEIS no 43 foi a que acendeu o problema);
//   • o CADASTRO INTERNO: o operador que cadastra pelo wizard do hub já valida (regra de 17/08), e o
//     vínculo nasce `verified`. VINICIUS JOHNNY, VIDA IMOVEIS e SANTA FE no 43 em 24/09, BILL no 29 em
//     21/09: nenhuma apareceu.
// A decisão: as duas aparecem na coluna Habilitada por 30 dias, com um selo que diz de onde vieram.

export type OrigemSemFila = "automatica" | "interna";

/**
 * O selo do card: quando e por qual porta a imobiliária foi habilitada sem fila.
 *
 * `empreendimentos` (revisão de 24/09/2026): EM QUAL produto foi a habilitação sem fila. A ficha é uma
 * só para todos os produtos, e sem o nome o hover dizia "sem fila em 24/09" no card filtrado pelo Vale
 * do Ouro sobre uma habilitação que foi no Portal do Ibituruna (a CONECTTA IMOVEIS). Opcional só para
 * o selo montado à mão nos testes; o servidor sempre manda.
 */
export type HabilitadaSemFila = { em: string; empreendimentos?: string[]; origem: OrigemSemFila };

/**
 * A marca que a página pública grava ao PROMOVER um pedido `pending` a `verified` (revisão de
 * 24/09/2026). A linha promovida guarda o `created_at` do pedido antigo e o `source: "apolo"` do cadastro
 * público, sem autor: sem a marca, a auto-aprovação dela sumia do Board (pedido com mais de 30 dias) ou
 * aparecia como decisão da fila. `habilitadoEm` é a hora da promoção.
 */
export const PORTA_DA_PROMOCAO_PUBLICA = "publico-imobiliaria";

/** O vínculo de empreendimento como a perna (d) do Board lê do banco. */
export type VinculoDeHabilitacao = {
  created_at: null | string;
  entity_id: null | string;
  metadata: null | Record<string, unknown>;
};

/** O `enterpriseId` do vínculo, aparado ("" quando não há). */
export function enterpriseIdDoVinculo(metadata: null | Record<string, unknown> | undefined): string {
  const id = metadata?.enterpriseId;
  return typeof id === "string" || typeof id === "number" ? String(id).trim() : "";
}

/**
 * QUANDO o vínculo passou a valer: a hora da promoção (`habilitadoEm`), quando houve, ou a criação.
 * Um pedido criado em julho e aprovado hoje foi habilitado HOJE.
 */
export function momentoDaHabilitacao(vinculo: VinculoDeHabilitacao): null | string {
  const promovido = vinculo.metadata?.habilitadoEm;
  if (typeof promovido === "string" && !Number.isNaN(new Date(promovido).getTime())) return promovido;
  return vinculo.created_at;
}

/**
 * O que um vínculo de EMPREENDIMENTO `verified` diz sobre como ele passou a valer.
 *
 *   • `cad`: não é habilitação de imobiliária, é o empreendimento da CAD de um cliente (`publico-cad`,
 *     o formulário público de CAD, e `mover-cad`, a troca de produto da CAD). Não entra no Board por aqui.
 *   • `fila`: passou pela decisão de alguém no Board. `apolo-credenciamento` é o vínculo que o Board cria
 *     ao habilitar; `apolo` SEM `createdBy` é o do cadastro PÚBLICO de imobiliária, que nasce pendente
 *     e só vale depois que o operador habilita (medido em 24/09/2026: 42 imobiliárias, todas decididas
 *     no Board).
 *   • `automatica`: `publico-imobiliaria`, o caminho "já credenciada" da página pública.
 *   • `interna`: o resto. `apolo` COM `createdBy` é gente da Careli (o wizard do hub e o modal de
 *     relacionamento da ficha gravam o autor; a página pública grava `ownerUserId: null`), e o que veio
 *     por script ou teste (sem `source`, `setup-*`) também foi feito por dentro, sem fila.
 *
 * ⚠️ O `createdBy` É O QUE SEPARA O WIZARD DO CADASTRO PÚBLICO: os dois passam por `createApoloEntity`
 * e gravam `source: "apolo"`. Ler só o `source` poria o selo "cadastro interno" em toda imobiliária que
 * se cadastrou pela página pública e foi habilitada no Board, ou seja, que passou pela fila.
 *
 * ⚠️ A PROMOÇÃO PÚBLICA GANHA DO `source` (revisão de 24/09/2026): o pedido antigo `pending` que a
 * página pública aprova sozinha continua com o `source: "apolo"` sem autor do cadastro original, e só a
 * marca `habilitadoPela` diz que ele passou a valer pela porta automática.
 */
export function origemDoVinculo(
  metadata: null | Record<string, unknown> | undefined,
): "cad" | "fila" | OrigemSemFila {
  const source = typeof metadata?.source === "string" ? metadata.source.trim() : "";
  const origem = typeof metadata?.origem === "string" ? metadata.origem.trim() : "";
  const autor = typeof metadata?.createdBy === "string" ? metadata.createdBy.trim() : "";
  const promovidoPela =
    typeof metadata?.habilitadoPela === "string" ? metadata.habilitadoPela.trim() : "";

  if (source === "publico-cad" || origem === "mover-cad") return "cad";
  if (promovidoPela === PORTA_DA_PROMOCAO_PUBLICA) return "automatica";
  if (source === "apolo-credenciamento") return "fila";
  if (source === "publico-imobiliaria") return "automatica";
  if (source === "apolo" && !autor) return "fila";
  return "interna";
}

/** A última habilitação de uma entidade: quando, por qual porta e em QUAIS empreendimentos. */
export type UltimaHabilitacao = {
  em: string;
  /** Os `enterpriseId` da gravação que venceu (uma gravação pode habilitar vários de uma vez). */
  enterpriseIds: string[];
  /** Nulo = passou pela fila (decisão no Board): a entidade entra no Board, sem selo. */
  origem: null | OrigemSemFila;
};

/**
 * A ÚLTIMA habilitação de cada entidade, entre os vínculos lidos (os de CAD já ficam de fora).
 *
 * `origem` nulo = a última habilitação passou pela fila: a entidade entra no Board (é imobiliária
 * habilitada há pouco), mas SEM selo. O selo diz como ela chegou AGORA, e uma decisão do Board depois
 * de uma automática não é mais "sem fila". Exportada para o teste.
 *
 * ⚠️ QUEM CHAMA ESCOLHE OS VÍNCULOS, E É ASSIM QUE O PORTAL SE PROTEGE (revisão de 24/09/2026). No
 * portal do coordenador, só entram os vínculos do produto do recorte: a CONECTTA IMOVEIS (automática
 * no 43 em 24/09, Vale do Ouro desde 02/08) aparecia no portal do Vale do Ouro com o selo e a data do
 * 43, e o coordenador de um produto lia a habilitação de outro.
 */
export function ultimaHabilitacaoPorEntidade(
  vinculos: VinculoDeHabilitacao[],
): Map<string, UltimaHabilitacao> {
  const porEntidade = new Map<string, UltimaHabilitacao>();
  // Os vínculos que valem, com a hora e a porta já calculadas (a segunda passada relê).
  const validos: Array<{ em: string; entidade: string; id: string; origem: null | OrigemSemFila }> = [];

  for (const vinculo of vinculos) {
    const entidade = vinculo.entity_id;
    const em = momentoDaHabilitacao(vinculo);
    if (!entidade || !em) continue;
    const tipo = origemDoVinculo(vinculo.metadata);
    if (tipo === "cad") continue;
    const origem = tipo === "fila" ? null : tipo;
    validos.push({ em, entidade, id: enterpriseIdDoVinculo(vinculo.metadata), origem });

    const atual = porEntidade.get(entidade);
    // Pelo INSTANTE, não pelo texto: a hora da promoção sai do `toISOString` ("...000Z") e o
    // `created_at` do banco sai com microssegundos e "+00:00"; comparadas como texto, erram no detalhe.
    const diferenca = atual ? Date.parse(atual.em) - Date.parse(em) : 0;
    // Empate de horário (vários vínculos da mesma gravação): quem é sem fila ganha, porque a gravação
    // única que habilitou vários empreendimentos saiu de UMA porta só.
    if (atual && (diferenca > 0 || (diferenca === 0 && atual.origem))) continue;
    porEntidade.set(entidade, { em, enterpriseIds: [], origem });
  }

  // Os empreendimentos da gravação que venceu: mesma hora e mesma porta.
  for (const valido of validos) {
    const vencedora = porEntidade.get(valido.entidade);
    if (!vencedora || vencedora.origem !== valido.origem) continue;
    if (Date.parse(vencedora.em) !== Date.parse(valido.em)) continue;
    if (valido.id && !vencedora.enterpriseIds.includes(valido.id)) vencedora.enterpriseIds.push(valido.id);
  }
  return porEntidade;
}

/** O texto do selo no hover. Sem travessão (regra do Lucas para texto de tela). */
export function tituloDoSeloSemFila(selo: HabilitadaSemFila): string {
  const quando = new Date(selo.em);
  const data = Number.isNaN(quando.getTime())
    ? ""
    : ` em ${quando.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`;
  // ONDE foi a habilitação: a ficha é uma para todos os produtos, e o card aparece no filtro de
  // qualquer um deles (revisão de 24/09/2026).
  const nomes = [...new Set((selo.empreendimentos ?? []).map((nome) => nome.trim()).filter(Boolean))];
  const onde =
    nomes.length === 0
      ? ""
      : ` para ${nomes.length === 1 ? nomes[0] : `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`}`;
  return selo.origem === "automatica"
    ? `Habilitada sem fila${onde}${data}: automática, pela página pública (a imobiliária já era credenciada).`
    : `Habilitada sem fila${onde}${data}: pelo cadastro interno.`;
}
