"use client";

import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";

import { useTemaDoPortal } from "./tema";

// O MASTERPLAN INTERNO, EM TELA CHEIA, DENTRO DO PORTAL.
//
// Pedido do Lucas (11/08), depois de ver a primeira versão: "ficou ruim, primeiro tem que seguir o
// esquema de cor do sistema. e outra está pequeno, não era assim que abrir o link, tem que usar a
// tela toda".
//
// O QUE ESTAVA ERRADO: a tela entrava como um bloco dentro do `<main>` do portal, que é limitado a
// 1180px e tem respiro nas laterais. O masterplan é uma tela de trabalho — mapa de um lado,
// painéis do outro — e espremido em pouco mais de mil pixels ele vira uma miniatura com moldura
// branca em volta. Aqui ele sai do fluxo do portal e ocupa a janela inteira.
//
// A COR: a barra de cima usa os MESMOS tokens do shell do Panteon que a tela do masterplan usa
// (#0a0a0a de base, a borda branca translúcida de 7,5%, o texto #f7f8fa). Não é uma cor escolhida
// aqui: é a paleta que o Lucas aprovou em 07/08 e que a tela lá dentro já usa. Com a moldura clara
// do portal em volta, o conjunto ficava com dois esquemas de cor brigando na mesma imagem.
//
// ⚠️ A TELA LÁ DENTRO NÃO MUDA. Ela é o A-INTERNO, aprovado com nove prints de validação, servido
// inteiro pela rota. Aqui só se decide QUANTO ESPAÇO ela ocupa e o que a emoldura.

// A MOLDURA ACOMPANHA O MAPA, e por isso ela NÃO usa as variáveis `--inc-*` do portal.
//
// Parece contraintuitivo, mas o mapa mora num <iframe>: ele é outro documento e não herda variável
// CSS nenhuma daqui. Quem decide a cor lá dentro é o parâmetro `tema` que a rota recebe. Se a
// moldura seguisse o token do portal e o mapa seguisse o parâmetro, bastaria os dois discordarem
// um instante (por exemplo, no portal PERSONALIZADO, onde o mapa é sempre claro) para a faixa de
// cima ficar preta em volta de um mapa branco. Amarrando as duas ao MESMO `efetivo`, elas não têm
// como divergir.
//
// Os valores claros são os do Panteon, os mesmos que a tela passou a usar por dentro
// (lib/apolo/masterplan-tema-claro.ts). Os escuros são os do arquivo A-INTERNO original, que é a
// paleta que o Lucas aprovou em 07/08 — a mesma do tema escuro do portal.
const SHELL_POR_TEMA = {
  claro: {
    base: "#ffffff",
    borda: "#dce2ea",
    texto: "#121722",
    textoFraco: "#667085",
  },
  escuro: {
    base: "#0a0a0a",
    borda: "rgb(255 255 255 / .075)",
    texto: "#f7f8fa",
    textoFraco: "#a5afbd",
  },
} as const;

export function TelaMasterplan({
  code,
  nome,
  onVoltar,
}: {
  code: string;
  nome: string;
  onVoltar: () => void;
}) {
  // O TEMA EM USO, que aqui vira duas coisas: a cor desta moldura e o que a rota faz com o arquivo.
  // No portal PERSONALIZADO (Cecílio) o provedor devolve "claro" sempre — o mapa dele continua
  // chegando claro, byte a byte como está no ar. Ver [[perfis-de-portal]].
  const { efetivo } = useTemaDoPortal();
  const SHELL = SHELL_POR_TEMA[efetivo];

  // Enquanto o mapa está aberto, a página de trás não rola: o masterplan tem rolagem própria nos
  // painéis, e duas barras de rolagem concorrendo é o tipo de coisa que o cliente sente sem saber
  // nomear. `Escape` fecha, porque tela cheia sem saída de teclado prende quem usa teclado.
  useEffect(() => {
    const anterior = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") onVoltar();
    };
    window.addEventListener("keydown", aoTeclar);

    return () => {
      document.body.style.overflow = anterior;
      window.removeEventListener("keydown", aoTeclar);
    };
  }, [onVoltar]);

  return (
    <div
      style={{
        background: SHELL.base,
        display: "flex",
        flexDirection: "column",
        inset: 0,
        position: "fixed",
        // Acima do cabeçalho do portal, que é o único elemento com camada própria.
        zIndex: 60,
      }}
    >
      {/* A SAÍDA. O masterplan ocupa a janela inteira e NÃO tem a navegação do portal por perto —
          nem a barra de abas, nem nada. Dentro de um quadro o botão voltar do navegador também não
          sai. Sem este botão o cliente entra e fica preso (regra do Lucas, 11/08: "tem que ter um
          botão ou algo parecido para voltar a tela inicial do perfil").

          Por isso ele é um botão de verdade, com borda e contraste, e não um link discreto: é a
          única porta da tela. A faixa toda tem 38px, contra os 52px do cabeçalho da própria tela;
          o resto da janela é todo do mapa. `Esc` faz o mesmo. */}
      <header
        style={{
          alignItems: "center",
          background: SHELL.base,
          borderBottom: `1px solid ${SHELL.borda}`,
          display: "flex",
          flexShrink: 0,
          gap: 12,
          height: 38,
          padding: "0 12px",
        }}
      >
        <button
          onClick={onVoltar}
          style={{
            alignItems: "center",
            background: SHELL.base,
            border: `1px solid ${SHELL.borda}`,
            borderRadius: 8,
            color: SHELL.texto,
            cursor: "pointer",
            display: "inline-flex",
            fontFamily: "inherit",
            fontSize: 12.5,
            fontWeight: 600,
            gap: 6,
            padding: "5px 11px",
          }}
          title="Voltar para o portal (Esc)"
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={14} />
          Voltar
        </button>
        <span style={{ color: SHELL.texto, fontSize: 12.5, fontWeight: 600 }}>{nome}</span>
        <span style={{ color: SHELL.textoFraco, fontSize: 11.5, marginLeft: "auto" }}>
          Masterplan
        </span>
      </header>

      {/* ⚠️ O `tema` NA URL É SÓ APARÊNCIA. A rota confere a sessão e recorta os lotes do jeito que
          sempre conferiu; este parâmetro decide uma coisa só: clarear o arquivo (que nasce escuro)
          ou entregá-lo como está. Sem ele, o mapa vinha claro à força e ficava um retângulo branco
          no meio do portal escuro. */}
      <iframe
        src={`/api/incorporador/masterplan?code=${encodeURIComponent(code)}&tema=${efetivo}`}
        style={{ border: "none", display: "block", flex: 1, width: "100%" }}
        title={`Masterplan do ${nome}`}
      />
    </div>
  );
}
