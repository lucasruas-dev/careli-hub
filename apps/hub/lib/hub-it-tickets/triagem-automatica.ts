// A TRIAGEM QUE DISPARA SOZINHA, no instante em que o chamado nasce.
//
// Lucas (11/09/2026): *"não estou dando conta de pensar e desenvolver os novos modulos, melhorias e
// atender a demanda interna nossa (...) estou recebendo muitas criticas"*.
//
// ⚠️ A TRIAGEM JÁ EXISTIA E NÃO TINHA GATILHO. `runHubItTicketTriage` lê o chamado, procura
// duplicata entre os anteriores, confere as versões recentes do changelog e propõe classificação e
// devolutiva — mas só rodava quando alguém clicava no botão dentro do board do Zeus. Ou seja: o
// diagnóstico só existia para quem já tinha ido olhar o chamado, que é justamente o que não estava
// acontecendo. Medido em 11/09/2026: 30 chamados parados em "novo", 27,9 dias de idade média, o
// mais antigo há 66 dias, TODOS sem dono.
//
// ⚠️ ELA ESCREVE NOTA INTERNA, E NÃO RESPONDE O USUÁRIO. Esta é a linha que separa este passo do
// próximo: aqui o agente prepara o terreno para quem for atender — suspeita de causa, duplicata,
// versão em que aquilo mudou. Responder direto ao solicitante exige uma porta de escrita própria,
// porque hoje toda resposta administrativa carimba o responsável e move o status: um agente falando
// por essa porta viraria dono de tudo a cada frase e destruiria as métricas de fila.
//
// ⚠️ E ELA NUNCA FECHA CHAMADO. A regra é da casa e é inegociável: 107 dos 116 chamados fechados
// foram encerrados por uma rotina automática de 3 dias, com ator nulo. Abandono contado como
// "Finalizado" já distorce o placar; um segundo robô por cima disso apagaria o pouco que resta de
// sinal.

import { registrarTriagemAutomatica } from "@/lib/hub-it-tickets/server";
import { runHubItTicketTriage } from "@/lib/hub-it-tickets/triage";

/**
 * A identidade do agente de triagem.
 *
 * ⚠️ ELE PRECISA VER OS OUTROS CHAMADOS, e é por isso que tem perfil de adm: sem enxergar a fila
 * inteira não há como dizer "isto é duplicata do TI-000059". O que torna isso aceitável é o que ele
 * FAZ com essa visão — grava nota interna para os adms, e nota interna não chega ao solicitante
 * (ver o filtro em `hydrateTicketRows`). Se um dia o resultado da triagem passar a ser respondido
 * direto ao usuário, esta identidade tem que ser revista junto, no mesmo commit.
 *
 * ⚠️ NÃO É UMA PESSOA, e o nome diz isso na tela. O evento que ele grava aparece com este autor no
 * histórico do chamado; ver ali o nome de um colega que não fez nada seria pior do que não ter
 * autor nenhum.
 */
const AGENTE_DA_TRIAGEM = {
  email: "zeus@panteon.interno",
  id: "00000000-0000-0000-0000-000000000000",
  name: "Zeus · triagem automática",
  operationalProfile: "adm",
  role: "admin",
} as const;

/**
 * Roda a triagem de um chamado recém-criado e registra o que ela achou.
 *
 * ⚠️ NUNCA LANÇA. É chamada depois que a resposta já foi para o usuário (`after()`), então um erro
 * aqui não tem para quem aparecer — e derrubar a rota por causa de uma análise que é acessória
 * seria trocar o chamado gravado por um erro na tela de quem abriu.
 *
 * ⚠️ E NÃO TEM RETRY. Falhou, o chamado continua lá com o botão de triagem do board funcionando
 * como sempre. Repetir automaticamente uma chamada de modelo é o caminho conhecido para a fatura
 * alta — o precedente da casa é o polling do Hermes.
 */
export async function triarChamadoNovo(protocolo: string): Promise<void> {
  try {
    const resultado = await runHubItTicketTriage({
      protocol: protocolo,
      user: AGENTE_DA_TRIAGEM,
    });

    // ⚠️ A TRIAGEM SÓ VALE SE FICA ESCRITA ONDE ALGUÉM VAI OLHAR. A primeira versão desta função
    // chamava o modelo e mandava o resultado para o console do servidor: gastava a chamada e não
    // deixava nada no chamado. O diagnóstico precisa chegar antes de quem vai atender.
    await registrarTriagemAutomatica(protocolo, resultado);

    console.info(
      `[helpdesk][triagem] ${protocolo}: ${resultado.autonomy} · ${resultado.confidence}${
        resultado.duplicateProtocol ? ` · duplicata de ${resultado.duplicateProtocol}` : ""
      }`,
    );
  } catch (erro) {
    // O motivo vai para o log do servidor: uma triagem que falha calada é indistinguível de uma
    // que não rodou, e as duas pedem coisas diferentes de quem for investigar.
    console.error(
      `[helpdesk][triagem] falha em ${protocolo}`,
      erro instanceof Error ? erro.message : erro,
    );
  }
}
