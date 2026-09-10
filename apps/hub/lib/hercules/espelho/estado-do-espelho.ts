// O ESTADO DO ESPELHO PÚBLICO — o que a tela recebe para pintar o mapa.
//
// ⚠️ SÓ PANTEON. Lucas (10/09/2026): *"nada de olhar no c2x"* · *"temo cadastro de unidades"*.
// Cadastro em `hercules_unidades`, processo em `hercules_propostas` e `hercules_reservas`.
// Nenhuma consulta ao MySQL do legado entra neste caminho.
//
// ⚠️ O QUE SAI DAQUI É PÚBLICO — viaja por um link sem login, para quem o corretor mandar. Por
// lote saem QUATRO coisas: código, situação em duas cores, preço de tabela e área. Nunca nome de
// comprador, nunca corretor, nunca imobiliária, nunca desconto, nunca etapa do processo. A lição
// é do Garden, onde uma página interna sem senha expôs nome e preço juntos
// ([[reference_iris_vinculo_nome_vazamento]] é o mesmo tipo de estrago). Se algum dia alguém
// precisar de mais um campo aqui, a pergunta certa é se esta tela ainda pode ser pública.
//
// ⚠️ O MAPA É DO PAI E O ESTADO É DA ÁRVORE. O masterplan traz `inkscape:label` com o código da
// unidade do PAI (VLO0101); os lotes vivos estão nos filhos com outro código (VOL0101). A ponte
// é `quadra` + `lote`, que é única dos dois lados — medido em 10/09/2026: 298 de 298 no Vale do
// Ouro, 495 de 495 no Lagoa Bonita, nenhum sobrando de nenhum lado.
import type { SupabaseClient } from "@supabase/supabase-js";

import { chaveDoLote } from "@/lib/apolo/incorporador/masterplan-recorte";

import {
  contarPublicas,
  situacaoDoLoteReal,
  type SinaisDaUnidade,
  type SituacaoPublica,
} from "./situacao-publica";

/** Um lote como o público o vê. */
export type LoteDoEspelho = {
  /** m², do cadastro. `null` quando não cadastrada. */
  area: null | number;
  /** O código do PAI — o mesmo `inkscape:label` do masterplan. É a chave do desenho. */
  codigo: string;
  /** O número do lote dentro da quadra. A grade rotula por ele. */
  lote: null | string;
  /** R$ de tabela. `null` quando não cadastrado ou sentinela (≤ 1). */
  preco: null | number;
  /** A quadra. A GRADE agrupa por ela — é a visão de quem não tem masterplan. */
  quadra: null | string;
  situacao: SituacaoPublica;
};

export type EstadoDoEspelho = {
  /** ISO — a tela mostra discretamente, para ninguém olhar mapa congelado sem perceber. */
  atualizadoEm: string;
  contagem: Record<SituacaoPublica, number>;
  lotes: LoteDoEspelho[];
};

type LinhaDeUnidade = {
  area: null | number | string;
  codigo: string;
  enterprise_id: string;
  id: string;
  lote: null | string;
  preco_tabela: null | number | string;
  quadra: null | string;
  situacao: string;
};

/**
 * ⚠️ PREÇO ≤ 1 NÃO É PREÇO, É SENTINELA. Medido no cadastro: 168 lotes do Garden, 71 do Vale do
 * Ouro e 99 do Veredas têm `preco_tabela` de R$ 1,00 — é como o legado marcou lote sem tabela
 * definida. Mostrar "R$ 1,00" numa página pública seria pior do que não mostrar nada
 * ([[reference_bi_preco_um_real_esconde_estoque]] é a outra ponta do mesmo problema). Aqui vira
 * `null`, e a tela diz "sob consulta".
 */
const PRECO_MINIMO_REAL = 1;

