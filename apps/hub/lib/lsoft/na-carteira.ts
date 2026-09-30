// A CARTEIRA QUE JÁ PASSOU PARA O FINANCEIRO sai da tela LSoft Integração.
//
// Pedido do Lucas (29/09/2026): os clientes do Garden que o time adm validou com OK na planilha
// saem da integração e aparecem na carteira do Financeiro do portal cecilio-rocha; os com
// observação ficam. Nas palavras dele: *"uma coisa simples, que já está validado"*, *"é só copiar
// e colar na carteira"*.
//
// O MARCADOR é `lsoft_clientes.empreendimentos_na_carteira` (migration 0199): um empreendimento
// nessa lista quer dizer que a carteira do cliente NAQUELE empreendimento já é lida pelo Financeiro.
// As parcelas não mudam de lugar (continuam em `lsoft_parcelas`); o que muda é quem as mostra.
//
// ⚠️ É POR (CLIENTE, EMPREENDIMENTO). 11 dos 106 do Garden também têm Giant Towers, On Sky,
// Guaimbé, Vale do Ouro ou "A classificar" (medido em 29/09/2026), e essas carteiras continuam aqui
// para validar. Por isso, na visão "Todos os empreendimentos", o cliente não some: ele PERDE a
// parte que subiu. Só some quem fica sem parcela nenhuma.
//
// ⚠️ A RÉGUA É A DO FINANCEIRO: sai daqui SÓ o que o Financeiro lê. O Financeiro lê do par
// (cliente, empreendimento) apenas a categoria do LSoft daquele empreendimento (a 124 no Garden,
// `CATEGORIA_NO_FINANCEIRO`). Parcela do par em outra categoria (a 17 do patrimônio, ou uma
// parcela que alguém corrigiu na ficha para "Garden") CONTINUA aqui. Até a revisão de 29/09/2026
// a integração tirava o par inteiro e o Financeiro lia só a 124: essa parcela sumia das duas telas.
//
// ⚠️ PURO DE PROPÓSITO: sem banco e sem React. `carteira.ts` lê e chama; a planilha filtra as
// parcelas com a mesma régua; o teste controla tudo.
import type { ClienteDaCarteira } from "@/lib/lsoft/carteira";
import { GARDEN } from "@/lib/lsoft/categorias";

/** O nome da coluna, num lugar só: a leitura e a detecção de "ainda não existe" usam os dois. */
export const COLUNA_NA_CARTEIRA = "empreendimentos_na_carteira";

/**
 * A categoria do LSoft (`lsoft_parcelas.categoria_lsoft`) que o Financeiro lê de cada empreendimento.
 *
 * ⚠️ TEM DE SER A MESMA de `EMPREENDIMENTOS_DO_LSOFT_NO_FINANCEIRO` (lib/lsoft/carteira-no-financeiro.ts),
 * e um teste compara as duas. Se divergirem, o que sai daqui não é o que aparece lá.
 *
 * ⚠️ EMPREENDIMENTO FORA DAQUI NÃO SAI DA INTEGRAÇÃO, mesmo marcado na coluna: o Financeiro não o
 * lê, e tirá-lo daqui seria sumir com a carteira (ver `naCarteiraQueOFinanceiroLe`).
 */
export const CATEGORIA_NO_FINANCEIRO: Readonly<Record<string, number>> = {
  [GARDEN]: 124,
};

/** Só os empreendimentos da lista que o Financeiro de fato lê. O resto continua na integração. */
export function naCarteiraQueOFinanceiroLe(lista: readonly string[]): string[] {
  return lista.filter((nome) => CATEGORIA_NO_FINANCEIRO[nome] !== undefined);
}

/**
 * Esta parcela é lida pelo Financeiro (e por isso sai da integração)? Só se o par (cliente,
 * empreendimento) está marcado E a parcela é da categoria que o Financeiro lê.
 */
export function parcelaVaiParaOFinanceiro(
  parcela: { categoriaLsoft: null | number; empreendimento: string },
  naCarteiraDoCliente: readonly string[],
): boolean {
  const categoria = CATEGORIA_NO_FINANCEIRO[parcela.empreendimento];
  return (
    categoria !== undefined &&
    naCarteiraDoCliente.includes(parcela.empreendimento) &&
    parcela.categoriaLsoft === categoria
  );
}

