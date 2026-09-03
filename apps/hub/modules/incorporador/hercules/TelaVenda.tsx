"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  FileSignature,
  FileText,
  Grid2x2,
  Receipt,
  Search,
  Signature,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import type { EtapaDoEspelho, EtapaDoFluxo, FluxoDeVenda } from "@/lib/hercules/fluxo-de-venda";
import type { EventoDaUnidade } from "@/lib/hercules/historico-da-unidade";

import { toTitleCase } from "@/lib/format/name-case";

import { T, useTemaDoPortal } from "../tema";
import { Pilula } from "./AssinaturasDoProduto";

// A TELA VENDA — onde o coordenador VENDE, e onde ele olha se está vendendo bem.
//
// Pedido do Lucas (03/09/2026): *"vamos criar a tela Venda, que vai ser a tela que vamos fazer o
// processo de reserva, proposta e emissão de contratos"*, com *"a parte indicadores (...) a ideia é
// mostrar o cenário comercial daquele ou daqueles empreendimentos"*, *"um dashboard (painel de
// gestão) rico focado em performance comercial"*, agilidade com *"simulador de proposta"* e *"ter o
// mapa na tela de vendas para que o coordenador possa ver visualmente o que está sendo vendido"*.
//
// ⚠️ OS DADOS SÃO DO PANTEON, NÃO DO C2X. Na mesma conversa: *"quero importar todos os dados do
// c2x, eles tem que existir dentro do panteon (...) e quero que hoje isso seja visto dentro do
// panteon"*. A carga trouxe 4.853 propostas e 12.269 movimentações de etapa
// (`scripts/hercules/importar-fluxo-de-venda.mjs`), e esta tela lê `/api/incorporador/venda` —
// Supabase, não o MySQL do legado. A tela antiga (`TelaVendas`) continua lendo o C2X e serve os
// portais de incorporador; quando eles migrarem, ela sai.
//
// ⚠️ A FAIXA DO FLUXO É A ESPINHA, e fica acima das duas visões. Reserva → Proposta → Contrato →
// Assinatura → Faturamento é o processo, e ele não muda quando o coordenador troca de visão: o que
// muda é o que ele faz com aquilo. Clicar numa etapa recorta a Mesa para ela.
//
// ⚠️ CANCELADO E DISTRATO NÃO SÃO PASSOS. São saídas do caminho, e vivem no quadro de perdas do
// Panorama — a régua está em `lib/hercules/fluxo-de-venda.ts`, com teste.
//
// ⚠️ O QUE AINDA NÃO EXISTE ESTÁ DITO NA TELA, não escondido atrás de um botão morto. Reservar e
// gerar proposta gravando no Panteon dependem da 0125 (reservas), ainda não aplicada.
//
// ⚠️ O ESTOQUE TEM DUAS VISTAS NO MESMO LUGAR: quadrados e mapa (Lucas, 03/09/2026: *"vamos dar a
// opção do usuário de selecionar se ele quer ver essa tela quadrados, ou mapa (...) não é para
// abrir uma tela nova, tem que aparecer aí mesmo"*). O masterplan é o desenho de verdade do
// loteamento; a grade é o quadro por quadra, que funciona em qualquer produto e não depende
// de haver mapa publicado. Antes disso o masterplan abria em tela cheia e tirava o coordenador da
// Mesa — perdia a lista, o painel e o simulador para olhar o mapa.
//
// ⚠️ E COM TODOS OS EMPREENDIMENTOS NÃO HÁ MAPA. Cada produto tem o seu; o consolidado não tem um
// desenho só. Nesse caso a opção nem aparece, em vez de aparecer e não fazer nada.

/** O card da rota antiga — usado só para achar o masterplan de um produto. */
type CardDeProduto = {
  code: string;
  enterpriseIds: string[];
  id: string;
  masterplanInterno: null | string;
  masterplanUrl: null | string;
  nome: string;
};

/**
 * O PRODUTO É O PAI, e os recortes são filhos dele.
 *
 * ⚠️ ISTO É A ARQUITETURA DA CASA, EXPLICADA PELO LUCAS (03/09/2026): *"o Pai sempre será a nossa
 * referência para tudo, o filho são recortes, visões do pai (...) no Vale do Ouro o Pai VLO é a
 * referência, o VOC são os lotes que pertencem a Cecílio Rocha, o VOL são os lotes que pertencem à
 * Família Lino (...) eu peguei o pai e subdividi ele pois na hora de emitir os boletos teria que
 * sair de contas separadas. No C2X não tínhamos essa divisão tão bem arquitetada, por isso
 * criávamos outros empreendimentos, era nossa gambiarra"*.
 *
 * E o pedido: *"quero que o VLO seja reflexo dos filhos, então não vai ter três Vale do Ouro, vai
 * ter UM Vale do Ouro e quando tiver filhos trazer um subfiltro para caso o usuário queira ver
 * somente aquele recorte"*.
 *
 * ⚠️ E O ESPELHO DO PAI NÃO ENTRA NA CONTA quando há filhos. No C2X o VLO tem 298 unidades e 165
 * propostas PRÓPRIAS (só 11 faturadas) — é o registro antigo, parado, dos MESMOS lotes que hoje
 * vivem em VOC + VOL + VOR. Somar pai e filhos contaria cada venda duas vezes. Quem já resolve
 * isso é `expandirIdDoPainel`: pai com filho devolve só os filhos.
 */
type Produto = {
  filhos: { codigo: string; id: string; nome: string }[];
  id: string;
  nome: string;
};

type UnidadeNoMapa = FluxoDeVenda["mapa"][number]["unidades"][number];
type Proposta = FluxoDeVenda["lista"][number];

/**
 * O que o painel da direita está mostrando.
 *
 * ⚠️ SÃO DUAS PORTAS PARA A MESMA COISA. Clicar no lote do mapa parte da UNIDADE (e a proposta,
 * se houver, é achada pelo id); clicar na linha da lista parte da PROPOSTA. Guardar só a proposta
 * deixaria o lote disponível sem nada para mostrar — e foi exatamente o que aconteceu: o Lucas
 * clicou nos lotes e a tela não reagiu.
 */
type Foco =
  | { proposta: Proposta; tipo: "proposta" }
  | { tipo: "unidade"; unidade: UnidadeNoMapa };

// ⚠️ O ESTOQUE ABRE A FAIXA (Lucas, 03/09/2026: *"aproveitar trazer aqui também disponível"*). É
// de onde a venda começa, e ver o pipeline sem saber quanto sobra para vender conta metade da
// história. Ele é o único passo contado em UNIDADES — nos outros, cada unidade tem uma proposta.
const FLUXO: ReadonlyArray<{
  cor: string;
  etapa: "disponivel" | EtapaDoFluxo;
  icone: LucideIcon;
  rotulo: string;
}> = [
  { cor: "#98a2b3", etapa: "disponivel", icone: Grid2x2, rotulo: "Disponível" },
  { cor: "#c9962b", etapa: "reservado", icone: Bookmark, rotulo: "Reserva" },
  { cor: "#3c73c0", etapa: "proposta", icone: FileText, rotulo: "Proposta" },
  { cor: "#7d5cba", etapa: "contrato", icone: FileSignature, rotulo: "Contrato" },
  { cor: "#454c5c", etapa: "assinatura", icone: Signature, rotulo: "Assinatura" },
  { cor: "#2f7d4a", etapa: "faturado", icone: Receipt, rotulo: "Faturamento" },
];

// ⚠️ A GRADE PINTA POR ETAPA, NÃO POR SITUAÇÃO (Lucas, 03/09/2026: *"em vez de vendida, ter
// propostas, contrato assinatura faturamento"*). A cor de cada etapa é a MESMA da faixa acima, de
// propósito: o quadrado amarelo no quadro é o mesmo amarelo do cartão Reserva, e o coordenador liga
// os dois sem legenda.
//
// ⚠️ `vendida` e `reservada` são os estados SEM PROPOSTA que o cadastro sozinho afirma — 114 lotes
// hoje. Recebem tom próprio, apagado, para parecerem ocupados sem se passar por uma etapa do fluxo:
// eles não estão em nenhuma, e é justamente isso que precisa aparecer.
// ⚠️ UM MATIZ POR ETAPA, e não tons do mesmo. Lucas (03/09/2026), olhando a legenda com
// assinatura, faturamento e "vendida sem proposta" em três verdes: *"não gostei desses tons da
// mesma cor, isso confunde na hora da visualização"*. Num quadro de 500 quadradinhos de 12px, dois
// verdes vizinhos são a mesma cor — o olho não separa. Então cada etapa pegou um matiz distante no
// círculo: amarelo, azul, violeta, ciano, verde.
//
// ⚠️ E O QUE NÃO TEM PROPOSTA GANHA LISTRA, NÃO UM TOM. `vendida` e `reservada` (114 lotes que o
// cadastro afirma sem proposta que sustente) precisam parecer OCUPADOS — se virassem cinza, se
// misturariam ao disponível e alguém venderia de novo. A cor é a do estado, a listra é o "falta a
// proposta": diferença de textura, que sobrevive ao quadradinho pequeno.
const AMARELO = "#f2c14e";
const VERDE = "#3f9d5e";