function numero(valor: null | number | string | undefined): null | number {
  if (valor === null || valor === undefined) return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

/**
 * O estado do espelho de um empreendimento — o CADASTRO INTEIRO da árvore, um item por terreno.
 *
 * ⚠️ DEVOLVE TUDO, E NÃO SÓ O QUE ESTÁ DESENHADO. Lucas (10/09/2026): *"os que não tiverem
 * espelho vão ter a grade"* — 29 dos 37 empreendimentos não têm masterplan, e para eles esta é a
 * única fonte da tela. Quem tem mapa cruza esta lista com a geometria pelo `codigo`: o que tem
 * contorno é pintado na planta, e a grade mostra todos de qualquer forma.
 */
export async function estadoDoEspelho(
  client: SupabaseClient,
  {
    enterpriseIdDoPai,
    enterpriseIdsDosFilhos,
  }: {
    /** `c2x_enterprise_id` do topo. `null` em pai sem id do C2X (o conjunto é só dos filhos). */
    enterpriseIdDoPai: null | string;
    enterpriseIdsDosFilhos: readonly string[];
  },
): Promise<EstadoDoEspelho> {
  const todosOsIds = [enterpriseIdDoPai, ...enterpriseIdsDosFilhos].filter(
    (id): id is string => Boolean(id),
  );
  if (todosOsIds.length === 0) {
    return {
      atualizadoEm: new Date().toISOString(),
      contagem: contarPublicas([]),
      lotes: [],
    };
  }
  const unidades = await lerUnidades(client, todosOsIds);
  const comProcesso = await lerIdsComProcesso(
    client,
    unidades.map((u) => u.id),
  );

  // ⚠️ UM TERRENO, VÁRIOS REGISTROS. A chave é `quadra` + `lote` porque o MESMO terreno existe no
  // cadastro do pai e no do filho, com códigos diferentes (VLO0101 e VOL0101). Sem quadra ou lote
  // cadastrados a unidade fica sozinha na própria chave — ela não participa do cruzamento, mas
  // continua aparecendo na grade.
  const terrenos = new Map<
    string,
    {
      area: null | number;
      codigoDoPai: null | string;
      codigoQualquer: string;
      lote: null | string;
      preco: null | number;
      quadra: null | string;
      registros: SinaisDaUnidade[];
    }
  >();

  for (const u of unidades) {
    const chave =
      u.quadra !== null && u.lote !== null
        ? chaveDoLote(u.quadra, u.lote)
        : `codigo:${u.codigo.trim().toUpperCase()}`;

    const doPai = enterpriseIdDoPai !== null && u.enterprise_id === enterpriseIdDoPai;
    const atual = terrenos.get(chave);
    const preco = numero(u.preco_tabela);
    const precoReal = preco !== null && preco > PRECO_MINIMO_REAL ? preco : null;

    if (!atual) {
      terrenos.set(chave, {
        area: numero(u.area),
        codigoDoPai: doPai ? u.codigo.trim().toUpperCase() : null,
        codigoQualquer: u.codigo.trim().toUpperCase(),
        lote: u.lote,
        preco: precoReal,
        quadra: u.quadra,
        registros: [sinaisDe(u, doPai, comProcesso)],
      });
      continue;
    }

    atual.registros.push(sinaisDe(u, doPai, comProcesso));
    // O código do PAI é o que casa com o `inkscape:label` do masterplan — é ele que o desenho
    // procura. O do filho só serve de rótulo quando não há pai.
    if (doPai) atual.codigoDoPai = u.codigo.trim().toUpperCase();
    // Preço e área: o primeiro que existir ganha. Não passam pela régua pai/filho — preço não é
    // situação, e um cadastro sem preço não desmente o outro.
    atual.area ??= numero(u.area);
    atual.preco ??= precoReal;
    atual.quadra ??= u.quadra;
    atual.lote ??= u.lote;
  }

  const lotes: LoteDoEspelho[] = [...terrenos.values()].map((t) => ({
    area: t.area,
    codigo: t.codigoDoPai ?? t.codigoQualquer,
    lote: t.lote,
    preco: t.preco,
    quadra: t.quadra,
    situacao: situacaoDoLoteReal(t.registros),
  }));

  // Ordem estável e legível: quadra, depois lote, em ordem natural (Q2 antes de Q10).
  lotes.sort(
    (a, b) =>
      comparar(a.quadra, b.quadra) ||
      comparar(a.lote, b.lote) ||
      a.codigo.localeCompare(b.codigo),
  );

  return {
    atualizadoEm: new Date().toISOString(),
    contagem: contarPublicas(lotes.map((l) => l.situacao)),
    lotes,
  };
}

function sinaisDe(
  u: LinhaDeUnidade,
  doPai: boolean,
  comProcesso: { propostas: Set<string>; reservas: Set<string> },
): SinaisDaUnidade {
  return {
    // Quem não é do pai é do filho — e a régua só distingue esses dois.
    doFilho: !doPai,
    propostaAberta: comProcesso.propostas.has(u.id),
    reservaViva: comProcesso.reservas.has(u.id),
    situacaoNoCadastro: u.situacao,
  };
}

/** Ordem natural: "2" antes de "10", e "C01" antes de "C02". */
function comparar(a: null | string, b: null | string): number {
  const x = (a ?? "").trim();
  const y = (b ?? "").trim();
  if (x === y) return 0;
  if (!x) return 1;
  if (!y) return -1;
  return x.localeCompare(y, "pt-BR", { numeric: true, sensitivity: "base" });
}

/**
 * ⚠️ PAGINADO, SEMPRE. O PostgREST corta em 1.000 linhas SEM ERRO
 * ([[reference_postgrest_teto_de_1000_linhas]]), e o Lagoa Bonita já tem 907 registros somando
 * pai e filhos. Um empreendimento que cresça mais um pouco passaria a servir mapa incompleto —
 * e mapa incompleto aqui vira lote sem cor, que o público lê como disponível.
 */
async function lerUnidades(
  client: SupabaseClient,
  enterpriseIds: readonly string[],
): Promise<LinhaDeUnidade[]> {
  const PAGINA = 1000;
  const todas: LinhaDeUnidade[] = [];

  for (let pagina = 0; ; pagina += 1) {
    const { data, error } = await client
      .from("hercules_unidades")
      .select("area, codigo, enterprise_id, id, lote, preco_tabela, quadra, situacao")
      .in("enterprise_id", enterpriseIds)
      .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);

    if (error) throw new Error(error.message);
    const lote = (data ?? []) as LinhaDeUnidade[];
    todas.push(...lote);
    if (lote.length < PAGINA) return todas;
  }
}

