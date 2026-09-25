// Cenário comercial dos EMPREENDIMENTOS (Apolo). Lê o C2X (read-only) e aplica a regra de
// governança do Hades — fonte única em lib/guardian/c2x-analytics.ts:
//   - EXCLUDED_ENTERPRISE_IDS: 2, 31 e 34 (SDT, LAB, TSC) ficam de fora (teste + masterplan). Era
//     `EXCLUDED_ENTERPRISE_CODES`, pela SIGLA, e parou de excluir o 30 quando o LAG virou ADT no C2X
//     (16/07/2026). Pelo id, um renome no legado não muda mais quem sai (PAN-124).
//   - ENTERPRISE_GROUPS: etapas do mesmo produto viram UMA linha consolidada (Lavra do Ouro =
//     LOS+LOU, Lagoa Bonita = LBF+LBR+LBP...), com as etapas como sub-linhas expansíveis.
//   - ENTERPRISE_MIRRORS: o ESPELHO (hoje o VLO) CONTINUA LISTADO mas fica FORA de `totals`.
//     Ele é o registro do Vale do Ouro antes da divisão, e suas 298 unidades são as mesmas de
//     VOC + VOL — somar os três contava o loteamento duas vezes (4.560 un / R$ 1.068.042.231,43
//     na tela quando o certo é 4.262 un / R$ 1.040.273.342,43, medido em 18/08/2026). A linha
//     não pode sumir: é por ela que se chega ao masterplan e às CADs da esteira.
//
// Baldes de unidade (mutuamente exclusivos, somam o total): os CINCO de `baldeDaSituacao`, pela
// régua única do Panteon (lib/hercules/situacao-da-unidade.ts). Do C2X vem só a LINHA (quais
// unidades existem e quanto valem); a situação de cada uma é a do Panteon, a mesma da Venda do
// Hércules (Lucas, 18/09/2026: *"esses status tem que morar em um so lugar"* · *"no c2x não
// precisa olhar"*).
import type { RowDataPacket } from "mysql2";

import { filtroPorIds, filtroSemExcluidos, idDoC2x, semExcluidos } from "@/lib/apolo/c2x-pelo-id";
import { idsDoC2xDasSiglasAoVivo, type OrigemDaSigla } from "@/lib/apolo/c2x-pelo-id-servidor";
import { createApoloAdminClient, deterministicUuid } from "@/lib/apolo/server";
import {
  acharUnidade,
  baldeDaSituacao,
  lerSituacaoDasUnidades,
  rotuloDaSituacao,
  type SituacaoDaUnidade,
  type SituacaoDasUnidades,
  situacaoDoTerreno,
  type UnidadeComSituacao,
} from "@/lib/hercules/situacao-da-unidade";
import { createPrometeuClient } from "@/lib/prometeu/data";
import {
  type ReservaViva,
  reservasVivasPorCodigo,
} from "@/lib/prometeu/reservas-vivas";
import {
  ENTERPRISE_GROUPS,
  ENTERPRISE_MIRRORS,
  findEnterpriseMirror,
} from "@/lib/guardian/c2x-analytics";
import { getHadesDbPool } from "@/lib/guardian/db";

// (16/09/2026) O mapa `SALE_STATUS` que morava aqui saiu: ele não tinha mais leitor neste arquivo
// (a régua do status virou `baldeDaUnidade`, e o vocabulário vive em lib/apolo/balde-da-unidade.ts,
// que exporta o seu próprio `SALE_STATUS`).

// Abas da ficha do empreendimento. O estado vive no ApoloPage (e não na tela) pra o "voltar"
// do CRM devolver o usuário NA ABA em que ele estava.
export type ApoloEnterpriseTab =
  // Fotos e vídeos do produto (16/09/2026): a mesma aba que o portal do incorporador publica.
  | "arquivos"
  | "cadastro"
  | "carteira"
  // As etapas do produto consolidado, com as unidades de cada uma. Só existe no agrupado.
  | "filhos"
  // Os três links públicos do produto (espelho, CAD, imobiliária), prontos para copiar. Dois
  // deles são links da CASA e não deste empreendimento — a aba diz isso na tela.
  | "links"
  | "mapa"
  // Planos de pagamento do Temis. Fica separada de "politica" de propósito: a política é o acordo
  // com o incorporador (comissão, gestão de carteira) e vem do C2X; o plano é o que o CLIENTE
  // assina, nasce no Panteon e decide qual minuta o contrato usa.
  // As minutas do Temis: o texto do contrato que o plano manda usar.
  | "minutas"
  | "planos"
  | "politica"
  | "relacionamentos"
  | "resumo"
  | "setup"
  | "unidades"
  | "vendas";

export type ApoloEnterpriseBucket =
  | "disponivel"
  | "reservado"
  | "negociacao"
  /** A venda pedindo para sair, desde 21/09/2026. Ver `em_cancelamento` na régua da situação. */
  | "em_cancelamento"
  | "vendido"
  | "bloqueado";

export type ApoloEnterpriseTally = {
  units: number;
  value: number;
};

export type ApoloEnterpriseScenario = Record<
  ApoloEnterpriseBucket | "total",
  ApoloEnterpriseTally
>;

/**
 * Os baldes do cenário, na ordem em que as telas os leem — e a lista ÚNICA de quem monta um cenário
 * do zero.
 *
 * ⚠️ TRÊS LUGARES MONTAVAM O CENÁRIO COM A PRÓPRIA CÓPIA DESTA LISTA (`sumScenarios` aqui,
 * `cenarioVazio` do painel de produtos e o helper do teste da rota), e os três com
 * `{} as ApoloEnterpriseScenario`: o tipo prometia a chave e o objeto saía sem ela. Quando o balde
 * `em_cancelamento` nasceu, em 21/09/2026, `cenario.em_cancelamento.units` quebraria em tempo de
 * execução sem um aviso sequer do typecheck. Balde novo entra aqui, uma vez.
 */
export const BALDES_DO_CENARIO: ReadonlyArray<ApoloEnterpriseBucket | "total"> = [
  "total",
  "disponivel",
  "reservado",
  "negociacao",
  "em_cancelamento",
  "vendido",
  "bloqueado",
];

export type ApoloEnterpriseRow = {
  city: string | null;
  // Código C2X (ex.: LBR). No grupo consolidado, o rótulo das etapas ("LBF + LBR + LBP").
  code: string;
  // Códigos reais (1 na linha simples; N no produto consolidado). Usado pra buscar unidades.
  codes: string[];
  id: string;
  incorporador: string | null;
  /**
   * ESPELHO HISTÓRICO (ENTERPRISE_MIRRORS): esta linha tem os MESMOS lotes de outras que estão
   * vivas. Ela continua na listagem — é por onde se chega ao masterplan e às CADs —, mas NÃO
   * entra em `totals`. Quem for somar rows por conta própria tem que filtrar por este campo.
   */
  mirror: boolean;
  /**
   * Rótulo pronto pra tela quando `mirror` é true ("Histórico · mesmos lotes de VOC + VOL");
   * null quando a linha é normal. ⚠️ PENDENTE: a view (modules/apolo/blocks/empreendimentos)
   * ainda não desenha esta etiqueta — o campo já vem preenchido esperando o selo.
   */
  mirrorLabel: string | null;
  /**
   * O porquê inteiro, para o `title` da tela: de onde veio o espelho, por que ele fica de fora da
   * soma e por que ele continua no ar. O rótulo cabe na linha; a explicação cabe no hover.
   */
  mirrorNote: string | null;
  name: string;
  scenario: ApoloEnterpriseScenario;
  state: string | null;
  // Etapas do produto (só no grupo consolidado). Vazio = linha simples.
  stages: ApoloEnterpriseRow[];
};

export type ApoloEnterprisesData = {
  /** Todas as linhas, ESPELHO INCLUÍDO (marcado com `mirror`). */
  rows: ApoloEnterpriseRow[];
  /** Total geral SEM os espelhos — senão o Vale do Ouro entra duas vezes. */
  totals: ApoloEnterpriseScenario;
};

