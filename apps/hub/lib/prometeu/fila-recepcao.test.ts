import { describe, expect, it } from "vitest";

import { agoraNoEvento, filaDaRecepcao } from "./data";
import type { PrometeuCredenciado } from "./types";

// A regra da fila da recepcao e o coracao do dia do lancamento e nao pode falhar: os exemplos
// abaixo sao os que o Lucas descreveu (19/jul), escritos como teste pra travar o comportamento.
//
//   - check-in DENTRO da janela -> ordena pela fila do evento (ordem do PIX). A fila REORDENA a
//     cada check-in: quem chega depois, mas pagou antes, assume a frente.
//   - check-in DEPOIS da janela -> ordem de chegada, sempre atras de todo o primeiro grupo.
//
// ⚠️ "pagou o PIX" = `ordemFila != null` (o `pix` da factory), NAO `posicao != null`. Em producao
// `listCredenciados` grava `posicao` (indice+1) para TODO mundo, pago ou nao — entao os fixtures
// aqui SEMPRE tem posicao nao-nula (o default da factory). Onde a ordem entre NAO-pagantes importa,
// passamos `posicao` divergente da chegada de proposito: se alguem voltar a usar posicao como proxy
// de pagamento, esses testes quebram (foi o bug pego na revisao de 29/jul).

function credenciado(input: {
  entrouEm?: string | null;
  etapa?: PrometeuCredenciado["etapa"];
  fase?: number | null;
  ligado?: boolean | null;
  naJanela?: boolean | null;
  nome: string;
  pix?: number | null;
  posicao?: number;
}): PrometeuCredenciado {
  const pix = input.pix ?? null;
  return {
    chegouEm: null,
    corretor: null,
    credenciadoNaJanela: input.naJanela ?? null,
    documento: null,
    entityId: null,
    entrouEm: input.entrouEm ?? null,
    etapa: input.etapa ?? "recepcao",
    etapaDesde: "2026-08-01T11:00:00Z",
    etiquetaImpressaEm: null,
    eventoId: "evento-1",
    id: input.nome,
    imobiliaria: null,
    imobiliariaEntityId: null,
    nome: input.nome,
    // A fila do evento: `ordemFila` = ordem do PIX (nula = nao pagou / sem lugar na fila).
    ordemFila: pix,
    paPath: null,
    noShow: false,
    noShowZona: null,
    ordemMotivo: null,
    origem: "teste",
    pagoEm: pix === null ? null : "2026-07-20T10:00:00Z",
    // DERIVADA na leitura, NUNCA nula em producao. Default reflete isso (pagante = rank do PIX;
    // nao-pagante = um rank alto). Testes de desempate de nao-pagantes passam explicito.
    posicao: input.posicao ?? pix ?? 900,
    recepcaoFase: input.fase ?? null,
    recepcaoLigado: input.ligado ?? null,
    unidades: [],
  };
}

const nomes = (lista: PrometeuCredenciado[]) => lista.map((c) => c.nome);

