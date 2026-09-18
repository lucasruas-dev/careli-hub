"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { LoteDoEspelho } from "@/lib/hercules/espelho/estado-do-espelho";
import type { PlanoPublico } from "@/lib/hercules/espelho/planos-publicos";
import type { PlanoDaVenda } from "@/lib/hercules/fluxo-de-venda";
import { MapaDeLotes } from "@/modules/espelho/MapaDeLotes";
import {
  type CondicoesDaProposta,
  SimuladorDeProposta,
} from "@/modules/incorporador/hercules/SimuladorDeProposta";
import { TEMA_CSS } from "@/modules/incorporador/tema";
import type { SituacaoPublica } from "@/lib/hercules/espelho/situacao-publica";

// O ESPELHO PÚBLICO — o mapa de lotes visto por quem recebeu o link.
//
// Lucas (09/09/2026): *"para esse publico são duas cores, azul para bloqueado vendido, reserva,
// proposta, contrato) e verde para disponivel"* · *"pode dar as duas opções também para o
// publico, a grade e o espelho"* · *"tem que comunicar com nosso processo, reservou, proposta,
// tem que refletir no espelho"*. E em 10/09: *"os que não tiverem espelho vão ter a grade"*.
//
// ⚠️ DUAS CORES, E SÓ. Aqui não entra a paleta por status (`lib/hercules/cores-de-situacao.ts`,
// cinco estados) nem a por etapa da Mesa de Venda (nove). Aquelas são o espelho INTERNO, para
// quem trabalha o funil. Para quem está de fora existe uma pergunta só: dá para comprar?
//
// ⚠️ E NÃO EXISTE DIVISÃO INTERNA AQUI. O mapa é do loteamento inteiro; VOC, VOL e VOR são
// recortes de conta, não lugares ([[feedback_corretor_nao_ve_divisao_interna]]).

// ⚠️ ESTAS SÃO AS CORES DO ESPELHO DO C2X, MEDIDAS — não escolhidas. Lucas (10/09/2026) apontou
// `https://sistema.careli.adm.br/show_map/35` e disse *"esse é o padrão"*. Lidas no
// `getComputedStyle` dos 298 paths daquela página: azul `rgb(5,68,255)` e verde `rgb(57,143,25)`,
// os dois com `fill-opacity: 0.6` e `stroke: none`.
//
// Três detalhes que só aparecem medindo, e que a primeira versão errou:
//   • o VERDE é oliva, não o verde-menta do Tailwind — ele convive com a grama da planta;
//   • a opacidade é 0.6, e não os 0.44 dos masterplans internos (aqueles são desenho vetorial
//     claro, esta arte é foto aérea escura);
//   • NÃO HÁ CONTORNO. O traço branco que eu tinha posto engrossava a malha e, no zoom de longe,
//     transformava as quadras num quadriculado — a planta já traz a divisa desenhada.
const OPACIDADE = 0.6;
const VERDE = "rgb(57, 143, 25)";
const AZUL = "rgb(5, 68, 255)";

/** A cor cheia, para as bolinhas da legenda e os quadradinhos da grade. */
const VERDE_CHEIO = "rgb(57, 143, 25)";
const AZUL_CHEIO = "rgb(5, 68, 255)";

export type TemaDoEspelho = "claro" | "escuro";

/**
 * ⚠️ OS DOIS TEMAS, E O CLARO NÃO É O ESCURO INVERTIDO. Lucas (10/09/2026): *"o tema tem que ter
 * os dois, escuro e claro"*. O link chega por WhatsApp e abre no aparelho de um cliente que pode
 * estar com o celular no claro, na rua, no sol — e uma página que ignora isso aparece como um
 * bloco preto no meio de um sistema claro.
 *
 * As cores dos LOTES (verde e azul) são as mesmas nos dois: elas carregam significado, e trocar
 * a tinta por tema faria a mesma informação ter duas aparências. O que muda é a moldura.
 *
 * Vai por variável CSS, e não por objeto de estilo duplicado: são ~40 propriedades inline neste
 * arquivo, e manter duas cópias delas em sincronia é o tipo de coisa que diverge no primeiro
 * ajuste.
 */
const CSS_DO_TEMA = `
[data-esp-tema="escuro"] {
  --esp-fundo: #0b0d11;
  --esp-superficie: #12151b;
  --esp-campo: rgba(0, 0, 0, .25);
  --esp-texto: #e8eaee;
  --esp-suave: #a8adb8;
  --esp-borda: rgba(255, 255, 255, .12);
  --esp-borda-forte: rgba(255, 255, 255, .18);
  --esp-realce: rgba(255, 255, 255, .08);
  --esp-selecao: #ffffff;
}
[data-esp-tema="claro"] {
  --esp-fundo: #f4f5f7;
  --esp-superficie: #ffffff;
  --esp-campo: #ffffff;
  --esp-texto: #16191f;
  --esp-suave: #5c6472;
  --esp-borda: rgba(15, 23, 42, .14);
  --esp-borda-forte: rgba(15, 23, 42, .22);
  --esp-realce: rgba(15, 23, 42, .05);
  --esp-selecao: #0f172a;
}
`;

/** A chave do tema no aparelho de quem abriu. Por artefato, para dois links não brigarem. */
/**
 * ⚠️ A IMPRESSÃO É O CAMINHO PARA O PDF, e não uma biblioteca. Lucas (10/09/2026): *"coloca um
 * botão para imprimir essa simulação, para que o corretor possa encaminhar (...) clica, salva um
 * pdf na maquina do usuario"*. `window.print()` abre o diálogo do próprio navegador, onde
 * "Salvar como PDF" já existe em todos eles — no Android e no iPhone também. Um gerador de PDF
 * no cliente custaria centenas de KB numa página que o cliente abre no 4G, para reproduzir o que
 * o sistema operacional já faz melhor.
 *
 * O que sai na folha: só a simulação do lote escolhido. O mapa, a grade e o cabeçalho saem
 * porque o papel não navega; o botão de reajuste sai porque *"essa pode vir sem o fluxo de
 * reajuste"* — o corretor decide se mostra aquilo, e o que ele encaminha não pode decidir por ele.
 */
