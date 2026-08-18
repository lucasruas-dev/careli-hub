// TELA CONTRATOS DO APOLO — a leitura do C2X (read-only) que alimenta `/apolo/assinaturas`.
//
// É a BORDA INTERNA do núcleo compartilhado (`./nucleo`): as regras (fila por degrau, perfil,
// prazo de 7 dias, taxas, quadro, dados do contrato na linha, as três situações) são as MESMAS do
// portal do incorporador, importadas. O que muda aqui é só o escopo e o que a tela pode mostrar.
//
// AS TRÊS DIFERENÇAS DA VERSÃO INTERNA, todas decididas em 18/08/2026:
//   1. O ESCOPO NÃO VEM DE SESSÃO DE CLIENTE. No portal, o recorte sai do token do incorporador;
//      aqui quem autoriza é o papel no Hub (`authorizeApoloRead`, na rota) e o time escolhe o
//      empreendimento na tela. O código pedido é confrontado com a lista que o próprio C2X
//      devolve (`resolverCodes`), então `emp` da query string nunca vira filtro cru.
//   2. O E-MAIL DO ASSINANTE ATRAVESSA (no quadro e no popup). O painel interno sempre mostrou o
//      e-mail sob o nome, e é ele que separa três sócios da mesma razão social. No portal, não.
//   3. O PDF SAI PELO CAMINHO INTERNO. A linha carrega o `uuidDoc` do envio escolhido, que a tela
//      manda para `/api/apolo/empreendimentos/contrato/[documentId]` — o mesmo caminho da coluna
//      Contrato da Carteira. O portal manda `unitId` e resolve o uuid no servidor dele.
//
// ⚠️ ENVIO DE PROPOSTA JÁ MORTA VEM SEM DADOS DE CONTRATO, e é assim nas duas telas. Medido em
// 18/08/2026: 23 casos no C2X inteiro (venda distratada cujo envio nunca foi cancelado). A régua
// importada mantém a linha na lista (o envio segue válido) e `contrato` vem nulo, porque não há
// contrato vigente de onde tirar valor e imobiliária. Buscar esses dados só aqui faria a mesma
// unidade contar uma história no portal e outra no Apolo.
//
// ⚠️ CACHE DE 5 MINUTOS POR RECORTE, pela mesma razão do painel clássico: o legado tem pool de 5
// conexões, e dez pessoas com a tela aberta virariam 120 consultas/hora sem ele. Medido em
// 18/08/2026: o recorte inteiro (todos os empreendimentos, 17.398 linhas) leva ~700 ms; o Vale do
// Ouro (VOC+VOL, 2.295 linhas), ~60 ms. Falha FECHADA: com o C2X fora, devolve o cache velho com o
// carimbo antigo — a tela mostra "atualizado às …" e ninguém confunde um com o outro.
import type { RowDataPacket } from "mysql2";

import { montarQuadroComD4Sign } from "@/lib/apolo/d4sign-quadro";
import { getHadesDbPool } from "@/lib/guardian/db";

import {
  emailsPorNome,
  enriquecerAssinantes,
  enriquecerUnidades,
  escolherEnvio,
  ESTAGIOS_COM_CONTRATO,
  ESTAGIOS_DE_GERACAO,
  montarQuadroDeAssinaturas,
  perfilDeTela,
  resolverCodes,
  SQL_LINHAS_POR_CODE,
  SQL_UNIDADE_ROTULO,
  type AssinanteInterno,
  type ContratoDoPainel,
  type ContratoVivo,
  type EmpreendimentoDoFiltro,
  type EnvioDeAssinatura,
  type EnvioSemAssinante,
  type LinhaAssinatura,
  type QuadroDeAssinaturas,
} from "./nucleo";

const TTL_MS = 5 * 60 * 1000;
/** Quantos recortes o cache guarda. Sem teto, cada empreendimento aberto uma vez ficaria residente. */
const MAX_RECORTES = 8;
/** A lista de empreendimentos só muda quando nasce loteamento: pode ser bem mais preguiçosa. */
const TTL_EMPREENDIMENTOS_MS = 30 * 60 * 1000;

