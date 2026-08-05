import { Buffer } from "node:buffer";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  asaasMyAccount,
  consultarCobranca,
  criarClienteAsaas,
  criarCobrancaPix,
  obterQrCodePix,
} from "@/lib/apolo/asaas-prevenda";
import { montarCadDeEntidade } from "@/lib/apolo/cad-de-entidade";
import { remetentePrevenda } from "@/lib/apolo/cobranca-prevenda";
import { APOLO_DOCS_BUCKET } from "@/lib/apolo/documentos";
import {
  type EmailMontado,
  montarEmailCobranca,
  montarEmailRecibo,
} from "@/lib/apolo/emails-prevenda";
import {
  aoEnviarPixPrevenda,
  contatosDaFicha,
  plantarFichaPrevenda,
  registrarDisparoPrevenda,
} from "@/lib/apolo/prevenda-fluxo";
import { getCacaSender, isGmailConfigured, sendGmailMessage } from "@/lib/iris/gmail";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { lookupApoloByDocument } from "@/lib/iris/caca-agent";
import { montarCadPdf } from "@/modules/apolo/blocks/cadastro/cad-pdf";
import {
  MetaWhatsAppSendError,
  createMetaWhatsAppMessageTemplate,
  getMetaWhatsAppOutboundConfig,
  listMetaWhatsAppMessageTemplates,
  sendMetaWhatsAppTemplateMessage,
  uploadMetaWhatsAppTemplateHeaderMedia,
} from "@/lib/iris/meta-whatsapp";

// Número 4143 (Iris/atendimento) — mesma WABA dos outros templates.
const PHONE_4143 = "1167201739813897";

const TPL_COBRANCA = `Olá, {{1}}!

Estamos finalizando a sua ficha de cadastro para o lançamento do empreendimento *{{2}}*.

Para concluir o seu cadastro, realize o PIX de *R$ {{3}}* pelo link abaixo:
{{4}}

Sobre este valor:
• Será *abatido* caso você adquira uma ou mais unidades no empreendimento durante o evento de lançamento.
• Será *restituído em até 10 dias úteis* após o evento, caso não adquira nenhuma unidade.
• *Não garante a reserva de nenhuma unidade.*

Estamos enviando junto a sua ficha de cadastro, para que você possa validar as informações.`;

const TPL_RECIBO = `Olá, {{1}}!

Recebemos o seu PIX de *R$ {{2}}*, referente à sua ficha de cadastro para o lançamento do empreendimento *{{3}}*. Com isso, o seu cadastro está *concluído*.

Este valor será abatido na compra de uma ou mais unidades, ou restituído em até 10 dias úteis após o evento, caso você não adquira nenhuma.

Para agilizar uma eventual devolução, responda esta mensagem com a sua *chave PIX*. Importante: a conta precisa estar *no seu nome* (conta nominal).`;

// BANCADA de teste do Asaas (conta Gurgel): testar a comunicação, gerar um PIX real, consultar o
// status e ver os eventos que o webhook registrou. Objetivo: validar ao vivo os dois bloqueadores
// (expiração do QR e o que o webhook traz ao pagar). Ver [[project_asaas_prevenda]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

type Corpo = {
  acao?:
    | "criar-templates"
    | "disparar-cobranca"
    | "disparar-recibo"
    | "gerar-pix"
    | "status"
    | "status-templates"
    | "testar";
  // Código da CAD do cliente (o mesmo identificador da CAD) — vai na descrição e no
  // externalReference, pra casar a cobrança com a ficha no webhook.
  cadCodigo?: string;
  cpfCnpj?: string;
  // E-mail de destino: a mensagem vai SEMPRE nos dois canais (WhatsApp + e-mail).
  email?: string;
  empreendimento?: string;
  // Fluxo completo: ao emitir o PIX já dispara a cobrança (é como vai funcionar no disparo em
  // massa). Sem isso, "gerar-pix" só cria a cobrança e devolve o QR, como antes.
  enviarCobranca?: boolean;
  // Link de pagamento (invoiceUrl da cobrança) — vai no template de cobrança.
  link?: string;
  nome?: string;
  paymentId?: string;
  // Telefone de teste (WhatsApp) pros disparos de validação da bancada.
  telefone?: string;
  valor?: number;
  vencimento?: string; // yyyy-mm-dd
};

// Vencimento padrão da pré-venda (o Lucas): 30/07/2026.
const VENCIMENTO_PADRAO = "2026-07-30";

