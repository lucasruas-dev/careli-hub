// O CONTRATO GUARDADO — as regras de quando se pode gerar, como o arquivo se chama e qual das
// versões vale. Sem banco, sem storage, sem tela: só decisão, para caber em teste.
//
// Lucas (08/09/2026): *"garante então a construção para a gente emitir contratos, precisamos testar
// isso hoje"*. A prévia mostrava o contrato preenchido e não gravava nada; este é o elo que faltava
// entre o que se vê na tela e o papel que vai para assinatura.
//
// ── AS TRÊS DECISÕES QUE ESTE ARQUIVO CARREGA ───────────────────────────────
//
// 1. ⚠️ VARIÁVEL SEM VALOR **BLOQUEIA** A GERAÇÃO — não vira rascunho. `preencherContrato` imprime
//    `[cpf_cliente]` no corpo quando o dado falta (decisão dele, e certa: some quem escolheu
//    sumir). Na PRÉVIA isso é conferência; num arquivo GUARDADO é outra coisa, porque o arquivo cai
//    numa gaveta com DOIS leitores que não são quem gerou: a aba Documentos da venda no portal e a
//    ficha do cliente no Apolo (`lerDocumentosDaVenda`). Não existe coluna que marque "rascunho" e
//    que esses dois leitores respeitem — o que existe é `tipo`, e ele já é o que pinta o selo verde
//    de "gerado pelo sistema, vale como prova". Um PDF meio preenchido com esse selo, ao lado do
//    contrato bom, é exatamente o arquivo que alguém manda ao comprador por engano.
//    O rascunho JÁ EXISTE e é grátis: é a prévia, que se gera quantas vezes quiser, mostra a lista
//    do que falta em vermelho e não deixa arquivo nenhum para trás.
//    Medido em 08/09/2026 na proposta de teste do ZZ TESTE (Q01 L05): `semValor` = 0 — a trava não
//    fecha a porta do teste de quinta.
//
// 2. ⚠️ GERAR DE NOVO CRIA UMA **VERSÃO NOVA**, e a mais recente é a única válida. Não se
//    substitui (a 0136 diz "NADA SE APAGA": documento formalizado existe para ser lido depois,
//    inclusive contra quem o gerou) e não se recusa (o motivo mais comum de gerar de novo é ter
//    consertado um dado, e recusar obrigaria a apagar para corrigir — que é a única coisa que a
//    tabela não deixa fazer). A versão vai no NOME do arquivo, que é o que os três leitores
//    mostram, e a anterior recebe na observação a frase que diz por quem foi substituída.
//
// 3. ⚠️ O NOME É PARA SER LIDO DAQUI A DOIS ANOS, por alguém que não estava na sala:
//    empreendimento, unidade, comprador, data e versão. "contrato.pdf" na pasta de downloads de
//    quem baixou três é indistinguível.

/** O `tipo` da linha em `hercules_documentos`. É o mesmo que a aba pinta como "gerado pelo sistema". */
export const TIPO_CONTRATO = "contrato";

// ── 1. PODE GERAR? ──────────────────────────────────────────────────────────

export type Veredito = { ok: true } | { erro: string; ok: false };

/**
 * O contrato pode virar arquivo?
 *
 * ⚠️ A LISTA VAI NA MENSAGEM, e não só a contagem. "3 variáveis sem valor" manda a pessoa procurar
 * colchete em 27 páginas; os nomes dizem se o buraco é do cadastro do comprador ou da minuta.
 */
export function podeGerarContrato(semValor: readonly string[]): Veredito {
  if (semValor.length === 0) return { ok: true };

  const quantas =
    semValor.length === 1
      ? "1 variável ficou sem valor"
      : `${semValor.length} variáveis ficaram sem valor`;

  return {
    erro:
      `${quantas} e o contrato não foi gerado: ${semValor.join(", ")}. ` +
      "Preencha o cadastro ou ajuste a minuta e gere de novo — a prévia continua aberta para conferir.",
    ok: false,
  };
}

// ── 2. VERSÃO ───────────────────────────────────────────────────────────────

