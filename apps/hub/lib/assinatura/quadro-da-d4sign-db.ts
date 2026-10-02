import type { SupabaseClient } from "@supabase/supabase-js";

import { perfilDaPessoa } from "./contratos-do-panteon-montagem";
import type { DiarioDaAssinatura, SignatarioDaProposta } from "./diario-do-envelope-db";
import { envelopeVigente } from "./envelope-vigente";
import { naOrdemDaFila } from "./fila-de-assinatura";
import { ACOES_DA_D4SIGN_FICAM_NO_C2X } from "./recusa-de-reenvio";
import { lerQuadro } from "./registro-db";
import { ehTerminal, type EstadoDaAssinatura } from "./tipos";

// O QUADRO DE ASSINATURA DO CONTRATO QUE O C2X MANDOU PELA D4SIGN — o painel da Têmis para o card que
// não tem envelope da Clicksign.
//
// Lucas, 02/10/2026: *"tem com a gente trazer o esquema de assinatura que e criado pelo c2x? os card
// que estao pelo c2x nao tem nada na tela de assinatura"*. Medido no mesmo dia (só SELECT): 5 cards de
// contrato têm só envelope da D4Sign (três em Em assinatura, dois no Pré-faturamento), e a tela dizia
// "Não há signatários para mostrar" sobre contratos com 6 a 10 pessoas no quadro. O selo do card e a
// aba Assinatura do Hércules já liam esse quadro; só a tela de trabalho procurava envelope SÓ da
// Clicksign (`envelopeMaisRecente`, em `diario-do-envelope-db.ts`).
//
// ⚠️ NÃO É O DIÁRIO DA CLICKSIGN SEM O FILTRO, E ISSO FOI MEDIDO ANTES. O diário junta o payload do
// webhook com a lista congelada POR E-MAIL, e na D4Sign o e-mail repete (23 envelopes com duas pessoas
// no mesmo endereço): juntar por e-mail colaria duas pessoas numa linha. Também não há payload (a
// D4Sign não manda webhook ao Panteon), e a chave `c2x:<ss.id>` é recusada pela régua da Clicksign. Aqui
// a fonte é SÓ O QUADRO que o espelho grava (`espelho-d4sign/`), uma linha por item, identificada pela
// chave: o que ele diz é o que o painel mostra.
//
// ⚠️ AS DECISÕES DO LUCAS (02/10/2026, uma por pergunta):
//   1. testemunha *"Entra agora"*: o item marcado pelo C2X (`testemunha`, gravado pelo espelho) sai com
//      o papel `testemunha`, e a tela escreve "Testemunha";
//   2. a ordem é *"A marca do C2X"*: só vira fila em degraus quando o C2X marcou que a ordem vale
//      (`is_to_use_position_to_sign`, que o espelho grava em `ordenada`), como na Clicksign; sem a marca,
//      um grupo só, em ordem alfabética.
//
// ⚠️ NENHUM BOTÃO: `envelopeId` sai NULO de propósito. Reenvio, link e troca de e-mail são gestos da
// Clicksign, e a tela só os oferece com o id do envelope dela; na D4Sign eles ficam no C2X.
//
// ⚠️ NUNCA LANÇA, como o diário: o painel é leitura de apoio, e uma falha aqui vira `null` e log.

/** O que se lê de cada envelope da D4Sign da proposta: a régua do vigente, o quadro e a conferência. */
type LinhaDaD4Sign = {
  atualizado_em: null | string;
  conferido_em: null | string;
  criado_em: string;
  documento_id: null | string;
  enviado_em: null | string;
  envelope_id: null | string;
  estado: string;
  estado_cru: null | string;
  falha: null | string;
  id: string;
  ordenada: boolean | null;
  provedor: string;
  provedor_documento_id: null | string;
  signatarios: unknown;
};

const COLUNAS =
  "id, provedor, envelope_id, provedor_documento_id, documento_id, estado, estado_cru, falha, criado_em, enviado_em, atualizado_em, conferido_em, ordenada, signatarios";

