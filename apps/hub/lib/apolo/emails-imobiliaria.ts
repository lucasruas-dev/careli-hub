// E-mails para a IMOBILIÁRIA: os 3 avisos de evento (mesmos do WhatsApp) e o RELATÓRIO diário.
//
// ⚠️ REGRA DE OURO (Lucas): o resultado/valor da análise de crédito NUNCA vai para a imobiliária.
// Só o STATUS — Aprovado, Reprovado, Em análise. Nada de score, restrições, limite ou valores.

export type EmailMontado = {
  bodyHtml: string;
  bodyText: string;
  subjectLine: string;
};

function moldura(conteudo: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:24px 12px;background:#f4f6fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#151b26;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
    <tr><td style="padding:28px 32px;">
${conteudo}
      <p style="margin:28px 0 0;padding-top:18px;border-top:1px solid #e9edf3;font-size:12px;line-height:1.6;color:#8592a6;">
        Careli · acompanhamento das CADs da sua imobiliária. Em caso de dúvida, é só responder este e-mail.
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapar(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragrafo(texto: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;">${texto}</p>`;
}

// ---- Avisos de evento (por cliente) ----

export function montarEmailImobReprovado(d: {
  cliente: string;
  corretor: string;
  empreendimento: string;
  imobiliaria: string;
}): EmailMontado {
  const bodyText = `Olá, ${d.imobiliaria}!

A análise de crédito do cliente ${d.cliente}, do corretor ${d.corretor}, foi indeferida. A CAD não segue nas etapas de credenciamento do empreendimento ${d.empreendimento}.

Careli`;
  const bodyHtml = moldura(
    paragrafo(`Olá, <strong>${escapar(d.imobiliaria)}</strong>!`) +
      paragrafo(
        `A análise de crédito do cliente <strong>${escapar(d.cliente)}</strong>, do corretor <strong>${escapar(d.corretor)}</strong>, foi <strong>indeferida</strong>. A CAD não segue nas etapas de credenciamento do empreendimento <strong>${escapar(d.empreendimento)}</strong>.`,
      ),
  );
  return {
    bodyHtml,
    bodyText,
    subjectLine: `CAD indeferida — ${d.cliente} (${d.empreendimento})`,
  };
}

export function montarEmailImobPixEnviado(d: {
  cliente: string;
  corretor: string;
  empreendimento: string;
  imobiliaria: string;
  status: string;
}): EmailMontado {
  const bodyText = `Olá, ${d.imobiliaria}!

O cliente ${d.cliente}, do corretor ${d.corretor}, recebeu o link de pagamento do PIX referente ao empreendimento ${d.empreendimento}.

Envio ao cliente: ${d.status}

Careli`;
  const bodyHtml = moldura(
    paragrafo(`Olá, <strong>${escapar(d.imobiliaria)}</strong>!`) +
      paragrafo(
        `O cliente <strong>${escapar(d.cliente)}</strong>, do corretor <strong>${escapar(d.corretor)}</strong>, recebeu o <strong>link de pagamento do PIX</strong> referente ao empreendimento <strong>${escapar(d.empreendimento)}</strong>.`,
      ) +
      `<p style="margin:0;font-size:13px;color:#59657a;">Envio ao cliente: <strong>${escapar(d.status)}</strong></p>`,
  );
  return {
    bodyHtml,
    bodyText,
    subjectLine: `PIX enviado — ${d.cliente} (${d.empreendimento})`,
  };
}

export function montarEmailImobPixPago(d: {
  cliente: string;
  empreendimento: string;
  imobiliaria: string;
  status: string;
}): EmailMontado {
  const bodyText = `Olá, ${d.imobiliaria}!

O PIX do cliente ${d.cliente} foi pago, finalizando o processo de cadastro no empreendimento ${d.empreendimento}.

Comprovante ao cliente: ${d.status}

Careli`;
  const bodyHtml = moldura(
    paragrafo(`Olá, <strong>${escapar(d.imobiliaria)}</strong>!`) +
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eefbf4;border:1px solid #c8ecd9;border-radius:10px;margin:0 0 16px;"><tr><td style="padding:14px 18px;font-size:15px;color:#1c8b5f;">O PIX do cliente <strong>${escapar(d.cliente)}</strong> foi pago — cadastro concluído no <strong>${escapar(d.empreendimento)}</strong>.</td></tr></table>` +
      `<p style="margin:0;font-size:13px;color:#59657a;">Comprovante ao cliente: <strong>${escapar(d.status)}</strong></p>`,
  );
  return {
    bodyHtml,
    bodyText,
    subjectLine: `PIX pago — ${d.cliente} (${d.empreendimento})`,
  };
}

// ---- Relatório diário (consolidado por imobiliária) — layout aprovado pelo Lucas ----

export type CredenciadoItem = { cliente: string; corretor: string; pix: string };
export type IncorretaItem = { cliente: string; motivo: string };
export type ErroDisparoItem = { cliente: string; erro: string };

// Logo BRANCA do C2X (header escuro). URL pública — imagem em e-mail é baixada por URL.
const LOGO_BRANCA = "https://c2x.app.br/c2x-logo-branca.png";
const WHATSAPP_CENTRAL = "https://wa.me/553199264143";

function moeda(v: number): string {
  return `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Um card do topo (número + rótulo). Tabela para sobreviver no Gmail/Outlook.
function card(valor: number | string, rotulo: string, cor: string): string {
  return `<td style="padding:0 5px;" width="16.6%" valign="top">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f7f9fc;border:1px solid #e9edf3;border-radius:9px;">
      <tr><td style="padding:11px 10px;">
        <div style="font-size:22px;font-weight:750;color:${cor};line-height:1;">${valor}</div>
        <div style="font-size:10px;color:#8592a6;font-weight:700;text-transform:uppercase;letter-spacing:.03em;margin-top:5px;">${rotulo}</div>
      </td></tr>
    </table></td>`;
}

// Cabeçalho de uma seção (barra colorida + título + contagem).
function secaoHead(titulo: string, n: number, cor: string, extra = ""): string {
  return `<tr><td style="padding:13px 18px;border-bottom:1px solid #eef1f6;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td width="4" style="background:${cor};border-radius:3px;" height="18">&nbsp;</td>
      <td style="padding-left:10px;font-size:15px;font-weight:700;color:#151b26;">${titulo}</td>
      <td style="text-align:right;font-size:12px;font-weight:700;color:${cor};">${extra || `${n}`}</td>
    </tr></table>
  </td></tr>`;
}

function chips(nomes: string[]): string {
  if (nomes.length === 0) return "";
  return `<tr><td style="padding:12px 18px;">
    ${nomes.map((n) => `<span style="display:inline-block;font-size:12.5px;padding:4px 10px;border-radius:8px;background:#eef1f5;color:#3a424f;margin:0 6px 6px 0;">${escapar(n)}</span>`).join("")}
  </td></tr>`;
}

function secaoBox(inner: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border:1px solid #e4e8ef;border-radius:14px;margin:0 0 12px;">${inner}</table>`;
}

export function montarRelatorioImobiliaria(d: {
  analiseCredito: string[];
  // Banner de RETIFICAÇÃO no topo: quando presente, o e-mail avisa que corrige e substitui um
  // envio anterior (usado no reenvio do relatório das imobiliárias que saiu com dado errado).
  avisoRetificacao?: string | null;
  credenciados: CredenciadoItem[];
  duplicadas: string[];
  empreendimento: string;
  errosDisparo: ErroDisparoItem[];
  imobiliaria: string;
  incorretas: IncorretaItem[];
  revisao: string[];
  totalCads: number;
  validacao: string[];
  valorPago: number;
}): EmailMontado {
  const pagos = d.credenciados.filter((c) => c.pix.startsWith("Pago")).length;
  const hoje = new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

  // Header escuro com a logo branca.
  const header = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#1b2530;border-radius:14px;margin:0 0 14px;">
    <tr>
      <td width="60" style="padding:20px 0 20px 22px;" valign="middle"><img src="${LOGO_BRANCA}" alt="C2X" height="40" style="display:block;height:40px;width:auto;"></td>
      <td style="padding:20px 22px 20px 16px;" valign="middle">
        <div style="font-size:11px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:#c79a5f;">Relatório de performance</div>
        <div style="font-size:19px;font-weight:700;color:#ffffff;margin-top:3px;">${escapar(d.imobiliaria)}</div>
        <div style="font-size:12.5px;color:#9fb0c2;margin-top:2px;">${escapar(d.empreendimento)} · atualizado em ${hoje}</div>
      </td>
    </tr>
  </table>`;

  const cards = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;"><tr>
    ${card(d.totalCads, "CADs", "#151b26")}
    ${card(d.credenciados.length, "Credenciados", "#127c53")}
    ${card(pagos, "PIX pagos", "#0f9d58")}
    ${card(d.revisao.length, "Em revisão", "#bb2f36")}
    ${card(d.duplicadas.length, "Duplicadas", "#8a6320")}
    ${card(d.incorretas.length, "Incorretas", "#8a6320")}
  </tr></table>`;

  // Seção Credenciados — valor recebido no título + tabela com PIX.
  const credLinhas = d.credenciados
    .map(
      (c, n) => `<tr style="background:${n % 2 ? "#fbfcfe" : "#fff"};">
      <td style="padding:8px 18px;font-size:13px;">${escapar(c.cliente)}</td>
      <td style="padding:8px 18px;font-size:13px;color:#59657a;">${escapar(c.corretor)}</td>
      <td style="padding:8px 18px;font-size:13px;${c.pix.startsWith("Pago") ? "color:#127c53;font-weight:600;" : "color:#5a6472;"}">${escapar(c.pix)}</td>
    </tr>`,
    )
    .join("");
  const secCred = d.credenciados.length
    ? secaoBox(
        secaoHead("Credenciados", d.credenciados.length, "#127c53", `${moeda(d.valorPago)} recebidos`) +
          `<tr><td style="padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr style="background:#f7f9fc;">${th("Cliente")}${th("Corretor")}${th("PIX")}</tr>${credLinhas}
          </table></td></tr>`,
      )
    : "";

  const secRevisao = d.revisao.length
    ? secaoBox(secaoHead("Crédito em Revisão", d.revisao.length, "#bb2f36") + chips(d.revisao))
    : "";
  const secValidacao = d.validacao.length
    ? secaoBox(secaoHead("Em Validação", d.validacao.length, "#245ea6") + chips(d.validacao))
    : "";
  const secAnalise = d.analiseCredito.length
    ? secaoBox(secaoHead("Em Análise de Crédito", d.analiseCredito.length, "#245ea6") + chips(d.analiseCredito))
    : "";
  const secDup = d.duplicadas.length
    ? secaoBox(secaoHead("Duplicadas", d.duplicadas.length, "#8a6320") + chips(d.duplicadas))
    : "";
  const secInc = d.incorretas.length
    ? secaoBox(
        secaoHead("CADs Incorretas", d.incorretas.length, "#8a6320") +
          `<tr><td style="padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr style="background:#f7f9fc;">${th("Cliente")}${th("Motivo")}</tr>
            ${d.incorretas.map((i, n) => `<tr style="background:${n % 2 ? "#fbfcfe" : "#fff"};"><td style="padding:8px 18px;font-size:13px;">${escapar(i.cliente)}</td><td style="padding:8px 18px;font-size:13px;color:#59657a;">${escapar(i.motivo)}</td></tr>`).join("")}
          </table></td></tr>`,
      )
    : "";
  const secErro = d.errosDisparo.length
    ? secaoBox(
        secaoHead("Erro no envio do PIX", d.errosDisparo.length, "#5a6472") +
          `<tr><td style="padding:0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr style="background:#f7f9fc;">${th("Cliente")}${th("O que aconteceu")}</tr>
            ${d.errosDisparo.map((e, n) => `<tr style="background:${n % 2 ? "#fbfcfe" : "#fff"};"><td style="padding:8px 18px;font-size:13px;">${escapar(e.cliente)}</td><td style="padding:8px 18px;font-size:13px;color:#59657a;">${escapar(e.erro)}</td></tr>`).join("")}
          </table></td></tr>`,
      )
    : "";

  const rodape = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border:1px solid #e4e8ef;border-radius:14px;margin:0 0 12px;text-align:center;">
    <tr><td style="padding:22px 18px;">
      <div style="font-size:14px;font-weight:600;color:#151b26;">Ficou com alguma dúvida?</div>
      <div style="font-size:13px;color:#6a7383;margin:4px 0 14px;">Fale com a gente na Central de Atendimento.</div>
      <a href="${WHATSAPP_CENTRAL}" style="display:inline-block;background:#25D366;color:#fff;text-decoration:none;font-size:14px;font-weight:700;padding:11px 24px;border-radius:10px;">Falar no WhatsApp</a>
    </td></tr>
  </table>
  <p style="margin:14px 0 0;text-align:center;font-size:12px;color:#8592a6;">Enviado pela <strong>Cacá</strong>, assistente da C2X · acompanhamento das CADs da sua imobiliária.</p>`;

  // Banner de retificação (só no reenvio): tarja no topo pedindo pra desconsiderar o anterior.
  const bannerRetificacao = d.avisoRetificacao
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fdecea;border:1px solid #f3b7b1;border-radius:12px;margin:0 0 14px;">
        <tr><td style="padding:13px 18px;font-size:13px;color:#8a2018;line-height:1.5;">
          <strong>Correção:</strong> ${escapar(d.avisoRetificacao)}
        </td></tr>
      </table>`
    : "";

  const bodyHtml = `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:22px 12px;background:#eef1f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#141a24;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;">
        <tr><td>${bannerRetificacao}${header}${cards}${secCred}${secRevisao}${secValidacao}${secAnalise}${secDup}${secInc}${secErro}${rodape}</td></tr>
      </table>
    </td></tr></table>
  </body></html>`;

  const bodyText = [
    d.avisoRetificacao ? `CORREÇÃO: ${d.avisoRetificacao}\n` : "",
    `Relatório de performance — ${d.imobiliaria} (${d.empreendimento})`,
    `CADs: ${d.totalCads} · Credenciados: ${d.credenciados.length} · PIX pagos: ${pagos} · Em revisão: ${d.revisao.length} · Duplicadas: ${d.duplicadas.length} · Incorretas: ${d.incorretas.length}`,
    ``,
    `Credenciados (${moeda(d.valorPago)} recebidos):`,
    ...d.credenciados.map((c) => `- ${c.cliente} (${c.corretor}): ${c.pix}`),
    d.revisao.length ? `\nCrédito em Revisão: ${d.revisao.join(", ")}` : "",
    d.duplicadas.length ? `\nDuplicadas: ${d.duplicadas.join(", ")}` : "",
    d.incorretas.length ? `\nCADs Incorretas:\n${d.incorretas.map((i) => `- ${i.cliente}: ${i.motivo}`).join("\n")}` : "",
    d.errosDisparo.length ? `\nErro no envio do PIX:\n${d.errosDisparo.map((e) => `- ${e.cliente}: ${e.erro}`).join("\n")}` : "",
    `\nDúvidas? Fale com a Central no WhatsApp: ${WHATSAPP_CENTRAL}`,
    `Enviado pela Cacá, assistente da C2X.`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    bodyHtml,
    bodyText,
    subjectLine: d.avisoRetificacao
      ? `[Correção] Relatório de performance — ${d.empreendimento} (${hoje})`
      : `Relatório de performance — ${d.empreendimento} (${hoje})`,
  };
}

function th(rotulo: string): string {
  return `<td style="padding:9px 18px;font-size:10.5px;font-weight:700;color:#59657a;text-transform:uppercase;letter-spacing:.04em;">${rotulo}</td>`;
}
