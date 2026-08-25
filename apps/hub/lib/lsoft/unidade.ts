// A UNIDADE DO LSOFT VIVE EM TEXTO LIVRE — e cada empreendimento escreve do seu jeito.
//
// Pedido do Lucas (25/08/2026): *"olha a unidade ae, apto - bloco, pode trazer esse como unidade"*.
// A tela mostrava a observação inteira na coluna Unidade, virando parágrafo:
//   "PARCELA COM VALOR DE R$ 524,55 AMORTIZADOS, DEVIDO A SALDO REMANESCENTE, CONFORME ADITIVO..."
//
// ⚠️ POR QUE NÃO SAI DO BANCO: no GARDEN as colunas `quadra`/`lote` estão preenchidas (~12.800 das
// 13.212 parcelas) e a unidade sai limpa. No VALE DO SOL elas estão preenchidas em 1 e 9 de 6.776 —
// lá a unidade só existe dentro de `observacoes`, escrita à mão, com variação livre.
//
// Formatos REAIS medidos no Vale do Sol:
//   "APTO 205 BL 04 VALE DO SOL (643,87 72X)"   "VENDA AP 06 BLOCO 04."
//   "PARC. MENSAL | AP: 08 - BL: 04"            "APTO 06 BLC 1"
//   "APTO 207 BL01"                             "APTO 301 BLOCO 04 - VALE DO SOL 218.000,00"

// "08" e "8" são a mesma unidade; mostrar as duas formas faria a lista parecer ter unidades
// diferentes. Grupo de regex é `string | undefined` no TS strict, então o nulo entra aqui.
function semZeroAEsquerda(valor: string | undefined): string {
  return String(valor ?? "").replace(/^0+(?=\d)/, "");
}

/** "APTO 205 · BL 04" — o formato curto que a tela mostra. */
export function unidadeDaObservacao(observacoes: null | string): null | string {
  const texto = String(observacoes ?? "").toUpperCase();
  if (!texto) return null;

  // APTO/APT/AP, com ou sem ":" ou "-", seguido do número; depois BL/BLC/BLOCO e o número.
  // O `[\s:.-]*` no meio cobre "AP: 08 - BL: 04" e "APTO 207 BL01" de uma vez.
  const casa = texto.match(
    /\bAP(?:TO?)?[\s:.-]*(\d{1,4})\b[\s.,|-]*\bBL(?:C|OCO)?[\s:.-]*(\d{1,3})\b/,
  );
  if (casa) {
    const apto = semZeroAEsquerda(casa[1]);
    const bloco = semZeroAEsquerda(casa[2]).padStart(2, "0");
    return `APTO ${apto} · BL ${bloco}`;
  }

  // Só o apartamento, sem bloco declarado.
  const soApto = texto.match(/\bAP(?:TO?)?[\s:.-]*(\d{1,4})\b/);
  if (soApto) return `APTO ${semZeroAEsquerda(soApto[1])}`;

  // Loteamento (Garden): "LOTE: 109 QUADRA: 08" ou "LOTE 3 QUADRA 8".
  // Zero à esquerda sai aqui também: "QUADRA: 08" e "QUADRA 8" são a mesma quadra, e mostrar as
  // duas formas na mesma coluna faria a lista parecer ter unidades diferentes.
  const lote = texto.match(/\bLOTE[\s:.-]*(\d{1,4})\b/);
  const quadra = texto.match(/\bQUADRA[\s:.-]*(\d{1,3})\b/);
  if (lote && quadra) return `Q${semZeroAEsquerda(quadra[1])} L${semZeroAEsquerda(lote[1])}`;
  if (lote) return `L${semZeroAEsquerda(lote[1])}`;

  return null;
}

/**
 * A unidade para exibir: as colunas do banco primeiro, o texto livre como reserva.
 *
 * A ordem importa. Onde `quadra`/`lote` existem (Garden) eles são o dado estruturado e ganham; onde
 * não existem (Vale do Sol) caímos no parse. Nunca devolve a observação crua: sem unidade
 * reconhecível é melhor mostrar nada do que despejar um parágrafo na coluna.
 */
export function unidadeParaExibir(entrada: {
  lote?: null | string;
  observacoes?: null | string;
  quadra?: null | string;
}): null | string {
  const quadra = String(entrada.quadra ?? "").trim();
  const lote = String(entrada.lote ?? "").trim();
  if (quadra || lote) {
    return [quadra ? `Q${quadra}` : "", lote ? `L${lote}` : ""].filter(Boolean).join(" ");
  }
  return unidadeDaObservacao(entrada.observacoes ?? null);
}