export type PainelDeContratos = {
  assinantes: AssinanteInterno[];
  atualizadoEm: string;
  /** O aviso do teto da lista, quando ela veio cortada. Nulo quando veio inteira. */
  aviso: null | string;
  /**
   * O aviso da FONTE: "o D4Sign não respondeu e isto é o registro antigo".
   *
   * ⚠️ SÃO TRÊS AVISOS DIFERENTES nesta tela e nenhum substitui o outro: `aviso` é o teto da lista,
   * `avisoDaFonte` é a queda da fonte e `avisoDosAssinantes` é o detalhe pessoa a pessoa que não
   * foi conferido. Fundir dois deles faz o raro (a queda) sumir atrás do corriqueiro.
   */
  avisoDaFonte: null | string;
  /** O aviso sobre o detalhe por assinante quando só a situação do documento foi confirmada. */
  avisoDosAssinantes: null | string;
  /** O recorte que de fato foi lido (já validado): é o que a tela ecoa no cabeçalho. */
  codes: string[];
  /**
   * A resposta saiu com o que havia em memória e a D4Sign está sendo buscada em segundo plano:
   * a tela pergunta de novo em alguns segundos e recebe o quadro conciliado.
   */
  conciliando: boolean;
  contratos: ContratoDoPainel[];
  /** Todos os empreendimentos com contrato no C2X — as opções do filtro, com CÓDIGO e nome. */
  empreendimentos: EmpreendimentoDoFiltro[];
  fila: QuadroDeAssinaturas["fila"];
  kpis: QuadroDeAssinaturas["kpis"];
  taxas: QuadroDeAssinaturas["taxas"];
  /** Contratos do recorte ANTES do teto: o denominador honesto do cabeçalho. */
  total: number;
};

export type ResultadoPainelDeContratos =
  /**
   * `uuids` são os documentos desta carga, para a rota aquecer a D4Sign DEPOIS de responder.
   * Opcional porque só o caminho que foi ao banco os conhece: resposta de cache ou de recorte
   * vazio não tem lista, e aquecer o catálogo (que é o caro) não depende dela.
   */
  | { dados: PainelDeContratos; ok: true; uuids?: string[] }
  | { erro: string; ok: false };

type LinhaRow = RowDataPacket & {
  ar_id: number;
  assinado: null | number;
  data_assinatura: null | string;
  dias_envio: null | number;
  email: null | string;
  emp: null | string;
  envio: null | string;
  id_ass: number;
  lot: null | string;
  perfil_c2x: null | string;
  posicao: null | number;
  quadra: null | string;
  /** Nulo = envio sem NENHUM assinante (o LEFT JOIN devolve uma linha só, vazia). */
  signer_id: null | number;
  /** `contract_signature_status_id` — alimenta a divergência "D4Sign 4 x C2X 7". */
  status_c2x: null | number;
  unidade: null | string;
  usuario: null | string;
  uuid_doc: null | string;
  valor: null | number | string;
};

type VivoRow = RowDataPacket & {
  ar_id: number;
  billing_date: null | string;
  comprador: null | string;
  emp: null | string;
  gerado_em: null | Date | string;
  imobiliaria: null | string;
  price: null | number | string;
  unidade: null | string;
  unit_id: number;
};

type EmpreendimentoRow = RowDataPacket & {
  code: null | string;
  contratos: null | number;
  nome: null | string;
};

const cache = new Map<string, { dados: PainelDeContratos; em: number }>();
let empreendimentosEmCache: { em: number; lista: EmpreendimentoDoFiltro[] } | null = null;

/** Nome de pessoa/empresa como o C2X guarda, em três colunas diferentes. */
const nomeSql = (alias: string) =>
  `coalesce(nullif(trim(${alias}.name), ''), nullif(trim(${alias}.fantasy_name), ''), nullif(trim(${alias}.social_name), ''))`;

const limpo = (valor: unknown): string => String(valor ?? "").trim().replace(/\s+/g, " ");

