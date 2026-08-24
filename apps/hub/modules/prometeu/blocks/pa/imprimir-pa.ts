// A FOLHA DA PA — Proposta de Aquisição em A4, UMA POR UNIDADE reservada (Lucas, 24/08).
//
// Redesenho do documento do C2X que o Lucas mandou ("acho esse layout feio"): mesma estrutura
// jurídica (planos, declarações, recibo, assinaturas), layout limpo e PRÉ-PREENCHIDO com o que
// a reserva já sabe — proponente, CPF, imobiliária, corretor, quadra/lote/área — e os três
// planos CALCULADOS do preço de tabela da unidade. O corretor só marca o plano e o vencimento.
//
// Impressão em documento isolado (iframe), padrão da casa; no posto com Chrome em modo
// quiosque a folha sai direto na A4 padrão, sem diálogo.

export type UnidadeDaPa = {
  area: null | string;
  codigo: string;
  lote: string;
  precoTabela: null | number;
  quadra: string;
  // Quando a reserva NASCEU (created_at da linha) — identificação forte: o mesmo lote pode
  // ser reservado, cancelado e reservado por outro cliente no mesmo dia; o papel na mesa
  // tem que apontar para O registro certo (Lucas, 24/08).
  reservadaEm: string;
};

export type ProponenteDaPa = {
  documento: null | string;
  nome: string;
  percentual: number;
};

export type DadosDaPa = {
  codigoCupom: string;
  corretor: null | string;
  dataExtensa: string;
  imobiliaria: null | string;
  incorporadora: null | string;
  lancamento: string;
  // Até 5 (limite do C2X); o 1º é o titular. A % de posse sai ao lado de cada um.
  proponentes: ProponenteDaPa[];
  qrDataUrl: string;
  unidades: UnidadeDaPa[];
};

const PA_CSS = `
  @page { size: A4; margin: 12mm 14mm; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 9.5pt; line-height: 1.45; }
  .folha { page-break-after: always; }
  .folha:last-child { page-break-after: auto; }
  .topo { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2.5px solid #1a1a1a; padding-bottom: 4mm; }
  .marca { font-family: Georgia, "Times New Roman", serif; font-size: 20pt; letter-spacing: 0.06em; }
  .tit { font-size: 8pt; letter-spacing: 0.22em; color: #555; margin-top: 1.5mm; text-transform: uppercase; }
  .lotebox { display: flex; gap: 4mm; text-align: center; }
  .lotebox div { border: 1px solid #1a1a1a; padding: 2mm 4mm; min-width: 18mm; }
  .lotebox i { display: block; font-style: normal; font-size: 6.5pt; letter-spacing: 0.14em; color: #555; }
  .lotebox b { font-size: 14pt; }
  .quem { display: grid; grid-template-columns: 1fr 1fr; gap: 1.5mm 8mm; margin: 4mm 0; }
  .quem div { border-bottom: 1px solid #bbb; padding: 1mm 0; }
  .quem i { font-style: normal; font-size: 6.5pt; letter-spacing: 0.12em; color: #555; display: block; }
  .quem b { font-size: 10pt; }
  .sec { font-size: 8pt; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; margin: 4mm 0 2mm; }
  .planos { width: 100%; border-collapse: collapse; }
  .planos th, .planos td { border: 1px solid #1a1a1a; padding: 1.6mm 2mm; text-align: center; }
  .planos th { font-size: 8pt; letter-spacing: 0.06em; }
  .planos .chk { font-size: 11pt; }
  .planos td b { font-size: 10pt; }
  .planos .rot { text-align: left; font-size: 7pt; color: #555; width: 24mm; border-right: 1px solid #1a1a1a; }
  .venc { border: 1px solid #1a1a1a; border-top: 0; padding: 2mm; text-align: center; font-size: 9pt; }
  .regras { font-size: 7pt; color: #333; margin-top: 2mm; line-height: 1.5; }
  .decl { font-size: 6.8pt; text-align: justify; color: #333; margin-top: 2mm; line-height: 1.45; }
  .adm { border: 1px solid #1a1a1a; margin-top: 3mm; padding: 1.6mm; text-align: center; font-size: 7pt; font-weight: 700; letter-spacing: 0.08em; }
  .recibo { border: 1px solid #1a1a1a; border-top: 0; padding: 2mm 3mm; font-size: 8pt; }
  .assin { display: flex; gap: 10mm; margin-top: 9mm; }
  .assin div { flex: 1; border-top: 1px solid #1a1a1a; padding-top: 1.5mm; text-align: center; font-size: 8pt; }
  .rodape { display: flex; align-items: center; gap: 3mm; margin-top: 4mm; padding-top: 2mm; border-top: 1px dashed #999; }
  .rodape img { width: 14mm; height: 14mm; }
  .rodape span { font-size: 7pt; color: #555; }
  .rodape b { font-size: 8pt; letter-spacing: 0.1em; }
`;

