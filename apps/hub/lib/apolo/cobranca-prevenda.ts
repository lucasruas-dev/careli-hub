import { Buffer } from "node:buffer";

import type { SupabaseClient } from "@supabase/supabase-js";

import { criarClienteAsaas, criarCobrancaPix } from "@/lib/apolo/asaas-prevenda";
import { avisarImobPixEnviado, statusEnvioAoCliente } from "@/lib/apolo/disparo-imobiliaria";
import { montarCadDeEntidade } from "@/lib/apolo/cad-de-entidade";
import { APOLO_DOCS_BUCKET } from "@/lib/apolo/documentos";
import { type EmailMontado, montarEmailCobranca } from "@/lib/apolo/emails-prevenda";
import {
  aoEnviarPixPrevenda,
  contatosDaFicha,
  registrarDisparoPrevenda,
} from "@/lib/apolo/prevenda-fluxo";
import { getCacaSender, isGmailConfigured, sendGmailMessage } from "@/lib/iris/gmail";
import { fixLegacyBrazilianMobileNumber } from "@/lib/iris/phone-country";
import {
  MetaWhatsAppSendError,
  getMetaWhatsAppOutboundConfig,
  sendMetaWhatsAppTemplateMessage,
} from "@/lib/iris/meta-whatsapp";
import { montarCadPdf } from "@/modules/apolo/blocks/cadastro/cad-pdf";

// O CAMINHO DE COBRANÇA DA PRÉ-VENDA, num lugar só.
//
// Nasceu dentro da bancada de teste (disparo 1 a 1). O disparo em massa precisa percorrer
// EXATAMENTE o mesmo caminho — se fossem dois códigos parecidos, o que o Lucas validou ao vivo no
// dia 22/07 não seria o que sai para as 296 pessoas. Por isso está aqui, e a bancada passou a
// importar daqui em vez de ter a sua própria cópia.

// Número 4143 (Iris/atendimento) — mesma WABA dos outros templates.
export const PHONE_4143 = "1167201739813897";

// Os templates que valem (ver o histórico dos nomes na bancada).
export const TPL_COBRANCA_NOME = "cad_pix_cobranca_v2";
export const TPL_RECIBO_NOME = "cad_pix_recibo_v2";

// Vencimento padrão da pré-venda (o Lucas): 30/07/2026.
export const VENCIMENTO_PADRAO = "2026-07-30";
export const VALOR_PREVENDA = 1000;

// Remetente destes e-mails: a caixa da Cacá (quem fala com o cliente é a Cacá, da C2X).
export const PREVENDA_EMAIL_FROM = getCacaSender();

