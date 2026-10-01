import { NextResponse } from "next/server";

import { authorizeApoloCoordenacao } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { conferirContratoDeCorretagemZero } from "@/lib/apolo/termo-de-rescisao-server";
import { ehTabelaAusente } from "@/lib/temis/tabela-ausente";

// A CONFERÊNCIA DA CORRETAGEM ZERO — a coordenação olha o contrato assinado e libera a simulação.
//
// Lucas (30/09/2026): quando o contrato de corretagem da venda registra R$ 0,00, a Simulação de
// Rescisão recusa (`motivo: "corretagem_zero"`). Esta rota grava o que a coordenação viu no papel
// assinado, em `hercules_conferencia_corretagem` (migration 0202): "não houve corretagem" (a linha
// sai do papel) ou "houve, de R$ X" (a linha sai com o valor lido). Quem decide o efeito no papel é
// `montarDadosDaRescisao`; aqui só se grava.
//
// ⚠️ SÓ A COORDENAÇÃO (admin e líder, `authorizeApoloCoordenacao`). Decisão do Lucas: o operador de
// atendimento entrega o papel, mas quem responde "houve corretagem?" é quem tem o contrato assinado
// na mão. A recusa do portão (403) leva a frase que diz isso, e não o "sem acesso" genérico.
//
// ⚠️ A ORDEM DAS GUARDAS É A DA ROTA DA POSSE: auth → corpo legível → infraestrutura → validação. O
// mesmo pedido torto responde a mesma coisa com ou sem Supabase.
//
// ⚠️ ANTES DE GRAVAR, O C2X É CONSULTADO (SELECT): o contrato tem de ser do cliente `c2xId` e a
// comissão lida do contrato de corretagem tem de ser EXATAMENTE zero. A conferência só tem efeito
// nesse caso, e gravar fora dele deixaria uma decisão inerte pendurada. Contrato de outro cliente é
// 404 e comissão diferente de zero é 422, com a frase.
//
// ⚠️ UMA CONFERÊNCIA POR CONTRATO: gravar de novo SUBSTITUI. O `.upsert()` aqui é seguro (ao
// contrário da posse) porque a unicidade é uma CONSTRAINT comum em (workspace_id, contrato_c2x_id),
// e não um índice parcial; o `on_conflict` do PostgREST a encontra. O carimbo (quem, nome, quando)
// é reescrito junto, para o papel não atribuir a quem conferiu antes um resultado que outro corrigiu.
//
// ⚠️ O NOME É COPIADO DA SESSÃO (`auth.nome`), não resolvido por join, e o `local-hub-user` nunca
// chega ao insert: a mesma ausência de credencial que o gera faz o `createApoloAdminClient` devolver
// null, e a rota para no 503 antes de tocar no banco.
//
// ⚠️ `maxDuration = 30` COMO A ROTA DO PDF: a guarda lê o extrato e o contrato no C2X, e um estouro
// de tempo sem o teto vira "Unexpected token" no painel em vez da frase.
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const runtime = "nodejs";

// ⚠️ "careli", A STRING (coluna TEXT default 'careli', migration 0202): um uuid casaria zero linhas
// em silêncio, e o termo seguiria recusando mesmo com a conferência gravada.
const WORKSPACE = "careli";
const TABELA = "hercules_conferencia_corretagem";

const RESULTADOS = ["sem_corretagem", "com_corretagem"] as const;
type Resultado = (typeof RESULTADOS)[number];

type CorpoDaConferencia = {
  c2xId?: unknown;
  contrato?: unknown;
  observacao?: unknown;
  resultado?: unknown;
  valor?: unknown;
};

/** Id plausível: só dígitos, até 15 casas (o contrato é bigint e acima de 2^53 chegaria arredondado). */
function idPlausivel(valor: unknown): null | number {
  const bruto = String(valor ?? "").trim();
  if (!/^\d{1,15}$/.test(bruto)) return null;
  const numero = Number(bruto);
  return numero > 0 ? numero : null;
}

/**
 * O valor em reais lido no contrato, ou `null` se não for um valor utilizável.
 *
 * Aceita número ou texto no formato brasileiro ("7.000,50"), com no máximo 2 casas, positivo e dentro
 * do `numeric(12,2)` da coluna (abaixo de 10^10). Qualquer outra coisa é recusada com a frase, em vez
 * de virar um 22003 do banco.
 */