const listrado = (cor: string, sombra: string) =>
  `repeating-linear-gradient(135deg, ${cor} 0 4px, ${sombra} 4px 8px)`;

const COR_DA_ETAPA: Record<EtapaDoEspelho, string> = {
  assinatura: "#454c5c",
  bloqueada: "#e08276",
  contrato: "#9b7ed0",
  disponivel: "var(--inc-soft)",
  faturado: VERDE,
  proposta: "#5b8dd6",
  reservada: listrado(AMARELO, "#d9a833"),
  reservado: AMARELO,
  vendida: listrado(VERDE, "#2f7d4a"),
};

/** A ordem da legenda é a do caminho: estoque, fluxo, e no fim o que está fora dele. */
const LEGENDA: ReadonlyArray<{ etapa: EtapaDoEspelho; rotulo: string }> = [
  { etapa: "disponivel", rotulo: "Disponível" },
  { etapa: "reservado", rotulo: "Reserva" },
  { etapa: "proposta", rotulo: "Proposta" },
  { etapa: "contrato", rotulo: "Contrato" },
  { etapa: "assinatura", rotulo: "Assinatura" },
  { etapa: "faturado", rotulo: "Faturamento" },
  { etapa: "vendida", rotulo: "Vendida sem proposta" },
  { etapa: "reservada", rotulo: "Reservada sem proposta" },
  { etapa: "bloqueada", rotulo: "Bloqueada" },
];

const ROTULO_DA_ETAPA: Record<EtapaDoEspelho, string> = Object.fromEntries(
  LEGENDA.map((l) => [l.etapa, l.rotulo]),
) as Record<EtapaDoEspelho, string>;

/** As etapas de fundo ESCURO, onde o número do lote precisa ser claro para continuar legível. */
const FUNDO_ESCURO = new Set<EtapaDoEspelho>(["assinatura"]);

const textoNoQuadrado = (etapa: EtapaDoEspelho) =>
  etapa === "disponivel" ? T.muted : FUNDO_ESCURO.has(etapa) ? "rgb(255 255 255 / .9)" : "rgb(0 0 0 / .6)";



const dinheiro = (v: number) =>
  v >= 1_000_000
    ? `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`
    : `R$ ${Math.round(v).toLocaleString("pt-BR")}`;

const inteiro = (v: number) => v.toLocaleString("pt-BR");

const dia = (iso: null | string) => {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};

/**
 * As janelas do Panorama.
 *
 * ⚠️ A JANELA VALE PARA O DESEMPENHO, NUNCA PARA A FAIXA DO FLUXO. A faixa é o pipeline VIVO — "3
 * em assinatura" é verdade hoje, venha a proposta de que mês vier; filtrá-la faria a venda parada
 * desde julho desaparecer da tela em setembro, escondendo justamente o que precisa de atenção. A
 * régua está em `lib/hercules/fluxo-de-venda.ts`, com teste.
 */
const JANELAS: ReadonlyArray<{ id: string; meses: null | number; rotulo: string }> = [
  { id: "mes", meses: 1, rotulo: "Este mês" },
  { id: "3m", meses: 3, rotulo: "3 meses" },
  { id: "12m", meses: 12, rotulo: "12 meses" },
  { id: "tudo", meses: null, rotulo: "Tudo" },
];