// Nomes dos 2 templates na Meta. Texto aprovado NÃO se edita livremente, então cada correção de
// conteúdo vira um nome novo (os antigos ficam ativos até o novo aprovar, sem buraco no envio):
//   prevenda_pix_*  -> dizia "confirmar sua participação", errado: quem não paga também pode
//                      comprar e ir ao evento. O PIX é ETAPA DA FICHA DE CADASTRO (CAD).
//   cad_pix_*       -> corrigiu o enquadramento, mas dizia "restituído em até 15 dias".
//   cad_pix_*_v2    -> os que valem. Nasceram com "15 dias" e o Lucas corrigiu o texto na própria
//                      Meta (10 DIAS ÚTEIS); os dois foram aprovados. É esta dupla que dispara.
const TPL_COBRANCA_NOME = "cad_pix_cobranca_v2";
const TPL_RECIBO_NOME = "cad_pix_recibo_v2";

// 1000 -> "1.000,00" (formato do parâmetro de valor nos templates).
function moedaBR(n: number): string {
  const [inteiro = "0", decimal = "00"] = n.toFixed(2).split(".");
  return `${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${decimal}`;
}

// Telefone -> E.164 sem "+" (o Meta espera DDI+DDD+numero). Garante o 55 do Brasil.
function normalizarTelefone(valor?: string): string | null {
  const digitos = (valor ?? "").replace(/\D/g, "");
  if (digitos.length < 10) return null;
  return digitos.startsWith("55") ? digitos : `55${digitos}`;
}

// PDF mínimo de amostra. Não é a CAD real: a Meta exige um EXEMPLO do documento na criação do
// template com header de mídia (não no disparo), só pra aprovar o formato.
async function gerarPdfAmostraCad(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4 retrato
  const font = await doc.embedFont(StandardFonts.Helvetica);

  page.drawText("Amostra - Ficha de cadastro (CAD)", {
    color: rgb(0.051, 0.078, 0.11),
    font,
    size: 20,
    x: 42,
    y: 780,
  });
  page.drawText("Documento de exemplo enviado a Meta para aprovacao do template.", {
    color: rgb(0.3, 0.34, 0.4),
    font,
    size: 11,
    x: 42,
    y: 752,
  });

  return Buffer.from(await doc.save());
}

// FICHA (CAD) em PDF, gerada UMA vez a partir da ficha da pessoa. Os dois canais consomem de formas
// diferentes: o WhatsApp precisa de uma signed URL (a Meta baixa por ela) e o e-mail leva os bytes
// anexados direto. null = sem ficha (o template com header de documento recusa o envio).
async function montarFichaCad(
  admin: SupabaseClient,
  entityId: string,
  nome: string,
): Promise<{ bytes: Uint8Array; fileName: string; link: string | null } | null> {
  try {
    const cad = await montarCadDeEntidade(admin, entityId);
    if (!cad) return null;

    const bytes = await montarCadPdf(cad);
    const fileName = `CAD-${nome}.pdf`;

    const bucket = process.env.APOLO_DOCS_BUCKET ?? APOLO_DOCS_BUCKET;
    const path = `bancada-cobranca/${entityId}.pdf`;
    const up = await admin.storage.from(bucket).upload(path, bytes, {
      contentType: "application/pdf",
      upsert: true,
    });
    if (up.error) return { bytes, fileName, link: null };

    // 1h de folga pra Meta baixar o PDF durante o disparo.
    const signed = await admin.storage.from(bucket).createSignedUrl(path, 60 * 60);
    return { bytes, fileName, link: signed.data?.signedUrl ?? null };
  } catch {
    return null;
  }
}

// Remetente destes e-mails. A caixa AUTENTICADA é a caca@, mas pro cliente quem fala é o contato@.
// O Gmail só aceita um "From" diferente se o endereço estiver liberado em "Enviar e-mail como" na
// conta da caca@ — se não estiver, caímos na caixa padrão pra não perder o envio.
const PREVENDA_EMAIL_FROM = getCacaSender();

