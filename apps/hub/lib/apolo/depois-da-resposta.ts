import { after } from "next/server";

// O TRABALHO QUE NÃO PRECISA SEGURAR A RESPOSTA (revisão de 24/09/2026).
//
// ⚠️ POR QUE EXISTE. O aviso ao coordenador da habilitação pelo cadastro interno rodava DENTRO do
// salvamento do wizard: auditoria, contagem de corretores, cadastro do empreendimento, entidades e
// contatos do coordenador, às vezes o C2X, e por fim o POST ao Evolution, com teto de 30 segundos
// (lib/iris/evolution-api.ts). Com o gateway lento, o operador esperava até 30 s a mais para salvar uma
// imobiliária, e o resultado do aviso nem voltava para a tela. O aviso é best-effort: pode sair depois
// da resposta.
//
// ⚠️ VIA `after()`, NUNCA `void promessa`. Na Vercel a função é congelada assim que a resposta sai, e
// a promessa solta simplesmente não termina (ver lib/publico/cad/rotas.ts, o mesmo cuidado).
//
// ⚠️ FORA DE UMA REQUISIÇÃO (script, teste), o `after()` lança: aí a tarefa roda na hora, esperada. É
// o comportamento de antes, e é melhor do que perder o aviso.

/**
 * Agenda `tarefa` para depois da resposta. Nunca lança: erro da tarefa vai para o log com `rotulo`
 * (no formato "[area] o que falhou", que sai como "[apolo][area] o que falhou").
 */
export async function depoisDaResposta(tarefa: () => Promise<unknown>, rotulo: string): Promise<void> {
  const blindada = async () => {
    try {
      await tarefa();
    } catch (erro) {
      console.error(`[apolo]${rotulo}`, erro);
    }
  };

  try {
    after(blindada);
    return;
  } catch {
    // Sem contexto de requisição: roda agora.
  }
  await blindada();
}
