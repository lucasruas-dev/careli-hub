import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  emitirCobrancaPix,
  enviarCobrancaPrevenda,
  moedaBR,
  normalizarTelefone,
  VALOR_PREVENDA,
} from "@/lib/apolo/cobranca-prevenda";
import { contatosDaFicha } from "@/lib/apolo/prevenda-fluxo";
import { createApoloAdminClient } from "@/lib/apolo/server";

// DISPARO EM MASSA da cobrança PIX da pré-venda.
//
// Percorre o MESMO caminho da bancada (mesma lib, mesmos templates, mesmos contatos da ficha) —
// o que muda é só o laço e as travas, que são o que separa "funcionou uma vez" de "funcionou 296
// vezes sem cobrar ninguém duas vezes".
//
// GET  = PRÉVIA. Custo zero, não toca em nada: quantos entram, quem está sem contato, quem já foi.
// POST = DISPARO REAL (dinheiro e mensagem de verdade). Exige `confirmado: true` e processa um
//        LOTE PEQUENO por chamada: a tela chama de novo até acabar, e assim dá para parar no meio.
//
// As três travas:
//  1. RESERVA antes de criar no Asaas. `pagamento_ref` sai de NULL para "reservado:..." numa
//     atualização condicional; quem não conseguir reservar (outra aba, duplo clique) pula a ficha.
//     Sem isso, duas rodadas simultâneas gerariam duas cobranças de R$ 1.000 para a mesma pessoa.
//  2. O filtro é `pagamento_ref IS NULL`, não a etapa. Quem já recebeu tem a referência gravada e
//     nunca mais entra no lote, mesmo que alguém mova o card de volta para pré-venda no Board.
//  3. PARADA AUTOMÁTICA em erro de infraestrutura (conta da Meta bloqueada, limite atingido,
//     template reprovado, Asaas fora). Um erro desses não melhora na próxima ficha: continuar só
//     queimaria as 296. Erro de UMA ficha (telefone errado) não para nada — fica registrado.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const TAMANHO_PADRAO = 5;
const TAMANHO_MAXIMO = 15;
// Respiro entre envios. A Meta aceita bem mais que isso, mas um lote de 296 disparado no talo é
// exatamente o padrão que derruba a qualidade do número.
const PAUSA_MS = 600;

// ⚠️ O ALVO DO LOTE É UMA **CAD**, NÃO UMA PESSOA. Desde a 0080 a esteira é
// `(entity_id, enterprise_id)`: a mesma pessoa pode estar em pré-venda em dois loteamentos e
// dever R$ 1.000 em cada um. Por isso `enterpriseId` viaja junto do `entityId` daqui até a
// reserva — sem ele, reservar/gravar por `entity_id` sozinho marcaria as duas CADs e a segunda
// nunca seria cobrada (ou seria cobrada em cima da primeira).
type Alvo = {
  documento: string | null;
  empreendimento: string | null;
  enterpriseId: string;
  entityId: string;
  nome: string;
};

// Erros que NÃO adianta tentar na próxima ficha: é a conta, o template ou o provedor.
const FATAIS: ReadonlyArray<{ motivo: string; padrao: RegExp }> = [
  { motivo: "A conta do WhatsApp foi bloqueada pela Meta.", padrao: /131031|account.*lock/i },
  { motivo: "Limite de envio da Meta atingido.", padrao: /130429|rate limit/i },
  {
    motivo: "O template não existe ou não está aprovado na Meta.",
    padrao: /132001|template name does not exist/i,
  },
  {
    motivo: "As variáveis do template não batem com o texto aprovado na Meta.",
    padrao: /132000|number of parameters/i,
  },
  {
    motivo: "A Meta recusou a autenticação (token ou permissão do número).",
    padrao: /190\b|401|access token|permission/i,
  },
];

function ehFatal(erro: string): string | null {
  return FATAIS.find((f) => f.padrao.test(erro))?.motivo ?? null;
}

