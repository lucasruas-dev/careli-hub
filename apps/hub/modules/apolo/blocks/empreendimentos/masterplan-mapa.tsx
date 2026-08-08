"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";

// Só TIPOS daqui: `empreendimentos.ts` é server-side (mysql2). Importar um valor arrastaria
// o driver do MySQL pro bundle do browser.
import type {
  ApoloEnterpriseBucket,
  ApoloEnterpriseRow,
  ApoloEnterpriseUnit,
} from "@/lib/apolo/empreendimentos";

import { getApoloAccessToken } from "../../data/apolo-operations";

/**
 * SITUAÇÃO -> RÓTULO. É só semântica; o desenho de cada estado mora em `PRANCHA`.
 *
 * Só o balde "disponivel" é disponível. QUALQUER outra situação do C2X (bloqueado, reservado,
 * em negociação, vendido) é "não posso vender", e pro corretor isso é uma coisa só. Hoje o
 * Garden só usa disponível/bloqueado, mas outros empreendimentos usam os demais baldes, e o
 * Garden pode passar a usar: por isso a regra é "livre x resto", e não uma lista de status.
 *
 * O rótulo é "Indisponível", e não "Bloqueado", justamente porque junta bloqueado + reservado +
 * negociação + vendido: no dia da primeira venda do Garden a legenda "Bloqueado 317" mentiria.
 * Quem quer saber o motivo real passa o mouse — o balão mostra o status cru do C2X.
 *
 * "Sem dado" não é situação, é AUSÊNCIA de dado: lote desenhado que não achou unidade no C2X.
 */
const SITUACOES = {
  disponivel: { descricao: "livre para venda", rotulo: "Disponível" },
  indisponivel: { descricao: "vendido, reservado ou bloqueado", rotulo: "Indisponível" },
  semDado: { descricao: "sem correspondência no C2X", rotulo: "Sem dado" },
} as const;

type ChaveSituacao = keyof typeof SITUACOES;

/**
 * TRATAMENTO VISUAL — "prancha de arquiteto".
 *
 * Por que NÃO é mais verde/vermelho chapado:
 *
 * 1. A planta do Garden não é um desenho neutro: é uma peça de venda, com a FOTO renderizada do
 *    loteamento e, impressos nela, o número do lote, a metragem ("420,00m²") e as cotas. Pintar
 *    317 de 406 lotes de vermelho a 45% apagava tudo isso e virava mancha.
 * 2. A própria planta JÁ usa discos vermelhos, verdes e azuis nos números dos lotes — é a
 *    situação CONGELADA no dia em que a imagem foi renderizada, e ela não bate com o C2X de
 *    hoje. Repintar de verde/vermelho por cima faria o corretor (e o cliente ao lado) lerem os
 *    discos impressos como se fossem a nossa resposta. Vermelho e verde estão QUEIMADOS nesta
 *    imagem: por isso o estado atual fala por traço e textura, não pela cor dos discos.
 *
 * Como cada estado é dito, então:
 *
 * • DISPONÍVEL não recebe tinta NENHUMA — é o único lote com a fotografia 100% crua, e por isso
 *   o mais vivo do mapa. Ele é marcado por FORA: fio champagne fino assentado sobre um halo
 *   escuro (o halo existe porque as divisas e os meios-fios da planta já são linhas brancas, e
 *   sem ele o fio se dissolveria no arruamento) mais cantoneiras de prancha nos vértices, que
 *   dão peso no zoom-out sem engordar o traço.
 * • INDISPONÍVEL continua ACESO: nada é apagado, escurecido nem borrado. Leva (a) uma velatura
 *   de cinza MÉDIO, que puxa a cor pro neutro sem mexer no brilho — dessatura ~20% e a
 *   luminância praticamente não anda, então grama, árvores, sombras, números e cotas seguem
 *   todos lá — e (b) uma hachura fina de desenho técnico, que é o que sobrevive a projetor de
 *   stand com lâmpada gasta, onde saturação é a primeira coisa a morrer.
 * • SEM DADO fica com a foto intacta e um fio tracejado neutro: ausência de dado não é situação,
 *   então não ganha nem realce nem recuo.
 *
 * Números em unidades do viewBox (2396 x 2160) quando escalam com o zoom; larguras de traço são
 * `non-scaling-stroke`, ou seja, px de tela.
 */
