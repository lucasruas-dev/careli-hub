// OS TEXTOS EDITÁVEIS DA PROPOSTA DE AQUISIÇÃO.
//
// ⚠️ POR QUE EXISTE (Lucas, 29/08/2026): *"temos que criar a area para editar a PA"* — e antes,
// ao aprovar o desenho da folha: *"alguns textos vão vir de alguns preenchimentos de tela nosso,
// outros podemos editar manualmente"*. As declarações jurídicas, a cláusula do sinal e a do
// plano personalizado estavam FIXAS em imprimir-pa.ts; agora vivem no `config` do evento
// (Setup do lançamento) e este arquivo carrega os padrões e a formatação.
//
// ⚠️ ONDE MORAM: `prometeu_eventos.config.paTextos` — por EVENTO, sem migration. O texto
// jurídico pode variar por lançamento (incorporadora, prazos, comissão), e o Setup é onde a
// operação já configura o evento. Quando não há nada gravado, a folha sai com os padrões
// abaixo, que são exatamente o que ela imprimia antes: quem nunca editar não vê diferença.
//
// ⚠️ NEGRITO COM *ASTERISCO*, como no WhatsApp: *8% (oito por cento)* sai em negrito na folha.
// É a convenção que o time já usa todo dia. Sub-item de declaração é linha começando com
// "a) ", "b) "... — vira a sub-lista alfabética da folha.

export type TextosDaPa = {
  /** A alínea A) do bloco de planos — a regra do pagamento do sinal. */
  clausulaSinal: string;
  /** A última alínea — o que vale para o plano personalizado. */
  clausulaPersonalizado: string;
  /** As declarações numeradas. Cada item vira um <li>; linhas "a) ..." viram sub-lista. */
  declaracoes: string[];
};

export const TEXTOS_PADRAO_DA_PA: TextosDaPa = {
  clausulaPersonalizado: "sujeito à aprovação da Empreendedora.",
  clausulaSinal:
    "Independentemente da modalidade do Plano escolhido, o valor do sinal deverá ser pago em até dois dias úteis, contados da assinatura da presente Proposta.",
  declaracoes: [
    "Estou ciente que a presente Proposta será encaminhada a Empreendedora, sujeita à análise, que será realizada em até *05 (cinco) dias úteis*. Estou (Estamos) ciente(s) de que a Empreendedora pode recursar a presente Proposta, independentemente de justificativa.",
    "Concordo (Concordamos) que, se aprovada a Proposta, o valor do sinal pago, após decotado os honorários da Empresa Imobiliária (“Honorários de Intermediação”), conforme especificado a seguir, será apresentado à Instituição Bancária, para compensação imediata no preço da unidade, equivalendo-se ao pagamento. A quitação constará no contrato de promessa de compra e venda ou compra e venda com alienação fiduciária, conforme aplicável.",
    "Declaro (Declaramos) estar ciente(s) de que o contrato de promessa de compra e venda ou compra e venda com alienação fiduciária, conforme aplicável, será confeccionado em até *07 (sete) dias úteis*, se aprovada esta Proposta. Este prazo se inicia somente após a entrega da documentação completa, pelo Proponente, à Empresa Imobiliária, no prazo que lhe for solicitado.",
    "Declaro (Declaramos) estar ciente(s) de que assinarei (assinaremos) o contrato e seus anexos digitalmente em até *7 (sete) dias úteis*, após notificação pela Empresa Imobiliária que intermediou a negociação.",
    "Estou (Estamos) ciente(s) de que o não pagamento do valor do sinal no prazo estabelecido neste documento, a não assinatura do contrato de promessa de compra e venda ou compra e venda com alienação fiduciária ou entrega da documentação, na data indicada, tornará sem validade e eficácia a presente Proposta, desobrigando a Empreendedora de qualquer compromisso decorrente deste documento. Nessa hipótese, o valor pago a título de sinal será devolvido ao Proponente em até *10 (dez) dias úteis*, contados do término do prazo para o pagamento do sinal ou do escoamento do prazo para assinatura do contrato de promessa de compra e venda ou compra e venda com alienação fiduciária, conforme aplicável, sem direito a qualquer tipo de indenização, reparação ou perdas ou danos. O cancelamento da Proposta será informado por meios digitais. O documento da Proposta será desconsiderado e não terá mais nenhum efeito.",
    "Declaro (Declaramos) que contratei (Contratamos) os serviços profissionais da(s) Empresa Imobiliária(s) mencionada(s) no quadro resumo acima, para realizar, em meu (nosso) nome, a intermediação, assim como os atos necessários para a formalização desta Proposta, estando ciente que:\na) Se a proposta for aprovada e aceita pela Empreendedora, será decotado do sinal pago pelo Proponente, sinal relativo aos Honorários de Intermediação a serem pagos à Empresa Imobiliária, os quais totalizam o percentual de *8% (oito por cento)* sobre o valor total de aquisição da unidade. O pagamento do saldo remanescente dos Honorários de Intermediação, deverá ser pagos via boleto bancário identificado como “ASAAS”. O pagamento do valor será realizado na mesma data de assinatura do contrato de promessa de compra e venda ou compra e venda com alienação fiduciária, conforme aplicável;\nb) Em caso de recusa ou não aceitação da proposta, a(s) Empresa Imobiliária(s) devolverá (devolverão) integralmente o sinal referente aos Honorários de Intermediação, sem quaisquer despesas adicionais, indenização, reparação ou perdas ou danos;\nc) As demais condições sobre a prestação de serviços estão detalhadas no Contrato de Corretagem, que será formalizado com a(s) Empresa Imobiliária(s) na mesma data de assinatura do contrato de promessa de compra e venda ou compra e venda com alienação fiduciária, conforme aplicável;",
    "Declaro estar ciente de que em caso de intenção de troca de Proponentes, é facultado a Empreendedora proceder com nova análise de crédito, no prazo de *05 (cinco) dias*, que poderá ser recusada independentemente de justificativa. Se recusada, o sinal pago pelo Proponente original será devolvido em até *10 (dez) dias úteis*, contados da recusa da cessão da Proposta, pela Empreendedora. Se aceita, será cobrado do novo Proponente o percentual de *1% (um por cento)* sobre o valor total de aquisição da unidade;",
    "Concordo que em caso de troca de proponentes, plano de pagamento ou unidade distinta da descrita no quadro resumo, não é garantida a reserva ou disponibilidade da unidade.",
    "O prazo para desistência da presente proposta é de até *07 (sete) dias*, contados de sua assinatura. O sinal pago pelo Proponente será devolvido em até *10 (dez) dias úteis*, contados da formalização da desistência.",
  ],
};

