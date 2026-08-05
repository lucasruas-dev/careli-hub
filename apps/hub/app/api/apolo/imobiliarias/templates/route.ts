import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  TPL_IMOB_PIX_ENVIADO,
  TPL_IMOB_PIX_PAGO,
  TPL_IMOB_RELATORIO,
  TPL_IMOB_REPROVADO,
} from "@/lib/apolo/disparo-imobiliaria";
import {
  MetaWhatsAppSendError,
  createMetaWhatsAppMessageTemplate,
  getMetaWhatsAppOutboundConfig,
  listMetaWhatsAppMessageTemplates,
} from "@/lib/iris/meta-whatsapp";

// Cria (POST) / consulta (GET) na Meta os 4 templates de aviso à imobiliária. Número 4143, UTILITY.
// Texto aprovado pelo Lucas — não editar depois de aprovado (cria outro).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PHONE_4143 = "1167201739813897";

// A Meta (UTILITY) rejeita ("Invalid parameter") body que TERMINA numa variável — precisa de
// texto real depois da última {{n}}. Por isso todo texto abaixo fecha com uma frase, não com {{n}}.
// {{1}} imobiliária, {{2}} cliente, {{3}} corretor, {{4}} empreendimento
const TXT_REPROVADO =
  "Olá, {{1}}! A análise de crédito do cliente *{{2}}*, do corretor *{{3}}*, referente ao empreendimento *{{4}}*, foi indeferida. A CAD não segue para as próximas etapas do credenciamento.";
// {{1}} imob, {{2}} cliente, {{3}} corretor, {{4}} empreendimento, {{5}} status de envio ao cliente
const TXT_PIX_ENVIADO =
  "Olá, {{1}}! O cliente *{{2}}*, do corretor *{{3}}*, recebeu o link de pagamento do PIX do empreendimento *{{4}}*.\n\nStatus do envio ao cliente: {{5}}. Assim que o pagamento for confirmado, avisamos por aqui.";
// {{1}} imob, {{2}} cliente, {{3}} empreendimento, {{4}} status do comprovante
const TXT_PIX_PAGO =
  "Olá, {{1}}! O PIX do cliente *{{2}}* foi pago, concluindo o cadastro no empreendimento *{{3}}*.\n\nComprovante enviado ao cliente: {{4}}. O processo de credenciamento está finalizado.";
// {{1}} imob, {{2}} empreendimento, {{3}} e-mail da imobiliária
const TXT_RELATORIO =
  "Olá, {{1}}! O relatório de performance do empreendimento *{{2}}* foi enviado para o e-mail {{3}}. Confira lá o andamento das CADs dos seus clientes.";

const STATUS_EX = "WhatsApp: enviado 14:32 · E-mail: enviado 14:32";

const TEMPLATES = [
  {
    exemplo: ["RR Soluções", "João da Silva", "Carlos", "Vale do Ouro"],
    nome: TPL_IMOB_REPROVADO,
    texto: TXT_REPROVADO,
  },
  {
    exemplo: ["RR Soluções", "João da Silva", "Carlos", "Vale do Ouro", STATUS_EX],
    nome: TPL_IMOB_PIX_ENVIADO,
    texto: TXT_PIX_ENVIADO,
  },
  {
    exemplo: ["RR Soluções", "João da Silva", "Vale do Ouro", STATUS_EX],
    nome: TPL_IMOB_PIX_PAGO,
    texto: TXT_PIX_PAGO,
  },
  {
    exemplo: ["RR Soluções", "Vale do Ouro", "contato@rrsolucoes.com.br"],
    nome: TPL_IMOB_RELATORIO,
    texto: TXT_RELATORIO,
  },
];

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const config = { ...getMetaWhatsAppOutboundConfig(), phoneNumberId: PHONE_4143 };

  const criar = async (nome: string, texto: string, exemplo: string[]) => {
    try {
      const t = await createMetaWhatsAppMessageTemplate({
        category: "UTILITY",
        components: [
          { example: { body_text: [exemplo] }, text: texto, type: "BODY" },
        ],
        config,
        language: "pt_BR",
        name: nome,
        phoneNumberId: PHONE_4143,
      });
      return { id: t.id, name: nome, ok: true, status: t.status };
    } catch (e) {
      const erroMeta = e instanceof MetaWhatsAppSendError ? e : null;
      const msg = erroMeta ? erroMeta.message : (e as Error).message;
      const dup = /already exists|duplicate|ja existe|2388023/i.test(msg);
      // DETALHE CRU DA META: "Invalid parameter" sozinho não diz o que está errado. O que explica
      // de verdade vem em error_user_title/error_user_msg/error_subcode do corpo do erro.
      const d = (erroMeta?.details ?? null) as {
        error_subcode?: unknown;
        error_user_msg?: unknown;
        error_user_title?: unknown;
      } | null;
      const detalhe =
        [
          d?.error_user_title,
          d?.error_user_msg,
          d?.error_subcode ? `subcode ${String(d.error_subcode)}` : null,
        ]
          .filter(Boolean)
          .map(String)
          .join(" — ") || null;
      return { detalhe, error: dup ? null : msg, jaExistia: dup, name: nome, ok: dup };
    }
  };

  const resultados = [];
  for (const t of TEMPLATES) {
    resultados.push(await criar(t.nome, t.texto, t.exemplo));
  }

  return NextResponse.json({ data: { templates: resultados } });
}

export async function GET(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const config = { ...getMetaWhatsAppOutboundConfig(), phoneNumberId: PHONE_4143 };

  const consultar = async (nome: string) => {
    try {
      const tpls = await listMetaWhatsAppMessageTemplates({
        config,
        language: "pt_BR",
        name: nome,
        phoneNumberId: PHONE_4143,
      });
      const t = tpls.find((x) => x.name === nome) ?? tpls[0];
      return { name: nome, status: t?.status ?? "NAO_ENCONTRADO" };
    } catch (e) {
      const msg = e instanceof MetaWhatsAppSendError ? e.message : (e as Error).message;
      return { name: nome, status: `erro: ${msg}` };
    }
  };

  const status = [];
  for (const t of TEMPLATES) status.push(await consultar(t.nome));
  return NextResponse.json({ data: { templates: status } });
}