const PRANCHA = {
  disponivel: {
    // Cantoneira de prancha: um "L" curto em cada vértice. É o que faz o lote livre ser achado
    // no zoom-out sem precisar engrossar o contorno (traço grosso vira marquee de UI).
    cantoneira: { comprimentoMax: 21, cor: "#FFE9B0", fracaoAresta: 0.32, larguraPx: 3.2 },
    contorno: { cor: "#F2C972", larguraPx: 1.8, larguraPxHover: 3.2 },
    // Sombra sob o fio. Sem ela o champagne some no meio-fio branco da própria planta.
    halo: { cor: "#08150F", larguraPx: 4.4, opacidade: 0.5 },
  },
  hachura: {
    // Espaçamento em unidades do viewBox: de longe vira um véu de trama fina, de perto vira
    // traço de prancha. ~9% de área coberta — uma linha atravessando o "420,00m²" impresso não
    // tira a leitura dele, e é traço, e não croma, que sobrevive a projetor de lâmpada gasta.
    espacamento: 13,
    tracoCor: "#0B1220",
    tracoLarguraPx: 1.05,
    tracoOpacidade: 0.28,
    // Cinza médio LEVEMENTE FRIO. Medido sobre a grama da planta: dessatura 29% e a luminância
    // anda 0,8% (23,5 -> 22,7), ou seja o lote vendido continua com o MESMO brilho da foto —
    // o que sai é só a cor, que é o "recuo atmosférico". Cinza claro clarearia e comeria o
    // contraste do texto branco impresso; cinza escuro escureceria, que é o que reprovou a
    // versão anterior. O teto é o texto: acima de ~0,30 a metragem impressa começa a apagar.
    velatura: "rgba(120, 127, 136, 0.26)",
  },
  hover: {
    indisponivel: { cor: "#0B1220", larguraPx: 2.2, opacidade: 0.85 },
  },
  semDado: {
    contorno: { cor: "#DCE2EA", larguraPx: 1.6, opacidade: 0.85, tracejado: "7 5" },
    halo: { cor: "#08150F", larguraPx: 4, opacidade: 0.4 },
  },
} as const;

const ID_HACHURA = "mp-hachura";

// CSS do SVG montado a partir do PRANCHA (não repetir número entre token e folha de estilo).
// Hover mexe só em traço: o miolo do lote nunca é tocado, nem no disponível nem no vendido.
const CSS_MAPA = `
.mp-lote { pointer-events: all; transition: stroke 140ms ease, stroke-width 140ms ease, stroke-opacity 140ms ease; }
.mp-indisponivel { stroke: ${PRANCHA.hover.indisponivel.cor}; stroke-opacity: 0; stroke-width: 0; }
.mp-indisponivel:hover { stroke-opacity: ${PRANCHA.hover.indisponivel.opacidade}; stroke-width: ${PRANCHA.hover.indisponivel.larguraPx}; }
.mp-disponivel:hover { stroke: ${PRANCHA.disponivel.cantoneira.cor}; stroke-width: ${PRANCHA.disponivel.contorno.larguraPxHover}; }
.mp-semdado:hover { stroke-opacity: 1; stroke-width: 2.4; }
@media (prefers-reduced-motion: reduce) { .mp-lote { transition: none; } }
`;

/**
 * MOLDURA. O mapa é material de venda: o corretor abre num telão com o cliente do lado, e o
 * print dele circula. Por isso a aba não termina no corte da imagem — ela tem cabeçalho com a
 * identidade do empreendimento, faixa de legenda e rodapé tipográfico, como um board impresso.
 * Claro = papel; escuro = grafite. Classes juntas aqui pra não espalhar cor solta na JSX.
 */
const MOLDURA = {
  cabecalho: "flex flex-wrap items-end justify-between gap-4 px-5 pt-4",
  corpo:
    "relative mt-3 overflow-auto border-y border-black/10 bg-[#0E1216] dark:border-white/10 dark:bg-[#05080A]",
  eyebrow: "text-[9px] font-semibold uppercase tracking-[0.28em] text-ink-muted",
  legendaFaixa: "flex flex-wrap items-center gap-x-5 gap-y-2 px-5 pt-3",
  peca:
    "overflow-hidden rounded-2xl border border-[#E3DFD6] bg-[#FBFAF7] shadow-[0_1px_2px_rgba(16,24,40,0.04),0_18px_40px_-24px_rgba(16,24,40,0.35)] dark:border-white/10 dark:bg-[#0D1014] dark:shadow-[0_1px_2px_rgba(0,0,0,0.4),0_18px_40px_-24px_rgba(0,0,0,0.8)]",
  rodape:
    "flex flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-3 text-[9px] font-semibold uppercase tracking-[0.22em] text-ink-muted",
  titulo: "text-[15px] font-semibold uppercase leading-tight tracking-[0.2em] text-ink",
} as const;

// ÚNICO ponto que traduz balde do C2X -> situação. Não repetir esse ternário na JSX.
function situacaoDoLote(bucket: ApoloEnterpriseBucket | undefined): ChaveSituacao {
  if (!bucket) {
    return "semDado";
  }

  return bucket === "disponivel" ? "disponivel" : "indisponivel";
}

/**
 * Plantas já vetorizadas, por código C2X do empreendimento. Só o Garden tem polígonos hoje;
 * os outros 23 caem no estado vazio até alguém gerar o JSON deles.
 *
 * Os dois arquivos vivem em `public/` de propósito: são baixados SOB DEMANDA quando a aba abre
 * (a planta tem 2 MB e o JSON 45 KB). Se fossem `import`, entrariam no bundle da página inteira.
 */
