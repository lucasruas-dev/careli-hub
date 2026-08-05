// DISPARO para a IMOBILIÁRIA — avisos automáticos do andamento das CADs dos clientes dela.
//
// Três eventos por cliente (crédito reprovado, PIX enviado, PIX pago) e um relatório diário. Vai
// por WhatsApp (template Meta, número 4143) E e-mail (contato@ pela Iris/Gmail). O contato da
// imobiliária vem da ENTIDADE dela, resolvida pelo vínculo "Imobiliaria da CAD" (o de-para que o
// Lucas casou). Sem vínculo/contato, o disparo é REGISTRADO como falha — não some em silêncio.
//
// Automático e só a partir de agora (não retroativo): quem já reprovou/pagou antes não recebe.
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  montarEmailImobPixEnviado,
  montarEmailImobPixPago,
  montarEmailImobReprovado,
} from "@/lib/apolo/emails-imobiliaria";
import { lerCadDaEsteira } from "@/lib/apolo/esteira-cad";
import { imobiliariaEntityIdDoCliente } from "@/lib/apolo/imobiliaria-do-cliente";
import { getCacaSender, isGmailConfigured, sendGmailMessage } from "@/lib/iris/gmail";

// Remetente destes e-mails: a caixa da Cacá (todo disparo automático sai da Cacá).
const EMAIL_FROM = getCacaSender();
import {
  MetaWhatsAppSendError,
  getMetaWhatsAppOutboundConfig,
  sendMetaWhatsAppTemplateMessage,
} from "@/lib/iris/meta-whatsapp";

// Número 4143 (Careli / Atendimento) — o mesmo dos outros templates aprovados.
const PHONE_4143 = "1167201739813897";

// Nomes dos templates na Meta (à imobiliária). UTILITY, sem header de mídia.
export const TPL_IMOB_REPROVADO = "imob_credito_reprovado";
export const TPL_IMOB_PIX_ENVIADO = "imob_pix_enviado";
export const TPL_IMOB_PIX_PAGO = "imob_pix_pago";
export const TPL_IMOB_RELATORIO = "imob_relatorio_disponivel";

