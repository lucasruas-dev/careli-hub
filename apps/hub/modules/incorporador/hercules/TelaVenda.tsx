"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  Check,
  FileSignature,
  FileText,
  Grid2x2,
  Receipt,
  Search,
  Signature,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { ETAPAS_DO_FLUXO } from "@/lib/hercules/fluxo-de-venda";
import type { EtapaDoEspelho, EtapaDoFluxo, FluxoDeVenda } from "@/lib/hercules/fluxo-de-venda";
import type { EventoDaUnidade } from "@/lib/hercules/historico-da-unidade";

import { toTitleCase } from "@/lib/format/name-case";
import { formatarTelefoneGuardado } from "@/lib/hercules/paises";

import { T, useTemaDoPortal } from "../tema";
import { Pilula } from "./AssinaturasDoProduto";
import { ModalDeReserva } from "./ModalDeReserva";
import { SimuladorDeProposta } from "./SimuladorDeProposta";

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

/**
 * A cor do ponto na linha do tempo.
 *
 * ⚠️ É A MESMA DA GRADE, de propósito. O coordenador já aprendeu que amarelo é reserva, azul é
 * proposta e grafite é assinatura olhando o quadro de lotes; o histórico usar outra paleta o
 * obrigaria a aprender duas. Cancelado e distratado saem em vermelho — antes ficavam no cinza das
 * transições comuns, escondidos no meio da lista.
 */
function corDoEvento(e: EventoDaUnidade): string {
  if (e.tipo === "pagamento") return T.ok;
  if (e.tipo === "assinatura") return COR_DA_ETAPA.assinatura;

  const fato = e.fato.toLowerCase();
  if (/cancelad|reprovad|distrat/.test(fato)) return T.danger;
  if (/faturad|finalizad/.test(fato)) return COR_DA_ETAPA.faturado;
  if (/assinatura/.test(fato)) return COR_DA_ETAPA.assinatura;
  if (/contrato/.test(fato)) return COR_DA_ETAPA.contrato;
  if (/proposta|análise|analise/.test(fato)) return COR_DA_ETAPA.proposta;
  if (/reservad/.test(fato)) return COR_DA_ETAPA.reservado;
  return T.border;
}

/** "31/08/26" — a data curta da coluna da linha do tempo. */
function diaCurto(iso: null | string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  // `noUncheckedIndexedAccess`: o grupo existe se o regex casou, mas o compilador não sabe.
  return m ? `${m[3]}/${m[2]}/${(m[1] ?? "").slice(2)}` : "—";
}

/** "14:20". Dois eventos do mesmo dia têm ordem, e num histórico ela importa. */
function hora(iso: null | string): string {
  const m = /[T ](\d{2}):(\d{2})/.exec(String(iso ?? ""));
  return m ? `${m[1]}:${m[2]}` : "";
}

/**
 * Como a proposta que caiu se chama.
 *
 * Sumiu junto com o painel antigo e voltou porque a ficha de um lote livre precisa dizer o que
 * aconteceu com a última — "cancelada", não "cancelado", porque o sujeito é a proposta.
 */
const ROTULO_TERMINAL: Record<string, string> = {
  cancelado: "Cancelada",
  distrato: "Distratada",
};

/**
 * A proposta está no caminho, ou já saiu dele?
 *
 * A lista das etapas vivas vem do núcleo (`ETAPAS_DO_FLUXO`), e não repetida aqui: é a mesma régua
 * que decide a cor do lote na grade e o que entra na faixa. Duplicá-la seria criar um segundo lugar
 * para alguém esquecer de mexer.
 */
