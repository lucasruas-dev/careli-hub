// CHEGOU EM "CREDENCIADO" NO BOARD → SOBE PARA O C2X NA HORA.
//
// Regra do Lucas, dita no dia do evento (01/08): "cliente chegou em credenciado já sobe para o
// C2X na hora". Antes o envio era um LOTE manual, disparado de tempos em tempos por alguém na
// tela Sync C2X — e o efeito colateral apareceu no dia: 39 dos 434 credenciados estavam fora do
// C2X sem ninguém saber, porque entraram depois do último lote.
//
// REUSA O LOTE (`processarLoteC2x` com `apenasEntityId`) em vez de repetir a regra. Assim a
// montagem do payload, a cascata cadastro+ficha, o diagnóstico de campos e as travas de
// identidade são exatamente as mesmas do envio em massa — e continuam sendo quando mudarem.
//
// BEST-EFFORT: nunca lança e nunca segura a mudança de etapa. C2X fora do ar, campo faltando ou
// divergência de identidade => a ficha muda de etapa do mesmo jeito e fica esperando o lote (ou
// gente), que é o certo: esses campos vão no contrato.
import { processarLoteC2x } from "./c2x-write-server";
import type { createApoloAdminClient } from "./server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export async function subirParaC2xAoCredenciar(
  client: AdminClient,
  entityId: string,
): Promise<{ detalhe: string; enviado: boolean }> {
  try {
    const r = await processarLoteC2x({
      apenasEntityId: entityId,
      client,
      dryRun: false,
      // Uma ficha por vez: o teto existe para o caso de a consulta trazer mais do que o esperado.
      maxEnvios: 1,
    });

    const item = r.itens[0];
    if (!item) return { detalhe: "já estava no C2X ou não é candidata", enviado: false };

    if (item.status === "enviada") return { detalhe: "criado no C2X", enviado: true };
    if (item.status === "duplicada") return { detalhe: "já existia no C2X", enviado: true };
    if (item.status === "faltando") {
      return { detalhe: `falta ${item.faltantes.join(", ")}`, enviado: false };
    }
    if (item.status === "conferir") {
      return { detalhe: `conferir: ${(item.divergencias ?? []).join(", ")}`, enviado: false };
    }
    if (item.status === "sem_confirmacao") {
      return { detalhe: "a API aceitou mas não achei no C2X", enviado: false };
    }
    return { detalhe: item.erro ?? "recusado pelo C2X", enviado: false };
  } catch (erro) {
    return { detalhe: erro instanceof Error ? erro.message : String(erro), enviado: false };
  }
}
