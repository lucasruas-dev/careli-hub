import { NextResponse } from "next/server";

import { authorizeApoloCoordenacao } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { conferirContratoDeCorretagemZero } from "@/lib/apolo/termo-de-rescisao-server";
import {
  FRASE_DO_FORMATO_DO_VALOR,
  LIMITE_DA_OBSERVACAO_DA_CONFERENCIA,
  lerValorEmReaisBr,
} from "@/lib/apolo/valor-em-reais-br";
import { ehTabelaAusente } from "@/lib/temis/tabela-ausente";

// A CONFERÊNCIA DA CORRETAGEM ZERO — a coordenação olha o contrato assinado e libera a simulação.
//
// Lucas (30/09/2026): quando o contrato de corretagem da venda registra R$ 0,00, a Simulação de
// Rescisão recusa (`motivo: "corretagem_zero"`). Esta rota grava o que a coordenação viu no papel
// assinado, em `hercules_conferencia_corretagem` (migration 0202): "não houve corretagem" (a linha
// sai do papel) ou "houve, de R$ X" (a linha sai com o valor lido). Quem decide o efeito no papel é
// `montarDadosDaRescisao`; aqui só se grava e se lê.
//
// ⚠️ SÓ A COORDENAÇÃO (admin e líder, `authorizeApoloCoordenacao`), nos DOIS verbos. Decisão do
// Lucas: o operador de atendimento entrega o papel, mas quem responde "houve corretagem?" é quem tem
// o contrato assinado na mão. A recusa do portão (403) leva a frase que diz isso, e não o "sem
// acesso" genérico.
//
// ⚠️ A ORDEM DAS GUARDAS É A DA ROTA DA POSSE: auth → corpo legível → infraestrutura → validação. O
// mesmo pedido torto responde a mesma coisa com ou sem Supabase.
//
// ⚠️ ANTES DE GRAVAR, O C2X É CONSULTADO (SELECT): o contrato tem de ser do cliente `c2xId` e a
// comissão lida do contrato de corretagem tem de ser EXATAMENTE zero. A conferência só tem efeito
// nesse caso, e gravar fora dele deixaria uma decisão inerte pendurada. Contrato de outro cliente é
// 404 e comissão diferente de zero é 422, com a frase. Para LER (GET) a guarda confere só o
// pertencimento: quem corrige uma conferência antiga precisa vê-la mesmo que o C2X já tenha sido
// corrigido para outro valor.
//
// ⚠️ HISTÓRICO, E O PUT SÓ INSERE (decisão de 01/10/2026, achado da revisão da Publicação). A versão
// de 30/09 regravava por cima (`upsert`), e uma correção apagava o rastro do valor anterior. Agora
// cada PUT é uma linha NOVA e vale a mais recente (`conferido_em desc, id`), sem UPDATE em lugar
// nenhum. O verbo continua PUT por compatibilidade com o painel; semanticamente é um POST. O nome
// de quem registrou é COPIADO da sessão (`auth.nome`), não resolvido por join, e o `local-hub-user`
// nunca chega ao insert: a mesma ausência de credencial que o gera faz o `createApoloAdminClient`
// devolver null, e a rota para no 503 antes de tocar no banco.
//
// ⚠️ O VALOR É LIDO PELO FORMATO BRASILEIRO ESTRITO (`lerValorEmReaisBr`, a mesma função que o painel
// usa na confirmação): ponto é sempre milhar e vírgula é sempre decimal. "7.000" tem de gravar R$
// 7.000,00 e nunca R$ 7,00; o que é ambíguo é recusado com a frase do formato.
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

/** O mesmo teto do CHECK da 0202 e do `maxLength` do painel (a constante mora na lib compartilhada). */
const LIMITE_DA_OBSERVACAO = LIMITE_DA_OBSERVACAO_DA_CONFERENCIA;
/** Quantas conferências o GET devolve (a mais recente e as anteriores). */
const LIMITE_DO_HISTORICO = 10;

const RESULTADOS = ["sem_corretagem", "com_corretagem"] as const;
type Resultado = (typeof RESULTADOS)[number];

type CorpoDaConferencia = {
  c2xId?: unknown;
  contrato?: unknown;
  observacao?: unknown;
  resultado?: unknown;
  valor?: unknown;
};

type LinhaDaConferencia = {
  conferido_em: null | string;
  conferido_por_nome: null | string;
  id: string;
  observacao: null | string;
  resultado: null | string;
  valor_em_reais: null | number | string;
};

/** Id plausível: só dígitos, até 15 casas (o contrato é bigint e acima de 2^53 chegaria arredondado). */
function idPlausivel(valor: unknown): null | number {
  const bruto = String(valor ?? "").trim();
  if (!/^\d{1,15}$/.test(bruto)) return null;
  const numero = Number(bruto);
  return numero > 0 ? numero : null;
}

function erro(mensagem: string, status: number) {
  return NextResponse.json({ error: mensagem }, { status });
}

