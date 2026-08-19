import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { enrichPerson } from "@/lib/apolo/mostqi";

// ENRIQUECIMENTO DOS CLIENTES DO LSOFT PELA MOST.
//
// Pedido do Lucas (19/08/2026): "quero rodar todos os clientes na MOST para enriquecer essa base,
// falta muita coisa... pode rodar os clientes dentro da MOST agora".
//
// ⚠️ POR QUE ISSO É UMA ROTA, E NÃO UM SCRIPT. As credenciais da MOST só existem na Vercel: no
// `.env.local` elas não estão, e sem elas a biblioteca cai no modo simulado e devolveria dado
// inventado. Rodar aqui dentro é a única forma de falar com a MOST de verdade.
//
// ⚠️ CADA CLIENTE CUSTA DINHEIRO. São 4 datasets por CPF (~R$ 2,23, a configuração que o Lucas
// fechou em 10/jul), cobrados por consulta. Por isso:
//   • quem já tem `enriquecido_em` é PULADO — reprocessar seria pagar de novo pelo mesmo dado;
//   • o lote é pequeno e explícito, para a conta nunca ser uma surpresa;
//   • `forcar` existe, mas é decisão consciente de pagar de novo.
//
// ⚠️ NÃO SOBRESCREVE O QUE JÁ ESTÁ PREENCHIDO. O que veio do LSoft ou da validação humana vale
// mais que a estimativa da base: a MOST só preenche buraco.
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

/** Quantos CPFs por chamada. A PF_01 leva ~2,6s por CPF; 25 cabem folgados no teto de 300s. */
const LOTE_PADRAO = 25;

/** "M"/"F" da MOST viram o rótulo que o C2X e a tela usam. */
function sexoDaMost(valor: string): null | string {
  const v = valor.trim().toUpperCase();
  if (v.startsWith("M")) return "Masculino";
  if (v.startsWith("F")) return "Feminino";
  return null;
}

/**
 * A renda estimada vira a faixa que o C2X entende.
 *
 * ⚠️ A RÉGUA É O SALÁRIO MÍNIMO de 2026 (R$ 1.518). A MOST devolve valor em reais; o C2X trabalha
 * em faixas de salários. Sem converter aqui, a faixa teria de ser escolhida à mão em 237 fichas.
 */
function faixaDaRenda(renda: number): null | string {
  if (!Number.isFinite(renda) || renda <= 0) return null;
  const salarios = renda / 1518;
  if (salarios <= 1) return "Até 1 salário";
  if (salarios <= 3) return "1 a 3 salários";
  if (salarios <= 5) return "3 a 5 salários";
  if (salarios <= 10) return "5 a 10 salários";
  return "Acima de 10 salários";
}

const soNumero = (valor: string): number => {
  const limpo = valor.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(limpo);
  return Number.isFinite(n) ? n : 0;
};

