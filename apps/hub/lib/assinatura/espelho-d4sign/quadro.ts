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
// ⚠️ `papel` (vocabulário da casa) FICA NULO NA D4SIGN, DE PROPÓSITO. O C2X não diz cônjuge nem
// vendedora; inventar a partir do perfil erraria o corretor que compra (perfil "Imobiliária"). O prazo
// de 7 dias da D4Sign conta do FECHAMENTO, não do papel (plano, seção 7), e a tela lê `perfil`.
//
// ⚠️ A TESTEMUNHA O C2X DIZ, SIM, E ESTE COMENTÁRIO DIZIA O CONTRÁRIO ATÉ 02/10/2026. Cada linha do envio
// tem `contract_signature_type_id`, e o 3 é "Assinar como testemunha" (medido no C2X, só SELECT: 10
// testemunhas nos 5 contratos vivos da D4Sign na Têmis). Lucas, no mesmo dia: testemunha *"Entra
// agora"*. Ela vai num CAMPO PRÓPRIO, `testemunha: boolean`, e não em `papel: "testemunha"`, por duas
// razões medidas nos leitores do quadro:
//   1. `papel` escrito MUDA A RÉGUA DO COMPRADOR (`ehCompradorNoQuadro`: papel não vazio manda, e o
//      perfil é ignorado), e é ela que move o card para o Pré-faturamento e conta o selo. O campo próprio
//      não é lido por ela, nem por `contagemDoSelo`, `perfilDaPessoa`/`pessoasDoQuadro` (Hércules),
//      `signatariosDoEnvelope` (incorporador) ou a 0195: nenhum leitor de hoje muda uma vírgula.
//   2. O quadro gravado ANTES da marca precisa ser reconhecido, para ganhar a marca uma vez. Com `papel`,
//      "não é testemunha" e "gravado antes" seriam o mesmo nulo (a 0195 apaga o nulo, `jsonb_strip_nulls`);
//      com o booleano sempre escrito (`true` ou `false`), a ausência só pode ser o quadro antigo.
// Quem mostra "Testemunha" é o painel da Têmis (`quadro-da-d4sign-db.ts`), que traduz o campo no papel
// da tela.

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
      // ⚠️ SEMPRE ESCRITO, `false` INCLUSIVE: a ausência é o sinal do quadro anterior à marca.
      testemunha: pessoa.testemunha === true,
    };
  });
}

/**
 * O quadro foi gravado ANTES da marca de testemunha? (algum item sem o campo booleano). Puro.
 *
 * ⚠️ É O QUE FAZ O ESPELHO RELER O ROL UMA VEZ, e só uma: o quadro regravado com a marca passa a ter o
 * campo em todo item, e esta pergunta vira `false` para sempre. Quadro vazio não tem o que marcar.
 */
export function quadroSemAMarca(quadro: readonly Pick<ItemDoQuadro, "testemunha">[]): boolean {
  return quadro.some((item) => typeof item.testemunha !== "boolean");
}

/**
 * O RETRATO DO ROL: quem está no quadro (a chave) e se é testemunha. Puro.
 *
 * ⚠️ É A COMPARAÇÃO "A LISTA DE PESSOAS MUDOU" do espelho, e a marca entra nela (02/10/2026). Antes era só
 * a chave: o quadro antigo, sem a marca, e o relido, com ela, saíam iguais e nunca seriam regravados. O
 * item sem o campo sai com `?`, diferente de `t` e de `-`, e por isso o quadro antigo é regravado UMA vez
 * pela função da 0195 (que preserva `assinado_em` pela chave); depois disso o retrato bate e nada se
 * regrava a cada rodada.
 */
export function retratoDoRol(quadro: readonly Pick<ItemDoQuadro, "chave" | "testemunha">[]): string {
  return quadro
    .map((item) => `${item.chave}#${typeof item.testemunha !== "boolean" ? "?" : item.testemunha ? "t" : "-"}`)
    .join("|");
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
