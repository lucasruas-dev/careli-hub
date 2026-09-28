// A LISTA QUE O ENVIO CONGELA EM `temis_envelopes.signatarios` — uma peça só, dos dois carimbos.
//
// ⚠️ O ID DO SIGNATÁRIO É O QUE A CLICKSIGN DEVOLVEU, NÃO O QUE O WEBHOOK CONTOU. Nívea,
// 24/09/2026: *"Deu erro no envio dos acordos. Não recebi e não consigo reenviar."* Medido em
// 24/09/2026: o envio de AC-000051 NÃO falhou (`temis_envelopes` com `falha` vazia, `estado`
// 'aguardando', `estado_cru` 'clicksign:signature_started', `enviado_em` 23/09 13:11:33Z = o 10:11
// do print). Quem devolvia 422 era o REENVIO, porque a tela mandava a `chave` do diário
// (`PropostasPanel.tsx:846-850`), e essa chave é a `key` do webhook ou, quando a pessoa só existe
// na lista congelada, o PRÓPRIO E-MAIL (`diario-do-envelope-db.ts:331`). O endpoint do reenvio é
// `POST /envelopes/{id}/signers/{signer_id}/notifications` (`clicksign/envelope.ts:771`): o único
// id que serve ali é o que a Clicksign criou no passo 3, e ele morria dentro de
// `enviarParaAssinatura` (`envelope.ts:311`, `idPorEmail`).
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
// ⚠️ E `tmp:` (e o `c2x:` da D4Sign) NÃO É ID DA CLICKSIGN. O reenvio de convite manda a `chave` para
// `POST /envelopes/{id}/signers/{signer_id}/notifications`; mandar `tmp:1` para lá é o 422 que a
// Nívea viu em 24/09/2026 com o e-mail. Quem lê a chave para falar com a Clicksign passa por
// `chaveDaClicksign`.

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

/** A chave serve para falar com a Clicksign? `null` para vazia, `tmp:` e `c2x:`. */
export function chaveDaClicksign(chave: unknown): null | string {
  if (typeof chave !== "string") return null;
  const limpa = chave.trim();
  if (!limpa || /^(tmp|c2x):/i.test(limpa)) return null;
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
