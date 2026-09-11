import { NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import { analiseDoTrabalho } from "@/lib/temis/analise-do-trabalho";
import { contratosDaProposta } from "@/lib/temis/contrato-guardado-db";
import { autorizarLeituraDeContrato } from "@/lib/temis/autorizacao";
import { conferirIndeferimento } from "@/lib/temis/indeferimento";
import { autorizarEmissaoDeContrato } from "@/lib/temis/autorizacao";

// A TELA DE TRABALHO DE UM CARD — o que abre quando o operador clica no quadro.
//
// Lucas (09/09/2026): *"ao clicar no card abrisse uma tela de trabalho. primeiro, na primeira
// etapa, acho que deveria trazer os dados dos proponentes, imobiliaria, a proposta"*.
//
// ⚠️ LER É LEITURA, INDEFERIR É COORDENAÇÃO. O GET usa `autorizarLeituraDeContrato` (a mesma régua
// de quem abre um contrato já gerado); o POST de indeferir usa `autorizarEmissaoDeContrato`, que é
// o recorte estreito da coordenação — indeferir devolve o trabalho para quem vendeu e dispara
// aviso para fora da casa, então não é ato de quem só consulta.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// `dadosDaProposta` faz ~10 consultas ao Supabase. Folga para o pior caso.
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = await autorizarLeituraDeContrato(request);
  if (!auth.ok) return auth.response;

  const id = new URL(request.url).searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "Informe o trabalho." }, { status: 400 });
  }

  const sb = createApoloAdminClient();
  if (!sb) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { data: card, error } = await sb
    .from("temis_trabalhos")
    .select(
      // ⚠️ OS NOMES SÃO `enterprise_*` E `cliente_cpf`, conferidos no schema. A primeira versão
      // pediu `empreendimento_codigo`, `empreendimento_nome` e `cliente_documento` — nomes que não
      // existem —, e o PostgREST devolveu erro para a linha inteira: a tela abria dizendo "Nao foi
      // possivel abrir" sem dizer por quê. O `select` é string, então o typecheck não alcança;
      // quem confere é o schema.
      // ⚠️ `observacao` É O PEDIDO INTEIRO, e faltava. Num cancelamento ela guarda o motivo, o
      // COD do contrato, o que o sistema apurou sobre assinatura e pagamento e a classificação
      // que decidiu entre cancelamento e distrato. Sem ela a etapa 1 mostrava a proposta
      // comercial da venda e mais nada — Lucas (10/09/2026): *"faltou o motivo do cancelamento
      // e eu preciso saber o que é, quando abro a tela eu não identifiquei que era um
      // cancelamento"*.
      "id, tipo, estagio, estagio_desde, proposta_id, cliente_nome, cliente_cpf, unidade, enterprise_codigo, enterprise_nome, indeferido_em, indeferido_motivo, indeferido_observacao, indeferido_por_nome, arrependimento_inicio, observacao",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[temis][trabalho] falha ao ler o card", error);
    // ⚠️ A MENSAGEM DO BANCO VAI JUNTO. Esta rota é interna (só coordenação chega nela), e uma
    // frase muda como "Nao foi possivel abrir" custou uma investigação inteira: o erro real era
    // nome de coluna errado, e a tela não tinha como dizer isso.
    return NextResponse.json(
      { error: `Não foi possível abrir: ${error.message}` },
      { status: 503 },
    );
  }
  if (!card) return NextResponse.json({ error: "Trabalho nao encontrado." }, { status: 404 });

  // ⚠️ CARD SEM PROPOSTA NÃO É ERRO. Os quatro cards antigos (Garden e Lavra) nasceram antes da
  // migration 0134 e têm `proposta_id` nulo: a tela abre com o cabeçalho e diz que não há venda
  // ligada, em vez de mostrar blocos vazios como se fosse cadastro incompleto.
  // A análise e os contratos vão juntos: a etapa 1 usa a primeira, a etapa 2 a segunda, e a tela
  // troca de painel sem ir buscar de novo.
  const [analise, contratos] = card.proposta_id
    ? await Promise.all([
        analiseDoTrabalho(sb, String(card.proposta_id)).catch((e: unknown) => {
          console.error("[temis][trabalho] falha ao montar a analise", e);
          return null;
        }),
        contratosDaProposta(sb, String(card.proposta_id)).catch((e: unknown) => {
          console.error("[temis][trabalho] falha ao ler os contratos", e);
          return [];
        }),
      ])
    : [null, []];

  return NextResponse.json(
    { data: { analise, card: { ...card, contratos } } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * INDEFERIR — a Têmis recusa o trabalho e devolve a quem vendeu.
 *
 * ⚠️ NÃO É REPROVA DE CRÉDITO (Lucas, 10/09/2026: *"credito? não tem credito na temis"*). Crédito
 * mora no Apolo. Aqui se recusa o TRABALHO: falta documento, dado divergente, condição que não
 * confere.
 *
 * ⚠️ O AVISO PARA CORRETOR E IMOBILIÁRIA AINDA NÃO SAI DAQUI. Lucas pediu que o indeferimento
 * chegue neles pela central de Relacionamento, e no coordenador dentro do Panteon. Esta rota
 * GRAVA a decisão com motivo; o disparo entra em seguida, e é por isso que o motivo já é
 * obrigatório no banco: sem ele, a mensagem sairia dizendo "recusado" e nada mais.
 */
export async function POST(request: Request) {
  const auth = await autorizarEmissaoDeContrato(request);
  if (!auth.ok) return auth.response;

  const corpo = (await request.json().catch(() => ({}))) as {
    id?: string;
    motivo?: string;
    observacao?: string;
  };

  const id = String(corpo.id ?? "").trim();
  if (!id) return NextResponse.json({ error: "Informe o trabalho." }, { status: 400 });

  const conferido = conferirIndeferimento({
    motivo: String(corpo.motivo ?? ""),
    observacao: String(corpo.observacao ?? ""),
  });
  if (!conferido.ok) {
    return NextResponse.json({ error: conferido.erro }, { status: 400 });
  }

  const sb = createApoloAdminClient();
  if (!sb) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  // ⚠️ O NOME É ACESSÓRIO E NÃO PODE DERRUBAR O INDEFERIMENTO. Mesmo desenho de `nomeDoUsuario`
  // em `/api/temis/contrato/gerar`: falha na leitura vira `null`, e o registro sai sem o nome de
  // quem indeferiu em vez de não sair.
  // ⚠️ `try/catch`, E NÃO `.catch()`: o builder do Supabase é um `PromiseLike`, não uma Promise —
  // ele tem `.then` mas não `.catch`, e o typecheck pega isso.
  let quem: null | { display_name: null | string } = null;
  try {
    const r = await sb
      .from("hub_users")
      .select("display_name")
      .eq("id", auth.userId)
      .maybeSingle<{ display_name: null | string }>();
    quem = r.data;
  } catch {
    // O nome é acessório: sem ele o registro sai sem quem indeferiu, em vez de não sair.
  }

  const agora = new Date().toISOString();
  const { error } = await sb
    .from("temis_trabalhos")
    .update({
      atualizado_em: agora,
      estagio: "indeferido",
      // ⚠️ `estagio_desde` ANDA AQUI, e isso é diferente da tradução de nomes da migration 0150.
      // Indeferir é um movimento de verdade: o card entra numa situação nova, e o relógio dessa
      // situação começa agora.
      estagio_desde: agora,
      indeferido_em: agora,
      indeferido_motivo: conferido.motivo,
      indeferido_observacao: conferido.observacao,
      indeferido_por: auth.userId,
      indeferido_por_nome: quem?.display_name ?? null,
    })
    .eq("id", id)
    // Faturado é o fim: um contrato que já virou venda não volta para indeferido.
    .neq("estagio", "faturado");

  if (error) {
    console.error("[temis][trabalho] falha ao indeferir", error);
    return NextResponse.json({ error: "Nao foi possivel indeferir." }, { status: 503 });
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
