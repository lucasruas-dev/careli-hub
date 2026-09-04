import { NextResponse } from "next/server";

import { soDigitos } from "@/lib/apolo/documento";
import { autorizar, idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { mascararCpf } from "@/lib/hercules/reserva";

// OS DADOS DE CONTATO DO CLIENTE DE UMA UNIDADE.
//
// Lucas (04/09/2026): *"como eu posso ter os dados do cliente da reserva, pode ser que eu queira
// ligar para ele, acho que podemos trazer essa informação, tipo um link ao clicar no nome"* — e,
// logo depois, enxugando o pedido: *"acho que ligar não, só mostrar mesmo"*.
//
// ⚠️ SOB DEMANDA, E NÃO NA CARGA DA TELA. O telefone de todo mundo poderia viajar junto com a
// lista de propostas — são 4.857 linhas —, e aí o dado de contato de milhares de clientes estaria
// no navegador de quem só queria ver o funil. Aqui ele sai de uma unidade por vez, quando alguém
// clica no nome.
//
// ⚠️ O CPF VAI MASCARADO, o telefone não. O documento serve para CONFERIR que é a pessoa certa
// (***.982.247-** basta para isso); o telefone é o dado que ele pediu para ver, e mascarado não
// serviria para nada.
//
// ⚠️ DUAS FONTES, porque a venda pode ter nascido dos dois lados: a reserva do Panteon guarda o
// proponente em `proponentes` (nome, cpf, telefone digitados na hora); a proposta importada do C2X
// só traz nome e documento, e o telefone vem do cadastro do Apolo, casado pelo documento.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKSPACE = "careli";

type Contato = {
  documento: null | string;
  fonte: "apolo" | "reserva";
  nome: null | string;
  telefone: null | string;
};

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  const unidadeId = (new URL(request.url).searchParams.get("unidade") ?? "").trim();
  if (!unidadeId) {
    return NextResponse.json({ error: "Informe a unidade." }, { status: 400 });
  }

  try {
    // O escopo primeiro, sempre: sem isto, trocar o id na barra de endereço devolveria o telefone
    // do cliente de outro loteamento.
    const permitidos = new Set(await idsDaSessao(auth.sessao));
    const { data: unidade } = await admin
      .from("hercules_unidades")
      .select("id, enterprise_id")
      .eq("workspace_id", WORKSPACE)
      .eq("id", unidadeId)
      .maybeSingle();

    const dona = unidade as null | { enterprise_id: string; id: string };
    if (!dona || !permitidos.has(String(dona.enterprise_id))) {
      return NextResponse.json({ error: "Unidade não encontrada." }, { status: 404 });
    }

    // ── 1. A reserva viva, que é o caso do que nasce aqui ──────────────────
    const { data: reserva } = await admin
      .from("hercules_reservas")
      .select("proponentes")
      .eq("workspace_id", WORKSPACE)
      .eq("unidade_id", unidadeId)
      .in("situacao", ["ativa", "proposta"])
      .maybeSingle();

    const proponentes = (reserva as null | { proponentes: unknown })?.proponentes;
    const titular = Array.isArray(proponentes) ? proponentes[0] : null;

    if (titular && typeof titular === "object") {
      const p = titular as { cpf?: unknown; nome?: unknown; telefone?: unknown };
      return NextResponse.json({
        data: {
          documento: typeof p.cpf === "string" && p.cpf ? mascararCpf(p.cpf) : null,
          fonte: "reserva",
          nome: typeof p.nome === "string" ? p.nome : null,
          telefone: typeof p.telefone === "string" ? p.telefone : null,
        } satisfies Contato,
      });
    }

    // ── 2. A proposta importada: nome e documento vêm dela, o telefone do Apolo ──
    const { data: proposta } = await admin
      .from("hercules_propostas")
      .select("cliente_nome, cliente_documento, etapa, etapa_desde")
      .eq("workspace_id", WORKSPACE)
      .eq("unidade_id", unidadeId)
      .order("etapa_desde", { ascending: false })
      .limit(1)
      .maybeSingle();

    const doC2x = proposta as null | { cliente_documento: null | string; cliente_nome: null | string };
    if (!doC2x?.cliente_nome && !doC2x?.cliente_documento) {
      return NextResponse.json({ data: null });
    }

    const documento = soDigitos(doC2x.cliente_documento ?? "");
    let telefone: null | string = null;

    if (documento) {
      // ⚠️ CASA PELO `document_masked`, que é como o sync do C2X grava o documento das ~4,7 mil
      // fichas que vieram de lá (o `document_hash` fica nulo nelas, de propósito). Procurar pelo
      // hash devolveria nada justamente para quem veio do legado.
      const { data: entidades } = await admin
        .from("apolo_entities")
        .select("id, document_masked")
        .not("document_masked", "is", null)
        .limit(5000);

      const alvo = ((entidades ?? []) as Array<{ document_masked: null | string; id: string }>).find(
        (e) => soDigitos(e.document_masked ?? "") === documento,
      );

      if (alvo) {
        const { data: contatos } = await admin
          .from("apolo_contacts")
          .select("value, is_primary")
          .eq("entity_id", alvo.id)
          .eq("contact_type", "phone");

        const lista = (contatos ?? []) as Array<{ is_primary: boolean | null; value: null | string }>;
        telefone =
          lista.find((c) => c.is_primary === true)?.value?.trim() ||
          lista.find((c) => (c.value ?? "").trim())?.value?.trim() ||
          null;
      }
    }

    return NextResponse.json({
      data: {
        documento: documento ? mascararCpf(documento) : null,
        fonte: "apolo",
        nome: doC2x.cliente_nome,
        telefone,
      } satisfies Contato,
    });
  } catch (erro) {
    console.error("[hercules][venda] contato do cliente", erro);
    return NextResponse.json({ error: "Não foi possível carregar agora." }, { status: 503 });
  }
}
