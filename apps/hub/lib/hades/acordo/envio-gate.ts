import {
  type AcordoParaOGate,
  motivoParaNaoEmitirOTermo,
} from "@/lib/hades/dossie/termo-de-acordo-gate";

// QUANDO O TERMO DE ACORDO PODE IR PARA A ASSINATURA — e, quando não pode, A FRASE que diz por quê.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ A REGRA DO LUCAS (20/09/2026): *"o acordo so pode ficar disponivel para envio depois da
// aprovacao"*.
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ E ELA NÃO É UMA SEGUNDA RÉGUA: É A MESMA. `motivoParaNaoEmitirOTermo` já exige a aprovação
// para o PDF sair, com frase própria para reprovado, em elaboração e pendente
// (`MOTIVOS_DO_TERMO`). Escrever aqui uma segunda leitura de `approval_status` seria criar duas
// verdades sobre a mesma pergunta — e no dia em que uma das duas mudasse, o botão de enviar
// acenderia para um acordo que a rota do termo recusa (ou o contrário). O envio CHAMA o gate do
// termo e só acrescenta o que é específico dele.
//
// ⚠️ O QUE É ESPECÍFICO DO ENVIO, E POR QUE É POUCO. O termo que vai para a Clicksign é o MESMO PDF
// que o botão de baixar gera, montado na hora pelo mesmo `montarTermoDeAcordoPdf`: tudo que impede
// o PDF de existir impede o envio, pela mesma frase. O que sobra é a chave da tela (o botão de
// enviar nasce atrás da MESMA chave do termo, `TERMO_DE_ACORDO_LIBERADO`) e, do lado do servidor,
// duas perguntas que este arquivo não tem como responder porque dependem de leitura: quem assina
// (`signatarios-do-acordo.ts`) e se já existe envelope vivo deste acordo (`envio-db.ts`).
//
// ⚠️ ESTE ARQUIVO NÃO IMPORTA NADA EM TEMPO DE EXECUÇÃO, pelo mesmo motivo do gate do termo: ele vai
// para o navegador junto do `PropostasPanel`. Puxar daqui o `pdf-lib` ou o cliente do Supabase
// levaria os dois para o bundle da tela de atendimento só para decidir se um botão acende.
//
// ⚠️ E VALE IGUAL PARA O REENVIO. Lucas, na mesma mensagem: a régua vale *"tambem para reenvio"*.
// Não há caminho de reenvio que não passe por aqui — quem reenvia chama a mesma rota, e a rota
// chama esta função antes de qualquer coisa.

export type { AcordoParaOGate };

/** As frases do envio, escritas uma vez. O teste cobra cada uma pelo texto. */
export const MOTIVOS_DO_ENVIO = {
  /**
   * ⚠️ A FRASE DIZ QUE O ACORDO JÁ ESTÁ ASSINADO, E NÃO "não pode enviar". Um segundo envelope de um
   * termo já assinado produziria dois acordos assinados da mesma dívida, cada um com o seu
   * parcelamento — e os dois valeriam. É o mesmo cuidado de `envelopeQueSegura` no contrato.
   */
  jaAssinado:
    "Este acordo já foi assinado por todos. Mandar de novo criaria um segundo termo assinado da mesma dívida.",
} as const;

/**
 * `null` quando o termo pode ir para a assinatura; senão, a frase que a tela escreve ao lado do
 * botão apagado — e que a rota devolve no `error`.
 *
 * ⚠️ BOTÃO APAGADO SEM MENSAGEM É DEFEITO (o dono do produto cobrou duas vezes em 15/09/2026), e é
 * por isso que aqui também não sai `boolean`. Medido no Supabase de produção em 20/09/2026, dos 40
 * acordos vivos 18 estão aprovados e 22 reprovados: para 22 deles a frase que o operador lê é
 * "Este acordo foi reprovado pelo gestor, então não há termo a emitir."
 */
export function motivoParaNaoEnviarParaAssinatura(acordo: AcordoParaOGate): null | string {
  return motivoParaNaoEmitirOTermo(acordo);
}
