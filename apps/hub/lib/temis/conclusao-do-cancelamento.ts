import { ESTAGIOS_ENCERRADOS } from "./trabalhos";

// CONCLUIR UM CANCELAMENTO OU UM DISTRATO — a parte pura, que a tela e o servidor dividem.
//
// Lucas (18/09/2026): *"o time administrativo quando finaliza um cancelamento de contrato, a unidade
// nao esta voltando para disponibilidade"*.
//
// ⚠️ NÃO HAVIA BOTÃO DE CONCLUIR. O checklist saiu da tela em 09/09/2026 e só o card de contrato
// ganhou botões (Gerar contrato, Enviar para assinatura). O card de cancelamento em análise
// oferecia "Abrir o contrato preenchido" e "Indeferir", e o último item do checklist ("Liberar a
// unidade para venda") era só texto: nenhum código cancelava a venda nem devolvia o lote. A Nívea
// "finalizou" dois cancelamentos pelo único botão que havia, Indeferir, e para o sistema indeferir é
// RECUSAR o pedido: a venda ficou em contrato, a reserva viva e o lote preso.
//
// ⚠️ ESTE ARQUIVO NÃO IMPORTA NADA DO SERVIDOR, de propósito: a tela de trabalho é `"use client"` e
// lê daqui o rótulo do botão, o texto da confirmação e as duas declarações do distrato. O servidor
// lê as MESMAS declarações para recusar o pedido sem elas. Uma lista em cada lado divergiria no dia
// em que uma frase mudasse, e a tela pediria uma coisa enquanto o servidor exigiria outra.

/** Os dois tipos de card que desfazem uma venda e, por isso, se concluem por este botão. */
export const TIPOS_QUE_CONCLUEM = ["cancelamento", "distrato"] as const;

export type TipoQueConclui = (typeof TIPOS_QUE_CONCLUEM)[number];

export function ehTipoQueConclui(tipo: string): tipo is TipoQueConclui {
  return (TIPOS_QUE_CONCLUEM as readonly string[]).includes(tipo.trim());
}

/**
 * O botão aparece neste card?
 *
 * ⚠️ EM QUALQUER ESTÁGIO QUE AINDA ANDA, e não só na análise. O distrato passa por Contrato e Em
 * assinatura (o termo é gerado e assinado), e o card precisa poder ser concluído de onde estiver:
 * o que decide se a venda cai são os fatos que o servidor reapura no clique, não a coluna do card.
 * Faturado ("Concluído") já acabou; Indeferido é o pedido recusado.
 */
export function podeConcluir(tipo: string, estagio: string): boolean {
  return (
    ehTipoQueConclui(tipo) &&
    !(ESTAGIOS_ENCERRADOS as readonly string[]).includes(String(estagio ?? "").trim())
  );
}

/**
 * O card JÁ CONCLUÍDO ainda tem o que terminar? (a RETOMADA)
 *
 * ⚠️ O LOTE QUE NÃO VOLTOU NA HORA NÃO PODE FICAR PRESO PARA SEMPRE (revisão de 18/09/2026). A trava
 * pode segurar o lote no clique (outro dono, leitura que falhou), e o card fecha mesmo assim: sem a
 * retomada, quando o motivo se resolvesse não haveria botão nem rota para devolver o lote. Também é
 * a saída do card que chegou a Concluído por outro caminho (marcação de atividade) sem a venda cair.
 * Quem decide se há o que fazer é o servidor; a tela só oferece quando ele diz que a venda ainda
 * está viva ou que o lote ainda está ocupado.
 */
export function podeRetomar(
  tipo: string,
  estagio: string,
  situacao: { unidadeLivre: boolean; vendaDesfeita: boolean } | null,
): boolean {
  if (!ehTipoQueConclui(tipo) || String(estagio ?? "").trim() !== "faturado" || !situacao) return false;
  return !situacao.vendaDesfeita || !situacao.unidadeLivre;
}

/** O texto do botão (o `title` e o `aria-label` do ícone). */
export function rotuloDaConclusao(tipo: TipoQueConclui, retomada = false): string {
  if (retomada) return "Tentar liberar a unidade";
  return tipo === "distrato" ? "Concluir distrato" : "Concluir cancelamento";
}