/**
 * O quadro da D4Sign do CONTRATO desta proposta, no formato do diário. `null` = nenhum envelope de
 * contrato da D4Sign vigente, quadro vazio, ou a leitura falhou.
 */
export async function quadroDaD4SignDaProposta(
  sb: SupabaseClient,
  propostaId: string,
): Promise<DiarioDaAssinatura | null> {
  if (!propostaId) return null;
  try {
    const { data, error } = await sb
      .from("temis_envelopes")
      .select(COLUNAS)
      .eq("provedor", "d4sign")
      // ⚠️ SÓ O ENVELOPE DE CONTRATO, a mesma porta do selo (`envelopesDasPropostas`): o espelho grava
      // também o que o C2X mandou com tipo não mapeado (`finalidade` nula), e ele não é o contrato.
      .eq("finalidade", "contrato")
      .eq("proposta_id", propostaId)
      .order("criado_em", { ascending: false })
      .limit(50);
    if (error) {
      console.error("[temis][quadro da D4Sign] falha ao ler os envelopes da proposta", {
        code: error.code ?? null,
      });
      return null;
    }
    return diarioDoQuadroDaD4Sign((data ?? []) as LinhaDaD4Sign[]);
  } catch (erro) {
    console.error("[temis][quadro da D4Sign] falha inesperada", erro instanceof Error ? erro.name : "erro");
    return null;
  }
}

/**
 * O DIÁRIO A PARTIR DAS LINHAS DA D4SIGN DA PROPOSTA. Puro (exportado para o teste).
 *
 * ⚠️ O ENVELOPE É O VIGENTE (`envelopeVigente`), a régua do Hércules e da trava do Faturado: o assinado
 * vence o vivo mais novo, e o rascunho que não saiu não vale.
 *
 * ⚠️ A CONTAGEM É A DO SELO DO CARD (`contagemDoSelo`): envelope assinado conta todos; senão, quem tem
 * `assinado_em` no quadro. O painel não pode dizer "3 de 7" ao lado de um selo "4/7".
 */
export function diarioDoQuadroDaD4Sign(linhas: readonly LinhaDaD4Sign[]): DiarioDaAssinatura | null {
  const vigente = envelopeVigente(linhas).vigente;
  if (!vigente) return null;

  const quadro = lerQuadro(vigente.signatarios);
  // "0 de 0" não é quadro, é ruído (a mesma regra do selo): sem pessoas, a tela diz que não há o que mostrar.
  if (quadro.length === 0) return null;

  const estado = vigente.estado || "desconhecido";
  const encerrado = ehTerminal(estado as EstadoDaAssinatura);
  const ordenada = vigente.ordenada === true;

  const pessoas: SignatarioDaProposta[] = quadro.map((item) => ({
    assinouEm: item.assinado_em ?? null,
    // ⚠️ A CHAVE `c2x:<ss.id>` IDENTIFICA A LINHA, e só ela: o e-mail repete na D4Sign.
    chave: item.chave,
    comecouEm: null,
    // A D4Sign não conta ao Panteon se o convite chegou: não há notícia, e a tela não inventa uma.
    convite: "sem_noticia",
    conviteDetalhe: null,
    conviteQuando: null,
    email: item.email,
    foiParaOFimEm: null,
    nome: item.nome,
    papel: item.testemunha === true ? "testemunha" : item.papel,
    // ⚠️ A RÉGUA DE PERFIL DE SEMPRE (`perfilDaPessoa`, a da aba Assinatura do Hércules): o perfil que o
    // espelho gravou, ou o e-mail da casa.
    perfil: perfilDaPessoa({ email: item.email, origem: "c2x", papel: item.papel, perfil: item.perfil ?? null }),
    posicao: null,
    // ⚠️ A CHAVE `c2x:` NÃO FALA COM A CLICKSIGN, e o motivo diz isso; a frase diz onde se faz.
    reenvioIndisponivel: { frase: ACOES_DA_D4SIGN_FICAM_NO_C2X, motivo: "sem_id_na_clicksign" },
    trocaVaiParaOFim: null,
  }));

  // ⚠️ A FILA É A MESMA DA CLICKSIGN (`naOrdemDaFila`), e o lugar de cada linha vem DELA MESMA (o índice
  // no quadro), nunca do e-mail. Sem a marca de ordem do C2X, todos no mesmo degrau: ordem alfabética.
  const naFila = naOrdemDaFila(
    pessoas,
    (_linha, indice) => ({ ordem: ordenada ? (quadro[indice]?.ordem ?? 0) : 0 }),
    { encerrado, semTroca: true },
  );
  // ⚠️ SEM A MARCA DE ORDEM, NENHUM NÚMERO DE DEGRAU: a tela junta todos num grupo só ("Quem assina").
  const signatarios = ordenada ? naFila : naFila.map((s) => ({ ...s, posicao: null }));

  const total = quadro.length;
  const marcadas = quadro.filter((item) => Boolean(item.assinado_em)).length;
  return {
    assinaram: estado === "assinado" ? total : Math.min(marcadas, total),
    // A D4Sign não manda evento ao Panteon: não há log a narrar.
    diario: [],
    envelope: {
      atualizadoEm: vigente.atualizado_em,
      conferidoEm: vigente.conferido_em,
      documentoId: vigente.documento_id,
      // ⚠️ NULO DE PROPÓSITO: é o id que a tela usa para oferecer os gestos da Clicksign.
      envelopeId: null,
      estado,
      estadoCru: vigente.estado_cru,
      id: vigente.id,
      provedor: "d4sign",
      provedorDocumentoId: vigente.provedor_documento_id,
      signatarios,
      venceEm: null,
    },
    total,
  };
}

