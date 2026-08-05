// Extrai o resumo do relatório do Serasa: score, negativações, protestos, nome e situação.
//
// ⚠️ REESCRITO 21/jul com o SCHEMA REAL de PF (RELATORIO_AVANCADO_TOP_SCORE_PF_PME), capturado
// da MASSA DE TESTE que o Serasa liberou. O parser antigo errava DOIS campos, e o erro só
// apareceria na primeira consulta real (dava score e negativação errados, silenciosamente):
//
//   1. O SCORE não está em `score.score`. Nesse relatório o bloco `score` veio com
//      codeMessage 404 "Score not found"; o score de verdade está em
//      `attributes.attributesResponse[0].scoring` (ex.: 663, attributeModel "HRP4").
//   2. As NEGATIVAÇÕES não estão nas listas. `pefinResponse[]`, `checkResponse[]` etc vêm
//      VAZIAS mesmo quando há ocorrências; a contagem real está em
//      `negativeData.<bloco>.summary.count` (no fixture: refin 1, check 3, collectionRecords 4).
//
// Schema PF confirmado (reports[0]):
//   registration.{documentNumber, consumerName, motherName, birthDate, statusRegistration}
//   negativeData.{pefin,refin,notary,check,collectionRecords}.summary.{count, balance}
//   attributes.attributesResponse[].{scoring, attributeModel, message}   ← o score
//   facts.inquirySummary.inquiryQuantity.actual                          ← consultas anteriores
//
// Compatível com PJ (registration.companyName; mesmo negativeData.summary; fallback score.score).
// Fixture real em apps/hub/lib/serasa/exemplo-resposta-pf.json.
// Nunca lança: um resumo que falha não pode derrubar a gravação de uma consulta JÁ PAGA.

export type ResumoRelatorio = {
  // A API diz se ESTA consulta foi cobrada. Vale mais que qualquer estimativa nossa.
  cobrado?: boolean;
  consultasAnteriores?: number;
  faixa?: string;
  // Mensagem do Serasa quando o score não pôde ser calculado ("Score not found", etc).
  mensagemScore?: string;
  negativacoes?: number;
  nome?: string;
  origemScore?: string;
  protestos?: number;
  score?: number;
  situacao?: string;
};

