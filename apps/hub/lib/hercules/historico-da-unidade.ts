// O HISTÓRICO DE UMA UNIDADE — tudo o que aconteceu com aquele lote, quando e por quem.
//
// Pedido do Lucas (03/09/2026), na ficha da unidade: *"aqui eu quero ter um histórico de tudo que
// foi feito naquela unidade, tudo tem que ficar registrado, trazendo o que foi feito, quando, por
// quem tudo, um histórico bem completo"*.
//
// ⚠️ A UNIDADE PASSA POR VÁRIAS PESSOAS, e é isso que faz esta tela valer. O lote 01 04 do Portal
// dos Vales teve proposta de sete clientes diferentes em quatro dias de julho/2024 antes de vender:
// a linha do tempo por PROPOSTA esconde isso, porque cada proposta olha só para si. Aqui o eixo é o
// lote, e o cliente vira coluna do evento.
//
// ⚠️ OS NOMES SÃO OS DOS ONZE ESTÁGIOS DO C2X, e não os cinco do funil. A dobra existe para o
// coordenador planejar ("Análise de crédito" e "Proposta realizada" viram os dois "Proposta"); num
// histórico ela apagaria a diferença entre o que de fato aconteceu — quem quer auditoria precisa da
// transição fiel. É a mesma decisão do feed de movimentação do Apolo.
//
// ⚠️ 3.831 DAS 12.295 LINHAS NÃO TÊM ORIGEM NEM DESTINO. São gravações do C2X sem troca de estágio
// (edição do registro, recálculo). Elas continuam no histórico como "Registro atualizado": sumir
// com elas esconderia que alguém mexeu naquela proposta naquele dia, que é metade do que uma
// auditoria procura.

/** Os onze estágios do C2X pelo nome real. */
const ESTAGIO: Record<number, string> = {
  1: "Reservado",
  2: "Análise de crédito",
  3: "Contrato gerado",
  4: "Faturado",
  5: "Em assinatura",
  6: "Finalizado",
  7: "Cancelado",
  8: "Reprovado na análise",
  9: "Proposta realizada",
  10: "Em distrato",
  11: "Distratado",
};

export type PropostaDoHistorico = {
  cliente_nome: null | string;
  codigo: null | string;
  criado_em_c2x: null | string;
  etapa: string;
  id: string;
  imobiliaria_nome: null | string;
  valor: null | number | string;
};

export type MovimentoDoHistorico = {
  autor_nome: null | string;
  de_c2x: null | number;
  motivo: null | string;
  observacao: null | string;
  para_c2x: null | number;
  proposta_id: string;
  quando: string;
};

export type EventoDaUnidade = {
  /** Quem estava comprando naquele momento. A unidade passa por várias pessoas. */
  cliente: null | string;
  /** O que aconteceu, em uma frase. */
  fato: string;
  id: string;
  /** Nulo quando o C2X não gravou. */
  observacao: null | string;
  /** A proposta a que o evento pertence, para agrupar na tela se ela quiser. */
  propostaId: string;
  quando: string;
  /** Quem fez. */
  quem: null | string;
};

const texto = (v: null | string | undefined): null | string => {
  const t = String(v ?? "").trim();
  return t || null;
};

/**
 * A frase do evento.
 *
 * ⚠️ "DE → PARA" SÓ QUANDO HÁ OS DOIS. Com origem nula (3.831 linhas) o C2X está dizendo "entrou
 * neste estágio", não "veio de lá"; inventar uma origem seria escrever no histórico algo que não
 * aconteceu.
 */
function fraseDoMovimento(m: MovimentoDoHistorico): string {
  const de = m.de_c2x ? (ESTAGIO[m.de_c2x] ?? `Estágio ${m.de_c2x}`) : null;
  const para = m.para_c2x ? (ESTAGIO[m.para_c2x] ?? `Estágio ${m.para_c2x}`) : null;

  if (de && para) return `${de} → ${para}`;
  if (para) return para;
  return "Registro atualizado";
}

/**
 * Monta a linha do tempo do lote: a abertura de cada proposta mais cada movimento dela.
 *
 * A ordem é a mais recente primeiro — é assim que se lê histórico procurando "o que houve agora".
 */
export function historicoDaUnidade(
  propostas: PropostaDoHistorico[],
  movimentos: MovimentoDoHistorico[],
): EventoDaUnidade[] {
  const porProposta = new Map(propostas.map((p) => [p.id, p]));
  const eventos: EventoDaUnidade[] = [];

  for (const p of propostas) {
    if (!p.criado_em_c2x) continue;
    eventos.push({
      cliente: texto(p.cliente_nome),
      fato: texto(p.imobiliaria_nome)
        ? `Proposta aberta · ${texto(p.imobiliaria_nome)}`
        : "Proposta aberta",
      id: `abertura:${p.id}`,
      observacao: texto(p.codigo) ? `Proposta ${texto(p.codigo)}` : null,
      propostaId: p.id,
      quando: p.criado_em_c2x,
      // ⚠️ O C2X NÃO GUARDA QUEM ABRIU a proposta — só quem a moveu depois. Deixar em branco é o
      // honesto; pôr o autor do primeiro movimento seria atribuir a alguém um ato que pode não ter
      // sido dele.
      quem: null,
    });
  }

  for (const m of movimentos) {
    const p = porProposta.get(m.proposta_id);
    eventos.push({
      cliente: texto(p?.cliente_nome ?? null),
      fato: fraseDoMovimento(m),
      id: `mov:${m.proposta_id}:${m.quando}:${m.de_c2x ?? "-"}:${m.para_c2x ?? "-"}`,
      observacao: texto(m.motivo) ?? texto(m.observacao),
      propostaId: m.proposta_id,
      quando: m.quando,
      quem: texto(m.autor_nome),
    });
  }

  return eventos.sort((a, b) => b.quando.localeCompare(a.quando));
}