/**
 * A lista como ela deve ser lida do banco: só texto, sem vazio, sem repetido.
 *
 * ⚠️ QUALQUER COISA QUE NÃO SEJA ARRAY VIRA LISTA VAZIA. Antes da migration a coluna nem vem na
 * linha (`undefined`), e o estado de hoje é "ninguém no Financeiro". Nunca o contrário: um valor
 * torto não pode tirar cliente da tela.
 */
export function listaNaCarteira(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  const limpos = valor.map((item) => String(item ?? "").trim()).filter((item) => item !== "");
  return [...new Set(limpos)];
}

/**
 * A leitura falhou porque a coluna ainda não existe no banco (a migration 0199 não rodou)?
 *
 * ⚠️ SÓ ESSE ERRO É TOLERADO. A tela não pode quebrar antes da migration, e antes dela ninguém
 * está no Financeiro, então "lista vazia" é a resposta certa. Qualquer outro erro (rede, timeout)
 * NÃO é tratado como vazio: seria mostrar na integração, calado, um cliente que já está no
 * Financeiro, e o mesmo dinheiro apareceria nas duas telas.
 *
 * O Postgres responde 42703 (undefined_column); o PostgREST, conforme a versão, fala em "schema
 * cache". As duas formas citam o nome da coluna.
 */
export function colunaNaCarteiraAusente(erro: null | { code?: null | string; message?: null | string } | undefined): boolean {
  if (!erro) return false;
  const mensagem = String(erro.message ?? "");
  if (!mensagem.includes(COLUNA_NA_CARTEIRA)) return false;
  return erro.code === "42703" || erro.code === "PGRST204" || /does not exist|não existe|schema cache/i.test(mensagem);
}

/**
 * Com um empreendimento escolhido: o cliente sai do recorte se a carteira dele NAQUELE
 * empreendimento já está no Financeiro. A carteira dele nos outros continua nos outros recortes.
 */
export function saiDoRecorte(naCarteira: readonly string[], empreendimento: string): boolean {
  return naCarteira.includes(empreendimento);
}

/**
 * Uma linha da view por empreendimento (0107, `lsoft_carteira_por_cliente_empreendimento`), só com
 * o que o desconto usa.
 */
export type LinhaPorEmpreendimento = {
  codigo: string;
  empreendimento: string;
  /** Confirmadas como subsídio da Caixa: a 0107 as tira das contagens; a 0097 não. Ver `descontarDaCarteira`. */
  parcelasCaixa: number;
  parcelas: number;
  parcelasAbertas: number;
  parcelasPagas: number;
  parcelasVencidas: number;
  proximoVencimento: null | string;
  saldoAberto: number;
  saldoVencido: number;
  totalRecebido: number;
  unidades: string[];
};

/** Dinheiro no centavo: somar e subtrair em ponto flutuante deixa resíduo do tipo 0,000000001. */
const centavos = (valor: number) => Math.round(valor * 100) / 100;

