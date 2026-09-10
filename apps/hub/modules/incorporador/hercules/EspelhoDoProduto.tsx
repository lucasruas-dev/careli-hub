"use client";

import { useEffect, useMemo, useState } from "react";

import type { EtapaDoEspelho } from "@/lib/hercules/fluxo-de-venda";
import { type GeometriaDoMapa, MapaDeLotes } from "@/modules/espelho/MapaDeLotes";

import { T } from "../tema";

// O ESPELHO DA MESA DE VENDA — o mapa do loteamento, em verde e azul.
//
// Lucas (10/09/2026): *"pq não tem o espelho no veredas aqui"*, e a escolha de migrar a Mesa para
// a base nova.
//
// ⚠️ O QUE ISTO SUBSTITUI, E POR QUE VALE. Até aqui o espelho da Mesa era um `<iframe>` para
// `/api/incorporador/masterplan?so=espelho`, que serve CINCO arquivos HTML gerados à mão
// (`masterplans-internos/*.html`). Três dos oito empreendimentos com masterplan publicado ficavam
// de fora — Veredas do Ouro, Jardim das Gerais e Villa Paris — e cada novo empreendimento exigia
// gerar mais um HTML. Esta tela lê a MESMA fonte do espelho público (`hercules_masterplans`), que
// cobre os oito e cresce sozinha quando um masterplan novo é importado.
//
// ⚠️ AS CORES DO MAPA SÃO AS MESMAS DOS DOIS LADOS DO LOGIN. Lucas (10/09/2026): *"as cores do
// espelho permanece igual, verde e azul"* · *"o que muda é somente na grade"*. A régua de 09/09
// (*"o interno é o que está hoje com as cores referente aos status"*) vale para a GRADE, que é
// onde o funil se lê; no mapa, sobre foto aérea, nove tons viram mancha — e dois deles nem
// pintariam, porque são gradiente e gradiente não é `fill` de SVG.
//
// O motor (`MapaDeLotes`) continua recebendo a cor por fora mesmo assim: é o que deixa as duas
// telas compartilharem desenho, zoom e arraste sem uma amarrar a paleta da outra.

export type LoteDaMesa = {
  codigo: string;
  etapa: EtapaDoEspelho;
  id: string;
};

/**
 * ⚠️ O MAPA TEM DUAS CORES, E A GRADE TEM NOVE. Lucas (10/09/2026), vendo o espelho migrado: *"as
 * cores do espelho permanece igual, verde e azul"*.
 *
 * Não é contradição com a régua da casa, é divisão de trabalho entre as duas vistas da MESMA
 * tela: no mapa a pergunta é onde ainda há lote livre, e nove tons sobre uma foto aérea viram
 * mancha — os dois pares listrados (`reservada`/`vendida`) nem chegariam a pintar, porque
 * gradiente não é `fill` de SVG. Na GRADE, que é desenho limpo em quadradinhos, as nove etapas
 * continuam: é lá que o coordenador lê o funil.
 *
 * São exatamente as cores medidas no espelho do C2X, as mesmas do espelho público — para o mapa
 * ser o mesmo mapa dos dois lados do login.
 */
const VERDE = "rgb(57, 143, 25)";
const AZUL = "rgb(5, 68, 255)";

export function EspelhoDoProduto({
  aoClicarNoLote,
  code,
  lotes,
  loteEmFoco,
}: {
  /** Recebe a unidade da Mesa, quando o lote clicado está no recorte atual. */
  aoClicarNoLote: (lote: LoteDaMesa) => void;
  /** O código do empreendimento no C2X (VDO, VLO…). O mapa do PAI responde pelos filhos. */
  code: string;
  /** O estoque que a Mesa já carregou. Nada é buscado de novo aqui. */
  lotes: LoteDaMesa[];
  loteEmFoco?: null | string;
}) {
  const [geometria, setGeometria] = useState<GeometriaDoMapa | null>(null);
  const [erro, setErro] = useState<null | string>(null);

  // A geometria é imutável e vem com cache de um ano: uma vez por empreendimento, e o navegador
  // guarda. Sem `Authorization` porque o proxy libera `/api/incorporador/*` pelo cookie da sessão.
  useEffect(() => {
    let vivo = true;
    setGeometria(null);
    setErro(null);

    fetch(`/api/incorporador/espelho?code=${encodeURIComponent(code)}&parte=geometria`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((g: GeometriaDoMapa) => {
        if (vivo && g?.contornos?.length) setGeometria(g);
        else if (vivo) setErro("Mapa em preparação.");
      })
      .catch(() => {
        if (vivo) setErro("Mapa indisponível para este produto.");
      });

    return () => {
      vivo = false;
    };
  }, [code]);

  // ⚠️ O ÍNDICE É PELO CÓDIGO DA UNIDADE, que é o mesmo `inkscape:label` do masterplan. É a chave
  // que o importador conferiu contra o cadastro na hora de publicar.
  const porCodigo = useMemo(
    () => new Map(lotes.map((l) => [l.codigo.trim().toUpperCase(), l])),
    [lotes],
  );

  if (erro) {
    return (
      <div style={moldura()}>
        <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>{erro}</p>
      </div>
    );
  }

  if (!geometria) {
    return (
      <div style={moldura()}>
        <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>Carregando o mapa…</p>
      </div>
    );
  }

  return (
    <div style={{ ...moldura(), display: "flex", padding: 0 }}>
      <MapaDeLotes
        aoClicar={(codigo) => {
          const lote = porCodigo.get(codigo.trim().toUpperCase());
          if (lote) aoClicarNoLote(lote);
        }}
        corDoLote={(codigo) => {
          const lote = porCodigo.get(codigo.trim().toUpperCase());
          // ⚠️ CONTORNO SEM UNIDADE NO RECORTE FICA SEM TINTA. Acontece quando o coordenador
          // filtra por etapa: os lotes fora do filtro continuam desenhados, e pintá-los de azul
          // diria "indisponível" sobre um lote que ninguém consultou.
          if (!lote) return "transparent";
          return lote.etapa === "disponivel" ? VERDE : AZUL;
        }}
        destacado={loteEmFoco ?? null}
        fundo={T.soft}
        geometria={geometria}
        urlDaArte={`/api/incorporador/espelho?code=${encodeURIComponent(code)}&parte=arte`}
      />
    </div>
  );
}

/** A mesma moldura do iframe que este componente substitui: altura fixa dentro do grid do card. */
function moldura(): React.CSSProperties {
  return {
    alignItems: "center",
    background: T.soft,
    border: `1px solid ${T.border}`,
    borderRadius: 10,
    display: "grid",
    // ⚠️ ALTURA FIXA, e não `flex`. O card do estoque vive num grid; sem altura o mapa colapsa
    // para zero e a tela fica com um retângulo vazio no lugar dele — foi assim com o iframe.
    height: "min(72vh, 720px)",
    justifyItems: "center",
    overflow: "hidden",
    padding: 16,
    width: "100%",
  };
}
