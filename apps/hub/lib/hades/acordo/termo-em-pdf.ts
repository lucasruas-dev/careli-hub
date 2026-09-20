import { loadHadesAttendanceClient } from "@/lib/guardian/attendance";
import type { GuardianCompromissoDetail } from "@/lib/guardian/compromissos";
import {
  hojeEmBrasilia,
  montarDadosDoTermoDeAcordo,
} from "@/lib/hades/dossie/termo-de-acordo-dados";
import {
  montarTermoDeAcordoPdf,
  nomeDoArquivoDoTermoDeAcordo,
} from "@/lib/hades/dossie/termo-de-acordo-pdf";

// O TERMO DE ACORDO EM PDF — a montagem, em um lugar só, para os DOIS caminhos.
//
// ⚠️ ELE NASCEU PORQUE AGORA SÃO DOIS. Até 19/09/2026 só a rota de download montava o papel
// (`app/api/guardian/termo-de-acordo/route.ts`); desde 20/09/2026 o envio para a Clicksign monta o
// MESMO papel (Lucas: *"vamos levar esse documento para ser assinado na click"*). Duas montagens
// divergiriam no primeiro ajuste — e a divergência seria o cliente assinando um PDF diferente do
// que o operador conferiu na tela.
//
// ⚠️ E O PDF É MONTADO NA HORA DO ENVIO, NÃO GUARDADO. No contrato é o contrário, e de propósito: lá
// o PDF foi gerado, conferido e guardado em `hercules_documentos` com número de versão, e
// `lib/assinatura/envio-db.ts` baixa ESSE arquivo justamente para o comprador não assinar um papel
// que ninguém viu. O termo de acordo não tem gaveta: não há linha de documento nem arquivo no
// bucket (medido em 20/09/2026: zero `storage.from` em `lib/hades/` e `lib/guardian/`), e a rota
// entrega os bytes direto como download.
//
// ⚠️ O QUE ISSO CUSTA, E POR QUE AINDA ASSIM ESTÁ CERTO: entre a conferência na tela e o clique de
// enviar, o débito no C2X pode mudar (uma parcela liquidada) e o dia em Brasília pode virar. A
// segunda montagem NÃO esconde isso — `montarDadosDoTermoDeAcordo` RECUSA quando o C2X não confirma
// mais o débito negociado, com a frase pronta, e o envio para antes de tocar a Clicksign. Ou seja,
// o risco vira uma recusa explicável, e não um envelope com o número errado dentro.

export type TermoEmPdf =
  | { bytes: Uint8Array; nome: string; ok: true }
  | { motivo: string; ok: false; status: number };

/**
 * O termo deste acordo, em PDF, ou a frase que diz por que ele não sai.
 *
 * ⚠️ `client_c2x_id` É O `users.id` DO C2X, e não o id da negociação — os dois espaços de id colidem
 * (o 2508 existe nas duas tabelas). O prefixo `c2x-client-` diz ao leitor qual é qual.
 *
 * ⚠️ A QUALIFICAÇÃO E AS PARCELAS VÊM DE `loadHadesAttendanceClient`, A MESMA LEITURA DA FICHA DO
 * HADES. Nome, CPF, nacionalidade, estado civil, profissão e endereço do termo são, letra por letra,
 * os que o operador vê na tela antes de clicar. ⚠️ O QUE ELA NÃO TEM É E-MAIL — e é por isso que os
 * SIGNATÁRIOS não saem daqui, e sim do Panteon (ver `signatarios-do-acordo.ts`).
 */
export async function montarTermoDoAcordoEmPdf(
  acordo: GuardianCompromissoDetail,
): Promise<TermoEmPdf> {
  const cliente = await loadHadesAttendanceClient(`c2x-client-${acordo.clientC2xId}`);
  if (!cliente) {
    return { motivo: "O cliente deste acordo não foi encontrado no C2X.", ok: false, status: 404 };
  }

  const montado = montarDadosDoTermoDeAcordo({
    acordo,
    cliente,
    emitidoEm: hojeEmBrasilia(),
  });
  if (!montado.ok) return { motivo: montado.motivo, ok: false, status: montado.status };

  return {
    bytes: await montarTermoDeAcordoPdf(montado.dados),
    nome: nomeDoArquivoDoTermoDeAcordo(montado.dados),
    ok: true,
  };
}
