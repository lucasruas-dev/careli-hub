// O EMPREENDIMENTO DE UM TERMO DE BUSCA, EM IDS (PAN-124, fatia F6). Puro: sem banco e sem rede.
//
// POR QUE EXISTE. A CACÁ, o relatório diário às imobiliárias e as rotas do Asana recebem o empreendimento
// como TEXTO ("Vale do Ouro", "Residencial Villa Paris", "VOC") e o casavam por `ilike '%texto%'` contra
// `apolo_esteira.empreendimento`, que é o texto GRAVADO no dia da CAD. Medido em 01/10/2026: 37 ids
// aparecem na esteira com 45 grafias diferentes. Quando o nome mudar de fonte (F7) ou for renomeado
// (F10), o texto novo não casa com o gravado, e as CADs somem do relatório sem erro. A esteira tem o
// `enterprise_id` em 849 de 849 linhas: o termo vira ids, e o filtro é `enterprise_id in (...)`.
//
// A REGRA:
//   • `group:<x>` e id numérico resolvem direto;
//   • o termo casa com um nome conhecido do id (o do cadastro, o de mercado, a sigla, o nome e a sigla
//     do C2X, a chave do grupo) NOS DOIS SENTIDOS, sem acento nem caixa: o nome contém o termo (era o
//     `ilike`) ou o termo contém o nome em palavras inteiras ("Residencial Villa Paris" acha o "Villa
//     Paris" do cadastro). Menos de 3 letras: só igual (ver `casa`);
//   • o id que casou e pertence a um grupo traz o GRUPO INTEIRO: o pai, todas as divisões e o
//     `group:<chave>` (o mercado vê UM empreendimento; a CAD pode estar gravada em qualquer um deles);
//   • nada casou: `null`, e quem chama volta ao texto, como antes.

import {
  empreendimentoPorId,
  type GrupoDaRegua,
  grupoPeloId,
  type ReguaDoCadastro,
} from "@/lib/hercules/regua-do-cadastro";

const PREFIXO_DO_GRUPO = "group:";

export type EmpreendimentoDoTermo = {
  /** Os ids como a esteira e os vínculos guardam: os do C2X em texto e o `group:<chave>`. */
  ids: string[];
  /** Só os do C2X, numéricos: para consulta ao legado (`e.id in (...)`). */
  idsDoC2x: number[];
  /** O nome de mercado, quando o termo cai num empreendimento só; senão, o próprio termo. */
  nome: string;
};

export type FontesDoTermo = {
  /** Nome e sigla do C2X por id (inclui os ids sem cadastro, como o 30). */
  nomesDoC2x: ReadonlyMap<number, { code: string; name: string }>;
  regua: null | ReguaDoCadastro;
};

