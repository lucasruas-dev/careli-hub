// A LISTA E O LINK DO PAINEL DO COORDENADOR, PELO ID (PAN-124, fatia F6). Puro: sem banco e sem rede.
// Quem lê é ./painel-coordenador.ts.
//
// COMO ERA. O painel achava o empreendimento pelo SLUG do nome do C2X (`?emp=vale-do-ouro`), e um slug
// que não casava caía, sem erro, no primeiro da lista: um link renomeado ou digitado errado abria
// OUTRO empreendimento, com nomes de cliente. Só o Vale do Ouro era agrupado (35, 36 e 37, sem o 41), e
// o `group:Lagoa Bonita` era descartado por `Number()`: medido em 01/10/2026, 4 CADs e 8 imobiliárias
// que não apareciam em lugar nenhum do painel.
//
// COMO FICA.
//   • AGRUPA PELO CADASTRO: os 5 pais com filhos (Lavra do Ouro, Portal dos Vales, Rio de Pedras, Lagoa
//     Bonita e Vale do Ouro) viram UM empreendimento cada, com o pai, todas as divisões e o
//     `group:<chave>`. A chave vem da coluna congelada da F4 (0203), e não do nome;
//   • O LINK NOVO LEVA A CHAVE (`?emp=37`, `?emp=group:Vale do Ouro`), que não muda com renome;
//   • O LINK ANTIGO CONTINUA VALENDO por apelido: o slug de todo nome que aquele empreendimento já teve
//     (o do C2X de cada id, o do cadastro, o de mercado, o rótulo gravado na esteira e nos vínculos e os
//     nomes anteriores que o vigia guardou). Sem lista fixa;
//   • NADA CASOU, OU CASOU COM MAIS DE UM: `null`, e a página mostra o seletor. Nunca o primeiro da
//     lista;
//   • o nome exibido é o de mercado: o do pai, sem o sufixo da divisão.

import {
  empreendimentoPorId,
  type GrupoDaRegua,
  grupoPeloId,
  type ReguaDoCadastro,
} from "@/lib/hercules/regua-do-cadastro";

const PREFIXO_DO_GRUPO = "group:";

export type EmpreendimentoDoPainel = {
  /** Quantas CADs o Apolo tem para ele. Zero é possível: pode ter só imobiliária credenciada. */
  cads: number;
  /** O que vai no link (`?emp=`): o id do C2X do simples, ou `group:<chave>` do grupo. Não muda com renome. */
  chave: string;
  /**
   * Os ids do C2X que compõem o empreendimento: o pai e as divisões no grupo, ele mesmo no simples.
   * Numéricos: são os que as abas de assinatura e sinal pedem ao C2X.
   */
  ids: number[];
  /** Os ids como a esteira e os vínculos guardam: os numéricos em texto e o `group:<chave>`. */
  idsGravados: string[];
  imobiliarias: number;
  nome: string;
  /** Os slugs que abrem este empreendimento: o do nome de hoje e os de todo nome que ele já teve. */
  apelidos: string[];
  /** O slug do nome de hoje (o primeiro dos apelidos). */
  slug: string;
};

export type LinhaDaEsteiraDoPainel = { empreendimento: null | string; enterprise_id: null | string };

export type VinculoDoPainel = {
  entity_id: string;
  label: null | string;
  metadata: null | { enterpriseId?: number | string };
};

export type EntradaDaLista = {
  esteira: readonly LinhaDaEsteiraDoPainel[];
  /** Entidades com o papel de imobiliária: só elas contam como imobiliária credenciada. */
  ehImobiliaria: ReadonlySet<string>;
  /** Nomes do C2X por id: é deles que saíam os slugs dos links que já circulam. */
  nomesDoC2x: ReadonlyMap<number, { code: string; name: string }>;
  /** Nomes anteriores do C2X por id (retrato do vigia, F3). Opcional: sem a 0201 vem vazio. */
  nomesAnteriores?: ReadonlyMap<string, readonly string[]>;
  /** A régua do cadastro (F1). `null` sem cadastro: aí nada agrupa além do id, e o aviso é de quem chama. */
  regua: null | ReguaDoCadastro;
  vinculos: readonly VinculoDoPainel[];
};