// E.164 sem "+", DDI 55, exigindo celular BR (mesma trava do disparo de PIX).
const CELULAR_BR = /^55[1-9][0-9]9[0-9]{8}$/;
function normalizarCelular(valor: string | null | undefined): string | null {
  const d = String(valor ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  const comDdi = d.startsWith("55") && d.length >= 12 ? d : `55${d}`;
  const legado = /^55([1-9][0-9])([6-9][0-9]{7})$/.exec(comDdi);
  const corr = legado ? `55${legado[1]}9${legado[2]}` : comDdi;
  return CELULAR_BR.test(corr) ? corr : null;
}

export type ContatoImobiliaria = {
  email: string | null;
  entityId: string | null;
  nome: string;
  telefone: string | null;
};

// Nome + contato de uma ENTIDADE imobiliária (pelo id dela). É a fonte da verdade do destinatário:
// o relatório resolve por AQUI (a imobiliária já é conhecida), nunca re-derivando de um cliente —
// senão, se um cliente tivesse mais de um vínculo, o relatório poderia ir para a imobiliária errada.
export async function contatoDaEntidadeImobiliaria(
  client: SupabaseClient,
  imobEntityId: string,
): Promise<ContatoImobiliaria> {
  const { data: ent } = await client
    .from("apolo_entities")
    .select("display_name, legal_name, trade_name")
    .eq("id", imobEntityId)
    .maybeSingle<{
      display_name: string | null;
      legal_name: string | null;
      trade_name: string | null;
    }>();
  // NOME DE EXIBIÇÃO primeiro (decisão do Lucas em 26/07), razão social só como último recurso.
  // Quem lê o relatório é a imobiliária, e ela se reconhece pelo nome com que trabalha — a razão
  // social é frequentemente o nome da pessoa física por trás do CNPJ, ou traz erro de digitação
  // do cadastro. Casos reais: "DIIMOVEIS" saía como "EDMILSON LINO DA SILVA", "FR FREITAS
  // IMOVEIS" como "L A DE FREITAS" e "TRINDADE IMOVEIS" como "RTRINDADE EMPREENDIMENTOS LTDA"
  // (typo no cadastro). Ver [[reference_apolo_imobiliaria_duas_fontes]].
  const nome =
    (ent?.display_name || ent?.trade_name || ent?.legal_name || "").trim() ||
    "a imobiliária";

  const { data: contatos } = await client
    .from("apolo_contacts")
    .select("contact_type, value, is_primary")
    .eq("entity_id", imobEntityId)
    .limit(30);

  const lista = (contatos ?? []) as Array<{
    contact_type: string | null;
    is_primary: boolean | null;
    value: string | null;
  }>;
  const pega = (tipos: string[]) => {
    const vale = (c: (typeof lista)[number]) =>
      tipos.includes(c.contact_type ?? "") && Boolean(c.value?.trim());
    return (
      lista.find((c) => vale(c) && c.is_primary)?.value?.trim() ??
      lista.find(vale)?.value?.trim() ??
      null
    );
  };

  return {
    email: pega(["email"]),
    entityId: imobEntityId,
    nome,
    telefone: pega(["whatsapp", "phone"]),
  };
}

// Resolve a ENTIDADE da imobiliária de uma CAD (pelo vínculo por entidade, qualquer tipo) e o
// contato dela. Ver imobiliaria-do-cliente.ts.
export async function contatoDaImobiliariaDaCad(
  client: SupabaseClient,
  entityId: string,
): Promise<ContatoImobiliaria> {
  const { imobEntityId, label } = await imobiliariaEntityIdDoCliente(client, entityId);

  if (!imobEntityId) {
    return {
      email: null,
      entityId: null,
      nome: (label ?? "").trim() || "a imobiliária",
      telefone: null,
    };
  }
  return contatoDaEntidadeImobiliaria(client, imobEntityId);
}

// Registra cada envio à imobiliária em apolo_disparos (best-effort — nunca derruba o disparo).
async function registrarDisparoImob(
  client: SupabaseClient,
  r: {
    canal: "email" | "whatsapp";
    destinatario: string | null;
    entityId: string;
    erro: string | null;
    template: string;
    tipo: string;
  },
): Promise<void> {
  try {
    await client.from("apolo_disparos").insert({
      destinatario: r.destinatario,
      entity_id: r.entityId,
      erro: r.erro,
      origem: `imobiliaria:${r.canal}`,
      status: r.erro ? "falhou" : "enviado",
      telefone: r.canal === "whatsapp" ? r.destinatario : null,
      template: r.template,
      tipo: r.tipo,
    });
  } catch {
    /* best-effort */
  }
}

export type EnvioCanal = { destino: string | null; erro: string | null; ok: boolean };

// Dispara UM evento para a imobiliária: WhatsApp (template) + e-mail. Cada canal devolve seu status.
// O `contato` já vem resolvido (o caller pega o nome da imobiliária para montar os parâmetros).
async function dispararParaImobiliaria(input: {
  bodyParametersWa: string[];
  client: SupabaseClient;
  contato: ContatoImobiliaria;
  emailAssunto: string;
  emailHtml: string;
  emailTexto: string;
  entityIdCliente: string;
  templateWa: string;
  tipoRegistro: string;
}): Promise<{ email: EnvioCanal; whatsapp: EnvioCanal }> {
  const { client, contato } = input;

  // WHATSAPP
  const telefone = normalizarCelular(contato.telefone);
  let whatsapp: EnvioCanal = { destino: contato.telefone, erro: null, ok: false };
  if (!contato.telefone) {
    whatsapp = { destino: null, erro: "erro: imobiliária sem telefone", ok: false };
  } else if (!telefone) {
    whatsapp = { destino: contato.telefone, erro: "erro: telefone não é celular BR", ok: false };
  } else {
    try {
      await sendMetaWhatsAppTemplateMessage({
        bodyParameters: input.bodyParametersWa,
        config: { ...getMetaWhatsAppOutboundConfig(), phoneNumberId: PHONE_4143 },
        language: "pt_BR",
        name: input.templateWa,
        to: telefone,
      });
      whatsapp = { destino: telefone, erro: null, ok: true };
    } catch (e) {
      const msg = e instanceof MetaWhatsAppSendError ? e.message : (e as Error).message;
      whatsapp = { destino: telefone, erro: `erro: ${msg}`, ok: false };
    }
  }
  await registrarDisparoImob(client, {
    canal: "whatsapp",
    destinatario: whatsapp.destino,
    entityId: input.entityIdCliente,
    erro: whatsapp.erro,
    template: input.templateWa,
    tipo: input.tipoRegistro,
  });

  // E-MAIL
  let email: EnvioCanal = { destino: contato.email, erro: null, ok: false };
  if (!contato.email) {
    email = { destino: null, erro: "erro: imobiliária sem e-mail", ok: false };
  } else if (!isGmailConfigured()) {
    email = { destino: contato.email, erro: "erro: Gmail não configurado", ok: false };
  } else {
    try {
      await sendGmailMessage({
        bodyHtml: input.emailHtml,
        bodyText: input.emailTexto,
        from: EMAIL_FROM,
        subjectLine: input.emailAssunto,
        to: contato.email,
      });
      email = { destino: contato.email, erro: null, ok: true };
    } catch (e) {
      email = { destino: contato.email, erro: `erro: ${(e as Error).message}`, ok: false };
    }
  }
  await registrarDisparoImob(client, {
    canal: "email",
    destinatario: contato.email,
    entityId: input.entityIdCliente,
    erro: email.erro,
    template: `${input.templateWa}_email`,
    tipo: input.tipoRegistro,
  });

  return { email, whatsapp };
}

// TRAVA DE IDEMPOTÊNCIA: já avisamos a imobiliária deste EVENTO para este cliente? Evita o
// segundo aviso quando o mesmo evento roda de novo (reenvio manual do PIX pela bancada, reconsulta
// de crédito). Só conta um disparo BEM-SUCEDIDO — se falhou nos dois canais, pode tentar de novo.
async function jaAvisou(
  client: SupabaseClient,
  entityId: string,
  tipo: string,
): Promise<boolean> {
  const { data } = await client
    .from("apolo_disparos")
    .select("id")
    .eq("entity_id", entityId)
    .eq("tipo", tipo)
    .eq("status", "enviado")
    .limit(1);
  return (data?.length ?? 0) > 0;
}

// Dados da CAD (cliente, corretor, empreendimento) para montar os avisos. Best-effort.
async function dadosDaCad(
  client: SupabaseClient,
  entityId: string,
): Promise<{ cliente: string; corretor: string; empreendimento: string }> {
  const { data: ent } = await client
    .from("apolo_entities")
    .select("display_name, legal_name")
    .eq("id", entityId)
    .maybeSingle<{ display_name: string | null; legal_name: string | null }>();
  // Sem empreendimento no escopo: a CAD MAIS RECENTE. Quem chama aqui (avisos à imobiliária) vem
  // do fluxo do PIX, e o aviso é sempre sobre o movimento que acabou de acontecer — que é o da
  // CAD mais recentemente mexida. Ordem explícita em `lerCadDaEsteira`, nunca a natural.
  const est = await lerCadDaEsteira<{ corretor: string | null; empreendimento: string | null }>(
    client,
    entityId,
    "corretor, empreendimento",
  );
  return {
    cliente: (ent?.legal_name || ent?.display_name || "").trim() || "o cliente",
    corretor: (est?.corretor ?? "").trim() || "—",
    empreendimento: (est?.empreendimento ?? "").trim() || "o empreendimento",
  };
}

// AVISO: crédito reprovado. Chamado no gatilho que manda a ficha para revisão.
export async function avisarImobReprovado(
  client: SupabaseClient,
  entityId: string,
): Promise<void> {
  if (await jaAvisou(client, entityId, "imob_credito_reprovado")) return;
  const contato = await contatoDaImobiliariaDaCad(client, entityId);
  const { cliente, corretor, empreendimento } = await dadosDaCad(client, entityId);
  const email = montarEmailImobReprovado({ cliente, corretor, empreendimento, imobiliaria: contato.nome });
  await dispararParaImobiliaria({
    bodyParametersWa: [contato.nome, cliente, corretor, empreendimento],
    client,
    contato,
    emailAssunto: email.subjectLine,
    emailHtml: email.bodyHtml,
    emailTexto: email.bodyText,
    entityIdCliente: entityId,
    templateWa: TPL_IMOB_REPROVADO,
    tipoRegistro: "imob_credito_reprovado",
  });
}

// AVISO: PIX enviado ao cliente, com o STATUS do envio (WhatsApp/e-mail enviado ou erro + hora).
export async function avisarImobPixEnviado(
  client: SupabaseClient,
  entityId: string,
  status: string,
): Promise<void> {
  if (await jaAvisou(client, entityId, "imob_pix_enviado")) return;
  const contato = await contatoDaImobiliariaDaCad(client, entityId);
  const { cliente, corretor, empreendimento } = await dadosDaCad(client, entityId);
  const email = montarEmailImobPixEnviado({
    cliente,
    corretor,
    empreendimento,
    imobiliaria: contato.nome,
    status,
  });
  await dispararParaImobiliaria({
    bodyParametersWa: [contato.nome, cliente, corretor, empreendimento, status],
    client,
    contato,
    emailAssunto: email.subjectLine,
    emailHtml: email.bodyHtml,
    emailTexto: email.bodyText,
    entityIdCliente: entityId,
    templateWa: TPL_IMOB_PIX_ENVIADO,
    tipoRegistro: "imob_pix_enviado",
  });
}

// AVISO: PIX pago, com o STATUS do comprovante ao cliente.
export async function avisarImobPixPago(
  client: SupabaseClient,
  entityId: string,
  status: string,
): Promise<void> {
  if (await jaAvisou(client, entityId, "imob_pix_pago")) return;
  const contato = await contatoDaImobiliariaDaCad(client, entityId);
  const { cliente, empreendimento } = await dadosDaCad(client, entityId);
  const email = montarEmailImobPixPago({ cliente, empreendimento, imobiliaria: contato.nome, status });
  await dispararParaImobiliaria({
    bodyParametersWa: [contato.nome, cliente, empreendimento, status],
    client,
    contato,
    emailAssunto: email.subjectLine,
    emailHtml: email.bodyHtml,
    emailTexto: email.bodyText,
    entityIdCliente: entityId,
    templateWa: TPL_IMOB_PIX_PAGO,
    tipoRegistro: "imob_pix_pago",
  });
}

// DISPARO DO RELATÓRIO diário: e-mail com o HTML (o relatório em si) + WhatsApp avisando que foi
// enviado por e-mail (template 4). Registra em apolo_disparos com a entidade da IMOBILIÁRIA.
export async function dispararRelatorioImob(
  client: SupabaseClient,
  input: {
    contato: { email: string | null; telefone: string | null };
    emailAssunto: string;
    emailHtml: string;
    emailTexto: string;
    empreendimento: string;
    imobEntityId: string;
    imobNome: string;
  },
): Promise<{ email: EnvioCanal; whatsapp: EnvioCanal }> {
  const { contato } = input;

  // E-MAIL — leva o relatório (HTML).
  let email: EnvioCanal = { destino: contato.email, erro: null, ok: false };
  if (!contato.email) {
    email = { destino: null, erro: "erro: imobiliária sem e-mail", ok: false };
  } else if (!isGmailConfigured()) {
    email = { destino: contato.email, erro: "erro: Gmail não configurado", ok: false };
  } else {
    try {
      await sendGmailMessage({
        bodyHtml: input.emailHtml,
        bodyText: input.emailTexto,
        from: EMAIL_FROM,
        subjectLine: input.emailAssunto,
        to: contato.email,
      });
      email = { destino: contato.email, erro: null, ok: true };
    } catch (e) {
      email = { destino: contato.email, erro: `erro: ${(e as Error).message}`, ok: false };
    }
  }
  await registrarDisparoImob(client, {
    canal: "email",
    destinatario: contato.email,
    entityId: input.imobEntityId,
    erro: email.erro,
    template: `${TPL_IMOB_RELATORIO}_email`,
    tipo: "imob_relatorio",
  });

  // WHATSAPP — só AVISA que o relatório foi enviado para o e-mail (template 4).
  const telefone = normalizarCelular(contato.telefone);
  let whatsapp: EnvioCanal = { destino: contato.telefone, erro: null, ok: false };
  if (!telefone) {
    whatsapp = {
      destino: contato.telefone,
      erro: contato.telefone ? "erro: telefone não é celular BR" : "erro: sem telefone",
      ok: false,
    };
  } else {
    try {
      await sendMetaWhatsAppTemplateMessage({
        bodyParameters: [input.imobNome, input.empreendimento, contato.email ?? "seu e-mail cadastrado"],
        config: { ...getMetaWhatsAppOutboundConfig(), phoneNumberId: PHONE_4143 },
        language: "pt_BR",
        name: TPL_IMOB_RELATORIO,
        to: telefone,
      });
      whatsapp = { destino: telefone, erro: null, ok: true };
    } catch (e) {
      const msg = e instanceof MetaWhatsAppSendError ? e.message : (e as Error).message;
      whatsapp = { destino: telefone, erro: `erro: ${msg}`, ok: false };
    }
  }
  await registrarDisparoImob(client, {
    canal: "whatsapp",
    destinatario: whatsapp.destino,
    entityId: input.imobEntityId,
    erro: whatsapp.erro,
    template: TPL_IMOB_RELATORIO,
    tipo: "imob_relatorio",
  });

  return { email, whatsapp };
}

// STATUS de envio ao cliente, em uma frase, para os avisos de PIX (o que o Lucas pediu). Traduz o
// erro para português acionável, com a hora do envio bem-sucedido.
export function statusEnvioAoCliente(
  whats: { erro?: string | null; hora?: string | null; ok: boolean },
  mail: { erro?: string | null; hora?: string | null; ok: boolean },
): string {
  const traduz = (erro: string | null | undefined): string => {
    const e = (erro ?? "").toLowerCase();
    if (/undeliverable|131026|not registered|133010/.test(e)) return "número sem WhatsApp";
    if (/fora do padrão|invalid.*phone|131009/.test(e)) return "telefone inválido";
    if (/sem telefone/.test(e)) return "sem telefone no cadastro";
    if (/sem e-mail/.test(e)) return "sem e-mail no cadastro";
    if (/mailbox|550|invalid.*recipient/.test(e)) return "e-mail inválido";
    return "falha no envio";
  };
  const hhmm = (iso: string | null | undefined) =>
    iso
      ? new Date(iso).toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
          timeZone: "America/Sao_Paulo",
        })
      : "";
  const wa = whats.ok ? `enviado${whats.hora ? ` ${hhmm(whats.hora)}` : ""}` : traduz(whats.erro);
  const em = mail.ok ? `enviado${mail.hora ? ` ${hhmm(mail.hora)}` : ""}` : traduz(mail.erro);
  return `WhatsApp: ${wa} · E-mail: ${em}`;
}