export function normalizarTermo(valor: unknown): string {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Como o nome casa com o termo:
 *   • "forte": igual, ou o nome CONTÉM o termo (o `ilike '%termo%'` de antes; pedaço de palavra vale);
 *   • "fraco": o termo contém o nome como PALAVRAS INTEIRAS ("residencial villa paris" contém "villa
 *     paris"). Pedaço de palavra não vale: a sigla "val" (Vista Alegre) não casa com "valeria".
 * O fraco só entra quando NADA casa forte: senão "Milenium Mall" traria também o "Milenium", que é
 * outro empreendimento (medido em 01/10/2026, paridade real). Menos de 3 letras: só igual.
 */
function comoCasa(nome: string, termo: string): "forte" | "fraco" | null {
  if (!nome || !termo) return null;
  if (nome === termo) return "forte";
  if (nome.length < 3 || termo.length < 3) return null;
  if (nome.includes(termo)) return "forte";
  return ` ${termo} `.includes(` ${nome} `) ? "fraco" : null;
}


function idsDoGrupo(grupo: GrupoDaRegua): string[] {
  const ids = [grupo.pai.c2xEnterpriseId, ...grupo.divisoes.map((divisao) => divisao.c2xEnterpriseId)]
    .map((id) => String(id ?? "").trim())
    .filter(Boolean);
  return [...new Set([...ids, grupo.id])];
}

/** O grupo a que o id pertence (ele é divisão ou pai), ou null. */
function grupoDoId(regua: null | ReguaDoCadastro, id: string): GrupoDaRegua | null {
  if (!regua) return null;
  const resposta = empreendimentoPorId(regua, id);
  if (!resposta?.chaveDoGrupo) return null;
  return regua.grupos.find((grupo) => grupo.chave === resposta.chaveDoGrupo) ?? null;
}

/** O id e, se ele pertence a um grupo, o grupo inteiro. */
function comOGrupo(fontes: FontesDoTermo, id: string): { grupo: GrupoDaRegua | null; ids: string[] } {
  const grupo = grupoDoId(fontes.regua, id);
  return grupo ? { grupo, ids: idsDoGrupo(grupo) } : { grupo: null, ids: [id] };
}

function nomeDoId(fontes: FontesDoTermo, id: string): string {
  const daRegua = fontes.regua ? empreendimentoPorId(fontes.regua, id) : null;
  return daRegua?.nomeDeMercado || fontes.nomesDoC2x.get(Number(id))?.name || id;
}

function montar(fontes: FontesDoTermo, ids: string[], nome: string): EmpreendimentoDoTermo {
  const unicos = [...new Set(ids)];
  return {
    ids: unicos,
    idsDoC2x: unicos.filter((id) => /^[0-9]+$/.test(id)).map(Number),
    nome,
  };
}

/** Os ids do empreendimento que o termo nomeia, ou `null` se nada casar (quem chama volta ao texto). */
export function resolverTermoDeEmpreendimento(
  termo: unknown,
  fontes: FontesDoTermo,
): EmpreendimentoDoTermo | null {
  const cru = String(termo ?? "").trim();
  if (!cru) return null;

  if (cru.toLowerCase().startsWith(PREFIXO_DO_GRUPO)) {
    const grupo = fontes.regua ? grupoPeloId(fontes.regua, cru) : null;
    return grupo ? montar(fontes, idsDoGrupo(grupo), grupo.nomeDeMercado || grupo.chave) : null;
  }

  if (/^[0-9]+$/.test(cru)) {
    const conhecido = fontes.nomesDoC2x.has(Number(cru)) || (fontes.regua && empreendimentoPorId(fontes.regua, cru));
    if (!conhecido) return null;
    const { grupo, ids } = comOGrupo(fontes, cru);
    return montar(fontes, ids, grupo ? grupo.nomeDeMercado || grupo.chave : nomeDoId(fontes, cru));
  }

  const alvo = normalizarTermo(cru);
  if (!alvo) return null;

  // Os nomes conhecidos de cada id: cadastro (nome, mercado, sigla) e C2X (nome, sigla).
  const nomesPorId = new Map<string, string[]>();
  const anotar = (id: string, ...nomes: unknown[]) => {
    const lista = nomesPorId.get(id) ?? [];
    for (const nome of nomes) {
      const n = normalizarTermo(nome);
      if (n) lista.push(n);
    }
    nomesPorId.set(id, lista);
  };
  for (const [id, linha] of fontes.regua?.porId ?? []) anotar(id, linha.nome, linha.nomeDeMercado, linha.sigla);
  for (const [id, linha] of fontes.nomesDoC2x) anotar(String(id), linha.name, linha.code);

  // Quem casa, e como: forte (igual ou contém o termo) ou fraco (o termo contém o nome).
  const fortes = new Set<string>();
  const fracos = new Set<string>();
  for (const [id, nomes] of nomesPorId) {
    const tipos = nomes.map((nome) => comoCasa(nome, alvo));
    if (tipos.includes("forte")) fortes.add(id);
    else if (tipos.includes("fraco")) fracos.add(id);
  }
  // A chave do grupo também é nome (o pai só do Panteon, LOX/PDX/RDX, não tem id do C2X).
  const gruposFortes = new Set<GrupoDaRegua>();
  const gruposFracos = new Set<GrupoDaRegua>();
  for (const grupo of fontes.regua?.grupos ?? []) {
    const tipos = [comoCasa(normalizarTermo(grupo.chave), alvo), comoCasa(normalizarTermo(grupo.nomeDeMercado), alvo)];
    if (tipos.includes("forte")) gruposFortes.add(grupo);
    else if (tipos.includes("fraco")) gruposFracos.add(grupo);
  }
  const usarFortes = fortes.size > 0 || gruposFortes.size > 0;
  const casados = usarFortes ? fortes : fracos;
  const gruposCasados = usarFortes ? gruposFortes : gruposFracos;

  const ids: string[] = [];
  const grupos = new Set<string>();
  const simples = new Set<string>();
  for (const id of casados) {
    const resolvido = comOGrupo(fontes, id);
    ids.push(...resolvido.ids);
    if (resolvido.grupo) grupos.add(resolvido.grupo.id);
    else simples.add(id);
  }
  for (const grupo of gruposCasados) {
    ids.push(...idsDoGrupo(grupo));
    grupos.add(grupo.id);
  }

  if (ids.length === 0) return null;

  let nome = cru;
  if (grupos.size === 1 && simples.size === 0) {
    const grupo = fontes.regua?.grupos.find((g) => grupos.has(g.id));
    nome = grupo?.nomeDeMercado || grupo?.chave || cru;
  } else if (grupos.size === 0 && simples.size === 1) {
    nome = nomeDoId(fontes, [...simples][0] ?? "");
  }
  return montar(fontes, ids, nome);
}