const CSS_DE_IMPRESSAO = `
@media print {
  [data-esp-print="fora"] { display: none !important; }

  /* ⚠️ O OVERLAY PERDE O FUNDO. Ele é preto translúcido na tela, e no papel virava uma faixa
     escura na lateral — foi o "ficou ruim" do Lucas em 10/09/2026. */
  [data-esp-print="folha"] {
    background: #fff !important;
    border: 0 !important;
    box-shadow: none !important;
    color: #111 !important;
    inset: auto !important;
    /* ⚠️ E O FLEX TEM DE SAIR. Na tela o pop-up é uma coluna flex de altura fixa, para o
       simulador rolar por dentro; no papel isso prendia o conteúdo numa altura de tela e deixava
       meia página em branco embaixo. */
    display: block !important;
    height: auto !important;
    max-height: none !important;
    max-width: none !important;
    overflow: visible !important;
    padding: 0 !important;
    position: static !important;
  }

  [data-esp-tema] {
    background: #fff !important;
    color: #111 !important;
    display: block !important;
    height: auto !important;
    overflow: visible !important;
  }

  /* O papel não tem tema escuro: os tokens viram tinta sobre branco. */
  [data-esp-tema] * { color: #111 !important; }

  /* O simulador rola por dentro na tela; no papel ele se abre inteiro. */
  [data-esp-tema] .inc,
  [data-esp-tema] .inc * {
    height: auto !important;
    max-height: none !important;
    overflow: visible !important;
  }

  /* Cada bloco do simulador evita rachar no meio entre duas páginas. */
  [data-esp-tema] .inc > * { break-inside: avoid; }

  @page { margin: 12mm; }
}
`;

const CHAVE_DO_TEMA = "espelho:tema";

function useTema(): [TemaDoEspelho, (t: TemaDoEspelho) => void] {
  // Nasce no escuro e corrige no cliente: o servidor não sabe a preferência do aparelho, e
  // adivinhar aqui faria a página piscar de um tema para o outro na primeira pintura.
  const [tema, setTema] = useState<TemaDoEspelho>("escuro");

  useEffect(() => {
    let inicial: TemaDoEspelho | null = null;
    try {
      const salvo = localStorage.getItem(CHAVE_DO_TEMA);
      if (salvo === "claro" || salvo === "escuro") inicial = salvo;
    } catch {
      // Navegador com armazenamento bloqueado (anônimo, iOS com cookies off): segue o aparelho.
      inicial = null;
    }
    setTema(
      inicial ??
        (window.matchMedia("(prefers-color-scheme: light)").matches ? "claro" : "escuro"),
    );
  }, []);

  const trocar = useCallback((t: TemaDoEspelho) => {
    setTema(t);
    try {
      localStorage.setItem(CHAVE_DO_TEMA, t);
    } catch {
      // Não poder lembrar não pode impedir de trocar agora.
    }
  }, []);

  return [tema, trocar];
}

type Estado = {
  atualizadoEm: string;
  contagem: Record<SituacaoPublica, number>;
  empreendimento: { codigo: string; nome: string };
  lotes: LoteDoEspelho[];
  /** Vazio = empreendimento sem plano cadastrado; o simulador não aparece. */
  planos: PlanoPublico[];
  temMapa: boolean;
};

type Geometria = {
  contornos: { codigo: string; d: string }[];
  viewBox: string;
};

/** Volta a pedir a situação de tempos em tempos: reserva e proposta mudam o mapa. */
const INTERVALO_MS = 60_000;

