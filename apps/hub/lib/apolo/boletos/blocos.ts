// COMO O LOTE SAI DA TELA — em blocos, e não de uma vez.
//
// ⚠️ ISTO NASCEU DE UM ERRO EM PRODUÇÃO. Em 03/09/2026, às 02:35, o Lucas clicou em "Gerar 141
// boleto(s)" na carteira do Garden e a tela devolveu `Unexpected token 'A', "An error o"... is not
// valid JSON`. Quem respondeu aquilo não foi a nossa rota: a função passou dos 300 segundos que a
// Vercel concede, o gateway matou a execução e respondeu em TEXTO ("An error occurred with your
// deployment"), que o `r.json()` da tela tentou interpretar.
//
// A emissão é em série de propósito — duas linhas do mesmo CPF em paralelo criariam dois cadastros
// no Asaas —, e cada unidade custa de duas a quatro chamadas: consultar se já existe, achar ou
// criar o cliente, criar a cobrança e, com o envio automático ligado, mandar o WhatsApp. A dois
// segundos por unidade, 141 delas passam de 280 segundos. Não é um teto a ajustar: a carteira só
// cresce, e o lote inteiro deixou de caber numa requisição.
//
// ⚠️ E O CORTE NO MEIO NÃO PERDE SÓ A RESPOSTA. Os boletos criados até ali EXISTEM no Asaas; o que
// morre é a lista que dizia quais são. Quem clicou vê "erro" com dezenas de cobranças emitidas — e
// é assim que se clica de novo.

/** Um pedido de emissão: o empreendimento e quais unidades dele vão nesta requisição. */
export type BlocoDeEmissao = {
  slug: string;
  /** `undefined` significa "a carteira inteira deste slug", e o servidor decide o tamanho. */
  unidades: string[] | undefined;
};

/**
 * Quantas unidades cabem em UMA requisição.
 *
 * Vinte dão ~40 segundos no pior caso medido (com envio de WhatsApp junto), o que deixa folga de
 * sete vezes até o teto da função — e cada bloco que volta já soma no resultado da tela.
 */
export const UNIDADES_POR_REQUISICAO = 20;

/**
 * Divide o que o operador pediu em requisições que cabem no tempo da função.
 *
 * ⚠️ AS UNIDADES SÃO AGRUPADAS POR EMPREENDIMENTO, e isso é anterior ao problema do tempo: a conta
 * do Asaas vem do empreendimento. A seleção pode atravessar carteiras — na aba de teste cada linha
 * é de uma conta diferente e as seis têm a MESMA unidade `TESTE-01` —, então mandar a lista inteira
 * para cada slug faria o Guaimbé emitir a linha do On Sky, porque a unidade bate nos dois.
 *
 * ⚠️ SEM UNIDADES NOMEADAS O BLOCO VAI INTEIRO. É o pedido "emita a carteira deste slug", em que só
 * o servidor sabe o tamanho: não há como fatiar o que ainda não se contou. A tela não usa mais esse
 * caminho (o botão manda sempre a lista que está na tela), mas ele continua válido para quem chamar
 * a rota direto — e é por isso que o servidor também tem o seu próprio teto de tempo.
 */
export function blocosDaEmissao({
  alvos,
  escolhidas,
  tamanho = UNIDADES_POR_REQUISICAO,
}: {
  alvos: string[];
  escolhidas: { empreendimento: string; unidade: string }[];
  tamanho?: number;
}): BlocoDeEmissao[] {
  const porEmpreendimento = new Map<string, string[]>();
  for (const e of escolhidas) {
    const lista = porEmpreendimento.get(e.empreendimento);
    if (lista) lista.push(e.unidade);
    else porEmpreendimento.set(e.empreendimento, [e.unidade]);
  }

  // Nada selecionado: cada alvo emite a carteira inteira dele.
  const aRodar = porEmpreendimento.size > 0 ? [...porEmpreendimento.keys()] : alvos;
  const passo = Math.max(1, Math.trunc(tamanho));

  const blocos: BlocoDeEmissao[] = [];
  for (const slug of aRodar) {
    const daCarteira = porEmpreendimento.get(slug);
    if (!daCarteira || daCarteira.length === 0) {
      blocos.push({ slug, unidades: undefined });
      continue;
    }
    for (let i = 0; i < daCarteira.length; i += passo) {
      blocos.push({ slug, unidades: daCarteira.slice(i, i + passo) });
    }
  }
  return blocos;
}

/**
 * Quantas unidades este lote vai emitir — ou 0 quando algum bloco não diz.
 *
 * O zero não é "nenhuma": é "não dá para contar", e serve para a tela mostrar "Emitindo…" sem
 * número em vez de inventar um denominador errado no meio de uma emissão de cobrança.
 */
export function totalDeUnidades(blocos: BlocoDeEmissao[]): number {
  if (blocos.some((b) => !b.unidades)) return 0;
  return blocos.reduce((a, b) => a + (b.unidades?.length ?? 0), 0);
}
