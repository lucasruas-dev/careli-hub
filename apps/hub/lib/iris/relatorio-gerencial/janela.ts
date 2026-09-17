// A JANELA DO RELATÓRIO — o dia de trabalho, das 08h00 às 18h30.
//
// Lucas (17/09/2026), escolhendo entre apurar o dia inteiro, o dia anterior ou o expediente:
// *"dia de trabalho, 08:00 - 18:30"*. O relatório sai às 18h30 falando do dia que acabou de
// passar, e não do de ontem.
//
// ⚠️ O QUE ACONTECE FORA DA JANELA FICA DE FORA, e isso é decisão, não esquecimento: o rodapé diz
// a janela em letras, para ninguém comparar o número daqui com o do painel da Íris (que conta o
// dia inteiro) e achar que um dos dois está errado.
//
// ⚠️ A CONTA DO FUSO É PELO Intl, E NÃO POR "-3 FIXO". O Brasil não tem horário de verão hoje, mas
// já teve e pode voltar; com o deslocamento cravado, na volta o relatório apuraria das 09h às
// 19h30 sem ninguém perceber. O `Intl` responde o deslocamento REAL daquele instante naquele fuso.

export const FUSO_DA_CASA = "America/Sao_Paulo";

/** O expediente que o Lucas escolheu. */
export const HORA_DE_ABERTURA = 8;
export const HORA_DE_FECHAMENTO = 18;
export const MINUTO_DE_FECHAMENTO = 30;

export type JanelaDoRelatorio = {
  /** `2026-09-17`, o dia apurado no fuso da casa. */
  dia: string;
  /** Fim da janela (18h30 de São Paulo), em UTC. */
  fim: Date;
  /** Início da janela (08h00 de São Paulo), em UTC. */
  inicio: Date;
  /** "quinta-feira, 17 de setembro de 2026" — o título da capa. */
  rotuloDoDia: string;
};

/** Quantos minutos o fuso da casa está à frente do UTC NAQUELE instante (negativo no Brasil). */
function deslocamentoEmMinutos(instante: Date): number {
  const partes = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: FUSO_DA_CASA,
    year: "numeric",
  }).formatToParts(instante);

  const valor = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value ?? "0");
  // `hour12: false` devolve 24 à meia-noite em alguns runtimes; `% 24` normaliza.
  const comoSeFosseUtc = Date.UTC(
    valor("year"),
    valor("month") - 1,
    valor("day"),
    valor("hour") % 24,
    valor("minute"),
    valor("second"),
  );

  return (comoSeFosseUtc - instante.getTime()) / 60_000;
}

/** O instante UTC correspondente a uma hora do relógio de São Paulo. */
export function instanteNaCasa(dia: string, hora: number, minuto = 0): Date {
  const [ano, mes, diaDoMes] = dia.split("-").map(Number);
  const palpite = new Date(Date.UTC(ano ?? 0, (mes ?? 1) - 1, diaDoMes ?? 1, hora, minuto));
  return new Date(palpite.getTime() - deslocamentoEmMinutos(palpite) * 60_000);
}

/** `2026-09-17` a partir de um instante, já no fuso da casa. */
export function diaNaCasa(instante: Date): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: FUSO_DA_CASA,
    year: "numeric",
  }).format(instante);
  return partes;
}

/** "quinta-feira, 17 de setembro de 2026", com a primeira letra maiúscula. */
export function rotuloDoDia(dia: string): string {
  const meio = instanteNaCasa(dia, 12);
  const texto = new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    timeZone: FUSO_DA_CASA,
    weekday: "long",
    year: "numeric",
  }).format(meio);
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** `14:07` no fuso da casa. */
export function horaNaCasa(instante: Date | string): string {
  const data = typeof instante === "string" ? new Date(instante) : instante;
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: FUSO_DA_CASA,
  }).format(data);
}

/** `17/09/2026`. */
export function dataNaCasa(dia: string): string {
  const [ano, mes, diaDoMes] = dia.split("-");
  return `${diaDoMes}/${mes}/${ano}`;
}

/**
 * A janela do dia que está terminando.
 *
 * `agora` existe para o teste e para o disparo manual de um dia passado (`?dia=2026-09-17`).
 */
export function janelaDoDia(dia: string): JanelaDoRelatorio {
  return {
    dia,
    fim: instanteNaCasa(dia, HORA_DE_FECHAMENTO, MINUTO_DE_FECHAMENTO),
    inicio: instanteNaCasa(dia, HORA_DE_ABERTURA),
    rotuloDoDia: rotuloDoDia(dia),
  };
}

/** Sábado e domingo não têm relatório: o cron é `1-5`, e o disparo manual respeita o mesmo. */
export function ehDiaUtil(dia: string): boolean {
  const semana = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO_DA_CASA,
    weekday: "short",
  }).format(instanteNaCasa(dia, 12));
  return !["Sat", "Sun"].includes(semana);
}