const PLANTAS: Record<string, { imagem: string; lotes: string }> = {
  GDN: {
    imagem: "/masterplan/garden-planta.jpg",
    lotes: "/masterplan/garden-lotes.json",
  },
};

// Formato do JSON gerado pelo Lucas. `lote` vem null no polígono cuja numeração ainda não saiu.
type LotePoligono = {
  id: string;
  lote: string | null;
  pontos: number[][];
  quadra: string | null;
};

type MasterplanLotes = {
  altura: number;
  largura: number;
  lotes: LotePoligono[];
  viewBox: string;
};

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const ZOOM_PASSO = 0.5;

// Quantos códigos a faixa de divergência lista antes de resumir. Nomear os códigos é o que
// permite separar um problema de verdade (lote no desenho que não existe no C2X) de uma
// pendência conhecida (o polígono cuja numeração ainda não saiu).
const MAX_CODIGOS_NO_AVISO = 6;

/**
 * Caches em memória do módulo (vivem enquanto a aba do navegador estiver aberta).
 *
 * Sem eles, cada ida e volta "Mapa -> Unidades -> Mapa" refazia a consulta ao C2X, que tem
 * subconsulta correlacionada por unidade. Não é polling (não existe timer nenhum aqui), mas é
 * carga evitável no RDS do legado.
 *
 * A planta é imutável (arquivo estático gerado uma vez) -> cache sem prazo.
 * A situação muda pouco, mas muda -> prazo curto, e uma visita depois do prazo relê.
 *
 * Guardam a PROMESSA, e não o resultado: duas montagens quase simultâneas (o StrictMode monta
 * duas vezes em dev; o usuário pulando Mapa -> Unidades -> Mapa faz o mesmo) dividem a MESMA
 * requisição em vez de dispararem duas. Falha apaga a entrada, pra a próxima visita retentar.
 */
const CACHE_PLANTA = new Map<string, Promise<MasterplanLotes>>();
const CACHE_UNIDADES = new Map<
  string,
  { em: number; promessa: Promise<ApoloEnterpriseUnit[]> }
>();
const VALIDADE_UNIDADES_MS = 60_000;

// Formatadores no módulo, e não dentro da função: instanciar `Intl.NumberFormat` é caro e o
// tooltip é montado 406 vezes. Ficavam 810 formatadores por render.
const FORMATO_AREA = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const FORMATO_MOEDA = new Intl.NumberFormat("pt-BR", {
  currency: "BRL",
  maximumFractionDigits: 0,
  style: "currency",
});