function esc(valor: string | null | undefined): string {
  return (valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function moeda(valor: null | number): string {
  if (valor == null || !Number.isFinite(valor)) return "________________";
  return valor.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}

function cpfBR(doc: string | null): string {
  const d = (doc ?? "").replace(/\D/g, "");
  if (d.length !== 11) return doc ?? "____________________";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

// Os três planos do lançamento, calculados do preço de tabela (regras do documento atual):
// Investidor 20% de sinal + 12x sem juros; Curto 30% + 24x (IPCA); Normal 10% + 180x (IPCA).
function planos(preco: null | number) {
  const p = (fracao: number, parcelas: number) => {
    if (preco == null) return { parcela: null, sinal: null };
    const sinal = preco * fracao;
    return { parcela: (preco - sinal) / parcelas, sinal };
  };
  return {
    curto: { parcelas: 24, ...p(0.3, 24) },
    investidor: { parcelas: 12, ...p(0.2, 12) },
    normal: { parcelas: 180, ...p(0.1, 180) },
  };
}

function folhaHTML(dados: DadosDaPa, unidade: UnidadeDaPa): string {
  const plano = planos(unidade.precoTabela);
  const vendedora = esc(dados.incorporadora ?? "a incorporadora do empreendimento");

  return `<div class="folha">
    <div class="topo">
      <div>
        <div class="marca">${esc(dados.lancamento)}</div>
        <div class="tit">Proposta de aquisição de imóvel</div>
      </div>
      <div class="lotebox">
        <div><i>QUADRA</i><b>${esc(unidade.quadra)}</b></div>
        <div><i>LOTE</i><b>${esc(unidade.lote)}</b></div>
        <div><i>ÁREA</i><b>${esc(unidade.area ?? "—")}</b><i>m²</i></div>
      </div>
    </div>

    <div class="quem">
      ${dados.proponentes
        .map(
          (p, indice) => `
      <div><i>${indice + 1}º PROPONENTE</i><b>${esc(p.nome)}</b></div>
      <div><i>CPF · POSSE ${String(p.percentual).replace(".", ",")}%</i><b>${esc(cpfBR(p.documento))}</b></div>`,
        )
        .join("")}
      <div><i>IMOBILIÁRIA</i><b>${esc(dados.imobiliaria ?? "")}</b></div>
      <div><i>CORRETOR</i><b>${esc(dados.corretor ?? "")}</b></div>
    </div>

    <div class="sec">Forma de pagamento — marque um plano</div>
    <table class="planos">
      <tr>
        <td class="rot"></td>
        <th><span class="chk">☐</span> INVESTIDOR</th>
        <th><span class="chk">☐</span> CURTO</th>
        <th><span class="chk">☐</span> NORMAL</th>
        <th><span class="chk">☐</span> PERSONALIZADO</th>
      </tr>
      <tr>
        <td class="rot">VALOR DE TABELA</td>
        <td><b>${moeda(unidade.precoTabela)}</b></td>
        <td><b>${moeda(unidade.precoTabela)}</b></td>
        <td><b>${moeda(unidade.precoTabela)}</b></td>
        <td rowspan="4"></td>
      </tr>
      <tr>
        <td class="rot">SINAL</td>
        <td>${moeda(plano.investidor.sinal)}</td>
        <td>${moeda(plano.curto.sinal)}</td>
        <td>${moeda(plano.normal.sinal)}</td>
      </tr>
      <tr>
        <td class="rot">PARCELAS</td>
        <td>${plano.investidor.parcelas}×</td>
        <td>${plano.curto.parcelas}×</td>
        <td>${plano.normal.parcelas}×</td>
      </tr>
      <tr>
        <td class="rot">VALOR DA PARCELA</td>
        <td>${moeda(plano.investidor.parcela)}</td>
        <td>${moeda(plano.curto.parcela)}</td>
        <td>${moeda(plano.normal.parcela)}</td>
      </tr>
    </table>
    <div class="venc">DIA DE VENCIMENTO DAS PARCELAS: &nbsp; ☐ 10 &nbsp;&nbsp; ☐ 20</div>

    <p class="regras"><b>A)</b> Os preços e condições desta tabela valem para o período de lançamento. <b>B) INVESTIDOR:</b> sinal mínimo de 20% e saldo em até 12 parcelas fixas, sem juros e sem correção. <b>C) CURTO:</b> sinal mínimo de 30% e saldo em até 24 vezes, sem juros e com correção positiva do IPCA. <b>D) NORMAL:</b> sinal mínimo de 10% e saldo em até 180 parcelas fixas, com juros e correção positiva do IPCA.</p>

    <div class="sec">Declarações do proponente</div>
    <p class="decl">O presente pré-contrato, contendo a proposta acima e os pagamentos referentes ao sinal, será encaminhado à ${vendedora}, sujeito à análise, podendo ser recusado mesmo sem justificativa. Declaro estar ciente de que o contrato de promessa de compra e venda ou compra e venda com alienação fiduciária será confeccionado apenas após a entrega da documentação completa, análise de crédito e demais formalidades; que, se aprovada a proposta, o valor do sinal será apresentado ao banco para compensação imediata, equivalendo ao pagamento, com quitação registrada em contrato; e que assinarei o contrato e seus anexos digitalmente em até 7 (sete) dias úteis após notificação pela imobiliária intermediadora. A não integralização do sinal nos prazos deste documento e/ou a não assinatura do contrato na data indicada resultará na rescisão deste pré-contrato, com devolução do valor pago a título de sinal, sem indenização, perdas ou danos, e cancelamento informado por meios digitais. Declaro que contratei os serviços da(s) imobiliária(s) acima para mediação e formalização desta proposta e me comprometo a: a) se aprovada e aceita a proposta, pagar à intermediadora o valor acordado, via boleto identificado; b) em caso de recusa, receber da(s) imobiliária(s) a devolução integral do sinal de intermediação, sem despesas; c) as demais condições constam do Contrato de Corretagem, assumido na assinatura do contrato de compra e venda; d) em caso de troca de proponente, plano ou unidade, a reserva não é garantida, e em cessão de direitos será cobrado 3% do valor do contrato.</p>

    <div class="adm">USO EXCLUSIVO DO TIME ADMINISTRATIVO — NÃO PREENCHER</div>
    <div class="recibo"><b>RECIBO:</b> a cópia deste documento serve como recibo. Declaro ter recebido nesta data o valor de <b>R$ 1.000,00</b> (mil reais), por meio de: &nbsp;☐ PIX &nbsp;&nbsp;☐ Dinheiro. &nbsp;&nbsp;·&nbsp;&nbsp; ${esc(dados.dataExtensa)}</div>

    <div class="assin">
      <div>Promissário comprador</div>
      <div>Representante do promissário vendedor</div>
    </div>

    <div class="rodape">
      <img src="${dados.qrDataUrl}" alt="">
      <span><b>${esc(dados.codigoCupom)}</b> · ${esc(unidade.codigo)}<br>Reservada em ${esc(unidade.reservadaEm)} · documento gerado pelo Panteon</span>
    </div>
  </div>`;
}

function esperarImagens(doc: Document): Promise<void> {
  const imagens = Array.from(doc.images);
  return Promise.all(
    imagens.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((resolver) => {
            img.addEventListener("load", () => resolver(), { once: true });
            img.addEventListener("error", () => resolver(), { once: true });
          }),
    ),
  ).then(() => undefined);
}

/** Imprime TODAS as folhas do cupom (uma por unidade) num único documento isolado. */
export async function imprimirFolhasDaPa(dados: DadosDaPa): Promise<void> {
  if (dados.unidades.length === 0) return;

  const corpo = dados.unidades.map((u) => folhaHTML(dados, u)).join("");

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    border: "0",
    bottom: "0",
    height: "0",
    position: "fixed",
    right: "0",
    width: "0",
  });
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><style>${PA_CSS}</style></head><body>${corpo}</body></html>`,
  );
  doc.close();

  await esperarImagens(doc);

  let finalizado = false;
  const limpar = () => {
    if (finalizado) return;
    finalizado = true;
    window.setTimeout(() => iframe.remove(), 500);
  };
  win.addEventListener("afterprint", limpar, { once: true });
  window.setTimeout(limpar, 60_000);

  win.focus();
  win.print();
}
