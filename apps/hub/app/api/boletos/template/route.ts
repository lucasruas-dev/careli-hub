import { NextResponse } from "next/server";

import { authorizeApoloAdmin, authorizeApoloRead } from "@/lib/apolo/auth";
import {
  TEMPLATE_BOLETO,
  TEMPLATE_BOLETO_CORPO,
  TEMPLATE_BOLETO_EXEMPLO,
  TEMPLATE_BOLETO_HEADER,
  TEMPLATE_BOLETO_IDIOMA,
  previaDaMensagem,
} from "@/lib/apolo/boletos/template-whatsapp";
import {
  MetaWhatsAppSendError,
  type MetaWhatsAppTemplateSummary,
  createMetaWhatsAppMessageTemplate,
  getMetaWhatsAppOutboundConfig,
  listMetaWhatsAppMessageTemplates,
} from "@/lib/iris/meta-whatsapp";

// CRIAR (uma vez) O TEMPLATE QUE ENVIA O LINK DO BOLETO, na WABA do 4143.
//
// Pedido do Lucas (01/09/2026): *"temos agora que gerar o template para gente enviar o link do
// boleto"*, e sobre o conteúdo: *"esse vai servir para todos os empreendimentos"*.
//
// ⚠️ CRIAR TEMPLATE NÃO SE DESFAZ SOZINHO. A Meta enfileira para revisão humana, o que leva de
// minutos a dias, e um template criado só sai pelo Business Manager. Por isso o GET existe: ele
// mostra o que já está lá, com o status, ANTES de qualquer criação.
//
// ⚠️ NOME DUPLICADO É TRATADO COMO SUCESSO. A Meta responde com erro quando o nome+idioma já existe,
// e nesse caso o objetivo desta rota já está cumprido. Mesmo desenho da rota do Serasa.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Número 4143 (Iris/atendimento) — a mesma WABA dos demais templates da casa.
const PHONE_4143 = "1167201739813897";

// ── GET: o que já existe, e a prévia do que seria criado ────────────────────

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const config = { ...getMetaWhatsAppOutboundConfig(), phoneNumberId: PHONE_4143 };

  let existentes: MetaWhatsAppTemplateSummary[] = [];
  let erro: null | string = null;
  try {
    // ⚠️ O LIMITE PADRÃO É 20, e a WABA do 4143 tem muito mais que isso. Com o padrão, procurar por
    // "boleto" responderia "não existe" sobre um template que existe, e o resultado seria um
    // duplicado que ninguém consegue apagar por aqui.
    existentes = await listMetaWhatsAppMessageTemplates({ config, limit: 250 });
  } catch (e) {
    erro = e instanceof Error ? e.message : "não consegui listar os templates da Meta";
  }

  const nosso = existentes.find(
    (t) => t.name === TEMPLATE_BOLETO && t.language === TEMPLATE_BOLETO_IDIOMA,
  );

  // ⚠️ MOSTRA TAMBÉM OS PARECIDOS. Se alguém já criou "envio_boleto" ou "boleto_mensal" pelo
  // Business Manager, criar o nosso seria um segundo template dizendo a mesma coisa — e o operador
  // teria dois na lista sem saber qual está aprovado.
  const parecidos = existentes
    .filter((t) => /boleto|cobran|fatura|pagamento/i.test(t.name ?? ""))
    .map((t) => ({
      categoria: t.category,
      idioma: t.language,
      nome: t.name,
      status: t.status,
    }));

  return NextResponse.json(
    {
      data: {
        erro,
        existe: Boolean(nosso),
        parecidos,
        previa: previaDaMensagem([...TEMPLATE_BOLETO_EXEMPLO]),
        proposto: {
          cabecalho: TEMPLATE_BOLETO_HEADER,
          categoria: "UTILITY",
          corpo: TEMPLATE_BOLETO_CORPO,
          exemplo: TEMPLATE_BOLETO_EXEMPLO,
          idioma: TEMPLATE_BOLETO_IDIOMA,
          nome: TEMPLATE_BOLETO,
        },
        status: nosso?.status ?? null,
        totalNaWaba: existentes.length,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

// ── POST: cria ──────────────────────────────────────────────────────────────

/**
 * A Meta recusa a criação quando nome+idioma já existe. Nesse caso o objetivo já está cumprido.
 *
 * O subcódigo 2388023 é o "template name already exists" do Graph; a mensagem em texto varia com a
 * versão da API, então os dois caminhos são conferidos.
 */
function ehDuplicado(error: MetaWhatsAppSendError): boolean {
  const msg = error.message?.toLowerCase() ?? "";
  if (/already exists|already been|duplicate|ja existe/.test(msg)) return true;

  const d = error.details;
  if (d && typeof d === "object" && !Array.isArray(d)) {
    return Number((d as Record<string, unknown>).error_subcode) === 2388023;
  }
  return false;
}

export async function POST(request: Request) {
  // ⚠️ SÓ ADMIN. Criar template é ato de marca: o texto vai para a Meta em nome da empresa, passa
  // por revisão humana e não se desfaz sem o Business Manager.
  const auth = await authorizeApoloAdmin(request);
  if (!auth.ok) return auth.response;

  const config = { ...getMetaWhatsAppOutboundConfig(), phoneNumberId: PHONE_4143 };

  try {
    const criado = await createMetaWhatsAppMessageTemplate({
      category: "UTILITY",
      components: [
        // Cabeçalho de TEXTO fixo, sem variável: destaque sem gastar um parâmetro e sem exigir a
        // amostra de mídia que um header de documento pediria.
        { format: "TEXT", text: TEMPLATE_BOLETO_HEADER, type: "HEADER" },
        {
          example: { body_text: [[...TEMPLATE_BOLETO_EXEMPLO]] },
          text: TEMPLATE_BOLETO_CORPO,
          type: "BODY",
        },
      ],
      config,
      language: TEMPLATE_BOLETO_IDIOMA,
      name: TEMPLATE_BOLETO,
      phoneNumberId: PHONE_4143,
    });

    return NextResponse.json({
      data: {
        criado: true,
        id: criado.id,
        jaExistia: false,
        nome: criado.name ?? TEMPLATE_BOLETO,
        // ⚠️ "PENDING" É O NORMAL. O template só dispara depois de APPROVED, e a revisão da Meta
        // leva de minutos a dias. Disparar antes devolve o erro 132001.
        status: criado.status,
      },
    });
  } catch (error) {
    if (error instanceof MetaWhatsAppSendError && ehDuplicado(error)) {
      return NextResponse.json({
        data: {
          criado: false,
          jaExistia: true,
          nome: TEMPLATE_BOLETO,
          status: null,
        },
      });
    }

    const status = error instanceof MetaWhatsAppSendError ? error.status : 502;
    const mensagem =
      error instanceof Error ? error.message : "não consegui criar o template na Meta";
    return NextResponse.json({ error: mensagem }, { status });
  }
}