/** A competência de N meses atrás, no formato AAAA-MM que a rota espera. */
function competenciaDe(mesesAtras: number): string {
  const hoje = new Date();
  const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - mesesAtras, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Como a unidade aparece para quem vende: **quadra e lote**, e o recorte por baixo.
 *
 * ⚠️ O CÓDIGO DA UNIDADE NÃO VAI PARA A TELA. Lucas (03/09/2026), comparando as duas listas:
 * *"vamos deixar esse padrão do segundo print, 12 06 VOR; não vamos trabalhar com o código da
 * unidade, esse será de uso do backend (...) caso trazer, ter a conotação de código"*. "VOL0307" é
 * chave de sistema; quem está vendendo fala "lote 07 da quadra 03". A lista de propostas já
 * escrevia assim (o nome vem de bloco + lote), e a de disponíveis destoava.
 *
 * `VOL0307` → `{ recorte: "VOL", unidade: "03 07" }`. Código fora do padrão (apartamento, unidade
 * avulsa) volta inteiro no lugar da unidade: melhor um código à mostra do que um lote inventado.
 */
function comoSeEscreve(
  codigo: string,
  quadra: null | string,
  lote: null | string,
): { recorte: null | string; unidade: string } {
  if (quadra && lote) {
    const m = /^([A-Za-z]{2,4})/.exec(codigo.trim());
    return { recorte: m ? m[1]!.toUpperCase() : null, unidade: `${quadra} ${lote}` };
  }

  const padrao = /^([A-Za-z]{2,4})(\d{2})(\d{2})$/.exec(codigo.trim());
  if (padrao) {
    return { recorte: padrao[1]!.toUpperCase(), unidade: `${padrao[2]} ${padrao[3]}` };
  }
  return { recorte: null, unidade: codigo };
}

/**
 * Como a data se chama em cada etapa.
 *
 * ⚠️ "Desde" NÃO DIZ NADA (Lucas, 03/09/2026: *"colocar Data de faturamento (quando for
 * faturamento), Data de Reserva (quando for reserva), Data da Proposta (quando for proposta)"*).
 * Numa lista de faturamento, "desde 31/08" faz pensar em tempo parado; "Data de faturamento
 * 31/08" é o fato. E como a lista mostra uma etapa por vez, o cabeçalho da coluna pode dizer
 * exatamente qual data está ali.
 */
const ROTULO_DA_DATA: Record<string, string> = {
  assinatura: "Data da assinatura",
  cancelado: "Data do cancelamento",
  contrato: "Data do contrato",
  distrato: "Data do distrato",
  faturado: "Data de faturamento",
  proposta: "Data da proposta",
  reservado: "Data da reserva",
};

const rotuloDaData = (etapa: string) => ROTULO_DA_DATA[etapa] ?? "Data";

/**
 * Lê a quadra e o lote que o espelho acabou de selecionar.
 *
 * ⚠️ O ESPELHO ESCREVE A IDENTIDADE DO LOTE NUM LUGAR SÓ: a ficha da coluna de unidade, no elemento
 * `#fQL`, no formato "Quadra 03 · Lote 01" (é o `rot` que o `mostraLote` do A-INTERNO preenche).
 * Como essa coluna está escondida pelo `so=espelho`, ela continua sendo preenchida — foi por isso
 * que a casca é escondida e não removida.
 *
 * ⚠️ E O CASAMENTO É POR QUADRA E LOTE, NUNCA PELO CÓDIGO. O espelho monta o id com o prefixo do
 * ARQUIVO ("VLO0301"), e no Vale do Ouro as unidades vivas são dos filhos ("VOC0301", "VOL..."):
 * casar por código não acharia nada justamente no produto que mais precisa. Quadra e lote são o
 * lote físico, e não mudam com o recorte.
 */
function loteSelecionadoNoEspelho(doc: Document): null | { lote: string; quadra: string } {
  const texto = doc.getElementById("fQL")?.textContent?.trim();
  if (!texto) return null;
  const m = /Quadra\s*([^\s·]+)\s*·\s*Lote\s*(\S+)/i.exec(texto);
  return m ? { lote: m[2]!, quadra: m[1]! } : null;
}

/** "31/08/2026 14:20" — num histórico a hora importa: dois eventos do mesmo dia têm ordem. */
function diaEHora(iso: null | string): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
  return dia(iso);
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const mesCurto = (mes: string) => {
  const [ano, m] = mes.split("-");
  return `${MESES[Number(m) - 1] ?? m}/${String(ano).slice(2)}`;
};

export function TelaVenda() {
  const [dados, setDados] = useState<FluxoDeVenda | null>(null);
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [cards, setCards] = useState<CardDeProduto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);

  // `emp` é o PRODUTO (o pai); `recorte` é o filho escolhido dentro dele, quando houver.
  const [emp, setEmp] = useState<string>("");
  const [recorte, setRecorte] = useState<string>("");
  const [visao, setVisao] = useState<"mesa" | "panorama">("panorama");
  const [etapa, setEtapa] = useState<"disponivel" | EtapaDoFluxo>("reservado");
  const [foco, setFoco] = useState<null | Foco>(null);
  const [modoDoEstoque, setModoDoEstoque] = useState<"grade" | "mapa">("grade");
  // Abre em 12 meses: o mês corrente sozinho, no dia 3, mostraria quase nada.
  const [janela, setJanela] = useState<string>("12m");

  const carregar = useCallback(async (alvo: string, qualJanela: string) => {
    setCarregando(true);
    setErro(null);
    try {
      const busca = new URLSearchParams();
      if (alvo) busca.set("emp", alvo);
      const meses = JANELAS.find((j) => j.id === qualJanela)?.meses ?? null;
      if (meses) {
        // `de` é o começo da janela e `ate` é o mês corrente: um intervalo fechado, para o
        // servidor não precisar saber que dia é hoje.
        busca.set("de", competenciaDe(meses - 1));
        busca.set("ate", competenciaDe(0));
      }
      const sufixo = busca.toString() ? `?${busca}` : "";
      const r = await fetch(`/api/incorporador/venda${sufixo}`, { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as null | { data?: FluxoDeVenda; error?: string };
      if (!r.ok || !j?.data) {
        setErro(j?.error ?? "Não foi possível carregar o fluxo de venda.");
        return;
      }
      setDados(j.data);
    } catch {
      setErro("Não foi possível carregar o fluxo de venda.");
    } finally {
      setCarregando(false);
    }
  }, []);

  // ⚠️ O RECORTE SUBSTITUI O PAI NA CONSULTA, e não soma a ele: o filho já é um pedaço do pai, e
  // mandar os dois pediria o mesmo lote duas vezes. Sem recorte, vale o pai — e aí o servidor
  // expande para TODOS os filhos, deixando o espelho de fora.
  useEffect(() => {
    void carregar(recorte || emp, janela);
  }, [carregar, emp, janela, recorte]);

  // DUAS FONTES, e cada uma responde uma pergunta diferente:
  //   • o PAINEL diz quais são os produtos e quem é filho de quem (é ele que agrupa o pai);
  //   • os CARDS dizem qual produto tem masterplan publicado.
  // O painel não carrega masterplan e a rota de cards não agrupa pai/filho — juntar as duas num
  // endpoint só seria a terceira lista de empreendimentos para manter viva.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      try {
        const [rPainel, rCards] = await Promise.all([
          fetch("/api/incorporador/produtos/painel", { cache: "no-store" }),
          fetch("/api/incorporador/produtos", { cache: "no-store" }),
        ]);

        if (rPainel.ok) {
          const j = (await rPainel.json()) as {
            data?: { linhas?: { filhos?: Produto["filhos"]; id: string; nome: string }[] };
          };
          if (vivo) {
            setProdutos(
              (j.data?.linhas ?? []).map((l) => ({
                filhos: l.filhos ?? [],
                id: l.id,
                nome: l.nome,
              })),
            );
          }
        }

        if (rCards.ok) {
          // ⚠️ O PAYLOAD É `{ data: { produtos } }`, e não a lista solta: eu li errado uma vez e a
          // tela quebrou com "produtos.filter is not a function" antes de desenhar qualquer coisa.
          const j = (await rCards.json()) as { data?: { produtos?: CardDeProduto[] } };
          if (vivo) setCards(j.data?.produtos ?? []);
        }
      } catch {
        // Sem as listas, a tela mostra tudo e não oferece filtro. Ela não depende disso para viver.
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  // Nas cinco etapas do fluxo a lista é de PROPOSTAS; no estoque não existe proposta, e o que o
  // coordenador precisa ver é a lista de lotes livres para vender.
  const daEtapa = useMemo(
    () => (etapa === "disponivel" ? [] : (dados?.lista ?? []).filter((l) => l.etapa === etapa)),
    [dados, etapa],
  );

  const livres = useMemo(
    () =>
      etapa === "disponivel"
        ? (dados?.mapa ?? []).flatMap((g) =>
            g.unidades
              .filter((u) => u.etapa === "disponivel")
              .map((u) => ({ ...u, grupo: g.grupo })),
          )
        : [],
    [dados, etapa],
  );

  // O mapa do PRODUTO ESCOLHIDO, e só dele: no consolidado não existe um masterplan único.
  const produtoEscolhido = useMemo(
    () => (emp ? (produtos.find((p) => p.id === emp) ?? null) : null),
    [emp, produtos],
  );

  // ⚠️ O MASTERPLAN É DO PAI, sempre. O desenho é do loteamento inteiro; o recorte escolhe QUAIS
  // lotes olhar, não outro desenho. Os cards trazem o mapa por id do C2X ou pelo id do card, e o
  // pai do painel ("pai:<uuid>") não bate com nenhum dos dois — por isso o encontro é pelo NOME,
  // que é o que os dois lados têm em comum.
  const mapaDoProduto = useMemo(() => {
    if (!produtoEscolhido) return null;
    const nome = produtoEscolhido.nome.trim().toLowerCase();
    return (
      cards.find(
        (c) => (c.masterplanInterno ?? c.masterplanUrl) && c.nome.trim().toLowerCase() === nome,
      ) ?? null
    );
  }, [cards, produtoEscolhido]);

  // Trocar para "todos" (ou para um produto sem mapa) volta para a grade: deixar o modo
  // "mapa" aceso sem mapa para mostrar daria um painel vazio sem explicação.
  useEffect(() => {
    if (!mapaDoProduto) setModoDoEstoque("grade");
  }, [mapaDoProduto]);

  return (
    // ⚠️ A TELA TEM A ALTURA DO <main> E NÃO ROLA. O portal comercial já deixa o main com
    // `height:100dvh` e rolagem própria (TEMA_CSS, `.inc--comercial .inc-conteudo`); aqui o
    // conteúdo passa a caber nele, e quem rola são os painéis. Cabeçalho e faixa do fluxo ficam
    // sempre à vista, que é o ponto: eles são a bússola da tela.
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 16,
        height: "100%",
        minHeight: 0,
      }}
    >
      {/* ⚠️ SEM TÍTULO NEM SUBTÍTULO (Lucas, 03/09/2026: *"tirar essa venda, e o texto abaixo,
          trazer o filtro do empreendimento mais a mesa (...) mais o Panorama"*). A aba do menu já
          diz Venda, e o subtítulo explicava a tela para quem a usa o dia inteiro. O que sobra é o
          que se opera: à esquerda o que estou vendo, à direita sobre o quê.

          "Mesa" virou "Venda" e "Panorama" virou "Painel", também a pedido dele. */}
      <header
        style={{
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
          <Pilula
            ativo={visao === "panorama"}
            onClick={() => setVisao("panorama")}
            rotulo="Painel"
          />
          <Pilula ativo={visao === "mesa"} onClick={() => setVisao("mesa")} rotulo="Venda" />
        </div>

        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
          {/* A janela só muda o Panorama; na Mesa ela ficaria sem efeito e confundiria. */}
          {visao === "panorama" ? (
            <select
              aria-label="Período"
              onChange={(e) => setJanela(e.target.value)}
              style={{
                background: T.card,
                border: `1px solid ${T.border}`,
                borderRadius: 999,
                color: T.text,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                padding: "7px 12px",
              }}
              value={janela}
            >
              {JANELAS.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.rotulo}
                </option>
              ))}
            </select>
          ) : null}

          {produtos.length > 1 ? (
            <select
              aria-label="Empreendimento"
              onChange={(e) => {
                setEmp(e.target.value);
                // Trocar de produto sem zerar o recorte deixaria um filho de OUTRO pai escolhido.
                setRecorte("");
                setFoco(null);
              }}
              style={{
                background: T.card,
                border: `1px solid ${T.border}`,
                borderRadius: 999,
                color: T.text,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                padding: "7px 12px",
              }}
              value={emp}
            >
              <option value="">Todos os empreendimentos</option>
              {produtos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          ) : null}

          {/* ⚠️ O SUBFILTRO SÓ APARECE COM FILHOS. Pedido do Lucas: um Vale do Ouro no seletor, e o
              recorte (Cecílio, Lino) num filtro à parte. Produto sem filho não mostra nada — um
              seletor com uma opção só é ruído. */}
          {(produtoEscolhido?.filhos.length ?? 0) > 0 ? (
            <select
              aria-label="Recorte do empreendimento"
              onChange={(e) => {
                setRecorte(e.target.value);
                setFoco(null);
              }}
              style={{
                background: T.card,
                border: `1px solid ${T.gold}`,
                borderRadius: 999,
                color: T.text,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                padding: "7px 12px",
              }}
              value={recorte}
            >
              <option value="">Todo o {produtoEscolhido?.nome}</option>
              {produtoEscolhido?.filhos.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.nome}
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </header>

      {erro ? (
        <p
          style={{
            background: T.dangerBg,
            border: `1px solid ${T.danger}`,
            borderRadius: 10,
            color: T.danger,
            fontSize: 13.5,
            fontWeight: 600,
            margin: 0,
            padding: "10px 13px",
          }}
        >
          {erro}
        </p>
      ) : null}

      {/* ── A FAIXA DO FLUXO ─────────────────────────────────────────────── */}
      <div
        style={{
          display: "grid",
          gap: 8,
          gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        }}
      >
        {FLUXO.map((passo) => {
          const dado = dados?.fluxo.find((f) => f.etapa === passo.etapa);
          const ativo = etapa === passo.etapa;
          const Icone = passo.icone;
          return (
            <button
              key={passo.etapa}
              onClick={() => {
                setEtapa(passo.etapa);
                setFoco(null);
                setVisao("mesa");
              }}
              style={{
                background: T.card,
                border: `1px solid ${T.border}`,
                borderLeft: `4px solid ${passo.cor}`,
                borderRadius: 12,
                color: T.text,
                cursor: "pointer",
                font: "inherit",
                outline: ativo ? `2px solid ${passo.cor}` : "none",
                outlineOffset: 1,
                padding: "12px 13px",
                textAlign: "left",
              }}
              type="button"
            >
              <span
                style={{
                  alignItems: "center",
                  color: T.muted,
                  display: "flex",
                  fontSize: 10.5,
                  fontWeight: 700,
                  gap: 6,
                  letterSpacing: ".07em",
                  textTransform: "uppercase",
                }}
              >
                <Icone aria-hidden="true" size={13} />
                {passo.rotulo}
              </span>
              <div
                style={{
                  fontSize: 25,
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 650,
                  lineHeight: 1.05,
                  marginTop: 7,
                }}
              >
                {carregando ? "—" : inteiro(dado?.quantidade ?? 0)}
              </div>
              <div
                style={{
                  color: T.muted,
                  fontSize: 11.5,
                  fontVariantNumeric: "tabular-nums",
                  marginTop: 3,
                }}
              >
                {carregando ? "carregando…" : dinheiro(dado?.vgv ?? 0)}
              </div>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", flex: "1 1 auto", minHeight: 0 }}>
      {visao === "mesa" ? (
        <Mesa
          aoFocar={setFoco}
          aoTrocarModo={setModoDoEstoque}
          carregando={carregando}
          dados={dados}
          etapa={etapa}
          foco={foco}
          lista={daEtapa}
          livres={livres}
          mapaDoProduto={mapaDoProduto}
          modo={modoDoEstoque}
        />
      ) : (
        <Panorama dados={dados} />
      )}
      </div>
    </div>
  );
}

// ── A MESA ──────────────────────────────────────────────────────────────────

function Mesa({
  aoFocar,
  aoTrocarModo,
  carregando,
  dados,
  etapa,
  foco,
  lista,
  livres,
  mapaDoProduto,
  modo,
}: {
  aoFocar: (f: null | Foco) => void;
  aoTrocarModo: (m: "grade" | "mapa") => void;
  carregando: boolean;
  dados: FluxoDeVenda | null;
  etapa: "disponivel" | EtapaDoFluxo;
  foco: null | Foco;
  lista: FluxoDeVenda["lista"];
  livres: (UnidadeNoMapa & { grupo: string })[];
  mapaDoProduto: null | CardDeProduto;
  modo: "grade" | "mapa";
}) {
  // O tema vai para o iframe do masterplan: outro documento não herda variável CSS de ninguém.
  const { efetivo } = useTemaDoPortal();
  const rotulo = FLUXO.find((f) => f.etapa === etapa)?.rotulo ?? "Propostas";

  // ⚠️ CLICAR NO LOTE DO ESPELHO ABRE A FICHA AO LADO (Lucas, 03/09/2026: *"quando eu clicar no
  // lote na imagem, tem que interagir com o painel ao lado, esse que traz os dados"*). O espelho é
  // um <iframe> de MESMA ORIGEM (a rota do portal), então dá para escutar o clique lá dentro sem
  // postMessage nem tocar no arquivo aprovado do masterplan.
  //
  // ⚠️ O LISTENER ENTRA NO `onLoad`, e não uma vez só: o iframe recarrega quando o tema muda ou o
  // produto troca, e um listener preso ao documento antigo morre com ele, deixando o clique mudo.
  const aoClicarNoEspelho = useCallback(
    (frame: HTMLIFrameElement) => {
      const doc = frame.contentDocument;
      if (!doc) return;

      doc.addEventListener("click", (evento) => {
        // O script do espelho só preenche a ficha DEPOIS do clique dele: o `setTimeout(0)` deixa a
        // seleção acontecer antes de a gente ler o resultado.
        const alvo = evento.target as Element | null;
        if (!alvo || alvo.tagName.toLowerCase() !== "polygon") return;

        window.setTimeout(() => {
          const escolhido = loteSelecionadoNoEspelho(doc);
          if (!escolhido) return;

          const achada = (dados?.mapa ?? [])
            .flatMap((g) => g.unidades)
            .find(
              (u) =>
                String(u.quadra ?? "").trim() === escolhido.quadra &&
                String(u.lote ?? "").trim() === escolhido.lote,
            );
          if (achada) aoFocar({ tipo: "unidade", unidade: achada });
        }, 0);
      });
    },
    [aoFocar, dados],
  );

  // ⚠️ BUSCA E FILTRO SÃO PADRÃO EM VISÃO ANALÍTICA (Lucas, 03/09/2026: *"no analítico, coloca
  // filtros, buscar. Sempre ter isso como padrão em visões analíticas"*). A busca zera ao trocar de
  // etapa: o texto que fazia sentido em "reserva" quase nunca faz em "faturamento", e um filtro
  // esquecido mostra lista vazia sem explicar por quê.
  const [busca, setBusca] = useState("");
  const [imobiliaria, setImobiliaria] = useState("");
  const [quadra, setQuadra] = useState("");
  useEffect(() => {
    setBusca("");
    setImobiliaria("");
    setQuadra("");
  }, [etapa]);

  const procurado = normalizar(busca);

  const imobiliarias = useMemo(
    () => [...new Set(lista.map((l) => l.imobiliaria).filter((n): n is string => Boolean(n)))].sort(
      (a, b) => a.localeCompare(b, "pt-BR"),
    ),
    [lista],
  );

  const listaFiltrada = useMemo(
    () =>
      lista.filter(
        (l) =>
          (!imobiliaria || l.imobiliaria === imobiliaria) &&
          (contem(l.unidade, procurado) ||
            contem(l.cliente, procurado) ||
            contem(l.imobiliaria, procurado) ||
            contem(l.produto, procurado)),
      ),
    [imobiliaria, lista, procurado],
  );

  const quadras = useMemo(
    () => [...new Set(livres.map((u) => u.quadra ?? u.grupo))].sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true })),
    [livres],
  );

  const livresFiltrados = useMemo(
    () =>
      livres.filter((u) => {
        const nome = comoSeEscreve(u.codigo, u.quadra ?? u.grupo, u.lote);
        return (
          (!quadra || (u.quadra ?? u.grupo) === quadra) &&
          (contem(nome.unidade, procurado) ||
            contem(nome.recorte, procurado) ||
            contem(u.codigo, procurado))
        );
      }),
    [livres, procurado, quadra],
  );
  const estoque = dados?.totais.estoque ?? {};
  // ⚠️ SÓ AS PRIMEIRAS QUADRAS. São 5.528 unidades no escopo inteiro: desenhar todas trava o
  // navegador e ninguém lê. Com um empreendimento escolhido, o mapa dele cabe inteiro.
  const grupos = (dados?.mapa ?? []).slice(0, 30);

  // O que o painel mostra. Vindo do mapa, a proposta é achada pelo id da unidade — a mais recente,
  // porque a lista já chega ordenada por `etapa_desde` decrescente.
  const unidadeEmFoco = foco?.tipo === "unidade" ? foco.unidade : null;
  const propostaEmFoco =
    foco?.tipo === "proposta"
      ? foco.proposta
      : unidadeEmFoco
        ? ((dados?.lista ?? []).find((l) => l.unidadeId === unidadeEmFoco.id) ?? null)
        : null;
  const idEmFoco = unidadeEmFoco?.id ?? propostaEmFoco?.unidadeId ?? null;

  return (
    // ⚠️ `alignItems: start` SAIU. Ele encolhia as colunas para a altura do conteúdo, e era isso
    // que jogava a rolagem para a página inteira. Agora as duas esticam e rolam por dentro.
    <div
      style={{
        display: "grid",
        gap: 14,
        gridTemplateColumns: "minmax(0, 1.35fr) minmax(300px, .65fr)",
        minHeight: 0,
        width: "100%",
      }}
    >
      {/* A coluna do estoque: o quadro em cima com altura própria (até 55% da área, para a lista
          nunca virar uma faixa de três linhas) e o analítico embaixo ocupando o resto. Os dois
          rolam por dentro, cada um com a sua barra. */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          minHeight: 0,
          minWidth: 0,
          overflow: "auto",
        }}
      >
        <Cartao
          direita={
            <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 12 }}>
              {modo === "grade"
                ? LEGENDA.filter((l) => (estoque[l.etapa] ?? 0) > 0).map(({ etapa: chave, rotulo: nome }) => (
                    <span
                      key={chave}
                      style={{
                        color: T.muted,
                        fontSize: 11.5,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                      }}
                    >
                      <i
                        style={{
                          background: COR_DA_ETAPA[chave],
                          borderRadius: 3,
                          display: "inline-block",
                          height: 10,
                          marginRight: 5,
                          width: 10,
                        }}
                      />
                      {nome} {inteiro(estoque[chave] ?? 0)}
                    </span>
                  ))
                : null}

              {/* A escolha da vista. Só aparece com um produto que TEM masterplan. */}
              {mapaDoProduto ? (
                <div style={{ display: "flex", gap: 6 }}>
                  <Pilula
                    ativo={modo === "grade"}
                    onClick={() => aoTrocarModo("grade")}
                    rotulo="Grade"
                  />
                  <Pilula
                    ativo={modo === "mapa"}
                    onClick={() => aoTrocarModo("mapa")}
                    rotulo="Espelho"
                  />
                </div>
              ) : null}
            </div>
          }
          titulo="Estoque"
        >
          {/* ⚠️ O MASTERPLAN VIVE NUM <iframe> e não herda o tema: ele vai na query, como na tela
              cheia antiga. A altura é fixa porque o card está num grid — sem ela o iframe colapsa
              para zero e o mapa "não aparece". */}
          {modo === "mapa" && mapaDoProduto?.masterplanInterno ? (
            <iframe
              onLoad={(e) => aoClicarNoEspelho(e.currentTarget)}
              src={`/api/incorporador/masterplan?code=${encodeURIComponent(mapaDoProduto.masterplanInterno)}&tema=${efetivo}&so=espelho`}
              style={{
                background: T.soft,
                border: `1px solid ${T.border}`,
                borderRadius: 10,
                display: "block",
                height: "min(72vh, 720px)",
                width: "100%",
              }}
              title={`Espelho · ${mapaDoProduto.nome}`}
            />
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gap: 14,
                  gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                }}
              >
            {grupos.map((g) => (
              <div key={g.grupo}>
                <div
                  style={{
                    color: T.muted,
                    fontSize: 10.5,
                    fontWeight: 700,
                    letterSpacing: ".06em",
                    marginBottom: 5,
                    textTransform: "uppercase",
                  }}
                >
                  {g.grupo}
                </div>
                <div style={{ display: "grid", gap: 3, gridTemplateColumns: "repeat(6, 1fr)" }}>
                  {g.unidades.slice(0, 60).map((u) => (
                    <button
                      key={u.codigo}
                      onClick={() => aoFocar({ tipo: "unidade", unidade: u })}
                      style={{
                        aspectRatio: "1 / 1.25",
                        background: COR_DA_ETAPA[u.etapa] ?? T.soft,
                        border: 0,
                        borderRadius: 3,
                        color: textoNoQuadrado(u.etapa),
                        cursor: "pointer",
                        display: "grid",
                        font: "inherit",
                        fontSize: 8.5,
                        fontWeight: 600,
                        outline: idEmFoco === u.id ? `2.5px solid ${T.text}` : undefined,
                        outlineOffset: 1,
                        padding: 0,
                        placeItems: "center",
                      }}
                      // O código aparece aqui com a conotação de código, como o Lucas pediu: é a
                      // única porta onde ele serve, para quem precisa cruzar com o backend.
                      title={`${comoSeEscreve(u.codigo, u.quadra, u.lote).unidade} · ${
                        ROTULO_DA_ETAPA[u.etapa] ?? u.etapa
                      } · código ${u.codigo}`}
                      type="button"
                    >
                      {u.lote ?? ""}
                    </button>
                  ))}
                </div>
              </div>
            ))}
              </div>

              {!carregando && grupos.length === 0 ? (
                <p style={{ color: T.muted, fontSize: 13, margin: 0, textAlign: "center" }}>
                  Nenhuma unidade no recorte.
                </p>
              ) : null}
              {(dados?.mapa.length ?? 0) > 30 ? (
                <p style={{ color: T.muted, fontSize: 11.5, margin: "12px 0 0" }}>
                  Mostrando 30 de {inteiro(dados?.mapa.length ?? 0)} quadras. Escolha um
                  empreendimento no alto para ver o estoque inteiro dele.
                </p>
              ) : null}
            </>
          )}
        </Cartao>

        {etapa === "disponivel" ? (
          <Cartao
            barra={
              <>
                <Busca
                  aoMudar={setBusca}
                  placeholder="Buscar quadra, lote ou código"
                  valor={busca}
                />
                <Filtro
                  aoMudar={setQuadra}
                  opcoes={quadras}
                  rotuloDeTodos="Todas as quadras"
                  valor={quadra}
                />
                <span style={{ color: T.muted, fontSize: 11.5, marginLeft: "auto" }}>
                  {inteiro(livresFiltrados.length)} de {inteiro(livres.length)}
                </span>
              </>
            }
            rolagem
            titulo={`Disponíveis · ${inteiro(livres.length)}`}
          >
            <div style={{ margin: "-16px", overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
                <thead>
                  <tr>
                    {["Unidade", "Valor de tabela"].map((c, i) => (
                      <th
                        key={c}
                        style={{
                          color: T.muted,
                          fontSize: 10.5,
                          fontWeight: 650,
                          letterSpacing: ".05em",
                          padding: "10px 12px",
                          textAlign: i === 1 ? "right" : "left",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {livresFiltrados.slice(0, 150).map((u) => (
                    <tr
                      key={u.id}
                      onClick={() => aoFocar({ tipo: "unidade", unidade: u })}
                      style={{
                        background: idEmFoco === u.id ? T.soft : undefined,
                        cursor: "pointer",
                      }}
                    >
                      <td style={celula}>
                        <b>{comoSeEscreve(u.codigo, u.quadra ?? u.grupo, u.lote).unidade}</b>
                        <div style={{ color: T.muted, fontSize: 11.5 }}>
                          {comoSeEscreve(u.codigo, u.quadra ?? u.grupo, u.lote).recorte ?? ""}
                        </div>
                      </td>
                      <td
                        style={{ ...celula, fontVariantNumeric: "tabular-nums", textAlign: "right" }}
                      >
                        {u.preco ? dinheiro(u.preco) : "—"}
                      </td>
                    </tr>
                  ))}
                  {livresFiltrados.length === 0 ? (
                    <tr>
                      <td colSpan={2} style={{ ...celula, color: T.muted, textAlign: "center" }}>
                        {carregando
                          ? "Carregando…"
                          : livres.length > 0
                            ? "Nenhuma unidade com esse filtro."
                            : "Nenhuma unidade disponível no recorte."}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {livresFiltrados.length > 150 ? (
              <p style={{ color: T.muted, fontSize: 11.5, margin: "12px 0 0" }}>
                Mostrando 150 de {inteiro(livresFiltrados.length)}.
              </p>
            ) : null}
          </Cartao>
        ) : (
        <Cartao
          barra={
            <>
              <Busca
                aoMudar={setBusca}
                placeholder="Buscar unidade, cliente ou imobiliária"
                valor={busca}
              />
              <Filtro
                aoMudar={setImobiliaria}
                opcoes={imobiliarias}
                rotuloDeTodos="Todas as imobiliárias"
                valor={imobiliaria}
              />
              <span style={{ color: T.muted, fontSize: 11.5, marginLeft: "auto" }}>
                {inteiro(listaFiltrada.length)} de {inteiro(lista.length)}
              </span>
            </>
          }
          rolagem
          titulo={`${rotulo} · ${inteiro(lista.length)}`}
        >
          <div style={{ margin: "-16px", overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
              <thead>
                <tr>
                  {["Unidade", "Cliente", "Imobiliária", rotuloDaData(etapa), "Valor"].map((c, i) => (
                    <th
                      key={c}
                      style={{
                        color: T.muted,
                        fontSize: 10.5,
                        fontWeight: 650,
                        letterSpacing: ".05em",
                        padding: "10px 12px",
                        textAlign: i === 4 ? "right" : "left",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {listaFiltrada.slice(0, 150).map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => aoFocar({ proposta: l, tipo: "proposta" })}
                    style={{
                      background: propostaEmFoco?.id === l.id ? T.soft : undefined,
                      cursor: "pointer",
                    }}
                  >
                    <td style={celula}>
                      <b>{l.unidade ?? "—"}</b>
                      <div style={{ color: T.muted, fontSize: 11.5 }}>{l.produto ?? ""}</div>
                    </td>
                    <td style={celula}>{l.cliente ? toTitleCase(l.cliente) : "—"}</td>
                    <td style={celula}>{l.imobiliaria ? toTitleCase(l.imobiliaria) : "—"}</td>
                    <td style={{ ...celula, color: T.muted }}>{dia(l.desde)}</td>
                    <td
                      style={{ ...celula, fontVariantNumeric: "tabular-nums", textAlign: "right" }}
                    >
                      {l.valor ? dinheiro(l.valor) : "—"}
                    </td>
                  </tr>
                ))}
                {listaFiltrada.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ ...celula, color: T.muted, textAlign: "center" }}>
                      {carregando
                        ? "Carregando…"
                        : lista.length > 0
                          ? "Nenhuma proposta com esse filtro."
                          : "Nenhuma proposta nesta etapa."}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          {listaFiltrada.length > 150 ? (
            <p style={{ color: T.muted, fontSize: 11.5, margin: "12px 0 0" }}>
              Mostrando as 150 mais recentes de {inteiro(listaFiltrada.length)}.
            </p>
          ) : null}
        </Cartao>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 14,
          minHeight: 0,
          // A rede: se a ficha e o simulador sozinhos passarem da altura (tela muito baixa), a
          // coluna rola em vez de cortar. Em uso normal a barra aparece só no histórico.
          overflow: "auto",
        }}
      >
        <Cartao
          direita={
            unidadeEmFoco ? (
              <span
                style={{
                  background: COR_DA_ETAPA[unidadeEmFoco.etapa] ?? T.soft,
                  borderRadius: 999,
                  color: FUNDO_ESCURO.has(unidadeEmFoco.etapa)
                    ? "rgb(255 255 255 / .92)"
                    : "rgb(0 0 0 / .7)",
                  fontSize: 11,
                  fontWeight: 650,
                  padding: "2px 9px",
                }}
              >
                {ROTULO_DA_ETAPA[unidadeEmFoco.etapa] ?? unidadeEmFoco.etapa}
              </span>
            ) : null
          }
          // ⚠️ O TÍTULO CARREGA O RECORTE quando existe (Lucas, 03/09/2026: *"quando tiver filho
          // essa unidade tem que fazer referência"*). "04 04" sozinho é ambíguo num produto
          // dividido: existe um 04 04 em VOC e outro em VOL, e são lotes diferentes.
          // ⚠️ A SIGLA VEM PRIMEIRO (Lucas, 03/09/2026: *"trocar de lugar, começar com a sigla"*).
          // "VOL · 04 04" se lê como endereço: primeiro onde, depois qual. Com o número na frente,
          // dois lotes de recortes diferentes começam iguais e só se separam no fim.
          titulo={
            unidadeEmFoco
              ? [
                  comoSeEscreve(unidadeEmFoco.codigo, unidadeEmFoco.quadra, unidadeEmFoco.lote)
                    .recorte,
                  comoSeEscreve(unidadeEmFoco.codigo, unidadeEmFoco.quadra, unidadeEmFoco.lote)
                    .unidade,
                ]
                  .filter(Boolean)
                  .join(" · ")
              : [propostaEmFoco?.produto, propostaEmFoco?.unidade].filter(Boolean).join(" · ") ||
                "Nada escolhido"
          }
        >
          {unidadeEmFoco || propostaEmFoco ? (
            <>
              {unidadeEmFoco?.preco ? (
                <Linha rotulo="Valor de tabela" valor={dinheiro(unidadeEmFoco.preco)} />
              ) : null}
              {propostaEmFoco ? (
                <>
                  {/* ⚠️ ETAPA E PRODUTO SAÍRAM DA LISTA (Lucas, 03/09/2026): a etapa já está no selo
                      aqui em cima e o produto no filtro do topo. Repetir os dois gastava duas linhas
                      da ficha para dizer o que a tela já dizia duas vezes. */}
                  <Linha
                    rotulo={rotuloDaData(propostaEmFoco.etapa)}
                    valor={dia(propostaEmFoco.desde)}
                  />
                  <Linha
                    rotulo="Valor negociado"
                    valor={propostaEmFoco.valor ? dinheiro(propostaEmFoco.valor) : "—"}
                  />
                  <Linha rotulo="Cliente" valor={toTitleCase(propostaEmFoco.cliente) || "—"} />
                  <Linha rotulo="Imobiliária" valor={toTitleCase(propostaEmFoco.imobiliaria) || "—"} />
                  {/* O FLUXO do contrato, não o nome do plano — a mesma escrita do extrato. */}
                  <Linha rotulo="Plano" valor={propostaEmFoco.plano ?? "—"} />
                </>
              ) : (
                // ⚠️ SEM PROPOSTA NÃO É ERRO: é lote livre, e o simulador abaixo já vem com o preço
                // dele. É o caminho normal de uma venda que vai começar.
                <p style={{ color: T.muted, fontSize: 12.5, margin: "8px 0 0" }}>
                  Nenhuma proposta nesta unidade. O simulador abaixo já está com o valor de tabela.
                </p>
              )}
            </>
          ) : (
            <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>
              Clique num lote do mapa ou numa linha da lista.
            </p>
          )}
          <p style={{ color: T.muted, fontSize: 11.5, margin: "12px 0 0" }}>
            Reservar, gerar proposta e cancelar com motivo entram quando a tabela de reservas subir.
            Hoje esta tela lê o fluxo já importado e não grava.
          </p>
        </Cartao>

        <div style={{ flex: "0 0 auto" }}>
          <Simulador
            chave={unidadeEmFoco?.id ?? propostaEmFoco?.id ?? ""}
            valor={propostaEmFoco?.valor || (unidadeEmFoco?.preco ?? 0)}
          />
        </div>

        <Historico unidadeId={idEmFoco} />
      </div>
    </div>
  );
}

// ── O SIMULADOR ─────────────────────────────────────────────────────────────
//
// Calcula aqui no navegador: é conta, não integração. O que ele ainda não faz é GRAVAR a proposta —
// e é isso que a frase no rodapé diz, para ninguém achar que emitiu.
function Simulador({ chave, valor }: { chave: string; valor: number }) {
  const [tabela, setTabela] = useState(0);
  const [desconto, setDesconto] = useState(0);
  const [entrada, setEntrada] = useState(0);
  const [parcelas, setParcelas] = useState(180);

  // ⚠️ A PROPOSTA ESCOLHIDA RECOMEÇA A SIMULAÇÃO. Sem depender da `chave`, quem digitasse um
  // desconto e clicasse em outra linha veria o valor novo com o desconto antigo — uma conta errada
  // com cara de certa.
  useEffect(() => {
    setTabela(valor);
    setEntrada(Math.round(valor * 0.1));
    setDesconto(0);
  }, [chave, valor]);

  const final = Math.max(0, tabela * (1 - desconto / 100));
  const financiado = Math.max(0, final - entrada);
  const mensal = parcelas > 0 ? financiado / parcelas : 0;

  const campo = (rotulo: string, v: number, aoMudar: (n: number) => void, sufixo?: string) => (
    <label style={{ display: "grid", gap: 3 }}>
      <span style={{ color: T.muted, fontSize: 11, fontWeight: 650 }}>{rotulo}</span>
      <span style={{ alignItems: "center", display: "flex", gap: 6 }}>
        <input
          onChange={(e) => aoMudar(Number(e.target.value) || 0)}
          style={{
            background: T.soft,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            color: T.text,
            font: "inherit",
            fontSize: 13.5,
            fontVariantNumeric: "tabular-nums",
            fontWeight: 600,
            padding: "7px 10px",
            width: "100%",
          }}
          type="number"
          value={String(Math.round(v * 100) / 100)}
        />
        {sufixo ? <span style={{ color: T.muted, fontSize: 12 }}>{sufixo}</span> : null}
      </span>
    </label>
  );

  return (
    <Cartao titulo="Simulador de proposta">
      <div style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "grid", gap: 9, gridTemplateColumns: "1fr 1fr" }}>
          {campo("Valor de tabela", tabela, setTabela)}
          {campo("Desconto", desconto, setDesconto, "%")}
          {campo("Entrada", entrada, setEntrada)}
          {campo("Parcelas", parcelas, setParcelas, "x")}
        </div>

        <div style={{ background: T.soft, borderRadius: 9, padding: "10px 12px" }}>
          <Linha rotulo="Valor final" valor={dinheiro(final)} />
          <Linha rotulo="A financiar" valor={dinheiro(financiado)} />
          <Linha rotulo="Parcela mensal" valor={dinheiro(mensal)} />
        </div>

        <p style={{ color: T.muted, fontSize: 11.5, margin: 0 }}>
          Conta simples, sem correção nem juros: é a ordem de grandeza para responder ao cliente na
          hora. O plano comercial do empreendimento entra junto com a emissão da proposta.
        </p>
      </div>
    </Cartao>
  );
}

// ── O PANORAMA ──────────────────────────────────────────────────────────────

function Panorama({ dados }: { dados: FluxoDeVenda | null }) {
  if (!dados) {
    return (
      <Cartao titulo="Panorama">
        <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>Carregando…</p>
      </Cartao>
    );
  }

  const faturadas = dados.fluxo.find((f) => f.etapa === "faturado")?.quantidade ?? 0;
  const emAndamento = dados.fluxo
    .filter((f) => f.etapa !== "faturado")
    .reduce((a, f) => a + f.quantidade, 0);
  const perdidas = dados.perdas.canceladas + dados.perdas.distratos;
  const decididas = faturadas + perdidas;
  const conversao = decididas > 0 ? (faturadas / decididas) * 100 : 0;
  const ticket = faturadas > 0 ? dados.totais.vgvFaturado / faturadas : 0;
  const comMotivo = dados.motivos.reduce((a, m) => a + m.n, 0);
  const maiorSerie = Math.max(1, ...dados.serie.map((s) => s.faturadas));
  const maiorFunil = Math.max(1, ...dados.fluxo.map((f) => f.quantidade));

  return (
    <div
      style={{
        display: "grid",
        gap: 14,
        gridAutoRows: "min-content",
        minHeight: 0,
        overflow: "auto",
        width: "100%",
      }}
    >
      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
        }}
      >
        <Kpi
          nota={`${inteiro(faturadas)} propostas`}
          rotulo="VGV faturado"
          valor={dinheiro(dados.totais.vgvFaturado)}
        />
        <Kpi nota="das propostas faturadas" rotulo="Ticket médio" valor={dinheiro(ticket)} />
        <Kpi
          nota="propostas vivas, fora do faturamento"
          rotulo="Em andamento"
          valor={inteiro(emAndamento)}
        />
        <Kpi
          nota={`${inteiro(faturadas)} de ${inteiro(decididas)} decididas`}
          rotulo="Conversão"
          valor={`${conversao.toFixed(0)}%`}
        />
        <Kpi
          nota={`${inteiro(dados.perdas.distratos)} distratos`}
          rotulo="Canceladas"
          valor={inteiro(dados.perdas.canceladas)}
        />
        <Kpi
          nota="que saiu do caminho"
          rotulo="VGV perdido"
          valor={dinheiro(dados.perdas.vgvCancelado)}
        />
      </div>

      <div
        style={{
          display: "grid",
          gap: 14,
          gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
        }}
      >
        <Cartao titulo="O funil">
          <div style={{ display: "grid", gap: 9 }}>
            {/* ⚠️ AS CADs SÃO OUTRA FONTE, e a barra diz isso na cor. CAD é cadastro (Apolo);
                reserva para baixo é venda (o fluxo importado do C2X). Pedido do Lucas: *"quantas
                cads foram geradas, quantas reservas, propostas"* — na mesma escada. Com todos os
                empreendimentos a esteira não recorta, e aí a CAD não aparece. */}
            {dados.cads
              ? [
                  { n: dados.cads.total, nota: `${inteiro(dados.cads.emCorrecao)} em correção`, rotulo: "CADs geradas" },
                  { n: dados.cads.credenciados, nota: `${inteiro(dados.cads.reprovadas)} reprovadas`, rotulo: "Credenciados" },
                ].map((c) => (
                  <div key={c.rotulo} style={{ display: "grid", gap: 4 }}>
                    <div style={{ display: "flex", fontSize: 12.5, justifyContent: "space-between" }}>
                      <span style={{ color: T.sub }}>{c.rotulo}</span>
                      <b style={{ fontVariantNumeric: "tabular-nums" }}>{inteiro(c.n)}</b>
                    </div>
                    <div style={{ background: T.soft, borderRadius: 5, height: 20, overflow: "hidden" }}>
                      <i
                        style={{
                          background: T.muted,
                          display: "block",
                          height: "100%",
                          width: `${Math.max(2, (c.n / Math.max(1, dados.cads!.total)) * 100)}%`,
                        }}
                      />
                    </div>
                    <span style={{ color: T.muted, fontSize: 11 }}>{c.nota}</span>
                  </div>
                ))
              : null}

            {dados.fluxo.map((f) => {
              const passo = FLUXO.find((x) => x.etapa === f.etapa);
              return (
                <div key={f.etapa} style={{ display: "grid", gap: 4 }}>
                  <div style={{ display: "flex", fontSize: 12.5, justifyContent: "space-between" }}>
                    <span style={{ color: T.sub }}>{passo?.rotulo ?? f.etapa}</span>
                    <b style={{ fontVariantNumeric: "tabular-nums" }}>{inteiro(f.quantidade)}</b>
                  </div>
                  <div
                    style={{ background: T.soft, borderRadius: 5, height: 20, overflow: "hidden" }}
                  >
                    <i
                      style={{
                        background: passo?.cor ?? T.gold,
                        display: "block",
                        height: "100%",
                        width: `${Math.max(2, (f.quantidade / maiorFunil) * 100)}%`,
                      }}
                    />
                  </div>
                  <span style={{ color: T.muted, fontSize: 11 }}>{dinheiro(f.vgv)}</span>
                </div>
              );
            })}
          </div>
          <p style={{ color: T.muted, fontSize: 11.5, margin: "12px 0 0" }}>
            {dados.periodo.de
              ? `Desempenho de ${mesCurto(dados.periodo.de)} a ${mesCurto(dados.periodo.ate ?? dados.periodo.de)}: ${inteiro(dados.periodo.propostasNoPeriodo)} propostas na janela.`
              : `${inteiro(dados.totais.propostas)} propostas no escopo, com o histórico inteiro desde 2023.`}{" "}
            As barras de reserva para baixo são o pipeline de HOJE, que a janela não filtra;{" "}
            {inteiro(perdidas)} saíram do caminho e não aparecem nelas.
          </p>
        </Cartao>

        <Cartao titulo="Quem está vendendo">
          {dados.ranking.length > 0 ? (
            <div style={{ margin: "-16px", overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%" }}>
                <thead>
                  <tr>
                    {["Imobiliária", "Propostas", "Vendidas", "VGV"].map((c, i) => (
                      <th
                        key={c}
                        style={{
                          color: T.muted,
                          fontSize: 10.5,
                          fontWeight: 650,
                          padding: "10px 12px",
                          textAlign: i === 0 ? "left" : "right",
                        }}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dados.ranking.slice(0, 10).map((r) => (
                    <tr key={r.imobiliaria}>
                      <td style={celula}>{toTitleCase(r.imobiliaria)}</td>
                      <td style={{ ...celula, textAlign: "right" }}>{inteiro(r.propostas)}</td>
                      <td style={{ ...celula, textAlign: "right" }}>{inteiro(r.vendidas)}</td>
                      <td
                        style={{
                          ...celula,
                          fontVariantNumeric: "tabular-nums",
                          textAlign: "right",
                        }}
                      >
                        {dinheiro(r.vgv)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>Sem imobiliária no recorte.</p>
          )}
        </Cartao>
      </div>

      <Cartao titulo="Mês a mês">
        {dados.serie.length > 0 ? (
          <div style={{ alignItems: "flex-end", display: "flex", gap: 8, minHeight: 140 }}>
            {dados.serie.slice(-18).map((s) => (
              <div key={s.mes} style={{ display: "grid", flex: 1, gap: 5, justifyItems: "center" }}>
                <b style={{ fontSize: 11, fontVariantNumeric: "tabular-nums" }}>{s.faturadas}</b>
                <div
                  style={{
                    background: T.gold,
                    borderRadius: "4px 4px 0 0",
                    height: `${Math.max(3, (s.faturadas / maiorSerie) * 100)}px`,
                    width: "100%",
                  }}
                  title={`${s.faturadas} faturadas · ${s.canceladas} canceladas`}
                />
                <div
                  style={{
                    background: T.danger,
                    borderRadius: "0 0 4px 4px",
                    height: `${Math.max(2, (s.canceladas / maiorSerie) * 40)}px`,
                    opacity: 0.55,
                    width: "100%",
                  }}
                />
                <span style={{ color: T.muted, fontSize: 10 }}>{mesCurto(s.mes)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>Sem série no recorte.</p>
        )}
        <p style={{ color: T.muted, fontSize: 11.5, margin: "12px 0 0" }}>
          Dourado é faturamento; a barra vermelha embaixo é o que caiu no mesmo mês.
        </p>
      </Cartao>

      <Cartao titulo="Cancelamentos por motivo">
        {dados.motivos.length > 0 ? (
          <div style={{ display: "grid", gap: 8 }}>
            {dados.motivos.slice(0, 10).map((m) => (
              <div key={m.motivo} style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: T.sub, fontSize: 12.5 }}>{m.motivo}</span>
                <b style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>{m.n}</b>
              </div>
            ))}
          </div>
        ) : null}
        <p style={{ color: T.sub, fontSize: 13, margin: dados.motivos.length > 0 ? "12px 0 0" : 0 }}>
          De {inteiro(perdidas)} propostas que caíram, {inteiro(comMotivo)} têm motivo registrado. O
          legado tinha o campo e ele quase nunca foi preenchido; quando o cancelamento passar a
          acontecer aqui, o motivo vira obrigatório e este quadro deixa de ser um número solto.
        </p>
      </Cartao>
    </div>
  );
}

// ── O HISTÓRICO DA UNIDADE ──────────────────────────────────────────────────
//
// Pedido do Lucas (03/09/2026): *"aqui eu quero ter um histórico de tudo que foi feito naquela
// unidade, tudo tem que ficar registrado, trazendo o que foi feito, quando, por quem tudo, um
// histórico bem completo"*.
//
// ⚠️ CARREGA SÓ QUANDO HÁ UNIDADE EM FOCO, e por rota própria: são 12.295 movimentações na base, e
// mandá-las junto com a tela seria pagar o custo por uma pergunta que quase nunca é feita.
//
// ⚠️ E O EIXO É O LOTE, NÃO A PROPOSTA. O lote 01 04 do Portal dos Vales teve proposta de sete
// clientes diferentes em quatro dias antes de vender: por isso cada evento diz de quem era a
// proposta naquele momento.
function Historico({ unidadeId }: { unidadeId: null | string }) {
  const [eventos, setEventos] = useState<EventoDaUnidade[]>([]);
  const [propostas, setPropostas] = useState(0);
  const [estado, setEstado] = useState<"carregando" | "erro" | "pronto">("pronto");
  const [tudo, setTudo] = useState(false);

  useEffect(() => {
    setTudo(false);
    if (!unidadeId) {
      setEventos([]);
      setPropostas(0);
      return;
    }

    let vivo = true;
    setEstado("carregando");
    void (async () => {
      try {
        const r = await fetch(
          `/api/incorporador/venda/historico?unidade=${encodeURIComponent(unidadeId)}`,
          { cache: "no-store" },
        );
        const j = (await r.json().catch(() => null)) as null | {
          data?: { eventos: EventoDaUnidade[]; propostas: number };
        };
        if (!vivo) return;
        if (!r.ok || !j?.data) {
          setEstado("erro");
          return;
        }
        setEventos(j.data.eventos);
        setPropostas(j.data.propostas);
        setEstado("pronto");
      } catch {
        if (vivo) setEstado("erro");
      }
    })();

    return () => {
      vivo = false;
    };
  }, [unidadeId]);

  if (!unidadeId) return null;

  const visiveis = tudo ? eventos : eventos.slice(0, 12);

  return (
    <Cartao
      rolagem
      direita={
        propostas > 0 ? (
          <span style={{ color: T.muted, fontSize: 11.5 }}>
            {inteiro(propostas)} proposta(s) · {inteiro(eventos.length)} registro(s)
          </span>
        ) : null
      }
      titulo="Histórico da unidade"
    >
      {estado === "carregando" ? (
        <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>Carregando…</p>
      ) : estado === "erro" ? (
        <p style={{ color: T.danger, fontSize: 13, margin: 0 }}>
          Não consegui carregar o histórico agora.
        </p>
      ) : eventos.length === 0 ? (
        <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>
          Nada registrado nesta unidade. Ela nunca teve proposta.
        </p>
      ) : (
        <>
          <div style={{ display: "grid", gap: 0 }}>
            {visiveis.map((e, i) => (
              <div
                key={e.id}
                style={{
                  borderTop: i === 0 ? "none" : `1px dashed ${T.border}`,
                  display: "grid",
                  gap: 2,
                  padding: "8px 0",
                }}
              >
                <div
                  style={{ alignItems: "baseline", display: "flex", gap: 8, justifyContent: "space-between" }}
                >
                  <b style={{ fontSize: 12.5 }}>
                    {/* ⚠️ PAGAMENTO E ASSINATURA GANHAM MARCA. Numa lista de trinta linhas de
                        etapa, o dinheiro que entrou e a assinatura são o que o olho procura. */}
                    {e.tipo === "pagamento" ? (
                      <span style={{ color: T.ok, marginRight: 5 }}>●</span>
                    ) : e.tipo === "assinatura" ? (
                      <span style={{ color: "#a8447f", marginRight: 5 }}>●</span>
                    ) : null}
                    {e.fato}
                    {e.valor ? (
                      <span style={{ color: T.ok, fontWeight: 650 }}> · {dinheiro(e.valor)}</span>
                    ) : null}
                  </b>
                  <span
                    style={{
                      color: T.muted,
                      fontSize: 11.5,
                      fontVariantNumeric: "tabular-nums",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {diaEHora(e.quando)}
                  </span>
                </div>
                {e.cliente ? (
                  <span style={{ color: T.sub, fontSize: 11.5 }}>{e.cliente}</span>
                ) : null}
                <span style={{ color: T.muted, fontSize: 11 }}>
                  {e.quem ? `por ${e.quem}` : "sem autor registrado"}
                  {e.observacao ? ` · ${e.observacao}` : ""}
                </span>
              </div>
            ))}
          </div>

          {eventos.length > 12 && !tudo ? (
            <button
              onClick={() => setTudo(true)}
              style={{
                background: "transparent",
                border: `1px solid ${T.border}`,
                borderRadius: 8,
                color: T.sub,
                cursor: "pointer",
                font: "inherit",
                fontSize: 12,
                fontWeight: 600,
                marginTop: 10,
                padding: "6px 12px",
                width: "100%",
              }}
              type="button"
            >
              Ver os {inteiro(eventos.length)} registros
            </button>
          ) : null}
        </>
      )}
    </Cartao>
  );
}

// ── AS PEÇAS DE UMA VISÃO ANALÍTICA ─────────────────────────────────────────
//
// ⚠️ BUSCA E FILTRO SÃO PADRÃO, e não enfeite desta tela. Lucas (03/09/2026): *"no analítico,
// coloca filtros, buscar. Sempre ter isso como padrão em visões analíticas"*. Toda lista longa
// nasce com os dois — uma tabela de 150 linhas sem busca obriga a rolar procurando com o olho, que
// é o oposto do que uma visão analítica existe para fazer.

function Busca({
  aoMudar,
  placeholder,
  valor,
}: {
  aoMudar: (v: string) => void;
  placeholder: string;
  valor: string;
}) {
  return (
    <span style={{ alignItems: "center", display: "inline-flex", gap: 6, position: "relative" }}>
      <Search
        aria-hidden="true"
        size={13}
        style={{ color: T.muted, left: 10, pointerEvents: "none", position: "absolute" }}
      />
      <input
        onChange={(e) => aoMudar(e.target.value)}
        placeholder={placeholder}
        style={{
          background: T.soft,
          border: `1px solid ${T.border}`,
          borderRadius: 999,
          color: T.text,
          font: "inherit",
          fontSize: 12.5,
          minWidth: 210,
          padding: "6px 12px 6px 28px",
        }}
        type="search"
        value={valor}
      />
    </span>
  );
}

function Filtro({
  aoMudar,
  opcoes,
  rotuloDeTodos,
  valor,
}: {
  aoMudar: (v: string) => void;
  opcoes: string[];
  rotuloDeTodos: string;
  valor: string;
}) {
  // Um filtro com uma opção só não filtra nada: ele só ocupa espaço e sugere uma escolha que não
  // existe.
  if (opcoes.length < 2) return null;

  return (
    <select
      aria-label={rotuloDeTodos}
      onChange={(e) => aoMudar(e.target.value)}
      style={{
        background: T.soft,
        border: `1px solid ${T.border}`,
        borderRadius: 999,
        color: T.text,
        cursor: "pointer",
        font: "inherit",
        fontSize: 12.5,
        fontWeight: 600,
        maxWidth: 230,
        padding: "6px 10px",
      }}
      value={valor}
    >
      <option value="">{rotuloDeTodos}</option>
      {opcoes.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );
}

/** Compara ignorando caixa e acento — o operador digita "sao" e espera achar "SÃO". */
function contem(alvo: null | string | undefined, busca: string): boolean {
  if (!busca) return true;
  return String(alvo ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .includes(busca);
}

/** O texto da busca, pronto para comparar. */
function normalizar(v: string): string {
  return v
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

// ── PEÇAS ───────────────────────────────────────────────────────────────────

const celula = {
  borderTop: `1px solid ${T.border}`,
  padding: "9px 12px",
} as const;

function Cartao({
  barra,
  children,
  direita,
  maxAltura,
  rolagem,
  titulo,
}: {
  /**
   * Uma faixa entre o cabeçalho e o corpo — busca e filtros, tipicamente.
   *
   * ⚠️ FICA FORA DA ÁREA QUE ROLA, de propósito: um campo de busca que some quando a pessoa desce
   * a lista obriga a subir de volta para refinar, e é justamente descendo a lista que se percebe
   * o que precisa ser filtrado.
   */
  barra?: React.ReactNode;
  children: React.ReactNode;
  direita?: React.ReactNode;
  /**
   * Teto de altura, em % da área de trabalho.
   *
   * ⚠️ SEM ELE O ESTOQUE COME O ANALÍTICO. O quadro cresce com a quantidade de quadras — o Vale do
   * Ouro tem 15, o Jardim das Gerais 27 — e numa linha de grid `auto` ele tomaria a altura toda,
   * deixando a lista com três linhas. O teto devolve o resto para quem está embaixo.
   */
  maxAltura?: string;
  /**
   * O corpo rola por dentro, e o cabeçalho fica.
   *
   * ⚠️ É O PEDIDO DO LUCAS (03/09/2026): *"eu não quero a barra de rolagem na tela toda, quero nos
   * painéis (...) teríamos que ter a barra de rolagem no painel que traz o analítico"*. Com a
   * página inteira rolando, descer até a linha 80 da lista levava embora a faixa do fluxo, o mapa
   * e o simulador — some justamente o contexto que faz a lista significar alguma coisa.
   */
  rolagem?: boolean;
  titulo: string;
}) {
  return (
    <section
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 13,
        // `minHeight: 0` é o que permite ao corpo encolher e rolar: sem ele o flex item cresce até
        // o tamanho do conteúdo e empurra a rolagem de volta para a página.
        ...(rolagem
          ? {
              display: "flex",
              flex: "1 1 auto",
              flexDirection: "column",
              minHeight: 240,
              overflow: "hidden",
            }
          : {}),
        ...(maxAltura ? { maxHeight: maxAltura } : {}),
        minWidth: 0,
      }}
    >
      <div
        style={{
          alignItems: "center",
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          justifyContent: "space-between",
          padding: "13px 16px",
        }}
      >
        <h2 style={{ color: T.text, fontSize: 14, fontWeight: 650, margin: 0 }}>{titulo}</h2>
        {direita}
      </div>
      {barra ? (
        <div
          style={{
            alignItems: "center",
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            padding: "10px 16px",
          }}
        >
          {barra}
        </div>
      ) : null}
      <div
        style={{
          minHeight: 0,
          padding: 16,
          ...(rolagem ? { flex: "1 1 auto", overflow: "auto" } : {}),
        }}
      >
        {children}
      </div>
    </section>
  );
}

function Kpi({ nota, rotulo, valor }: { nota: string; rotulo: string; valor: string }) {
  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        padding: "13px 14px",
      }}
    >
      <span
        style={{
          color: T.muted,
          fontSize: 10.5,
          fontWeight: 650,
          letterSpacing: ".07em",
          textTransform: "uppercase",
        }}
      >
        {rotulo}
      </span>
      <div
        style={{ fontSize: 23, fontVariantNumeric: "tabular-nums", fontWeight: 650, marginTop: 6 }}
      >
        {valor}
      </div>
      <div style={{ color: T.muted, fontSize: 11.5, marginTop: 4 }}>{nota}</div>
    </div>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div
      style={{
        borderTop: `1px dashed ${T.border}`,
        display: "flex",
        gap: 10,
        justifyContent: "space-between",
        padding: "6px 0",
      }}
    >
      <span style={{ color: T.sub, fontSize: 12.5 }}>{rotulo}</span>
      <b style={{ fontSize: 12.5, fontVariantNumeric: "tabular-nums", fontWeight: 650 }}>{valor}</b>
    </div>
  );
}
