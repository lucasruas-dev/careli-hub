// AS ESCRITAS DO BOARD PELO PORTAL: o que as rotas `/api/incorporador/board/[id]/**` que gravam
// precisam saber, num lugar só.
//
// 1) DE QUAL PRODUTO É A ESCRITA (`idsDaEscritaNoBoard`). Decisão do Lucas (16/09/2026, D1): no
//    portal que confecciona (o Cecílio) toda escrita só vale no produto que ele opera
//    (`operado_por`); VOC (37) e VOR (41) ficam só consulta. A régua é a de
//    `operacao-do-produto-servidor.ts`; aqui mora só a pergunta "quais enterprises esta escrita toca",
//    igual nas quatro rotas do board (ficha, etapa, habilitar, identidade), para nenhuma decidir
//    diferente das outras.
//
// 2) A TROCA DO DOCUMENTO JÁ CONSULTADO NO SERASA (`conferirTrocaDeDocumentoConsultado`). Pendência
//    da correção do crédito (16/09/2026): no portal que opera sozinho o CPF do cônjuge é campo da
//    ficha e o documento do titular é corrigível pela identidade. Trocar o documento DEPOIS da
//    consulta fazia a CAD carregar o resultado de outra pessoa (a consulta guardada é do documento
//    antigo), ou abria o laço "troca o CPF, consulta de novo" na conta da Careli. Depois da consulta,
//    o documento daquele alvo só muda pela Careli.
import { NextResponse } from "next/server";

import type { createApoloAdminClient } from "@/lib/apolo/server";

import type { CadNoEscopo, RecorteDoProduto } from "./board-do-portal";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// ── 1) OS ENTERPRISES DA ESCRITA ────────────────────────────────────────────

/**
 * Os enterprises que uma escrita do board toca: a CAD que o escopo resolveu ou, sem CAD (a porta da
 * imobiliária, que não tem esteira), TODOS os ids do recorte do produto.
 *
 * ⚠️ SEM CAD, O RECORTE INTEIRO, E NÃO "NENHUM". A decisão sobre a imobiliária vale para o produto
 * que o portal abriu; se o recorte cobre um produto que ele não opera, a régua recusa o pedido
 * inteiro (um id de fora basta). Lista vazia nunca vira "pode": a régua a trata como pedido sem alvo.
 */
export function idsDaEscritaNoBoard(
  escopo: Pick<CadNoEscopo, "enterpriseId">,
  recorte: Pick<RecorteDoProduto, "ids">,
): string[] {
  return escopo.enterpriseId ? [escopo.enterpriseId] : [...recorte.ids];
}

// ── 2) O DOCUMENTO JÁ CONSULTADO ────────────────────────────────────────────

/** De quem é o documento que a escrita troca: o dono da ficha ou o cônjuge (campo da ficha). */
export type AlvoDaConsulta = "conjuge" | "titular";

/**
 * A finalidade que separa a consulta do cônjuge da do titular em `serasa_consultas` (as duas ficam
 * no `entity_id` do titular). É o `FINALIDADE_CONJUGE` de lib/serasa/consulta-servico.ts: o literal
 * mora aqui para as rotas do board não carregarem o cliente do Serasa e o PDF do comprovante; o teste
 * confere que os dois não se separam.
 */
export const FINALIDADE_DA_CONSULTA_DO_CONJUGE = "analise-credito-conjuge";

/**
 * A reserva do portal que desistiu antes de chamar o Serasa (`MARCA_DESISTIU` do serviço): não é
 * consulta, não trava nada. O teste confere o literal contra o serviço.
 */
export const RESERVA_QUE_NAO_CONSULTOU = "reserva-do-portal-desistiu-sem-chamar-o-serasa";

/** O que a trava precisa de cada linha de `serasa_consultas` desta ficha. */
export type ConsultaDaFicha = {
  created_at: null | string;
  documento: null | string;
  erro: null | string;
  finalidade: null | string;
};

export const MENSAGEM_CPF_JA_CONSULTADO =
  "Este CPF já foi consultado na análise de crédito. Peça a correção à Careli.";
export const MENSAGEM_CNPJ_JA_CONSULTADO =
  "Este CNPJ já foi consultado na análise de crédito. Peça a correção à Careli.";

const soDigitos = (valor: unknown): string =>
  typeof valor === "string" || typeof valor === "number" ? String(valor).replace(/\D/g, "") : "";

/**
 * A troca pedida mexe num documento que já foi consultado para este alvo?
 *
 * Trava quando existe consulta do alvo nesta ficha (qualquer status, menos a reserva que desistiu
 * sem chamar: a que deu erro pode ter sido cobrada) E o documento novo é diferente do da consulta
 * MAIS RECENTE daquele alvo. Mandar o mesmo documento (corrigir só o nome, salvar a ficha sem mexer
 * no CPF) não é troca e passa. Apagar o documento é troca e trava.
 */
export function trocaDeDocumentoConsultado(
  consultas: readonly ConsultaDaFicha[],
  alvo: AlvoDaConsulta,
  documentoNovo: unknown,
): boolean {
  const doAlvo = consultas
    .filter((linha) => linha.erro !== RESERVA_QUE_NAO_CONSULTOU)
    .filter((linha) =>
      alvo === "conjuge"
        ? linha.finalidade === FINALIDADE_DA_CONSULTA_DO_CONJUGE
        : linha.finalidade !== FINALIDADE_DA_CONSULTA_DO_CONJUGE,
    )
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));

  const maisRecente = doAlvo[0];
  if (!maisRecente) return false;
  return soDigitos(maisRecente.documento) !== soDigitos(documentoNovo);
}

/**
 * A trava no servidor: lê as consultas da ficha e responde a recusa pronta, ou `null` para seguir.
 *
 *   • troca de documento já consultado → 409 com a frase do CPF (ou do CNPJ, pelo tamanho);
 *   • leitura que falha → 503. "Não sei se já consultei" não pode virar "pode trocar".
 *
 * Quem chama decide QUANDO chamar: só o portal que opera sozinho, e só quando a escrita mexe no
 * documento daquele alvo (o `conjugeCpf` na ficha, o documento na identidade).
 */
export async function conferirTrocaDeDocumentoConsultado(
  admin: AdminClient,
  pedido: { alvo: AlvoDaConsulta; documentoNovo: unknown; entityId: string },
): Promise<NextResponse | null> {
  let consultas: ConsultaDaFicha[];
  try {
    const { data, error } = await admin
      .from("serasa_consultas")
      .select("documento, finalidade, erro, created_at")
      .eq("entity_id", pedido.entityId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    consultas = (data ?? []) as ConsultaDaFicha[];
  } catch (erro) {
    console.error("[incorporador][board] sem as consultas de crédito da ficha", {
      entityId: pedido.entityId,
      erro: (erro as Error).message,
    });
    return NextResponse.json(
      { error: "Não foi possível conferir a análise de crédito desta ficha agora. Nada foi alterado." },
      { status: 503 },
    );
  }

  if (!trocaDeDocumentoConsultado(consultas, pedido.alvo, pedido.documentoNovo)) return null;

  const cnpj = soDigitos(pedido.documentoNovo).length === 14;
  return NextResponse.json(
    { error: cnpj ? MENSAGEM_CNPJ_JA_CONSULTADO : MENSAGEM_CPF_JA_CONSULTADO, motivo: "documento_consultado" },
    { status: 409 },
  );
}