// Envia o e-mail do disparo pela caixa da Iris (Gmail). NUNCA lança: o WhatsApp não pode falhar por
// causa do e-mail, então devolvemos o status de cada canal separadamente.
async function enviarEmailPrevenda(input: {
  anexo: { content: Uint8Array; filename: string; mimeType: string } | null;
  destino?: string;
  // Remetente; default = caixa da Cacá. O Vale do Ouro passa contato@ (remetentePrevenda).
  from?: string;
  montado: EmailMontado;
}): Promise<string> {
  // Sem destino ou sem Gmail configurado = a pessoa NÃO recebeu: conta como falha, pra o card
  // marcar e o envio aparecer na auditoria em vez de sumir.
  const destino = (input.destino ?? "").trim();
  if (!destino) return "erro: sem e-mail na ficha";
  if (!isGmailConfigured()) return "erro: Gmail não configurado";

  const remetente = input.from ?? PREVENDA_EMAIL_FROM;
  const base = {
    attachments: input.anexo ? [input.anexo] : undefined,
    bodyHtml: input.montado.bodyHtml,
    bodyText: input.montado.bodyText,
    subjectLine: input.montado.subjectLine,
    to: destino,
  };

  try {
    await sendGmailMessage({ ...base, from: remetente });
    return `enviado (de ${remetente})`;
  } catch (e) {
    const msg = (e as Error).message;
    // Remetente não liberado na conta: reenvia pela caixa padrão em vez de perder a mensagem.
    if (/from|sender|address|alias|not allow|permission/i.test(msg)) {
      try {
        await sendGmailMessage(base);
        return `enviado pela caixa padrão — o remetente ${remetente} ainda não está liberado na conta`;
      } catch (e2) {
        return `erro: ${(e2 as Error).message}`;
      }
    }
    return `erro: ${msg}`;
  }
}