/** Uma pessoa do quadro da D4Sign como o PORTAL a recebe: sem e-mail e sem a chave do C2X. */
type SignatarioNoPortal = Omit<SignatarioDaProposta, "chave" | "email"> & { chave: string; email: null };

/** O quadro da D4Sign como o PORTAL o recebe. */
export type DiarioDaD4SignNoPortal = Omit<DiarioDaAssinatura, "envelope"> & {
  envelope: Omit<DiarioDaAssinatura["envelope"], "signatarios"> & { signatarios: SignatarioNoPortal[] };
};

/**
 * O QUADRO DA D4SIGN CORTADO PARA O PORTAL — uma ALLOWLIST, campo a campo (plano da fonte única, seção 5).
 *
 * ⚠️ SEM E-MAIL, SEM A CHAVE `c2x:<ss.id>` E SEM O UUID DO DOCUMENTO DO C2X. O e-mail é dado interno
 * (o comentário da coluna na 0195: *"E-mail é dado interno: não vai a navegador nenhum"*); a chave é a
 * linha de `contract_signature_signers` do C2X; e o `provedor_documento_id` é o `uuidDoc` do C2X, que a
 * casa nunca deixa atravessar para o portal (`envelopeVivoParaOPortal`). A chave vira a posição da
 * pessoa na lista, que só serve de `key` na tela.
 */
export function quadroDaD4SignParaOPortal(diario: DiarioDaAssinatura): DiarioDaD4SignNoPortal {
  const { envelope } = diario;
  return {
    assinaram: diario.assinaram,
    diario: [],
    envelope: {
      atualizadoEm: envelope.atualizadoEm,
      conferidoEm: envelope.conferidoEm ?? null,
      documentoId: null,
      envelopeId: null,
      estado: envelope.estado,
      estadoCru: null,
      id: envelope.id,
      provedor: envelope.provedor,
      provedorDocumentoId: null,
      signatarios: envelope.signatarios.map((s, i) => ({
        assinouEm: s.assinouEm,
        chave: `pessoa-${i + 1}`,
        comecouEm: null,
        convite: s.convite,
        conviteDetalhe: null,
        conviteQuando: null,
        email: null,
        foiParaOFimEm: null,
        nome: s.nome,
        papel: s.papel,
        perfil: s.perfil ?? null,
        posicao: s.posicao,
        reenvioIndisponivel: s.reenvioIndisponivel,
        trocaVaiParaOFim: null,
      })),
      venceEm: null,
    },
    total: diario.total,
  };
}
