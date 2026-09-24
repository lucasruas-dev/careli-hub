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
