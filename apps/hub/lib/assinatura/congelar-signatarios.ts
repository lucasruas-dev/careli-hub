// A LISTA QUE O ENVIO CONGELA EM `temis_envelopes.signatarios` — uma peça só, dos dois carimbos.
//
// ⚠️ CORREÇÃO DE 01/10/2026: A `signer.key` DO WEBHOOK É O MESMO ID QUE A CLICKSIGN DEVOLVE NO
// ENVIO. Este comentário dizia o contrário ("o id é o que a Clicksign devolveu, NÃO o que o webhook
// contou"), e a afirmação era dedução, não medição. Medido em produção em 01/10/2026 (só SELECT,
// projeto bxgukywoxgivlrhjkwjx), cruzando a `chave` congelada com
// `temis_assinatura_eventos.payload->document->signers[].key` por envelope e e-mail:
//
//   pares: 54 | identicas: 54 | diferentes: 0 | envelopes: 8
//
// ⚠️ ENTÃO O 422 DE 24/09/2026 ERA DO OUTRO CASO, E É ESSE QUE SOBRA. Nívea, 24/09/2026: *"Deu erro
// no envio dos acordos. Não recebi e não consigo reenviar."* O envio de AC-000051 NÃO falhou
// (`temis_envelopes` com `falha` vazia, `estado` 'aguardando', `estado_cru`
// 'clicksign:signature_started', `enviado_em` 23/09 13:11:33Z = o 10:11 do print). Quem devolvia 422
// era o REENVIO, porque a tela mandava a `chave` do diário — e essa chave é a `signer.key` do webhook
// (que SERVE) ou, quando a pessoa só existe na lista congelada, o PRÓPRIO E-MAIL
// (`diario-do-envelope-db.ts`), que não serve. `POST /envelopes/{id}/signers/{signer_id}/notifications`
// devolve 422 para e-mail, e é só isso que ele recusava.
//
// ⚠️ O CAMPO SE CHAMA `chave`, E NÃO É NOME NOVO. Ele já existe no mesmo jsonb desde a troca de
// e-mail ("o id na Clicksign, quando já sabemos"), com leitor pronto em
// `lib/temis/trocar-signatario.ts`. Um `signerId` ao lado seria um segundo nome para a mesma coisa,
// e o leitor antigo não o enxergaria.

/** Uma pessoa como o envio a conhece, no recorte que é congelado. */
export type PessoaDoEnvio = {
  email: string;
  nome: string;
  ordem: number;
  papel: string;
};

/** Uma linha de `temis_envelopes.signatarios`. `chave` só existe quando a Clicksign já respondeu. */
export type SignatarioCongeladoNoEnvio = {
  chave?: string;
  email: string;
  nome: string;
  ordem: number;
  papel: string;
};

/**
 * A lista para gravar no jsonb, com o id da Clicksign quando ele veio.
 *
 * `idPorEmail` é o que `enviarParaAssinatura` devolve em `signatarios` — as chaves já vêm em
 * minúsculas e sem espaço, e a busca aqui normaliza do mesmo jeito.
 *
 * ⚠️ SEM O MAPA, A LISTA SAI EXATAMENTE COMO SAÍA, e a `chave` simplesmente não nasce. Inventar um
 * valor ali seria pior do que não ter: o reenvio mandaria à Clicksign um id que não é dela.
 */
export function congelarSignatarios(
  pessoas: readonly PessoaDoEnvio[],
  idPorEmail: Record<string, string> | undefined,
): SignatarioCongeladoNoEnvio[] {
  return pessoas.map((pessoa) => {
    const chave = idPorEmail?.[pessoa.email.trim().toLowerCase()]?.trim();

    return {
      ...(chave ? { chave } : {}),
      email: pessoa.email,
      nome: pessoa.nome,
      ordem: pessoa.ordem,
      papel: pessoa.papel,
    };
  });
}

