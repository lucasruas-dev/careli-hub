// O VÍNCULO DA UNIDADE COM A DIVISÃO E COM A CATEGORIA — a régua pura, sem banco e sem rede.
//
// Lucas (21/09/2026): *"eu preciso também vincular as unidades no filho, categoria (quando
// existir), ou seja, eu ainda não tenho esse fluxo pronto e preciso"*. E em 15/09/2026, sobre COMO
// isso acontece na prática: *"vai ocorrer das duas formas, normalmente vamos subir em massa essa
// configuração na importação de unidades, mas teremos cenários que precisamos cadastrar uma unidade
// nova e apontar essa estrutura, ou até mesmo atualizar"*.
//
// São TRÊS caminhos, e os três caem nesta régua:
//   • planilha (importação de vínculo): casa por quadra + lote e devolve o que casou e o que não;
//   • unitário (a ficha da unidade): é o caminho em massa com um item só;
//   • em massa (quadra, faixa de lotes, filtro): escolhe muito de uma vez, com prévia antes.
//
// ⚠️ O ALCANCE POR TERRENO NÃO MORA AQUI, E SIM EM `vinculo-da-unidade.ts` (`planoDeVinculo`,
// `chaveDoTerreno`). Este arquivo é a camada de CIMA: quem escolher, o que vai mudar e o que é
// perigoso demais para deixar passar. Duas réguas para "quais linhas são o mesmo chão" seria
// exatamente a divergência pai × filho que a migration 0161 existe para acabar.
//
// ⚠️ A CATEGORIA MORA NO PAI E CARIMBA UNIDADE DE FILHO, DE PROPÓSITO. Medido em 21/09/2026: as 907
// unidades com categoria apontam para as duas categorias cadastradas no Lagoa Bonita pai (31), e
// 412 delas são linhas das glebas (LBR 27, LBP 32, LBF 33). Por isso "categoria compatível" aqui é
// *da mesma FAMÍLIA*, e nunca "do mesmo enterprise_id": a segunda leitura invalidaria o cadastro
// que já existe e está certo.
//
// ⚠️ MUDAR A CATEGORIA NÃO TRAVA POR VENDA ANDANDO (decisão do Lucas, 15/09/2026: *"não muda nada
// o que já está venda andando"*). MUDAR A DIVISÃO TRAVA, e é outro assunto: a divisão decide quem
// enxerga o lote no portal, qual minuta sai, qual comissão vale e qual masterplan acha o lote.
// Ver `planoDeMudancaDeDivisao`.

import {
  chaveDoTerreno,
  comparavel,
  identidadeDoTerreno,
  type LinhaParaVincular,
  planoDeVinculo,
} from "./vinculo-da-unidade";

/** A linha de `hercules_unidades` como esta régua a enxerga. Só o que decide. */
export type UnidadeDoUniverso = LinhaParaVincular & {
  codigo?: null | string;
  /** 0161: preenchido = é o registro antigo do terreno, e quem vende é a gleba. */
  espelho_de?: null | string;
  /** `true` = há proposta ou reserva viva nesta linha. Ausente = ninguém perguntou. */
  temVendaViva?: boolean;
  situacao?: null | string;
};

/** As situações em que o cadastro ainda manda na unidade. Fora delas, a venda manda. */
const SITUACOES_LIVRES = new Set(["bloqueada", "disponivel"]);

