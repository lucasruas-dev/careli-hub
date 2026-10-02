import { NextResponse } from "next/server";

import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import { setEnterpriseDiasDeVencimento } from "@/lib/apolo/enterprise-settings";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { carregarCadastroDeEmpreendimentos, type LinhaDoCadastro } from "@/lib/hercules/cadastro";
import {
  conferirDiasDeVencimento,
  diasDoBanco,
  diasDoEmpreendimento,
  empreendimentoDoCadastro,
  paiNoCadastro,
} from "@/lib/hercules/dias-de-vencimento";
import {
  ehColunaDosDiasAusente,
  lerDiasCadastrados,
} from "@/lib/hercules/dias-de-vencimento-server";

// OS DIAS DE VENCIMENTO DO EMPREENDIMENTO — o bloco da aba Políticas comerciais do Apolo.
//
// Lucas (02/10/2026): *"vamos colocar uma parte que apontamos os dias de vencimento da parcela (...)
// o usuario pode colocar as datas, inserir mais de uma"*. A regra mora em
// `lib/hercules/dias-de-vencimento.ts`; aqui é auth, leitura do parentesco e gravação.
//
//   GET ?enterprise=<id da ficha>&codes=<siglas> → os dias DESTE empreendimento, os do PAI e os que
//        valem (com a origem), para a tela mostrar a herança em vez de um campo vazio.
//   PUT { enterpriseId, codes?, dias: number[] | null } → grava a lista inteira. `null` ou `[]` =
//        voltar a herdar.
//
// ⚠️ A LISTA INTEIRA EM CADA GRAVAÇÃO, e não "adiciona um dia". São poucos números e um significado
// só (a lista que a proposta oferece); mandar o dia solto obrigaria o servidor a ler, juntar e
// regravar, e duas abas abertas perderiam o dia uma da outra do mesmo jeito.
//
// ⚠️ O PARENTESCO VEM DO CADASTRO DO PANTEON (`hercules_empreendimentos.pai_id`), NUNCA DA URL, pelo
// mesmo motivo escrito na rota das premissas de rescisão: quem esquecesse o parâmetro veria "não
// cadastrado" para o que é herdado, e o operador cadastraria uma cópia que mata a herança. As
// `codes` só servem para TRADUZIR o agrupamento sintético (`group:`) no pai das divisões
// (`empreendimentoDoCadastro`), e o cadastro confere que elas têm um pai só.
//
// ⚠️ E SE O CADASTRO OU A LEITURA FALHAREM, O GET RESPONDE 503. Uma tela que não distingue "herdado"
// de "não cadastrado" não pode convidar ninguém a cadastrar.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SEM_A_MIGRATION =
  "Os dias de vencimento ainda não podem ser cadastrados neste ambiente (migration 0210 pendente).";

const AGRUPAMENTO =
  "Este produto é um agrupamento sem empreendimento principal no cadastro. Cadastre os dias em cada divisão.";

const SEM_CADASTRO_DO_PANTEON =
  "Não foi possível conferir se este empreendimento herda os dias do principal. Recarregue a tela.";

function siglas(bruto: unknown): string[] {
  const texto = Array.isArray(bruto) ? bruto.join(",") : typeof bruto === "string" ? bruto : "";
  return texto
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
}

