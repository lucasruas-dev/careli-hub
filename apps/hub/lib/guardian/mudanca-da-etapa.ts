// O QUE O MOTOR PODE REESCREVER NUM CLIENTE DA FILA — pura, sem React e sem banco.
//
// ⚠️ A PRÓXIMA AÇÃO TAMBÉM MUDA, E ELA SOZINHA NÃO MUDAVA. `applyClientStage`
// (AttendancePage.tsx) só reescrevia o workflow quando a ETAPA mudava, e nunca comparava a frase.
// Como a etapa base de todo cliente sem escolha manual JÁ é "A acionar" (`read-model.ts:460`) e a
// promessa vencida passou a derivar exatamente "A acionar", nada mudava: a fila e o copiloto
// seguiam mostrando a frase genérica do read-model ("Registrar retorno e confirmar canal
// prioritário") enquanto o card do detalhe, ao lado, já dizia "Promessa vencida em 18/09 sem baixa
// registrada". Duas frases para o mesmo cliente na mesma tela — o oposto do que a peça única veio
// fazer (Nívea, 24/09/2026: *"Erro no processo. O comprador fez promessa e não pagou."*).
//
// ⚠️ E A LINHA DE HISTÓRICO SÓ SAI QUANDO A ETAPA MUDA. Escrever "A acionar → A acionar" seria
// inventar uma transição que não houve e encher o histórico do cliente de ruído atribuído ao
// "Hades". A frase muda calada; a etapa é que é evento.
//
// ⚠️ E NADA DISSO PASSA POR CIMA DE ETAPA ESCOLHIDA À MÃO. A derivada é sugestão; a decisão é de
// quem atende (o chamado TI-000138). Com `stageManual`, o motor não mexe em nada.

export type EtapaAtualDoCliente = {
  nextAction: null | string;
  stage: null | string;
  stageManual?: boolean | null;
};

export type EtapaDerivada = {
  nextAction: string;
  stage: string;
};

export type MudancaDaEtapa = {
  /** Reescrever a etapa (e, com ela, carimbar o histórico). */
  escreveEtapa: boolean;
  /** Reescrever só a frase da próxima ação, sem carimbar histórico. */
  escreveProximaAcao: boolean;
};

const NADA: MudancaDaEtapa = { escreveEtapa: false, escreveProximaAcao: false };

export function mudancaDaEtapa(
  atual: EtapaAtualDoCliente,
  derivada: EtapaDerivada | null | undefined,
): MudancaDaEtapa {
  if (!derivada) return NADA;
  if (atual.stageManual) return NADA;

  const escreveEtapa = derivada.stage !== atual.stage;
  const escreveProximaAcao =
    !escreveEtapa && Boolean(derivada.nextAction) && derivada.nextAction !== atual.nextAction;

  return { escreveEtapa, escreveProximaAcao };
}