/** O que a leitura de `hercules_documentos` precisa devolver para as regras daqui. */
export type ContratoJaGuardado = {
  criadoEm: string;
  id: string;
  nome: string;
  observacao?: null | string;
};

/**
 * `... v3.pdf` → 3. `null` quando o nome não carrega versão.
 *
 * ⚠️ O NOME É A FONTE DA VERSÃO porque não há coluna para ela, e inventar uma exigiria migration
 * para um dado que já cabe onde todo mundo lê. O sufixo é fixo (` vN.pdf`), escrito por
 * `nomeDoContrato` — não é adivinhação sobre nome que uma pessoa digitou: linha de `tipo` contrato
 * só nasce aqui (o upload manual grava `tipo: "documento"`).
 */
export function versaoDoNome(nome: string): null | number {
  const m = / v(\d+)\.pdf$/i.exec(String(nome ?? "").trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * A versão que a próxima geração recebe.
 *
 * ⚠️ MÁXIMO + 1, E NÃO "QUANTIDADE + 1". Se uma linha antiga for escondida (`removido_em`) ou
 * migrada, contar linhas repetiria um número que já circulou em PDF na mão de alguém — e duas
 * folhas diferentes com "v2" no rodapé é pior do que um vão na numeração.
 */
export function proximaVersao(existentes: readonly ContratoJaGuardado[]): number {
  let maior = 0;
  for (const linha of existentes) {
    const v = versaoDoNome(linha.nome) ?? 0;
    if (v > maior) maior = v;
  }
  // Sem versão legível em nenhum nome (linhas de antes desta regra), a contagem é o piso.
  return Math.max(maior, existentes.length) + 1;
}

/**
 * Qual dos contratos guardados vale HOJE.
 *
 * ⚠️ A REGRA É DERIVADA, e não uma coluna "vigente" que alguém precisa lembrar de virar. Coluna de
 * estado exige que TODA escrita a mantenha; um `insert` esquecido em um script deixaria dois
 * vigentes, e o segundo leitor não teria como saber qual. Aqui a resposta é sempre a mesma para
 * quem quer que pergunte: a geração mais recente.
 *
 * ⚠️ O DESEMPATE É A VERSÃO, e ele importa: duas gerações no mesmo segundo (dois cliques) gravam o
 * mesmo `criado_em` com precisão de segundo em alguns caminhos, e sem desempate o vigente
 * oscilaria entre as duas a cada leitura.
 */
export function contratoVigente<T extends ContratoJaGuardado>(
  guardados: readonly T[],
): null | T {
  let vigente: null | T = null;
  for (const linha of guardados) {
    if (!vigente) {
      vigente = linha;
      continue;
    }
    const porData = linha.criadoEm.localeCompare(vigente.criadoEm);
    if (porData > 0) {
      vigente = linha;
      continue;
    }
    if (porData === 0 && (versaoDoNome(linha.nome) ?? 0) > (versaoDoNome(vigente.nome) ?? 0)) {
      vigente = linha;
    }
  }
  return vigente;
}

/**
 * O que fica escrito na versão que acabou de ser aposentada.
 *
 * ⚠️ ELA CONTINUA VISÍVEL NAS TRÊS TELAS — some do "vigente", não da gaveta. Esconder a versão
 * anterior faria o histórico do contrato depender de quem lembrasse do que aconteceu; e a
 * observação é o único campo que os dois leitores de `hercules_documentos` já mostram.
 */
export function textoDaSubstituicao(versaoNova: number, quando: Date): string {
  return `Substituído pela versão ${versaoNova}, gerada em ${diaBR(quando)}.`;
}

// ── 3. NOME DO ARQUIVO ──────────────────────────────────────────────────────

export type IdentidadeDoContrato = {
  /** "Henrique Sales do Vale". */
  comprador: string;
  /** "TST". Sem ele, o nome do empreendimento. */
  empreendimento: string;
  /** "Q01 L05", ou o código da unidade quando ela tem um. */
  unidade: string;
};

/** Teto do `nome` em `hercules_documentos` é 200; 180 deixa folga para o sufixo da versão. */
const TETO_DO_NOME = 180;

/**
 * O nome que a pessoa lê depois.
 *
 * ⚠️ SEM `·` E SEM `/`. O `nome` vai para o `Content-Disposition` do download (a rota do portal
 * passa `{ download: doc.nome }`), e daí para o sistema de arquivos de quem baixou. O separador é
 * hífen, que existe em Windows, macOS e Linux; a barra viraria pasta e o ponto médio já apareceu
 * truncado em cliente de e-mail.
 *
 * ⚠️ A DATA É `AAAA-MM-DD` DE PROPÓSITO. Três contratos na mesma pasta se ordenam sozinhos por
 * nome; em `DD/MM/AAAA` a barra é ilegal em nome de arquivo e a ordem alfabética mente.
 */
export function nomeDoContrato(
  identidade: IdentidadeDoContrato,
  versao: number,
  emitidoEm: Date,
): string {
  const pedacos = [
    "Contrato",
    limpar(identidade.empreendimento),
    limpar(identidade.unidade),
    limpar(identidade.comprador),
    iso(emitidoEm),
  ].filter((p) => p.length > 0);

  return `${pedacos.join(" - ").slice(0, TETO_DO_NOME)} v${versao}.pdf`;
}

/**
 * A identidade a partir do que foi preenchido.
 *
 * ⚠️ ELA VEM DO MESMO LUGAR QUE O CONTRATO, e não de uma segunda consulta. `gerais` é o que foi
 * IMPRESSO no papel: se o nome do arquivo viesse de outra leitura, um arquivo poderia dizer
 * "Quadra 02" com o contrato falando de "Quadra 01" — e quem procurasse pelo nome acharia o
 * documento errado com cara de certo.
 *
 * ⚠️ `titular` VEM À PARTE, E ISSO NÃO É DETALHE. `nome_cliente` NÃO existe em `gerais`: ele é
 * escrito por `umComprador`, dentro de `compradores[i].valores`, porque a mesma variável tem um
 * valor por comprador dentro do laço. A primeira versão desta função lia `gerais.nome_cliente` e
 * gerava, calada, `Contrato - TST - Q01 L05 - 2026-09-09 v1.pdf` — sem o nome de ninguém, que é
 * justamente o pedaço que faz alguém achar o arquivo depois. Pego pelo teste da rota.
 */
export function identidadeDoContrato(
  gerais: Record<string, string>,
  titular: string,
): IdentidadeDoContrato {
  const quadra = (gerais.numero_quadra ?? "").trim();
  const lote = (gerais.numero_lote ?? "").trim();
  const porQuadraLote = [quadra ? `Q${quadra}` : "", lote ? `L${lote}` : ""]
    .filter(Boolean)
    .join(" ");

  return {
    comprador: (titular || "").trim(),
    empreendimento: (gerais.empreendimento_codigo ?? gerais.empreendimento_nome ?? "").trim(),
    // ⚠️ O CÓDIGO DA UNIDADE VEM PRIMEIRO quando existe: é o que está no masterplan e no C2X. Onde
    // ele não existe (a maioria dos produtos do Hércules hoje), quadra e lote são o endereço que a
    // casa fala no telefone.
    unidade: (gerais.codigo_unidade ?? "").trim() || porQuadraLote,
  };
}

// ── AUXILIARES ──────────────────────────────────────────────────────────────

/** Tira o que quebra nome de arquivo e aperta o espaço em branco. */
function limpar(bruto: string): string {
  return String(bruto ?? "")
    .replace(/[\\/:*?"<>|·]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `AAAA-MM-DD` no fuso da operação.
 *
 * ⚠️ −03:00, E NÃO UTC. Um contrato gerado às 21h30 de Brasília é 00h30 do dia seguinte em UTC, e o
 * arquivo nasceria datado de amanhã — a mesma armadilha que o card do board já carrega documentada.
 */
function iso(quando: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  }).format(quando);
}

/** `DD/MM/AAAA` no fuso da operação. */
function diaBR(quando: Date): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  }).format(quando);
}