/**
 * Mescla o que o Setup gravou com os padrões — campo a campo, nunca o bloco inteiro.
 *
 * ⚠️ Um evento pode ter editado SÓ a cláusula do sinal: as declarações continuam vindo do
 * padrão. Trocar o bloco inteiro pela presença de uma chave faria o resto da folha sumir.
 */
export function resolverTextosDaPa(gravado: unknown): TextosDaPa {
  const g = (gravado ?? {}) as Partial<Record<keyof TextosDaPa, unknown>>;
  const declaracoes = Array.isArray(g.declaracoes)
    ? g.declaracoes.map((d) => String(d)).filter((d) => d.trim())
    : null;
  return {
    clausulaPersonalizado:
      typeof g.clausulaPersonalizado === "string" && g.clausulaPersonalizado.trim()
        ? g.clausulaPersonalizado
        : TEXTOS_PADRAO_DA_PA.clausulaPersonalizado,
    clausulaSinal:
      typeof g.clausulaSinal === "string" && g.clausulaSinal.trim()
        ? g.clausulaSinal
        : TEXTOS_PADRAO_DA_PA.clausulaSinal,
    declaracoes: declaracoes?.length ? declaracoes : TEXTOS_PADRAO_DA_PA.declaracoes,
  };
}

function escaparHtml(texto: string): string {
  return texto
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Texto editado → HTML da folha: escapa TUDO (o texto vem de um campo livre do Setup) e só
 * então aplica o *negrito* do WhatsApp. A ordem importa: escapar depois do negrito deixaria
 * o <b> escapado; aplicar negrito antes de escapar deixaria HTML digitado passar.
 */
export function formatarLinhaDaPa(texto: string): string {
  return escaparHtml(texto).replace(/\*([^*\n]+)\*/g, "<b>$1</b>");
}

/**
 * Uma declaração → o <li> da folha. Linhas que começam com "a) ", "b) "... viram a sub-lista
 * alfabética (<ol type="a">), como o documento original.
 */
export function declaracaoParaHtml(texto: string): string {
  const linhas = texto.split(/\r?\n/);
  const corpo: string[] = [];
  const subitens: string[] = [];
  for (const linha of linhas) {
    const m = /^\s*[a-z]\)\s+(.*)$/.exec(linha);
    if (m) subitens.push(m[1]!);
    else if (linha.trim()) corpo.push(linha.trim());
  }
  let html = formatarLinhaDaPa(corpo.join(" "));
  if (subitens.length) {
    html += `<ol type="a">${subitens.map((s) => `<li>${formatarLinhaDaPa(s)}</li>`).join("")}</ol>`;
  }
  return html;
}