/** O nome humano de uma divisão (uma linha de `hercules_empreendimentos`). */
export type DivisaoDaFamilia = {
  /** O `c2x_enterprise_id`: é ele que a unidade grava em `enterprise_id`. */
  enterpriseId: string;
  codigo: string;
  nome: string;
  /** `true` = é o pai da família. */
  pai: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// FAIXA DE LOTES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "do 01 ao 40" digitado como o operador fala: `1-40`, `01 a 40`, `1-40, 45, 50-52`.
 *
 * ⚠️ COMPARA COMO NÚMERO QUANDO OS DOIS LADOS SÃO NÚMERO, e como texto quando não são. O lote da
 * Lagoa Bonita é "01" no filho e "0101" no pai (zero à esquerda não distingue lote, ver
 * `chaveDoTerreno`); uma faixa comparada como texto deixaria "9" fora de "1-40". Já o lote "12A"
 * não tem posição numa faixa: ele só entra quando escrito por extenso na lista.
 *
 * ⚠️ FAIXA QUE NÃO DÁ PARA LER NÃO VIRA "PEGA TUDO". `erro` preenchido e `combina` sempre falso:
 * uma faixa mal digitada que selecionasse o loteamento inteiro é exatamente o acidente que a prévia
 * existe para impedir, e silêncio aqui seria o caminho mais curto até ele.
 */
export type FaixaDeLotes = {
  /** Nulo = a faixa está boa (ou vazia). */
  erro: null | string;
  /** `true` = não filtra nada: o operador não digitou faixa. */
  vazia: boolean;
  combina: (lote: null | string) => boolean;
};

/** "0101" → 101; "12A" → null. A mesma limpeza que `chaveDoTerreno` faz no lote. */
function numeroDoLote(valor: null | string | undefined): null | number {
  const limpo = String(valor ?? "").trim();
  if (!/^\d+$/.test(limpo)) return null;
  return Number.parseInt(limpo, 10);
}

/** O lote como o filtro compara: maiúsculo, sem espaço, sem zero à esquerda. */
function loteComparavel(valor: null | string | undefined): string {
  return String(valor ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/^0+(?=\d)/, "");
}

export function lerFaixaDeLotes(bruto: null | string | undefined): FaixaDeLotes {
  const cru = String(bruto ?? "").trim();
  if (!cru) return { combina: () => true, erro: null, vazia: true };

  const faixas: { de: number; ate: number }[] = [];
  const avulsos = new Set<string>();

  for (const pedaco of cru.split(/[,;]+/)) {
    const parte = pedaco.trim();
    if (!parte) continue;

    // "1-40", "1 a 40", "1 até 40", "1..40" — o operador escreve de todas essas formas.
    //
    // ⚠️ A ORDEM DAS ALTERNATIVAS IMPORTA: com o "a" solto na frente, "1 até 40" casava no "a" de
    // "até" e o lado direito virava "té 40" — a faixa inteira caía em "não entendi".
    const intervalo = /^(.+?)\s*(?:-|–|\.\.|até|ate|a)\s*(.+)$/i.exec(parte);
    if (intervalo) {
      const de = numeroDoLote(intervalo[1]?.trim());
      const ate = numeroDoLote(intervalo[2]?.trim());
      if (de === null || ate === null) {
        return {
          combina: () => false,
          erro: `Não entendi a faixa "${parte}". Use números, como 1-40.`,
          vazia: false,
        };
      }
      faixas.push({ ate: Math.max(de, ate), de: Math.min(de, ate) });
      continue;
    }

    avulsos.add(loteComparavel(parte));
  }

  if (faixas.length === 0 && avulsos.size === 0) {
    return { combina: () => true, erro: null, vazia: true };
  }

  return {
    combina: (lote) => {
      const texto = loteComparavel(lote);
      if (avulsos.has(texto)) return true;
      const numero = numeroDoLote(texto);
      if (numero === null) return false;
      return faixas.some((f) => numero >= f.de && numero <= f.ate);
    },
    erro: null,
    vazia: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// FILTRO DA SELEÇÃO EM MASSA
// ─────────────────────────────────────────────────────────────────────────────

/** Como o operador recorta a lista antes de escolher. Campo vazio = não filtra. */
export type FiltroDeUnidades = {
  /**
   * O estado da categoria de hoje:
   *   • `nesta`  = já aponta para a categoria que está sendo montada;
   *   • `noutra` = aponta para outra (é a troca, e é a que mais merece prévia);
   *   • `sem`    = não aponta para nenhuma.
   */
  categoria?: "nesta" | "noutra" | "qualquer" | "sem";
  /** Os `enterprise_id` que entram. Vazio = a família inteira. */
  divisoes?: readonly string[];
  /** A faixa de lotes, como o operador digitou. */
  faixa?: null | string;
  /** As quadras que entram. Vazio = todas. */
  quadras?: readonly string[];
  /** As situações que entram (`disponivel`, `reservado`, …). Vazio = todas. */
  situacoes?: readonly string[];
  /** Busca livre por quadra, lote ou código. */
  termo?: null | string;
};

/**
 * A lista que o operador vê, já recortada.
 *
 * ⚠️ O FILTRO NÃO ESCOLHE NINGUÉM. Ele só encolhe a lista; a seleção continua sendo um ato do
 * operador. "Filtrar e aplicar" sem passar pela marcação é o caminho para carimbar 907 lotes com um
 * clique e descobrir depois — a prévia existe justamente para o passo entre um e outro.
 */
export function filtrarUnidades<T extends UnidadeDoUniverso>(
  universo: readonly T[],
  filtro: FiltroDeUnidades,
  contexto?: { categoriaAlvo?: null | string },
): T[] {
  const faixa = lerFaixaDeLotes(filtro.faixa);
  if (faixa.erro) return [];

  const divisoes = new Set((filtro.divisoes ?? []).map((d) => String(d).trim()).filter(Boolean));
  const quadras = new Set(
    (filtro.quadras ?? []).map((q) => String(q).trim().toUpperCase()).filter(Boolean),
  );
  const situacoes = new Set(
    (filtro.situacoes ?? []).map((s) => String(s).trim().toLowerCase()).filter(Boolean),
  );
  const termo = comparavel(filtro.termo);
  const alvo = String(contexto?.categoriaAlvo ?? "").trim() || null;

  return universo.filter((u) => {
    if (divisoes.size > 0 && !divisoes.has(String(u.enterprise_id ?? ""))) return false;
    if (quadras.size > 0 && !quadras.has(String(u.quadra ?? "").trim().toUpperCase())) return false;
    if (situacoes.size > 0 && !situacoes.has(String(u.situacao ?? "").trim().toLowerCase())) return false;
    if (!faixa.vazia && !faixa.combina(u.lote)) return false;

    if (filtro.categoria && filtro.categoria !== "qualquer") {
      const atual = String(u.categoria_id ?? "").trim() || null;
      if (filtro.categoria === "sem" && atual) return false;
      if (filtro.categoria === "nesta" && atual !== alvo) return false;
      if (filtro.categoria === "noutra" && (!atual || atual === alvo)) return false;
    }

    if (termo) {
      const texto = comparavel(`${u.quadra ?? ""} ${u.lote ?? ""} ${u.codigo ?? ""} ${u.apartamento ?? ""}`);
      if (!texto.includes(termo)) return false;
    }

    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// A PRÉVIA DA CATEGORIA
// ─────────────────────────────────────────────────────────────────────────────

export type PreviaDoVinculo = {
  /** As linhas que vão receber o carimbo, gêmeas incluídas. Vazio = não há o que gravar. */
  ids: string[];
  /** Terrenos que já apontam para a categoria alvo: o clique neles não muda nada. */
  jaEstao: number;
  /** Linhas que entram por serem gêmeas de uma escolhida, e não por escolha direta. */
  porParentesco: number;
  /** Terrenos que hoje não têm categoria nenhuma. */
  semCategoria: number;
  /** Terrenos escolhidos, contando o chão e não a linha. */
  terrenos: number;
  /**
   * De qual categoria cada terreno está saindo, pelo NOME.
   *
   * ⚠️ PELO NOME, E NUNCA PELO ID. Esta lista existe para a frase da prévia ("42 lotes saem de
   * Loteamento"), e uuid numa tela de conferência é o mesmo que não mostrar nada.
   */
  trocamDeCategoria: { de: string; terrenos: number }[];
  /**
   * Terrenos escolhidos que têm venda andando, pelo rótulo.
   *
   * ⚠️ AVISO, E NÃO TRAVA (decisão do Lucas, 15/09/2026: *"não muda nada o que já está venda
   * andando"*). A proposta congela as condições quando nasce, então trocar a categoria não altera
   * contrato nenhum — muda o que será oferecido nas PRÓXIMAS simulações. A prévia diz o número
   * porque quem carimba 400 lotes merece saber quantos já estão vendidos.
   */
  vendaAndando: number;
};

/**
 * O que vai acontecer se o operador confirmar. Não grava nada.
 *
 * ⚠️ QUEM JÁ ESTÁ NA CATEGORIA SAI DO `ids`. Regravar o mesmo valor mexeria em `atualizado_em` e no
 * carimbo de quem vinculou de 907 linhas sem que nada tivesse mudado — é o mesmo estrago que as
 * migrations 0161 e 0162 fizeram em 710 linhas e que o comentário da 0163 documenta.
 */
export function previaDoVinculo(
  escolhidos: readonly string[],
  universo: readonly UnidadeDoUniverso[],
  contexto: {
    categoriaAlvo: null | string;
    /** O nome de cada categoria, por id. Falta = a prévia diz "outra categoria". */
    nomeDaCategoria?: ReadonlyMap<string, string>;
  },
): PreviaDoVinculo {
  const plano = planoDeVinculo(escolhidos, universo);
  const porId = new Map(universo.map((u) => [u.id, u]));
  const alvo = String(contexto.categoriaAlvo ?? "").trim() || null;

  const daLinha = (id: string): undefined | UnidadeDoUniverso => porId.get(id);

  // Um terreno por IDENTIDADE: a contagem da prévia fala de chão, não de registro — e "o mesmo
  // chão" é o que a 0161 liga por `espelho_de`, nunca duas glebas vivas com o mesmo número de lote.
  // Ver `identidadeDoTerreno`.
  const porTerreno = new Map<string, UnidadeDoUniverso[]>();
  for (const id of plano.ids) {
    const linha = daLinha(id);
    if (!linha) continue;
    const chave = identidadeDoTerreno(linha);
    const lista = porTerreno.get(chave) ?? [];
    lista.push(linha);
    porTerreno.set(chave, lista);
  }

  let jaEstao = 0;
  let semCategoria = 0;
  let vendaAndando = 0;
  const saindoDe = new Map<string, number>();
  const idsQueMudam: string[] = [];

  for (const linhas of porTerreno.values()) {
    // ⚠️ O TERRENO SÓ "JÁ ESTÁ" QUANDO TODAS AS LINHAS DELE JÁ ESTÃO. Pai carimbado e gleba sem
    // categoria é justamente a divergência que o vínculo por terreno existe para consertar: contar
    // como "já está" deixaria o conserto de fora.
    const todasNoAlvo = alvo !== null && linhas.every((l) => String(l.categoria_id ?? "") === alvo);
    if (todasNoAlvo) {
      jaEstao += 1;
      continue;
    }
    if (alvo === null && linhas.every((l) => !l.categoria_id)) {
      jaEstao += 1;
      continue;
    }

    const atual = linhas.map((l) => String(l.categoria_id ?? "").trim()).find(Boolean) ?? null;
    if (!atual) semCategoria += 1;
    else {
      const nome = contexto.nomeDaCategoria?.get(atual) ?? "outra categoria";
      saindoDe.set(nome, (saindoDe.get(nome) ?? 0) + 1);
    }

    if (linhas.some((l) => l.temVendaViva || !SITUACOES_LIVRES.has(String(l.situacao ?? "").toLowerCase()))) {
      vendaAndando += 1;
    }

    for (const l of linhas) idsQueMudam.push(l.id);
  }

  const escolhida = new Set(escolhidos.map((i) => String(i).trim()).filter(Boolean));

  return {
    ids: idsQueMudam,
    jaEstao,
    porParentesco: idsQueMudam.filter((id) => !escolhida.has(id)).length,
    semCategoria,
    terrenos: plano.terrenos,
    trocamDeCategoria: [...saindoDe.entries()]
      .map(([de, terrenos]) => ({ de, terrenos }))
      .sort((a, b) => b.terrenos - a.terrenos || a.de.localeCompare(b.de, "pt-BR")),
    vendaAndando,
  };
}

/**
 * A categoria escolhida serve para esta unidade?
 *
 * ⚠️ A RÉGUA É A FAMÍLIA, NUNCA O `enterprise_id` IGUAL. A categoria nasce no PAI e vale para as
 * divisões dele (`empreendimentoDasCategorias`, e as 907 unidades de hoje são a prova viva). Exigir
 * igualdade recusaria o cadastro que existe e está certo; não exigir nada deixaria carimbar um lote
 * do Vale do Ouro com a categoria da Lagoa Bonita, e aí o contrato do lote sai da minuta errada.
 */
export function categoriaCompativel(
  categoria: { enterpriseId: string; nome: string },
  unidade: Pick<UnidadeDoUniverso, "enterprise_id">,
  familia: readonly string[],
): { motivo: string; ok: false } | { ok: true } {
  const daUnidade = String(unidade.enterprise_id ?? "").trim();
  const daCategoria = String(categoria.enterpriseId ?? "").trim();
  const naFamilia = new Set(familia.map((f) => String(f).trim()).filter(Boolean));

  if (!daUnidade) {
    return { motivo: "Esta unidade está sem empreendimento no cadastro.", ok: false };
  }
  if (naFamilia.has(daUnidade) && naFamilia.has(daCategoria)) return { ok: true };

  return {
    motivo: `A categoria "${categoria.nome}" é de outro empreendimento e não vale para esta unidade.`,
    ok: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A DIVISÃO — o vínculo caro
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ⚠️ MUDAR A DIVISÃO DE UMA UNIDADE MUDA CINCO COISAS DE UMA VEZ, e nenhuma delas é visível na
 * tela onde o clique acontece (medido em 21/09/2026):
 *
 *   1. QUEM ENXERGA. `donoNoPanteon` (lib/apolo/incorporador/escopo.ts) decide o alcance do portal
 *      por `hercules_unidades.enterprise_id`. Mover um lote do VOL para o VOC tira ele do Lino e dá
 *      para a Cecílio.
 *   2. QUAL CONTRATO SAI. A minuta é buscada pelo `enterprise_id` da unidade.
 *   3. A COMISSÃO. A divisão da unidade vem primeiro e o pai só completa (medido em 416 vendas).
 *   4. O CÓDIGO FICA MENTINDO. `codigo` é identidade e não muda: um lote movido do LAB para o LBR
 *      continua `LABC0101` dentro do LBR, e o masterplan casa `inkscape:label` com o código.
 *   5. O GÊMEO. Em LAB e VLO o mesmo terreno tem duas linhas; mover a do pai para a gleba criaria
 *      duas linhas do mesmo chão DENTRO da mesma gleba, com códigos diferentes e nada as ligando.
 *
 * Por isso aqui tudo o que é reversível vira AVISO e tudo o que é irreversível vira RECUSA, com a
 * frase do motivo. As FKs para `hercules_unidades` são por `id`, então mover não quebra integridade
 * nenhuma: quebra sentido, e sentido o banco não defende.
 */
export type PlanoDeDivisao = {
  /** O que o operador precisa ler antes de confirmar. Não impede. */
  avisos: string[];
  /** As linhas que de fato mudam de divisão. */
  mover: { codigo: string; de: string; para: string; unidadeId: string }[];
  /** Escolhidas que já estão no destino: não há o que fazer, e não é erro. */
  jaNoDestino: number;
  /** Quem não vai, e por quê. Uma frase por unidade. */
  recusas: { motivo: string; rotulo: string; unidadeId: string }[];
};

function rotuloDaLinha(u: UnidadeDoUniverso): string {
  const codigo = String(u.codigo ?? "").trim();
  if (codigo) return codigo;
  const quadra = String(u.quadra ?? "").trim();
  const lote = String(u.lote ?? "").trim();
  return quadra && lote ? `Quadra ${quadra} · Lote ${lote}` : u.id;
}

export function planoDeMudancaDeDivisao(
  escolhidos: readonly string[],
  universo: readonly UnidadeDoUniverso[],
  contexto: {
    /** O `c2x_enterprise_id` de destino. */
    destino: string;
    /** As divisões da família, para nomear e para conferir que o destino é uma delas. */
    divisoes: readonly DivisaoDaFamilia[],
  },
): PlanoDeDivisao {
  const destino = String(contexto.destino ?? "").trim();
  const porId = new Map(universo.map((u) => [u.id, u]));
  const daFamilia = new Map(contexto.divisoes.map((d) => [d.enterpriseId, d]));
  const nomeDe = (id: string): string => daFamilia.get(id)?.nome ?? id;

  const escolhida = [...new Set(escolhidos.map((i) => String(i).trim()).filter(Boolean))];
  const plano: PlanoDeDivisao = { avisos: [], jaNoDestino: 0, mover: [], recusas: [] };

  const noDestino = new Map<string, UnidadeDoUniverso>();
  const codigosNoDestino = new Set<string>();
  for (const u of universo) {
    if (String(u.enterprise_id ?? "") !== destino) continue;
    noDestino.set(chaveDoTerreno(u), u);
    codigosNoDestino.add(String(u.codigo ?? "").trim().toUpperCase());
  }

  if (!destino || !daFamilia.has(destino)) {
    for (const id of escolhida) {
      const linha = porId.get(id);
      plano.recusas.push({
        motivo: "A divisão escolhida não é deste empreendimento.",
        rotulo: linha ? rotuloDaLinha(linha) : id,
        unidadeId: id,
      });
    }
    return plano;
  }

  for (const id of escolhida) {
    const linha = porId.get(id);
    if (!linha) {
      plano.recusas.push({ motivo: "Unidade não encontrada.", rotulo: id, unidadeId: id });
      continue;
    }
    const rotulo = rotuloDaLinha(linha);
    const de = String(linha.enterprise_id ?? "").trim();
    const recusar = (motivo: string) => plano.recusas.push({ motivo, rotulo, unidadeId: id });

    if (de === destino) {
      plano.jaNoDestino += 1;
      continue;
    }

    // ⚠️ O REGISTRO ANTIGO NÃO SE MOVE. Ele é o espelho do terreno que a gleba vende (0161): movê-lo
    // criaria duas linhas do mesmo chão dentro da mesma gleba, e nada as ligaria de volta.
    if (linha.espelho_de) {
      recusar("Esta linha é o registro antigo do terreno. A divisão se acerta pela gleba que vende.");
      continue;
    }

    const situacao = String(linha.situacao ?? "").trim().toLowerCase();
    if (linha.temVendaViva) {
      recusar(
        `${rotulo} tem venda em andamento: mudar a divisão trocaria a minuta, a comissão e quem enxerga o lote no meio da negociação.`,
      );
      continue;
    }
    if (situacao && !SITUACOES_LIVRES.has(situacao)) {
      recusar(`${rotulo} está ${situacao}: a divisão só muda com a unidade livre.`);
      continue;
    }

    const chave = chaveDoTerreno(linha);
    const gemeaNoDestino = noDestino.get(chave);
    if (gemeaNoDestino && gemeaNoDestino.id !== linha.id) {
      recusar(
        `O mesmo terreno já existe em ${nomeDe(destino)} (${rotuloDaLinha(gemeaNoDestino)}). Mover criaria duas linhas do mesmo chão na mesma divisão.`,
      );
      continue;
    }

    const codigo = String(linha.codigo ?? "").trim();
    if (codigo && codigosNoDestino.has(codigo.toUpperCase())) {
      recusar(`Já existe uma unidade ${codigo} em ${nomeDe(destino)}.`);
      continue;
    }

    plano.mover.push({ codigo, de, para: destino, unidadeId: id });
  }

  if (plano.mover.length > 0) {
    const nomeDoDestino = nomeDe(destino);
    const quantos = plano.mover.length === 1 ? "1 unidade" : `${plano.mover.length} unidades`;
    plano.avisos.push(
      `${quantos} passam a ser de ${nomeDoDestino}: quem enxerga o lote no portal, a minuta do contrato e a comissão passam a ser as de lá.`,
    );
    // ⚠️ O CÓDIGO NÃO ACOMPANHA A MUDANÇA, e isso precisa estar escrito na tela. Recalcular o código
    // quebraria o masterplan, o contrato já emitido e o espelho, que casam pelo código; não
    // recalcular deixa o lote com o prefixo da divisão antiga. Das duas, a segunda é reversível.
    const amostra = plano.mover
      .map((m) => m.codigo)
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    plano.avisos.push(
      `O código continua o mesmo${amostra ? ` (${amostra}…)` : ""}: o masterplan de ${nomeDoDestino} procura o lote pelo código e não vai achá-lo até o desenho ser ajustado.`,
    );
  }

  return plano;
}

// ─────────────────────────────────────────────────────────────────────────────
// A PLANILHA DE VÍNCULO
// ─────────────────────────────────────────────────────────────────────────────
//
// ⚠️ ESTA PLANILHA NÃO CRIA UNIDADE, E É POR ISSO QUE ELA EXISTE SEPARADA DA IMPORTAÇÃO. A
// importação de unidades (`cadastrar-unidades-panteon-server.ts`) só alcança produto nascido no
// Panteon e sem filhos — ou seja, não alcança LAB, VLO, RDP, LOX, PDX nem as glebas deles, que é
// justamente onde estão as 907 unidades com categoria e as 5 famílias divididas. Para elas o que o
// Lucas pediu ("subir em massa essa configuração") é CARIMBAR o que já existe, casando por quadra e
// lote.

export type ColunaDaPlanilhaDeVinculo = {
  chave: "categoria" | "codigo" | "divisao" | "lote" | "quadra";
  exemplo: string;
  obrigatoria: boolean;
  rotulo: string;
};

export const COLUNAS_DA_PLANILHA_DE_VINCULO: readonly ColunaDaPlanilhaDeVinculo[] = [
  { chave: "quadra", exemplo: "01", obrigatoria: true, rotulo: "Quadra" },
  { chave: "lote", exemplo: "07", obrigatoria: true, rotulo: "Lote" },
  { chave: "categoria", exemplo: "Condomínio", obrigatoria: false, rotulo: "Categoria" },
  { chave: "divisao", exemplo: "LBR", obrigatoria: false, rotulo: "Divisão" },
];

/** O cabeçalho da planilha para a chave que esta régua entende. Vazio = coluna ignorada. */
export function chaveDaColunaDeVinculo(bruto: string): "" | ColunaDaPlanilhaDeVinculo["chave"] {
  const limpo = comparavel(bruto)
    .replace(/\(.*?\)/g, "")
    .replace(/[^a-z0-9]/g, "");

  if (limpo.startsWith("quadra")) return "quadra";
  if (limpo.startsWith("lote")) return "lote";
  if (limpo.startsWith("categoria")) return "categoria";
  if (limpo.startsWith("divisao") || limpo.startsWith("gleba") || limpo.startsWith("filho")) {
    return "divisao";
  }
  if (limpo.startsWith("codigo") || limpo === "unidade") return "codigo";
  return "";
}

export type LinhaDaPlanilhaDeVinculo = Partial<
  Record<ColunaDaPlanilhaDeVinculo["chave"], unknown>
>;

/**
 * Lê um CSV de vínculo.
 *
 * ⚠️ O SEPARADOR É DESCOBERTO, NÃO ASSUMIDO — a mesma régua de `lerCsvDeUnidades`: o Excel em
 * português salva com ponto e vírgula, o resto do mundo com vírgula.
 */
export function lerCsvDeVinculo(conteudo: string): LinhaDaPlanilhaDeVinculo[] {
  const semBom = conteudo.charCodeAt(0) === 0xfeff ? conteudo.slice(1) : conteudo;
  const linhas = semBom.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (linhas.length < 2) return [];

  const primeira = linhas[0] as string;
  const pontoEVirgula = (primeira.match(/;/g) ?? []).length;
  const virgula = (primeira.match(/,/g) ?? []).length;
  const separador = pontoEVirgula >= virgula ? ";" : ",";

  const cabecalho = primeira.split(separador).map((c) => chaveDaColunaDeVinculo(c));

  return linhas
    .slice(1)
    .map((linha) => {
      const celulas = linha.split(separador);
      const registro: LinhaDaPlanilhaDeVinculo = {};
      cabecalho.forEach((chave, i) => {
        if (chave) registro[chave] = (celulas[i] ?? "").trim().replace(/^"|"$/g, "");
      });
      return registro;
    })
    .filter((registro) => Object.values(registro).some((v) => String(v ?? "").trim() !== ""));
}

export type CasamentoDaPlanilha = {
  categoriaId?: null | string;
  /** Vazio = a planilha não pediu mudança de divisão nesta linha. */
  divisaoDestino?: null | string;
  /** Linha como o operador vê no Excel: a 1 é o cabeçalho. */
  linha: number;
  rotulo: string;
  unidadeId: string;
};

export type RecusaDaPlanilha = {
  linha: number;
  motivo: string;
  /** O que a planilha trazia, para a pessoa achar a linha no arquivo. */
  valor: string;
};

export type RelatorioDaPlanilhaDeVinculo = {
  casaram: CasamentoDaPlanilha[];
  naoCasaram: RecusaDaPlanilha[];
  resumo: {
    comCategoria: number;
    comDivisao: number;
    naoCasaram: number;
    semMudanca: number;
    total: number;
  };
};

/**
 * Casa cada linha da planilha com uma unidade que JÁ EXISTE, e diz o que não casou e por quê.
 *
 * ⚠️ CASA POR QUADRA + LOTE, NÃO PELO CÓDIGO. O código muda de prefixo entre os níveis (`LABC0101`
 * no pai, `LBRC0101` na gleba); a quadra e o lote são os mesmos. É a mesma chave que o vínculo por
 * terreno usa, e o operador que monta a planilha no Excel tem a quadra e o lote em mãos, não o
 * código do Panteon.
 *
 * ⚠️ E DEVOLVE UMA UNIDADE POR LINHA DA PLANILHA — a VIVA do terreno. Quem carimba os gêmeos é o
 * `planoDeVinculo` na hora de gravar; casar aqui com as duas linhas faria o relatório dizer o dobro
 * do que o operador escreveu.
 *
 * ⚠️ NOME QUE NÃO EXISTE É RECUSA DA LINHA, NUNCA "SEM CATEGORIA". Deixar passar com nulo apagaria
 * a categoria de um lote que já tinha uma, por causa de um acento digitado errado.
 */
export function casarPlanilhaDeVinculo(
  linhas: readonly LinhaDaPlanilhaDeVinculo[],
  contexto: {
    categorias: readonly { enterpriseId: string; id: string; nome: string }[];
    divisoes: readonly DivisaoDaFamilia[];
    familia: readonly string[];
    universo: readonly UnidadeDoUniverso[];
  },
): RelatorioDaPlanilhaDeVinculo {
  const casaram: CasamentoDaPlanilha[] = [];
  const naoCasaram: RecusaDaPlanilha[] = [];

  const porCategoria = new Map<string, { enterpriseId: string; id: string; nome: string }>();
  for (const c of contexto.categorias) porCategoria.set(comparavel(c.nome), c);

  const porDivisao = new Map<string, DivisaoDaFamilia>();
  for (const d of contexto.divisoes) {
    porDivisao.set(comparavel(d.codigo), d);
    porDivisao.set(comparavel(d.nome), d);
    porDivisao.set(comparavel(d.enterpriseId), d);
  }

  // Um terreno por chave de PLANILHA (quadra + lote), preferindo a linha viva — a mesma escolha da
  // lista da tela.
  //
  // ⚠️ QUANDO DUAS LINHAS VIVAS DIVIDEM A CHAVE, A LINHA DA PLANILHA É RECUSADA. O Excel só traz
  // quadra e lote, e nas 17 chaves em que duas glebas vivas da mesma família repetem o número
  // (medido em 21/09/2026: VOC × VOR e RDP × RPC) não existe resposta única. Escolher uma pelo
  // `.order()` do banco carimbaria a minuta de um lote que ninguém apontou; a recusa NOMEIA os dois
  // códigos, e aí o operador acrescenta a coluna Divisão e diz qual é.
  const porTerreno = new Map<string, UnidadeDoUniverso>();
  const ambiguas = new Map<string, UnidadeDoUniverso[]>();
  for (const u of contexto.universo) {
    const chave = chaveDoTerreno(u);
    const atual = porTerreno.get(chave);
    if (!atual || (atual.espelho_de && !u.espelho_de)) porTerreno.set(chave, u);
    if (!u.espelho_de) ambiguas.set(chave, [...(ambiguas.get(chave) ?? []), u]);
  }

  const vistas = new Map<string, number>();
  let comCategoria = 0;
  let comDivisao = 0;
  let semMudanca = 0;

  linhas.forEach((bruta, indice) => {
    const numero = indice + 2;
    const quadra = String(bruta.quadra ?? "").trim();
    const lote = String(bruta.lote ?? "").trim();
    const identificacao = `${quadra}/${lote}`.replace(/^\/|\/$/g, "");
    const recusar = (motivo: string) => naoCasaram.push({ linha: numero, motivo, valor: identificacao });

    if (!quadra || !lote) {
      recusar("Sem quadra e lote não dá para achar o terreno.");
      return;
    }

    const chave = chaveDoTerreno({ lote, quadra });
    const jaVista = vistas.get(chave);
    if (jaVista) {
      recusar(`Repetida: a linha ${jaVista} já traz ${identificacao}.`);
      return;
    }
    vistas.set(chave, numero);

    const unidade = porTerreno.get(chave);
    if (!unidade) {
      recusar("Nenhum lote com essa quadra e esse lote neste empreendimento.");
      return;
    }

    const vivas = ambiguas.get(chave) ?? [];
    if (vivas.length > 1) {
      const codigos = vivas
        .map((v) => String(v.codigo ?? "").trim() || v.id)
        .sort()
        .join(" e ");
      recusar(
        `Existem dois lotes vivos com essa quadra e esse lote, em divisões diferentes (${codigos}). Acrescente a coluna Divisão na planilha para dizer qual é.`,
      );
      return;
    }

    const nomeDaCategoria = String(bruta.categoria ?? "").trim();
    let categoriaId: null | string | undefined;
    if (nomeDaCategoria) {
      // ⚠️ UM JEITO ESCRITO DE APAGAR, e só um. Célula em branco não mexe na categoria (a planilha
      // costuma trazer só uma parte do loteamento); a palavra "sem" é a ordem explícita de tirar.
      if (comparavel(nomeDaCategoria) === "sem" || comparavel(nomeDaCategoria) === "sem categoria") {
        categoriaId = null;
      } else {
        const achada = porCategoria.get(comparavel(nomeDaCategoria));
        if (!achada) {
          recusar(`A categoria "${nomeDaCategoria}" não existe neste empreendimento.`);
          return;
        }
        const compativel = categoriaCompativel(achada, unidade, contexto.familia);
        if (!compativel.ok) {
          recusar(compativel.motivo);
          return;
        }
        categoriaId = achada.id;
      }
    }

    const nomeDaDivisao = String(bruta.divisao ?? "").trim();
    let divisaoDestino: null | string | undefined;
    if (nomeDaDivisao) {
      const achada = porDivisao.get(comparavel(nomeDaDivisao));
      if (!achada) {
        recusar(`A divisão "${nomeDaDivisao}" não é deste empreendimento.`);
        return;
      }
      divisaoDestino = achada.enterpriseId;
    }

    if (categoriaId === undefined && divisaoDestino === undefined) {
      semMudanca += 1;
      return;
    }
    if (categoriaId !== undefined) comCategoria += 1;
    if (divisaoDestino !== undefined) comDivisao += 1;

    casaram.push({
      ...(categoriaId === undefined ? {} : { categoriaId }),
      ...(divisaoDestino === undefined ? {} : { divisaoDestino }),
      linha: numero,
      rotulo: rotuloDaLinha(unidade),
      unidadeId: unidade.id,
    });
  });

  return {
    casaram,
    naoCasaram,
    resumo: {
      comCategoria,
      comDivisao,
      naoCasaram: naoCasaram.length,
      semMudanca,
      total: linhas.length,
    },
  };
}

/** A chave do terreno, reexportada: quem usa esta régua não precisa abrir duas portas. */
export { chaveDoTerreno, comparavel };