// ── A CHAVE OBRIGATÓRIA DA 0195 ─────────────────────────────────────────────
//
// ⚠️ DESDE A F1 DA FONTE ÚNICA (28/09/2026) TODO ITEM DO QUADRO TEM `chave`, e ela é a identidade
// com que a função `temis_envelope_registrar_assinaturas` casa as marcas de quem assinou. Enquanto a
// Clicksign não devolveu o id da pessoa (a linha nasce ANTES do envio, e o id pode nem vir), a chave
// é `tmp:<posição>`: a posição é a do mesmo `preparo.signatarios` que o registro e o carimbo usam,
// então o carimbo casa o `tmp:2` do registro com a pessoa 2 do envio.
//
// ⚠️ E `tmp:`, O `c2x:` DA D4SIGN E O PRÓPRIO E-MAIL NÃO SÃO ID DA CLICKSIGN. O reenvio de convite
// manda a `chave` para `POST /envelopes/{id}/signers/{signer_id}/notifications`, e a troca de e-mail
// manda para `DELETE /envelopes/{id}/signers/{signer_id}`: mandar `tmp:1` ou um e-mail para lá é o
// 422 que a Nívea viu em 24/09/2026 (e, no DELETE, o 404 que SEGUE EM FRENTE e deixa o signatário
// antigo no envelope com um duplicado nascendo ao lado). Quem lê a chave para falar com a Clicksign
// passa por `chaveDaClicksign`.

/** Uma pessoa do quadro com a chave obrigatória da 0195. */
export type ItemComChave = {
  chave: string;
  email: string;
  nome: string;
  ordem: number;
  papel: string;
};

/** A chave provisória de quem ainda não tem id no provedor. */
export function chaveProvisoria(posicao: number): string {
  return `tmp:${posicao}`;
}

/**
 * A chave serve para falar com a Clicksign? `null` para vazia, `tmp:`, `c2x:` e E-MAIL.
 *
 * ⚠️ O E-MAIL ENTROU NA LISTA EM 01/10/2026, E ELE É A CAUSA DO 422. Quem só existe na lista
 * congelada do envio não tem `signer.key` nenhuma, e `juntarComOsCongelados` põe o PRÓPRIO E-MAIL na
 * `chave` da tela (`diario-do-envelope-db.ts`) para a linha ter identidade; daí ele seguia cru para
 * `POST .../signers/{signer_id}/notifications` (422) e para `DELETE .../signers/{signer_id}` (404,
 * que a troca de e-mail SEGUE EM FRENTE de propósito, deixando o signatário antigo no envelope e um
 * duplicado nascendo).
 *
 * ⚠️ E O "@" NÃO TIRA NENHUM ID DE VERDADE DAQUI. Medido em produção em 01/10/2026 (só SELECT,
 * projeto bxgukywoxgivlrhjkwjx): das 55 chaves congeladas nos 29 envelopes da Clicksign e das 160
 * `signer.key` que os payloads de webhook trazem, 55 e 160 têm forma de uuid — ZERO com "@", ZERO
 * com `tmp:` ou `c2x:`.
 */
export function chaveDaClicksign(chave: unknown): null | string {
  if (typeof chave !== "string") return null;
  const limpa = chave.trim();
  if (!limpa || /^(tmp|c2x):/i.test(limpa) || limpa.includes("@")) return null;
  return limpa;
}

/**
 * O quadro do envio, com a chave de cada pessoa: o id da Clicksign quando veio, senão `tmp:<posição>`.
 *
 * ⚠️ SEM O MAPA (o registro que nasce antes do envio), TODO MUNDO SAI COM `tmp:`. É o que
 * `abrirRegistro` grava; o carimbo manda o mesmo quadro com os ids e a função troca a chave de cada
 * um pela posição (o e-mail é único no quadro: a CAD trava e-mail repetido).
 */
export function quadroDoEnvio(
  pessoas: readonly PessoaDoEnvio[],
  idPorEmail?: Record<string, string>,
): ItemComChave[] {
  return congelarSignatarios(pessoas, idPorEmail).map((pessoa, indice) => ({
    chave: pessoa.chave ?? chaveProvisoria(indice + 1),
    email: pessoa.email,
    nome: pessoa.nome,
    ordem: pessoa.ordem,
    papel: pessoa.papel,
  }));
}