// COBRANÇA da pré-venda nos dois canais + o movimento da esteira/fila. É o fluxo real: emitiu o
// PIX, o cliente recebe na hora. Um canal que falha NÃO derruba o outro — cada um devolve o seu
// status, que é o que deixa auditar o disparo em massa depois.
async function enviarCobrancaPrevenda(input: {
  admin: SupabaseClient;
  empreendimento: string;
  entityId: string;
  link: string;
  nome: string;
  paymentId?: string | null;
  valorFmt: string;
}): Promise<{
  anexouCad: boolean;
  destinos: { email: string | null; telefone: string | null };
  email: string;
  fluxo: { etapa: string; fila: string };
  messageId: string | null;
  whatsapp: string;
}> {
  const { admin, entityId } = input;
  const config = { ...getMetaWhatsAppOutboundConfig(), phoneNumberId: PHONE_4143 };

  // CONTATOS DA FICHA — a mesma fonte que o recibo vai usar. É o caminho real do lançamento.
  const contatos = await contatosDaFicha(admin, entityId);
  const telefone = normalizarTelefone(contatos.telefone ?? undefined);

  // A ficha (CAD) é gerada UMA vez: link assinado pro WhatsApp, bytes pro e-mail.
  const ficha = await montarFichaCad(admin, entityId, input.nome);

  let messageId: string | null = null;
  let whatsapp = "não enviado";
  if (!telefone) {
    // Ficha sem telefone TAMBÉM é falha de envio: a pessoa não recebeu. Antes esse caso nem era
    // registrado, então sumia do Board e da auditoria — num lote de 450, silenciosamente.
    whatsapp = "erro: sem telefone na ficha";
  } else {
    try {
      // {{1}} nome, {{2}} empreendimento, {{3}} valor, {{4}} link de pagamento
      const r = await sendMetaWhatsAppTemplateMessage({
        bodyParameters: [input.nome, input.empreendimento, input.valorFmt, input.link],
        config,
        headerMedia: ficha?.link
          ? { fileName: ficha.fileName, link: ficha.link, type: "document" }
          : null,
        language: "pt_BR",
        name: TPL_COBRANCA_NOME,
        to: telefone,
      });
      messageId = r.messageId;
      whatsapp = "enviado";
    } catch (e) {
      whatsapp = `erro: ${e instanceof MetaWhatsAppSendError ? e.message : (e as Error).message}`;
    }
  }
  // Registra SEMPRE — inclusive quando não havia para onde enviar.
  await registrarDisparoPrevenda(admin, {
    canal: "whatsapp",
    destinatario: telefone,
    entityId,
    erro: whatsapp.startsWith("erro") ? whatsapp : null,
    template: TPL_COBRANCA_NOME,
    tipo: "prevenda_cobranca",
    waMessageId: messageId,
  });

  const email = await enviarEmailPrevenda({
    anexo: ficha
      ? { content: ficha.bytes, filename: ficha.fileName, mimeType: "application/pdf" }
      : null,
    destino: contatos.email ?? undefined,
    from: remetentePrevenda(input.empreendimento),
    montado: montarEmailCobranca({
      empreendimento: input.empreendimento,
      link: input.link,
      nome: input.nome,
      valor: input.valorFmt,
    }),
  });
  await registrarDisparoPrevenda(admin, {
    canal: "email",
    destinatario: contatos.email,
    entityId,
    erro: email.startsWith("erro") ? email : null,
    template: "email_prevenda_cobranca",
    tipo: "prevenda_cobranca",
  });

  // Enviou o PIX: prevenda -> credenciado e entra na fila (sem pagamento ainda, vai pro fim).
  const fluxo = await aoEnviarPixPrevenda({
    client: admin,
    entityId,
    paymentId: input.paymentId,
  });

  return {
    anexouCad: Boolean(ficha),
    destinos: { email: contatos.email, telefone },
    email,
    fluxo,
    messageId,
    whatsapp,
  };
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const corpo = (await request.json().catch(() => ({}))) as Corpo;

  if (corpo.acao === "criar-templates") {
    const config = { ...getMetaWhatsAppOutboundConfig(), phoneNumberId: PHONE_4143 };
    const criarTpl = async (name: string, componentes: unknown[]) => {
      try {
        const t = await createMetaWhatsAppMessageTemplate({
          category: "UTILITY",
          components: componentes,
          config,
          language: "pt_BR",
          name,
          phoneNumberId: PHONE_4143,
        });
        return { id: t.id, name, ok: true, status: t.status };
      } catch (e) {
        const msg = e instanceof MetaWhatsAppSendError ? e.message : (e as Error).message;
        const dup = /already exists|duplicate|ja existe|2388023/i.test(msg);
        return { error: dup ? null : msg, jaExistia: dup, name, ok: dup };
      }
    };

    // A COBRANÇA vai com a FICHA (CAD) anexada, então o template precisa nascer com header de
    // DOCUMENTO. A Meta exige a amostra do documento aqui, na CRIAÇÃO (não no disparo).
    let handle: string | null = null;
    let handleErro: string | null = null;
    try {
      const amostra = await gerarPdfAmostraCad();
      const up = await uploadMetaWhatsAppTemplateHeaderMedia({
        config,
        fileBuffer: amostra,
        fileLength: amostra.byteLength,
        fileName: "amostra-cad.pdf",
        mimeType: "application/pdf",
      });
      handle = up.handle;
    } catch (e) {
      handleErro = e instanceof MetaWhatsAppSendError ? e.message : (e as Error).message;
    }

    const cobranca = handle
      ? await criarTpl(TPL_COBRANCA_NOME, [
          { example: { header_handle: [handle] }, format: "DOCUMENT", type: "HEADER" },
          {
            example: {
              body_text: [["Nivea", "Vale do Ouro", "1.000,00", "https://www.asaas.com/i/abc123"]],
            },
            text: TPL_COBRANCA,
            type: "BODY",
          },
        ])
      : {
          error: handleErro ?? "A Meta não devolveu o identificador da amostra do documento.",
          jaExistia: false,
          name: TPL_COBRANCA_NOME,
          ok: false,
        };

    const recibo = await criarTpl(TPL_RECIBO_NOME, [
      {
        example: { body_text: [["Nivea", "1.000,00", "Vale do Ouro"]] },
        text: TPL_RECIBO,
        type: "BODY",
      },
    ]);

    return NextResponse.json({ data: { cobranca, recibo } });
  }

  // Status de aprovação dos 2 templates na Meta (o Lucas precisa saber quais já saíram do "em análise").
  if (corpo.acao === "status-templates") {
    const config = { ...getMetaWhatsAppOutboundConfig(), phoneNumberId: PHONE_4143 };
    const consultar = async (name: string) => {
      try {
        const tpls = await listMetaWhatsAppMessageTemplates({
          config,
          language: "pt_BR",
          name,
          phoneNumberId: PHONE_4143,
        });
        const t = tpls.find((x) => x.name === name) ?? tpls[0];
        return { name, status: t?.status ?? "NAO_ENCONTRADO" };
      } catch (e) {
        const msg = e instanceof MetaWhatsAppSendError ? e.message : (e as Error).message;
        return { name, status: `erro: ${msg}` };
      }
    };
    const [cobranca, recibo] = await Promise.all([
      consultar(TPL_COBRANCA_NOME),
      consultar(TPL_RECIBO_NOME),
    ]);
    return NextResponse.json({ data: { templates: [cobranca, recibo] } });
  }

  // Disparo manual (cobrança ou recibo). Também parte da FICHA: os contatos saem de apolo_contacts,
  // igual ao fluxo real — o telefone/e-mail da tela servem só pra plantar na ficha antes.
  if (corpo.acao === "disparar-cobranca" || corpo.acao === "disparar-recibo") {
    const config = { ...getMetaWhatsAppOutboundConfig(), phoneNumberId: PHONE_4143 };
    const nome = (corpo.nome || "Cliente").trim();
    const empreendimento = (corpo.empreendimento || "Vale do Ouro").trim();
    const valorFmt = moedaBR(Number(corpo.valor) > 0 ? Number(corpo.valor) : 1000);

    const admin = createApoloAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "Sem acesso à base do Apolo." }, { status: 503 });
    }
    const documento = (corpo.cpfCnpj ?? "").replace(/\D/g, "");
    const match = documento.length >= 11 ? await lookupApoloByDocument(admin, documento) : null;
    if (!match?.entityId) {
      return NextResponse.json(
        { error: "Informe o CPF/CNPJ de uma ficha do Apolo: o disparo parte dela." },
        { status: 404 },
      );
    }
    const entityId = match.entityId;

    await plantarFichaPrevenda(admin, {
      email: corpo.email,
      empreendimento,
      entityId,
      telefone: corpo.telefone,
    });

    try {
      if (corpo.acao === "disparar-cobranca") {
        const link = (corpo.link || "").trim();
        if (!link) {
          return NextResponse.json(
            { error: "Gere um PIX primeiro: o link da cobranca vai na mensagem." },
            { status: 400 },
          );
        }
        const envio = await enviarCobrancaPrevenda({
          admin,
          empreendimento,
          entityId,
          link,
          nome,
          valorFmt,
        });

        return NextResponse.json({ data: envio });
      }

      // RECIBO manual — mesmo caminho do automático: contatos da ficha.
      const contatos = await contatosDaFicha(admin, entityId);
      const telefone = normalizarTelefone(contatos.telefone ?? undefined);

      let messageId: string | null = null;
      let whatsapp = "sem telefone na ficha";
      if (telefone) {
        // {{1}} nome, {{2}} valor, {{3}} empreendimento
        const r = await sendMetaWhatsAppTemplateMessage({
          bodyParameters: [nome, valorFmt, empreendimento],
          config,
          language: "pt_BR",
          name: TPL_RECIBO_NOME,
          to: telefone,
        });
        messageId = r.messageId;
        whatsapp = "enviado";
        await registrarDisparoPrevenda(admin, {
          canal: "whatsapp",
          destinatario: telefone,
          entityId,
          template: TPL_RECIBO_NOME,
          tipo: "prevenda_recibo",
          waMessageId: messageId,
        });
      }

      const email = await enviarEmailPrevenda({
        anexo: null,
        destino: contatos.email ?? undefined,
        from: remetentePrevenda(empreendimento),
        montado: montarEmailRecibo({ empreendimento, nome, valor: valorFmt }),
      });
      await registrarDisparoPrevenda(admin, {
        canal: "email",
        destinatario: contatos.email,
        entityId,
        erro: email.startsWith("erro") ? email : null,
        template: "email_prevenda_recibo",
        tipo: "prevenda_recibo",
      });

      return NextResponse.json({
        data: { destinos: { email: contatos.email, telefone }, email, messageId, whatsapp },
      });
    } catch (e) {
      const msg = e instanceof MetaWhatsAppSendError ? e.message : (e as Error).message;
      return NextResponse.json({ error: msg }, { status: 502 });
    }
  }

  if (corpo.acao === "testar") {
    const r = await asaasMyAccount();
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 502 });
    return NextResponse.json({
      data: { conta: r.data.name || r.data.companyName || r.data.email || "(sem nome)" },
    });
  }

  if (corpo.acao === "status") {
    if (!corpo.paymentId) return NextResponse.json({ error: "Informe o paymentId." }, { status: 400 });
    const r = await consultarCobranca(corpo.paymentId);
    if (!r.ok) return NextResponse.json({ error: r.erro }, { status: 502 });
    return NextResponse.json({ data: { cobranca: r.data } });
  }

  if (corpo.acao === "gerar-pix") {
    const nome = (corpo.nome || "Teste Bancada Pre-venda").trim();
    const cpfCnpj = (corpo.cpfCnpj || "").replace(/\D/g, "");
    const valor = Number(corpo.valor) > 0 ? Number(corpo.valor) : 5;
    const empreendimento = (corpo.empreendimento || "Vale do Ouro").trim();
    const cadCodigo = (corpo.cadCodigo || "").trim();
    const vencimento = /^\d{4}-\d{2}-\d{2}$/.test(corpo.vencimento ?? "")
      ? corpo.vencimento!
      : VENCIMENTO_PADRAO;
    if (cpfCnpj.length !== 11 && cpfCnpj.length !== 14) {
      return NextResponse.json({ error: "Informe um CPF ou CNPJ valido para o cliente de teste." }, { status: 400 });
    }

    // A pessoa precisa EXISTIR no Apolo: é a ficha dela que dá os contatos e recebe o pagamento.
    const admin = createApoloAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "Sem acesso à base do Apolo." }, { status: 503 });
    }
    const match = await lookupApoloByDocument(admin, cpfCnpj);
    if (!match?.entityId) {
      return NextResponse.json(
        { error: "Não encontrei ficha no Apolo com esse CPF/CNPJ. O fluxo real parte da ficha." },
        { status: 404 },
      );
    }
    const entityId = match.entityId;

    // TESTE: grava na arquitetura o telefone/e-mail digitados e garante a ficha em pré-venda, pra
    // este disparo percorrer o MESMO caminho do botão da pré-venda (e não os campos da tela).
    const plantio = await plantarFichaPrevenda(admin, {
      email: corpo.email,
      empreendimento,
      entityId,
      telefone: corpo.telefone,
    });

    // "Pré-venda - CAD <codigo>, Empreendimento <nome>" (formato do Lucas) + o aviso de que o
    // pagamento não reserva unidade.
    const AVISO = "Este pagamento não garante reserva de unidades no empreendimento.";
    const cabecalho = cadCodigo
      ? `Pré-venda - CAD ${cadCodigo}, Empreendimento ${empreendimento}`
      : `Pré-venda - Empreendimento ${empreendimento}`;
    const descricao = `${cabecalho}. ${AVISO}`;

    const cliente = await criarClienteAsaas({ cpfCnpj, externalReference: entityId, nome });
    if (!cliente.ok) return NextResponse.json({ error: `Cliente: ${cliente.erro}` }, { status: 502 });

    // ⚠️ externalReference = ID DA FICHA. É ele que volta no webhook do pagamento, e é assim que
    // sabemos de quem é a notificação SEM precisar perguntar nada ao Asaas.
    const cobranca = await criarCobrancaPix({
      customer: cliente.data.id,
      descricao,
      externalReference: entityId,
      valor,
      vencimento,
    });
    if (!cobranca.ok) return NextResponse.json({ error: `Cobranca: ${cobranca.erro}` }, { status: 502 });

    const qr = await obterQrCodePix(cobranca.data.id);

    // FLUXO COMPLETO: emitiu o PIX, a cobrança sai na hora nos dois canais, lendo os contatos DA
    // FICHA. O envio nunca derruba a emissão do PIX.
    const envio = !corpo.enviarCobranca
      ? null
      : !cobranca.data.invoiceUrl
        ? { aviso: "PIX gerado, mas a cobrança veio sem link de pagamento." }
        : await enviarCobrancaPrevenda({
            admin,
            empreendimento,
            entityId,
            link: cobranca.data.invoiceUrl,
            nome,
            paymentId: cobranca.data.id,
            valorFmt: moedaBR(valor),
          });

    // O QR pode falhar mesmo com a cobranca criada — devolve a cobranca e sinaliza.
    return NextResponse.json({
      data: {
        cobranca: cobranca.data,
        envio,
        plantio,
        qrCode: qr.ok ? qr.data : null,
        qrErro: qr.ok ? null : qr.erro,
      },
    });
  }

  return NextResponse.json({ error: "Acao invalida." }, { status: 400 });
}

// Eventos que o webhook do Asaas registrou (pra a bancada mostrar o que chegou ao pagar).
export async function GET(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });

  const { data } = await client
    .from("apolo_asaas_eventos")
    .select("evento, asaas_payment_id, status, billing_type, value, payment_date, date_created_raiz, headers, recebido_em")
    .order("recebido_em", { ascending: false })
    .limit(25);

  return NextResponse.json(
    { data: { eventos: data ?? [] } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
