"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { GeometriaDaTv } from "@/lib/hercules/espelho/abrir-tela-de-tv";
import type { EstadoDaTv, TelaDeTv } from "@/lib/hercules/espelho/telas-de-tv";
import { MapaDeLotes } from "@/modules/espelho/MapaDeLotes";

// O TELÃO DE VENDAS — a TV fixa no stand, ligada o dia todo, mostrando o mapa do loteamento.
//
// Lucas (22/09/2026): *"preciso criar um espelho do garden para ficar fixo em uma tv, então precisa
// ser assim, em tela cheia mostrando o que está liberado e o que não está com as marcas (...) só que
// não teria os dados de disponivel, nem a parte de unidades, seria somente uma visão para ficar na
// televisão"*.
//
// ⚠️ NINGUÉM VAI CLICAR NESTA TELA, e isso decide o desenho inteiro. Não há painel de unidade, não
// há lista, não há filtro, não há botão. O mapa é para ser OLHADO de longe, por quem está
// atravessando o stand. Cada elemento que não ajuda nisso é ruído numa parede.
//
// ⚠️ O DESENHO É PORTADO, NÃO INVENTADO. A moldura de marca (coluna da esquerda, logo da construtora
// no topo, marca do empreendimento no meio, quem vende no rodapé) vem de
// `public/garden/masterplan.html`, que é a tela aprovada e está no ar. Esta casa já trocou um
// masterplan aprovado por outro desenho e ouviu *"não tinhamos aprovado o masterplan interno???? vc
// mudou tudo"*. O que NÃO veio de lá são os números da coluna (lotes disponíveis, valor a partir de,
// área): são exatamente *"os dados de disponivel"* que o pedido exclui.
//
// ⚠️ E O MAPA É DESENHADO PELO MOTOR ÚNICO (`modules/espelho/MapaDeLotes`), não por uma terceira
// cópia. Aquele arquivo documenta o preço da cópia: o espelho público tinha a própria, e o conserto
// do clique no buraco do `evenodd` chegou à Mesa de Venda e não chegou ao público, no mesmo dia. Aqui
// o que a TV aproveita dele é o que custou defeito: a arte DENTRO do SVG (dois irmãos sobrepostos
// saem de registro no primeiro pixel de diferença de proporção) e o `fillRule="evenodd"`, que é o
// que deixa o número do lote impresso na planta aparecer por baixo da cor.

/**
 * ⚠️ AS DUAS CORES DO ESPELHO DO C2X, MEDIDAS — não escolhidas. Lucas (10/09/2026) apontou
 * `sistema.careli.adm.br/show_map/35` e disse *"esse é o padrão"*. Lidas no `getComputedStyle` dos
 * 298 paths daquela página: azul `rgb(5,68,255)`, verde `rgb(57,143,25)`, `fill-opacity: 0.6`, sem
 * traço. São as mesmas do espelho público (`EspelhoPublico.tsx`), e é de propósito: o cliente que
 * vê a TV no stand e abre o link no celular tem de ver a mesma tinta querendo dizer a mesma coisa.
 *
 * ⚠️ O TELÃO DO PROMETEU USA UM VERDE MAIS VIVO, e não é descuido dele nem daqui: lá a arte é
 * PROJETADA num salão, e o verde oliva do C2X cai em cima da grama do loteamento e some à distância.
 * Numa TV de LED, a 3 ou 4 metros, isso pode não acontecer. Só a TV de verdade responde; se sumir,
 * o lugar de mexer é aqui, e o valor a experimentar é o `rgba(34,197,94,.72)` do Prometeu.
 */
export const VERDE_DA_TV = "rgb(57, 143, 25)";
export const AZUL_DA_TV = "rgb(5, 68, 255)";
const OPACIDADE = 0.6;

