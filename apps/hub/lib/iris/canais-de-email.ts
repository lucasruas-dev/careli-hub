// O E-MAIL FORA DA IRIS.
//
// Lucas (18/09/2026): *"tira o canal e-mail da iris por favor, não precisa mais ter eles na iris,
// pode tirar a aba e não mostrar"* e *"pode cortar a conexão que registrávamos os e-mails no
// banco"*.
//
// ⚠️ O FILTRO É NA CONSULTA, E NÃO SÓ NA TELA. A carga da Iris traz os encerrados numa janela de
// 400 (iris-data-client.ts); ticket de e-mail escondido só na tela continuaria ocupando essas vagas
// e empurrando atendimento de WhatsApp para fora do histórico. Medido em 18/09/2026: 2.019 tickets
// de e-mail no banco (537 abertos), todos em canal `kind = email` — nenhum ticket está sem canal, e
// por isso excluir pelo canal é exato.
//
// Os tickets e as mensagens de e-mail CONTINUAM NO BANCO. Nada foi apagado: só deixaram de entrar
// na Iris, e a timeline do Apolo, que lê o banco direto, continua mostrando o histórico.

/** Os ids dos canais de e-mail, de uma lista de canais como a Iris carrega. */
export function idsDosCanaisDeEmail(
  canais: ReadonlyArray<{ id: string; kind?: null | string }> | null | undefined,
): string[] {
  return (canais ?? [])
    .filter((canal) => canal.kind === "email")
    .map((canal) => String(canal.id))
    .filter(Boolean);
}

/**
 * Tira da consulta de `caredesk_tickets` os tickets dos canais de e-mail.
 *
 * Sem canal de e-mail cadastrado a consulta segue intacta: `channel_id not in ()` é erro de sintaxe
 * no PostgREST, e derrubaria a Iris inteira por causa de um filtro que não tem o que filtrar.
 */
export function semOsCanaisDeEmail<Q extends { not: (...args: never[]) => unknown }>(
  consulta: Q,
  idsDeEmail: readonly string[],
): Q {
  if (idsDeEmail.length === 0) return consulta;
  // Chamado COMO MÉTODO: o construtor do Supabase depende do `this` da consulta.
  const comNot = consulta as unknown as {
    not: (coluna: string, operador: string, valor: string) => Q;
  };
  return comNot.not("channel_id", "in", `(${idsDeEmail.join(",")})`);
}