/**
 * As duas declarações que o distrato exige de quem conclui.
 *
 * ⚠️ O SISTEMA NÃO TEM COMO SABER NENHUMA DAS DUAS. O termo de distrato ainda não é gerado nem
 * assinado pela Têmis, e o acerto dos valores com o cliente acontece fora do Panteon. Por isso quem
 * conclui DECLARA, com o nome dele: as duas vão para o motivo gravado na venda e para o histórico
 * do card. Sem elas, o distrato de uma venda paga cairia por um clique, e dinheiro do cliente não
 * some por clique.
 */
export const DECLARACOES_DO_DISTRATO = [
  { chave: "termoAssinado", rotulo: "Termo de distrato assinado" },
  { chave: "devolucaoAcertada", rotulo: "Devolução de valores acertada com o cliente" },
] as const;

export type ChaveDaDeclaracao = (typeof DECLARACOES_DO_DISTRATO)[number]["chave"];

export type DeclaracoesConferidas =
  | { erro: string; ok: false }
  /** O que foi declarado, em texto, para o motivo e para o histórico. Vazio no cancelamento. */
  | { declaradas: string[]; ok: true };

/**
 * O servidor confere as declarações antes de tocar em qualquer coisa.
 *
 * ⚠️ SÓ `true` VALE. Um `"sim"`, um `1` ou a chave ausente são "não declarou": a caixa marcada na
 * tela manda `true`, e qualquer outra coisa é cliente da API inventando o que ninguém marcou.
 */
export function conferirDeclaracoes(
  tipo: TipoQueConclui,
  corpo: unknown,
): DeclaracoesConferidas {
  if (tipo !== "distrato") return { declaradas: [], ok: true };

  const marcadas = (corpo && typeof corpo === "object" ? corpo : {}) as Record<string, unknown>;
  const faltando = DECLARACOES_DO_DISTRATO.filter((d) => marcadas[d.chave] !== true);
  if (faltando.length > 0) {
    return {
      erro: `Para concluir o distrato, confirme: ${faltando.map((d) => d.rotulo.toLowerCase()).join(" e ")}.`,
      ok: false,
    };
  }
  return { declaradas: DECLARACOES_DO_DISTRATO.map((d) => d.rotulo), ok: true };
}

/**
 * O que a confirmação diz, antes do clique. Exatamente o que o servidor vai fazer.
 *
 * ⚠️ "SE NÃO HOUVER OUTRO DONO" NÃO É RESSALVA DE ENFEITE. O lote só volta se a trava confirmar que
 * nenhuma outra reserva, proposta ou cupom do salão segura o terreno (Lucas: *"eu não posso vender
 * dois lotes para pessoas diferentes"*). Prometer a devolução sem a condição faria a tela mentir no
 * caso em que a trava segura o lote, que é justamente o caso que importa.
 *
 * ⚠️ O ENVELOPE QUE AINDA SE PODE ASSINAR É CANCELADO NOS DOIS TIPOS; o contrato assinado por todos
 * (o documento que o distrato desfaz) fica como está.
 */
export function avisoDaConclusao(args: {
  codigo: null | string;
  retomada?: boolean;
  tipo: TipoQueConclui;
}): string {
  const venda = args.codigo ? `A venda ${args.codigo}` : "A venda deste card";
  if (args.retomada) {
    return `${venda} já foi desfeita por este card. Aqui só se tenta de novo devolver a unidade: ela volta para a disponibilidade se não houver outro dono.`;
  }
  // ⚠️ O ENVELOPE NOS DOIS CASOS (revisão de 18/09/2026). O distrato pode nascer do PAGAMENTO com o
  // contrato ainda sem todas as assinaturas: deixar esse envelope vivo seria deixar alguém assinar o
  // contrato de um lote que já voltou para a venda. Só o contrato assinado por todos fica como está.
  const envelope =
    "Envelope do contrato ainda sem todas as assinaturas é cancelado na Clicksign; contrato já assinado por todos fica como está.";
  if (args.tipo === "distrato") {
    return `${venda} é distratada, a reserva cai e a unidade volta para a disponibilidade se não houver outro dono. ${envelope} Não se desfaz.`;
  }
  return `${venda} é cancelada, a reserva cai e a unidade volta para a disponibilidade se não houver outro dono. ${envelope} Não se desfaz.`;
}
