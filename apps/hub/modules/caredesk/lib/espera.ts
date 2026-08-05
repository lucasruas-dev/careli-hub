// QUANTO TEMPO O CLIENTE ESTA' ESPERANDO — substitui o "Vencido" binario do SLA.
//
// O PROBLEMA (auditoria de 26/07): 96 dos 98 atendimentos abertos apareciam com a etiqueta
// vermelha "Vencido", INCLUSIVE 19 de 19 que estavam aguardando resposta DO CLIENTE. Um alerta
// que vale pra 98% dos cards nao separa mais nada: a operadora abre a tela, ve tudo vermelho e
// escolhe pela ordem que apareceu, que e' o mesmo que escolher no acaso.
//
// Tres correcoes, na linha do que o Chatwoot faz (chip de duas cores, nunca o card inteiro):
//   1. O relogio SO' corre quando a bola e' NOSSA. Cliente que ja' foi respondido e nao voltou
//      nao esta' esperando nada.
//   2. O relogio PAUSA fora do horario comercial. Sem isso, segunda de manha tudo esta' vermelho
//      por causa do fim de semana — que e' parte do estado de hoje.
//   3. Tempo CONTINUO ("esperando 2h14") no lugar de vencido/nao vencido. Informacao continua
//      deixa a operadora comparar dois atendimentos; binaria, nao.
//
// Horario comercial: segunda a sexta, 8h as 18h (o mesmo de lib/iris/caca/agent.ts).

export type FaixaDeEspera = "sem_espera" | "normal" | "atencao" | "atrasado";

export type Espera = {
  faixa: FaixaDeEspera;
  // Minutos UTEIS (fora do expediente nao conta) — e' o que decide a COR.
  minutos: number;
  // Minutos CORRIDOS de relogio de parede — e' o que aparece no TEXTO.
  minutosCorridos: number;
  // Texto pronto: "esperando 2h14", "esperando 38min", "" quando a bola e' do cliente.
  rotulo: string;
};

// Limiares deliberadamente FOLGADOS no comeco. A 1a resposta media hoje e' 3h37m: comecar em
// 30min pintaria quase tudo de novo e recriaria o problema que estamos consertando. A ideia e'
// apertar quinzenalmente conforme a operacao melhora.
const ATENCAO_MIN = 120; // 2h
const ATRASADO_MIN = 480; // 8h

const EXPEDIENTE_INICIO = 8;
const EXPEDIENTE_FIM = 18;

function dentroDoExpediente(data: Date): boolean {
  const dia = data.getDay(); // 0 = domingo, 6 = sabado
  if (dia === 0 || dia === 6) {
    return false;
  }

  const hora = data.getHours();

  return hora >= EXPEDIENTE_INICIO && hora < EXPEDIENTE_FIM;
}

// Minutos de expediente entre dois instantes. Varre de hora em hora: e' barato o bastante pro
// volume da tela (algumas centenas de tickets) e evita a matematica de calendario, que erra
// justamente nas bordas (virada de dia, fim de semana, semana inteira parada).
export function minutosUteisEntre(inicio: Date, fim: Date): number {
  if (fim <= inicio) {
    return 0;
  }

  // Trava de sanidade: acima de 30 dias nao vale a pena varrer, e a resposta ja' e' "muito".
  const MAX_HORAS = 24 * 30;
  let minutos = 0;
  let cursor = new Date(inicio.getTime());
  let voltas = 0;

  while (cursor < fim && voltas < MAX_HORAS) {
    const proxima = new Date(cursor.getTime() + 3_600_000);
    const ate = proxima < fim ? proxima : fim;

    if (dentroDoExpediente(cursor)) {
      minutos += (ate.getTime() - cursor.getTime()) / 60_000;
    }

    cursor = proxima;
    voltas += 1;
  }

  return Math.round(minutos);
}

export function formatarEspera(minutos: number): string {
  if (minutos < 1) {
    return "agora";
  }

  if (minutos < 60) {
    return `${minutos}min`;
  }

  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;

  if (horas < 24) {
    return resto > 0 ? `${horas}h${String(resto).padStart(2, "0")}` : `${horas}h`;
  }

  const dias = Math.floor(horas / 24);

  return `${dias}d${horas % 24}h`;
}

// `bolaConosco` = o cliente falou por ultimo (ou o ticket nasceu e ninguem tocou). Quem decide
// isso e' quem chama, porque a origem varia (ultima mensagem, status, ticket sem resposta).
export function calcularEspera({
  agora = new Date(),
  bolaConosco,
  desde,
}: {
  agora?: Date;
  bolaConosco: boolean;
  desde: string | null | undefined;
}): Espera {
  if (!bolaConosco || !desde) {
    return { faixa: "sem_espera", minutos: 0, minutosCorridos: 0, rotulo: "" };
  }

  const inicio = new Date(desde);

  if (Number.isNaN(inicio.getTime())) {
    return { faixa: "sem_espera", minutos: 0, minutosCorridos: 0, rotulo: "" };
  }

  // DOIS relogios, de proposito:
  //  - UTEIS decide a COR (nao acusa ninguem por causa de madrugada e fim de semana);
  //  - CORRIDOS aparece no TEXTO (o operador precisa VER o tempo passando).
  // Sem essa separacao, uma mensagem que chegou as 21h mostrava "esperando agora" a noite
  // inteira e o cronometro parecia quebrado — foi o que aconteceu no teste do Lucas as 23h.
  const minutos = minutosUteisEntre(inicio, agora);
  const minutosCorridos = Math.max(
    0,
    Math.round((agora.getTime() - inicio.getTime()) / 60_000),
  );
  const faixa: FaixaDeEspera =
    minutos >= ATRASADO_MIN
      ? "atrasado"
      : minutos >= ATENCAO_MIN
        ? "atencao"
        : "normal";

  return {
    faixa,
    minutos,
    minutosCorridos,
    rotulo: `esperando ${formatarEspera(minutosCorridos)}`,
  };
}

// Classes do chip. Duas cores apenas (padrao Chatwoot): ambar pra "esta' demorando", vermelho
// pra "passou do limite". Nada de pintar o que esta' dentro do prazo — verde em tudo tambem e'
// ruido.
export function classesDaEspera(faixa: FaixaDeEspera): string {
  if (faixa === "atrasado") {
    return "bg-rose-50 text-rose-700 ring-rose-100 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/20";
  }

  if (faixa === "atencao") {
    return "bg-amber-50 text-amber-700 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20";
  }

  return "bg-subtle text-ink-soft ring-slate-200 dark:ring-slate-700";
}