describe("filaDaRecepcao", () => {
  it("so mostra quem ja fez check-in (quem nao chegou fica de fora)", () => {
    const fila = filaDaRecepcao([
      credenciado({ entrouEm: "2026-08-01T11:00:00Z", nome: "Chegou", pix: 2 }),
      credenciado({ nome: "Habilitado, nao chegou", pix: 1 }),
    ]);

    expect(nomes(fila)).toEqual(["Chegou"]);
  });

  // CHECK-IN LIGADO = o PIX manda: quem pagou antes (ordem menor) assume a frente mesmo chegando
  // depois. A fila REORDENA a cada check-in. (regra validada pelo Lucas, 25/jul)
  it("check-in ligado: quem pagou antes assume a frente mesmo chegando depois", () => {
    const fila = filaDaRecepcao(
      [
        credenciado({ entrouEm: "2026-08-01T11:00:00Z", nome: "Segundo", pix: 2 }),
        credenciado({ entrouEm: "2026-08-01T11:40:00Z", nome: "Primeiro", pix: 1 }),
      ],
      true,
    );

    expect(nomes(fila)).toEqual(["Primeiro", "Segundo"]);
  });

  // Ligado: quem NAO pagou PIX (ordemFila nula) fica atras de todos os com PIX; entre os sem PIX,
  // vale a ordem de CHEGADA FISICA (entrouEm) — nao a posicao derivada. Por isso 'tarde' recebe
  // posicao BAIXA e 'cedo' posicao ALTA: se a ordem saisse de posicao, viria invertida.
  it("check-in ligado: sem PIX fica atras dos com PIX, e entre si por chegada", () => {
    const fila = filaDaRecepcao(
      [
        credenciado({ entrouEm: "2026-08-01T11:30:00Z", nome: "Com PIX", pix: 1 }),
        credenciado({ entrouEm: "2026-08-01T11:50:00Z", nome: "Sem PIX tarde", pix: null, posicao: 5 }),
        credenciado({ entrouEm: "2026-08-01T11:05:00Z", nome: "Sem PIX cedo", pix: null, posicao: 9 }),
      ],
      true,
    );

    expect(nomes(fila)).toEqual(["Com PIX", "Sem PIX cedo", "Sem PIX tarde"]);
  });

  // CHECK-IN DESLIGADO = o PIX perde a prioridade: TODOS por ordem de chegada (hora do check-in
  // fisico), ignorando a fila do evento. (regra validada pelo Lucas, 25/jul)
  it("check-in desligado: ordem so de chegada, ignorando o PIX", () => {
    const fila = filaDaRecepcao(
      [
        credenciado({ entrouEm: "2026-08-01T12:30:00Z", nome: "Chegou 9h30 PIX#1", pix: 1 }),
        credenciado({ entrouEm: "2026-08-01T12:05:00Z", nome: "Chegou 9h05 PIX#9", pix: 9 }),
        credenciado({ entrouEm: "2026-08-01T12:20:00Z", nome: "Chegou 9h20 s/ PIX", pix: null }),
      ],
      false,
    );

    expect(nomes(fila)).toEqual([
      "Chegou 9h05 PIX#9",
      "Chegou 9h20 s/ PIX",
      "Chegou 9h30 PIX#1",
    ]);
  });

  // Quem já foi atendido não pode continuar ocupando o topo da fila. Como os primeiros
  // pagantes do PIX são justamente os primeiros a serem chamados, sem este filtro o card
  // "Fila da recepção" ficaria congelado neles o dia inteiro.
  it("tira da fila quem já concluiu ou cancelou", () => {
    const fila = filaDaRecepcao([
      credenciado({
        entrouEm: "2026-08-01T11:00:00Z",
        etapa: "concluido",
        nome: "Já fechou",
        pix: 1,
      }),
      credenciado({
        entrouEm: "2026-08-01T11:05:00Z",
        etapa: "cancelado",
        nome: "Desistiu",
        pix: 2,
      }),
      credenciado({
        entrouEm: "2026-08-01T11:10:00Z",
        etapa: "recepcao",
        nome: "Esperando de verdade",
        pix: 3,
      }),
    ]);

    expect(nomes(fila)).toEqual(["Esperando de verdade"]);
  });

  // REGRA NOVA (Lucas, 27/07): "quando o cliente vai para outra fila ele tem que sair da que
  // ele estava, ele tem que andar no circuito". A fila da RECEPÇÃO é só quem está ESPERANDO na
  // recepção. Antes, quem já tinha ido para o salão continuava aqui: o organizador chamava
  // gente que já estava sendo atendida e a contagem de "esperando" nunca baixava.
  it("TIRA da fila quem já andou no circuito", () => {
    const fila = filaDaRecepcao([
      credenciado({
        entrouEm: "2026-08-01T11:00:00Z",
        etapa: "negociacao",
        nome: "Com o corretor",
        pix: 1,
      }),
      credenciado({
        entrouEm: "2026-08-01T11:05:00Z",
        etapa: "secretaria",
        nome: "Na secretaria",
        pix: 2,
      }),
      credenciado({
        entrouEm: "2026-08-01T11:10:00Z",
        etapa: "recepcao",
        nome: "Ainda esperando",
        pix: 3,
      }),
    ]);

    expect(nomes(fila)).toEqual(["Ainda esperando"]);
  });

  // Cenario completo com o check-in LIGADO: com PIX na frente pela ordem do PIX; sem PIX no fim,
  // entre si por chegada. Os sem PIX (C, E) recebem posicao divergente da chegada de proposito.
  it("check-in ligado: com PIX na frente pela ordem do PIX, sem PIX no fim por chegada", () => {
    const fila = filaDaRecepcao(
      [
        credenciado({ entrouEm: "2026-08-01T12:40:00Z", nome: "E · 9h40 s/ PIX", pix: null, posicao: 6 }),
        credenciado({ entrouEm: "2026-08-01T11:02:00Z", nome: "B · 8h02 PIX#3", pix: 3 }),
        credenciado({ entrouEm: "2026-08-01T12:06:00Z", nome: "D · 9h06 PIX#1", pix: 1 }),
        credenciado({ entrouEm: "2026-08-01T11:50:00Z", nome: "A · 8h50 PIX#2", pix: 2 }),
        credenciado({ entrouEm: "2026-08-01T11:15:00Z", nome: "C · 8h15 s/ PIX", pix: null, posicao: 8 }),
      ],
      true,
    );

    expect(nomes(fila)).toEqual([
      "D · 9h06 PIX#1", // PIX#1 na frente
      "A · 8h50 PIX#2",
      "B · 8h02 PIX#3",
      "C · 8h15 s/ PIX", // sem PIX no fim, por chegada (11h15 < 12h40)
      "E · 9h40 s/ PIX",
    ]);
  });

  // CONGELAMENTO POR FASE (Lucas, 29/07): ligar/desligar o check-in nao pode reordenar quem ja
  // entrou. Cada credenciado guarda a FASE do regime e se estava LIGADO no momento do check-in; a
  // fila ordena por essa chave congelada, e a fase sobe a cada troca do liga/desliga.
  it("fase congela: pagante que bipa com o check-in DESLIGADO fica atras da fase anterior", () => {
    const fila = filaDaRecepcao([
      credenciado({ nome: "A f1 PIX#1", fase: 1, ligado: true, pix: 1, entrouEm: "2026-08-01T11:00:00Z" }),
      credenciado({ nome: "B f1 PIX#2", fase: 1, ligado: true, pix: 2, entrouEm: "2026-08-01T11:05:00Z" }),
      // Fase 2 (check-in desligado): mesmo com PIX baixo, vao pro FIM da fila.
      credenciado({ nome: "C f2 PIX#3", fase: 2, ligado: false, pix: 3, entrouEm: "2026-08-01T11:20:00Z" }),
      credenciado({ nome: "D f2 PIX#5", fase: 2, ligado: false, pix: 5, entrouEm: "2026-08-01T11:25:00Z" }),
    ]);

    expect(nomes(fila)).toEqual(["A f1 PIX#1", "B f1 PIX#2", "C f2 PIX#3", "D f2 PIX#5"]);
  });

  // O CERNE DO BUG: religar o check-in nao pode "ressuscitar" a prioridade do PIX de quem ja
  // estava na fila. A ordem congelada e a mesma quer o flag esteja ligado ou desligado AGORA.
  it("religar NAO reordena quem ja entrou: a fila independe do flag atual", () => {
    const lista = [
      credenciado({ nome: "A f1 PIX#1", fase: 1, ligado: true, pix: 1, entrouEm: "2026-08-01T11:00:00Z" }),
      credenciado({ nome: "C f2 PIX#3", fase: 2, ligado: false, pix: 3, entrouEm: "2026-08-01T11:20:00Z" }),
      // Fase 3 (religado): E pagou PIX#2, mas entra ATRAS de todos — nao fura as fases anteriores.
      credenciado({ nome: "E f3 PIX#2", fase: 3, ligado: true, pix: 2, entrouEm: "2026-08-01T11:40:00Z" }),
    ];
    const esperado = ["A f1 PIX#1", "C f2 PIX#3", "E f3 PIX#2"];

    expect(nomes(filaDaRecepcao(lista, true))).toEqual(esperado);
    expect(nomes(filaDaRecepcao(lista, false))).toEqual(esperado);
  });

  // Dentro de uma MESMA fase ligada o PIX ordena; a fase nova entra inteira atras da antiga.
  it("dentro da fase ligada o PIX manda; entre fases, a fase manda", () => {
    const fila = filaDaRecepcao([
      // Fase 1 desligada: so chegada (o PIX#4 do B nao conta).
      credenciado({ nome: "A f1 chegada 11h", fase: 1, ligado: false, pix: null, entrouEm: "2026-08-01T11:00:00Z" }),
      credenciado({ nome: "B f1 chegada 11h10", fase: 1, ligado: false, pix: 4, entrouEm: "2026-08-01T11:10:00Z" }),
      // Fase 2 ligada: PIX manda entre eles (D#1 antes de C#2), sem PIX no fim — mas todos atras da fase 1.
      credenciado({ nome: "C f2 PIX#2", fase: 2, ligado: true, pix: 2, entrouEm: "2026-08-01T11:30:00Z" }),
      credenciado({ nome: "D f2 PIX#1", fase: 2, ligado: true, pix: 1, entrouEm: "2026-08-01T11:35:00Z" }),
      credenciado({ nome: "E f2 s/ PIX", fase: 2, ligado: true, pix: null, entrouEm: "2026-08-01T11:32:00Z" }),
    ]);

    expect(nomes(fila)).toEqual([
      "A f1 chegada 11h",
      "B f1 chegada 11h10",
      "D f2 PIX#1",
      "C f2 PIX#2",
      "E f2 s/ PIX",
    ]);
  });
});

describe("agoraNoEvento", () => {
  // O servidor roda em UTC e o evento em Brasilia: errar isso desloca a janela em 3 horas e
  // bagunca a ordem da fila inteira no dia.
  it("converte para o horario de Brasilia, nao UTC", () => {
    // 2026-08-01T11:30:00Z = 08:30 em Brasilia (UTC-3).
    const { data, hora } = agoraNoEvento(new Date("2026-08-01T11:30:00Z"));

    expect(data).toBe("2026-08-01");
    expect(hora).toBe("08:30:00");
  });

  it("nao vira o dia cedo demais (23h59 em Brasilia ainda e o mesmo dia)", () => {
    // 2026-08-02T02:59:00Z = 23:59 do dia 01 em Brasilia.
    const { data, hora } = agoraNoEvento(new Date("2026-08-02T02:59:00Z"));

    expect(data).toBe("2026-08-01");
    expect(hora).toBe("23:59:00");
  });
});