type EnterpriseQueryRow = RowDataPacket & {
  bloqueado_units: number | string | null;
  bloqueado_value: string | number | null;
  city: string | null;
  code: string | null;
  disponivel_units: number | string | null;
  disponivel_value: string | number | null;
  id: number;
  incorporador: string | null;
  name: string | null;
  negociacao_units: number | string | null;
  negociacao_value: string | number | null;
  reservado_units: number | string | null;
  reservado_value: string | number | null;
  state: string | null;
  total_units: number | string | null;
  total_value: string | number | null;
  vendido_units: number | string | null;
  vendido_value: string | number | null;
};

/** O que `loadApoloEnterprises` precisa de cada empreendimento, sem contar unidade nenhuma. */
type EnterpriseMetaRow = RowDataPacket & {
  city: string | null;
  code: string | null;
  id: number;
  incorporador: string | null;
  name: string | null;
  state: string | null;
};

/** Uma unidade do C2X para os cards: onde ela conta, quanto vale e as chaves para achá-la no Panteon. */
type EnterpriseUnitRow = RowDataPacket & {
  block: string | null;
  enterprise_code: string | null;
  enterprise_id: number | string;
  id: number;
  lot: string | null;
  price: string | number | null;
  unit_name: string | null;
};

/** Uma linha do C2X para os cards, só com o que a contagem usa (exportada para o teste). */
export type UnidadeDoCard = Pick<
  EnterpriseUnitRow,
  "block" | "enterprise_code" | "enterprise_id" | "id" | "lot" | "price" | "unit_name"
>;

/**
 * O cenário (os cinco baldes e o total) de cada empreendimento, contado unidade por unidade.
 *
 * ⚠️ A QUANTIDADE E O PREÇO SÃO DA LINHA DO C2X; A SITUAÇÃO É DO PANTEON. É a mesma divisão da aba
 * Unidades (`loadApoloEnterpriseUnits`), e é de propósito: o card "Disponível 12" e o filtro
 * "Disponível" da aba contam as MESMAS doze unidades, casadas pela MESMA ordem (`acharUnidade`).
 *
 * ⚠️ UNIDADE QUE O PANTEON NÃO CONHECE CONTA COMO OCUPADA (no balde bloqueado), e entra no total:
 * sumir com ela diminuiria o estoque, e contá-la livre ofereceria o que ninguém leu. A aba escreve
 * "Sem cadastro no Panteon" nela; o card não tem balde para isso, e ela fica no vermelho.
 *
 * `situacoes` nulo = a leitura não foi pedida (`comSituacao: false`): sai só o total, com os cinco
 * baldes zerados, e nunca um "disponível" chutado.
 *
 * Exportada (e pura) para o teste.
 */
export function cenariosPelaRegua(
  unidades: readonly UnidadeDoCard[],
  situacoes: null | SituacaoDasUnidades,
): { cenarios: Map<string, ApoloEnterpriseScenario>; semCadastro: string[] } {
  const cenarios = new Map<string, ApoloEnterpriseScenario>();
  const semCadastro: string[] = [];

  for (const unidade of unidades) {
    const id = String(unidade.enterprise_id);
    const cenario = cenarios.get(id) ?? cenarioZerado();
    const valor = toNumber(unidade.price);

    cenario.total.units += 1;
    cenario.total.value += valor;

    if (situacoes) {
      const achada = unidadeDaLinhaDoC2x(
        {
          codigo: buildUnitCode(cleanText(unidade.enterprise_code) ?? "", unidade.block, unidade.lot),
          id: unidade.id,
          nomeNoC2x: unidade.unit_name,
        },
        situacoes,
      );
      if (!achada) semCadastro.push(cleanText(unidade.unit_name) ?? String(unidade.id));
      const balde = baldeDaSituacao(achada?.situacao ?? SITUACAO_FORA_DO_PANTEON);
      cenario[balde].units += 1;
      cenario[balde].value += valor;
    }

    cenarios.set(id, cenario);
  }

  return { cenarios, semCadastro };
}

function cenarioZerado(): ApoloEnterpriseScenario {
  const zero = (): ApoloEnterpriseTally => ({ units: 0, value: 0 });
  return {
    bloqueado: zero(),
    em_cancelamento: zero(),
    disponivel: zero(),
    negociacao: zero(),
    reservado: zero(),
    total: zero(),
    vendido: zero(),
  };
}

/**
 * A lista de empreendimentos do Apolo, com o cenário de cada um.
 *
 * ⚠️ OS CARDS SAEM DA RÉGUA ÚNICA (18/09/2026). Até aqui o SELECT do C2X somava os baldes pelo
 * `sale_status_id` / `sale_blocked` do legado (`sqlDoBalde`), e o card dizia uma coisa enquanto a
 * aba Unidades, já no Panteon, dizia outra: o lote bloqueado, reservado ou em contrato no Hércules
 * contava "Disponível" no card. Agora o C2X dá só as unidades e o preço, e a situação vem de UMA
 * chamada a `lerSituacaoDasUnidades` com todos os empreendimentos juntos. Nunca uma por produto: a
 * régua lê as propostas e as reservas do banco inteiro, e N chamadas seriam N vezes essa conta.
 *
 * ⚠️ SEM A SITUAÇÃO, SEM LISTA. Falha na leitura do Panteon devolve erro (`ok: false`), como o C2X
 * fora do ar: um card com "Disponível" chutado é convite a vender lote que já tem dono.
 *
 * `comSituacao: false` pula a régua (só o total sai contado). É para quem só quer a LISTA (nome,
 * id, código) e não mostra baldes: a vitrine do credenciamento, a tradução de nome para id. Sem
 * a opção, a régua roda, e quem mostra número recebe o número certo.
 */
export async function loadApoloEnterprises(
  opcoes: { comSituacao?: boolean } = {},
): Promise<
  { data: ApoloEnterprisesData; ok: true } | { error: string; ok: false }