export async function POST(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  const corpo = (await request.json().catch(() => ({}))) as {
    forcar?: boolean;
    lote?: number;
  };
  const tamanho = Math.min(Math.max(Number(corpo.lote) || LOTE_PADRAO, 1), 50);

  let consulta = admin
    .from("lsoft_clientes")
    .select("codigo, cpf, nome, nascimento, mae, sexo, telefone, celular, email, faixa_renda")
    .not("cpf", "is", null)
    .order("codigo")
    .limit(tamanho);

  if (!corpo.forcar) consulta = consulta.is("enriquecido_em", null);

  const { data: pendentes, error } = await consulta;
  if (error) return NextResponse.json({ error: error.message }, { status: 503 });

  const alvos = (pendentes ?? []) as Record<string, unknown>[];
  if (alvos.length === 0) {
    return NextResponse.json({ data: { enriquecidos: 0, falhas: 0, restam: 0, terminou: true } });
  }

  let enriquecidos = 0;
  let falhas = 0;

  for (const cliente of alvos) {
    const codigo = String(cliente.codigo);
    const cpf = String(cliente.cpf ?? "").replace(/\D/g, "");

    try {
      const dados = await enrichPerson(cpf, { includeRaw: true, query: "CARELI_PF_01" });

      if (!dados.available || dados.source !== "mostqi") {
        // ⚠️ MARCA A TENTATIVA MESMO ASSIM. Sem isso, a próxima rodada tenta de novo e paga de
        // novo pelo mesmo CPF que a base não conhece.
        await admin
          .from("lsoft_clientes")
          .update({
            enriquecido_em: new Date().toISOString(),
            enriquecimento_erro:
              dados.warnings.join(" · ") || `sem retorno da MOST (${dados.source})`,
          })
          .eq("codigo", codigo);
        falhas += 1;
        continue;
      }

      // Só preenche buraco: o que já existe (LSoft ou validação humana) prevalece.
      const atualizacao: Record<string, unknown> = {
        enriquecido_em: new Date().toISOString(),
        enriquecimento: dados.raw ?? null,
        enriquecimento_erro: null,
      };

      if (!cliente.nascimento && dados.nascimento) atualizacao.nascimento = dados.nascimento;
      if (!cliente.mae && dados.nomeMae) atualizacao.mae = dados.nomeMae;
      if (dados.nomePai) atualizacao.nome_pai = dados.nomePai;
      if (!cliente.sexo && dados.sexo) {
        const sexo = sexoDaMost(dados.sexo);
        if (sexo) atualizacao.sexo = sexo;
      }
      if (!cliente.telefone && dados.telefones[0]) atualizacao.telefone = dados.telefones[0];
      if (!cliente.celular && dados.telefones[1]) atualizacao.celular = dados.telefones[1];
      if (!cliente.email && dados.emails[0]) atualizacao.email = dados.emails[0];
      if (dados.profissao) atualizacao.profissao = dados.profissao;
      if (dados.estadoCivil) atualizacao.estado_civil = dados.estadoCivil;

      if (!cliente.faixa_renda && dados.renda) {
        const renda = soNumero(dados.renda);
        const faixa = faixaDaRenda(renda);
        if (faixa) {
          atualizacao.faixa_renda = faixa;
          atualizacao.renda_estimada = renda;
        }
      }

      const { error: erroUpdate } = await admin
        .from("lsoft_clientes")
        .update(atualizacao)
        .eq("codigo", codigo);

      if (erroUpdate) {
        falhas += 1;
        continue;
      }

      enriquecidos += 1;
    } catch (falha) {
      await admin
        .from("lsoft_clientes")
        .update({
          enriquecido_em: new Date().toISOString(),
          enriquecimento_erro: falha instanceof Error ? falha.message : String(falha),
        })
        .eq("codigo", codigo);
      falhas += 1;
    }
  }

  const { count } = await admin
    .from("lsoft_clientes")
    .select("codigo", { count: "exact", head: true })
    .is("enriquecido_em", null)
    .not("cpf", "is", null);

  const restam = count ?? 0;

  return NextResponse.json({
    data: { enriquecidos, falhas, restam, terminou: restam === 0 },
  });
}

/** Quantos faltam, quanto custaria — para decidir antes de gastar. */
export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });

  const { count: pendentes } = await admin
    .from("lsoft_clientes")
    .select("codigo", { count: "exact", head: true })
    .is("enriquecido_em", null)
    .not("cpf", "is", null);

  const { count: prontos } = await admin
    .from("lsoft_clientes")
    .select("codigo", { count: "exact", head: true })
    .not("enriquecido_em", "is", null);

  return NextResponse.json({
    data: {
      // R$ 2,23 = os 4 datasets da configuração fechada em 10/jul (basic_data, phones_extended,
      // emails_extended, financial_data).
      custoEstimado: Number(((pendentes ?? 0) * 2.23).toFixed(2)),
      enriquecidos: prontos ?? 0,
      pendentes: pendentes ?? 0,
    },
  });
}