// EXCEÇÃO por empreendimento (pedido do Lucas 25/jul, NÃO vai ao painel): os e-mails da pré-venda
// do VALE DO OURO saem do contato@careli.adm.br; os demais seguem da caixa da Cacá. ⚠️ Exige o
// Send-As de contato@ liberado na conta caca@ — senão o Gmail recusa e cai no fallback (caca@).
const PREVENDA_FROM_VALE_DO_OURO = "Careli - C2X <contato@careli.adm.br>";
export function remetentePrevenda(empreendimento: string | null | undefined): string {
  const nome = (empreendimento ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
  const ehValeDoOuro = nome.includes("vale do ouro") || nome === "vlo";
  return ehValeDoOuro ? PREVENDA_FROM_VALE_DO_OURO : PREVENDA_EMAIL_FROM;
}

// 1000 -> "1.000,00" (formato do parâmetro de valor nos templates).
export function moedaBR(n: number): string {
  const [inteiro = "0", decimal = "00"] = n.toFixed(2).split(".");
  return `${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${decimal}`;
}

// Celular BR em E.164 (só dígitos) — ou null, e null aqui significa "NÃO mande WhatsApp".
//
// Três armadilhas que a auditoria do disparo em massa pegou, todas com vítima real na base das
// 296 fichas:
//
//  1. `startsWith("55")` sozinho confunde o DDD 55 (Santa Maria/RS) com o DDI 55: um celular
//     (55) 99999-9999 vira "55999999999" e sai truncado. Quem decide é o COMPRIMENTO.
//  2. O C2X ainda guarda celular no formato antigo, sem o 9º dígito — 12 das 296 estão assim.
//     Sem `fixLegacyBrazilianMobileNumber` a Meta devolve 131026 e a pessoa não recebe nada.
//     A Iris já tinha essa rede ligada (caso AT-000229); aqui ela faltava.
//  3. Número estrangeiro prefixado com 55 vira um E.164 brasileiro que PODE EXISTIR e ser de
//     outra pessoa. Como esta mensagem leva a CAD anexada (CPF, RG, filiação, renda), isso não
//     seria um envio falho: seria entregar o dado pessoal de um cliente a um estranho. Por isso
//     o que não casar o padrão de celular BR não recebe WhatsApp — vai só por e-mail e aparece
//     na lista de falhas para tratamento manual.
const CELULAR_BR = /^55[1-9][0-9]9[0-9]{8}$/;

export function normalizarTelefone(valor?: string): string | null {
  const digitos = (valor ?? "").replace(/\D/g, "");
  if (digitos.length < 10) return null;

  const comDdi = digitos.startsWith("55") && digitos.length >= 12 ? digitos : `55${digitos}`;
  const corrigido = fixLegacyBrazilianMobileNumber(comDdi);

  return CELULAR_BR.test(corrigido) ? corrigido : null;
}

// FICHA (CAD) em PDF, gerada UMA vez a partir da ficha da pessoa. Os dois canais consomem de formas
// diferentes: o WhatsApp precisa de uma signed URL (a Meta baixa por ela) e o e-mail leva os bytes
// anexados direto. null = sem ficha (o template com header de documento recusa o envio).
export async function montarFichaCad(
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
    // ⚠️ Caminho POR PESSOA. Num lote de 296 um caminho fixo faria todo mundo receber a ficha do
    // último que passou por aqui.
    const path = `cobranca-prevenda/${entityId}.pdf`;
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

// Envia o e-mail do disparo pela caixa da Iris (Gmail). NUNCA lança: o WhatsApp não pode falhar por
// causa do e-mail, então devolvemos o status de cada canal separadamente.
export async function enviarEmailPrevenda(input: {
  anexo: { content: Uint8Array; filename: string; mimeType: string } | null;
  destino?: string;
  // Remetente do e-mail; default = caixa da Cacá. O Vale do Ouro passa contato@ (remetentePrevenda).
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

export type EnvioCobranca = {
  anexouCad: boolean;
  destinos: { email: string | null; telefone: string | null };
  email: string;
  fluxo: { etapa: string; fila: string };
  messageId: string | null;
  whatsapp: string;
};

// COBRANÇA da pré-venda nos dois canais + o movimento da esteira/fila. É o fluxo real: emitiu o
// PIX, o cliente recebe na hora. Um canal que falha NÃO derruba o outro — cada um devolve o seu
// status, que é o que deixa auditar o disparo em massa depois.
export async function enviarCobrancaPrevenda(input: {
  admin: SupabaseClient;
  empreendimento: string;
  // Id do empreendimento no C2X: diz de QUAL CAD é esta cobrança. Desde a 0080 a mesma pessoa
  // pode ter CAD (e PIX) em mais de um loteamento — sem isto o movimento de etapa cairia na
  // CAD mais recente, que pode ser outra.
  enterpriseId?: null | number | string;
  entityId: string;
  link: string;
  nome: string;
  paymentId?: string | null;
  valorFmt: string;
}): Promise<EnvioCobranca> {
  const { admin, entityId } = input;
  const config = { ...getMetaWhatsAppOutboundConfig(), phoneNumberId: PHONE_4143 };

  // CONTATOS DA FICHA — a mesma fonte que o recibo vai usar. É o caminho real do lançamento.
  const contatos = await contatosDaFicha(admin, entityId);
  const telefone = normalizarTelefone(contatos.telefone ?? undefined);

  // A ficha (CAD) é gerada UMA vez: link assinado pro WhatsApp, bytes pro e-mail.
  const ficha = await montarFichaCad(admin, entityId, input.nome);

  let messageId: string | null = null;
  let whatsapp = "não enviado";
  if (!contatos.telefone) {
    // Ficha sem telefone TAMBÉM é falha de envio: a pessoa não recebeu. Antes esse caso nem era
    // registrado, então sumia do Board e da auditoria — num lote de 296, silenciosamente.
    whatsapp = "erro: sem telefone na ficha";
  } else if (!telefone) {
    whatsapp = `erro: telefone fora do padrão de celular brasileiro (${contatos.telefone}) — não enviado para não entregar a ficha a outra pessoa`;
  } else if (!ficha?.link) {
    // O template de cobrança tem header de DOCUMENTO: sem o PDF a Meta recusa o disparo inteiro
    // (132000). Barrar aqui evita que UMA ficha sem CAD derrube o lote como se fosse problema de
    // template.
    whatsapp = "erro: não consegui gerar a ficha (CAD) para anexar";
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
  //
  // ⚠️ SÓ move quem realmente recebeu por algum canal. Mover quem falhou nos dois tirava a pessoa
  // da coluna de pré-venda (a lista de trabalho) e a colocava na fila do evento como se tivesse
  // sido avisada — num lote de 296, é assim que alguém some do controle com uma cobrança aberta e
  // nenhuma mensagem. Quem não recebeu fica em pré-venda, com `pagamento_ref` gravado: não é
  // cobrado de novo e aparece no relatório de falhas para reenvio.
  const alguemRecebeu = whatsapp === "enviado" || !email.startsWith("erro");
  const fluxo = alguemRecebeu
    ? await aoEnviarPixPrevenda({
        client: admin,
        enterpriseId: input.enterpriseId,
        entityId,
        paymentId: input.paymentId,
      })
    : { etapa: "mantida em pré-venda (nenhum canal saiu)", fila: "não entrou" };

  // Avisa a IMOBILIÁRIA que o cliente recebeu o PIX, com o STATUS de cada canal (o que o Lucas
  // pediu). Best-effort: nunca derruba o disparo ao cliente, que é o que importa.
  try {
    const agora = new Date().toISOString();
    const status = statusEnvioAoCliente(
      { erro: whatsapp.startsWith("erro") ? whatsapp : null, hora: agora, ok: whatsapp === "enviado" },
      { erro: email.startsWith("erro") ? email : null, hora: agora, ok: !email.startsWith("erro") },
    );
    await avisarImobPixEnviado(admin, entityId, status);
  } catch {
    /* segue */
  }

  return {
    anexouCad: Boolean(ficha),
    destinos: { email: contatos.email, telefone },
    email,
    fluxo,
    messageId,
    whatsapp,
  };
}

// EMITE a cobrança no Asaas (cliente + PIX). Separado do envio porque a ordem importa: primeiro
// existe a cobrança, depois a mensagem que carrega o link dela.
export async function emitirCobrancaPix(input: {
  cpfCnpj: string;
  empreendimento: string;
  entityId: string;
  nome: string;
  valor?: number;
  vencimento?: string;
}): Promise<
  // `paymentId` no ramo de ERRO = a cobrança FOI criada no Asaas, mas algo deu errado depois
  // (veio sem link). Quem chama NÃO pode tratar como "não existe cobrança" e liberar a ficha para
  // reemissão — isso cobraria a pessoa duas vezes. Devolvemos o id para o chamador gravar e travar.
  | { erro: string; ok: false; paymentId?: string }
  | { link: string; ok: true; paymentId: string }
> {
  const AVISO = "Este pagamento não garante reserva de unidades no empreendimento.";
  const descricao = `Pré-venda - Empreendimento ${input.empreendimento}. ${AVISO}`;

  const cliente = await criarClienteAsaas({
    cpfCnpj: input.cpfCnpj,
    externalReference: input.entityId,
    nome: input.nome,
  });
  if (!cliente.ok) return { erro: `cliente: ${cliente.erro}`, ok: false };

  // ⚠️ externalReference = ID DA FICHA. É ele que volta no webhook do pagamento, e é assim que
  // sabemos de quem é a notificação SEM precisar perguntar nada ao Asaas.
  const cobranca = await criarCobrancaPix({
    customer: cliente.data.id,
    descricao,
    externalReference: input.entityId,
    valor: input.valor ?? VALOR_PREVENDA,
    vencimento: input.vencimento ?? VENCIMENTO_PADRAO,
  });
  if (!cobranca.ok) return { erro: `cobranca: ${cobranca.erro}`, ok: false };
  if (!cobranca.data.invoiceUrl) {
    // A cobrança EXISTE (temos o id), só não veio o link. Devolve o id: a ficha fica gravada com
    // ele e NÃO é reemitida — o link se recupera depois consultando a cobrança.
    return { erro: "a cobrança foi criada mas veio sem link de pagamento", ok: false, paymentId: cobranca.data.id };
  }

  return { link: cobranca.data.invoiceUrl, ok: true, paymentId: cobranca.data.id };
}

// PDF de amostra usado só na CRIAÇÃO do template na Meta (ela exige um exemplo do documento).
export async function gerarPdfAmostraCad(): Promise<Buffer> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
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