/**
 * De quanto em quanto tempo a TV pergunta a situação.
 *
 * ⚠️ 60 SEGUNDOS, E ESSE NÚMERO TEM DONO. A regra de custo desta casa é explícita desde o incidente
 * de fatura do Hermes: não aumentar polling. É o mesmo intervalo do espelho público
 * (`EspelhoPublico.tsx`), e aqui ele é ainda mais barato — é UMA tela, num aparelho só, e não um
 * link aberto em dezenas de celulares ao mesmo tempo. Dá 60 leituras por hora, ~600 num dia de
 * stand.
 *
 * ⚠️ E NÃO HÁ BROADCAST AQUI, ao contrário do telão do Prometeu. Lá o canal de realtime já existe
 * porque é o canal do EVENTO, e a reserva avisa nele. O Garden não é evento: não há tópico para
 * escutar, e abrir um canal só para esta tela seria uma conexão viva o dia inteiro para entregar o
 * que 60 segundos já entregam. Se um dia a venda do Hércules passar a avisar em realtime, é aqui
 * que o `.on("broadcast", ...)` entra, ao lado do timer — nunca no lugar dele.
 */
export const INTERVALO_DA_TV_MS = 60_000;

/**
 * Sem leitura nova por mais que isto, a hora aparece como aviso.
 *
 * ⚠️ TRÊS RODADAS PERDIDAS, COM FOLGA. É a única defesa contra o pior modo de falhar desta tela: a
 * TV continua bonita, mostrando o mapa de ontem, e ninguém percebe olhando para ela. O mapa NÃO é
 * apagado (ver `atualizar`); o que muda é o relógio dizer que parou.
 */
const ATRASO_MS = 5 * 60_000;

/** A paleta da moldura, portada das superfícies claras do masterplan aprovado. */
const CANVAS = "#f7f8fa";
const BASE = "#ffffff";
const BORDA = "#dce2ea";
const TEXTO = "#121722";
const TEXTO_3 = "#667085";
const OURO = "#a07c3b";
const ALERTA = "#c24135";

/**
 * ⚠️ A HORA É FORMATADA NO FUSO DE BRASÍLIA, EXPLÍCITO. Sem `timeZone`, o servidor da Vercel
 * formata em UTC e a TV formata no fuso dela: a primeira pintura sairia três horas errada e o React
 * ainda registraria descasamento de hidratação. O relógio desta tela existe para denunciar mapa
 * congelado — um relógio errado faria o contrário.
 */