async function buscarAlvos(
  client: ReturnType<typeof createApoloAdminClient>,
  limite: number,
): Promise<Alvo[]> {
  if (!client) return [];

  // Ordem de chegada da CAD: quem mandou a ficha primeiro recebe a cobrança primeiro.
  const { data } = await client
    .from("apolo_esteira")
    .select("entity_id, enterprise_id, empreendimento, chegou_em")
    .eq("etapa", "prevenda")
    .is("pago_em", null)
    .is("pagamento_ref", null)
    .order("chegou_em", { ascending: true, nullsFirst: false })
    .limit(limite);

  const linhas = (data ?? []) as {
    chegou_em: string | null;
    empreendimento: string | null;
    enterprise_id: string | null;
    entity_id: string;
  }[];
  if (linhas.length === 0) return [];

  const ids = linhas.map((l) => l.entity_id);
  const { data: entidades } = await client
    .from("apolo_entities")
    .select("id, display_name, legal_name, document_masked")
    .in("id", ids);

  const porId = new Map(
    ((entidades ?? []) as {
      display_name: string | null;
      document_masked: string | null;
      id: string;
      legal_name: string | null;
    }[]).map((e) => [e.id, e]),
  );

  const { data: identificadores } = await client
    .from("apolo_entity_identifiers")
    .select("entity_id, identifier_type, value_masked")
    .in("entity_id", ids)
    .in("identifier_type", ["cpf", "cnpj", "document"]);

  const docPorId = new Map<string, string>();
  for (const i of (identificadores ?? []) as {
    entity_id: string;
    value_masked: string | null;
  }[]) {
    const digitos = (i.value_masked ?? "").replace(/\D/g, "");
    // Identificador mascarado (com *) não serve para o Asaas: só entra o que veio em claro.
    if (!docPorId.has(i.entity_id) && (digitos.length === 11 || digitos.length === 14)) {
      docPorId.set(i.entity_id, digitos);
    }
  }

  return linhas.flatMap((l) => {
    const e = porId.get(l.entity_id);
    const doDocumento = (e?.document_masked ?? "").replace(/\D/g, "");
    const enterpriseId = (l.enterprise_id ?? "").trim();
    // CAD sem empreendimento não entra no lote: sem a metade da chave, a reserva não teria como
    // ser presa numa CAD só. Depois da 0080 isto é impossível; o guard fica porque o disparo
    // mexe com dinheiro e não pode depender de a migration já ter rodado.
    if (!enterpriseId) return [];
    return [
      {
        documento:
          docPorId.get(l.entity_id) ??
          (doDocumento.length === 11 || doDocumento.length === 14 ? doDocumento : null),
        empreendimento: l.empreendimento,
        enterpriseId,
        entityId: l.entity_id,
        nome: (e?.legal_name || e?.display_name || "").trim(),
      },
    ];
  });
}

