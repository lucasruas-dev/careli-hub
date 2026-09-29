import { perfilDeTela } from "@/lib/apolo/painel-assinatura";
import type { SignatarioD4Sign } from "@/lib/guardian/d4sign-consulta";

import { emBrasilia } from "../instante";
import type { MarcaDeAssinatura } from "../marcas";
import { parearPessoas } from "../parear-pessoas";
import type { ItemDoQuadro } from "../registro-db";
import type { PessoaDoC2x } from "./c2x";

// O QUADRO DE UM ENVIO DO C2X E AS MARCAS DA D4SIGN SOBRE ELE — puro.
//
// ⚠️ A CHAVE É `c2x:<ss.id>` (a linha de `contract_signature_signers`), E ELA É A IDENTIDADE DA PESSOA NO
// QUADRO (0195, ATENCAO 3). A D4Sign não devolve nada que sirva de chave estável para o nosso quadro
// (`key_signer` é dela e não existe no C2X), e o e-mail repete: o mesmo corretor pode estar duas vezes.
// Por isso a marca sai daqui JÁ COM A CHAVE DO ITEM PAREADO: a função da 0195 casa pela chave, e o
// e-mail só serviria se fosse único.
//
// ⚠️ O PERFIL SAI DA RÉGUA DE SEMPRE (`perfilDeTela`, lib/apolo/painel-assinatura.ts): a exceção do
// Huber (2544 → Coordenadora de venda), `@careli.adm.br` → Backoffice, o papel no cadastro do
// empreendimento e "Cliente" → Comprador. Uma segunda régua aqui era o "Huber como Imobiliária" que o
// Lucas apontou duas vezes em 18/08.
//
// ⚠️ `papel` (vocabulário da casa) FICA NULO NA D4SIGN, DE PROPÓSITO. O C2X não diz cônjuge, vendedora
// nem testemunha; inventar a partir do perfil erraria o corretor que compra (perfil "Imobiliária"). O
// prazo de 7 dias da D4Sign conta do FECHAMENTO, não do papel (plano, seção 7), e a tela lê `perfil`.

/** O quadro do envio, na ordem do C2X (`after_position`, `ss.id`), com a chave `c2x:<ss.id>`. */
export function quadroDoEnvioDoC2x(pessoas: readonly PessoaDoC2x[]): ItemDoQuadro[] {
  return pessoas.map((pessoa) => {
    const email = String(pessoa.email ?? "").trim().toLowerCase();
    return {
      chave: `c2x:${pessoa.linhaId}`,
      email,
      nome: pessoa.nome,
      ordem: Number.isFinite(pessoa.posicao) ? pessoa.posicao : 0,
      papel: null,
      perfil: perfilDeTela(pessoa.perfilC2x, email, pessoa.papelNoEmpreendimento, pessoa.usuarioC2xId),
    };
  });
}

export type MarcasDaD4Sign = {
  /** Uma marca por pessoa PAREADA que assinou, com a chave do item e a data em `-03:00`. */
  marcas: MarcaDeAssinatura[];
  /** Pessoas da D4Sign sem par no quadro, mais itens do quadro sem par na D4Sign. */
  naoPareados: number;
  /** O rol mudou (contagem diferente ou alguém sem par): quem chama relê o rol no C2X. */
  rolDiferente: boolean;
};

/**
 * As marcas da D4Sign sobre o quadro, pareadas 1-para-1 (e-mail → nome sem acento → sobra única).
 *
 * ⚠️ AS CHAVES DE SAÍDA SÃO SÓ `chave`, `email`, `assinadoEm` E `recusadoEm`. O `/list` traz CPF, IP,
 * geolocalização e user-agent (`sign_info`); nada disso tem porta de saída aqui, e o objeto é montado
 * campo a campo (allowlist), não por espalhamento do que veio.
 *
 * ⚠️ QUEM NÃO ASSINOU NÃO GERA MARCA: a marca afirma assinatura, e "não assinou" é a ausência dela. A
 * D4Sign não tem recusa (tipos.ts), então `recusadoEm` sai sempre nulo.
 */
export function marcasDaD4Sign(
  quadro: readonly ItemDoQuadro[],
  signatarios: readonly SignatarioD4Sign[],
): MarcasDaD4Sign {
  const pareamento = parearPessoas(
    quadro.map((item) => ({ email: item.email, nome: item.nome })),
    signatarios.map((s) => ({ email: s.email, nome: s.nome })),
  );

  const marcas: MarcaDeAssinatura[] = [];
  for (const [indiceDoItem, indiceDaD4Sign] of pareamento.pares) {
    const item = quadro[indiceDoItem];
    const signatario = signatarios[indiceDaD4Sign];
    if (!item || !signatario || !signatario.assinou) continue;
    const assinadoEm = emBrasilia(signatario.assinadoEm);
    if (!assinadoEm) continue;
    marcas.push({
      assinadoEm,
      chave: item.chave,
      email: item.email ? item.email.toLowerCase() : null,
      recusadoEm: null,
    });
  }

  const naoPareados = pareamento.soNoA.length + pareamento.soNoB.length;
  return {
    marcas,
    naoPareados,
    rolDiferente: naoPareados > 0 || quadro.length !== signatarios.length,
  };
}

/**
 * O FECHAMENTO do documento: a última assinatura de todos, em `-03:00`. `null` sem nenhuma data.
 *
 * ⚠️ É A DATA REAL QUE A 0195 EXIGE (`p_fechado_em`, ATENCAO 5): a hora do cron nunca vira data de
 * assinatura. A D4Sign não devolve "fechado em"; o documento finalizado fecha com a última assinatura.
 */
export function fechamentoDaD4Sign(signatarios: readonly SignatarioD4Sign[]): null | string {
  let maior: null | { em: number; texto: string } = null;
  for (const s of signatarios) {
    if (!s.assinou) continue;
    const texto = emBrasilia(s.assinadoEm);
    if (!texto) continue;
    const em = Date.parse(texto);
    if (!maior || em > maior.em) maior = { em, texto };
  }
  return maior?.texto ?? null;
}

/**
 * O fechamento SÓ se TODO signatário que assinou trouxe a data; `null` se faltar uma.
 *
 * ⚠️ PARA A VENDA NATIVA (seção 6, passo 3): sem a data do último a assinar, o "máximo" sairia mais
 * cedo que o fechamento real e encurtaria o prazo de 7 dias, que é do cliente. Aí o assinado espera.
 */
export function fechamentoCompletoDaD4Sign(signatarios: readonly SignatarioD4Sign[]): null | string {
  if (signatarios.some((s) => s.assinou && !emBrasilia(s.assinadoEm))) return null;
  return fechamentoDaD4Sign(signatarios);
}
