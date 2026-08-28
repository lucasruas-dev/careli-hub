import { describe, expect, it } from "vitest";

import {
  emModoQuiosque,
  escalaDoTotem,
  type MedidaDaTela,
} from "./escala-do-totem";

// Medidas reais das telas onde o posto roda. `alturaDoQuadro` é o quadro da reserva já
// descontado o que houver em volta.
function medida(parcial: Partial<MedidaDaTela>): MedidaDaTela {
  return {
    alturaDaJanela: 1080,
    alturaDaTela: 1080,
    alturaDoQuadro: 1080,
    telaCheiaPelaApi: false,
    ...parcial,
  };
}

describe("reconhece o quiosque por qualquer caminho", () => {
  it("Fullscreen API ligada — o operador clicou no botão", () => {
    expect(
      emModoQuiosque(
        medida({
          alturaDaJanela: 900,
          alturaDaTela: 1080,
          telaCheiaPelaApi: true,
        }),
      ),
    ).toBe(true);
  });

  // ⚠️ O CASO QUE ESTAVA QUEBRADO: o atalho do posto abre com --kiosk, que ocupa o monitor
  // inteiro SEM Fullscreen API. document.fullscreenElement é null e a tela do evento
  // renderizava em tamanho de janelinha.
  it("--kiosk do Chrome: sem API, mas a janela tem a altura da tela", () => {
    expect(
      emModoQuiosque(medida({ alturaDaJanela: 1080, alturaDaTela: 1080 })),
    ).toBe(true);
  });

  it("a folga absorve a diferença de alguns pixels", () => {
    expect(
      emModoQuiosque(medida({ alturaDaJanela: 1074, alturaDaTela: 1080 })),
    ).toBe(true);
    expect(
      emModoQuiosque(medida({ alturaDaJanela: 1060, alturaDaTela: 1080 })),
    ).toBe(false);
  });

  it("janela do hub, com barra de endereço e barra de tarefas — não é quiosque", () => {
    expect(
      emModoQuiosque(medida({ alturaDaJanela: 930, alturaDaTela: 1080 })),
    ).toBe(false);
  });

  it("sem medida de tela (ambiente sem screen) não inventa quiosque", () => {
    expect(
      emModoQuiosque(medida({ alturaDaJanela: 800, alturaDaTela: 0 })),
    ).toBe(false);
  });
});

describe("escolhe a escala pelo espaço que a tela tem", () => {
  it("monitor EM PÉ do posto (1080×1920) — ampla", () => {
    expect(
      escalaDoTotem(
        medida({
          alturaDaJanela: 1920,
          alturaDaTela: 1920,
          alturaDoQuadro: 1920,
        }),
      ),
    ).toBe("ampla");
  });

  it("monitor deitado 1920×1080 em tela cheia — ampla", () => {
    expect(escalaDoTotem(medida({ telaCheiaPelaApi: true }))).toBe("ampla");
  });

  // O pedido do Lucas em 28/08: a tela vai para o tablet, deitado no suporte.
  it("TABLET DEITADO (por volta de 800px de altura) — media, não ampla", () => {
    expect(
      escalaDoTotem(
        medida({ alturaDaJanela: 800, alturaDaTela: 800, alturaDoQuadro: 800 }),
      ),
    ).toBe("media");
    // e com DPR maior, o mesmo tablet reporta menos px de CSS
    expect(
      escalaDoTotem(
        medida({ alturaDaJanela: 600, alturaDaTela: 600, alturaDoQuadro: 600 }),
      ),
    ).toBe("media");
  });

  it("notebook 1366×768 em tela cheia — media", () => {
    expect(
      escalaDoTotem(
        medida({
          alturaDaJanela: 768,
          alturaDaTela: 768,
          alturaDoQuadro: 768,
          telaCheiaPelaApi: true,
        }),
      ),
    ).toBe("media");
  });

  it("dentro do hub, com rail e abas — compacta, mesmo em monitor grande", () => {
    expect(
      escalaDoTotem(
        medida({
          alturaDaJanela: 930,
          alturaDaTela: 1080,
          alturaDoQuadro: 820,
        }),
      ),
    ).toBe("compacta");
  });

  it("celular deitado em quiosque — compacta: nem a media cabe", () => {
    expect(
      escalaDoTotem(
        medida({ alturaDaJanela: 380, alturaDaTela: 380, alturaDoQuadro: 380 }),
      ),
    ).toBe("compacta");
  });

  it("as fronteiras exatas", () => {
    const emQuiosque = (altura: number) =>
      escalaDoTotem(
        medida({
          alturaDaJanela: altura,
          alturaDaTela: altura,
          alturaDoQuadro: altura,
        }),
      );
    expect(emQuiosque(1000)).toBe("ampla");
    expect(emQuiosque(999)).toBe("media");
    expect(emQuiosque(560)).toBe("media");
    expect(emQuiosque(559)).toBe("compacta");
  });

  // O ResizeObserver ainda não respondeu: sem a medida do quadro, a janela serve de plano B —
  // senão o primeiro quadro nasceria compacto e a tela daria um pulo visível.
  it("primeiro render, antes de medir o quadro — usa a janela", () => {
    expect(
      escalaDoTotem(
        medida({ alturaDaJanela: 1920, alturaDaTela: 1920, alturaDoQuadro: 0 }),
      ),
    ).toBe("ampla");
  });
});