async function lerCadastro(): Promise<LinhaDoCadastro[] | null> {
  try {
    return await carregarCadastroDeEmpreendimentos();
  } catch (erro) {
    console.error("[apolo][dias-de-vencimento] cadastro", erro);
    return null;
  }
}

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const pedido = (url.searchParams.get("enterprise") ?? "").trim();
  if (!pedido) {
    return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });
  }

  const cadastro = await lerCadastro();
  if (!cadastro) {
    return NextResponse.json({ error: SEM_CADASTRO_DO_PANTEON }, { status: 503 });
  }

  const enterpriseId = empreendimentoDoCadastro(
    cadastro,
    pedido,
    siglas(url.searchParams.get("codes")),
  );
  if (!enterpriseId) {
    return NextResponse.json({ error: AGRUPAMENTO }, { status: 422 });
  }
  const paiEnterpriseId = paiNoCadastro(cadastro, enterpriseId);

  const lido = await lerDiasCadastrados(admin, [enterpriseId, paiEnterpriseId]);
  if (!lido.ok) {
    return NextResponse.json(
      {
        error: lido.colunaAusente
          ? SEM_A_MIGRATION
          : `Não foi possível ler os dias de vencimento: ${lido.erro}`,
      },
      { status: 503 },
    );
  }

  const daLinha = (id: null | string) =>
    id ? diasDoBanco(lido.linhas.find((linha) => linha.enterpriseId === id)?.dias) : null;

  return NextResponse.json(
    {
      data: {
        doPai: daLinha(paiEnterpriseId),
        // O id em que a tela GRAVA: o da ficha, ou o pai quando a ficha é um agrupamento.
        enterpriseId,
        paiEnterpriseId,
        proprios: daLinha(enterpriseId),
        valendo: diasDoEmpreendimento({ enterpriseId, paiEnterpriseId }, lido.linhas),
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  // ⚠️ SÓ OBJETO É CORPO. `null` é JSON válido, e `corpo.enterpriseId` sobre ele estouraria fora de
  // qualquer try (o buraco que a rota das premissas fechou em 15/09/2026).
  let corpo: { codes?: unknown; dias?: unknown; enterpriseId?: unknown };
  try {
    const lido: unknown = await request.json();
    if (lido === null || typeof lido !== "object" || Array.isArray(lido)) {
      return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
    }
    corpo = lido as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const pedido = typeof corpo.enterpriseId === "string" ? corpo.enterpriseId.trim() : "";
  if (!pedido) {
    return NextResponse.json({ error: "Informe o empreendimento." }, { status: 400 });
  }

  // ⚠️ AUSENTE NÃO É "VOLTAR A HERDAR". Um corpo sem a chave `dias` é pedido torto, e lê-lo como
  // `null` apagaria o cadastro de quem só mandou o empreendimento.
  if (!("dias" in corpo)) {
    return NextResponse.json({ error: "Informe os dias de vencimento." }, { status: 400 });
  }

  const conferido = conferirDiasDeVencimento(corpo.dias);
  if (!conferido.ok) {
    return NextResponse.json({ error: conferido.erro }, { status: 422 });
  }

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Supabase indisponível." }, { status: 503 });
  }

  let enterpriseId = pedido;
  if (pedido.startsWith("group:")) {
    const cadastro = await lerCadastro();
    if (!cadastro) {
      return NextResponse.json({ error: SEM_CADASTRO_DO_PANTEON }, { status: 503 });
    }
    const traduzido = empreendimentoDoCadastro(cadastro, pedido, siglas(corpo.codes));
    if (!traduzido) {
      return NextResponse.json({ error: AGRUPAMENTO }, { status: 422 });
    }
    enterpriseId = traduzido;
  }

  const gravado = await setEnterpriseDiasDeVencimento({
    adminClient: admin,
    dias: conferido.dias,
    enterpriseId,
    updatedBy: auth.userId,
  });

  if (!gravado.ok) {
    // ⚠️ "dias_vencimento" SOZINHO NÃO BASTA: o nome do CHECK da 0210 também tem essas palavras, e
    // uma recusa dele não é migration pendente.
    const semColuna = ehColunaDosDiasAusente({ message: gravado.error });
    return NextResponse.json(
      { error: semColuna ? SEM_A_MIGRATION : (gravado.error ?? "Não foi possível salvar.") },
      { status: semColuna ? 503 : 500 },
    );
  }

  return NextResponse.json({ data: { dias: conferido.dias, enterpriseId } });
}
