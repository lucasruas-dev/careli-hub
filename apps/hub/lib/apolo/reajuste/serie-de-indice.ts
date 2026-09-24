// A SÉRIE HISTÓRICA DOS ÍNDICES DE CORREÇÃO — a matéria-prima da projeção de parcelas.
//
// Lucas (23/09/2026): *"mostrar a evolução das parcelas com base na série histórica do IPCA ou do
// índice de correção que está naquele contrato, e a gente faz uma projeção para o futuro"*.
//
// ⚠️ O ACUMULADO É COMPOSTO, NUNCA SOMA. Dois meses de 1% não dão 2%, dão 2,01%. Sobre 36 meses de
// IPCA a diferença entre somar e compor passa de um ponto inteiro — e um ponto, na parcela de quem
// tem 156 delas pela frente, é dinheiro de verdade.
//
// ⚠️ MÊS FALTANDO INVALIDA A JANELA, e é de propósito que devolve nulo em vez de pular. Pular um
// mês de dentro de um acumulado de 36 produz um número menor que o certo, com cara de certo — o
// tipo de defeito que ninguém encontra olhando a tela. Ver `acumulado`.
//
// ⚠️ AS DUAS FONTES TÊM DEFASAGEM DE UM MÊS. Medido em 23/09/2026: o último ponto publicado de
// IPCA e INCC-M era AGOSTO. Isso não é atraso nosso: o índice de setembro sai em outubro. Quem
// pedir acumulado "até este mês" recebe nulo, e o relatório tem de dizer até quando ele sabe.
//
// ⚠️ NÃO EXISTE `apisidra` AQUI. O host `apisidra.ibge.gov.br` falha no handshake TLS a partir da
// nossa rede (curl exit 35, medido em 23/09/2026); a API v3 de agregados
// (`servicodados.ibge.gov.br`) responde 200 para a mesma tabela 1737.
//
// ⚠️ SÉRIE DIÁRIA DO BANCO CENTRAL DEVOLVE HTTP 406 sem janela de datas (Poupança 195 e TR 226).
// Por isso este módulo só trata os índices MENSAIS, que são os que reajustam contrato de lote, e
// recusa explicitamente os outros em vez de devolver série vazia com cara de série.

/** Os índices que este módulo sabe buscar. São os que aparecem na carteira medida. */
export type CodigoDeIndice = "IGP-M" | "INCC-M" | "IPCA";

/** Um mês da série: "AAAAMM" -> variação do mês, em % (0.62 = 0,62%). */
export type SerieMensal = Map<string, number>;

type Fonte =
  | { codigo: number; tipo: "bcb_sgs" }
  | { agregado: number; tipo: "ibge_v3"; variavel: number };

/**
 * De onde vem cada índice.
 *
 * Os códigos batem com `temis_indices.fonte_codigo`, que é o catálogo da casa (migration 0154 e
 * 0174). Aqui ficam só os MENSAIS: ver o aviso sobre o 406 no cabeçalho.
 */
const FONTES: Record<CodigoDeIndice, Fonte> = {
  "IGP-M": { codigo: 189, tipo: "bcb_sgs" },
  "INCC-M": { codigo: 7456, tipo: "bcb_sgs" },
  IPCA: { agregado: 1737, tipo: "ibge_v3", variavel: 63 },
};

export const INDICES_SUPORTADOS = Object.keys(FONTES) as CodigoDeIndice[];

/**
 * Tira o acento sem usar intervalo unicode em regex.
 *
 * ⚠️ O intervalo unicode dos combinantes em regex PARECE mais curto e e uma armadilha:
 * vira o caractere combinante CRU no arquivo, a linha fica invisível no editor e quem for mexer
 * nela depois quebra a regra sem perceber. O corte por código faz o mesmo e continua legível.
 */
function semAcento(texto: string): string {
  return [...texto.normalize("NFD")]
    .filter((caractere) => {
      const codigo = caractere.codePointAt(0) ?? 0;
      return codigo < 0x300 || codigo > 0x36f;
    })
    .join("");
}

/**
 * Traduz o nome do índice como o legado o escreve para o código daqui.
 *
 * ⚠️ O NOME DO LEGADO VEM SUJO e em mais de uma grafia ("IPCA ANUAL", "IPCA-MENSAL", "INCC").
 * O que interessa para a série é a FAMÍLIA do índice, não a periodicidade de aplicação: a série é
 * sempre mensal, e é o cálculo que decide sobre quantos meses acumular.
 *
 * ⚠️ E O NOME DO PLANO NÃO É VERDADE ABSOLUTA: medido em 23/09/2026, 913 de 926 degraus vêm de
 * plano marcado "IPCA ANUAL", mas 118 deles seguiram INCC-M ou IGP-M. Isto aqui diz o que o
 * cadastro AFIRMA; quem projeta precisa conferir contra o que o contrato FEZ.
 *
 * Devolve `null` para o que não dá para reconhecer — e `null` aqui vira "não sei projetar este
 * contrato", que é o que o relatório precisa dizer, em vez de escolher um índice no chute.
 */
export function indiceDoNome(nome: null | string | undefined): CodigoDeIndice | null {
  const cru = semAcento(String(nome ?? "")).toUpperCase();

  if (!cru.trim()) return null;
  if (cru.includes("INCC")) return "INCC-M";
  if (cru.includes("IGP")) return "IGP-M";
  if (cru.includes("IPCA")) return "IPCA";
  return null;
}

/** "AAAAMM" do mês anterior a este. */
export function mesAnterior(aaaamm: string): string {
  let ano = Number(aaaamm.slice(0, 4));
  let mes = Number(aaaamm.slice(4, 6)) - 1;
  if (mes === 0) {
    mes = 12;
    ano -= 1;
  }
  return `${ano}${String(mes).padStart(2, "0")}`;
}