> {
  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return {
      error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`,
      ok: false,
    };
  }

  // ⚠️ A EXCLUSÃO É PELO ID (`EXCLUDED_ENTERPRISE_IDS`), e não mais pela sigla (PAN-124): a lista por
  // sigla deixou de excluir o 30 quando o LAG virou ADT no C2X, calada. Hoje o resultado é o mesmo:
  // `e.id not in` e `e.code not in` só divergiriam numa sigla nula, e o C2X não tem nenhuma (medido
  // em 25/09/2026).
  const semExcluidosDoC2x = filtroSemExcluidos();

  // As duas leituras do C2X correm juntas. ⚠️ `sale_status_id` e `sale_blocked` NÃO ESTÃO NO
  // SELECT de propósito: a situação é do Panteon, e coluna de status do legado à mão aqui é convite
  // a alguém voltar a decidir por ela.
  const [[empreendimentos], [unidades]] = await Promise.all([
    poolResult.pool.query<EnterpriseMetaRow[]>(
      `select
         e.id,
         e.code,
         e.name,
         ci.name as city,
         s.acronym as state,
         inc.name as incorporador
       from enterprises e
       left join cities ci on ci.id = e.city_id
       left join states s on s.id = ci.state_id
       left join users inc on inc.id = e.incorporador_id
       where ${semExcluidosDoC2x.sql}
       order by e.code`,
      semExcluidosDoC2x.params,
    ),
    poolResult.pool.query<EnterpriseUnitRow[]>(
      `select u.id, u.name as unit_name, u.block, u.lot, u.price,
              e.id as enterprise_id, e.code as enterprise_code
         from enterprise_unities u
         join enterprises e on e.id = u.enterprise_id
        where ${semExcluidosDoC2x.sql}`,
      semExcluidosDoC2x.params,
    ),
  ]);

  let situacoes: null | SituacaoDasUnidades = null;
  if (opcoes.comSituacao !== false) {
    const lida = await lerSituacaoNoPanteon([
      ...new Set(unidades.map((unidade) => String(unidade.enterprise_id))),
    ]);
    if (!lida.ok) return { error: lida.error, ok: false };
    situacoes = lida.situacoes;
  }

  const { cenarios, semCadastro } = cenariosPelaRegua(unidades, situacoes);

  // O buraco do sync fica no log, com a contagem; na tela ele é parte do vermelho.
  if (semCadastro.length > 0) {
    console.warn(
      `[apolo][empreendimentos] ${semCadastro.length} unidade(s) do C2X sem linha em hercules_unidades; contam como ocupadas nos cards até o sync.`,
      semCadastro.slice(0, 10),
    );
  }

  const mapped = empreendimentos.map((empreendimento) => {
    const cenario = cenarios.get(String(empreendimento.id)) ?? cenarioZerado();
    return mapEnterpriseRow({
      ...empreendimento,
      bloqueado_units: cenario.bloqueado.units,
      bloqueado_value: cenario.bloqueado.value,
      disponivel_units: cenario.disponivel.units,
      disponivel_value: cenario.disponivel.value,
      negociacao_units: cenario.negociacao.units,
      negociacao_value: cenario.negociacao.value,
      reservado_units: cenario.reservado.units,
      reservado_value: cenario.reservado.value,
      total_units: cenario.total.units,
      total_value: cenario.total.value,
      vendido_units: cenario.vendido.units,
      vendido_value: cenario.vendido.value,
    } as EnterpriseQueryRow);
  });

  return { data: buildApoloEnterprisesData(mapped), ok: true };
}

/**
 * Monta o payload da tela a partir das linhas cruas do C2X: agrupa as etapas do mesmo produto e
 * soma o total geral.
 *
 * ⚠️ O ESPELHO ENTRA EM `rows` E FICA FORA DE `totals`. São as duas metades da mesma regra: a
 * linha do VLO precisa existir (é o caminho para o masterplan do Vale do Ouro e para as 663 CADs
 * da esteira, todas gravadas no enterprise_id 35), e as 298 unidades dele são as MESMAS de
 * VOC + VOL — contá-las de novo inflava o total em 298 un / R$ 27.768.889,00.
 *
 * Exportada (e pura) de propósito: é aqui que a regra é testável sem banco.
 */
export function buildApoloEnterprisesData(
  rows: ApoloEnterpriseRow[],
): ApoloEnterprisesData {
  return {
    rows: groupEnterpriseRows(rows),
    totals: sumScenarios(rows.filter((row) => !row.mirror)),
  };
}

// Player ligado ao empreendimento no C2X. É a semente das arestas do grafo.
//
// PAPÉIS ACUMULÁVEIS (regra do Lucas): o `profile` declarado no C2X (Imobiliária, Corretor,
// Incorporador...) é UM papel; a FUNÇÃO no empreendimento é outro — e eles se somam na mesma
// entidade. Ex.: Luna Negócios é `Imobiliária` (perfil) E `Coordenador de Vendas` (função).
//
// Tradução de nome: no Apolo o `manager_id` do C2X chama-se COORDENADOR DE VENDAS (no C2X o
// campo continua "gerente"). Nome de PJ mora em fantasy_name/social_name — daí o coalesce.
// ⚠️ OS RÓTULOS DO C2X ESTÃO ERRADOS — não confiar neles (regra do Lucas):
//   incorporador_id -> Incorporador            (C2X: "Incorporador")     ✔ exibe
//   manager_id      -> COORDENADOR DE VENDAS   (C2X: "Gerente")          ✔ exibe
//   captivator_id   -> Captador                (C2X: "Captador")         ✔ exibe
//   coordenador_id  -> (dado errado no C2X: vem o MESMO player nos 24 empreendimentos)
//                      NÃO exibe; fica no dado pro Lucas corrigir no C2X quando houver escrita.
export type ApoloEnterprisePlayerRelation =
  | "captador"
  | "coordenador_c2x"
  | "coordenador_vendas"
  | "incorporador";

export type ApoloEnterprisePlayer = {
  address: string | null;
  document: string | null;
  email: string | null;
  // Id da entidade no Apolo, derivado do id do user no C2X. É por ele que a tela abre a ficha
  // CERTA no CRM (buscar por nome casa homônimos e abre a pessoa errada).
  entityId: string;
  name: string;
  phone: string | null;
  // Função DESTE player no empreendimento (a aresta). Na tela do empreendimento só ESTE papel
  // aparece; os demais papéis da entidade vivem na ficha dela, no CRM.
  relation: ApoloEnterprisePlayerRelation;
};

export const enterprisePlayerLabels: Record<
  ApoloEnterprisePlayerRelation,
  string
> = {
  captador: "Captador",
  coordenador_c2x: "Coordenador (C2X)",
  coordenador_vendas: "Coordenador de Vendas",
  incorporador: "Incorporador",
};

// Não exibido na tela (dado errado no C2X; fica só no payload pra correção futura).
export const HIDDEN_ENTERPRISE_PLAYER_RELATIONS: ApoloEnterprisePlayerRelation[] =
  ["coordenador_c2x"];

export type ApoloEnterpriseCadastro = {
  actValue: number | null;
  city: string | null;
  code: string;
  createdAt: string | null;
  divulgationName: string | null;
  expectedDelivery: string | null;
  focalEmail: string | null;
  focalName: string | null;
  focalPhone: string | null;
  kind: string | null;
  name: string;
  players: ApoloEnterprisePlayer[];
  state: string | null;
  // Tipo de financiamento/tabela (PRICE | SACOOC).
  tableKind: string | null;
};

type PlayerColumns<Alias extends string> = {
  [K in
    | Alias
    | `${Alias}_address`
    | `${Alias}_document`
    | `${Alias}_email`
    | `${Alias}_phone`]: string | null;
} & {
  [K in `${Alias}_user_id`]: number | string | null;
};

type CadastroQueryRow = RowDataPacket &
  PlayerColumns<"captador"> &
  PlayerColumns<"coordenador"> &
  PlayerColumns<"gerente"> &
  PlayerColumns<"incorporador"> & {
    act_value: string | number | null;
    city: string | null;
    code: string | null;
    created_at: Date | string | null;
    divulgation_name: string | null;
    /** `enterprises.id`: a chave que não muda quando alguém renomeia o empreendimento no C2X. */
    enterprise_id: number | string;
    expected_delivery_date: Date | string | null;
    focal_email: string | null;
    focal_name: string | null;
    focal_phone: string | null;
    kind: string | null;
    name: string | null;
    state: string | null;
    table_kind: string | null;
  };

// Nome do player: PJ guarda em fantasy_name/social_name; PF em name.
const PLAYER_NAME_SQL = `coalesce(nullif(trim(pu.name), ''), nullif(trim(pu.fantasy_name), ''), nullif(trim(pu.social_name), ''))`;
const PLAYER_DOC_SQL = `coalesce(nullif(trim(pu.cpf), ''), nullif(trim(pu.cnpj), ''))`;

// ⚠️ O telefone NÃO mora em `users.phone/cellphone` (quase vazios: 93 de 4.128 users). A fonte
// é a tabela polimórfica `phones` (ownertable_type='User'), preferindo o WhatsApp — a mesma
// leitura que o sync do Apolo faz. Ler de `users` deixava quase todo player sem telefone.
const playerPhoneSql = (column: string) => `(
    select nullif(trim(ph.phone), '')
      from phones ph
     where ph.ownertable_type = 'User'
       and ph.ownertable_id = e.${column}
       and trim(coalesce(ph.phone, '')) <> ''
     order by ph.is_whatsapp desc, ph.updated_at desc, ph.id desc
     limit 1
  )`;

// Enriquecimento vindo de `users` (+ `addresses`): telefone, e-mail, documento e endereço.
function playerSelect(column: string, alias: string): string {
  return `e.${column} as ${alias}_user_id,
          (select ${PLAYER_NAME_SQL} from users pu where pu.id = e.${column}) as ${alias},
          ${playerPhoneSql(column)} as ${alias}_phone,
          (select nullif(trim(pu.email), '') from users pu where pu.id = e.${column}) as ${alias}_email,
          (select ${PLAYER_DOC_SQL} from users pu where pu.id = e.${column}) as ${alias}_document,
          (select concat_ws(', ',
                    nullif(trim(pa.address), ''),
                    nullif(trim(pa.number), ''),
                    nullif(trim(pa.district), ''),
                    nullif(trim(pac.name), ''),
                    nullif(trim(pas.acronym), ''))
             from addresses pa
             left join cities pac on pac.id = pa.city_id
             left join states pas on pas.id = pa.state_id
            where pa.ownertable_type = 'User' and pa.ownertable_id = e.${column}
            limit 1) as ${alias}_address`;
}

/** Configuração do C2X ausente: o mesmo `ok: false` de sempre, na mesma frase. */
function erroDeConfiguracaoDoC2x(missing: string[]): { error: string; ok: false } {
  return { error: `Configuracao C2X ausente: ${missing.join(", ")}.`, ok: false };
}

// O SELECT do cadastro, com o filtro de quem chama. Um texto só para as duas buscas (por sigla e
// por id): duas cópias do mesmo SELECT divergiriam no dia em que um player novo entrasse numa delas.
function sqlDoCadastro(filtro: string): string {
  return `select e.id as enterprise_id, e.code, e.name, e.divulgation_name,
            et.name as kind,
            etab.name as table_kind,
            ci.name as city, st.acronym as state,
            e.expected_delivery_date, e.act_value, e.created_at,
            e.focal_name, e.focal_phone, e.focal_email,
            ${playerSelect("incorporador_id", "incorporador")},
            ${playerSelect("manager_id", "gerente")},
            ${playerSelect("captivator_id", "captador")},
            ${playerSelect("coordenador_id", "coordenador")}
     from enterprises e
     left join enterprise_types et on et.id = e.enterprise_type_id
     left join enterprise_tables etab on etab.id = e.enterprise_table_id
     left join cities ci on ci.id = e.city_id
     left join states st on st.id = ci.state_id
     where ${filtro}
     order by e.code`;
}

// Cadastro do empreendimento (uma ficha por CÓDIGO — o produto consolidado tem N).
//
// ⚠️ RECEBE SIGLA, MAS PERGUNTA AO C2X PELO ID (PAN-124). A aba Cadastro do Apolo e a do portal
// mandam a sigla; até aqui ela ia crua para o `e.code in (...)`, e a sigla muda num renome no legado
// (o 43 de RDV para PDI em 24/09/2026 fez a busca por RDV voltar com zero fichas, sem erro). Agora a
// sigla é traduzida num lugar só (`idsDoC2xDasSiglasAoVivo`) e a busca é a
// `loadApoloEnterpriseCadastroPorId`, o mesmo SELECT com o mesmo `order by e.code`.
//
// ⚠️ A SIGLA GUARDADA DE ANTES DE UM RENOME (a tela aberta antes dele) só é salva enquanto o catálogo
// em cache for de antes do renome (até 10 minutos); depois volta sem ficha, como `e.code in` voltava.
// Só a busca pelo id atravessa. A tela do Apolo passa `conferirNoC2x` (ver `OrigemDaSigla`).
//
// ⚠️ A EXCLUSÃO (TSC, SDT, LAB) CONTINUA, NA TRADUÇÃO: ela tira `EXCLUDED_ENTERPRISE_IDS` por padrão,
// e a busca por id não exclui por conta própria. O resultado é o do filtro por sigla que morava aqui.
//
// ⚠️ O NOME E A ASSINATURA FICAM: as rotas e os testes de outras telas chamam (e trocam) esta função.
export async function loadApoloEnterpriseCadastro(
  codes: string[],
  origem: OrigemDaSigla = {},
): Promise<
  | { cadastros: ApoloEnterpriseCadastro[]; ok: true }
  | { error: string; ok: false }
> {
  const siglas = codes.map((code) => code.trim().toUpperCase()).filter(Boolean);

  if (!siglas.length) {
    return { cadastros: [], ok: true };
  }

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) return erroDeConfiguracaoDoC2x(poolResult.missing);

  const traduzido = await idsDoC2xDasSiglasAoVivo(siglas, origem);
  if (!traduzido.ok) {
    return { error: traduzido.erro, ok: false };
  }

  const lido = await loadApoloEnterpriseCadastroPorId(traduzido.ids.map(String));
  if (!lido.ok) return lido;

  // ⚠️ SEM O `enterpriseId`: a resposta desta função vai crua para a tela (`{ cadastros }`), e o campo
  // a mais mudaria o JSON de quem nunca pediu por id.
  return {
    cadastros: lido.cadastros.map(({ enterpriseId: _enterpriseId, ...cadastro }) => cadastro),
    ok: true,
  };
}

/** A ficha do C2X com o id de onde ela saiu: quem pediu por id precisa casar a resposta pelo id. */
export type ApoloEnterpriseCadastroPorId = ApoloEnterpriseCadastro & { enterpriseId: string };

/**
 * O cadastro do empreendimento no C2X pelo ID (`enterprises.id`), e não pela sigla.
 *
 * ⚠️ POR QUE EXISTE (Lucas, 24/09/2026: *"Tivemos que mudar de nome"*). A Nivea renomeou o 43 no C2X
 * de RECANTO DO VALE/RDV para PORTAL DO IBITURUNA/PDI. O id ficou; a sigla mudou. A busca por sigla
 * com o RDV que o Panteon guardava voltou VAZIA (medido: 0 cadastros com RDV, a LUNA com PDI), e a
 * coordenação não soube da CONECTTA IMOVEIS habilitada 7 minutos depois. O mesmo já tinha acontecido
 * com o 30 (LAG, ADT, ACT). O id do C2X é a chave que o Panteon inteiro já guarda
 * (`hercules_empreendimentos.c2x_enterprise_id`, `apolo_enterprise_settings.enterprise_id`).
 *
 * ⚠️ NÃO EXCLUI NADA POR CONTA PRÓPRIA, e é de propósito: quem pede um id pediu aquele empreendimento.
 * A exclusão (`EXCLUDED_ENTERPRISE_IDS`) mora na tradução, que a aplica por padrão; é por ela que
 * `loadApoloEnterpriseCadastro` (a busca pelas siglas) continua sem TSC, SDT e LAB. Id que não é número
 * (`group:...`, uuid) não é id do C2X e fica de fora; o grupo se resolve ANTES, pelas divisões do
 * cadastro do Panteon (lib/apolo/coordenador-do-empreendimento.ts).
 */
export async function loadApoloEnterpriseCadastroPorId(
  enterpriseIds: readonly string[],
): Promise<
  | { cadastros: ApoloEnterpriseCadastroPorId[]; ok: true }
  | { error: string; ok: false }
> {
  const ids = [
    ...new Set(
      enterpriseIds.map((id) => String(id ?? "").trim()).filter((id) => /^\d+$/.test(id)),
    ),
  ];

  if (!ids.length) {
    return { cadastros: [], ok: true };
  }

  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    return {
      error: `Configuracao C2X ausente: ${poolResult.missing.join(", ")}.`,
      ok: false,
    };
  }

  const placeholders = ids.map(() => "?").join(", ");
  const [rows] = await poolResult.pool.query<CadastroQueryRow[]>(
    sqlDoCadastro(`e.id in (${placeholders})`),
    ids.map(Number),
  );

  return {
    cadastros: rows.map((row) => ({
      ...mapCadastroRow(row),
      enterpriseId: String(row.enterprise_id),
    })),
    ok: true,
  };
}

function mapCadastroRow(row: CadastroQueryRow): ApoloEnterpriseCadastro {
  const player = (
    relation: ApoloEnterprisePlayerRelation,
    name: string | null,
    userId: number | string | null,
    phone: string | null,
    email: string | null,
    document: string | null,
    address: string | null,
  ): ApoloEnterprisePlayer | null => {
    const cleaned = cleanText(name);

    if (!cleaned || !userId) {
      return null;
    }

    return {
      address: cleanText(address),
      document: cleanText(document),
      email: cleanText(email),
      // Mesma semente do sync (persistApoloEntityBatch) — aponta pra ficha certa no CRM.
      entityId: deterministicUuid(`apolo:c2x:users:${userId}`),
      name: cleaned,
      phone: cleanText(phone),
      relation,
    };
  };

  const players = [
    player(
      "incorporador",
      row.incorporador,
      row.incorporador_user_id,
      row.incorporador_phone,
      row.incorporador_email,
      row.incorporador_document,
      row.incorporador_address,
    ),
    // C2X chama de "Gerente", mas na Careli é o COORDENADOR DE VENDAS.
    player(
      "coordenador_vendas",
      row.gerente,
      row.gerente_user_id,
      row.gerente_phone,
      row.gerente_email,
      row.gerente_document,
      row.gerente_address,
    ),
    player(
      "captador",
      row.captador,
      row.captador_user_id,
      row.captador_phone,
      row.captador_email,
      row.captador_document,
      row.captador_address,
    ),
    // Dado errado no C2X (mesmo player nos 24) — vai no payload, mas a tela filtra.
    player(
      "coordenador_c2x",
      row.coordenador,
      row.coordenador_user_id,
      row.coordenador_phone,
      row.coordenador_email,
      row.coordenador_document,
      row.coordenador_address,
    ),
  ].filter((entry): entry is ApoloEnterprisePlayer => Boolean(entry));

  return {
    actValue: row.act_value === null ? null : toNumber(row.act_value),
    city: cleanText(row.city),
    code: cleanText(row.code) ?? "",
    createdAt: toIsoDate(row.created_at),
    divulgationName: cleanText(row.divulgation_name),
    expectedDelivery: toIsoDate(row.expected_delivery_date),
    focalEmail: cleanText(row.focal_email),
    focalName: cleanText(row.focal_name),
    focalPhone: cleanText(row.focal_phone),
    kind: cleanText(row.kind),
    name: cleanText(row.name) ?? "Empreendimento",
    players,
    state: cleanText(row.state),
    tableKind: cleanText(row.table_kind),
  };
}

function toIsoDate(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Parte envolvida na movimentação da unidade (comprador ou imobiliária). O `entityId` permite
// abrir a ficha CERTA no CRM.
//
// ⚠️ `entityId` pode ser NULO, e isso é informação, não descuido: quem reservou no tótem do
// lançamento é um credenciado do Prometeu, e não há ficha do Apolo garantida para ele. Inventar
// um id levaria o operador a um CRM vazio — pior que mostrar o nome sem link. A tela renderiza
// texto simples quando não há para onde ir.
export type ApoloUnitParty = {
  code: string | null;
  entityId: null | string;
  name: string;
};

// A ÚLTIMA MOVIMENTAÇÃO da unidade (a proposta/venda mais recente). É o que amarra o
// comprador e a imobiliária àquela unidade. O vínculo comprador→imobiliária vem de
// `users.vinculed_by_id` — `imobiliaria_id` está ZERADO no C2X (0 de 3.595 clientes).
export type ApoloUnitMovement = {
  client: ApoloUnitParty | null;
  imobiliaria: ApoloUnitParty | null;
  stage: string | null;
};

export type ApoloEnterpriseUnit = {
  area: number | null;
  block: string | null;
  /**
   * O bloqueio feito NO PANTEON (com autor e motivo). `null` = não há bloqueio nativo (a unidade
   * não está bloqueada, ou o bloqueio veio do C2X); AUSENTE = não foi lido. Só a rota interna do
   * Apolo preenche: o nome de quem bloqueou não viaja para o portal do cliente.
   */
  bloqueio?: null | { em: string; motivo: null | string; porNome: null | string };
  bucket: ApoloEnterpriseBucket;
  // Código da unidade (ex.: LOU0101 = sigla + quadra + lote), mesmo padrão do Hades.
  code: string;
  enterpriseCode: string;
  id: string;
  // Unidade interna / externa.
  kind: string | null;
  lot: string | null;
  movement: ApoloUnitMovement | null;
  /**
   * A linha VIVA do Panteon (`hercules_unidades.id`) que responde por esta unidade, casada pela
   * régua (`acharUnidade`). É por ela que o Apolo bloqueia e desbloqueia. Nula quando o Panteon não
   * a conhece. Opcional no tipo porque há quem monte a unidade à mão (a ficha do portal, os testes).
   */
  panteonId?: null | string;
  price: number;
  // Matrícula do registro.
  registration: string | null;
  /**
   * O Panteon não tem esta unidade (o sync ainda não a trouxe). Ela sai OCUPADA (no balde
   * bloqueado, nunca livre), com o texto "Sem cadastro no Panteon" em vez de "Bloqueado": ninguém a
   * bloqueou, e dizer que sim mandaria alguém procurar um bloqueio que não existe.
   */
  semCadastroNoPanteon?: boolean;
  status: string;
};

type UnitQueryRow = RowDataPacket & {
  area: string | number | null;
  block: string | null;
  client_code: string | null;
  client_id: number | null;
  client_name: string | null;
  enterprise_code: string | null;
  /** `enterprises.id` do C2X: é o `enterprise_id` que `hercules_unidades` guarda ("35", "37"...). */
  enterprise_id: number | string;
  id: number;
  imobiliaria_code: string | null;
  imobiliaria_id: number | null;
  imobiliaria_name: string | null;
  kind: string | null;
  lot: string | null;
  price: string | number | null;
  registration: string | null;
  stage: string | null;
  /**
   * `enterprise_unities.name` ("LOU0101"). É o `codigo` que a carga gravou em `hercules_unidades`
   * (scripts/hercules/carregar-unidades-do-c2x.mjs), e por isso é a segunda chave para achar a
   * unidade no Panteon quando o id do legado não casa.
   */
  unit_name: string | null;
};

// Unidades de um empreendimento (ou do produto consolidado: aceita N códigos).
//
// ⚠️ A SITUAÇÃO NÃO VEM MAIS DO C2X (18/09/2026). Lucas: *"esses status tem que morar em um so
// lugar"* · *"no c2x não precisa olhar"* · *"se eu precisar atualizar eu faço um sync"*. Esta aba
// lia `sale_status_id` / `sale_blocked` do legado e não via nada feito no Panteon: medido em
// 18/09/2026, 93 lotes do LBP bloqueados aqui apareciam "Disponível", e 5 em contrato e 6 em
// assinatura também. Agora a situação sai de lib/hercules/situacao-da-unidade.ts, a MESMA régua
// da tela Venda, e o C2X continua dando só o resto da linha: quadra, lote, área, preço, matrícula,
// tipo e a última movimentação (comprador e imobiliária).
//
// ⚠️ SEM A SITUAÇÃO DO PANTEON, SEM LISTA. Se a leitura falhar, a função devolve erro e a tela
// mostra a caixa vermelha. Cair no C2X seria voltar a pintar de livre o que o Panteon travou, e
// uma lista "toda disponível" por falha de leitura é convite a vender lote que já tem dono.
//
// ⚠️ RECEBE SIGLA, MAS PERGUNTA AO C2X PELO ID (PAN-124). A tela manda `?codes=` (e o portal, as siglas
// do catálogo); a sigla vira `enterprises.id` (`idsDoC2xDasSiglasAoVivo`), com a exclusão de sempre
// (TSC, SDT, LAB) aplicada ali, pelo id. O SQL mora em `loadApoloEnterpriseUnitsPorIds`. Catálogo
// ilegível é o C2X fora: `ok: false`, que a rota já responde com 503, e não uma aba vazia com cara de
// verdade. ⚠️ A sigla guardada de antes de um renome só é salva enquanto o catálogo em cache for de
// antes dele (até 10 minutos); a tela do Apolo passa `conferirNoC2x` (ver `OrigemDaSigla`).
export async function loadApoloEnterpriseUnits(
  codes: string[],
  origem: OrigemDaSigla = {},
): Promise<
  { ok: true; units: ApoloEnterpriseUnit[] } | { error: string; ok: false }
> {
  const siglas = codes.map((code) => code.trim().toUpperCase()).filter(Boolean);

  if (!siglas.length) {
    return { ok: true, units: [] };
  }

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) return erroDeConfiguracaoDoC2x(poolResult.missing);

  const traduzido = await idsDoC2xDasSiglasAoVivo(siglas, origem);
  if (!traduzido.ok) {
    return { error: traduzido.erro, ok: false };
  }

  return loadApoloEnterpriseUnitsPorIds(traduzido.ids);
}

/**
 * As unidades pelos ids do C2X (`enterprises.id`), que não mudam num renome.
 *
 * ⚠️ OS EXCLUÍDOS NUNCA ENTRAM, como na busca pela sigla: quem pedir o 34 (TSC) recebe a aba vazia, e
 * não as unidades do teste. Só aceita id do C2X: o nascido no Panteon (>= 100000), `group:` e uuid
 * ficam de fora (`idDoC2x`). Sem id nenhum, não vai ao C2X.
 *
 * ⚠️ SÓ O WHERE MUDOU: o SELECT e o `order by e.code, u.block, u.lot` são os da busca pela sigla, e a
 * lista sai idêntica para quem não foi renomeado (medido linha a linha em 25/09/2026).
 */
export async function loadApoloEnterpriseUnitsPorIds(
  idsPedidos: ReadonlyArray<number | string>,
): Promise<
  { ok: true; units: ApoloEnterpriseUnit[] } | { error: string; ok: false }
> {
  const filtro = filtroPorIds(
    "e.id",
    semExcluidos(idsPedidos.map(idDoC2x).filter((id): id is number => id !== null)),
  );

  if (!filtro) {
    return { ok: true, units: [] };
  }

  const poolResult = getHadesDbPool();
  if (!poolResult.ok) return erroDeConfiguracaoDoC2x(poolResult.missing);

  const nameSql = (alias: string) =>
    `coalesce(nullif(trim(${alias}.name), ''), nullif(trim(${alias}.fantasy_name), ''), nullif(trim(${alias}.social_name), ''))`;

  // A "última movimentação" = a proposta/venda MAIS RECENTE daquela unidade. Dela saem o
  // comprador (ar.client_id) e a imobiliária (users.vinculed_by_id do comprador).
  //
  // ⚠️ `sale_status_id`, `sale_blocked` e `sale_statuses.name` SAÍRAM DO SELECT de propósito: a
  // situação é do Panteon, e coluna de status do legado à mão aqui é convite a alguém voltar a
  // decidir por ela.
  const [rows] = await poolResult.pool.query<UnitQueryRow[]>(
    `select u.id, u.name as unit_name, u.block, u.lot, u.area, u.price,
            u.registration,
            ut.name as kind,
            e.id as enterprise_id,
            e.code as enterprise_code,
            st.name as stage,
            cli.id as client_id, cli.user_code as client_code,
            ${nameSql("cli")} as client_name,
            imo.id as imobiliaria_id, imo.user_code as imobiliaria_code,
            ${nameSql("imo")} as imobiliaria_name
       from enterprise_unities u
       join enterprises e on e.id = u.enterprise_id
       left join enterprise_unity_types ut on ut.id = u.enterprise_unity_type_id
       left join acquisition_requests ar on ar.id = (
              select ar2.id from acquisition_requests ar2
               where ar2.enterprise_unity_id = u.id
               order by ar2.created_at desc, ar2.id desc
               limit 1)
       left join acquisition_request_stages st on st.id = ar.acquisition_request_stage_id
       left join users cli on cli.id = ar.client_id
       left join users imo on imo.id = cli.vinculed_by_id
      where ${filtro.sql}
      order by e.code, u.block, u.lot`,
    filtro.params,
  );

  // `enterprise_id` do C2X de cada linha: é a chave que `hercules_unidades` guarda. As duas
  // leituras do Panteon correm juntas; nenhuma depende da outra.
  const enterpriseIds = [...new Set(rows.map((row) => String(row.enterprise_id)))];
  const [situacoes, reservas] = await Promise.all([
    lerSituacaoNoPanteon(enterpriseIds),
    reservasVivasDoPanteon(),
  ]);

  if (!situacoes.ok) {
    return { error: situacoes.error, ok: false };
  }

  const foraDoPanteon: string[] = [];
  const units = rows.map((row) => {
    const unidade = unidadeDaLinhaDoC2x(chavesDaLinha(row), situacoes.situacoes);
    if (!unidade) foraDoPanteon.push(cleanText(row.unit_name) ?? String(row.id));
    return mapUnitRow(row, unidade, reservas);
  });

  // Unidade do C2X que o Panteon não conhece sai "Sem cadastro no Panteon", ocupada (ver
  // `situacaoDaUnidadeNaAba`). O aviso vai também para o log, com a contagem, para o buraco do sync
  // não depender de alguém abrir a aba certa.
  if (foraDoPanteon.length > 0) {
    console.warn(
      `[apolo][empreendimentos] ${foraDoPanteon.length} unidade(s) do C2X sem linha em hercules_unidades; aparecem "Sem cadastro no Panteon", ocupadas, até o sync.`,
      foraDoPanteon.slice(0, 10),
    );
  }

  return { ok: true, units };
}

const ERRO_DA_SITUACAO =
  "Não foi possível ler a situação das unidades no Panteon agora. Tente de novo em instantes.";

/**
 * A situação pela régua única, para as leituras do Apolo que partem do C2X (os cards, a aba
 * Unidades, a lista de Vendas).
 *
 * ⚠️ FALHA VIRA ERRO, nunca mapa vazio: mapa vazio faria toda unidade cair no "desconhecido" e a
 * lista inteira sairia ocupada, uma mentira no sentido oposto (menos cara que pintar de livre, mas
 * ainda mentira). A frase é para a tela; o detalhe técnico vai para o log.
 */
export async function lerSituacaoNoPanteon(
  enterpriseIds: string[],
): Promise<
  { error: string; ok: false } | { ok: true; situacoes: SituacaoDasUnidades }
> {
  const client = createApoloAdminClient();

  if (!client) {
    console.error(
      "[apolo][empreendimentos] Supabase ausente: sem a situação das unidades do Panteon.",
    );
    return { error: ERRO_DA_SITUACAO, ok: false };
  }

  try {
    return {
      ok: true,
      situacoes: await lerSituacaoDasUnidades(client, enterpriseIds),
    };
  } catch (erro) {
    console.error(
      "[apolo][empreendimentos] falha ao ler a situação das unidades no Panteon",
      erro,
    );
    return { error: ERRO_DA_SITUACAO, ok: false };
  }
}

/**
 * A SITUAÇÃO DE UMA UNIDADE QUE O PANTEON NÃO CONHECE: a própria régua responde, com cadastro
 * desconhecido e sem processo nenhum. Hoje isso é "bloqueada", e fica calculado (e não escrito à
 * mão) para que, se a régua mudar de ideia sobre o desconhecido, esta tela mude junto.
 *
 * ⚠️ NÃO É O C2X QUE RESPONDE AQUI, e é de propósito. Unidade do legado sem linha em
 * `hercules_unidades` é unidade que o sync ainda não trouxe (decisão do Lucas: *"se eu precisar
 * atualizar eu faço um sync"*). Mostrá-la livre porque o C2X diz "Disponível" é justamente o que
 * esta mudança existe para acabar.
 */
const SITUACAO_FORA_DO_PANTEON: SituacaoDaUnidade = situacaoDoTerreno({
  cadastro: null,
  propostasVivas: [],
  reservada: false,
});

/**
 * O texto da unidade que o Panteon não conhece. NÃO é "Bloqueado": ninguém a bloqueou, e o texto
 * errado mandaria alguém procurar (ou tentar desfazer) um bloqueio que não existe. A cor e o balde
 * continuam os de ocupado.
 */
export const ROTULO_SEM_CADASTRO_NO_PANTEON = "Sem cadastro no Panteon";

export type ChavesDaLinhaDoC2x = {
  /** O código que esta tela monta (sigla + quadra + lote). */
  codigo: string;
  /** `enterprise_unities.id`. */
  id: number | string;
  /** `enterprise_unities.name`. */
  nomeNoC2x: null | string;
};

function chavesDaLinha(row: UnitQueryRow): ChavesDaLinhaDoC2x {
  return {
    codigo: buildUnitCode(cleanText(row.enterprise_code) ?? "", row.block, row.lot),
    id: row.id,
    nomeNoC2x: row.unit_name,
  };
}

/**
 * Qual unidade do Panteon responde por esta linha do C2X.
 *
 * ⚠️ PELA ORDEM ÚNICA DE `acharUnidade` (linha do Panteon, id do legado, código), a mesma do
 * masterplan, do espelho e da Venda. Na primeira passada esta função tinha a ordem dela, e duas
 * telas com ordens diferentes acham linhas diferentes para o mesmo lote quando o nome no C2X
 * destoa do código da carga. A linha do C2X não tem id do Panteon, então as chaves são:
 *   1. o id do legado (`enterprise_unities.id` = `hercules_unidades.origem_c2x_id`), que é exato;
 *   2. o `name` do legado, que é o `codigo` que a carga gravou;
 *   3. só se nenhuma das duas casar, o código que a tela monta (sigla + quadra + lote), para a
 *      unidade cujo `name` no C2X destoa do padrão. É a mesma função com a chave seguinte, e não
 *      uma ordem nova.
 * `porOrigemC2x` e `porCodigo` respondem por QUALQUER linha do terreno, então pedir o VOC0305 ou o
 * VLO0305 (a linha antiga do pai) dá a mesma unidade viva.
 *
 * Exportada para a lista de Vendas (lib/apolo/vendas.ts), que casa as mesmas linhas do C2X.
 */
export function unidadeDaLinhaDoC2x(
  linha: ChavesDaLinhaDoC2x,
  situacoes: SituacaoDasUnidades,
): UnidadeComSituacao | undefined {
  return (
    acharUnidade(situacoes, { codigo: linha.nomeNoC2x, origemC2x: linha.id }) ??
    acharUnidade(situacoes, { codigo: linha.codigo })
  );
}

/**
 * A situação de uma linha do C2X pela régua única; a que o Panteon não conhece sai como
 * SITUACAO_FORA_DO_PANTEON, nunca como livre. Exportada (e pura) para o teste.
 */
export function situacaoDaLinhaDoC2x(
  linha: ChavesDaLinhaDoC2x,
  situacoes: SituacaoDasUnidades,
): SituacaoDaUnidade {
  return unidadeDaLinhaDoC2x(linha, situacoes)?.situacao ?? SITUACAO_FORA_DO_PANTEON;
}

/**
 * O mesmo, para a linha que já é do Panteon (o produto nascido aqui): pelo id da linha, que
 * `porLinha` responde para a viva e para a antiga do mesmo terreno.
 */
export function situacaoDaLinhaDoPanteon(
  id: string,
  situacoes: SituacaoDasUnidades,
): SituacaoDaUnidade {
  return acharUnidade(situacoes, { linhaId: id })?.situacao ?? SITUACAO_FORA_DO_PANTEON;
}

/**
 * Como a aba Unidades escreve uma situação: o BALDE (a cor do selo, o filtro e o masterplan do
 * Apolo) e o TEXTO do selo.
 *
 * ⚠️ OS DOIS SAEM DA MESMA SITUAÇÃO, e é isso que importa. Quando a cor vinha de uma fonte e o texto
 * de outra, o selo saiu âmbar escrito "Disponível" (o RVPA09, 28/08/2026). O texto usa
 * `rotuloDaSituacao` porque ele distingue Proposta, Contrato, Assinatura e Faturado dentro do balde:
 * a cor diz "em negociação", a palavra diz em que pé está.
 *
 * ⚠️ CINCO BALDES, os de `baldeDaSituacao`: proposta, contrato e assinatura são NEGOCIAÇÃO (e o
 * filtro "Em negociação" da aba passa a achá-las); faturado e vendida, VENDIDO. Na primeira passada
 * a aba juntava a negociação em "Vendido" e o card do Hércules não: o mesmo lote com dois nomes.
 *
 * Exportada para a rota da aba (o ramo do produto nascido no Panteon usa a mesma escrita).
 */
export function situacaoNaAbaUnidades(
  situacao: SituacaoDaUnidade,
): Pick<ApoloEnterpriseUnit, "bucket" | "status"> {
  return { bucket: baldeDaSituacao(situacao), status: rotuloDaSituacao(situacao) };
}

/**
 * A unidade achada pela régua, escrita na aba: balde, texto e a linha do Panteon (para o bloqueio).
 *
 * ⚠️ NÃO ACHADA = SEM CADASTRO NO PANTEON: ocupada (o balde de SITUACAO_FORA_DO_PANTEON, nunca o
 * disponível), com o texto próprio e sem linha para bloquear.
 */
export function situacaoDaUnidadeNaAba(
  unidade: undefined | UnidadeComSituacao,
): Pick<ApoloEnterpriseUnit, "bucket" | "panteonId" | "semCadastroNoPanteon" | "status"> {
  if (!unidade) {
    return {
      bucket: baldeDaSituacao(SITUACAO_FORA_DO_PANTEON),
      panteonId: null,
      semCadastroNoPanteon: true,
      status: ROTULO_SEM_CADASTRO_NO_PANTEON,
    };
  }
  return { ...situacaoNaAbaUnidades(unidade.situacao), panteonId: unidade.id, semCadastroNoPanteon: false };
}

// As reservas vivas do salão, SÓ para a linha de "Última movimentação" (quem reservou). A
// situação da unidade já não passa por aqui: ela vem de `lerSituacaoDasUnidades`, que conta a
// reserva do evento junto com a do Hércules.
//
// Tolera ausência: se o Supabase não estiver configurado (ou falhar), a linha de movimentação
// volta a mostrar a última proposta do C2X. Perder um NOME é aceitável; a situação, não, e por isso
// ela tem leitura própria, que falha com erro.
async function reservasVivasDoPanteon(): Promise<
  ReadonlyMap<string, ReservaViva>
> {
  try {
    const client = createPrometeuClient();
    if (!client) return new Map<string, ReservaViva>();
    return await reservasVivasPorCodigo(client);
  } catch {
    return new Map<string, ReservaViva>();
  }
}

// Código da unidade: sigla(3) + quadra + lote (ex.: LOU + 01 + 01 = LOU0101). Mesmo padrão do
// Hades, pra a unidade ter o MESMO código nos dois módulos.
function buildUnitCode(
  enterpriseCode: string,
  block: string | null,
  lot: string | null,
): string {
  const prefix = enterpriseCode
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(0, 3)
    .padEnd(3, "X");
  const blockCode = (block ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  const lotCode = (lot ?? "")
    .replace(/[^a-z0-9]/gi, "")
    .replace(/^L/i, "")
    .toUpperCase();

  return `${prefix}${blockCode}${lotCode}`;
}

function mapUnitRow(
  row: UnitQueryRow,
  // ⚠️ A SITUAÇÃO CHEGA PRONTA, da régua única (lib/hercules/situacao-da-unidade.ts), na unidade do
  // Panteon que responde por esta linha. Esta função não decide nada sobre livre, reservado ou
  // vendido: só escreve o que a régua disse. `undefined` = sem cadastro no Panteon (ocupada).
  unidade: undefined | UnidadeComSituacao,
  reservasDoSalao?: ReadonlyMap<string, ReservaViva>,
): ApoloEnterpriseUnit {
  const codigoDaUnidade = buildUnitCode(
    cleanText(row.enterprise_code) ?? "",
    row.block,
    row.lot,
  );
  // A reserva do salão aqui só serve para o NOME de quem reservou (a linha de movimentação). Se
  // ela está viva, a régua já contou: a situação sai "reservado" (ou adiante, se houver proposta).
  const reservaDoSalao = reservasDoSalao?.get(codigoDaUnidade) ?? null;
  const { bucket, panteonId, semCadastroNoPanteon, status } = situacaoDaUnidadeNaAba(unidade);

  const party = (
    id: number | null,
    code: string | null,
    name: string | null,
  ): ApoloUnitParty | null => {
    const cleaned = cleanText(name);

    return id && cleaned
      ? {
          code: cleanText(code),
          entityId: deterministicUuid(`apolo:c2x:users:${id}`),
          name: cleaned,
        }
      : null;
  };

  const client = party(row.client_id, row.client_code, row.client_name);
  const imobiliaria = party(
    row.imobiliaria_id,
    row.imobiliaria_code,
    row.imobiliaria_name,
  );
  const enterpriseCode = cleanText(row.enterprise_code) ?? "";

  return {
    area: row.area === null ? null : toNumber(row.area),
    block: cleanText(row.block),
    bucket,
    code: codigoDaUnidade,
    enterpriseCode,
    id: String(row.id),
    kind: cleanText(row.kind),
    lot: cleanText(row.lot),
    // ⚠️ A RESERVA DO SALÃO GANHA A LINHA DE MOVIMENTAÇÃO, e isso não é preferência: sem ela,
    // a tela mostrava o lote como "Reservado" e, ao lado, o comprador da ÚLTIMA proposta antiga
    // do C2X — alguém que não tem nada a ver com a reserva de agora. Nome errado numa tela de
    // atendimento faz atender o cliente errado, que é pior do que não mostrar nome nenhum.
    //
    // A reserva do tótem É a movimentação mais recente daquela unidade; a AR do legado é
    // história. Sem imobiliária, porque o tótem não a grava na reserva — e inventá-la a partir
    // da proposta velha seria repetir o mesmo erro.
    movement: reservaDoSalao
      ? {
          // O nome vira link para o CRM quando a reserva guardou a entidade — e ela guarda,
          // porque todo credenciado é cadastrado no Apolo. Reservas anteriores a 28/08 não têm
          // o campo e caem no texto simples, sem prometer navegação que não existe.
          client: reservaDoSalao.cliente
            ? {
                code: null,
                entityId: reservaDoSalao.entityId,
                name: reservaDoSalao.cliente,
              }
            : null,
          // A origem ocupa a linha da imobiliária — é ela, com o corretor junto, no mesmo
          // formato do cupom. Sem entityId: é texto gravado na reserva, não uma entidade.
          imobiliaria: reservaDoSalao.origem
            ? { code: null, entityId: null, name: reservaDoSalao.origem }
            : null,
          stage: "Reserva do lançamento",
        }
      : client || imobiliaria
        ? { client, imobiliaria, stage: cleanText(row.stage) }
        : null,
    panteonId,
    price: toNumber(row.price),
    registration: cleanText(row.registration),
    semCadastroNoPanteon,
    // ⚠️ O TEXTO E A COR SAEM DA MESMA SITUAÇÃO (situacaoDaUnidadeNaAba), nunca de
    // `sale_statuses.name`. Enquanto o texto vinha do C2X, a tela dizia duas coisas: o lote
    // reservado no tótem ganhava a cor âmbar e o texto "Disponível".
    status,
  };
}

// Consolida as etapas do mesmo produto numa linha só (regra ENTERPRISE_GROUPS); as etapas
// viram `stages` (sub-linhas expansíveis). O que não está em grupo vira linha simples.
function groupEnterpriseRows(rows: ApoloEnterpriseRow[]): ApoloEnterpriseRow[] {
  const byCode = new Map(rows.map((row) => [row.code.toUpperCase(), row]));
  const grouped: ApoloEnterpriseRow[] = [];
  const consumed = new Set<string>();

  for (const group of ENTERPRISE_GROUPS) {
    const stages = group.codes
      .map((code) => byCode.get(code.toUpperCase()))
      .filter((row): row is ApoloEnterpriseRow => Boolean(row));

    if (!stages.length) {
      continue;
    }

    for (const stage of stages) {
      consumed.add(stage.code.toUpperCase());
    }

    const first = stages[0];

    // ⚠️ O PAI É A LINHA, E NÃO UMA LINHA AO LADO. Lucas, 14/09/2026, pela terceira vez:
    // *"VLO é o pai, porque tem dois vale do ouro, já expliquei isso para vc"* e, depois do primeiro
    // conserto, *"ainda estou vendo dois vale do ouro"*. O cadastro do Panteon concorda: em
    // `hercules_empreendimentos`, VLO tem `pai_id` nulo e VOC, VOL e VOR apontam para ele.
    //
    // O que esta tela fazia era montar um grupo SINTÉTICO (`id: group:Vale do Ouro`) a partir das
    // três carteiras e deixar o registro do pai cair como linha solta lá embaixo — duas linhas
    // "Vale do Ouro", 302 e 298 unidades, e quem lia somava 600.
    //
    // Agora o registro do pai VESTE o grupo: mesmo `id`, mesmo `code`, mesma cidade. Clicar continua
    // abrindo a ficha do VLO, e isso NÃO é detalhe: o pai é a casa do masterplan, de TODAS as CADs
    // da esteira e do eixo do painel do coordenador. Um grupo sintético com id próprio deixaria os
    // três sem porta de entrada.
    //
    // ⚠️ OS NÚMEROS CONTINUAM SENDO A SOMA DOS FILHOS, nunca os do pai. Os lotes do pai são os
    // MESMOS dos filhos — medido em 14/09/2026: 714 terrenos com duas linhas, e `espelho_de`
    // (migration 0161) hoje marca qual responde. Somar o pai junto contaria o loteamento duas vezes,
    // que é a conta de 4.560 unidades onde o certo são 4.262.
    //
    // ⚠️ E `codes` SEGUE SÓ COM OS FILHOS: é por ele que a tela busca UNIDADES, e incluir o pai
    // traria as mesmas 298 de volta — a duplicidade voltaria por baixo, agora invisível.
    const espelhoDoGrupo = ENTERPRISE_MIRRORS.find(
      (m) =>
        m.divisions.length === group.codes.length &&
        m.divisions.every((d) =>
          group.codes.some((c) => c.toUpperCase() === d.toUpperCase()),
        ),
    );
    const linhaDoPai = espelhoDoGrupo
      ? byCode.get(espelhoDoGrupo.code.toUpperCase())
      : undefined;
    if (linhaDoPai) consumed.add(linhaDoPai.code.toUpperCase());

    grouped.push({
      city: linhaDoPai?.city ?? first?.city ?? null,
      code: linhaDoPai?.code ?? stages.map((stage) => stage.code).join(" + "),
      codes: stages.map((stage) => stage.code),
      id: linhaDoPai?.id ?? `group:${group.display}`,
      incorporador:
        linhaDoPai?.incorporador ??
        stages.find((stage) => stage.incorporador)?.incorporador ??
        null,
      // A linha do grupo não se anuncia como espelho: ela JÁ é o consolidado, e a tarja existia para
      // explicar uma segunda linha que agora não existe mais.
      mirror: false,
      mirrorLabel: null,
      mirrorNote: null,
      name: group.display,
      scenario: sumScenarios(stages.filter((stage) => !stage.mirror)),
      state: linhaDoPai?.state ?? first?.state ?? null,
      stages,
    });
  }

  for (const row of rows) {
    if (!consumed.has(row.code.toUpperCase())) {
      grouped.push(row);
    }
  }

  return grouped.sort(
    (left, right) => right.scenario.total.units - left.scenario.total.units,
  );
}

function sumScenarios(rows: ApoloEnterpriseRow[]): ApoloEnterpriseScenario {
  return BALDES_DO_CENARIO.reduce((accumulator, bucket) => {
    accumulator[bucket] = rows.reduce(
      (tally, row) => ({
        units: tally.units + row.scenario[bucket].units,
        value: tally.value + row.scenario[bucket].value,
      }),
      { units: 0, value: 0 },
    );

    return accumulator;
  }, {} as ApoloEnterpriseScenario);
}

// Exportada pro teste: é aqui que a linha ganha a marca de espelho, e a marca é a metade da
// regra que a soma (buildApoloEnterprisesData) depende.
export function mapEnterpriseRow(row: EnterpriseQueryRow): ApoloEnterpriseRow {
  const tally = (
    units: number | string | null,
    value: number | string | null,
  ): ApoloEnterpriseTally => ({
    units: toNumber(units),
    value: toNumber(value),
  });
  const code = cleanText(row.code) ?? String(row.id);
  // O rótulo de "histórico" nasce AQUI, na origem do dado: quem consome a linha (tela, API,
  // relatório) recebe a marca pronta e não precisa reimplementar a regra do espelho.
  const mirror = findEnterpriseMirror(code);

  return {
    city: cleanText(row.city),
    code,
    codes: [code],
    id: String(row.id),
    incorporador: cleanText(row.incorporador),
    mirror: mirror !== null,
    mirrorLabel: mirror?.label ?? null,
    mirrorNote: mirror?.note ?? null,
    name: cleanText(row.name) ?? "Empreendimento",
    scenario: {
      bloqueado: tally(row.bloqueado_units, row.bloqueado_value),
      disponivel: tally(row.disponivel_units, row.disponivel_value),
      // ⚠️ ZERO, E NÃO UM NÚMERO DO LEGADO: o pedido de cancelamento nasce no Panteon e o C2X não
      // sabe dele. Quem conta este balde de verdade é a régua (`cenariosPelaRegua`).
      em_cancelamento: tally(0, 0),
      negociacao: tally(row.negociacao_units, row.negociacao_value),
      reservado: tally(row.reservado_units, row.reservado_value),
      total: tally(row.total_units, row.total_value),
      vendido: tally(row.vendido_units, row.vendido_value),
    },
    state: cleanText(row.state),
    stages: [],
  };
}

function toNumber(value: number | string | null): number {
  const parsed = Number(value ?? 0);

  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value: string | null): string | null {
  const trimmed = value?.trim();

  return trimmed ? trimmed : null;
}