const ehEtapaViva = (etapa: string) => (ETAPAS_DO_FLUXO as readonly string[]).includes(etapa);

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
  const [simulando, setSimulando] = useState<null | UnidadeNoMapa>(null);
  const [reservando, setReservando] = useState<null | UnidadeNoMapa>(null);
  const [recado, setRecado] = useState<null | string>(null);
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

      {/* ── A FAIXA DO FLUXO, SÓ NA MESA ─────────────────────────────────── */}
      {/* ⚠️ Fora do Panorama de propósito: lá embaixo o funil já conta a mesma história, e ter os
          mesmos números em dois desenhos na mesma tela é convite a duvidar de qual está certo. */}
      <div
        style={{
          display: visao === "mesa" ? "grid" : "none",
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

      {/* ⚠️ A FAIXA FICA FORA DO FLEX DE BAIXO. Ela nasceu dentro dele e virou uma COLUNA verde
          vazia do lado do estoque, ocupando a altura toda da tela (Lucas, 04/09/2026: *"não gostei
          desse painel na esquerda mostrando a reserva"*). Aqui ela é o que devia ser: uma linha
          acima do conteúdo, que empurra o resto para baixo e some quando fechada. */}
      {recado ? (
        <div
          style={{
            alignItems: "center",
            background: T.okBg,
            border: `1px solid ${T.ok}`,
            borderRadius: 10,
            color: T.ok,
            display: "flex",
            fontSize: 12.5,
            gap: 12,
            justifyContent: "space-between",
            margin: "0 0 12px",
            padding: "9px 12px",
          }}
        >
          <span>{recado}</span>
          <button
            onClick={() => setRecado(null)}
            style={{
              background: "transparent",
              border: "none",
              color: T.ok,
              cursor: "pointer",
              font: "inherit",
              fontSize: 12,
              fontWeight: 700,
              padding: 0,
            }}
            type="button"
          >
            fechar
          </button>
        </div>
      ) : null}
      <div style={{ display: "flex", flex: "1 1 auto", minHeight: 0 }}>
      {/* ⚠️ A MODAL VIVE AQUI, e não dentro da Mesa: ela cobre a tela inteira, e um <dialog> preso
          a uma coluna herdaria o `overflow: hidden` dela. */}
      {simulando ? (
        <ModalDoSimulador
          // ⚠️ O PISO É DO EMPREENDIMENTO DO LOTE, e não do escopo: num pai com filhos há mais de
          // um produto na tela, e eles podem ter mínimos diferentes.
          entradaMinimaPercentual={dados?.entradaMinima?.[simulando.enterpriseId] ?? null}
          nome={mapaDoProduto?.nome ?? "Simulação"}
          onFechar={() => setSimulando(null)}
          planos={dados?.planos ?? []}
          unidade={simulando}
        />
      ) : null}

      {/* ⚠️ A MODAL DE RESERVA VIVE AQUI PELO MESMO MOTIVO DA DO SIMULADOR: cobre a tela toda, e
          presa a uma coluna herdaria o `overflow: hidden` dela. */}
      {reservando ? (
        <ModalDeReserva
          onFechar={() => setReservando(null)}
          onReservado={(mensagem) => {
            setReservando(null);
            setRecado(mensagem);
            // A unidade mudou de situação: a tela recarrega para o mapa, a grade e o funil
            // contarem a reserva nova. Sem isso o lote continuaria verde até o próximo F5.
            void carregar(recorte || emp, janela);
          }}
          unidade={{
            id: reservando.id,
            nome: (() => {
              const e = comoSeEscreve(reservando.codigo, reservando.quadra, reservando.lote);
              return `Quadra ${e.unidade.split(" ")[0]} · Lote ${e.unidade.split(" ")[1] ?? ""}`.trim();
            })(),
            produto: mapaDoProduto?.nome ?? "",
          }}
          valorDaUnidade={reservando.preco}
        />
      ) : null}


      {visao === "mesa" ? (
        <Mesa
          aoFocar={setFoco}
          aoReservar={setReservando}
          aoSimular={setSimulando}
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
  aoReservar,
  aoSimular,
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
  aoReservar: (u: null | UnidadeNoMapa) => void;
  aoSimular: (u: null | UnidadeNoMapa) => void;
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
          // ⚠️ O COD ENTRA NA BUSCA, e é o primeiro lugar em que alguém o usa: quem recebeu o
          // número no WhatsApp digita ele aqui para achar a venda.
          (contem(l.unidade, procurado) ||
            contem(l.codigo, procurado) ||
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
  // ⚠️ SÓ A PROPOSTA VIVA VIRA A FICHA DA UNIDADE. O Lucas pegou isto olhando o VOC 06 07: o lote
  // aparecia "Disponível" e a ficha mostrava cliente, imobiliária, plano e "Data do cancelamento" —
  // eu casava pelo id da unidade sem olhar a etapa, e pegava a proposta CANCELADA como se fosse a
  // atual. Num lote livre isso é pior do que não mostrar nada: sugere que o lote tem dono.
  const propostasDaUnidade = unidadeEmFoco
    ? (dados?.lista ?? []).filter((l) => l.unidadeId === unidadeEmFoco.id)
    : [];
  const propostaEmFoco =
    foco?.tipo === "proposta"
      ? foco.proposta
      : (propostasDaUnidade.find((l) => ehEtapaViva(l.etapa)) ?? null);

  // A última que caiu, quando não há viva: o lote está livre, mas já teve história — e o coordenador
  // que vai oferecê-lo merece saber disso antes de ligar para o cliente.
  const ultimaQueCaiu =
    propostaEmFoco || !unidadeEmFoco ? null : (propostasDaUnidade[0] ?? null);
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
              <TrilhaDoFluxo etapa={propostaEmFoco?.etapa ?? unidadeEmFoco?.etapa ?? null} />
              {unidadeEmFoco?.preco ? (
                <Linha rotulo="Valor de tabela" valor={dinheiro(unidadeEmFoco.preco)} />
              ) : null}
              {propostaEmFoco ? (
                <>
                  {/* ⚠️ ETAPA E PRODUTO SAÍRAM DA LISTA (Lucas, 03/09/2026): a etapa já está no selo
                      aqui em cima e o produto no filtro do topo. Repetir os dois gastava duas linhas
                      da ficha para dizer o que a tela já dizia duas vezes. */}
                  {/* ⚠️ O COD VEM PRIMEIRO (Lucas, 04/09/2026: *"eu gosto muito de protocolo"*,
                      *"em vez de protocolo vamos tratar como COD"*). É o número que ele fala no
                      telefone: aparece antes de data e valor porque é por ele que se ACHA a venda,
                      não por eles. */}
                  {propostaEmFoco.codigo ? (
                    <Linha rotulo="COD" valor={propostaEmFoco.codigo} />
                  ) : null}
                  <Linha
                    rotulo={rotuloDaData(propostaEmFoco.etapa)}
                    valor={dia(propostaEmFoco.desde)}
                  />
                  <Linha
                    rotulo="Valor negociado"
                    valor={propostaEmFoco.valor ? dinheiro(propostaEmFoco.valor) : "—"}
                  />
                  <ClienteDaVenda
                    nome={toTitleCase(propostaEmFoco.cliente) || "—"}
                    unidadeId={idEmFoco}
                  />
                  <Linha rotulo="Imobiliária" valor={toTitleCase(propostaEmFoco.imobiliaria) || "—"} />
                  {/* O FLUXO do contrato, não o nome do plano — a mesma escrita do extrato. */}
                  <Linha rotulo="Plano" valor={propostaEmFoco.plano ?? "—"} />
                  {propostaEmFoco.observacao ? (
                    <div style={{ borderTop: `1px dashed ${T.border}`, marginTop: 8, paddingTop: 8 }}>
                      <div style={{ color: T.muted, fontSize: 10.5, fontWeight: 650 }}>
                        Observações
                      </div>
                      <p
                        style={{
                          color: T.sub,
                          fontSize: 12.5,
                          margin: "3px 0 0",
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {propostaEmFoco.observacao}
                      </p>
                    </div>
                  ) : null}
                </>
              ) : (
                // ⚠️ SEM PROPOSTA VIVA NÃO É ERRO: é lote livre, e é o começo normal de uma venda.
                // Mas se ele JÁ TEVE proposta, isso é dito — em uma linha, sem os dados do cliente
                // antigo, que não têm por que aparecer na ficha de um lote que está à venda.
                <>
                  <p style={{ color: T.muted, fontSize: 12.5, margin: "8px 0 0" }}>
                    Nenhuma proposta em andamento nesta unidade.
                  </p>
                  {ultimaQueCaiu ? (
                    <p style={{ color: T.muted, fontSize: 11.5, margin: "6px 0 0" }}>
                      A última{" "}
                      {ROTULO_TERMINAL[ultimaQueCaiu.etapa]?.toLowerCase() ?? "encerrada"} em{" "}
                      {dia(ultimaQueCaiu.desde)}. O histórico abaixo conta o resto.
                    </p>
                  ) : null}
                </>
              )}
            </>
          ) : (
            <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>
              Clique num lote do mapa ou numa linha da lista.
            </p>
          )}
          <AcoesDaUnidade
            aoReservar={() => aoReservar(unidadeEmFoco)}
            unidade={unidadeEmFoco}
          />
        </Cartao>

        {/* ⚠️ O HISTÓRICO VEM ANTES DO SIMULADOR (Lucas, 04/09/2026: *"você podia trocar histórico
            pelo simulador (...) falo a ordem"*). Quem abre um lote quer primeiro saber o que já
            aconteceu nele — quem reservou, quando, o que foi anotado. O simulador é a próxima
            ação, e ação vem depois de entender a situação. */}
        <Historico unidadeId={idEmFoco} />

        <div style={{ flex: "0 0 auto" }}>
          <BotaoDoSimulador aoAbrir={() => aoSimular(unidadeEmFoco)} unidade={unidadeEmFoco} />
        </div>
      </div>
    </div>
  );
}

// ── O SIMULADOR DE PROPOSTA ─────────────────────────────────────────────────
//
// Lucas (03/09/2026): *"quero melhorar esse simulador, está bem confuso. O que eu gosto: a opção de
// começar pelo valor da parcela, isso ajuda bastante; gosto das parcelas dos planos já definidos, e
// a ideia é eu poder editar isso quando necessário. (...) acho que lado esquerdo ser esse cockpit,
// de montagem de proposta mesmo, e o lado direito o de visualização, recomendação"*.
//
// ⚠️ ANTES ERA O MASTERPLAN NUM IFRAME, e o que ele achou confuso vinha de lá: três botões de MODO
// ("parto da parcela do cliente", "eu escolho as condições", "proposta livre") obrigavam a declarar
// como você ia pensar antes de digitar qualquer coisa. Numa mesa de venda ninguém escolhe modo — se
// digita o que o cliente falou. Agora o modo é consequência do campo que você mexeu.
//
// ⚠️ SÓ AQUI, NO COMERCIAL (*"vamos mexer somente para o comercial, se eu gostar posso estender
// para cecilio"*). Os cinco masterplans continuam byte a byte como estavam.
//
// ⚠️ E A MATEMÁTICA NÃO FOI REESCRITA: `lib/hercules/simulacao.ts` (Price com valor presente dos
// reforços) e `lib/hercules/composicoes.ts` (a varredura que parte da parcela), as duas testadas.
// Duas versões da mesma conta de dinheiro seria uma a mais.

/**
 * O simulador em tela cheia.
 *
 * ⚠️ NÃO GRAVA NADA (*"a ideia é ter um local que o usuário possa fazer algumas simulações sem ter
 * que vincular a nada e nem gerar proposta"*). O gerador de proposta real entra depois, no fluxo da
 * venda.
 */
function ModalDoSimulador({
  entradaMinimaPercentual,
  nome,
  onFechar,
  planos,
  unidade,
}: {
  entradaMinimaPercentual: null | number;
  nome: string;
  onFechar: () => void;
  planos: FluxoDeVenda["planos"];
  unidade: UnidadeNoMapa;
}) {
  const escrita = comoSeEscreve(unidade.codigo, unidade.quadra, unidade.lote);
  // Escape fecha: tela cheia sem saída de teclado prende quem usa teclado.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      document.body.style.overflow = antes;
    };
  }, [onFechar]);

  return (
    <div
      style={{
        background: "rgb(0 0 0 / .55)",
        display: "grid",
        inset: 0,
        padding: 24,
        placeItems: "center",
        position: "fixed",
        zIndex: 60,
      }}
    >
      <div
        style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 14,
          display: "flex",
          flexDirection: "column",
          height: "min(92vh, 900px)",
          maxWidth: 1280,
          overflow: "hidden",
          width: "min(96vw, 1280px)",
        }}
      >
        <div
          style={{
            alignItems: "center",
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            justifyContent: "space-between",
            padding: "12px 16px",
          }}
        >
          <b style={{ fontSize: 14 }}>
            Simulador de proposta · {nome} · {escrita.unidade}
          </b>
          <button
            onClick={onFechar}
            style={{
              background: "transparent",
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              color: T.sub,
              cursor: "pointer",
              font: "inherit",
              fontSize: 12.5,
              fontWeight: 600,
              padding: "5px 12px",
            }}
            type="button"
          >
            Fechar
          </button>
        </div>

        <div style={{ background: T.page, flex: "1 1 auto", minHeight: 0, padding: 14 }}>
          <SimuladorDeProposta
            entradaMinimaPercentual={entradaMinimaPercentual}
            planos={planos}
            unidade={escrita.unidade}
            valorDaUnidade={unidade.preco}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * O nome do cliente, que ao ser clicado mostra como falar com ele.
 *
 * Lucas (04/09/2026): *"como eu posso ter os dados do cliente da reserva, pode ser que eu queira
 * ligar para ele (...) tipo um link ao clicar no nome"*, e depois *"acho que ligar não, só mostrar
 * mesmo"*.
 *
 * ⚠️ BUSCA SÓ NO CLIQUE. O telefone poderia vir junto da lista, mas são 4.857 linhas: o contato de
 * milhares de clientes ficaria no navegador de quem só queria ver o funil. Aqui sai uma unidade por
 * vez, quando alguém pede.
 *
 * ⚠️ O CPF APARECE MASCARADO e o telefone inteiro: o documento serve para conferir que é a pessoa
 * certa, o telefone é o que ele pediu para ver. Mascarar o telefone não serviria para nada.
 */