const textoOuNulo = (valor: unknown): null | string => limpo(valor) || null;

/** ISO curto validado por STRING: `billing_date` é DATE, e `new Date` mostraria a véspera. */
function ymdOuNulo(valor: unknown): null | string {
  const texto = String(valor ?? "").slice(0, 10);

  return /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : null;
}

function isoOuNulo(valor: null | Date | string): null | string {
  if (!valor) return null;
  const data = valor instanceof Date ? valor : new Date(String(valor));

  return Number.isNaN(data.getTime()) ? null : data.toISOString();
}

/**
 * Os empreendimentos que têm contrato no C2X: contrato ENVIADO para assinar ou contrato vivo.
 *
 * ⚠️ CÓDIGO E NOME, SEMPRE OS DOIS. Medido em 18/08/2026: 30 empreendimentos, e o nome repete em
 * cinco famílias — QUATRO se chamam "VALE DO OURO" (VLO 15 contratos, VOL 93, VOC 93, VOR 2), três
 * são "LAGOA BONITA", e ainda há dois "RIO DE PEDRAS", dois "PORTAL DOS VALES", dois "LAVRA DO
 * OURO" e dois "MILENIUM". Um seletor por nome somaria carteiras de donos diferentes.
 */
async function listarEmpreendimentos(): Promise<EmpreendimentoDoFiltro[]> {
  if (empreendimentosEmCache && Date.now() - empreendimentosEmCache.em < TTL_EMPREENDIMENTOS_MS) {
    return empreendimentosEmCache.lista;
  }

  const pool = getHadesDbPool();
  if (!pool.ok) return empreendimentosEmCache?.lista ?? [];

  const vivosPlaceholders = ESTAGIOS_COM_CONTRATO.map(() => "?").join(", ");

  // O UNION (sem ALL) deduplica o par (código, proposta): o contrato que está vivo E já saiu para
  // assinar é UM contrato, não dois. Contar as duas metades separadas dobraria o número.
  const [rows] = await pool.pool.query<EmpreendimentoRow[]>(
    `select code, nome, count(distinct ar_id) as contratos from (
       select e.code as code, e.name as nome, arc.acquisition_request_id as ar_id
         from contract_signatures cs
         join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
         join acquisition_requests ar on ar.id = arc.acquisition_request_id
         join enterprise_unities u on u.id = ar.enterprise_unity_id
         join enterprises e on e.id = u.enterprise_id
        where cs.send_document_signature = 1
          and cs.contract_signature_status_id <> 6
       union
       select e.code, e.name, ar.id
         from enterprise_unities u
         join enterprises e on e.id = u.enterprise_id
         join acquisition_requests ar on ar.id = (
                select ar2.id from acquisition_requests ar2
                 where ar2.enterprise_unity_id = u.id
                 order by ar2.created_at desc, ar2.id desc
                 limit 1)
        where ar.acquisition_request_stage_id in (${vivosPlaceholders})
     ) t
     group by code, nome
     order by nome, code`,
    ESTAGIOS_COM_CONTRATO,
  );

  const lista: EmpreendimentoDoFiltro[] = rows
    .map((row) => ({
      code: limpo(row.code).toUpperCase(),
      contratos: Number(row.contratos ?? 0),
      nome: limpo(row.nome) || limpo(row.code).toUpperCase(),
    }))
    .filter((item) => item.code);

  empreendimentosEmCache = { em: Date.now(), lista };

  return lista;
}

/**
 * O painel inteiro para o recorte pedido.
 *
 * @param pedidos Códigos vindos da tela. Vazio = o recorte padrão (o mesmo Vale do Ouro que
 *   `/apolo/assinaturas` mostra hoje); `["*"]` = todos os empreendimentos. Quem autoriza é a rota.
 */