const RELOGIO = new Intl.DateTimeFormat("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/** A TV não recebe clique nem mostra cursor. Identidades estáveis para não repintar o mapa. */
const NADA = () => undefined;
const NUNCA = () => false;

/**
 * ⚠️ O PONTEIRO DO MOUSE SOME. Numa TV de stand quase sempre há um teclado ou mouse esquecido
 * atrás do aparelho, e a seta congelada no meio do mapa fica na parede o dia inteiro. O
 * `!important` é necessário porque o motor do mapa declara o próprio cursor.
 */
const CSS_DA_TV = `
[data-tv="telao"], [data-tv="telao"] * { cursor: none !important; }
`;

type Props = {
  estadoInicial: EstadoDaTv;
  geometria: GeometriaDaTv;
  marcas: TelaDeTv["marcas"];
  /** O slug do link — é ele que a atualização manda, nunca o token do espelho. */
  slug: string;
  urlDaArte: string;
};

export function TelaoDeVendas({ estadoInicial, geometria, marcas, slug, urlDaArte }: Props) {
  const [estado, setEstado] = useState(estadoInicial);
  // Marca cada rodada do timer, dê certo ou não: é o que faz o relógio envelhecer na tela quando a
  // rede cai. Sem isto a tela ficaria sem repintar e o horário pareceria sempre recente.
  const [tique, setTique] = useState(() => Date.parse(estadoInicial.atualizadoEm) || Date.now());
  const buscando = useRef(false);

  const atualizar = useCallback(async () => {
    // Rodada anterior ainda de pé (rede lenta no stand): não empilha pedido.
    if (buscando.current) return;
    buscando.current = true;
    try {
      const resposta = await fetch(
        `/api/publico/espelho/tv/situacao?t=${encodeURIComponent(slug)}`,
        { cache: "no-store" },
      );
      if (!resposta.ok) return;
      const corpo = (await resposta.json()) as null | { data?: EstadoDaTv };

      // ⚠️ SÓ TROCA COM PAYLOAD DE VERDADE ([[reference_polling_sem_payload_apaga_tela]]). Resposta
      // vazia, 503 ou lista sem lote nenhum NÃO podem apagar o que já está na parede. Numa TV
      // ligada o dia todo, uma queda de rede de 10 segundos viraria um mapa em branco no meio do
      // stand — e o mapa em branco se lê como "não tem nada à venda aqui".
      if (corpo?.data?.lotes?.length) setEstado(corpo.data);
    } catch {
      // Falha de rede não vira aviso na parede: o relógio já denuncia, e a próxima rodada conserta.
    } finally {
      buscando.current = false;
    }
  }, [slug]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTique(Date.now());
      void atualizar();
    }, INTERVALO_DA_TV_MS);
    return () => window.clearInterval(timer);
  }, [atualizar]);

  const porCodigo = useMemo(
    () => new Map(estado.lotes.map((l) => [l.codigo, l.situacao])),
    [estado.lotes],
  );

  // ⚠️ CONTORNO SEM SITUAÇÃO É OCUPADO, NUNCA SEM COR (Lucas, 29/08/2026, sobre o telão do
  // Prometeu: *"tem alguns lotes que estao sem cor (...) sao lotes ja vendidos"*). O masterplan do
  // Garden tem 405 contornos para 404 unidades — o import registrou "1 label(s) sem unidade" —, e
  // ainda há o vendido antes da carga, a permuta e o nome trocado na arte. Sem cor, o stand lê
  // "livre": o cliente escolhe, o corretor promete, e alguém tem de desdizer. É o mesmo
  // fail-closed de `situacao-publica.ts`, aplicado ao desenho.
  const corDoLote = useCallback(
    (codigo: string) => (porCodigo.get(codigo) === "disponivel" ? VERDE_DA_TV : AZUL_DA_TV),
    [porCodigo],
  );

  const lido = Date.parse(estado.atualizadoEm);
  const atrasado = Number.isFinite(lido) && tique - lido > ATRASO_MS;
  const hora = Number.isFinite(lido) ? RELOGIO.format(new Date(lido)) : "--:--";

  return (
    <main
      data-tv="telao"
      style={{
        background: CANVAS,
        color: TEXTO,
        display: "flex",
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        height: "100dvh",
        overflow: "hidden",
        width: "100dvw",
      }}
    >
      <style>{CSS_DA_TV}</style>

      {/* =================== MOLDURA DE MARCA ===================
          Portada de `public/garden/masterplan.html` (.moldura, .m-topo, .m-marca, .m-rodape). As
          medidas viraram `clamp(...)` em vw: lá a coluna é 238px numa tela de trabalho, aqui ela
          acompanha a TV, que pode ser 1080p ou 4K. */}
      <aside
        style={{
          background: BASE,
          borderRight: `1px solid ${BORDA}`,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          padding: "clamp(18px, 2vw, 46px) clamp(14px, 1.5vw, 34px) clamp(14px, 1.4vw, 32px)",
          width: "clamp(190px, 15vw, 380px)",
        }}
      >
        {marcas.topo ? (
          <>
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                paddingBottom: "clamp(14px, 1.6vw, 34px)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- marca estática de
                  /public; o otimizador do Next entregaria uma versão redimensionada, e numa TV
                  4K isso aparece. */}
              <img alt={marcas.topo.alt} src={marcas.topo.src} style={{ width: "34%" }} />
            </div>
            <div style={{ background: BORDA, height: 1 }} />
          </>
        ) : null}

        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexDirection: "column",
            gap: "clamp(6px, .6vw, 14px)",
            padding: "clamp(16px, 1.7vw, 38px) 0 clamp(10px, 1.1vw, 24px)",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- idem */}
          <img
            alt={marcas.empreendimento.alt}
            src={marcas.empreendimento.src}
            style={{ width: "82%" }}
          />
          <span
            style={{
              color: TEXTO_3,
              fontSize: "clamp(10px, .62vw, 17px)",
              fontWeight: 600,
              letterSpacing: ".03em",
              textTransform: "uppercase",
            }}
          >
            Masterplan de lotes
          </span>
        </div>
        <div
          style={{
            background: OURO,
            borderRadius: 2,
            height: 2,
            margin: "0 auto",
            width: "clamp(36px, 2.6vw, 70px)",
          }}
        />

        {/* =================== LEGENDA ===================
            ⚠️ DUAS LINHAS, E NENHUM NÚMERO. Cor sozinha não informa quem atravessa o stand e nunca
            viu este mapa — mas *"não teria os dados de disponivel"* é literal, e "87 disponíveis"
            é exatamente o dado que o corretor prefere dar pessoalmente. */}
        <div
          style={{
            borderTop: `1px solid ${BORDA}`,
            display: "flex",
            flexDirection: "column",
            gap: "clamp(9px, .9vw, 20px)",
            marginTop: "clamp(18px, 2vw, 44px)",
            paddingTop: "clamp(16px, 1.7vw, 38px)",
          }}
        >
          <Cor cor={VERDE_DA_TV} texto="Disponível" />
          <Cor cor={AZUL_DA_TV} texto="Indisponível" />
        </div>

        <div style={{ flex: 1, minHeight: 12 }} />

        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexDirection: "column",
            gap: "clamp(9px, 1vw, 22px)",
          }}
        >
          {marcas.rodape ? (
            // eslint-disable-next-line @next/next/no-img-element -- idem
            <img alt={marcas.rodape.alt} src={marcas.rodape.src} style={{ width: "62%" }} />
          ) : null}
          <div
            style={{
              alignItems: "center",
              display: "flex",
              flexDirection: "column",
              gap: "clamp(3px, .3vw, 8px)",
            }}
          >
            <span
              style={{
                color: TEXTO_3,
                fontSize: "clamp(9px, .52vw, 14px)",
                letterSpacing: ".03em",
                textTransform: "uppercase",
              }}
            >
              Tecnologia
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element -- idem */}
            <img alt="C2X" src="/c2x-logo.png" style={{ opacity: 0.9, width: "28%" }} />
          </div>

          {/* ⚠️ O RELÓGIO É O ÚNICO TEXTO VIVO DESTA TELA, e ele existe por um motivo só: mapa
              congelado na parede é invisível. A TV fica ligada o dia todo em rede de stand; sem
              isto, uma queda de rede às 10h deixaria o mapa das 10h na parede até alguém
              desconfiar. O mapa NÃO some quando a rede cai — o que muda é este texto. */}
          <span
            style={{
              color: atrasado ? ALERTA : TEXTO_3,
              fontSize: "clamp(9px, .55vw, 15px)",
              fontVariantNumeric: "tabular-nums",
              paddingTop: "clamp(4px, .4vw, 10px)",
              textAlign: "center",
            }}
          >
            {atrasado ? `sem atualizar desde ${hora}` : `atualizado ${hora}`}
          </span>
        </div>
      </aside>

      {/* =================== PALCO ===================
          ⚠️ `imageRendering: high-quality` NÃO É ENFEITE, e a lição é do telão do Prometeu (29/08).
          A arte tem milhares de pixels de largura e a TV quase nunca tem exatamente isso: o Chrome
          reduz, e no filtro padrão as divisas de 1px e os números impressos na planta saem
          SERRILHADOS. A propriedade é herdada, então declarada aqui ela alcança o `<image>` que o
          motor do mapa desenha dentro do SVG — sem precisar mexer no motor, que é compartilhado
          com a Mesa de Venda. */}
      <div
        style={{
          display: "flex",
          flex: 1,
          imageRendering: "high-quality" as never,
          minHeight: 0,
          minWidth: 0,
        }}
      >
        <MapaDeLotes
          aoClicar={NADA}
          clicavel={NUNCA}
          corDoLote={corDoLote}
          fundo={CANVAS}
          geometria={geometria}
          opacidade={OPACIDADE}
          urlDaArte={urlDaArte}
        />
      </div>
    </main>
  );
}

/** Uma linha da legenda: a bolinha na cor cheia e o que ela quer dizer. */
function Cor({ cor, texto }: { cor: string; texto: string }) {
  return (
    <span
      style={{
        alignItems: "center",
        color: TEXTO,
        display: "flex",
        fontSize: "clamp(11px, .72vw, 20px)",
        gap: "clamp(7px, .6vw, 14px)",
      }}
    >
      <i
        style={{
          background: cor,
          borderRadius: 3,
          display: "block",
          flex: "none",
          height: "clamp(11px, .72vw, 20px)",
          width: "clamp(11px, .72vw, 20px)",
        }}
      />
      {texto}
    </span>
  );
}