const numero = (valor: unknown): number => {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** A linha crua da view (snake_case, numeric como texto) no formato do desconto. */
export function linhaPorEmpreendimentoDaView(linha: Record<string, unknown>): LinhaPorEmpreendimento {
  const proximo = String(linha.proximo_vencimento ?? "").trim();
  return {
    codigo: String(linha.codigo ?? ""),
    empreendimento: String(linha.empreendimento ?? ""),
    parcelas: numero(linha.parcelas),
    parcelasAbertas: numero(linha.parcelas_abertas),
    parcelasCaixa: numero(linha.parcelas_caixa),
    parcelasPagas: numero(linha.parcelas_pagas),
    parcelasVencidas: numero(linha.parcelas_vencidas),
    proximoVencimento: proximo === "" ? null : proximo,
    saldoAberto: numero(linha.saldo_aberto),
    saldoVencido: numero(linha.saldo_vencido),
    totalRecebido: numero(linha.total_recebido),
    unidades: Array.isArray(linha.unidades) ? (linha.unidades as unknown[]).map(String) : [],
  };
}

/**
 * Uma parcela de um par marcado que NÃO vai para o Financeiro (outra categoria). Só o que a view
 * 0107 usa para somar.
 */
export type ParcelaQueFicaNoPar = {
  clienteCodigo: string;
  /** Confirmada como subsídio da Caixa: a 0107 a tira das contagens (e conta em `parcelasCaixa`). */
  ehCaixa: boolean;
  empreendimento: string;
  lote: null | string;
  paga: boolean;
  quadra: null | string;
  valor: number;
  valorRecebido: number;
  vencimento: null | string;
};

/**
 * A parte de um par (cliente, empreendimento) que fica na integração, no formato de uma linha da
 * view 0107, para o desconto tirar do par só o resto.
 *
 * ⚠️ É A CONTA DA VIEW 0107, repetida aqui de propósito (migration 0107): contagens e somas sem a
 * Caixa confirmada, "vencida" = em aberto com vencimento ANTES de `hojeDoBanco`, e a unidade como a
 * view a escreve ("Q06 L14"), de todas as parcelas, inclusive as da Caixa. Tem de fechar com a
 * linha da view de onde vai ser subtraída, então `hojeDoBanco` é o `current_date` do banco (UTC),
 * e não o dia de São Paulo.
 *
 * Normalmente não há parcela nenhuma aqui (medido em 29/09/2026: zero parcela do Garden fora da 124
 * nos 106 que sobem); a conta existe para a exceção não sumir com dinheiro.
 */
export function linhaDoQueFicaNoPar(
  codigo: string,
  empreendimento: string,
  parcelas: readonly ParcelaQueFicaNoPar[],
  hojeDoBanco: string,
): LinhaPorEmpreendimento {
  const doPar = parcelas.filter((p) => p.clienteCodigo === codigo && p.empreendimento === empreendimento);
  const contam = doPar.filter((p) => !p.ehCaixa);
  const abertas = contam.filter((p) => !p.paga);
  const vencidas = abertas.filter((p) => p.vencimento !== null && p.vencimento.slice(0, 10) < hojeDoBanco);
  const somar = (lista: readonly ParcelaQueFicaNoPar[], pega: (p: ParcelaQueFicaNoPar) => number) =>
    centavos(lista.reduce((total, p) => total + pega(p), 0));

  const unidades = new Set<string>();
  for (const p of doPar) {
    if (p.quadra === null && p.lote === null) continue;
    // concat_ws(' ', nullif('Q' || quadra, 'Q'), nullif('L' || lote, 'L')), como na view.
    unidades.add([p.quadra ? `Q${p.quadra}` : null, p.lote ? `L${p.lote}` : null].filter(Boolean).join(" "));
  }

  return {
    codigo,
    empreendimento,
    parcelas: contam.length,
    parcelasAbertas: abertas.length,
    parcelasCaixa: doPar.length - contam.length,
    parcelasPagas: contam.length - abertas.length,
    parcelasVencidas: vencidas.length,
    proximoVencimento:
      abertas
        .map((p) => p.vencimento?.slice(0, 10) ?? null)
        .filter((data): data is string => data !== null)
        .sort()[0] ?? null,
    saldoAberto: somar(abertas, (p) => p.valor),
    saldoVencido: somar(vencidas, (p) => p.valor),
    totalRecebido: somar(
      contam.filter((p) => p.paga),
      (p) => p.valorRecebido,
    ),
    unidades: [...unidades].sort(),
  };
}

/**
 * A linha do par sem a parte que fica na integração: o que de fato vai para o Financeiro.
 *
 * ⚠️ `proximoVencimento` e `unidades` continuam os do par inteiro: não dá para subtrair um mínimo
 * nem um conjunto. Quem decide o que sobra deles é `descontarDaCarteira`, que põe a parte que fica
 * entre as linhas que ficam.
 */
function semOQueFica(linha: LinhaPorEmpreendimento, fica: LinhaPorEmpreendimento | undefined): LinhaPorEmpreendimento {
  if (!fica) return linha;
  return {
    ...linha,
    parcelas: linha.parcelas - fica.parcelas,
    parcelasAbertas: linha.parcelasAbertas - fica.parcelasAbertas,
    parcelasCaixa: linha.parcelasCaixa - fica.parcelasCaixa,
    parcelasPagas: linha.parcelasPagas - fica.parcelasPagas,
    parcelasVencidas: linha.parcelasVencidas - fica.parcelasVencidas,
    saldoAberto: centavos(linha.saldoAberto - fica.saldoAberto),
    saldoVencido: centavos(linha.saldoVencido - fica.saldoVencido),
    totalRecebido: centavos(linha.totalRecebido - fica.totalRecebido),
  };
}

/** O que o desconto toca no cliente. `ClienteDaCarteira` inteiro também serve. */
export type ClienteDescontavel = Pick<
  ClienteDaCarteira,
  | "codigo"
  | "empreendimentos"
  | "parcelas"
  | "parcelasAbertas"
  | "parcelasPagas"
  | "parcelasVencidas"
  | "proximoVencimento"
  | "saldoAberto"
  | "saldoVencido"
  | "totalRecebido"
  | "unidades"
>;

export type Desconto<C> = {
  /** Nulo = o cliente ficou sem parcela nenhuma na integração e sai da lista. */
  cliente: C | null;
  /**
   * O desconto não pôde ser exato e o número que ficou merece desconfiança: a linha que saiu tinha
   * subsídio da Caixa confirmado, ou alguma conta ficou negativa (as duas views lidas em momentos
   * diferentes, com uma baixa no meio). Quem chama registra; a tela segue.
   */
  inexato: boolean;
};

/**
 * O cliente PERDE a parte da carteira que já está no Financeiro, e some se ficar sem parcela.
 * Serve às duas visões: em "Todos", `cliente` é a linha da 0097 (todos os empreendimentos); com um
 * empreendimento escolhido, é a própria linha da 0107 daquele empreendimento.
 *
 * `linhas` são as linhas da view 0107 DESTE cliente, de TODOS os empreendimentos dele: as que saem
 * dão o que descontar; as que ficam dizem que unidades e que próximo vencimento sobram.
 *
 * `ficamNoPar` são as partes dos pares marcados que NÃO vão para o Financeiro (outra categoria; ver
 * `linhaDoQueFicaNoPar`). Elas são tiradas do que sai e contadas entre as que ficam. Vazia é o caso
 * normal.
 *
 * ⚠️ POR QUE DESCONTAR A LINHA DA 0107 DA LINHA DA 0097 É EXATO NO GARDEN. A 0097 (a visão "Todos")
 * soma TODAS as parcelas do cliente; a 0107 soma por empreendimento e deixa de fora só a parcela
 * confirmada como subsídio da Caixa. Conferido por SELECT em 29/09/2026: o Garden tem 13.401
 * parcelas, todas da categoria 124, e ZERO marca de classificação (nenhuma Caixa confirmada, nenhuma
 * a validar). Para os 106 que sobem, a linha do Garden na 0107 bateu com a soma direta das parcelas
 * do Garden em `lsoft_parcelas` em 106 de 106 (parcelas, pagas, abertas, vencidas, a receber,
 * vencido, recebido e próximo vencimento). Onde houver Caixa confirmada, a 0107 não diz quanto dela
 * está paga ou em aberto, e o desconto sai `inexato`: a parte da Caixa fica no cliente.
 *
 * ⚠️ OS CAMPOS DA CAIXA E DA CURADORIA NÃO SÃO TOCADOS. A 0097 não os tem (chegam zerados na visão
 * "Todos"), e descontar da 0107 os deixaria negativos. O patrimônio também não: é somado depois,
 * sobre os clientes que sobraram (ver `lerCarteiraDoLsoft`).
 *
 * ⚠️ OS EMPREENDIMENTOS QUE FICAM VÊM DAS LINHAS, não só do cadastro. `lsoft_clientes.empreendimentos`
 * (o que a 0097 devolve) não conhece a carteira que veio da categoria 17: medido em 29/09/2026, 10
 * dos 11 que continuam aqui com outra carteira têm o cadastro só com {Garden}, e as parcelas em
 * Giant Towers, On Sky, Guaimbé ou "A classificar". Tirar o Garden só do cadastro deixava a coluna
 * vazia, com o saldo do Giant Towers aparecendo como de empreendimento nenhum.
 *
 * ⚠️ A UNIDADE SÓ SAI SE NENHUMA CARTEIRA QUE FICA TAMBÉM A TEM. "Q06 L14" do Garden e "Q06 L14" de
 * outro loteamento são textos iguais; tirar pelo texto sem olhar o resto apagaria a do outro.
 */
export function descontarDaCarteira<C extends ClienteDescontavel>(
  cliente: C,
  naCarteira: readonly string[],
  linhas: readonly LinhaPorEmpreendimento[],
  ficamNoPar: readonly LinhaPorEmpreendimento[] = [],
): Desconto<C> {
  if (naCarteira.length === 0) return { cliente, inexato: false };

  const doCliente = linhas.filter((linha) => linha.codigo === cliente.codigo);
  const doPar = ficamNoPar.filter(
    (linha) =>
      linha.codigo === cliente.codigo &&
      naCarteira.includes(linha.empreendimento) &&
      linha.parcelas + linha.parcelasCaixa > 0,
  );
  const saem = doCliente
    .filter((linha) => naCarteira.includes(linha.empreendimento))
    .map((linha) => semOQueFica(linha, doPar.find((fica) => fica.empreendimento === linha.empreendimento)));
  const ficam = [...doCliente.filter((linha) => !naCarteira.includes(linha.empreendimento)), ...doPar];

  const soma = (pega: (linha: LinhaPorEmpreendimento) => number) =>
    saem.reduce((total, linha) => total + pega(linha), 0);

  const brutos = {
    parcelas: cliente.parcelas - soma((l) => l.parcelas),
    parcelasAbertas: cliente.parcelasAbertas - soma((l) => l.parcelasAbertas),
    parcelasPagas: cliente.parcelasPagas - soma((l) => l.parcelasPagas),
    parcelasVencidas: cliente.parcelasVencidas - soma((l) => l.parcelasVencidas),
    saldoAberto: centavos(cliente.saldoAberto - soma((l) => l.saldoAberto)),
    saldoVencido: centavos(cliente.saldoVencido - soma((l) => l.saldoVencido)),
    totalRecebido: centavos(cliente.totalRecebido - soma((l) => l.totalRecebido)),
  };
  const negativo = Object.values(brutos).some((valor) => valor < 0);
  // Nunca negativo na tela: se a conta passou do zero, o número certo é "nada sobrou" e o aviso
  // vai para o log (`inexato`), e não um "-R$ 12" que ninguém entende.
  const restante = Object.fromEntries(
    Object.entries(brutos).map(([campo, valor]) => [campo, Math.max(valor, 0)]),
  ) as typeof brutos;

  const inexato = negativo || saem.some((linha) => linha.parcelasCaixa > 0);

  if (restante.parcelas === 0) return { cliente: null, inexato };

  const unidadesQueFicam = new Set(ficam.flatMap((linha) => linha.unidades));
  const unidadesQueSaem = new Set(saem.flatMap((linha) => linha.unidades));

  // O próximo vencimento só muda se ele era de uma carteira que saiu. Aí vale o menor das que ficam.
  const eraDeQuemSaiu =
    cliente.proximoVencimento !== null &&
    saem.some((linha) => linha.proximoVencimento === cliente.proximoVencimento) &&
    !ficam.some((linha) => linha.proximoVencimento === cliente.proximoVencimento);
  const proximoDasQueFicam =
    ficam
      .map((linha) => linha.proximoVencimento)
      .filter((data): data is string => data !== null)
      .sort()[0] ?? null;

  return {
    cliente: {
      ...cliente,
      ...restante,
      empreendimentos: [
        ...new Set([
          ...cliente.empreendimentos.filter((nome) => !naCarteira.includes(nome)),
          ...ficam.map((linha) => linha.empreendimento),
        ]),
      ],
      proximoVencimento: eraDeQuemSaiu ? proximoDasQueFicam : cliente.proximoVencimento,
      unidades: cliente.unidades.filter((unidade) => !unidadesQueSaem.has(unidade) || unidadesQueFicam.has(unidade)),
    },
    inexato,
  };
}

/**
 * As parcelas que continuam na integração: tira as que o Financeiro lê (`parcelaVaiParaOFinanceiro`).
 * É a régua da aba Parcelas do Excel, a mesma que tirou o dinheiro da aba Clientes.
 *
 * ⚠️ SÓ A CATEGORIA DO FINANCEIRO SAI. Parcela do par em outra categoria (a 17, ou uma corrigida na
 * ficha para "Garden") fica no arquivo, como fica nos números da aba Clientes (`descontarDaCarteira`
 * com `ficamNoPar`). Até 29/09/2026 saía o par inteiro, e essa parcela não estava em tela nenhuma.
 */
export function parcelasQueFicam<
  P extends { categoriaLsoft: null | number; clienteCodigo: string; empreendimento: string },
>(parcelas: readonly P[], naCarteiraDoCliente: ReadonlyMap<string, readonly string[]>): P[] {
  return parcelas.filter(
    (parcela) => !parcelaVaiParaOFinanceiro(parcela, naCarteiraDoCliente.get(parcela.clienteCodigo) ?? []),
  );
}

// ── O DESFAZER DO SCRIPT (scripts/carteira/subir-garden-para-carteira.mjs) ──

/** Uma linha de `lsoft_clientes_edicoes`, só com o que o desfazer usa. */
export type EntradaDaTrilha = { autor: string; valorAnterior: null | string; valorNovo: null | string };

export type DevolucaoDoCampo =
  | { acao: "devolve"; valor: null | string }
  | { acao: "fica"; aviso: null | string }
  | { acao: "sem-subida" };

/**
 * O que o `--desfazer` devolve de UM campo do cadastro (status, carimbo ou observação).
 *
 * ⚠️ SÓ VOLTA O QUE AINDA ESTÁ COMO A SUBIDA DEIXOU (revisão de 29/09/2026). A última entrada da
 * trilha do campo tem de ser a da subida, e o valor de hoje tem de ser o que ela gravou. Se alguém
 * mexeu na tela depois, o valor dessa pessoa fica e sai um aviso. Se a última é a volta de um
 * desfazer anterior, não há nada a fazer (rodar duas vezes não desfaz a volta).
 *
 * ⚠️ O CARIMBO É COMPARADO COMO INSTANTE: o banco devolve "…+00:00" e a trilha guarda o "…Z" que o
 * script mandou. E o status sem valor é "pendente", como a tela e a trilha o escrevem.
 */
export function devolucaoDoCampo(args: {
  autorDaSubida: string;
  autorDoDesfazer: string;
  campo: string;
  /** As entradas deste cliente neste campo, de TODOS os autores, da mais antiga para a mais nova. */
  entradas: readonly EntradaDaTrilha[];
  /** O valor de hoje no cadastro. */
  valorAtual: null | string;
}): DevolucaoDoCampo {
  const { autorDaSubida, autorDoDesfazer, campo, entradas } = args;
  const normal = (valor: null | string): null | string => {
    const limpo = valor === null ? null : valor.trim() === "" ? null : valor.trim();
    return campo === "status_validacao" ? (limpo ?? "pendente") : limpo;
  };
  const igual = (a: null | string, b: null | string) =>
    campo === "validado_em" && a !== null && b !== null ? Date.parse(a) === Date.parse(b) : a === b;

  if (!entradas.some((entrada) => entrada.autor === autorDaSubida)) return { acao: "sem-subida" };

  const ultima = entradas[entradas.length - 1] as EntradaDaTrilha;
  if (ultima.autor !== autorDaSubida) {
    return { acao: "fica", aviso: ultima.autor === autorDoDesfazer ? null : "foi mudado depois da subida" };
  }

  const atual = normal(args.valorAtual);
  if (!igual(atual, normal(ultima.valorNovo))) return { acao: "fica", aviso: "não é mais o que a subida gravou" };

  const anterior = normal(ultima.valorAnterior);
  if (igual(anterior, atual)) return { acao: "fica", aviso: null };
  return { acao: "devolve", valor: anterior };
}

/** O texto do selo da tela: "Garden no Financeiro", ou "Garden e On Sky no Financeiro". */
export function rotuloDoSelo(naCarteira: readonly string[]): null | string {
  if (naCarteira.length === 0) return null;
  const nomes =
    naCarteira.length === 1
      ? naCarteira[0]
      : `${naCarteira.slice(0, -1).join(", ")} e ${naCarteira[naCarteira.length - 1]}`;
  return `${nomes} no Financeiro`;
}
