// O CONTRATO DO BOTÃO "SUBIR PARA O C2X" DO CARD — em um lugar só.
//
// Pedido do Lucas (08/08): "temos que colocar um botão dentro dos cards para subir novamente o
// cadastro para o C2X, estamos corrigindo mas não está subindo".
//
// O buraco que ele descreve é real e mensurável: das 43 CADs que o C2X recusou, 23 JÁ FORAM
// CORRIGIDAS (têm escolaridade hoje) e continuam fora do C2X — porque, depois de corrigir a ficha,
// NÃO EXISTIA como reenviar. O operador arrumava o dado e ele ficava parado. Este botão fecha isso.
//
// Este arquivo é PURO de propósito (sem Supabase, sem MySQL, sem env): a rota do servidor e o
// componente do Board falam a MESMA linguagem sem que o bundle do cliente arraste o servidor junto.

// Os mesmos estados do item do lote (`ItemLote["status"]`), mais um que só existe no envio por
// card: `ausente` = a ficha NÃO ENTRA na fila de candidatas (já sincronizada, sem cadastro, papel
// que não sobe...). O lote simplesmente a ignora; um botão apertado por uma pessoa precisa dizer
// POR QUE não fez nada, senão parece que o clique se perdeu.
// `ja_no_c2x` = a pessoa JÁ ESTAVA no C2X antes de qualquer envio nosso, e o clique não criou
// nada: só reconciliou o id na nossa fila. É um TERCEIRO desfecho, nem sucesso nem erro — e
// precisa ser lido assim na tela, porque hoje ele chega disfarçado de falha: a API responde
// "E-mail de acesso já cadastrado" (a API dizendo "essa pessoa já existe") e nós exibimos como
// erro de cadastro. Foram 7 das 10 falhas do envio em massa de 08/08.
export type StatusSubidaC2x =
  | "pronta"
  | "faltando"
  | "conferir"
  | "enviada"
  | "duplicada"
  | "erro"
  | "sem_confirmacao"
  | "ja_no_c2x"
  | "ausente";

export type ResultadoSubidaC2x = {
  // Campos em que a importação e a ficha discordam sobre QUEM é a pessoa (status "conferir").
  divergencias?: string[];
  // ⚠️ true = NADA foi enviado ao C2X; foi só a simulação (o `dryRun` do lote). A tela é obrigada a
  // dizer isso ao operador — "subiu" e "subiria" não podem se parecer.
  ensaio: boolean;
  entityId: string;
  // O motivo REAL: a mensagem do C2X quando ele recusa, ou a explicação de por que a ficha não
  // entra na fila. Nunca um "falha ao enviar" genérico.
  erro?: string;
  // Campos obrigatórios que faltam (status "faltando"). É a resposta ao pedido de avisar ANTES de
  // bater na API: hoje 153 das 211 CADs fora do C2X estão neste caso.
  faltantes: string[];
  // Para QUAL C2X isto foi (ou iria). Aparece na tela porque o incidente de 01/08 — 8 cadastros
  // criados no ambiente de teste sem ninguém perceber — só foi possível porque o destino era
  // invisível. Produção é `sistema.careli.adm.br`.
  hostDestino: string;
  status: StatusSubidaC2x;
};

// O HOST DE PRODUÇÃO DO C2X — a única resposta certa para "para onde isto foi".
//
// Está escrito aqui, e não importado de `c2x-integracao.ts` (que tem a mesma constante na lista de
// hosts permitidos), porque este arquivo é o único deste assunto que o bundle do CLIENTE carrega:
// puxar o outro arrastaria a camada de transporte inteira para dentro do Board.
//
// ⚠️ Mostrar o destino não basta — foi o que faltou aqui. Em 28/jul e 01/08 a env
// `C2X_WRITE_API_URL` apontava para `teste.careli.adm.br` e 8 cadastros "subiram com sucesso" para
// o lugar errado; ninguém percebeu por 4 dias. Um texto verde dizendo "subiria para
// teste.careli.adm.br" repete o incidente: o operador não sabe de cor qual é o host certo. Quem
// tem que saber é o código.
export const HOST_C2X_PRODUCAO = "sistema.careli.adm.br";

// `hostDestino` vem de `new URL(C2X_WRITE_API_URL).host`, então já traz a porta quando existe — e
// é isso que se quer: `sistema.careli.adm.br:8080` NÃO é produção e não pode passar por igual.
export function destinoEhProducao(hostDestino: string): boolean {
  return hostDestino.trim().toLowerCase() === HOST_C2X_PRODUCAO;
}

// A CAD NÃO está confirmada no C2X. É EXATAMENTE o critério do selo (lib/apolo/c2x-alerta-board.ts
// decide o valor; aqui só se lê), porque botão e selo têm que aparecer e sumir juntos: um card com
// selo de alerta e sem botão é um beco sem saída, e um botão sem alerta é ruído.
export function foraDoC2x(falha?: string | null): boolean {
  return falha === "erro" || falha === "nunca_enviado" || falha === "sem_confirmacao";
}

// O rótulo muda com o motivo porque as duas situações são diferentes para quem opera:
// "nunca_enviado" é uma ficha que nunca foi tentada; "erro"/"sem_confirmacao" é uma segunda
// chance depois de corrigir o que o C2X reclamou.
export function rotuloBotaoC2x(falha?: string | null): string {
  return falha === "nunca_enviado" ? "Subir para o C2X" : "Tentar de novo";
}