/** Os ids de unidade com proposta aberta ou reserva viva. Duas consultas, paginadas. */
async function lerIdsComProcesso(
  client: SupabaseClient,
  unidadeIds: readonly string[],
): Promise<{ propostas: Set<string>; reservas: Set<string> }> {
  const propostas = new Set<string>();
  const reservas = new Set<string>();
  if (unidadeIds.length === 0) return { propostas, reservas };

  // ⚠️ NÃO USA `.in(unidade_id, [...5.540 uuids])`: a URL do PostgREST estoura
  // ([[reference_postgrest_in_url_limite]]). Filtra pelo EMPREENDIMENTO e cruza em memória — a
  // proposta já carrega `empreendimento_codigo`, mas o vínculo confiável é `unidade_id`.
  const doEscopo = new Set(unidadeIds);
  const PAGINA = 1000;

  for (const [tabela, filtro, destino] of [
    ["hercules_propostas", { coluna: "aberta", valor: true }, propostas],
    ["hercules_reservas", { coluna: "situacao", valor: "reservada" }, reservas],
  ] as const) {
    for (let pagina = 0; ; pagina += 1) {
      const { data, error } = await client
        .from(tabela)
        .select("unidade_id")
        .eq(filtro.coluna, filtro.valor)
        .range(pagina * PAGINA, pagina * PAGINA + PAGINA - 1);

      if (error) throw new Error(error.message);
      const linhas = (data ?? []) as { unidade_id: null | string }[];
      for (const l of linhas) {
        if (l.unidade_id && doEscopo.has(l.unidade_id)) destino.add(l.unidade_id);
      }
      if (linhas.length < PAGINA) break;
    }
  }

  return { propostas, reservas };
}