function comoTexto(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function comoLista(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function comoRegistro(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

// Conta as negativações lidando com os DOIS schemas que já vimos:
//   · PF (AVANCADO_TOP_SCORE): a contagem está em `summary.count` e as listas vêm VAZIAS.
//   · PJ (BASICO): `summary.count` não existe e a contagem está no tamanho das listas.
// Regra: se houver `summary.count`, ele manda; senão, conta as listas. Cartório (notary) é
// protesto; o resto é negativação.
function contarNegativacoes(negativeData: Record<string, unknown> | undefined): {
  negativacoes: number;
  protestos: number;
} {
  let negativacoes = 0;
  let protestos = 0;
  if (!negativeData) return { negativacoes, protestos };

  for (const [bloco, conteudo] of Object.entries(negativeData)) {
    const dentro = comoRegistro(conteudo);
    if (!dentro) continue;

    const count = comoRegistro(dentro.summary)?.count;
    let ocorrencias: number;
    if (count !== undefined && count !== null && Number.isFinite(Number(count))) {
      ocorrencias = Number(count);
    } else {
      ocorrencias = 0;
      for (const valor of Object.values(dentro)) ocorrencias += comoLista(valor).length;
    }
    if (ocorrencias <= 0) continue;

    if (bloco === "notary") protestos += ocorrencias;
    else negativacoes += ocorrencias;
  }

  return { negativacoes, protestos };
}

// Score do bloco `attributes` (é onde o RELATORIO_AVANCADO_TOP_SCORE_PF entrega). Devolve o
// primeiro `scoring` válido e o modelo (attributeModel).
function scoreDosAtributos(relatorio: Record<string, unknown>): {
  faixa?: string;
  origem?: string;
  valor?: number;
} {
  const lista = comoLista(comoRegistro(relatorio.attributes)?.attributesResponse);
  for (const item of lista) {
    const attr = comoRegistro(item);
    const n = Number(attr?.scoring);
    if (Number.isFinite(n) && n > 0 && n <= 1000) {
      return {
        faixa: comoTexto(attr?.attributeModel),
        origem: "reports[0].attributes.attributesResponse[].scoring",
        valor: n,
      };
    }
  }
  return {};
}

// Último recurso: varre a árvore atrás de um número que pareça score. Fica como rede de
// segurança para variações de schema que ainda não vimos.
function procurarScoreSolto(corpo: unknown): { origem?: string; valor?: number } {
  const achado: { origem?: string; valor?: number } = {};
  const visitar = (o: unknown, caminho: string, prof: number): void => {
    if (prof > 6 || achado.valor !== undefined || !o || typeof o !== "object") return;
    if (Array.isArray(o)) {
      o.slice(0, 20).forEach((x, i) => visitar(x, `${caminho}.${i}`, prof + 1));
      return;
    }
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      const atual = caminho ? `${caminho}.${k}` : k;
      if (/^(scoring|score|scoreValue|pontuacao|creditScore)$/i.test(k)) {
        const n = typeof v === "number" ? v : Number(v);
        if (Number.isFinite(n) && n >= 0 && n <= 1000) {
          achado.origem = atual;
          achado.valor = n;
          return;
        }
      }
      visitar(v, atual, prof + 1);
    }
  };
  try {
    visitar(corpo, "", 0);
  } catch {
    return achado;
  }
  return achado;
}

export function resumirRelatorio(corpo: unknown): ResumoRelatorio {
  const resumo: ResumoRelatorio = {};
  if (!corpo || typeof corpo !== "object") return resumo;

  try {
    const raiz = corpo as Record<string, unknown>;
    const relatorio = comoRegistro(comoLista(raiz.reports)[0]) ?? {};

    const registro = comoRegistro(relatorio.registration);
    // PF usa consumerName; PJ usa companyName. `name` fica de reserva.
    resumo.nome =
      comoTexto(registro?.consumerName) ??
      comoTexto(registro?.companyName) ??
      comoTexto(registro?.name);
    resumo.situacao = comoTexto(registro?.statusRegistration);

    // Score de crédito. A FONTE PRIMÁRIA é o bloco `score` (PRODUÇÃO: score.score=916, modelo HRLN,
    // codeMessage 99). Só quando ele não traz score válido — foi o caso da HOMOLOGAÇÃO, que devolvia
    // codeMessage 404 "Score not found" — é que se usa `attributes.attributesResponse[].scoring`
    // (663, HRP4). Nunca o contrário: em produção o `scoring` de attributes é de OUTRO modelo
    // (HRP5, ex.: 3722/5017), numa escala diferente, e NÃO é o score de crédito.
    const score = comoRegistro(relatorio.score);
    if (score) {
      for (const chave of ["score", "scoreValue", "value", "pontuacao"]) {
        const n = Number(score[chave]);
        if (Number.isFinite(n) && n > 0 && n <= 1000) {
          resumo.score = n;
          resumo.origemScore = `reports[0].score.${chave}`;
          resumo.faixa = comoTexto(score.scoreModel);
          break;
        }
      }
      // A mensagem do bloco score explica quando o score não pôde ser calculado.
      if (resumo.score === undefined) resumo.mensagemScore = comoTexto(score.message);
      // `billing` diz se ESTA consulta foi cobrada — melhor que qualquer estimativa nossa.
      if (typeof score.billing === "boolean") resumo.cobrado = score.billing;
    }

    // Fallback (HOMOLOGAÇÃO): quando o bloco `score` não trouxe score, o valor real está em
    // `attributes`. Em produção este ramo não é alcançado, porque score.score já resolveu.
    if (resumo.score === undefined) {
      const dosAtributos = scoreDosAtributos(relatorio);
      if (dosAtributos.valor !== undefined) {
        resumo.score = dosAtributos.valor;
        resumo.origemScore = dosAtributos.origem;
        resumo.faixa = dosAtributos.faixa;
      }
    }

    // Cobrança (`billing`): em produção não vem no bloco `score`, e sim no primeiro atributo.
    if (resumo.cobrado === undefined) {
      const attr0 = comoRegistro(
        comoLista(comoRegistro(relatorio.attributes)?.attributesResponse)[0],
      );
      if (typeof attr0?.billing === "boolean") resumo.cobrado = attr0.billing;
    }

    const { negativacoes, protestos } = contarNegativacoes(comoRegistro(relatorio.negativeData));
    resumo.negativacoes = negativacoes;
    resumo.protestos = protestos;

    // Consultas anteriores: PF em facts.inquirySummary.inquiryQuantity.actual; PJ em
    // facts.inquiryCompanyResponse.quantity.actual. Tenta os dois caminhos.
    const facts = comoRegistro(relatorio.facts);
    const atualPf = Number(
      comoRegistro(comoRegistro(facts?.inquirySummary)?.inquiryQuantity)?.actual,
    );
    const atualPj = Number(
      comoRegistro(comoRegistro(facts?.inquiryCompanyResponse)?.quantity)?.actual,
    );
    if (Number.isFinite(atualPf)) resumo.consultasAnteriores = atualPf;
    else if (Number.isFinite(atualPj)) resumo.consultasAnteriores = atualPj;

    // Rede de segurança: schema inesperado sem score direto.
    if (resumo.score === undefined) {
      const solto = procurarScoreSolto(corpo);
      if (solto.valor !== undefined) {
        resumo.score = solto.valor;
        resumo.origemScore = solto.origem;
      }
    }
  } catch {
    return resumo;
  }

  return resumo;
}