export async function carregarPainelDeContratos(
  pedidos: string[] = [],
): Promise<ResultadoPainelDeContratos> {
  const poolResult = getHadesDbPool();
  if (!poolResult.ok) {
    return { erro: `Configuração do C2X ausente: ${poolResult.missing.join(", ")}.`, ok: false };
  }

  let empreendimentos: EmpreendimentoDoFiltro[] = [];
  try {
    empreendimentos = await listarEmpreendimentos();
  } catch (error) {
    console.error("[apolo][painel-contratos] falha ao listar empreendimentos", error);
  }

  const codes = resolverCodes(pedidos, empreendimentos);
  const chave = codes.join(",");
  const guardado = cache.get(chave);
  if (guardado && Date.now() - guardado.em < TTL_MS) {
    return { dados: guardado.dados, ok: true };
  }

  if (codes.length === 0) return { dados: vazio(codes, empreendimentos), ok: true };

  const placeholders = codes.map(() => "?").join(", ");
  const vivosPlaceholders = ESTAGIOS_COM_CONTRATO.map(() => "?").join(", ");
  const geracaoPlaceholders = ESTAGIOS_DE_GERACAO.map(() => "?").join(", ");

  try {
    // 1. AS LINHAS DE ASSINATURA do recorte (a consulta compartilhada com o portal).
    const [linhaRows] = await poolResult.pool.query<LinhaRow[]>(
      SQL_LINHAS_POR_CODE(placeholders),
      codes,
    );

    // Por contrato vale UM envio — o com uuidDoc, senão o de maior id. A média é de dois envios
    // por contrato, e contar todos dobraria o quadro.
    const enviosPorAr = new Map<number, EnvioDeAssinatura[]>();
    // O `contract_signature_status_id` por envio: alimenta a divergência de status na conciliação.
    const statusPorEnvio = new Map<number, null | number>();
    for (const row of linhaRows) {
      const arId = Number(row.ar_id);
      statusPorEnvio.set(Number(row.id_ass), row.status_c2x ?? null);
      const lista = enviosPorAr.get(arId) ?? [];
      if (!lista.some((envio) => envio.csId === Number(row.id_ass))) {
        lista.push({
          arId,
          csId: Number(row.id_ass),
          linhas: 0,
          linhasAssinadas: 0,
          uuidDoc: textoOuNulo(row.uuid_doc),
        });
      }
      enviosPorAr.set(arId, lista);
    }

    const escolhidos = new Set<number>();
    const arPorEnvio = new Map<number, number>();
    const uuidPorEnvio = new Map<number, null | string>();
    const uuidPorAr = new Map<number, null | string>();
    for (const [arId, envios] of enviosPorAr) {
      const escolhido = escolherEnvio(envios);
      if (!escolhido) continue;
      escolhidos.add(escolhido.csId);
      arPorEnvio.set(escolhido.csId, arId);
      uuidPorEnvio.set(escolhido.csId, escolhido.uuidDoc);
      uuidPorAr.set(arId, escolhido.uuidDoc);
    }

    const linhas: LinhaAssinatura[] = linhaRows
      .filter((row) => row.signer_id !== null && escolhidos.has(Number(row.id_ass)))
      .map((row) => {
        const email = String(row.email ?? "").trim().toLowerCase();

        return {
          assinadoEm: row.data_assinatura,
          assinou: Number(row.assinado) === 1,
          contrato: Number(row.id_ass),
          degrau: Number(row.posicao ?? 0),
          diasDesdeEnvio: Number(row.dias_envio ?? 0),
          email,
          emp: limpo(row.emp),
          envio: String(row.envio ?? ""),
          lote: limpo(row.lot),
          perfil: perfilDeTela(row.perfil_c2x, email),
          // Recalculado dentro de `montarQuadroDeAssinaturas`, com a régua importada.
          prazo: null,
          quadra: limpo(row.quadra),
          // Preenchido por `marcarSituacao`, que precisa do contrato inteiro para saber de quem
          // é a vez.
          situacao: "aguardando",
          un: limpo(row.unidade),
          usuario: limpo(row.usuario),
          valor: Math.round(Number(row.valor ?? 0)),
        };
      });

    // Envio válido SEM nenhuma linha de assinante: o LEFT JOIN devolve uma linha vazia. Ele não
    // some da tela — entra como "sem assinante registrado".
    const semAssinante: EnvioSemAssinante[] = linhaRows
      .filter((row) => row.signer_id === null && escolhidos.has(Number(row.id_ass)))
      .map((row) => ({
        csId: Number(row.id_ass),
        emp: limpo(row.emp),
        enviadoEm: String(row.envio ?? ""),
        un: limpo(row.unidade),
      }));

    // 2. OS CONTRATOS VIVOS do recorte, com tudo o que a antiga aba Contratos mostrava. O rótulo
    // da unidade usa a MESMA expressão das linhas de assinatura, senão a unidade que ainda não
    // saiu para assinar apareceria com outro nome na mesma lista.
    const [vivoRows] = await poolResult.pool.query<VivoRow[]>(
      `select ar.id as ar_id, u.id as unit_id, e.code as emp,
              ${SQL_UNIDADE_ROTULO} as unidade,
              u.price,
              date_format(ar.billing_date, '%Y-%m-%d') as billing_date,
              (select min(h.created_at) from acquisition_request_historics h
                 where h.acquisition_request_id = ar.id
                   and h.new_acquisition_request_stage_id in (${geracaoPlaceholders})) as gerado_em,
              ${nomeSql("cli")} as comprador,
              ${nomeSql("imo")} as imobiliaria
         from enterprise_unities u
         join enterprises e on e.id = u.enterprise_id
         join acquisition_requests ar on ar.id = (
                select ar2.id from acquisition_requests ar2
                 where ar2.enterprise_unity_id = u.id
                 order by ar2.created_at desc, ar2.id desc
                 limit 1)
         left join users cli on cli.id = ar.client_id
         left join users imo on imo.id = cli.vinculed_by_id
        where e.code in (${placeholders})
          and ar.acquisition_request_stage_id in (${vivosPlaceholders})`,
      [...ESTAGIOS_DE_GERACAO, ...codes, ...ESTAGIOS_COM_CONTRATO],
    );

    // A FICHA VAI PREENCHIDA: é ela que vira `contrato` na linha (valor, imobiliária, geração,
    // faturamento) e que rotula o contrato ainda sem envio. O núcleo aceita a chamada sem ficha,
    // mas aí a linha viria sem os dados que esta tela existe para mostrar.
    const vivos: ContratoVivo[] = vivoRows.map((row) => {
      const arId = Number(row.ar_id);

      return {
        arId,
        ficha: {
          comprador: textoOuNulo(row.comprador),
          empreendimento: limpo(row.emp),
          faturadoEm: ymdOuNulo(row.billing_date),
          imobiliaria: textoOuNulo(row.imobiliaria),
          // O PDF existe quando o envio ESCOLHIDO daquele contrato tem uuidDoc.
          temContrato: Boolean(uuidPorAr.get(arId)),
          unidade: limpo(row.unidade),
          unitId: Number(row.unit_id) || 0,
          valorTabela: Number(row.price ?? 0) || 0,
        },
        geradoEm: isoOuNulo(row.gerado_em as Date | null | string),
      };
    });

    // 3. O QUADRO — as regras compartilhadas com o portal, sem uma linha reescrita: a lista já
    // vem com as três situações, os dados do contrato pendurados, ordenada pelo gargalo e cortada
    // no teto.
    //
    // ⚠️ E COM A D4SIGN MANDANDO NO STATUS. O envio que ela diz cancelado sai da conta (a venda
    // volta a "aguardando emissão"), o finalizado fecha as linhas que o C2X deixou em aberto, e
    // cada linha volta com `fonte`/`aviso`. Fonte fora do ar = C2X com aviso, nunca tela vazia.
    //
    // ⚠️ O `statusC2x` VAI JUNTO: é ele que dá nome à divergência ("D4Sign Finalizado (4) x C2X
    // Em aberto (7)"). Sem ele a discordância é contada e fica muda.
    const paraD4Sign = [...escolhidos].map((csId) => ({
      csId,
      statusC2x: statusPorEnvio.get(csId) ?? null,
      uuidDoc: uuidPorEnvio.get(csId) ?? null,
    }));
    // ⚠️ A TELA NÃO ESPERA A D4SIGN. Medido em 18/08/2026: catálogo frio 4,4 s mais 7,0 s dos 20
    // detalhes do teto, contra 0,1 s do SQL que traz a mesma lista — quase 12 s de tela parada, e
    // não em caso raro: o cache é da INSTÂNCIA e a Vercel recicla instância o tempo todo. Com
    // `semEsperar`, o que está em memória vale, o resto cai no fallback honesto do C2X, e o
    // aquecimento acontece DEPOIS da resposta (`after()` na rota). `conciliando` avisa a tela para
    // perguntar de novo em alguns segundos, quando aí sim virá conciliado.
    const quadro = await montarQuadroComD4Sign({
      arPorEnvio,
      envios: paraD4Sign,
      linhas,
      opcoes: { semEsperar: true },
      semAssinante,
      vivos,
    });

    // Os uuids que o aquecimento vai perseguir depois de a resposta sair.
    const uuidsDaCarga = paraD4Sign
      .map((envio) => envio.uuidDoc ?? "")
      .filter((uuid) => uuid.length > 0);

    const dados: PainelDeContratos = {
      assinantes: enriquecerAssinantes(quadro.assinantes, emailsPorNome(linhas)),
      atualizadoEm: new Date().toISOString(),
      aviso: quadro.aviso,
      avisoDaFonte: quadro.avisoDaFonte,
      avisoDosAssinantes: quadro.avisoDosAssinantes,
      codes,
      conciliando: quadro.conciliando,
      contratos: enriquecerUnidades({ linhas, unidades: quadro.unidades, uuidPorEnvio }),
      empreendimentos,
      fila: quadro.fila,
      kpis: quadro.kpis,
      taxas: quadro.taxas,
      // Envios escolhidos (inclusive os sem assinante) + contratos que ainda não saíram para
      // assinar: o total real do recorte, mesmo quando a lista bateu no teto.
      total: escolhidos.size + quadro.kpis.aguardandoEmissao,
    };

    // ⚠️ QUADRO PELA METADE NÃO ENTRA NO CACHE DE 5 MINUTOS. `conciliando` significa que a D4Sign
    // ainda está sendo buscada; guardar isso prenderia a tela no dado do C2X por 5 min mesmo depois
    // de o aquecimento terminar — e o repique do cliente voltaria de mãos abanando.
    if (!dados.conciliando) guardar(chave, dados);

    return { dados, ok: true, uuids: uuidsDaCarga };
  } catch (error) {
    console.error("[apolo][painel-contratos] falha ao ler o C2X", error);
    if (guardado) return { dados: guardado.dados, ok: true };

    return { erro: "Não foi possível ler o C2X agora.", ok: false };
  }
}

function vazio(codes: string[], empreendimentos: EmpreendimentoDoFiltro[]): PainelDeContratos {
  const quadro = montarQuadroDeAssinaturas([], [], new Map());

  return {
    assinantes: [],
    atualizadoEm: new Date().toISOString(),
    aviso: null,
    avisoDaFonte: null,
    avisoDosAssinantes: null,
    codes,
    // Recorte vazio não tem documento a conferir: já nasce conciliado.
    conciliando: false,
    contratos: [],
    empreendimentos,
    fila: quadro.fila,
    kpis: quadro.kpis,
    taxas: quadro.taxas,
    total: 0,
  };
}

/** Guarda o recorte e joga fora o mais velho quando passa do teto (LRU pobre, e suficiente). */
function guardar(chave: string, dados: PainelDeContratos): void {
  cache.set(chave, { dados, em: Date.now() });
  if (cache.size <= MAX_RECORTES) return;

  let maisVelha: null | string = null;
  let quando = Infinity;
  for (const [outra, valor] of cache) {
    if (valor.em < quando) {
      quando = valor.em;
      maisVelha = outra;
    }
  }
  if (maisVelha !== null) cache.delete(maisVelha);
}
