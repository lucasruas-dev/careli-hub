import { NextResponse } from "next/server";

import { autorizar } from "@/lib/apolo/incorporador/escopo";
import {
  CAMPOS_DA_PARCELA,
  CAMPOS_EDITAVEIS,
  type CampoDaParcela,
  type CampoEditavel,
  lerCarteiraDoLsoft,
  lerFichaDoLsoft,
  salvarParcelaDoLsoft,
  salvarValidacaoDoLsoft,
  type StatusDaValidacao,
} from "@/lib/lsoft/carteira";
import { portalVeBaseLsoft } from "@/lib/lsoft/portais";

// A BASE DO LSOFT DENTRO DO PORTAL DO INCORPORADOR.
//
// Decisão do Lucas (19/08/2026): *"no portal personalizado da Cecílio, no CER é para ter, pois são
// eles que vão atualizar essa base para depois a gente subir"*.
//
// ⚠️ ESTA É A PRIMEIRA ESCRITA EXTERNA DO PANTEON. Até aqui o portal do incorporador era leitura
// pura em tudo. Por isso, três travas explícitas:
//   1. só os portais de `portalVeBaseLsoft` entram (hoje `cer` e `cecilio-rocha`);
//   2. o autor gravado é o USUÁRIO DA SESSÃO, com `autor_origem: 'incorporador'` — a trilha
//      distingue quem é da Careli de quem é do cliente;
//   3. os campos aceitos são os mesmos da tela interna, e nada além.
//
// ⚠️ ROTA ÚNICA COM `acao` no corpo, e não quatro caminhos: o portal já tem muita rota, e o que
// separa uma operação da outra aqui é o verbo de negócio, não o recurso.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function fora(): NextResponse {
  // 404, não 403: para quem não tem a aba, esta rota simplesmente não existe.
  return NextResponse.json({ error: "Não encontrado." }, { status: 404 });
}

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;
  if (!portalVeBaseLsoft(auth.sessao.slug)) return fora();

  const url = new URL(request.url);
  const codigo = url.searchParams.get("cliente");

  if (codigo) {
    const ficha = await lerFichaDoLsoft(codigo);
    if (!ficha.ok) return NextResponse.json({ error: ficha.erro }, { status: 404 });
    return NextResponse.json(
      { data: { cadastro: ficha.cadastro, parcelas: ficha.parcelas } },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const carteira = await lerCarteiraDoLsoft({
    busca: url.searchParams.get("q"),
    empreendimento: url.searchParams.get("emp"),
  });
  if (!carteira.ok) return NextResponse.json({ error: carteira.erro }, { status: 503 });

  return NextResponse.json(
    { data: { clientes: carteira.clientes, resumo: carteira.resumo } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;
  if (!portalVeBaseLsoft(auth.sessao.slug)) return fora();

  const corpo = (await request.json().catch(() => null)) as
    | {
        acao?: string;
        campos?: Record<string, unknown>;
        cliente?: string;
        parcela?: string;
        status?: string;
      }
    | null;

  if (!corpo) return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });

  // Quem assina: o usuário da sessão do portal, nunca o que a tela mandar.
  const autor = `${auth.sessao.usuarioNome} (${auth.sessao.slug})`;

  if (corpo.acao === "parcela" && corpo.parcela) {
    const campos: Partial<Record<CampoDaParcela, null | string>> = {};
    for (const campo of CAMPOS_DA_PARCELA) {
      if (corpo.campos && campo in corpo.campos) {
        const valor = corpo.campos[campo];
        campos[campo] = valor === null || valor === undefined ? null : String(valor);
      }
    }

    const resultado = await salvarParcelaDoLsoft({
      autor,
      autorOrigem: "incorporador",
      campos,
      parcelaId: corpo.parcela,
    });

    if (!resultado.ok) return NextResponse.json({ error: resultado.erro }, { status: 400 });
    return NextResponse.json({ data: { alterados: resultado.alterados } });
  }

  if (!corpo.cliente) return NextResponse.json({ error: "Cliente ausente." }, { status: 400 });

  const campos: Partial<Record<CampoEditavel, null | string>> = {};
  for (const campo of CAMPOS_EDITAVEIS) {
    if (corpo.campos && campo in corpo.campos) {
      const valor = corpo.campos[campo];
      campos[campo] = valor === null || valor === undefined ? null : String(valor);
    }
  }

  const STATUS = ["dispensado", "em_analise", "pendente", "validado"] as const;
  const status = corpo.status && STATUS.includes(corpo.status as never)
    ? (corpo.status as StatusDaValidacao)
    : undefined;

  const resultado = await salvarValidacaoDoLsoft({
    autor,
    autorOrigem: "incorporador",
    campos,
    codigo: corpo.cliente,
    status,
  });

  if (!resultado.ok) return NextResponse.json({ error: resultado.erro }, { status: 400 });
  return NextResponse.json({ data: { alterados: resultado.alterados } });
}