function MapaTabBase({ row }: { row: ApoloEnterpriseRow }) {
  // O empreendimento pode ter mais de um código (produto consolidado): usa o primeiro que
  // tenha planta desenhada.
  const codigoComPlanta = row.codes.find((code) => code in PLANTAS) ?? null;
  const planta = codigoComPlanta ? PLANTAS[codigoComPlanta] : null;

  const [mapa, setMapa] = useState<MasterplanLotes | null>(null);
  const [units, setUnits] = useState<ApoloEnterpriseUnit[] | null>(null);
  // Erro da PLANTA derruba a tela (sem desenho não há mapa).
  const [erroPlanta, setErroPlanta] = useState<string | null>(null);
  // Erro das UNIDADES não derruba: o desenho aparece cinza e a faixa avisa. O C2X fora do ar
  // não pode custar ao corretor até a visão da planta.
  const [erroUnidades, setErroUnidades] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    // Trocou de empreendimento: o estado do anterior MORRE aqui. O componente não desmonta na
    // troca de ficha (o React reconcilia <MapaTab row={row} /> pela posição na árvore), então
    // sem esta limpeza o mapa e as cores do empreendimento A ficariam sob o cabeçalho do B até
    // o fetch do B responder — dado errado com cara de dado certo.
    setMapa(null);
    setUnits(null);
    setErroPlanta(null);
    setErroUnidades(null);
    setZoom(1);

    if (!planta || !codigoComPlanta) {
      return;
    }

    const arquivoLotes = planta.lotes;
    const codigo = codigoComPlanta;
    let ativo = true;

    // As duas cargas são INDEPENDENTES de propósito (nada de Promise.all): a planta não depende
    // do C2X pra nada. Em série, o JPG de 2 MB só começava a baixar depois da consulta pesada ao
    // legado, e as duas esperas somavam em vez de se sobrepor.
    async function carregarPlanta() {
      let promessa = CACHE_PLANTA.get(arquivoLotes);

      if (!promessa) {
        promessa = buscarPlanta(arquivoLotes);
        CACHE_PLANTA.set(arquivoLotes, promessa);
        promessa.catch(() => CACHE_PLANTA.delete(arquivoLotes));
      }

      try {
        const desenho = await promessa;

        if (ativo) {
          setMapa(desenho);
        }
      } catch (falha) {
        if (ativo) {
          setErroPlanta(
            falha instanceof Error
              ? falha.message
              : "Não foi possível carregar a planta do empreendimento.",
          );
        }
      }
    }

    async function carregarUnidades() {
      const cacheada = CACHE_UNIDADES.get(codigo);
      let promessa = cacheada?.promessa;

      if (!cacheada || Date.now() - cacheada.em >= VALIDADE_UNIDADES_MS) {
        promessa = buscarUnidades(codigo);
        CACHE_UNIDADES.set(codigo, { em: Date.now(), promessa });
        promessa.catch(() => CACHE_UNIDADES.delete(codigo));
      }

      try {
        const lista = await (promessa as Promise<ApoloEnterpriseUnit[]>);

        if (ativo) {
          setUnits(lista);
        }
      } catch (falha) {
        if (ativo) {
          setErroUnidades(
            falha instanceof Error
              ? falha.message
              : "Não foi possível carregar a situação das unidades.",
          );
        }
      }
    }

    void carregarPlanta();
    void carregarUnidades();

    return () => {
      ativo = false;
    };
  }, [codigoComPlanta, planta]);

  /**
   * Casamento polígono <-> unidade + tudo que depende só do dado (pontos do SVG, cantoneiras e
   * texto do balão). Fica no useMemo pra o clique de zoom, que muda só o `style` do <svg>, não
   * refazer 406 strings de pontos e 406 tooltips.
   *
   * Tenta o código cru (GDN0101 dos dois lados) e, se não achar, a chave canônica quadra/lote —
   * porque `buildUnitCode` (lib/apolo/empreendimentos.ts) concatena block + lot SEM zerar à
   * esquerda: se o C2X guardar a quadra 1 como "1", o código vira "GDN11" e não bateria com o
   * polígono "GDN0101".
   */
  const resumo = useMemo(() => {
    if (!mapa) {
      return null;
    }

    const lista = units ?? [];
    const porCodigo = new Map(lista.map((unit) => [unit.code, unit]));
    // Chave vazia (unidade sem quadra/lote) fica DE FORA do índice: senão todo polígono sem
    // numeração casaria com ela. É o caso do "GDN10-SEM-NUMERO", que tem lote null.
    const porCanonico = new Map(
      lista
        .map((unit) => [chaveCanonica(unit.block, unit.lot), unit] as const)
        .filter(([chave]) => chave !== ""),
    );

    const casados = new Set<string>();

    const pintados = mapa.lotes.map((lote) => {
      const canonica = chaveCanonica(lote.quadra, lote.lote);
      const unit = porCodigo.get(lote.id) ?? (canonica ? porCanonico.get(canonica) : undefined);

      if (unit) {
        casados.add(unit.code);
      }

      const situacao = situacaoDoLote(unit?.bucket);

      return {
        // Só o lote livre gasta cantoneira — são 87 de 406.
        cantoneiras: situacao === "disponivel" ? cantoneirasDoPoligono(lote.pontos) : "",
        id: lote.id,
        pontos: lote.pontos.map(([x, y]) => `${x},${y}`).join(" "),
        situacao,
        titulo: textoTooltip(lote, unit, SITUACOES[situacao].rotulo),
      };
    });

    const contagem = { disponivel: 0, indisponivel: 0, semDado: 0 };

    for (const item of pintados) {
      contagem[item.situacao] += 1;
    }

    return {
      // Agrupado por situação só pra garantir a ORDEM de empilhamento no SVG (velatura embaixo,
      // halo no meio, fio champagne por cima). Mesmo conjunto, mesma contagem.
      camadas: {
        disponiveis: pintados.filter((item) => item.situacao === "disponivel"),
        indisponiveis: pintados.filter((item) => item.situacao === "indisponivel"),
        semDado: pintados.filter((item) => item.situacao === "semDado"),
      },
      contagem,
      pintados,
      // Divergência entre desenho e C2X, com os códigos NOMEADOS: sem o nome, ninguém sabe
      // qual é a pendência conhecida e qual é o lote que falta de verdade.
      semPoligono: lista.filter((unit) => !casados.has(unit.code)).map((unit) => unit.code),
      semUnidade: pintados
        .filter((item) => item.situacao === "semDado")
        .map((item) => item.id),
    };
  }, [mapa, units]);

  if (!planta) {
    const desenhados = Object.keys(PLANTAS);

    return (
      <div className="rounded-xl border border-line bg-subtle/50 p-8 text-center text-sm font-semibold text-ink-soft">
        Este empreendimento ainda não tem planta desenhada.
        <span className="mt-1 block text-xs font-medium">
          {desenhados.length === 1
            ? `Hoje só ${desenhados[0]} tem os lotes vetorizados.`
            : `Com lotes vetorizados hoje: ${desenhados.join(", ")}.`}
        </span>
      </div>
    );
  }

  if (erroPlanta) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
        {erroPlanta}
      </div>
    );
  }

  if (!mapa || !resumo) {
    return <div className="h-96 animate-pulse rounded-xl border border-line bg-subtle" />;
  }

  const carregandoSituacao = units === null && !erroUnidades;
  const local = [row.city, row.state].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-3">
      <figure className={MOLDURA.peca}>
        <header className={MOLDURA.cabecalho}>
          <div className="min-w-0">
            <p className={MOLDURA.eyebrow}>Masterplan</p>
            <h3 className={`${MOLDURA.titulo} mt-1.5 truncate`}>{row.name}</h3>
            <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.18em] text-ink-muted">
              {[local, row.code].filter(Boolean).join("  ·  ")}
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-full border border-black/10 bg-white/70 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] dark:border-white/10 dark:bg-white/5 dark:shadow-none">
            <BotaoZoom
              aoClicar={() => setZoom((atual) => Math.max(ZOOM_MIN, atual - ZOOM_PASSO))}
              desabilitado={zoom <= ZOOM_MIN}
              rotulo="Diminuir"
            >
              <Minus aria-hidden="true" className="size-3.5" />
            </BotaoZoom>
            <span className="min-w-11 text-center text-[11px] font-semibold tabular-nums tracking-wider text-ink-soft">
              {Math.round(zoom * 100)}%
            </span>
            <BotaoZoom
              aoClicar={() => setZoom((atual) => Math.min(ZOOM_MAX, atual + ZOOM_PASSO))}
              desabilitado={zoom >= ZOOM_MAX}
              rotulo="Ampliar"
            >
              <Plus aria-hidden="true" className="size-3.5" />
            </BotaoZoom>
            <BotaoZoom
              aoClicar={() => setZoom(1)}
              desabilitado={zoom === 1}
              rotulo="Ajustar à largura"
            >
              <RotateCcw aria-hidden="true" className="size-3.5" />
            </BotaoZoom>
          </div>
        </header>

        {/* A legenda vem ANTES do mapa porque é a primeira coisa que o corretor lê, e cada
            amostra é o desenho de verdade (mesmo fio, mesma hachura) e não um quadrado de cor. */}
        <div className={MOLDURA.legendaFaixa}>
          <ItemLegenda situacao="disponivel" total={resumo.contagem.disponivel} />
          <Divisor />
          <ItemLegenda situacao="indisponivel" total={resumo.contagem.indisponivel} />
          {resumo.contagem.semDado > 0 && (
            <>
              <Divisor />
              <ItemLegenda situacao="semDado" total={resumo.contagem.semDado} />
            </>
          )}
          {carregandoSituacao && (
            <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-muted">
              Lendo o C2X…
            </span>
          )}
        </div>

        {/* Quem rola é este container: no zoom 1 o SVG ocupa 100% da largura (cabe inteiro) e,
            ampliando, as barras de rolagem viram o "pan" do mapa. */}
        <div className={MOLDURA.corpo}>
          <svg
            className="block h-auto max-w-none"
            role="img"
            style={{ width: `${zoom * 100}%` }}
            viewBox={mapa.viewBox}
            xmlns="http://www.w3.org/2000/svg"
          >
            <title>Mapa de situação dos lotes</title>
            <defs>
              {/* UM padrão para os 317 indisponíveis: velatura + traço na mesma célula. Padrão
                  é barato (o ladrilho é rasterizado uma vez); 317 <filter> não seria. */}
              <pattern
                height={PRANCHA.hachura.espacamento}
                id={ID_HACHURA}
                patternTransform="rotate(45)"
                patternUnits="userSpaceOnUse"
                width={PRANCHA.hachura.espacamento}
              >
                <rect
                  fill={PRANCHA.hachura.velatura}
                  height={PRANCHA.hachura.espacamento}
                  width={PRANCHA.hachura.espacamento}
                  x={0}
                  y={0}
                />
                <line
                  stroke={PRANCHA.hachura.tracoCor}
                  strokeOpacity={PRANCHA.hachura.tracoOpacidade}
                  strokeWidth={PRANCHA.hachura.tracoLarguraPx}
                  x1={0}
                  x2={0}
                  y1={0}
                  y2={PRANCHA.hachura.espacamento}
                />
              </pattern>
            </defs>
            <style>{CSS_MAPA}</style>

            <image height={mapa.altura} href={planta.imagem} width={mapa.largura} x={0} y={0} />

            {/* 1) Recuo do indisponível. Nada é apagado: só a cor sai do caminho. */}
            <g>
              {resumo.camadas.indisponiveis.map((item) => (
                <polygon
                  className="mp-lote mp-indisponivel"
                  fill={`url(#${ID_HACHURA})`}
                  key={item.id}
                  points={item.pontos}
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{item.titulo}</title>
                </polygon>
              ))}
            </g>

            {/* 2) Halo escuro sob as marcas, pra o fio claro não sumir no meio-fio branco. */}
            <g fill="none" pointerEvents="none" vectorEffect="non-scaling-stroke">
              {resumo.camadas.disponiveis.map((item) => (
                <polygon
                  key={item.id}
                  points={item.pontos}
                  stroke={PRANCHA.disponivel.halo.cor}
                  strokeOpacity={PRANCHA.disponivel.halo.opacidade}
                  strokeWidth={PRANCHA.disponivel.halo.larguraPx}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {resumo.camadas.semDado.map((item) => (
                <polygon
                  key={item.id}
                  points={item.pontos}
                  stroke={PRANCHA.semDado.halo.cor}
                  strokeOpacity={PRANCHA.semDado.halo.opacidade}
                  strokeWidth={PRANCHA.semDado.halo.larguraPx}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </g>

            {/* 3) A marca do lote livre: fio + cantoneira. O miolo fica `transparent` (e não
                   `none`) porque é ele que recebe o mouse e devolve o balão. */}
            <g>
              {resumo.camadas.disponiveis.map((item) => (
                <g key={item.id}>
                  <polygon
                    className="mp-lote mp-disponivel"
                    fill="transparent"
                    points={item.pontos}
                    stroke={PRANCHA.disponivel.contorno.cor}
                    strokeWidth={PRANCHA.disponivel.contorno.larguraPx}
                    vectorEffect="non-scaling-stroke"
                  >
                    <title>{item.titulo}</title>
                  </polygon>
                  <path
                    d={item.cantoneiras}
                    fill="none"
                    pointerEvents="none"
                    stroke={PRANCHA.disponivel.cantoneira.cor}
                    strokeLinecap="butt"
                    strokeWidth={PRANCHA.disponivel.cantoneira.larguraPx}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ))}
              {resumo.camadas.semDado.map((item) => (
                <polygon
                  className="mp-lote mp-semdado"
                  fill="transparent"
                  key={item.id}
                  points={item.pontos}
                  stroke={PRANCHA.semDado.contorno.cor}
                  strokeDasharray={PRANCHA.semDado.contorno.tracejado}
                  strokeOpacity={PRANCHA.semDado.contorno.opacidade}
                  strokeWidth={PRANCHA.semDado.contorno.larguraPx}
                  vectorEffect="non-scaling-stroke"
                >
                  <title>{item.titulo}</title>
                </polygon>
              ))}
            </g>
          </svg>
        </div>

        <figcaption className={MOLDURA.rodape}>
          <span>Situação das unidades · Fonte C2X</span>
          <span className="tabular-nums">{resumo.pintados.length} lotes</span>
        </figcaption>
      </figure>

      {erroUnidades && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          {erroUnidades} O desenho está aí, mas sem as cores de situação.
        </p>
      )}

      {!carregandoSituacao &&
        !erroUnidades &&
        (resumo.semUnidade.length > 0 || resumo.semPoligono.length > 0) && (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
            {resumo.semUnidade.length > 0 &&
              `${resumo.semUnidade.length} lote(s) desenhados sem unidade correspondente no C2X: ${listarCodigos(resumo.semUnidade)}. `}
            {resumo.semPoligono.length > 0 &&
              `${resumo.semPoligono.length} unidade(s) do C2X sem polígono no mapa: ${listarCodigos(resumo.semPoligono)}.`}
          </p>
        )}
    </div>
  );
}

/**
 * `memo` com comparador explícito: o único dado que a aba lê de `row` é a lista de códigos.
 * Sem isso, qualquer re-render de ancestral (o `useRefetchOnFocus` do ApoloPage dispara a cada
 * volta pra aba do navegador) refazia os 406 polígonos à toa.
 */
export const MapaTab = memo(
  MapaTabBase,
  (anterior, proximo) => anterior.row.codes.join(",") === proximo.row.codes.join(","),
);

function Divisor() {
  return <span aria-hidden="true" className="h-6 w-px bg-black/10 dark:bg-white/10" />;
}

/**
 * Item da legenda. A amostra NÃO é um quadrado de cor: é o próprio desenho do mapa em miniatura
 * (mesmo fio champagne, mesma cantoneira, mesma hachura, sobre um verde de grama). Quem lê a
 * legenda já sabe procurar exatamente aquilo lá em cima.
 */
function ItemLegenda({ situacao, total }: { situacao: ChaveSituacao; total: number }) {
  const { descricao, rotulo } = SITUACOES[situacao];

  return (
    <span className="inline-flex items-center gap-2.5" title={`${rotulo}: ${descricao}`}>
      <AmostraLegenda situacao={situacao} />
      <span className="flex flex-col leading-none">
        <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-ink-muted">
          {rotulo}
        </span>
        <span className="mt-1 text-[17px] font-semibold tabular-nums leading-none text-ink">
          {total}
        </span>
      </span>
    </span>
  );
}

// Miniatura 44x28 do tratamento real, desenhada com os mesmos tokens do mapa.
function AmostraLegenda({ situacao }: { situacao: ChaveSituacao }) {
  const idGrama = `mp-amostra-grama-${situacao}`;
  const idHachura = `mp-amostra-hachura-${situacao}`;

  return (
    <svg
      aria-hidden="true"
      className="h-7 w-11 shrink-0 rounded-[3px] ring-1 ring-black/15 dark:ring-white/20"
      viewBox="0 0 44 28"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={idGrama} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#8FA257" />
          <stop offset="1" stopColor="#6E8240" />
        </linearGradient>
        <pattern height="6.5" id={idHachura} patternTransform="rotate(45)" patternUnits="userSpaceOnUse" width="6.5">
          <rect fill={PRANCHA.hachura.velatura} height="6.5" width="6.5" x={0} y={0} />
          <line
            stroke={PRANCHA.hachura.tracoCor}
            strokeOpacity={PRANCHA.hachura.tracoOpacidade}
            strokeWidth={0.6}
            x1={0}
            x2={0}
            y1={0}
            y2={6.5}
          />
        </pattern>
      </defs>

      <rect fill={`url(#${idGrama})`} height={28} width={44} x={0} y={0} />

      {situacao === "indisponivel" && (
        <rect fill={`url(#${idHachura})`} height={28} width={44} x={0} y={0} />
      )}

      {situacao === "disponivel" && (
        <>
          <rect
            fill="none"
            height={20}
            stroke={PRANCHA.disponivel.halo.cor}
            strokeOpacity={PRANCHA.disponivel.halo.opacidade}
            strokeWidth={3}
            width={34}
            x={5}
            y={4}
          />
          <rect
            fill="none"
            height={20}
            stroke={PRANCHA.disponivel.contorno.cor}
            strokeWidth={1.2}
            width={34}
            x={5}
            y={4}
          />
          <path
            d="M5,11 L5,4 L12,4 M32,4 L39,4 L39,11 M39,17 L39,24 L32,24 M12,24 L5,24 L5,17"
            fill="none"
            stroke={PRANCHA.disponivel.cantoneira.cor}
            strokeWidth={2.2}
          />
        </>
      )}

      {situacao === "semDado" && (
        <rect
          fill="none"
          height={20}
          stroke={PRANCHA.semDado.contorno.cor}
          strokeDasharray="4 3"
          strokeOpacity={PRANCHA.semDado.contorno.opacidade}
          strokeWidth={1.4}
          width={34}
          x={5}
          y={4}
        />
      )}
    </svg>
  );
}

function BotaoZoom({
  aoClicar,
  children,
  desabilitado,
  rotulo,
}: {
  aoClicar: () => void;
  children: React.ReactNode;
  desabilitado: boolean;
  rotulo: string;
}) {
  return (
    <button
      aria-label={rotulo}
      className="inline-flex size-7 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-black/5 hover:text-ink disabled:opacity-30 dark:hover:bg-white/10 motion-reduce:transition-none"
      disabled={desabilitado}
      onClick={aoClicar}
      title={rotulo}
      type="button"
    >
      {children}
    </button>
  );
}

/**
 * Cantoneiras de prancha: um "L" curto em cada vértice do polígono, feito de duas pernas que
 * correm sobre as próprias arestas. Cada perna tem 30% da aresta, com teto, pra que lote
 * estreito não vire contorno fechado e lote largo não ganhe uma perna desproporcional.
 *
 * Vale pra polígono de qualquer número de lados: 404 dos 406 lotes do Garden são retângulos,
 * mas 2 não são.
 */
const CANTONEIRA = PRANCHA.disponivel.cantoneira;

function cantoneirasDoPoligono(pontos: number[][]): string {
  const total = pontos.length;

  if (total < 3) {
    return "";
  }

  const pernas: string[] = [];

  for (let i = 0; i < total; i += 1) {
    const vertice = pontos[i];
    const anterior = pontos[(i - 1 + total) % total];
    const proximo = pontos[(i + 1) % total];

    if (!vertice || !anterior || !proximo) {
      continue;
    }

    pernas.push(pernaDaCantoneira(vertice, anterior), pernaDaCantoneira(vertice, proximo));
  }

  return pernas.filter(Boolean).join(" ");
}

function pernaDaCantoneira(vertice: number[], vizinho: number[]): string {
  const [x, y] = vertice;
  const [vx, vy] = vizinho;

  if (x === undefined || y === undefined || vx === undefined || vy === undefined) {
    return "";
  }

  const dx = vx - x;
  const dy = vy - y;
  const comprimento = Math.hypot(dx, dy);

  if (comprimento < 1) {
    return "";
  }

  const fatia =
    Math.min(CANTONEIRA.comprimentoMax, comprimento * CANTONEIRA.fracaoAresta) / comprimento;

  return `M${arredondar(x)},${arredondar(y)}L${arredondar(x + dx * fatia)},${arredondar(y + dy * fatia)}`;
}

// Uma casa decimal já é sub-pixel num viewBox de 2396 e corta ~40% do tamanho do atributo `d`.
function arredondar(valor: number): number {
  return Math.round(valor * 10) / 10;
}

// Tooltip nativo do SVG (<title>): sem clique, sem biblioteca. A quebra de linha é respeitada
// pelo balão do navegador.
function textoTooltip(
  lote: LotePoligono,
  unit: ApoloEnterpriseUnit | undefined,
  rotuloSituacao: string,
): string {
  const linhas: string[] = [lote.id];

  if (lote.quadra) {
    linhas.push(lote.lote ? `Quadra ${lote.quadra} · Lote ${lote.lote}` : `Quadra ${lote.quadra}`);
  }

  if (!unit) {
    // Inclui o polígono cuja numeração ainda não saiu: não inventa lote nem situação.
    linhas.push("Sem dado no C2X");

    return linhas.join("\n");
  }

  if (unit.area !== null) {
    linhas.push(`${FORMATO_AREA.format(unit.area)} m²`);
  }

  linhas.push(FORMATO_MOEDA.format(unit.price));
  // Mostra o status real do C2X (e não só "indisponível"), pro corretor saber o motivo.
  linhas.push(unit.status || rotuloSituacao);

  return linhas.join("\n");
}

// Polígonos da planta: arquivo estático em public/, sem nada do C2X no caminho.
async function buscarPlanta(arquivo: string): Promise<MasterplanLotes> {
  const resposta = await fetch(arquivo, { cache: "force-cache" });

  if (!resposta.ok) {
    throw new Error("Não foi possível carregar a planta do empreendimento.");
  }

  const desenho = (await resposta.json()) as MasterplanLotes;

  if (!Array.isArray(desenho.lotes)) {
    throw new Error("A planta do empreendimento veio em formato inesperado.");
  }

  return desenho;
}

// Situação das unidades, direto do C2X (read-only).
async function buscarUnidades(codigo: string): Promise<ApoloEnterpriseUnit[]> {
  const accessToken = await getApoloAccessToken();
  const resposta = await fetch(
    `/api/apolo/empreendimentos/unidades?codes=${encodeURIComponent(codigo)}`,
    { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } },
  );

  // `.ok` ANTES de `.json()`: um 502 do gateway devolve HTML, e o parser estourando vazaria
  // "Unexpected token '<'" pro usuário no lugar de uma frase em português.
  if (!resposta.ok) {
    throw new Error(await mensagemDeErro(resposta));
  }

  const payload = (await resposta.json()) as { data?: { units: ApoloEnterpriseUnit[] } };

  if (!payload.data) {
    throw new Error("Não foi possível carregar a situação das unidades.");
  }

  return payload.data.units;
}

/**
 * Mensagem de uma resposta que NÃO veio ok. Lê o corpo dentro de try porque a resposta de erro
 * nem sempre é JSON: gateway devolvendo 502/504 manda HTML, e aí o parser estoura. O usuário
 * precisa ler uma frase em português, não "Unexpected token '<'".
 */
async function mensagemDeErro(resposta: Response): Promise<string> {
  const padrao = "Não foi possível carregar a situação das unidades.";

  try {
    const corpo = (await resposta.json()) as { error?: string };

    return corpo.error ?? padrao;
  } catch {
    return padrao;
  }
}

// Lista de códigos da faixa de divergência, cortada pra não virar um parágrafo.
function listarCodigos(codigos: string[]): string {
  if (codigos.length <= MAX_CODIGOS_NO_AVISO) {
    return codigos.join(", ");
  }

  return `${codigos.slice(0, MAX_CODIGOS_NO_AVISO).join(", ")} e mais ${codigos.length - MAX_CODIGOS_NO_AVISO}`;
}

/**
 * Chave "quadra+lote" normalizada, usada só como 2ª tentativa de casamento.
 *
 * A LETRA da quadra é PRESERVADA de propósito. Empreendimento que usa prefixo ("C02" = casa,
 * "L02" = lote) tem unidades diferentes com o mesmo número: no LBR existem 33 pares assim, e em
 * 10 deles as duas unidades têm situação OPOSTA. Jogando a letra fora, as duas viravam a mesma
 * chave, o `new Map` ficava com a última e o mapa pintaria verde um lote vermelho.
 * No lote a letra continua sendo descartada, pra acompanhar `buildUnitCode`, que tira o "L".
 *
 * Devolve string vazia quando falta quadra ou lote — e chave vazia nunca casa com nada.
 */
function chaveCanonica(quadra: string | null, lote: string | null): string {
  const bruta = (quadra ?? "").trim().toUpperCase();
  const letrasQuadra = bruta.replace(/[^A-Z]/g, "");
  const numeroQuadra = bruta.replace(/\D/g, "");
  const numeroLote = (lote ?? "").replace(/\D/g, "");

  if (!numeroQuadra || !numeroLote) {
    return "";
  }

  return `${letrasQuadra}${numeroQuadra.padStart(2, "0")}${numeroLote.padStart(2, "0")}`;
}
