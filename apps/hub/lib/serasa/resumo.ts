// Extrai o resumo do relatório do Serasa: score, negativações e se a consulta foi cobrada.
//
// ⚠️ ESTE MÓDULO FOI REESCRITO EM 21/jul, depois de capturarmos uma RESPOSTA REAL da
// homologação. Antes era uma heurística que varria a árvore procurando chaves plausíveis,
// porque a documentação não descreve o schema. Agora lê os campos de verdade.
//
// Estrutura confirmada (RELATORIO_BASICO_PJ_PME, CNPJ 00000000000191, UAT):
//   reports[0].registration.{companyDocument, companyName, foundationDate, statusRegistration}
//   reports[0].score.{scoreModel, codeMessage, message, billing}
//   reports[0].negativeData.pefin.pefinResponse[]              → pendências financeiras
//   reports[0].negativeData.refin.refinResponse[]              → refin
//   reports[0].negativeData.collectionRecords.collectionRecordsResponse[]
//   reports[0].negativeData.check.checkResponse[]              → cheques sem fundo
//   reports[0].negativeData.notary.summary.{count, balance}    → protestos em cartório
//   reports[0].facts.inquiryCompanyResponse.quantity.{actual, bankActual}
//
// A heurística de varredura CONTINUA como último recurso: o schema de PF ainda não foi
// capturado (a base de homologação não devolveu nenhum CPF nosso), e os nomes podem diferir.
// Se a leitura direta não achar nada, ela tenta a varredura antes de desistir.
//
// Nunca lança: um resumo que falha não pode derrubar a gravação de uma consulta JÁ PAGA.

export type ResumoRelatorio = {
  // A API diz se ESTA consulta foi cobrada. Vale mais que qualquer estimativa nossa.
  cobrado?: boolean;
  consultasAnteriores?: number;
  faixa?: string;
  // Mensagem do Serasa quando o score não pôde ser calculado ("INSUFICIENCIA INFORMACOES").
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

// Conta as ocorrências de cada tipo de negativação. As listas vêm com nome próprio dentro de
// cada bloco (pefin → pefinResponse), então a busca é pela primeira lista encontrada.
function contarNegativacoes(negativeData: Record<string, unknown> | undefined): {
  negativacoes: number;
  protestos: number;
} {
  let negativacoes = 0;
  let protestos = 0;
  if (!negativeData) return { negativacoes, protestos };

  for (const [bloco, conteudo] of Object.entries(negativeData)) {
    if (!conteudo || typeof conteudo !== "object") continue;
    const dentro = conteudo as Record<string, unknown>;

    // Cartório traz contagem pronta em vez de lista.
    if (bloco === "notary") {
      const resumo = dentro.summary as Record<string, unknown> | undefined;
      const count = Number(resumo?.count ?? 0);
      if (Number.isFinite(count)) protestos += count;
      continue;
    }

    for (const valor of Object.values(dentro)) {
      const lista = comoLista(valor);
      if (lista.length) negativacoes += lista.length;
    }
  }

  return { negativacoes, protestos };
}

// Último recurso: varre a árvore atrás de um número que pareça score. Fica porque o schema de
// PF ainda não foi visto — quando for, esta função provavelmente sai.
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
      if (/^(score|scoreValue|pontuacao|creditScore)$/i.test(k)) {
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
    const relatorio = (comoLista(raiz.reports)[0] ?? {}) as Record<string, unknown>;

    const registro = relatorio.registration as Record<string, unknown> | undefined;
    resumo.nome = comoTexto(registro?.companyName) ?? comoTexto(registro?.name);
    resumo.situacao = comoTexto(registro?.statusRegistration);

    const score = relatorio.score as Record<string, unknown> | undefined;
    if (score) {
      // Quando o Serasa calcula, o valor vem num campo numérico; quando não, vem só a
      // mensagem ("SCORE NAO CALCULADO - INSUFICIENCIA INFORMACOES").
      for (const chave of ["score", "scoreValue", "value", "pontuacao"]) {
        const n = Number(score[chave]);
        if (Number.isFinite(n) && n > 0 && n <= 1000) {
          resumo.score = n;
          resumo.origemScore = `reports[0].score.${chave}`;
          break;
        }
      }
      resumo.mensagemScore = comoTexto(score.message);
      resumo.faixa = comoTexto(score.scoreModel);
      // `billing` diz se ESTA consulta foi cobrada — melhor que qualquer estimativa nossa.
      if (typeof score.billing === "boolean") resumo.cobrado = score.billing;
    }

    const { negativacoes, protestos } = contarNegativacoes(
      relatorio.negativeData as Record<string, unknown> | undefined,
    );
    resumo.negativacoes = negativacoes;
    resumo.protestos = protestos;

    const consultas = (relatorio.facts as Record<string, unknown> | undefined)
      ?.inquiryCompanyResponse as Record<string, unknown> | undefined;
    const quantidade = consultas?.quantity as Record<string, unknown> | undefined;
    const atual = Number(quantidade?.actual);
    if (Number.isFinite(atual)) resumo.consultasAnteriores = atual;

    // Schema diferente do esperado (provável em PF, ainda não capturado): tenta a varredura.
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