export function EspelhoPublico({
  erroInicial,
  inicial,
  token,
}: {
  erroInicial?: string;
  inicial?: Estado;
  token: string;
}) {
  const [estado, setEstado] = useState<Estado | undefined>(inicial);
  // O erro só nasce do servidor (link inválido): a tela não o troca depois.
  const [erro] = useState<null | string>(erroInicial ?? null);
  const [geometria, setGeometria] = useState<Geometria | null>(null);
  const [visao, setVisao] = useState<"espelho" | "grade">(
    inicial?.temMapa ? "espelho" : "grade",
  );
  const [escolhido, setEscolhido] = useState<LoteDoEspelho | null>(null);
  const [tema, trocarTema] = useTema();

  // ── A GEOMETRIA, uma vez só (é imutável e vem com cache de um ano) ────────────────
  useEffect(() => {
    if (!token || !estado?.temMapa) return;
    let vivo = true;

    fetch(`/api/publico/espelho/geometria?e=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((g: Geometria | null) => {
        // ⚠️ VAZIO NÃO É MAPA. `g?.contornos` aceita array vazio, e aí `temMapa` continua
        // verdadeiro e a tela mostra um palco com a foto aérea e nenhum lote clicável. Exigindo
        // pelo menos um contorno, ela cai na GRADE — que é a mesma informação, sem a planta.
        if (vivo && g?.contornos?.length) setGeometria(g);
      })
      .catch(() => {
        // Sem geometria o mapa não desenha, mas a GRADE continua — e ela tem a mesma informação.
        if (vivo) setGeometria(null);
      });

    return () => {
      vivo = false;
    };
  }, [estado?.temMapa, token]);

  // ── A SITUAÇÃO, de tempos em tempos ──────────────────────────────────────────────
  //
  // ⚠️ 60s, e não menos. A regra de custo da casa é explícita depois do incidente de fatura do
  // Hermes: não aumentar polling. Um link público pode ficar aberto o dia inteiro em muitos
  // aparelhos ao mesmo tempo, e cada volta é uma leitura no Supabase.
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => {
      fetch(`/api/publico/espelho/situacao?e=${encodeURIComponent(token)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((corpo: null | { data?: Estado }) => {
          // ⚠️ SÓ TROCA COM PAYLOAD. Resposta vazia ou falha não pode apagar o mapa que já está
          // na tela ([[reference_polling_sem_payload_apaga_tela]]).
          if (corpo?.data?.lotes) setEstado(corpo.data);
        })
        .catch(() => undefined);
    }, INTERVALO_MS);

    return () => clearInterval(id);
  }, [token]);

  const porCodigo = useMemo(
    () => new Map((estado?.lotes ?? []).map((l) => [l.codigo, l])),
    [estado?.lotes],
  );

  if (erro || !estado) {
    return (
      <main className="publico-shell" data-esp-tema={tema} style={ESTILO.vazio}>
        <style>{CSS_DO_TEMA + CSS_DE_IMPRESSAO}</style>
        <p style={{ margin: 0, opacity: 0.85 }}>{erro ?? "Carregando…"}</p>
      </main>
    );
  }

  const podeEspelho = estado.temMapa && geometria !== null;

  return (
    // ⚠️ `publico-shell` NÃO É ENFEITE (18/09/2026): o globals.css do hub tem `html { min-width:
    // 1024px }` (o hub é desktop), e sem a classe o celular desenhava esta página a 1024 px e a
    // encolhia; com o toque do mapa desligado, ficava "todo travado". Ver
    // [[reference_html_minwidth_quebra_mobile]] na memória: é a armadilha que mais volta.
    <main className="publico-shell" data-esp-tema={tema} style={ESTILO.pagina}>
      {/* O tema vale para a árvore inteira, inclusive o painel do lote, que é irmão do palco. */}
      <style>{CSS_DO_TEMA + CSS_DE_IMPRESSAO}</style>

      <Cabecalho
        contagem={estado.contagem}
        nome={estado.empreendimento.nome}
        podeEspelho={estado.temMapa}
        tema={tema}
        visao={visao}
        onTema={trocarTema}
        onVisao={setVisao}
      />

      <section data-esp-print="fora" style={ESTILO.palco}>
        {visao === "espelho" && podeEspelho ? (
          <Mapa
            escolhido={escolhido}
            geometria={geometria}
            porCodigo={porCodigo}
            token={token}
            onEscolher={setEscolhido}
          />
        ) : (
          <Grade
            escolhido={escolhido}
            lotes={estado.lotes}
            onEscolher={setEscolhido}
          />
        )}
      </section>

      {escolhido ? (
        <PainelDoLote
          lote={escolhido}
          nomeDoEmpreendimento={estado.empreendimento.nome}
          planos={estado.planos}
          token={token}
          onFechar={() => setEscolhido(null)}
        />
      ) : null}
    </main>
  );
}

// ── CABEÇALHO: nome, contagem, alternador e tela cheia ─────────────────────────────

function Cabecalho({
  contagem,
  nome,
  onTema,
  onVisao,
  podeEspelho,
  tema,
  visao,
}: {
  contagem: Record<SituacaoPublica, number>;
  nome: string;
  onTema: (t: TemaDoEspelho) => void;
  onVisao: (v: "espelho" | "grade") => void;
  podeEspelho: boolean;
  tema: TemaDoEspelho;
  visao: "espelho" | "grade";
}) {
  const [cheia, setCheia] = useState(false);
  // ⚠️ O BOTÃO SÓ EXISTE ONDE A API EXISTE. No iPhone a tela cheia de elemento comum não está
  // implementada: o botão ocupava a linha do cabeçalho sem fazer nada (18/09/2026).
  const [temTelaCheia, setTemTelaCheia] = useState(false);
  useEffect(() => {
    setTemTelaCheia(Boolean(document.fullscreenEnabled));
  }, []);

  // ⚠️ A FULLSCREEN API SÓ ATENDE DENTRO DE UM GESTO DO USUÁRIO, e o navegador pode sair sozinho
  // (Esc, F11, troca de aba). O `fullscreenchange` é a única fonte confiável do estado — guardar
  // um booleano só no clique deixa o botão mentindo depois do primeiro Esc.
  useEffect(() => {
    const sincronizar = () => setCheia(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", sincronizar);
    return () => document.removeEventListener("fullscreenchange", sincronizar);
  }, []);

  const alternarTelaCheia = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    // Falha silenciosa é o certo: iPhone não implementa a API em elemento comum, e a tela
    // continua perfeitamente utilizável sem ela.
    void document.documentElement.requestFullscreen().catch(() => undefined);
  }, []);

  return (
    <header data-esp-print="fora" style={ESTILO.cabecalho}>
      <div style={{ minWidth: 0 }}>
        <h1 style={ESTILO.titulo}>{nome}</h1>
        <p style={ESTILO.legenda}>
          <span style={{ ...ESTILO.bolinha, background: VERDE_CHEIO }} />
          {contagem.disponivel} {contagem.disponivel === 1 ? "disponível" : "disponíveis"}
          <span style={{ ...ESTILO.bolinha, background: AZUL_CHEIO, marginLeft: 12 }} />
          {contagem.indisponivel} indisponíveis
        </p>
      </div>

      <div style={ESTILO.acoes}>
        {podeEspelho ? (
          <div style={ESTILO.alternador}>
            {(["espelho", "grade"] as const).map((v) => (
              <button
                key={v}
                onClick={() => onVisao(v)}
                style={{
                  ...ESTILO.botaoAlternador,
                  ...(visao === v ? ESTILO.botaoAlternadorAtivo : null),
                }}
                type="button"
              >
                {v === "espelho" ? "Mapa" : "Grade"}
              </button>
            ))}
          </div>
        ) : null}

        <button
          aria-label={tema === "escuro" ? "Usar tema claro" : "Usar tema escuro"}
          onClick={() => onTema(tema === "escuro" ? "claro" : "escuro")}
          style={ESTILO.botao}
          title={tema === "escuro" ? "Tema claro" : "Tema escuro"}
          type="button"
        >
          {tema === "escuro" ? "☀" : "☾"}
        </button>

        {temTelaCheia ? (
          <button onClick={alternarTelaCheia} style={ESTILO.botao} type="button">
            {cheia ? "Sair da tela cheia" : "Tela cheia"}
          </button>
        ) : null}
      </div>
    </header>
  );
}