/** Quantos meses de `de` (inclusive) até `ate` (inclusive). Negativo quando `ate` é anterior. */
export function mesesEntre(de: string, ate: string): number {
  const anoDe = Number(de.slice(0, 4));
  const mesDe = Number(de.slice(4, 6));
  const anoAte = Number(ate.slice(0, 4));
  const mesAte = Number(ate.slice(4, 6));
  return (anoAte - anoDe) * 12 + (mesAte - mesDe) + 1;
}

/**
 * O acumulado COMPOSTO de `meses` meses terminando em `ate` (inclusive), em %.
 *
 * ⚠️ DEVOLVE `null` SE FALTAR UM MÊS SÓ. Ver o aviso do cabeçalho: um buraco no meio da janela
 * produziria um acumulado menor que o real, sem nenhum sinal de que está errado.
 */
export function acumulado(serie: SerieMensal, ate: string, meses: number): null | number {
  if (meses <= 0) return null;

  let cursor = ate;
  let fator = 1;
  for (let i = 0; i < meses; i += 1) {
    const variacao = serie.get(cursor);
    if (variacao == null) return null;
    fator *= 1 + variacao / 100;
    cursor = mesAnterior(cursor);
  }
  return (fator - 1) * 100;
}

/** O acumulado composto de `de` até `ate`, ambos inclusive. Nulo se faltar mês na janela. */
export function acumuladoEntre(serie: SerieMensal, de: string, ate: string): null | number {
  const meses = mesesEntre(de, ate);
  return meses <= 0 ? null : acumulado(serie, ate, meses);
}

/** O mês mais recente que a série conhece, ou `null` na série vazia. */
export function ultimoMes(serie: SerieMensal): null | string {
  let maior: null | string = null;
  for (const chave of serie.keys()) {
    if (maior === null || chave > maior) maior = chave;
  }
  return maior;
}

/**
 * A MÉDIA MENSAL GEOMÉTRICA dos últimos `meses` meses, em % ao mês.
 *
 * É a base honesta para projetar o futuro: a média aritmética de variações percentuais superestima
 * o acumulado, porque ignora a composição. Devolve `null` quando a janela tem buraco.
 */
export function mediaMensalGeometrica(
  serie: SerieMensal,
  ate: string,
  meses: number,
): null | number {
  const acc = acumulado(serie, ate, meses);
  if (acc == null) return null;
  return ((1 + acc / 100) ** (1 / meses) - 1) * 100;
}

// ── A BUSCA NAS FONTES ────────────────────────────────────────────────────────

async function buscarNoIbge(agregado: number, variavel: number): Promise<SerieMensal> {
  // `periodos/all` devolve a série inteira: 561 meses de IPCA, desde dez/1979 (medido 23/09/2026).
  const endereco =
    `https://servicodados.ibge.gov.br/api/v3/agregados/${agregado}` +
    `/periodos/all/variaveis/${variavel}?localidades=N1[all]`;

  const resposta = await fetch(endereco, { headers: { accept: "application/json" } });
  if (!resposta.ok) {
    throw new Error(`IBGE respondeu ${resposta.status} para o agregado ${agregado}.`);
  }

  const corpo = (await resposta.json()) as Array<{
    resultados?: Array<{ series?: Array<{ serie?: Record<string, string> }> }>;
  }>;

  const bruta = corpo[0]?.resultados?.[0]?.series?.[0]?.serie ?? {};
  const serie: SerieMensal = new Map();
  for (const [periodo, valor] of Object.entries(bruta)) {
    // O IBGE devolve "..." e "-" para mês sem apuração. Esses NÃO entram: ver o aviso do buraco.
    const numero = Number(valor);
    if (!Number.isFinite(numero)) continue;
    if (!/^\d{6}$/.test(periodo)) continue;
    serie.set(periodo, numero);
  }
  return serie;
}

async function buscarNoBancoCentral(codigo: number): Promise<SerieMensal> {
  const endereco = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${codigo}/dados?formato=json`;
  const resposta = await fetch(endereco, { headers: { accept: "application/json" } });

  if (resposta.status === 406) {
    // Ver o aviso do cabeçalho: o 406 é o Banco Central recusando histórico inteiro de série
    // DIÁRIA. Se cair aqui, o índice não é mensal e não deveria estar em FONTES.
    throw new Error(
      `SGS ${codigo} recusou o histórico inteiro (406): é série diária e precisa de janela de datas.`,
    );
  }
  if (!resposta.ok) {
    throw new Error(`Banco Central respondeu ${resposta.status} para a série ${codigo}.`);
  }

  const corpo = (await resposta.json()) as Array<{ data?: string; valor?: string }>;
  const serie: SerieMensal = new Map();
  for (const ponto of corpo) {
    const casou = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(ponto.data ?? ""));
    if (!casou) continue;
    const numero = Number(ponto.valor);
    if (!Number.isFinite(numero)) continue;
    serie.set(`${casou[3]}${casou[2]}`, numero);
  }
  return serie;
}

/**
 * Busca a série de um índice na fonte pública.
 *
 * ⚠️ ISTO É CHAMADA EXTERNA, e chamada externa na carga de tela já custou caro nesta casa. Quem
 * chama deve guardar o resultado (a tabela de série existe para isso), não pedir a cada render.
 */
export async function buscarSerie(indice: CodigoDeIndice): Promise<SerieMensal> {
  const fonte = FONTES[indice];
  return fonte.tipo === "ibge_v3"
    ? buscarNoIbge(fonte.agregado, fonte.variavel)
    : buscarNoBancoCentral(fonte.codigo);
}