export function slugDoNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const limpo = (v: unknown) => String(v ?? "").trim();
const ehNumerico = (v: string) => /^[0-9]+$/.test(v);

/** O grupo da régua a que o id gravado pertence (o próprio `group:`, uma divisão ou o pai), ou null. */
function grupoDoId(regua: null | ReguaDoCadastro, id: string): GrupoDaRegua | null {
  if (!regua) return null;
  if (id.toLowerCase().startsWith(PREFIXO_DO_GRUPO)) return grupoPeloId(regua, id);
  const resposta = empreendimentoPorId(regua, id);
  if (!resposta?.chaveDoGrupo) return null;
  return regua.grupos.find((grupo) => grupo.chave === resposta.chaveDoGrupo) ?? null;
}

type Esqueleto = { chave: string; ids: string[]; nome: string; nomesConhecidos: string[] };

/** O empreendimento do painel a que o id gravado pertence: o grupo inteiro, ou ele mesmo. */
function esqueletoDoId(entrada: EntradaDaLista, id: string, rotulo: null | string): Esqueleto {
  const grupo = grupoDoId(entrada.regua, id);
  if (grupo) {
    const ids = [
      ...new Set(
        [grupo.pai.c2xEnterpriseId, ...grupo.divisoes.map((divisao) => divisao.c2xEnterpriseId)]
          .map(limpo)
          .filter(Boolean),
      ),
    ];
    return {
      chave: grupo.id,
      ids: [...ids, grupo.id],
      nome: grupo.nomeDeMercado || grupo.chave,
      nomesConhecidos: [grupo.chave, grupo.pai.nome, ...grupo.divisoes.map((divisao) => divisao.nome)],
    };
  }

  const daRegua = entrada.regua ? empreendimentoPorId(entrada.regua, id) : null;
  const doC2x = ehNumerico(id) ? entrada.nomesDoC2x.get(Number(id))?.name : undefined;
  const semPrefixo = id.toLowerCase().startsWith(PREFIXO_DO_GRUPO) ? id.slice(PREFIXO_DO_GRUPO.length) : "";
  return {
    chave: id,
    ids: [id],
    nome: daRegua?.nomeDeMercado || doC2x || rotulo || semPrefixo || `Empreendimento ${id}`,
    nomesConhecidos: [daRegua?.nome ?? "", daRegua?.nomeDeMercado ?? "", semPrefixo],
  };
}

/**
 * Os empreendimentos do seletor: tem CAD no Apolo OU tem imobiliária credenciada (a regra do Lucas,
 * "onde está acontecendo venda"), agrupados pelo cadastro. Ordem: mais CADs, mais imobiliárias, nome.
 */