function valorEmReais(valor: unknown): null | number {
  let numero: number;
  if (typeof valor === "number") {
    numero = valor;
  } else if (typeof valor === "string") {
    const bruto = valor.trim().replace(/^R\$\s*/i, "");
    if (!bruto) return null;
    const normalizado = bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto;
    if (!/^\d+(\.\d+)?$/.test(normalizado)) return null;
    numero = Number(normalizado);
  } else {
    return null;
  }

  if (!Number.isFinite(numero) || numero <= 0 || numero >= 1e10) return null;
  const emCentavos = Math.round(numero * 100);
  return Math.abs(emCentavos - numero * 100) < 1e-6 ? emCentavos / 100 : null;
}

function erro(mensagem: string, status: number) {
  return NextResponse.json({ error: mensagem }, { status });
}

export async function PUT(request: Request) {
  const auth = await authorizeApoloCoordenacao(request);
  if (!auth.ok) {
    // Só o 403 ganha a frase da regra; 401 (sessão) segue com a resposta do portão.
    if (auth.response.status === 403) {
      return erro("Só a coordenação (admin ou líder) registra a conferência da corretagem.", 403);
    }
    return auth.response;
  }

  // `try/catch` e não `.json().catch(() => null)`: o JSON `null` é válido e passaria como corpo.
  let corpo: CorpoDaConferencia;
  try {
    const lido: unknown = await request.json();
    if (lido === null || typeof lido !== "object" || Array.isArray(lido)) {
      return erro("Corpo inválido.", 400);
    }
    corpo = lido as CorpoDaConferencia;
  } catch {
    return erro("Corpo inválido.", 400);
  }

  const admin = createApoloAdminClient();
  if (!admin) return erro("Supabase indisponível.", 503);

  const c2xId = idPlausivel(corpo.c2xId);
  const contratoId = idPlausivel(corpo.contrato);
  if (c2xId === null || contratoId === null) {
    return erro("Informe o cliente e o contrato da conferência.", 400);
  }

  const resultado = RESULTADOS.find((r) => r === corpo.resultado) as Resultado | undefined;
  if (!resultado) {
    return erro("Escolha o resultado da conferência: não houve corretagem, ou houve.", 400);
  }

  const observacao = String(corpo.observacao ?? "").trim();
  if (!observacao) {
    return erro("Escreva a observação: o que você viu no contrato assinado.", 400);
  }

  // ⚠️ O VALOR É COERENTE COM O RESULTADO, igual ao CHECK da migration: "não houve" não leva valor
  // (mandar um seria a dúvida de qual dos dois vale) e "houve" exige um valor positivo.
  const temValor = corpo.valor !== undefined && corpo.valor !== null && String(corpo.valor).trim() !== "";
  let valor: null | number = null;
  if (resultado === "sem_corretagem") {
    if (temValor) {
      return erro("Quando não houve corretagem, o valor não é informado.", 400);
    }
  } else {
    valor = valorEmReais(corpo.valor);
    if (valor === null) {
      return erro("Informe o valor da corretagem lido no contrato assinado, em reais e maior que zero.", 400);
    }
  }

  const conferivel = await conferirContratoDeCorretagemZero({ c2xId, contratoId });
  if (!conferivel.ok) return erro(conferivel.error, conferivel.status);

  try {
    const { error: erroDoBanco } = await admin.from(TABELA).upsert(
      {
        conferido_em: new Date().toISOString(),
        conferido_por: auth.userId,
        conferido_por_nome: auth.nome,
        contrato_c2x_id: contratoId,
        observacao,
        resultado,
        valor_em_reais: valor,
        workspace_id: WORKSPACE,
      },
      { onConflict: "workspace_id,contrato_c2x_id" },
    );

    if (erroDoBanco) {
      if (ehTabelaAusente(erroDoBanco, TABELA)) {
        return erro("A tabela da conferência ainda não foi criada.", 503);
      }
      throw new Error(erroDoBanco.message);
    }

    return NextResponse.json({ data: { contrato: contratoId, resultado, valor } });
  } catch (falha) {
    console.error("[apolo][rescisao][conferencia-corretagem][PUT]", falha);
    return erro("Não foi possível gravar a conferência da corretagem.", 500);
  }
}
