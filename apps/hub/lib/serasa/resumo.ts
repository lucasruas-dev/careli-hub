// Extrai um resumo pequeno do relatório do Serasa (score, faixa, negativações) para a tela
// listar e ordenar sem abrir o JSON inteiro.
//
// ⚠️ O SCHEMA DA RESPOSTA NÃO ESTÁ DOCUMENTADO campo a campo. O swagger declara o envelope
// (`reports[]` no PF), mas os nomes internos de score e negativação não foram confirmados —
// é uma das perguntas em aberto com o Serasa (21/jul).
//
// Por isso este módulo é DEFENSIVO por definição: varre a árvore procurando chaves plausíveis
// e devolve `{}` quando não encontra. O relatório CRU fica salvo em `serasa_consultas.resposta`,
// então nada se perde — quando a primeira consulta real chegar, a gente olha o corpo de
// verdade e troca esta heurística por leitura direta dos campos certos.
//
// Nunca lança: um resumo que falha não pode derrubar a gravação de uma consulta JÁ PAGA.

export type ResumoRelatorio = {
  faixa?: string;
  negativacoes?: number;
  score?: number;
  // Caminho onde o score foi encontrado, para conferência humana ("score veio de reports.0.score").
  origemScore?: string;
  totalEmAbertoCentavos?: number;
};

const CHAVES_SCORE = /^(score|scoreValue|pontuacao|scorePositivo|creditScore)$/i;
const CHAVES_FAIXA = /^(faixa|riskLevel|classification|classificacao|scoreRange|faixaRisco)$/i;
const CHAVES_NEGATIVACAO = /(negativa|pendencia|restricao|debt|occurrence)/i;

// Percorre a árvore até uma profundidade razoável. Relatórios de birô são aninhados, mas não
// infinitos; o limite existe para não varrer estrutura circular.
function percorrer(
  valor: unknown,
  visitar: (chave: string, valor: unknown, caminho: string) => void,
  caminho = "",
  profundidade = 0,
): void {
  if (profundidade > 8 || valor === null || typeof valor !== "object") return;

  if (Array.isArray(valor)) {
    valor.slice(0, 50).forEach((item, i) => {
      percorrer(item, visitar, `${caminho}.${i}`, profundidade + 1);
    });
    return;
  }

  for (const [chave, filho] of Object.entries(valor as Record<string, unknown>)) {
    const atual = caminho ? `${caminho}.${chave}` : chave;
    visitar(chave, filho, atual);
    percorrer(filho, visitar, atual, profundidade + 1);
  }
}

export function resumirRelatorio(corpo: unknown): ResumoRelatorio {
  const resumo: ResumoRelatorio = {};
  if (!corpo || typeof corpo !== "object") return resumo;

  try {
    percorrer(corpo, (chave, valor, caminho) => {
      // SCORE: primeiro número plausível numa chave com cara de score. Faixa 0–1000 é a do
      // mercado brasileiro; fora disso provavelmente é outro campo com nome parecido.
      if (resumo.score === undefined && CHAVES_SCORE.test(chave)) {
        const numero = typeof valor === "number" ? valor : Number(valor);
        if (Number.isFinite(numero) && numero >= 0 && numero <= 1000) {
          resumo.score = numero;
          resumo.origemScore = caminho;
        }
      }

      if (resumo.faixa === undefined && CHAVES_FAIXA.test(chave)) {
        if (typeof valor === "string" && valor.trim()) resumo.faixa = valor.trim().slice(0, 60);
      }

      // NEGATIVAÇÕES: lista com cara de pendência. Conta o tamanho, não o conteúdo.
      if (resumo.negativacoes === undefined && Array.isArray(valor) && CHAVES_NEGATIVACAO.test(chave)) {
        resumo.negativacoes = valor.length;
      }
    });
  } catch {
    // Resumo é conveniência. O relatório cru já está salvo; falhar aqui não pode perder a
    // consulta paga.
    return resumo;
  }

  return resumo;
}