// ── O MAPA: o motor compartilhado, com as cores do público ──────────────────────────
//
// ⚠️ AQUI HAVIA UMA SEGUNDA CÓPIA DO MAPA, E ELA CUSTOU UM DEFEITO PUBLICADO. Até 14/09/2026 esta
// tela desenhava o próprio SVG, com o próprio zoom e o próprio arraste — 220 linhas que eram cópia
// literal de `modules/espelho/MapaDeLotes`, diferindo só nos nomes das variáveis. Naquela manhã o
// clique perdido no miolo do lote foi consertado NO MOTOR, e o changelog anunciou o conserto nesta
// tela: a Mesa de Venda passou a funcionar e o espelho público, que é onde o Lucas tinha visto o
// defeito e onde as medições foram feitas (89 de 97 lotes no Villa Paris, 190 de 250 no Jardim das
// Gerais), continuou exatamente como estava.
//
// Lucas, no mesmo dia: *"vamos parar de bater cabeça, antes de fazer algo, olha no hub se não temos
// isso já pronto"*. A cópia foi apagada.
//
// ⚠️ O QUE ESTA TELA TEM DE DIFERENTE ENTRA POR PROP, e é só isto — o resto era idêntico:
//
//   • a COR: duas, e não as nove etapas do funil da Mesa;
//   • o CLIQUE: devolve o lote inteiro, e `null` quando o contorno não tem cadastro;
//   • o CURSOR: seta, e não mãozinha, onde não há nada para abrir.

function Mapa({
  escolhido,
  geometria,
  onEscolher,
  porCodigo,
  token,
}: {
  escolhido: LoteDoEspelho | null;
  geometria: { contornos: { codigo: string; d: string }[]; viewBox: string };
  onEscolher: (l: LoteDoEspelho | null) => void;
  porCodigo: Map<string, LoteDoEspelho>;
  token: string;
}) {
  return (
    <MapaDeLotes
      // ⚠️ O `?? null` É O COMPORTAMENTO DE HOJE, E NÃO UM DESCUIDO. Clicar num contorno sem
      // cadastro FECHA o painel. A Mesa faz o contrário (ignora o clique), e copiar aquilo aqui
      // deixaria o corretor lendo preço e simulação do lote ANTERIOR achando que são do contorno
      // que ele acabou de tocar — na frente do cliente.
      aoClicar={(codigo) => onEscolher(porCodigo.get(codigo) ?? null)}
      clicavel={(codigo) => porCodigo.has(codigo)}
      // ⚠️ CONTORNO SEM LOTE NO CADASTRO SAI AZUL, NUNCA VERDE — e nunca transparente. Um lote sem
      // cor seria lido como disponível por quem olha, e sem cadastro não há como afirmar que está.
      // A função da Mesa devolve "transparent" para o que está fora do filtro de etapa; reusá-la
      // aqui pintaria de nada, sobre a foto aérea, o que ninguém conferiu.
      corDoLote={(codigo) =>
        porCodigo.get(codigo)?.situacao === "disponivel" ? VERDE : AZUL
      }
      // No celular, os botões de + e − somam-se à pinça: quem segura com uma mão não faz pinça.
      comControles
      destacado={escolhido?.codigo ?? null}
      geometria={geometria}
      // O padrão do motor já é 0.6, o mesmo OPACIDADE medido no espelho do C2X. Explícito porque é
      // número medido, não escolhido: ver o aviso das cores no topo deste arquivo.
      opacidade={OPACIDADE}
      urlDaArte={`/api/publico/espelho/arte?e=${encodeURIComponent(token)}`}
    />
  );
}

// ── A GRADE: o mesmo estoque sem a planta ──────────────────────────────────────────