export async function GET(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base do Apolo." }, { status: 503 });

  // ⚠️ ESTAS CONTAGENS SÃO DE **CADs**, NÃO DE PESSOAS (a esteira é uma linha por CAD desde a
  // 0080). É o número certo para este painel: o que se cobra é a CAD, e quem tem duas CADs em
  // pré-venda deve dois PIX.
  const { count: pendentes } = await client
    .from("apolo_esteira")
    .select("entity_id", { count: "exact", head: true })
    .eq("etapa", "prevenda")
    .is("pago_em", null)
    .is("pagamento_ref", null);

  const { count: jaDisparados } = await client
    .from("apolo_esteira")
    .select("entity_id", { count: "exact", head: true })
    .not("pagamento_ref", "is", null);

  // Confere os 30 primeiros da fila: é a amostra que mostra se falta contato antes de gastar.
  const proximos = await buscarAlvos(client, 30);
  const amostra = [];
  for (const alvo of proximos) {
    const contatos = await contatosDaFicha(client, alvo.entityId);
    const problemas: string[] = [];
    if (!alvo.nome) problemas.push("sem nome");
    if (!alvo.documento) problemas.push("sem CPF utilizável");
    if (!normalizarTelefone(contatos.telefone ?? undefined)) {
      // Diferencia "não tem" de "tem, mas não é celular BR" — o segundo caso é o que a gente
      // recusa de propósito, para a ficha anexada não ir parar em outra pessoa.
      problemas.push(contatos.telefone ? "telefone fora do padrão de celular BR" : "sem telefone");
    }
    if (!contatos.email) problemas.push("sem e-mail");
    amostra.push({
      email: contatos.email,
      empreendimento: alvo.empreendimento,
      nome: alvo.nome || "(sem nome)",
      problemas,
      telefone: contatos.telefone,
    });
  }

  return NextResponse.json(
    {
      data: {
        amostra,
        jaDisparados: jaDisparados ?? 0,
        pendentes: pendentes ?? 0,
        valor: VALOR_PREVENDA,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Sem acesso à base do Apolo." }, { status: 503 });

  const corpo = (await request.json().catch(() => ({}))) as {
    confirmado?: boolean;
    empreendimentoPadrao?: string;
    tamanho?: number;
  };

  if (!corpo.confirmado) {
    return NextResponse.json(
      { error: "Este disparo emite cobrança REAL e envia mensagem ao cliente. Confirme na tela." },
      { status: 428 },
    );
  }

  const tamanho = Math.min(
    Math.max(1, Number(corpo.tamanho) || TAMANHO_PADRAO),
    TAMANHO_MAXIMO,
  );
  const empreendimentoPadrao = (corpo.empreendimentoPadrao ?? "Vale do Ouro").trim();
  const valorFmt = moedaBR(VALOR_PREVENDA);

  const alvos = await buscarAlvos(client, tamanho);
  const resultados: {
    email?: string;
    entityId: string;
    erro?: string;
    nome: string;
    paymentId?: string;
    whatsapp?: string;
  }[] = [];
  let parou: string | null = null;

  for (const alvo of alvos) {
    if (parou) break;

    // Faltando o básico, nem tenta: cobrança sem CPF ou sem nome não nasce no Asaas.
    if (!alvo.nome || !alvo.documento) {
      resultados.push({
        entityId: alvo.entityId,
        erro: !alvo.nome ? "ficha sem nome" : "ficha sem CPF utilizável",
        nome: alvo.nome || "(sem nome)",
      });
      continue;
    }

    // TRAVA 1 — reserva. Só segue quem conseguir marcar a ficha, e a marca some se a emissão
    // falhar, para a próxima rodada tentar de novo.
    const reserva = `reservado:${Date.now()}`;
    const { data: reservada } = await client
      .from("apolo_esteira")
      .update({ pagamento_ref: reserva })
      .eq("entity_id", alvo.entityId)
      .eq("enterprise_id", alvo.enterpriseId)
      .is("pagamento_ref", null)
      .select("entity_id");

    if (!reservada || reservada.length === 0) {
      resultados.push({
        entityId: alvo.entityId,
        erro: "já estava reservada por outro disparo",
        nome: alvo.nome,
      });
      continue;
    }

    const empreendimento = (alvo.empreendimento || empreendimentoPadrao).trim();

    const cobranca = await emitirCobrancaPix({
      cpfCnpj: alvo.documento,
      empreendimento,
      entityId: alvo.entityId,
      nome: alvo.nome,
    });

    if (!cobranca.ok) {
      // Libera a reserva: sem cobrança criada, a ficha continua elegível.
      await client
        .from("apolo_esteira")
        .update({ pagamento_ref: null })
        .eq("entity_id", alvo.entityId)
        .eq("enterprise_id", alvo.enterpriseId)
        .eq("pagamento_ref", reserva);

      resultados.push({ entityId: alvo.entityId, erro: cobranca.erro, nome: alvo.nome });
      // Asaas fora do ar ou chave recusada não melhora na próxima ficha.
      if (/401|403|unauthorized|invalid.*key|ECONNREFUSED|timeout/i.test(cobranca.erro)) {
        parou = `Asaas recusou a emissão: ${cobranca.erro}`;
      }
      continue;
    }

    // Cobrança existe: grava a referência REAL por cima da reserva, antes de qualquer envio. Se o
    // processo morrer daqui pra frente, a pessoa não é cobrada de novo — o pior caso vira "tem PIX
    // e não recebeu a mensagem", que o relatório de erros mostra e o reenvio resolve.
    await client
      .from("apolo_esteira")
      .update({ pagamento_ref: cobranca.paymentId })
      .eq("entity_id", alvo.entityId)
      .eq("enterprise_id", alvo.enterpriseId);

    const envio = await enviarCobrancaPrevenda({
      admin: client,
      empreendimento,
      enterpriseId: alvo.enterpriseId,
      entityId: alvo.entityId,
      link: cobranca.link,
      nome: alvo.nome,
      paymentId: cobranca.paymentId,
      valorFmt,
    });

    resultados.push({
      email: envio.email,
      entityId: alvo.entityId,
      nome: alvo.nome,
      paymentId: cobranca.paymentId,
      whatsapp: envio.whatsapp,
    });

    // TRAVA 3 — o erro é da conta/template, não desta pessoa? Para o lote inteiro.
    const fatal = envio.whatsapp.startsWith("erro") ? ehFatal(envio.whatsapp) : null;
    if (fatal) parou = fatal;

    if (!parou) await new Promise((r) => setTimeout(r, PAUSA_MS));
  }

  const { count: restantes } = await client
    .from("apolo_esteira")
    .select("entity_id", { count: "exact", head: true })
    .eq("etapa", "prevenda")
    .is("pago_em", null)
    .is("pagamento_ref", null);

  return NextResponse.json({
    data: {
      enviados: resultados.filter((r) => r.whatsapp === "enviado").length,
      falhas: resultados.filter((r) => r.erro || r.whatsapp?.startsWith("erro")).length,
      parou,
      restantes: restantes ?? 0,
      resultados,
    },
  });
}