/**
 * O portão da coordenação. O 403 ganha a frase da regra; o 401 (sessão) segue com a resposta do
 * portão.
 */
async function portao(request: Request, fraseDoAcesso: string) {
  const auth = await authorizeApoloCoordenacao(request);
  if (auth.ok) return { auth, response: null } as const;

  if (auth.response.status === 403) {
    return { auth: null, response: erro(fraseDoAcesso, 403) } as const;
  }
  return { auth: null, response: auth.response } as const;
}

/**
 * Lê a conferência atual e o histórico recente do contrato (a mais recente primeiro).
 *
 * ⚠️ O GET NÃO EXIGE COMISSÃO ZERO: ver o cabeçalho. Só confere que o contrato é do cliente.
 */
export async function GET(request: Request) {
  const { auth, response } = await portao(
    request,
    "Só a coordenação (admin ou líder) consulta a conferência da corretagem.",
  );
  if (!auth) return response;

  const params = new URL(request.url).searchParams;
  const c2xId = idPlausivel(params.get("c2xId"));
  const contratoId = idPlausivel(params.get("contrato"));
  if (c2xId === null || contratoId === null) {
    return erro("Informe o cliente e o contrato da conferência.", 400);
  }

  const admin = createApoloAdminClient();
  if (!admin) return erro("Supabase indisponível.", 503);

  const conferivel = await conferirContratoDeCorretagemZero({ c2xId, contratoId }, { exigirZero: false });
  if (!conferivel.ok) return erro(conferivel.error, conferivel.status);

  try {
    const { data, error: erroDoBanco } = await admin
      .from(TABELA)
      .select("id,resultado,valor_em_reais,observacao,conferido_por_nome,conferido_em")
      .eq("workspace_id", WORKSPACE)
      .eq("contrato_c2x_id", contratoId)
      .order("conferido_em", { ascending: false })
      .order("id", { ascending: false })
      .limit(LIMITE_DO_HISTORICO);

    if (erroDoBanco) {
      if (ehTabelaAusente(erroDoBanco, TABELA)) {
        return erro("A tabela da conferência ainda não foi criada.", 503);
      }
      throw new Error(erroDoBanco.message);
    }

    const historico = ((data ?? []) as LinhaDaConferencia[]).map((linha) => {
      const valor = linha.valor_em_reais === null || linha.valor_em_reais === "" ? null : Number(linha.valor_em_reais);
      return {
        conferido_em: linha.conferido_em,
        conferido_por_nome: linha.conferido_por_nome,
        observacao: linha.observacao,
        resultado: linha.resultado,
        valor: valor !== null && Number.isFinite(valor) ? valor : null,
      };
    });

    return NextResponse.json(
      { data: { atual: historico[0] ?? null, historico } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (falha) {
    console.error("[apolo][rescisao][conferencia-corretagem][GET]", falha);
    return erro("Não foi possível ler a conferência da corretagem.", 503);
  }
}

/** Registra uma conferência NOVA (insert). A mais recente passa a valer. */
export async function PUT(request: Request) {
  const { auth, response } = await portao(
    request,
    "Só a coordenação (admin ou líder) registra a conferência da corretagem.",
  );
  if (!auth) return response;

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
  if (observacao.length > LIMITE_DA_OBSERVACAO) {
    return erro(`A observação passa de ${LIMITE_DA_OBSERVACAO} caracteres. Resuma o que você viu no contrato assinado.`, 400);
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
    valor = lerValorEmReaisBr(corpo.valor);
    if (valor === null) return erro(FRASE_DO_FORMATO_DO_VALOR, 400);
  }

  const conferivel = await conferirContratoDeCorretagemZero({ c2xId, contratoId });
  if (!conferivel.ok) return erro(conferivel.error, conferivel.status);

  // ⚠️ O VALOR CONFERIDO TEM TETO: O PREÇO DO LOTE. Achado da revisão de 30/09/2026: só "maior que
  // zero" deixava passar R$ 700.000 digitado no lugar de R$ 7.000, e a base "tabela menos comissão"
  // da multa e da publicidade ficaria negativa num papel que vai ao cliente. Corretagem do tamanho do
  // lote não existe; sem preço conhecido, não há como conferir, e a gravação recusa.
  if (valor !== null) {
    if (conferivel.valorDeTabela === null) {
      return erro("A unidade está sem valor de tabela no C2X, e sem ele não dá para conferir o valor da corretagem.", 422);
    }
    if (valor >= conferivel.valorDeTabela) {
      return erro(
        "O valor da corretagem informado não é menor que o valor de tabela da unidade. Confira o número lido no contrato assinado.",
        400,
      );
    }
  }

  try {
    const { error: erroDoBanco } = await admin.from(TABELA).insert({
      conferido_em: new Date().toISOString(),
      conferido_por: auth.userId,
      conferido_por_nome: auth.nome,
      contrato_c2x_id: contratoId,
      observacao,
      resultado,
      valor_em_reais: valor,
      workspace_id: WORKSPACE,
    });

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