function ClienteDaVenda({ nome, unidadeId }: { nome: string; unidadeId: null | string }) {
  const [aberto, setAberto] = useState(false);
  const [dados, setDados] = useState<
    null | { documento: null | string; nome: null | string; telefone: null | string }
  >(null);
  const [buscando, setBuscando] = useState(false);

  // Trocar de unidade fecha o que estava aberto: senão o painel mostraria o contato do lote
  // anterior sob o nome do novo, que é o pior tipo de erro num dado de contato.
  useEffect(() => {
    setAberto(false);
    setDados(null);
  }, [unidadeId]);

  async function abrir() {
    if (aberto) {
      setAberto(false);
      return;
    }
    setAberto(true);
    if (dados || !unidadeId) return;

    setBuscando(true);
    try {
      const r = await fetch(
        `/api/incorporador/venda/cliente?unidade=${encodeURIComponent(unidadeId)}`,
        { cache: "no-store" },
      );
      const texto = await r.text();
      const corpo = texto ? (JSON.parse(texto) as { data?: typeof dados }) : {};
      setDados(corpo.data ?? null);
    } catch {
      setDados(null);
    } finally {
      setBuscando(false);
    }
  }

  return (
    <div>
      <div
        style={{
          alignItems: "baseline",
          borderTop: `1px dashed ${T.border}`,
          display: "flex",
          gap: 10,
          justifyContent: "space-between",
          padding: "7px 0",
        }}
      >
        <span style={{ color: T.sub, fontSize: 12.5 }}>Cliente</span>
        <button
          onClick={() => void abrir()}
          style={{
            background: "transparent",
            border: "none",
            color: T.text,
            cursor: unidadeId ? "pointer" : "default",
            font: "inherit",
            fontSize: 12.5,
            fontWeight: 650,
            padding: 0,
            textAlign: "right",
            textDecoration: unidadeId ? "underline" : "none",
            textDecorationStyle: "dotted",
            textUnderlineOffset: 3,
          }}
          type="button"
        >
          {nome}
        </button>
      </div>

      {aberto ? (
        <div
          style={{
            background: T.soft,
            borderRadius: 8,
            display: "grid",
            gap: 4,
            margin: "0 0 8px",
            padding: "8px 10px",
          }}
        >
          {buscando ? (
            <span style={{ color: T.muted, fontSize: 11.5 }}>Buscando…</span>
          ) : dados ? (
            <>
              <Miudo rotulo="Nome" valor={dados.nome ?? "—"} />
              <Miudo rotulo="CPF" valor={dados.documento ?? "não cadastrado"} />
              <Miudo
                rotulo="Telefone"
                valor={formatarTelefoneGuardado(dados.telefone) || "não cadastrado"}
              />
            </>
          ) : (
            <span style={{ color: T.muted, fontSize: 11.5 }}>
              Sem contato cadastrado para esta unidade.
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Miudo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div style={{ display: "flex", gap: 10, justifyContent: "space-between" }}>
      <span style={{ color: T.muted, fontSize: 11.5 }}>{rotulo}</span>
      <span style={{ fontSize: 11.5, fontWeight: 600 }}>{valor}</span>
    </div>
  );
}

// ── A TRILHA DO FLUXO ───────────────────────────────────────────────────────
//
// Lucas (04/09/2026): *"vamos colocar no topo desse painel um workflow, para gente ver ele
// caminhando nas etapas?"* e *"concluindo as que ele já passou"*.
//
// ⚠️ O SELO SOZINHO DIZ ONDE ESTÁ, MAS NÃO DE ONDE VEIO NEM O QUE FALTA. "Reserva" no canto do
// cabeçalho responde uma pergunta; quem acompanha uma venda faz outras duas — quanto já andou e
// quanto falta —, e é isso que a trilha responde sem clique nenhum.
//
// ⚠️ AS CUMPRIDAS GANHAM CHECK, e não só uma cor mais fraca: num caminho de cinco degraus, "antes"
// e "depois" pintados só por tom ficam iguais para quem olha de relance — e a diferença entre eles
// é a informação inteira.
//
// ⚠️ SETAS, E NÃO TRAÇOS (Lucas, 04/09/2026: *"queria tipo uma setinha em vez de linha"*). Cinco
// barras paralelas são cinco coisas do lado uma da outra; a seta diz que uma leva à outra, que é o
// que um fluxo é. Cada degrau avança sobre o próximo com `clip-path`, e a margem negativa encaixa
// a ponta no recorte do seguinte — sem ela sobra uma fresta branca no meio do caminho.

function TrilhaDoFluxo({ etapa }: { etapa: null | string }) {
  // Fora do caminho (disponível, bloqueada, vendida sem proposta) não há trilha para mostrar: a
  // venda não começou, ou não passou por aqui. Um traço todo apagado só ocuparia espaço.
  const atual = ETAPAS_DO_FLUXO.indexOf(etapa as EtapaDoFluxo);
  if (atual < 0) return null;

  // A ponta da seta, em pixels. Entra duas vezes em cada degrau: o recorte da direita (a ponta que
  // avança) e o da esquerda (o encaixe que recebe a ponta do anterior).
  const PONTA = 9;

  return (
    <div style={{ display: "flex", margin: "0 0 12px" }}>
      {ETAPAS_DO_FLUXO.map((passo, i) => {
        const cumprida = i < atual;
        const ehAtual = i === atual;
        const primeiro = i === 0;
        const ultimo = i === ETAPAS_DO_FLUXO.length - 1;

        // ⚠️ O DEGRAU AVANÇA SOBRE O PRÓXIMO, e é isso que faz a seta ler como caminho: o recorte
        // da direita é uma ponta, o da esquerda é o encaixe dela, e a margem negativa junta os
        // dois. Sem a sobreposição sobra uma fresta branca entre os degraus.
        // ⚠️ O ÚLTIMO NÃO TEM PONTA: o caminho acaba nele, e uma seta apontando para fora
        // prometeria um passo que não existe.
        const direita = ultimo
          ? "100% 0, 100% 100%"
          : `calc(100% - ${PONTA}px) 0, 100% 50%, calc(100% - ${PONTA}px) 100%`;
        const recorte = primeiro
          ? `polygon(0 0, ${direita}, 0 100%)`
          : `polygon(0 0, ${direita}, 0 100%, ${PONTA}px 50%)`;

        return (
          <div
            key={passo}
            style={{
              alignItems: "center",
              background: ehAtual ? T.gold : cumprida ? T.soft : T.card,
              border: ehAtual ? "none" : `1px solid ${T.border}`,
              clipPath: recorte,
              color: ehAtual ? T.btnFg : cumprida ? T.sub : T.muted,
              display: "flex",
              flex: 1,
              fontSize: 10,
              fontWeight: ehAtual ? 700 : 500,
              gap: 3,
              justifyContent: "center",
              marginLeft: primeiro ? 0 : -PONTA,
              minWidth: 0,
              overflow: "hidden",
              padding: `5px ${PONTA + 2}px 5px ${primeiro ? PONTA : PONTA * 2}px`,
              whiteSpace: "nowrap",
            }}
          >
            {cumprida ? <Check aria-hidden size={10} strokeWidth={3} /> : null}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
              {ROTULO_DA_ETAPA[passo] ?? passo}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── AS AÇÕES DA UNIDADE ─────────────────────────────────────────────────────
//
// Lucas (03/09/2026): *"vamos inserir os botões de reservar, gerar propostas, enviar para contrato
// e o botão de cancelar"*, e detalhou o fluxo da RESERVA — *"depois a gente continua"*.
//
// ⚠️ OS QUATRO APARECEM DESDE JÁ, e três dizem que ainda não fazem nada. Mostrar só o que funciona
// esconderia o desenho do fluxo de quem usa a tela; um botão que some e volta a cada release é pior
// do que um botão que diz "vem depois". O que NÃO pode é botão que parece pronto e não faz nada:
// por isso eles ficam apagados e com o motivo no title.
//
// ⚠️ E O ESTADO MANDA. Reservar só existe em unidade DISPONÍVEL — é a regra dele ("se a unidade
// estiver disponível, ter um botão para reservar"). Nas outras etapas o botão continua visível,
// apagado, dizendo por quê: sumir faria o coordenador procurar o botão em vez de ler a ficha.

const PROXIMA_FASE = "Entra na próxima fase da venda.";

function AcoesDaUnidade({
  aoReservar,
  unidade,
}: {
  aoReservar: () => void;
  unidade: null | UnidadeNoMapa;
}) {
  const disponivel = unidade?.etapa === "disponivel";
  const reservada = unidade?.etapa === "reservado";

  const acoes: Array<{
    ativo: boolean;
    aoClicar?: () => void;
    motivo: string;
    principal?: boolean;
    rotulo: string;
  }> = [
    {
      ativo: Boolean(unidade) && disponivel,
      aoClicar: aoReservar,
      motivo: !unidade
        ? "Escolha uma unidade."
        : disponivel
          ? "Reserva a unidade e avisa corretor, imobiliária e coordenador."
          : "Só unidade disponível pode ser reservada.",
      principal: true,
      rotulo: "Reservar",
    },
    {
      ativo: false,
      motivo: reservada ? PROXIMA_FASE : "Precisa de uma reserva ativa.",
      rotulo: "Gerar proposta",
    },
    { ativo: false, motivo: PROXIMA_FASE, rotulo: "Enviar para contrato" },
    {
      ativo: false,
      motivo: unidade && !disponivel ? PROXIMA_FASE : "Não há o que cancelar nesta unidade.",
      rotulo: "Cancelar",
    },
  ];

  return (
    <div
      style={{
        borderTop: `1px dashed ${T.border}`,
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        marginTop: 12,
        paddingTop: 12,
      }}
    >
      {acoes.map((acao) => (
        <button
          key={acao.rotulo}
          disabled={!acao.ativo}
          onClick={acao.aoClicar}
          style={{
            background: acao.ativo && acao.principal ? T.btnBg : T.soft,
            border: `1px solid ${acao.ativo ? "transparent" : T.border}`,
            borderRadius: 8,
            color: acao.ativo ? (acao.principal ? T.btnFg : T.text) : T.muted,
            cursor: acao.ativo ? "pointer" : "default",
            font: "inherit",
            fontSize: 12,
            fontWeight: 650,
            opacity: acao.ativo ? 1 : 0.55,
            padding: "7px 13px",
          }}
          title={acao.motivo}
          type="button"
        >
          {acao.rotulo}
        </button>
      ))}
    </div>
  );
}

/**
 * O botão que abre o simulador de proposta.
 *
 * ⚠️ NÃO DEPENDE MAIS DO MASTERPLAN. Enquanto o simulador era um iframe do espelho, produto sem
 * mapa publicado era produto sem simulador — e o botão ficava cinza numa tela em que tudo o mais
 * funcionava. Agora a conta é React puro sobre os planos do empreendimento: basta o lote ter preço.
 */
function BotaoDoSimulador({
  aoAbrir,
  unidade,
}: {
  aoAbrir: () => void;
  unidade: null | UnidadeNoMapa;
}) {
  const nome = unidade ? comoSeEscreve(unidade.codigo, unidade.quadra, unidade.lote) : null;

  return (
    <Cartao titulo="Simulador de proposta">
      <div style={{ display: "grid", gap: 10 }}>
        <p style={{ color: T.muted, fontSize: 12.5, margin: 0 }}>
          {unidade
            ? `Monta o plano de pagamento do lote ${nome?.unidade} partindo do que o cliente pode pagar por mês, sobre a tabela do empreendimento. Simulação livre: não vincula o lote nem gera proposta.`
            : "Escolha um lote no quadro ou na lista para montar o plano de pagamento dele."}
        </p>

        <button
          disabled={!unidade}
          onClick={aoAbrir}
          style={{
            background: unidade ? T.btnBg : T.soft,
            border: "none",
            borderRadius: 9,
            color: unidade ? T.btnFg : T.muted,
            cursor: unidade ? "pointer" : "default",
            font: "inherit",
            fontSize: 13,
            fontWeight: 650,
            padding: "10px 14px",
            width: "100%",
          }}
          type="button"
        >
          Abrir simulador
        </button>
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
  const [so, setSo] = useState<"assinatura" | "pagamento" | "tudo">("tudo");
  const [desde, setDesde] = useState("");

  useEffect(() => {
    setTudo(false);
    setSo("tudo");
    setDesde("");
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

  // Os anos que existem neste histórico — o filtro de data não oferece ano vazio.
  const anos = useMemo(
    () => [...new Set(eventos.map((e) => e.quando.slice(0, 4)))].sort((a, b) => b.localeCompare(a)),
    [eventos],
  );

  // ⚠️ O FILTRO DE DATA TEM DE APARECER SEMPRE (Lucas, 03/09/2026: *"faltou o filtro de data"*).
  // A primeira versão usava o `Filtro` genérico, que se esconde com menos de duas opções — e num
  // lote cujos eventos são todos do mesmo ano ele simplesmente sumia. Períodos relativos existem
  // independentemente do que há na base, então a lista nunca fica com uma opção só.
  const opcoesDeData = useMemo(() => {
    const agora = new Date();
    const menos = (dias: number) =>
      new Date(agora.getTime() - dias * 86_400_000).toISOString().slice(0, 10);
    return [
      { rotulo: "Todo o período", valor: "" },
      { rotulo: "Últimos 30 dias", valor: `>=${menos(30)}` },
      { rotulo: "Últimos 90 dias", valor: `>=${menos(90)}` },
      { rotulo: "Últimos 12 meses", valor: `>=${menos(365)}` },
      ...anos.map((a) => ({ rotulo: a, valor: a })),
    ];
  }, [anos]);

  const filtrados = useMemo(
    () =>
      eventos.filter((e) => {
        if (so !== "tudo" && e.tipo !== so) return false;
        if (!desde) return true;
        // `>=AAAA-MM-DD` é o corte relativo; o resto é ano cheio.
        return desde.startsWith(">=")
          ? e.quando.slice(0, 10) >= desde.slice(2)
          : e.quando.startsWith(desde);
      }),
    [desde, eventos, so],
  );

  if (!unidadeId) return null;

  const visiveis = tudo ? filtrados : filtrados.slice(0, 15);
  const pagos = eventos
    .filter((e) => e.tipo === "pagamento" && e.valor)
    .reduce((a, e) => a + (e.valor ?? 0), 0);

  return (
    <Cartao
      barra={
        eventos.length > 0 ? (
          <>
            {/* ⚠️ FILTRO DE TIPO E DE DATA (Lucas, 03/09/2026: *"colocar um filtro de data"*). Um
                lote com trinta registros vira uma parede; a pergunta real costuma ser "o que
                aconteceu de dinheiro" ou "o que houve neste ano". */}
            {(
              [
                ["tudo", `Tudo ${eventos.length}`],
                ["pagamento", "Pagamentos"],
                ["assinatura", "Assinaturas"],
              ] as const
            ).map(([chave, rotulo]) => (
              <Pilula
                ativo={so === chave}
                key={chave}
                onClick={() => setSo(chave)}
                rotulo={rotulo}
              />
            ))}
            <select
              aria-label="Período"
              onChange={(e) => setDesde(e.target.value)}
              style={{
                background: T.soft,
                border: `1px solid ${T.border}`,
                borderRadius: 999,
                color: T.text,
                cursor: "pointer",
                font: "inherit",
                fontSize: 12.5,
                fontWeight: 600,
                padding: "6px 10px",
              }}
              value={desde}
            >
              {opcoesDeData.map((o) => (
                <option key={o.valor} value={o.valor}>
                  {o.rotulo}
                </option>
              ))}
            </select>
            {pagos > 0 ? (
              <span style={{ color: T.ok, fontSize: 11.5, fontWeight: 650, marginLeft: "auto" }}>
                {dinheiro(pagos)} pagos
              </span>
            ) : null}
          </>
        ) : null
      }
      direita={
        propostas > 0 ? (
          <span style={{ color: T.muted, fontSize: 11.5 }}>
            {inteiro(propostas)} proposta(s)
          </span>
        ) : null
      }
      rolagem
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
      ) : filtrados.length === 0 ? (
        <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>Nada com esse filtro.</p>
      ) : (
        <>
          {/* ⚠️ O DESENHO É UMA LINHA DO TEMPO, e não uma lista de parágrafos. A data fica numa
              coluna fixa à esquerda e o fato à direita: o olho desce pela data procurando "quando",
              que é como se lê histórico. Antes tudo era texto corrido e o Lucas achou "estranho". */}
          <div style={{ display: "grid", gap: 0 }}>
            {visiveis.map((e, i) => {
              const anterior = visiveis[i - 1];
              // O nome do cliente só aparece quando MUDA: repetir "ALEXANDRE" em doze linhas
              // seguidas era metade do ruído da lista.
              const mostrarCliente = e.cliente && e.cliente !== anterior?.cliente;
              // ⚠️ A TRANSIÇÃO GANHA A COR DA ETAPA DE DESTINO (Lucas, 03/09/2026: *"deixar essas
              // transições reserva - proposta na cor que estamos usando para marcar na grade,
              // cancelamento em vermelho"*). A grade já ensinou o olho: azul é proposta, violeta é
              // contrato, grafite é assinatura. O histórico usar outra paleta obrigaria a aprender
              // duas — e cancelamento em cinza escondia justamente o que se procura.
              const cor = corDoEvento(e);

              return (
                <div key={e.id}>
                  {mostrarCliente ? (
                    <div
                      style={{
                        color: T.sub,
                        fontSize: 11,
                        fontWeight: 650,
                        letterSpacing: ".03em",
                        paddingTop: i === 0 ? 0 : 12,
                        textTransform: "uppercase",
                      }}
                    >
                      {e.cliente}
                    </div>
                  ) : null}

                  <div
                    style={{
                      display: "grid",
                      gap: 10,
                      gridTemplateColumns: "62px 8px minmax(0, 1fr)",
                      padding: "7px 0",
                    }}
                  >
                    <span
                      style={{
                        color: T.muted,
                        fontSize: 11,
                        fontVariantNumeric: "tabular-nums",
                        lineHeight: 1.35,
                        paddingTop: 1,
                      }}
                    >
                      {diaCurto(e.quando)}
                      <br />
                      <span style={{ opacity: 0.75 }}>{hora(e.quando)}</span>
                    </span>

                    {/* O fio da linha do tempo, com o ponto do evento. */}
                    <span style={{ display: "grid", justifyItems: "center", position: "relative" }}>
                      <span
                        style={{
                          background: cor,
                          borderRadius: "50%",
                          height: 7,
                          marginTop: 5,
                          width: 7,
                        }}
                      />
                      <span style={{ background: T.border, flex: 1, width: 1 }} />
                    </span>

                    <span style={{ display: "grid", gap: 1, minWidth: 0 }}>
                      <b style={{ fontSize: 12.5, lineHeight: 1.35 }}>
                        {e.fato}
                        {e.valor ? (
                          <span style={{ color: T.ok }}> · {dinheiro(e.valor)}</span>
                        ) : null}
                      </b>
                      {e.quem ? (
                        <span style={{ color: T.muted, fontSize: 11 }}>{e.quem}</span>
                      ) : null}
                      {e.observacao ? (
                        <span style={{ color: T.muted, fontSize: 11, opacity: 0.85 }}>
                          {e.observacao}
                        </span>
                      ) : null}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {filtrados.length > 15 && !tudo ? (
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
              Ver os {inteiro(filtrados.length)} registros
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