export function montarListaDoPainel(entrada: EntradaDaLista): EmpreendimentoDoPainel[] {
  const cadsPorId = new Map<string, number>();
  const rotulosPorId = new Map<string, Set<string>>();
  const guardarRotulo = (id: string, rotulo: unknown) => {
    const texto = limpo(rotulo);
    if (!texto) return;
    rotulosPorId.set(id, (rotulosPorId.get(id) ?? new Set()).add(texto));
  };

  for (const linha of entrada.esteira) {
    const id = limpo(linha.enterprise_id);
    if (!id) continue;
    cadsPorId.set(id, (cadsPorId.get(id) ?? 0) + 1);
    guardarRotulo(id, linha.empreendimento);
  }

  // ⚠️ O vínculo `empreendimento` NÃO É SÓ DE IMOBILIÁRIA (prospect e corretor usam o mesmo tipo). Só
  // quem tem o PAPEL conta; os outros ainda dão rótulo e põem o empreendimento no seletor.
  const imobsPorId = new Map<string, Set<string>>();
  const comVinculo = new Set<string>();
  for (const vinculo of entrada.vinculos) {
    const id = limpo(vinculo.metadata?.enterpriseId);
    if (!id) continue;
    comVinculo.add(id);
    guardarRotulo(id, vinculo.label);
    if (!entrada.ehImobiliaria.has(vinculo.entity_id)) continue;
    imobsPorId.set(id, (imobsPorId.get(id) ?? new Set()).add(vinculo.entity_id));
  }

  const porChave = new Map<string, { esqueleto: Esqueleto }>();
  for (const id of new Set([...cadsPorId.keys(), ...comVinculo])) {
    const rotulo = [...(rotulosPorId.get(id) ?? [])][0] ?? null;
    const esqueleto = esqueletoDoId(entrada, id, rotulo);
    if (!porChave.has(esqueleto.chave)) porChave.set(esqueleto.chave, { esqueleto });
  }

  const lista: EmpreendimentoDoPainel[] = [];
  for (const { esqueleto } of porChave.values()) {
    let cads = 0;
    const imobs = new Set<string>();
    const nomes = new Set<string>([esqueleto.nome, ...esqueleto.nomesConhecidos]);
    for (const id of esqueleto.ids) {
      cads += cadsPorId.get(id) ?? 0;
      for (const entityId of imobsPorId.get(id) ?? []) imobs.add(entityId);
      for (const rotulo of rotulosPorId.get(id) ?? []) nomes.add(rotulo);
      if (ehNumerico(id)) {
        const doC2x = entrada.nomesDoC2x.get(Number(id))?.name;
        if (doC2x) nomes.add(doC2x);
      }
      for (const anterior of entrada.nomesAnteriores?.get(id) ?? []) nomes.add(anterior);
    }

    const slug = slugDoNome(esqueleto.nome);
    const apelidos = [slug, ...[...nomes].map(slugDoNome)].filter((s, i, todos) => s && todos.indexOf(s) === i);
    lista.push({
      apelidos,
      cads,
      chave: esqueleto.chave,
      ids: esqueleto.ids.filter(ehNumerico).map(Number),
      idsGravados: esqueleto.ids,
      imobiliarias: imobs.size,
      nome: esqueleto.nome,
      slug,
    });
  }

  return lista.sort(
    (a, b) => b.cads - a.cads || b.imobiliarias - a.imobiliarias || a.nome.localeCompare(b.nome),
  );
}

/**
 * O empreendimento do `?emp=`, ou `null` (a página mostra o seletor). Na ordem:
 *   1. a chave do link novo (o id, ou `group:<chave>` sem caixa nem acento);
 *   2. um id do C2X que o empreendimento contém (o link de uma divisão abre o empreendimento inteiro);
 *   3. o apelido (slug de um nome que ele já teve). Se mais de um casar, vence quem tem o slug de
 *      hoje igual; empate continua `null`.
 * ⚠️ NUNCA O PRIMEIRO DA LISTA. Abrir outro empreendimento expõe nome de cliente de outra carteira.
 */
export function acharNaLista(
  lista: readonly EmpreendimentoDoPainel[],
  pedido: null | string | undefined,
): EmpreendimentoDoPainel | null {
  const texto = limpo(pedido);
  if (!texto) return null;

  const porChave = lista.find((item) => item.chave === texto);
  if (porChave) return porChave;

  if (texto.toLowerCase().startsWith(PREFIXO_DO_GRUPO)) {
    const alvo = slugDoNome(texto.slice(PREFIXO_DO_GRUPO.length));
    return lista.find((item) => item.chave.toLowerCase().startsWith(PREFIXO_DO_GRUPO) &&
      slugDoNome(item.chave.slice(PREFIXO_DO_GRUPO.length)) === alvo) ?? null;
  }

  if (ehNumerico(texto)) {
    return lista.find((item) => item.ids.includes(Number(texto))) ?? null;
  }

  const alvo = slugDoNome(texto);
  if (!alvo) return null;
  const candidatos = lista.filter((item) => item.apelidos.includes(alvo));
  if (candidatos.length === 1) return candidatos[0] ?? null;
  const pelosDeHoje = candidatos.filter((item) => item.slug === alvo);
  return pelosDeHoje.length === 1 ? (pelosDeHoje[0] ?? null) : null;
}