function Grade({
  escolhido,
  lotes,
  onEscolher,
}: {
  escolhido: LoteDoEspelho | null;
  lotes: LoteDoEspelho[];
  onEscolher: (l: LoteDoEspelho) => void;
}) {
  // Agrupada por quadra, que é como o corretor fala do estoque. Lote sem quadra cai num grupo
  // próprio no fim, em vez de sumir.
  //
  // ⚠️ NO PRÉDIO O GRUPO É A TORRE (revisão de 16/09/2026). Apartamento não tem quadra: agrupar por
  // ela punha o prédio inteiro num grupo "Sem quadra" com quadradinhos vazios. O `grupo` já vem
  // pronto do estado do espelho ("Quadra 01", "Torre A", "Unidades"); a quadra crua só serve de
  // reserva para um payload antigo em cache.
  const quadras = useMemo(() => {
    const mapa = new Map<string, LoteDoEspelho[]>();
    for (const l of lotes) {
      const q = l.grupo || l.quadra?.trim() || "Sem quadra";
      mapa.set(q, [...(mapa.get(q) ?? []), l]);
    }
    return [...mapa.entries()];
  }, [lotes]);

  return (
    <div style={ESTILO.grade}>
      {/* ⚠️ ESTA GRADE É A DA MESA DE VENDA, PORTADA — não uma nova. Lucas (10/09/2026): *"achei
          ruim, grande a grade, podemos trabalhar com a grade que temos hoje no hercules, segue o
          que já está bom não precisa reinventar"*. As medidas vêm de
          `modules/incorporador/hercules/TelaVenda.tsx`: colunas de 140px (uma por quadra),
          seis quadradinhos por linha, `aspect-ratio 1/1.25`, gap de 3px e fonte 8.5. A minha
          primeira versão usava quadradinhos de 52px com gap 6 — cabiam poucos na tela e um
          loteamento de 495 lotes virava rolagem sem fim. */}
      <div style={ESTILO.gradeColunas}>
        {quadras.map(([quadra, doGrupo]) => (
          <div key={quadra}>
            <div style={ESTILO.tituloQuadra}>{quadra}</div>
            <div style={ESTILO.quadradinhos}>
              {doGrupo.map((l) => (
                <button
                  key={l.codigo}
                  onClick={() => onEscolher(l)}
                  style={{
                    ...ESTILO.quadradinho,
                    background: l.situacao === "disponivel" ? VERDE_CHEIO : AZUL_CHEIO,
                    outline:
                      escolhido?.codigo === l.codigo ? "2.5px solid var(--esp-selecao)" : undefined,
                  }}
                  title={`${l.rotulo || `${quadra} · Lote ${l.lote ?? l.codigo}`} · ${
                    l.situacao === "disponivel" ? "Disponível" : "Indisponível"
                  }`}
                  type="button"
                >
                  {/* O número do quadradinho: o lote, ou o apartamento no prédio. */}
                  {l.numero || l.lote || ""}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── O PAINEL DO LOTE: preço, metragem e simulação ──────────────────────────────────

function PainelDoLote({
  lote,
  nomeDoEmpreendimento,
  onFechar,
  planos,
  token,
}: {
  lote: LoteDoEspelho;
  nomeDoEmpreendimento: string;
  onFechar: () => void;
  planos: PlanoPublico[];
  token: string;
}) {
  const disponivel = lote.situacao === "disponivel";
  const preco = lote.preco ?? 0;

  // ⚠️ O MESMO SIMULADOR DA MESA DE VENDA, MONTADO AQUI — não uma segunda versão. Lucas
  // (10/09/2026): *"é usar o mesmo gerador de proposta e tratar as nomenclaturas"*. A primeira
  // tentativa foi uma versão reduzida (plano, entrada, parcela) e ele apontou o que faltava:
  // *"kd a parte do desconto, da parcela do cliente, anuais"*. Reimplementar aqui significaria
  // duas contas para a mesma pergunta, divergindo no primeiro ajuste — e a divergência apareceria
  // na frente do cliente, entre o que o site mostrou e o que o corretor apresenta.
  //
  // ⚠️ SEM `aoMudarCondicoes`, E É ISSO QUE TIRA O VENCIMENTO. A prop é opcional no componente, e
  // a ausência dela já esconde o dia de cobrança e a data da primeira parcela — Lucas: *"tira
  // essa coisa de vencimento (...) como é um simulador"*. Nada aqui gera proposta: não há a quem
  // mandar, e a página não tem sessão.
  //
  // ⚠️ E O TEMA VEM JUNTO. O simulador pinta com os tokens `--inc-*` do portal, que só existem
  // sob a classe `.inc`; sem o `TEMA_CSS` e a classe, ele apareceria sem cor nenhuma. É o mesmo
  // arranjo que a ficha do produto no Hércules já faz.
  const planosDaVenda: PlanoDaVenda[] = useMemo(
    () =>
      planos.map((p) => ({
        entradaPercentual: p.entradaPercentual,
        indiceCorrecao: p.indiceCorrecao,
        jurosConvencao: p.jurosConvencao,
        jurosPeriodicidade: p.jurosPeriodicidade,
        jurosTaxa: p.jurosTaxa,
        nome: p.nome,
        parcelas: p.parcelas,
        sistemaAmortizacao: p.sistemaAmortizacao,
        slot: null,
      })),
    [planos],
  );

  // ⚠️ O PRÉDIO SE NOMEIA PELA TORRE E PELO APARTAMENTO ("Torre A · Apto 304"), a mesma frase do
  // WhatsApp e do PDF. Quadra e lote vazios deixariam o simulador com o código cru.
  const vertical = lote.tipoProduto === "vertical";
  const nomeDoLote = vertical
    ? lote.rotulo
    : lote.quadra
      ? `${lote.quadra} ${lote.lote ?? ""}`.trim()
      : lote.codigo;

  // O que está na tela AGORA — é o que vai para o papel.
  const condicoes = useRef<CondicoesDaProposta | null>(null);
  const [baixando, setBaixando] = useState(false);

  /**
   * ⚠️ O PDF É MONTADO NO SERVIDOR, pelo MESMO gerador da proposta. Lucas (10/09/2026): *"monta
   * um arquivo bonito, simulador de proposta, meio que parecido com a proposta mesmo, com a logo
   * e tal"*. A primeira versão mandava a TELA para a impressora (`window.print()`), e o resultado
   * foi o que ele viu: meia página em branco e faixa preta na lateral. Agora sai a folha A4 de
   * verdade, com a logo do empreendimento e a marca do C2X — e com a tarja de prévia, que é o que
   * impede a simulação de circular como proposta.
   *
   * ⚠️ E O SERVIDOR NÃO ACEITA O PLANO QUE VAI DAQUI: manda-se o NOME, e as condições (juros,
   * índice, sistema) são lidas do cadastro lá dentro.
   */
  const baixarPdf = useCallback(async () => {
    const atual = condicoes.current;
    if (!atual || baixando) return;
    setBaixando(true);

    try {
      const resposta = await fetch(
        `/api/publico/espelho/simulacao?e=${encodeURIComponent(token)}`,
        {
          body: JSON.stringify({
            anuaisQuantidade: atual.anuaisQuantidade,
            anuaisValor: atual.anuaisValor,
            codigo: lote.codigo,
            entrada: atual.entradaValor,
            entradaVezes: atual.entradaVezes,
            parcelas: atual.parcelasMensais,
            plano: atual.planoNome,
            valor: atual.valorNegociado,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );
      if (!resposta.ok) return;

      // O nome do arquivo vem no Content-Disposition da resposta; o <a download> o respeita.
      const blob = await resposta.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = nomeDoArquivo(nomeDoEmpreendimento, lote);
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Sem isto o blob fica na memória do aparelho até a aba fechar.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      // Rede caiu: o botão volta ao normal e a pessoa tenta de novo.
    } finally {
      setBaixando(false);
    }
  }, [baixando, lote, nomeDoEmpreendimento, token]);

  return (
    <div
      data-esp-print="folha"
      onClick={onFechar}
      role="presentation"
      style={ESTILO.fundoDoPopUp}
    >
      <aside
        data-esp-print="folha"
        onClick={(ev) => ev.stopPropagation()}
        role="presentation"
        style={ESTILO.painel}
      >
        <header style={ESTILO.painelTopo}>
          <div>
            <p style={{ ...ESTILO.painelRotulo, color: disponivel ? VERDE : "var(--esp-suave)" }}>
              {disponivel ? "Disponível" : "Indisponível"}
            </p>
            <h2 style={ESTILO.painelTitulo}>
              {vertical
                ? lote.rotulo
                : lote.quadra
                  ? `Quadra ${lote.quadra} · Lote ${lote.lote ?? ""}`
                  : lote.codigo}
            </h2>
            <p style={ESTILO.painelSub}>
              {nomeDoEmpreendimento}
              {lote.area
                ? ` · ${lote.area.toLocaleString("pt-BR")} m²${vertical ? " privativos" : ""}`
                : ""}
              {vertical && lote.tipologia ? ` · ${lote.tipologia}` : ""}
            </p>
          </div>
          <div style={ESTILO.acoesDoTopo}>
            <button
              data-esp-print="fora"
              disabled={baixando}
              onClick={() => void baixarPdf()}
              style={{ ...ESTILO.botaoTopo, opacity: baixando ? 0.6 : 1 }}
              type="button"
            >
              {baixando ? "Gerando…" : "Salvar em PDF"}
            </button>
            <button
              aria-label="Fechar"
              data-esp-print="fora"
              onClick={onFechar}
              style={ESTILO.fechar}
              type="button"
            >
              ×
            </button>
          </div>
        </header>

        {disponivel && preco > 0 && planosDaVenda.length > 0 ? (
          <div className="inc" style={ESTILO.molduraDoSimulador}>
            <style>{TEMA_CSS}</style>
            <SimuladorDeProposta
              aoMudarCondicoes={(c) => {
                condicoes.current = c;
              }}
              planos={planosDaVenda}
              unidade={nomeDoLote}
              valorDaUnidade={preco}
              vocabulario="simulacao"
            />
          </div>
        ) : null}

        {/* ⚠️ QUEM ABRE ESTE ESPELHO É O CORRETOR, E NÃO O CLIENTE FINAL. Lucas, 14/09/2026:
            *"essa mensagem tem que ser fale com o coordenador, pois quem acessa esse espelho são os
            corretores"*. O link parece público porque não pede senha, mas ele circula no time de
            venda — e por isso a saída de quem está lendo é subir para a COORDENAÇÃO, não procurar um
            corretor.

            ⚠️ E ISSO VALE PARA TODO TEXTO DESTA TELA daqui em diante: o leitor é do ofício. Escrever
            para o comprador aqui inverte a instrução e manda o corretor falar com ele mesmo. */}
        {disponivel && preco > 0 && planosDaVenda.length === 0 ? (
          <p style={ESTILO.aviso}>
            Fale com o coordenador para conhecer as condições de pagamento {vertical ? "desta unidade" : "deste lote"}.
          </p>
        ) : null}

        {!disponivel ? (
          <p style={ESTILO.aviso}>
            {vertical ? "Esta unidade" : "Este lote"} não está disponível. Fale com o coordenador para
            conhecer as opções.
          </p>
        ) : null}
      </aside>
    </div>
  );
}

/**
 * `Veredas do Ouro - Quadra 07 - Lote 34.pdf`, sem o que quebra nome de arquivo. No prédio,
 * `Ed. Jade - Torre A - Apto 304.pdf`: sem este ramo sairia o código cru.
 */
function nomeDoArquivo(empreendimento: string, lote: LoteDoEspelho): string {
  const partes =
    lote.tipoProduto === "vertical" && lote.rotulo
      ? [empreendimento, lote.rotulo.replace(/ · /g, " - ")]
      : [
          empreendimento,
          lote.quadra ? `Quadra ${lote.quadra}` : null,
          lote.lote ? `Lote ${lote.lote}` : lote.codigo,
        ].filter(Boolean);

  return `${partes.join(" - ").replace(/["*/:<>?|]/g, "-")}.pdf`;
}

// ── Estilo inline: a página é pública e autocontida, sem o tema do hub ─────────────

const ESTILO: Record<string, React.CSSProperties> = {
  acoesDoTopo: { alignItems: "center", display: "flex", gap: 10 },
  botaoTopo: {
    background: "var(--esp-realce)",
    border: "1px solid var(--esp-borda)",
    borderRadius: 8,
    color: "var(--esp-texto)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    padding: "8px 12px",
  },
  // O simulador traz a própria altura (duas colunas roláveis); a moldura só lhe dá espaço e
  // recorta os cantos junto com o pop-up.
  molduraDoSimulador: {
    borderRadius: 10,
    // `flex: 1` mais `min-height: 0` é o par que permite a um filho de flex encolher abaixo do
    // conteúdo — sem o segundo, o simulador empurraria o pop-up para fora da tela.
    flex: 1,
    marginTop: 14,
    minHeight: 0,
    overflow: "hidden",
  },
  acoesDaColuna: { display: "grid", gap: 8, marginTop: "auto" },
  blocoDetalhe: { fontSize: 11.5, margin: "2px 0 0", opacity: 0.6 },
  blocoFluxo: {
    background: "var(--esp-realce)",
    border: "1px solid var(--esp-borda)",
    borderRadius: 10,
    marginTop: 12,
    padding: "12px 14px",
  },
  blocoLote: {
    background: "var(--esp-realce)",
    border: "1px solid var(--esp-borda)",
    borderRadius: 8,
    padding: "12px 14px",
  },
  blocoValor: { fontSize: 21, fontWeight: 700, margin: 0 },
  colunaDireita: { display: "grid", gap: 12, minWidth: 0 },
  colunaEsquerda: { display: "flex", flexDirection: "column", gap: 12, minWidth: 0 },
  // 300px na esquerda é a mesma proporção da Mesa de Venda (344px numa janela maior). Abaixo de
  // 720px vira coluna única, e o celular recebe as duas empilhadas.
  duasColunas: {
    display: "grid",
    gap: 18,
    gridTemplateColumns: "minmax(0, 300px) minmax(0, 1fr)",
    marginTop: 14,
  },
  numeros: {
    borderTop: "1px solid var(--esp-borda)",
    display: "grid",
    gap: 10,
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    margin: "12px 0 0",
    paddingTop: 12,
  },
  numeroValor: { fontSize: 14, fontWeight: 700, margin: "2px 0 0" },
  painelSub: { fontSize: 11.5, margin: "3px 0 0", opacity: 0.6 },
  botaoImprimir: {
    background: "var(--esp-realce)",
  },
  botoesDaSimulacao: { display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr", marginTop: 12 },
  // Aparece só no papel: na tela o nome já está no cabeçalho.
  soNaFolha: {
    display: "none",
    fontSize: 12,
    margin: "2px 0 0",
    opacity: 0.7,
  },
  cartaoPlano: {
    background: "var(--esp-campo)",
    border: "1px solid var(--esp-borda)",
    borderRadius: 8,
    cursor: "pointer",
    display: "grid",
    font: "inherit",
    gap: 2,
    justifyItems: "start",
    padding: "10px 12px",
    textAlign: "left",
  },
  cartaoPlanoOn: {
    background: "color-mix(in srgb, #3b82f6 14%, transparent)",
    // ⚠️ `border` INTEIRO, e não `borderColor`. Misturar shorthand (o `border` do estado normal)
    // com longhand (o `borderColor` do selecionado) no mesmo elemento faz o React descartar o
    // longhand no rerender — e o cartão escolhido perde a borda ao trocar de plano.
    border: "1px solid color-mix(in srgb, #3b82f6 55%, transparent)",
  },
  planoDetalhe: { fontSize: 10.5, opacity: 0.6 },
  planoNome: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: ".04em",
    opacity: 0.6,
    textTransform: "uppercase",
  },
  planoValor: { fontSize: 17, fontWeight: 700 },
  sPlanos: {
    display: "grid",
    gap: 6,
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  },
  botaoFluxo: {
    background: "transparent",
    border: "1px solid var(--esp-borda)",
    borderRadius: 8,
    color: "var(--esp-texto)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    marginTop: 12,
    padding: "10px 12px",
    width: "100%",
  },
  condicao: { fontSize: 11.5, margin: "6px 0 0", opacity: 0.7 },
  fundoDoPopUp: {
    alignItems: "center",
    background: "rgba(0, 0, 0, .55)",
    display: "flex",
    inset: 0,
    justifyContent: "center",
    padding: 16,
    position: "fixed",
    zIndex: 50,
  },
  maisIndice: { fontSize: 10, fontWeight: 400, opacity: 0.65 },
  popUp: {
    background: "var(--esp-superficie)",
    border: "1px solid var(--esp-borda)",
    borderRadius: 12,
    maxHeight: "82dvh",
    maxWidth: 520,
    overflow: "auto",
    padding: "16px 18px",
    width: "100%",
  },
  tabela: { borderCollapse: "collapse", fontSize: 12.5, marginTop: 14, width: "100%" },
  td: { borderTop: "1px solid var(--esp-borda)", padding: "9px 6px" },
  th: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: ".05em",
    opacity: 0.55,
    padding: "0 6px 7px",
    textAlign: "left",
    textTransform: "uppercase",
  },
  // ⚠️ A GRADE PREENCHE A TELA. Lucas (10/09/2026): *"gosto dessa disposição, contudo podemos
  // aproveita melhor a tela"*. A largura da coluna cresce com a janela em vez de ficar cravada em
  // 140px — num monitor largo sobravam faixas vazias à direita e os quadradinhos ficavam
  // minúsculos no meio de espaço livre. `auto-fill` com um mínimo maior enche a linha, e o `1fr`
  // distribui o que sobra entre as colunas que existem.
  gradeColunas: {
    alignContent: "start",
    display: "grid",
    gap: "18px 20px",
    gridTemplateColumns: "repeat(auto-fill, minmax(clamp(150px, 14vw, 230px), 1fr))",
  },
  quadradinho: {
    aspectRatio: "1 / 1.15",
    border: 0,
    borderRadius: 4,
    color: "#fff",
    cursor: "pointer",
    display: "grid",
    font: "inherit",
    // Cresce com a coluna: num monitor largo o número do lote fica legível, no celular encolhe
    // sem estourar. O piso é o tamanho da Mesa de Venda.
    fontSize: "clamp(8.5px, .95vw, 13px)",
    fontWeight: 600,
    outlineOffset: 1,
    padding: 0,
    placeItems: "center",
  },
  quadradinhos: { display: "grid", gap: 4, gridTemplateColumns: "repeat(6, 1fr)" },
  tituloQuadra: {
    color: "var(--esp-suave)",
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: ".06em",
    marginBottom: 5,
    opacity: 0.6,
    textTransform: "uppercase",
  },
  // ── A linguagem do simulador interno (`.s-campo`, `.s-lb`, `.s-inp`, `.s-pz`) ──────
  dd: { fontSize: 18, fontWeight: 700, margin: "2px 0 0" },
  parcela: { fontSize: 26, fontWeight: 700, letterSpacing: "-.01em", margin: "4px 0 0" },
  saida: {
    background: "var(--esp-realce)",
    border: "1px solid var(--esp-borda)",
    borderRadius: 8,
    marginTop: 4,
    padding: "12px 14px",
  },
  sAj: {
    fontSize: 10.5,
    fontWeight: 400,
    letterSpacing: 0,
    marginLeft: "auto",
    opacity: 0.7,
    textTransform: "none",
  },
  sCampo: { marginBottom: 15 },
  sInp: {
    alignItems: "center",
    background: "var(--esp-campo)",
    border: "1px solid var(--esp-borda)",
    borderRadius: 6,
    display: "flex",
    gap: 8,
    height: 38,
    padding: "0 10px",
  },
  sInput: {
    background: "transparent",
    border: "none",
    color: "var(--esp-texto)",
    flex: 1,
    fontSize: 15,
    fontWeight: 600,
    minWidth: 0,
    outline: "none",
    textAlign: "right",
  },
  sLb: {
    alignItems: "baseline",
    display: "flex",
    fontSize: 10,
    fontWeight: 600,
    gap: 6,
    letterSpacing: ".05em",
    marginBottom: 6,
    opacity: 0.55,
    textTransform: "uppercase",
  },
  sPre: { flex: "0 0 auto", fontSize: 11.5, opacity: 0.6 },
  sPrazos: { display: "grid", gap: 6, gridTemplateColumns: "repeat(3, minmax(0, 1fr))" },
  sPz: {
    alignItems: "center",
    background: "var(--esp-campo)",
    border: "1px solid var(--esp-borda)",
    borderRadius: 6,
    color: "var(--esp-suave)",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    height: 54,
    justifyContent: "center",
  },
  sPzB: { fontSize: 14, fontWeight: 600 },
  // A tinta de "selecionado" é a mesma proporção do espelho interno: um azul de 12% sobre o
  // fundo, com a borda mais viva. Nada de bloco chapado.
  sPzOn: {
    background: "color-mix(in srgb, #3b82f6 14%, transparent)",
    // Mesmo motivo do cartaoPlanoOn: shorthand e longhand não convivem no mesmo elemento.
    border: "1px solid color-mix(in srgb, #3b82f6 55%, transparent)",
    color: "#cfe0ff",
  },
  sPzSmall: { fontSize: 9.5, lineHeight: 1.35, opacity: 0.6 },
  // ⚠️ AS AÇÕES QUEBRAM LINHA NO CELULAR (18/09/2026): com `flexShrink: 0` elas não cabiam nos
  // 375 px e o alternador Mapa/Grade ficava fora da tela.
  acoes: { alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 },
  aviso: { fontSize: 11, lineHeight: 1.5, margin: "10px 0 0", opacity: 0.6 },
  bolinha: {
    borderRadius: 999,
    display: "inline-block",
    height: 9,
    marginRight: 5,
    width: 9,
  },
  botao: {
    background: "var(--esp-realce)",
    border: "1px solid var(--esp-borda)",
    borderRadius: 9,
    color: "var(--esp-texto)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    padding: "8px 12px",
  },
  botaoAlternador: {
    background: "transparent",
    border: "none",
    borderRadius: 7,
    color: "var(--esp-suave)",
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    padding: "7px 14px",
  },
  botaoAlternadorAtivo: { background: "var(--esp-realce)", color: "var(--esp-texto)" },
  cabecalho: {
    alignItems: "center",
    borderBottom: "1px solid var(--esp-borda)",
    display: "flex",
    flexShrink: 0,
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
    padding: "calc(10px + env(safe-area-inset-top)) 16px 10px",
  },
  fechar: {
    background: "transparent",
    border: "none",
    color: "var(--esp-texto)",
    cursor: "pointer",
    fontSize: 26,
    lineHeight: 1,
    padding: 0,
  },
  ficha: { display: "grid", gap: 14, gridTemplateColumns: "1fr 1fr", margin: "16px 0 0" },
  grade: { flex: 1, minHeight: 0, overflow: "auto", padding: 16 },
  legenda: { alignItems: "center", display: "flex", fontSize: 12, margin: "3px 0 0", opacity: 0.8 },
  pagina: {
    background: "var(--esp-fundo)",
    color: "var(--esp-texto)",
    display: "flex",
    flexDirection: "column",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    height: "100dvh",
    overflow: "hidden",
  },
  // ⚠️ O POP-UP NÃO ROLA — quem rola é o simulador, por dentro. Lucas (10/09/2026): *"só tira
  // essa barra de rolagem"*. Com `overflow: auto` aqui havia DUAS barras na mesma janela: a do
  // pop-up e a das colunas do simulador, que já rolam sozinhas. `hidden` mais `flex` deixa o
  // simulador ocupar a altura que sobra e cuidar da própria rolagem, que é o comportamento dele
  // na Mesa de Venda.
  painel: {
    background: "var(--esp-superficie)",
    border: "1px solid var(--esp-borda)",
    borderRadius: 14,
    boxShadow: "0 24px 60px rgba(0,0,0,.35)",
    display: "flex",
    flexDirection: "column",
    maxHeight: "92dvh",
    maxWidth: 1120,
    overflow: "hidden",
    padding: "18px 20px calc(20px + env(safe-area-inset-bottom))",
    width: "100%",
  },
  painelRotulo: { fontSize: 11, letterSpacing: ".05em", margin: 0, opacity: 0.6, textTransform: "uppercase" },
  painelTitulo: { fontSize: 19, fontWeight: 700, margin: "2px 0 0" },
  painelTopo: {
    alignItems: "flex-start",
    display: "flex",
    flexShrink: 0,
    gap: 12,
    justifyContent: "space-between",
  },
  palco: { display: "flex", flex: 1, flexDirection: "column", minHeight: 0, position: "relative" },
  simulador: { borderTop: "1px solid var(--esp-borda)", marginTop: 16, paddingTop: 14 },
  simuladorTitulo: { fontSize: 12, letterSpacing: ".04em", margin: "0 0 10px", opacity: 0.6, textTransform: "uppercase" },
  titulo: { fontSize: 16, fontWeight: 700, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  alternador: {
    background: "var(--esp-realce)",
    borderRadius: 9,
    display: "flex",
    padding: 3,
  },
  vazio: {
    alignItems: "center",
    background: "var(--esp-fundo)",
    color: "var(--esp-texto)",
    display: "flex",
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    height: "100dvh",
    justifyContent: "center",
    padding: 24,
    textAlign: "center",
  },
};
