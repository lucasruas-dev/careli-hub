"use client";

import { useEffect, useMemo, useState } from "react";

import type { EtapaDoEspelho } from "@/lib/hercules/fluxo-de-venda";
import { type GeometriaDoMapa, MapaDeLotes } from "@/modules/espelho/MapaDeLotes";

import { T } from "../tema";

// O ESPELHO DA MESA DE VENDA — o mapa do loteamento com as cores do FUNIL.
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
// ⚠️ MAS AS CORES SÃO AS DAQUI, E NÃO AS DE LÁ. Lucas (09/09/2026): *"esse é o padrão externo, o
// interno é o que desenhamos e que está hoje com as cores referente aos status"*. O público vê
// duas cores (dá para comprar ou não); quem trabalha o funil vê as nove etapas. É por isso que o
// motor do mapa (`MapaDeLotes`) recebe a cor por fora: o desenho é o mesmo, a leitura não.

export type LoteDaMesa = {
  codigo: string;
  etapa: EtapaDoEspelho;
  id: string;
};

/**
 * As cores das etapas, em versão SÓLIDA.
 *
 * ⚠️ DUAS DELAS SÃO GRADIENTE NA GRADE, E GRADIENTE NÃO É `fill` DE SVG. Na grade, `reservada` e
 * `vendida` saem listradas (`repeating-linear-gradient`) para distinguir "reservada sem proposta"
 * de "reserva do fluxo" e "vendida sem proposta" de "faturado" — um recurso que só existe em CSS.
 * No mapa, um `fill` com `repeating-linear-gradient` não pinta NADA: o lote sairia transparente,
 * que é exatamente o que quem olha lê como "disponível". Aqui elas viram a cor cheia
 * correspondente, e a diferença entre os dois pares fica no rótulo do painel.
 */
const COR_SOLIDA: Record<EtapaDoEspelho, string> = {
  assinatura: "#454c5c",
  bloqueada: "#e08276",
  contrato: "#9b7ed0",
  // O disponível é o único que não pinta: é a planta limpa, como no espelho público.
  disponivel: "transparent",
  faturado: "#3f9d5e",
  proposta: "#5b8dd6",
  reservada: "#f2c14e",
  reservado: "#f2c14e",
  vendida: "#3f9d5e",
};

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
          // filtra por etapa: os lotes fora do filtro continuam desenhados, e pintá-los de uma cor
          // qualquer diria que estão numa etapa que ninguém consultou.
          return lote ? (COR_SOLIDA[lote.etapa] ?? "transparent") : "transparent";
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
