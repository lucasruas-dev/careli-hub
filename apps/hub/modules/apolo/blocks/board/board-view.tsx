"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Check,
  CreditCard,
  FileCheck2,
  LayoutGrid,
  List,
  AlertTriangle,
  ListOrdered,
  Loader2,
  MessageSquare,
  QrCode,
  Search,
  Send,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  C2X_ESCOLARIDADE,
  C2X_ESTADO_CIVIL,
  C2X_FAIXA_RENDA,
  C2X_REGIME_BENS,
  C2X_SEXO,
  calcIdade,
  formatDateBR,
  titleCase,
} from "@/lib/apolo/c2x-fields";
import { C2X_PROFISSOES } from "@/lib/apolo/c2x-professions";
import { toTitleCase } from "@/lib/format/name-case";

import { buscarEnderecoPorCep } from "../../lib/cep";

import { getApoloAccessToken } from "../../data/apolo-operations";

// Tela de trabalho do operador: a ESTEIRA de credenciamento (Lucas 18/jul).
// A imobiliária e a CAD percorrem caminhos diferentes:
//   imobiliária -> valida cadastro -> valida corretores -> apta a enviar CADs
//   CAD         -> valida cadastro -> crédito (Serasa) -> PIX da pré-venda -> fila do Prometeu
//
// ⚠️ PRIMEIRA VERSÃO = ESQUELETO NAVEGÁVEL (decisão do Lucas): a fila é real (entidades em
// review), mas as AÇÕES não gravam — servem pra validar o layout antes de ligar a lógica.
// Ver [[project_esteira_credenciamento_venda]].

type ItemFila = {
  // Analista responsável salvo no banco (metadata.esteira.analistaId).
  analistaId?: string | null;
  // Corretor e imobiliária vindos da CAD importada (o cadastro do wizard usa outros campos).
  corretor?: string | null;
  corretores: number;
  criadoEm: string;
  documento: string;
  imobiliaria?: string | null;
  // Nomes dos empreendimentos a que o item se refere (eixo de filtro/ordenação do Board).
  empreendimentos: string[];
  // Etapa PERSISTIDA (metadata.esteira.etapa). É o ponto de partida do item na tela: quem foi
  // importado do Asana como credenciado precisa nascer na coluna certa, não em Validação.
  etapa?: string | null;
  id: string;
  nome: string;
  papel: string;
  socios: number;
};

// A etapa salva é texto; o Board trabalha com índice em ETAPAS_CAD. Esta é a ponte.
const INDICE_POR_ETAPA: Record<string, number> = {
  cadastro: 0,
  credenciado: 3,
  credito: 1,
  prevenda: 2,
  validacao: 0,
};

// Data e hora de chegada: é o carimbo que ordena a fila de trabalho.
function chegadaEm(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// "há 3 dias" — o que importa na triagem é há quanto tempo o item espera.
function esperaDesde(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const dias = Math.floor(ms / 86_400_000);
  if (dias >= 1) return `${dias} dia${dias > 1 ? "s" : ""}`;
  const horas = Math.floor(ms / 3_600_000);
  if (horas >= 1) return `${horas}h`;
  return "agora";
}

type Etapa = {
  descricao: string;
  icon: LucideIcon;
  id: string;
  label: string;
};

// ⚠️ São DOIS processos diferentes (Lucas): a imobiliária é credenciada pra ENVIAR CADs (não
// passa por crédito nem paga pré-venda); a CAD é o cliente comprando.
const ETAPAS_CAD: Etapa[] = [
  {
    descricao: "Confira os dados e os documentos originais lado a lado.",
    icon: FileCheck2,
    id: "cadastro",
    label: "Validação",
  },
  {
    descricao: "Consulta ao Serasa: score, negativações e protestos.",
    icon: CreditCard,
    id: "credito",
    label: "Análise de crédito",
  },
  {
    descricao: "Cobrança de R$ 1.000 (PIX ou boleto) para garantir a pré-venda.",
    icon: QrCode,
    id: "prevenda",
    label: "Pré-venda",
  },
  {
    descricao: "Credenciado: entra na fila do lançamento pela ordem de pagamento.",
    icon: ListOrdered,
    id: "credenciado",
    label: "Credenciado",
  },
];

const ETAPAS_IMOBILIARIA: Etapa[] = [
  {
    descricao:
      "Confira empresa, contrato social, sócios e os corretores vinculados, com os documentos ao lado.",
    icon: FileCheck2,
    id: "cadastro",
    label: "Validação",
  },
  {
    descricao: "Imobiliária habilitada a enviar CADs nos empreendimentos liberados.",
    icon: ShieldCheck,
    id: "habilitada",
    label: "Habilitada",
  },
];

const etapasDoItem = (item: ItemFila): Etapa[] =>
  item.papel === "imobiliaria" ? ETAPAS_IMOBILIARIA : ETAPAS_CAD;

type Analista = { id: string; nome: string };

// Registro do que aconteceu com o item, desde a chegada (regra do Lucas: histórico de tudo).
type EventoHistorico = {
  autor: string;
  em: string;
  id: string;
  texto: string;
  tipo: "aprovacao" | "chegada" | "etapa" | "nota" | "sistema";
};

type Mensagem = { autor: string; em: string; id: string; texto: string };

export function BoardView() {
  const [itens, setItens] = useState<ItemFila[]>([]);
  const [analistas, setAnalistas] = useState<Analista[]>([]);
  const [usuarioAtual, setUsuarioAtual] = useState<Analista | null>(null);
  // Quem está analisando cada item. Local por enquanto (a atribuição real entra com a gravação).
  const [analistaPorItem, setAnalistaPorItem] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<"todos" | "imobiliaria" | "prospect">("todos");
  const [selecionado, setSelecionado] = useState<ItemFila | null>(null);
  const [visao, setVisao] = useState<"kanban" | "tabela">("tabela");
  const [busca, setBusca] = useState("");
  const [empreendimento, setEmpreendimento] = useState("todos");
  const [ordem, setOrdem] = useState<"antigos" | "nome" | "recentes">("antigos");
  // Filtro por etapa: com centenas de itens na fila, ver só uma coluna por vez é o que torna
  // a lista utilizável.
  const [etapaFiltro, setEtapaFiltro] = useState("todas");
  // Ordenação clicando no cabeçalho. `null` = usa a ordem escolhida no seletor.
  const [colunaOrdem, setColunaOrdem] = useState<{
    campo: "chegada" | "documento" | "empreendimento" | "etapa" | "nome";
    desc: boolean;
  } | null>(null);
  // Só no esqueleto: guarda em que etapa o operador "avançou" cada item (não persiste).
  const [progresso, setProgresso] = useState<Record<string, number>>({});
  // Popup do chat/histórico: nasce fechado, abre pelo botão.
  const [painelAberto, setPainelAberto] = useState(false);
  // Análises INDEFERIDAS (recusadas). Diferente de "em correção", que volta pra ajuste.
  const [indeferidos, setIndeferidos] = useState<Record<string, boolean>>({});
  // Escalados pro coordenador: ele pode aprovar um crédito que o analista barraria.
  const [emRevisao, setEmRevisao] = useState<Record<string, boolean>>({});
  // Devolvidos pro corretor ajustar. Sempre com o motivo registrado.
  const [emCorrecao, setEmCorrecao] = useState<Record<string, boolean>>({});
  // Popup de motivo: recusar e mandar pra correção exigem justificativa.
  const [modalMotivo, setModalMotivo] = useState<"correcao" | "indeferir" | null>(null);
  // Histórico e conversa interna por item (locais nesta versão).
  const [eventos, setEventos] = useState<Record<string, EventoHistorico[]>>({});
  const [mensagens, setMensagens] = useState<Record<string, Mensagem[]>>({});

  const agora = () => new Date().toISOString();
  const eu = usuarioAtual?.nome ?? "Você";

  const registrarEvento = (
    itemId: string,
    tipo: EventoHistorico["tipo"],
    texto: string,
  ) =>
    setEventos((prev) => ({
      ...prev,
      [itemId]: [
        ...(prev[itemId] ?? []),
        { autor: eu, em: agora(), id: `${Date.now()}`, texto, tipo },
      ],
    }));

  const enviarMensagem = (itemId: string, texto: string) =>
    setMensagens((prev) => ({
      ...prev,
      [itemId]: [
        ...(prev[itemId] ?? []),
        { autor: eu, em: agora(), id: `${Date.now()}`, texto },
      ],
    }));

  // Recusa e correção SEMPRE com motivo (regra do Lucas): fica no histórico e é o que o
  // corretor/cliente recebe de volta.
  const indeferir = (itemId: string, motivo: string) => {
    setIndeferidos((prev) => ({ ...prev, [itemId]: true }));
    setEmRevisao((prev) => ({ ...prev, [itemId]: false }));
    setEmCorrecao((prev) => ({ ...prev, [itemId]: false }));
    registrarEvento(itemId, "sistema", `Reprovado — motivo: ${motivo}`);
  };

  const enviarParaCorrecao = (itemId: string, motivo: string) => {
    setEmCorrecao((prev) => ({ ...prev, [itemId]: true }));
    setEmRevisao((prev) => ({ ...prev, [itemId]: false }));
    registrarEvento(itemId, "nota", `Enviado para correção — pendências: ${motivo}`);
  };

  const reabrir = (itemId: string) => {
    setIndeferidos((prev) => ({ ...prev, [itemId]: false }));
    setEmCorrecao((prev) => ({ ...prev, [itemId]: false }));
    registrarEvento(itemId, "etapa", "Análise reaberta");
  };

  // Analista escala pro coordenador decidir o crédito.
  const enviarParaRevisao = (itemId: string) => {
    setEmRevisao((prev) => ({ ...prev, [itemId]: true }));
    registrarEvento(itemId, "aprovacao", "Enviado ao coordenador para revisão do crédito");
  };

  // Coordenador aprova: o crédito segue e o item volta ao caminho normal.
  const aprovarRevisao = (itemId: string) => {
    setEmRevisao((prev) => ({ ...prev, [itemId]: false }));
    setIndeferidos((prev) => ({ ...prev, [itemId]: false }));
    registrarEvento(itemId, "aprovacao", "Crédito aprovado pelo coordenador");
  };

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const accessToken = await getApoloAccessToken();
        const response = await fetch("/api/apolo/board", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const payload = (await response.json()) as {
          data?: { analistas?: Analista[]; itens?: ItemFila[]; usuarioAtual?: Analista | null };
        };
        if (alive) {
          const itensCarregados = payload.data?.itens ?? [];
          setItens(itensCarregados);
          setAnalistas(payload.data?.analistas ?? []);
          setUsuarioAtual(payload.data?.usuarioAtual ?? null);

          // Semeia etapa e analista com o que veio do banco, preservando o que o operador já
          // mexeu nesta sessão (o que ele fez na tela ganha do que estava salvo).
          setProgresso((atual) => {
            const semeado: Record<string, number> = {};
            for (const item of itensCarregados) {
              const indice = item.etapa ? INDICE_POR_ETAPA[item.etapa] : undefined;
              if (indice !== undefined) semeado[item.id] = indice;
            }
            return { ...semeado, ...atual };
          });

          setAnalistaPorItem((atual) => {
            const semeado: Record<string, string> = {};
            for (const item of itensCarregados) {
              if (item.analistaId) semeado[item.id] = item.analistaId;
            }
            return { ...semeado, ...atual };
          });
        }
      } catch {
        // fila vazia
      } finally {
        if (alive) setCarregando(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Lista de empreendimentos pro seletor (só os que realmente aparecem na fila).
  const empreendimentosDisponiveis = Array.from(
    new Set(itens.flatMap((item) => item.empreendimentos)),
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const alvoBusca = busca.trim().toLowerCase();
  const visiveis = itens
    .filter((item) =>
      filtro === "todos"
        ? true
        : filtro === "imobiliaria"
          ? item.papel === "imobiliaria"
          : item.papel !== "imobiliaria",
    )
    .filter((item) =>
      empreendimento === "todos" ? true : item.empreendimentos.includes(empreendimento),
    )
    .filter((item) =>
      alvoBusca
        ? `${item.nome} ${item.documento}`.toLowerCase().includes(alvoBusca)
        : true,
    )
    .filter((item) =>
      etapaFiltro === "todas"
        ? true
        : colunaDoItem(
            item,
            progresso[item.id] ?? 0,
            Boolean(indeferidos[item.id]),
            Boolean(emRevisao[item.id]),
            Boolean(emCorrecao[item.id]),
          ) === etapaFiltro,
    )
    .sort((a, b) => {
      // Clique no cabeçalho manda; o seletor é o padrão quando não há coluna escolhida.
      if (colunaOrdem) {
        const sinal = colunaOrdem.desc ? -1 : 1;
        const texto = (valor: string) => valor.toLocaleLowerCase("pt-BR");

        if (colunaOrdem.campo === "nome") {
          return sinal * a.nome.localeCompare(b.nome, "pt-BR");
        }
        if (colunaOrdem.campo === "documento") {
          return sinal * texto(a.documento).localeCompare(texto(b.documento), "pt-BR");
        }
        if (colunaOrdem.campo === "empreendimento") {
          return (
            sinal *
            texto(a.empreendimentos.join(", ")).localeCompare(
              texto(b.empreendimentos.join(", ")),
              "pt-BR",
            )
          );
        }
        if (colunaOrdem.campo === "etapa") {
          const posicao = (item: ItemFila) =>
            colunasDoTipo(item.papel === "imobiliaria").findIndex(
              (coluna) =>
                coluna.id ===
                colunaDoItem(
                  item,
                  progresso[item.id] ?? 0,
                  Boolean(indeferidos[item.id]),
                  Boolean(emRevisao[item.id]),
                  Boolean(emCorrecao[item.id]),
                ),
            );
          return sinal * (posicao(a) - posicao(b));
        }
        return (
          sinal * (new Date(a.criadoEm).getTime() - new Date(b.criadoEm).getTime())
        );
      }

      if (ordem === "nome") return a.nome.localeCompare(b.nome, "pt-BR");
      const ta = new Date(a.criadoEm).getTime();
      const tb = new Date(b.criadoEm).getTime();
      return ordem === "recentes" ? tb - ta : ta - tb;
    });

  // Quem ABRE o processo assume a análise (regra do Lucas). Só atribui se ainda não tem dono —
  // abrir um item de outro analista não rouba a responsabilidade dele.
  const abrirItem = (item: ItemFila) => {
    setSelecionado(item);
    if (usuarioAtual && !analistaPorItem[item.id]) {
      setAnalistaPorItem((prev) => ({ ...prev, [item.id]: usuarioAtual.id }));
    }
  };

  const analistaAberto = selecionado
    ? (analistas.find((p) => p.id === analistaPorItem[selecionado.id])?.nome ?? "")
    : "";

  // Índice do item aberto DENTRO da lista filtrada: é o que permite emendar um no outro.
  const indiceAberto = selecionado
    ? visiveis.findIndex((item) => item.id === selecionado.id)
    : -1;
  const irPara = (delta: number) => {
    const alvo = visiveis[indiceAberto + delta];
    if (alvo) abrirItem(alvo);
  };

  // --- validação em TELA CHEIA (decisão do Lucas: fila e validação disputavam a mesma largura) ---
  if (selecionado) {
    return (
      <section className="flex h-full min-h-0 flex-col gap-3">
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-subtle"
            onClick={() => setSelecionado(null)}
            type="button"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Voltar para a fila
          </button>

          <div className="flex items-center gap-2">
            {/* Quem abriu assumiu: fica explícito de quem é a análise. */}
            {analistaAberto ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-subtle px-2.5 py-1 text-[11px] font-semibold text-ink-soft">
                <span className="flex size-4 items-center justify-center rounded-full bg-inverse text-[8px] font-bold text-brand-ink">
                  {iniciais(analistaAberto)}
                </span>
                {analistaAberto}
              </span>
            ) : null}
            <span className="text-xs text-ink-muted">
              {indiceAberto + 1} de {visiveis.length}
            </span>
            <button
              className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-subtle disabled:opacity-40"
              disabled={indiceAberto <= 0}
              onClick={() => irPara(-1)}
              type="button"
            >
              Anterior
            </button>
            <button
              className="inline-flex h-9 items-center rounded-lg border border-line px-3 text-sm font-medium text-ink-soft transition-colors hover:bg-subtle disabled:opacity-40"
              disabled={indiceAberto < 0 || indiceAberto >= visiveis.length - 1}
              onClick={() => irPara(1)}
              type="button"
            >
              Próximo
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-line bg-surface p-5">
          <DetalheBoard
            emCorrecao={Boolean(emCorrecao[selecionado.id])}
            emRevisao={Boolean(emRevisao[selecionado.id])}
            etapaAtual={progresso[selecionado.id] ?? 0}
            indeferido={Boolean(indeferidos[selecionado.id])}
            item={selecionado}
            mensagens={(mensagens[selecionado.id] ?? []).length}
            onAbrirChat={() => setPainelAberto(true)}
            onAprovarRevisao={() => aprovarRevisao(selecionado.id)}
            onAvancar={() =>
              setProgresso((prev) => ({
                ...prev,
                [selecionado.id]: (prev[selecionado.id] ?? 0) + 1,
              }))
            }
            onCorrecao={() => setModalMotivo("correcao")}
            onEnviarGestao={() => enviarParaRevisao(selecionado.id)}
            onIndeferir={() => setModalMotivo("indeferir")}
            onReabrir={() => reabrir(selecionado.id)}
            onVoltar={() =>
              setProgresso((prev) => ({
                ...prev,
                [selecionado.id]: Math.max(0, (prev[selecionado.id] ?? 0) - 1),
              }))
            }
          />
        </div>

        {/* Recusa e correção exigem motivo: popup antes de decidir. */}
        {modalMotivo ? (
          <ModalMotivo
            imob={selecionado.papel === "imobiliaria"}
            onCancelar={() => setModalMotivo(null)}
            onConfirmar={(motivo) => {
              if (modalMotivo === "correcao") enviarParaCorrecao(selecionado.id, motivo);
              else indeferir(selecionado.id, motivo);
              setModalMotivo(null);
            }}
            tipo={modalMotivo}
          />
        ) : null}

        {/* Chat e histórico em POPUP (preferência do Lucas): a conferência fica com a tela toda. */}
        {painelAberto ? (
          <ModalChatHistorico
            eventos={historicoDoItem(selecionado, eventos[selecionado.id] ?? [])}
            mensagens={mensagens[selecionado.id] ?? []}
            nome={toTitleCase(selecionado.nome)}
            onEnviar={(texto) => enviarMensagem(selecionado.id, texto)}
            onFechar={() => setPainelAberto(false)}
          />
        ) : null}
      </section>
    );
  }

  // --- fila em TABELA cheia ---
  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <header className="shrink-0 rounded-xl border border-line bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Sem título: o nome da tela já vem do sidebar do Apolo. */}
          <p className="m-0 min-w-0 text-xs text-ink-muted">
            Tudo que entra no lançamento passa por aqui: imobiliárias, corretores e CADs.
          </p>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              Prévia de layout · as ações ainda não gravam
            </span>
            {/* Mesmo alternador do board da Iris. */}
            <div className="inline-flex shrink-0 rounded-lg border border-line/70 bg-subtle/70 p-0.5">
              <button
                aria-label="Visão kanban"
                className={`inline-flex size-8 items-center justify-center rounded-md transition-colors ${
                  visao === "kanban"
                    ? "bg-surface text-ink shadow-sm"
                    : "text-ink-muted hover:text-ink"
                }`}
                onClick={() => {
                  // O quadro sempre abre nas CADs (decisão do Lucas); trocar é um clique na aba.
                  setFiltro("prospect");
                  setVisao("kanban");
                }}
                title="Kanban"
                type="button"
              >
                <LayoutGrid className="size-4" aria-hidden="true" />
              </button>
              <button
                aria-label="Visão lista"
                className={`inline-flex size-8 items-center justify-center rounded-md transition-colors ${
                  visao === "tabela"
                    ? "bg-surface text-ink shadow-sm"
                    : "text-ink-muted hover:text-ink"
                }`}
                onClick={() => setVisao("tabela")}
                title="Lista"
                type="button"
              >
                <List className="size-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-3 flex gap-1">
          {(
            [
              // No kanban não existe "Todos": os funis são diferentes.
              ...(visao === "kanban" ? [] : [["todos", "Todos"] as const]),
              // CADs primeiro: é o volume do dia a dia.
              ["prospect", "CADs"] as const,
              ["imobiliaria", "Imobiliárias"] as const,
            ] as const
          ).map(([valor, rotulo]) => {
            const total = itens.filter((item) =>
              valor === "todos"
                ? true
                : valor === "imobiliaria"
                  ? item.papel === "imobiliaria"
                  : item.papel !== "imobiliaria",
            ).length;
            return (
              <button
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  filtro === valor ? "bg-inverse text-brand-ink" : "text-ink-soft hover:bg-subtle"
                }`}
                key={valor}
                onClick={() => setFiltro(valor)}
                type="button"
              >
                {rotulo}
                <span
                  className={`rounded-full px-1.5 text-[10px] ${
                    filtro === valor ? "bg-white/20" : "bg-subtle"
                  }`}
                >
                  {total}
                </span>
              </button>
            );
          })}
        </div>

        {/* Busca, empreendimento e ordenação valem pras duas visões. */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label className="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-line/70 bg-surface px-3">
            <Search aria-hidden="true" className="size-4 shrink-0 text-[#A07C3B]" />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm font-medium text-ink outline-none placeholder:text-ink-muted"
              onChange={(event) => setBusca(event.target.value)}
              placeholder="Buscar por nome ou documento…"
              value={busca}
            />
          </label>

          <select
            className="h-9 rounded-lg border border-line/70 bg-surface px-2 text-sm text-ink outline-none [&>option]:bg-surface [&>option]:text-ink"
            onChange={(event) => setEmpreendimento(event.target.value)}
            value={empreendimento}
          >
            <option value="todos">Todos os empreendimentos</option>
            {empreendimentosDisponiveis.map((nome) => (
              <option key={nome} value={nome}>
                {toTitleCase(nome)}
              </option>
            ))}
          </select>

          {/* Filtro por etapa: mostra a contagem junto, para saber onde a fila está parada
              sem precisar abrir o kanban. */}
          <select
            className="h-9 rounded-lg border border-line/70 bg-surface px-2 text-sm text-ink outline-none [&>option]:bg-surface [&>option]:text-ink"
            onChange={(event) => setEtapaFiltro(event.target.value)}
            value={etapaFiltro}
          >
            <option value="todas">Todas as etapas</option>
            {colunasDoTipo(filtro === "imobiliaria").map((coluna) => {
              const quantos = itens.filter(
                (item) =>
                  colunaDoItem(
                    item,
                    progresso[item.id] ?? 0,
                    Boolean(indeferidos[item.id]),
                    Boolean(emRevisao[item.id]),
                    Boolean(emCorrecao[item.id]),
                  ) === coluna.id,
              ).length;
              return (
                <option key={coluna.id} value={coluna.id}>
                  {coluna.label} ({quantos})
                </option>
              );
            })}
          </select>

          <select
            className="h-9 rounded-lg border border-line/70 bg-surface px-2 text-sm text-ink outline-none [&>option]:bg-surface [&>option]:text-ink"
            onChange={(event) => {
              setColunaOrdem(null);
              setOrdem(event.target.value as typeof ordem);
            }}
            value={ordem}
          >
            <option value="antigos">Mais antigos primeiro</option>
            <option value="recentes">Mais recentes primeiro</option>
            <option value="nome">Nome (A–Z)</option>
          </select>
        </div>
      </header>

      {visao === "kanban" ? (
        <KanbanBoard
          analistaDe={(id) =>
            analistas.find((pessoa) => pessoa.id === analistaPorItem[id])?.nome ?? ""
          }
          carregando={carregando}
          emCorrecao={emCorrecao}
          emRevisao={emRevisao}
          filtro={filtro}
          indeferidos={indeferidos}
          itens={visiveis}
          onAbrir={abrirItem}
          progresso={progresso}
        />
      ) : (
      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-surface">
        {carregando ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 aria-hidden="true" className="size-5 animate-spin text-ink-muted" />
          </div>
        ) : visiveis.length === 0 ? (
          <p className="py-16 text-center text-sm text-ink-muted">Nada aguardando validação.</p>
        ) : (
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-line bg-subtle text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <ThOrdenavel
                  campo="nome"
                  className="px-4 py-2.5"
                  estado={colunaOrdem}
                  onOrdenar={setColunaOrdem}
                >
                  Quem
                </ThOrdenavel>
                <ThOrdenavel campo="etapa" estado={colunaOrdem} onOrdenar={setColunaOrdem}>
                  Etapa
                </ThOrdenavel>
                <th className="px-3 py-2.5">Analista</th>
                <ThOrdenavel
                  campo="documento"
                  estado={colunaOrdem}
                  onOrdenar={setColunaOrdem}
                >
                  Documento
                </ThOrdenavel>
                <ThOrdenavel
                  campo="empreendimento"
                  estado={colunaOrdem}
                  onOrdenar={setColunaOrdem}
                >
                  Empreendimento
                </ThOrdenavel>
                <ThOrdenavel campo="chegada" estado={colunaOrdem} onOrdenar={setColunaOrdem}>
                  Chegou em
                </ThOrdenavel>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {visiveis.map((item) => {
                const imob = item.papel === "imobiliaria";
                return (
                  <tr
                    className="cursor-pointer border-b border-line/70 transition-colors last:border-b-0 hover:bg-[#A07C3B]/8"
                    key={item.id}
                    onClick={() => abrirItem(item)}
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-subtle text-ink-muted">
                          {imob ? (
                            <Building2 aria-hidden="true" className="size-4" />
                          ) : (
                            <UserRound aria-hidden="true" className="size-4" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="m-0 truncate text-sm font-semibold text-ink">
                            {toTitleCase(item.nome)}
                          </p>
                          <p className="m-0 truncate text-[11px] text-ink-muted">
                            {imob ? "Imobiliária" : "CAD · prospect"}
                            {/* Quem indicou a CAD: vem da importação do Asana. */}
                            {item.imobiliaria ? ` · ${item.imobiliaria}` : ""}
                          </p>
                        </div>
                      </div>
                    </td>
                    {/* Etapa do workflow: mesma cor/rótulo das colunas do kanban. */}
                    <td className="px-3 py-2.5">
                      <EtapaChip
                        coluna={colunaDoItem(
                          item,
                          progresso[item.id] ?? 0,
                          Boolean(indeferidos[item.id]),
                          Boolean(emRevisao[item.id]),
                          Boolean(emCorrecao[item.id]),
                        )}
                        imob={imob}
                      />
                    </td>

                    {/* Analista: quem está cuidando. O clique no select não abre o item. */}
                    <td className="px-3 py-2.5" onClick={(event) => event.stopPropagation()}>
                      <select
                        className="h-8 max-w-[150px] rounded-lg border border-line/70 bg-surface px-2 text-xs text-ink outline-none [&>option]:bg-surface [&>option]:text-ink"
                        onChange={(event) =>
                          setAnalistaPorItem((prev) => ({
                            ...prev,
                            [item.id]: event.target.value,
                          }))
                        }
                        value={analistaPorItem[item.id] ?? ""}
                      >
                        <option value="">Sem analista</option>
                        {analistas.map((pessoa) => (
                          <option key={pessoa.id} value={pessoa.id}>
                            {pessoa.nome}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className="px-3 py-2.5 text-ink-soft">{item.documento || "—"}</td>
                    <td className="px-3 py-2.5">
                      {item.empreendimentos.length ? (
                        <div className="flex flex-wrap gap-1">
                          {item.empreendimentos.map((nome) => (
                            <span
                              className="rounded border border-[#A07C3B]/25 bg-[#A07C3B]/8 px-1.5 py-0.5 text-[11px] font-medium text-[#7A5E2C] dark:text-[#d9b877]"
                              key={nome}
                            >
                              {toTitleCase(nome)}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <p className="m-0 text-sm text-ink-soft">{chegadaEm(item.criadoEm)}</p>
                      <p className="m-0 text-[11px] text-ink-muted">
                        há {esperaDesde(item.criadoEm)}
                      </p>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className="inline-flex items-center rounded-lg border border-line bg-subtle px-2.5 py-1 text-[11px] font-semibold text-ink-soft">
                        Validar
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      )}
    </section>
  );
}

// --- Kanban (mesmo padrão visual do board da Íris) --------------------------------------------

// O fluxo é UM só (Lucas 18/jul): Validação -> Análise de crédito -> Pré-venda -> Credenciado.
// "Em correção" é o desvio: item devolvido pra ajuste, podendo vir de qualquer etapa.
type Coluna = { accent: string; id: string; label: string };

// Funil da CAD (cliente): passa por crédito e paga a pré-venda.
const COLUNAS_CAD: Coluna[] = [
  { accent: "#2563EB", id: "validacao", label: "Validação" },
  { accent: "#A07C3B", id: "credito", label: "Análise de crédito" },
  // O analista escala e o COORDENADOR decide: pode aprovar um crédito que o analista barraria.
  { accent: "#7C3AED", id: "revisao", label: "Crédito em revisão" },
  { accent: "#0891B2", id: "prevenda", label: "Pré-venda" },
  { accent: "#10B981", id: "credenciado", label: "Credenciado" },
  { accent: "#F59E0B", id: "correcao", label: "Em correção" },
  { accent: "#DC2626", id: "indeferido", label: "Crédito indeferido" },
];

// Funil da IMOBILIÁRIA: credenciamento de parceiro. Sem crédito, sem pré-venda e SEM coluna de
// corretores — validar os corretores acontece dentro da própria Validação (Lucas 18/jul).
const COLUNAS_IMOBILIARIA: Coluna[] = [
  { accent: "#2563EB", id: "validacao", label: "Validação" },
  { accent: "#10B981", id: "habilitada", label: "Habilitada" },
  { accent: "#F59E0B", id: "correcao", label: "Em correção" },
  { accent: "#DC2626", id: "indeferido", label: "Recusada" },
];

const colunasDoTipo = (imob: boolean): Coluna[] =>
  imob ? COLUNAS_IMOBILIARIA : COLUNAS_CAD;

// Desvios têm precedência sobre a etapa: o item sai do caminho normal.
function colunaDoItem(
  item: ItemFila,
  etapa: number,
  indeferido = false,
  emRevisao = false,
  emCorrecao = false,
): string {
  if (indeferido) return "indeferido";
  if (emCorrecao) return "correcao";
  if (item.papel === "imobiliaria") {
    return etapa <= 0 ? "validacao" : "habilitada";
  }
  if (emRevisao) return "revisao";
  if (etapa <= 0) return "validacao";
  if (etapa === 1) return "credito";
  if (etapa === 2) return "prevenda";
  return "credenciado";
}

type CampoOrdem = "chegada" | "documento" | "empreendimento" | "etapa" | "nome";
type EstadoOrdem = { campo: CampoOrdem; desc: boolean } | null;

// Cabeçalho que ordena ao clique: 1º clique ascendente, 2º descendente, 3º volta ao padrão.
// A seta mostra o estado — sem ela o operador clica no escuro.
function ThOrdenavel(props: {
  campo: CampoOrdem;
  children: React.ReactNode;
  className?: string;
  estado: EstadoOrdem;
  onOrdenar: (estado: EstadoOrdem) => void;
}) {
  const ativo = props.estado?.campo === props.campo;

  return (
    <th className={props.className ?? "px-3 py-2.5"}>
      <button
        className={`flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
          ativo ? "text-ink" : "text-ink-muted hover:text-ink"
        }`}
        onClick={() => {
          if (!ativo) props.onOrdenar({ campo: props.campo, desc: false });
          else if (!props.estado?.desc) props.onOrdenar({ campo: props.campo, desc: true });
          else props.onOrdenar(null);
        }}
        type="button"
      >
        {props.children}
        <span aria-hidden="true" className="text-[9px]">
          {ativo ? (props.estado?.desc ? "▼" : "▲") : "↕"}
        </span>
      </button>
    </th>
  );
}

// Onde o item está no workflow — o mesmo vocabulário visual do kanban, dentro da lista.
function EtapaChip({ coluna, imob }: { coluna: string; imob: boolean }) {
  const colunas = colunasDoTipo(imob);
  const etapa = colunas.find((item) => item.id === coluna) ?? colunas[0];
  if (!etapa) return null;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-subtle px-2.5 py-1 text-[11px] font-semibold text-ink-soft">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: etapa.accent }}
      />
      {etapa.label}
    </span>
  );
}

function KanbanBoard({
  analistaDe,
  carregando,
  emCorrecao,
  emRevisao,
  filtro,
  indeferidos,
  itens,
  onAbrir,
  progresso,
}: {
  analistaDe: (id: string) => string;
  carregando: boolean;
  emCorrecao: Record<string, boolean>;
  emRevisao: Record<string, boolean>;
  filtro: "todos" | "imobiliaria" | "prospect";
  indeferidos: Record<string, boolean>;
  itens: ItemFila[];
  onAbrir: (item: ItemFila) => void;
  progresso: Record<string, number>;
}) {
  if (carregando) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-line bg-surface">
        <Loader2 aria-hidden="true" className="size-5 animate-spin text-ink-muted" />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
      {colunasDoTipo(filtro === "imobiliaria").map((coluna) => {
        const cards = itens.filter(
          (item) =>
            colunaDoItem(item, progresso[item.id] ?? 0, Boolean(indeferidos[item.id]), Boolean(emRevisao[item.id]), Boolean(emCorrecao[item.id])) ===
            coluna.id,
        );
        return (
          <div
            className="flex w-[264px] shrink-0 flex-col rounded-xl border border-line/70 bg-subtle/50"
            key={coluna.id}
          >
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: coluna.accent }}
                />
                <span className="truncate text-xs font-semibold uppercase tracking-normal text-ink-muted">
                  {coluna.label}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11px] font-bold text-ink-muted ring-1 ring-slate-200 dark:ring-white/10">
                {cards.length}
              </span>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
              {cards.length > 0 ? (
                cards.map((item) => (
                  <CardBoard
                    analista={analistaDe(item.id)}
                    item={item}
                    key={item.id}
                    onAbrir={onAbrir}
                  />
                ))
              ) : (
                <p className="px-1 py-6 text-center text-[11px] text-ink-muted">Nada por aqui</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// O histórico começa SEMPRE na chegada (regra do Lucas: registrar desde o primeiro dia) e
// recebe por cima o que foi acontecendo no Board.
function historicoDoItem(item: ItemFila, extras: EventoHistorico[]): EventoHistorico[] {
  const base: EventoHistorico = {
    autor: item.papel === "imobiliaria" ? "Portal de credenciamento" : "Corretor",
    em: item.criadoEm,
    id: "chegada",
    texto:
      item.papel === "imobiliaria"
        ? "Credenciamento recebido pelo portal"
        : "CAD recebida",
    tipo: "chegada",
  };
  return [base, ...extras];
}

function ModalChatHistorico({
  eventos,
  mensagens,
  nome,
  onEnviar,
  onFechar,
}: {
  eventos: EventoHistorico[];
  mensagens: Mensagem[];
  nome: string;
  onEnviar: (texto: string) => void;
  onFechar: () => void;
}) {
  const [aba, setAba] = useState<"chat" | "historico">("historico");
  const [texto, setTexto] = useState("");

  const enviar = () => {
    const limpo = texto.trim();
    if (!limpo) return;
    onEnviar(limpo);
    setTexto("");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Clicar fora fecha. */}
      <button
        aria-label="Fechar"
        className="absolute inset-0 cursor-default bg-black/40"
        onClick={onFechar}
        type="button"
      />

      <aside className="relative flex h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <p className="m-0 truncate text-sm font-semibold text-ink">{nome}</p>
            <p className="m-0 text-[11px] text-ink-muted">Chat interno e histórico do processo</p>
          </div>
          <button
            aria-label="Fechar"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
            onClick={onFechar}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1 border-b border-line p-2">
          {(
            [
              ["chat", "Chat"],
              ["historico", "Histórico"],
            ] as const
          ).map(([valor, rotulo]) => (
            <button
              className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                aba === valor ? "bg-inverse text-brand-ink" : "text-ink-soft hover:bg-subtle"
              }`}
              key={valor}
              onClick={() => setAba(valor)}
              type="button"
            >
              {rotulo}
            </button>
          ))}
        </div>

      {aba === "historico" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <ol className="relative grid gap-3 border-l border-line pl-4">
            {eventos.map((evento) => (
              <li className="relative" key={evento.id}>
                <span
                  className="absolute -left-[21px] top-1 size-2.5 rounded-full ring-2 ring-surface"
                  style={{ backgroundColor: corDoEvento(evento.tipo) }}
                  aria-hidden="true"
                />
                <p className="m-0 text-sm text-ink">{evento.texto}</p>
                <p className="m-0 mt-0.5 text-[11px] text-ink-muted">
                  {evento.autor} · {chegadaEm(evento.em)}
                </p>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {mensagens.length === 0 ? (
              <p className="py-8 text-center text-xs text-ink-muted">
                Sem mensagens. Use para falar com a gestão sobre este caso.
              </p>
            ) : (
              <div className="grid gap-2">
                {mensagens.map((msg) => (
                  <div className="rounded-lg border border-line bg-subtle/50 px-3 py-2" key={msg.id}>
                    <p className="m-0 text-sm text-ink">{msg.texto}</p>
                    <p className="m-0 mt-0.5 text-[11px] text-ink-muted">
                      {msg.autor} · {chegadaEm(msg.em)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-end gap-2 border-t border-line p-2">
            <textarea
              className="min-h-[38px] flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted"
              onChange={(event) => setTexto(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  enviar();
                }
              }}
              placeholder="Comentar com a gestão…"
              rows={1}
              value={texto}
            />
            <button
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-inverse text-brand-ink transition-colors hover:bg-inverse/90 disabled:opacity-40"
              disabled={!texto.trim()}
              onClick={enviar}
              type="button"
            >
              <Send aria-hidden="true" className="size-4" />
            </button>
          </div>
        </>
      )}
      </aside>
    </div>
  );
}

// Motivos frequentes: um clique preenche, e o operador ainda pode escrever. Acelera sem
// engessar — e garante que a devolutiva nunca vá vazia.
const MOTIVOS_CORRECAO = [
  "Documento ilegível",
  "Documento vencido",
  "Falta comprovante de endereço",
  "Falta documento do sócio",
  "Dados divergentes do documento",
  "CRECI não confere",
];

const MOTIVOS_REPROVACAO = [
  "Score de crédito insuficiente",
  "Negativações em aberto",
  "Protestos em aberto",
  "Documentação inconsistente",
  "Não atende aos critérios do empreendimento",
];

function ModalMotivo({
  imob,
  onCancelar,
  onConfirmar,
  tipo,
}: {
  imob: boolean;
  onCancelar: () => void;
  onConfirmar: (motivo: string) => void;
  tipo: "correcao" | "indeferir";
}) {
  const [texto, setTexto] = useState("");
  const correcao = tipo === "correcao";
  const sugestoes = correcao ? MOTIVOS_CORRECAO : MOTIVOS_REPROVACAO;

  const adicionar = (motivo: string) =>
    setTexto((atual) => (atual.trim() ? `${atual.trim()}; ${motivo}` : motivo));

  const confirmar = () => {
    const limpo = texto.trim();
    if (!limpo) return;
    onConfirmar(limpo);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        aria-label="Fechar"
        className="absolute inset-0 cursor-default bg-black/40"
        onClick={onCancelar}
        type="button"
      />

      <div className="relative flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="border-b border-line px-5 py-4">
          <h2 className="m-0 text-base font-semibold text-ink">
            {correcao
              ? "Enviar para correção"
              : imob
                ? "Recusar credenciamento"
                : "Indeferir crédito"}
          </h2>
          <p className="m-0 mt-0.5 text-xs text-ink-muted">
            {correcao
              ? "Aponte o que precisa ser corrigido. O corretor recebe essa devolutiva."
              : "Registre o motivo da reprovação. Fica no histórico do processo."}
          </p>
        </div>

        <div className="grid gap-3 px-5 py-4">
          <div className="flex flex-wrap gap-1.5">
            {sugestoes.map((motivo) => (
              <button
                className="rounded-full border border-line bg-subtle px-2.5 py-1 text-xs font-medium text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
                key={motivo}
                onClick={() => adicionar(motivo)}
                type="button"
              >
                + {motivo}
              </button>
            ))}
          </div>

          <textarea
            autoFocus
            className="min-h-[110px] w-full resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted"
            onChange={(event) => setTexto(event.target.value)}
            placeholder={
              correcao
                ? "Descreva o que precisa ser corrigido…"
                : "Descreva o motivo da reprovação…"
            }
            value={texto}
          />
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button
            className="inline-flex h-9 items-center rounded-lg border border-line px-4 text-sm font-medium text-ink-soft transition-colors hover:bg-subtle"
            onClick={onCancelar}
            type="button"
          >
            Cancelar
          </button>
          <button
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-5 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              correcao ? "bg-[#D97706] hover:bg-[#B45309]" : "bg-rose-600 hover:bg-rose-700"
            }`}
            disabled={!texto.trim()}
            onClick={confirmar}
            type="button"
          >
            {correcao ? "Enviar para correção" : "Confirmar reprovação"}
          </button>
        </div>
      </div>
    </div>
  );
}

function corDoEvento(tipo: EventoHistorico["tipo"]): string {
  if (tipo === "chegada") return "#2563EB";
  if (tipo === "aprovacao") return "#A07C3B";
  if (tipo === "etapa") return "#10B981";
  if (tipo === "nota") return "#94A3B8";
  return "#64748B";
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? "") : "";
  return `${primeira}${ultima}`.toUpperCase();
}

// Card no padrão da Íris: borda esquerda colorida pelo TIPO, chip, nome, documento e rodapé.
function CardBoard({
  analista,
  item,
  onAbrir,
}: {
  analista: string;
  item: ItemFila;
  onAbrir: (item: ItemFila) => void;
}) {
  const imob = item.papel === "imobiliaria";
  const abrir = () => onAbrir(item);

  return (
    <article
      className="cursor-pointer rounded-lg border border-line/70 border-l-[3px] bg-surface px-2.5 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-subtle/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]/30"
      onClick={abrir}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          abrir();
        }
      }}
      role="button"
      style={{ borderLeftColor: imob ? "#A07C3B" : "#2563EB" }}
      tabIndex={0}
    >
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        {imob ? (
          <Building2 className="size-3.5 shrink-0 text-[#A07C3B]" aria-hidden="true" />
        ) : (
          <UserRound className="size-3.5 shrink-0 text-blue-500" aria-hidden="true" />
        )}
        <span
          className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
            imob
              ? "border-[#A07C3B]/30 bg-[#A07C3B]/10 text-[#7A5E2C] dark:text-[#d9b877]"
              : "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-300"
          }`}
        >
          {imob ? "Imobiliária" : "CAD"}
        </span>
      </div>

      <p className="truncate text-sm font-semibold text-ink">{toTitleCase(item.nome)}</p>
      {item.documento ? (
        <p className="mt-0.5 truncate text-xs text-ink-muted tabular-nums">{item.documento}</p>
      ) : null}

      {/* Empreendimento em destaque: é a informação que o Lucas precisa bater de imediato. */}
      {item.empreendimentos.length ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {item.empreendimentos.map((nome) => (
            <span
              className="rounded border border-[#A07C3B]/25 bg-[#A07C3B]/8 px-1.5 py-0.5 text-[10px] font-semibold text-[#7A5E2C] dark:text-[#d9b877]"
              key={nome}
            >
              {toTitleCase(nome)}
            </span>
          ))}
        </div>
      ) : null}

      {/* O que veio junto: ajuda a dimensionar o trabalho antes de abrir. */}
      {item.socios || item.corretores ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {item.socios ? <MiniChip label={`${item.socios} sócio(s)`} /> : null}
          {item.corretores ? <MiniChip label={`${item.corretores} corretor(es)`} /> : null}
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate text-[11px] text-ink-muted tabular-nums">
          {chegadaEm(item.criadoEm)}
        </span>
        {/* Analista responsável, no mesmo lugar em que a Íris mostra o operador. */}
        {analista ? (
          <span
            className="flex size-5 shrink-0 items-center justify-center rounded-full border border-line bg-subtle text-[8px] font-bold text-ink-soft"
            title={analista}
          >
            {iniciais(analista)}
          </span>
        ) : (
          <span className="shrink-0 text-[11px] text-ink-muted">
            há {esperaDesde(item.criadoEm)}
          </span>
        )}
      </div>
    </article>
  );
}

function MiniChip({ label }: { label: string }) {
  return (
    <span className="rounded border border-line bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-ink-soft">
      {label}
    </span>
  );
}

function DetalheBoard({
  emCorrecao,
  emRevisao,
  etapaAtual,
  indeferido,
  item,
  mensagens,
  onAbrirChat,
  onAprovarRevisao,
  onAvancar,
  onCorrecao,
  onEnviarGestao,
  onIndeferir,
  onReabrir,
  onVoltar,
}: {
  etapaAtual: number;
  item: ItemFila;
  emCorrecao: boolean;
  emRevisao: boolean;
  indeferido: boolean;
  mensagens: number;
  onAbrirChat: () => void;
  onAprovarRevisao: () => void;
  onAvancar: () => void;
  onCorrecao: () => void;
  // Escalar pro coordenador: o analista pede o aval de quem aprova o crédito.
  onEnviarGestao: () => void;
  onIndeferir: () => void;
  onReabrir: () => void;
  onVoltar: () => void;
}) {
  const imob = item.papel === "imobiliaria";
  const etapas = etapasDoItem(item);
  const indice = Math.min(etapaAtual, etapas.length - 1);
  const etapa = etapas[indice];
  const concluida = etapaAtual >= etapas.length;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div className="min-w-0">
          <h2 className="m-0 truncate text-lg font-semibold tracking-tight text-ink">
            {toTitleCase(item.nome)}
          </h2>
          <p className="m-0 mt-0.5 text-xs text-ink-muted">
            {imob ? "Imobiliária" : "CAD · prospect"}
            {item.documento ? ` · ${item.documento}` : ""}
            {imob && item.corretores ? ` · ${item.corretores} corretor(es)` : ""}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {emRevisao ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#7C3AED]/10 px-3 py-1 text-xs font-semibold text-[#6D28D9] dark:text-[#c4b5fd]">
              <ShieldCheck aria-hidden="true" className="size-3.5" />
              Aguardando o coordenador
            </span>
          ) : null}
          {emCorrecao ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              <AlertTriangle aria-hidden="true" className="size-3.5" />
              Aguardando correção
            </span>
          ) : null}
          {indeferido ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              <X aria-hidden="true" className="size-3.5" />
              {imob ? "Recusada" : "Crédito indeferido"}
            </span>
          ) : null}
          {concluida ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              <Check aria-hidden="true" className="size-3.5" />
              {imob ? "Apta" : "Credenciado"}
            </span>
          ) : null}
        </div>
      </div>

      {/* trilha das etapas */}
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {etapas.map((passo, i) => {
          const feita = i < etapaAtual;
          const atual = i === indice && !concluida;
          return (
            <li className="flex items-center gap-2" key={passo.id}>
              <span
                className={`flex size-7 items-center justify-center rounded-full text-[11px] font-bold ${
                  feita
                    ? "bg-emerald-500 text-white"
                    : atual
                      ? "bg-inverse text-brand-ink"
                      : "border border-line bg-surface text-ink-muted"
                }`}
              >
                {feita ? <Check aria-hidden="true" className="size-3.5" /> : i + 1}
              </span>
              <span
                className={`text-xs font-medium ${atual ? "text-ink" : "text-ink-muted"}`}
              >
                {passo.label}
              </span>
              {i < etapas.length - 1 ? (
                <span className="mx-1 h-px w-6 bg-line" />
              ) : null}
            </li>
          );
        })}
      </ol>

      {concluida || !etapa ? (
        <PainelConcluido imob={imob} />
      ) : (
        <PainelEtapa entityId={item.id} etapa={etapa} imob={imob} />
      )}

      <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
        <div className="flex items-center gap-2">
          <button
            className="inline-flex h-9 items-center rounded-lg border border-line px-4 text-sm font-medium text-ink-soft transition-colors hover:bg-subtle disabled:opacity-40"
            disabled={etapaAtual === 0}
            onClick={onVoltar}
            type="button"
          >
            Voltar
          </button>

          {/* Chat e histórico: compacto e destacado no dourado da marca, junto das ações. */}
          <button
            aria-label="Chat e histórico"
            className="relative inline-flex size-9 items-center justify-center rounded-lg border border-[#A07C3B]/40 bg-[#A07C3B]/10 text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/20 dark:text-[#d9b877]"
            onClick={onAbrirChat}
            title="Chat interno e histórico deste processo"
            type="button"
          >
            <MessageSquare aria-hidden="true" className="size-4" />
            {mensagens > 0 ? (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#A07C3B] px-1 text-[9px] font-bold text-white">
                {mensagens > 9 ? "9+" : mensagens}
              </span>
            ) : null}
          </button>
        </div>
        <div className="flex items-center gap-2">
          {indeferido || emCorrecao ? (
            // Não é beco sem saída: corrigida a pendência, a análise volta ao fluxo.
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-4 text-sm font-medium text-ink-soft transition-colors hover:bg-subtle"
              onClick={onReabrir}
              type="button"
            >
              {emCorrecao ? "Retomar análise" : "Reabrir análise"}
            </button>
          ) : emRevisao ? (
            // Em revisão: a decisão é do COORDENADOR — aprovar o crédito ou indeferir.
            <>
              <button
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 px-4 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
                onClick={onIndeferir}
                type="button"
              >
                <X aria-hidden="true" className="size-4" />
                Indeferir crédito
              </button>
              <button
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#7C3AED] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#6D28D9]"
                onClick={onAprovarRevisao}
                type="button"
              >
                <ShieldCheck aria-hidden="true" className="size-4" />
                Aprovar crédito (coordenador)
              </button>
            </>
          ) : concluida ? null : (
            <>
              <button
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-rose-200 px-4 text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
                onClick={onIndeferir}
                type="button"
              >
                <X aria-hidden="true" className="size-4" />
                {imob ? "Recusar" : "Indeferir crédito"}
              </button>
              {/* Devolver pro corretor ajustar — não é reprovação, é pendência. */}
              <button
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-amber-300 px-4 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50 dark:border-amber-500/30 dark:text-amber-300 dark:hover:bg-amber-500/10"
                onClick={onCorrecao}
                type="button"
              >
                <AlertTriangle aria-hidden="true" className="size-4" />
                Enviar para correção
              </button>
              {/* Escalar: quando o caso precisa do aval de quem aprova. */}
              <button
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#A07C3B]/40 px-4 text-sm font-medium text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10 dark:text-[#d9b877]"
                onClick={onEnviarGestao}
                type="button"
              >
                <ShieldCheck aria-hidden="true" className="size-4" />
                Enviar ao coordenador
              </button>
              <button
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-5 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90"
                onClick={onAvancar}
                type="button"
              >
                <Check aria-hidden="true" className="size-4" />
                {etapa ? acaoDaEtapa(etapa.id) : "Aprovar"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function acaoDaEtapa(id: string): string {
  if (id === "credito") return "Consultar Serasa";
  if (id === "prevenda") return "Gerar PIX";
  if (id === "credenciado") return "Confirmar pagamento";
  if (id === "habilitada") return "Habilitar imobiliária";
  return "Aprovar";
}

function PainelEtapa({
  entityId,
  etapa,
}: {
  entityId: string;
  etapa: Etapa;
  // `imob` continua no contrato porque quem chama passa, mas o painel não distingue os dois
  // fluxos hoje. Fica declarado e não desestruturado, em vez de sumir da assinatura.
  imob?: boolean;
}) {
  const Icon = etapa.icon;
  return (
    <div className="rounded-xl border border-line bg-subtle/40 p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-inverse text-brand-ink">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0">
          <h3 className="m-0 text-sm font-semibold text-ink">{etapa.label}</h3>
          <p className="m-0 mt-1 text-xs text-ink-soft">{etapa.descricao}</p>
        </div>
      </div>

      {/* Validação cadastral = documento ORIGINAL ao lado dos dados lidos (ideia do Lucas): sem o
          documento à vista o operador estaria conferindo no escuro. As demais etapas ficam vazias
          até a lógica ser ligada — nada de dado de mentira na tela. */}
      {etapa.id === "cadastro" ? <ValidacaoLadoALado entityId={entityId} /> : null}
    </div>
  );
}

type DocItem = {
  documentType: string;
  fileName: string | null;
  hasFile: boolean;
  id: string;
  label: string;
};

type Ficha = {
  cadastro: Record<string, unknown>;
  contato: { email: string; telefone: string };
  endereco: Record<string, string> | null;
  entidade: {
    criadoEm: string;
    documento: string;
    nome: string;
    nomeFantasia: string;
    papel: string;
    tipo: string;
  };
};

// `chave` = nome do campo em `apolo_esteira.ficha`. Campo COM chave é editável pelo operador;
// campo sem chave é só leitura (identidade da entidade, endereço e contato têm tabela própria).
// Regra do Lucas: "liberar os campos que a MOST não conseguiu nos devolver para que o operador
// possa completar o cadastro" — por isso o que é editável não depende do que veio preenchido.
type Campo = {
  chave?: string;
  full?: boolean;
  label: string;
  opcoes?: { id: number | string; label: string }[];
  tipo?: "data" | "select" | "texto";
  valor: string;
  valorCru?: string;
};
type SecaoFicha = { campos: Campo[]; titulo: string };

const texto = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const opcao = (lista: { id: number | string; label: string }[], id: unknown): string =>
  lista.find((o) => o.id.toString() === texto(id))?.label ?? "";

// Monta a ficha completa igual à REVISÃO do cadastro (decisão do Lucas: é essa tela que o
// operador quer ver na validação, com os dados de verdade, e não uma lista de rótulos).
function montarSecoes(ficha: Ficha): SecaoFicha[] {
  const c = ficha.cadastro;
  const e = ficha.endereco;
  const pj = ficha.entidade.tipo === "pj";
  const secoes: SecaoFicha[] = [];

  if (pj) {
    secoes.push({
      campos: [
        { full: true, label: "Razão social", valor: titleCase(ficha.entidade.nome) },
        { label: "Nome fantasia", valor: titleCase(ficha.entidade.nomeFantasia) },
        { label: "CNPJ", valor: ficha.entidade.documento },
        { label: "Porte", valor: texto(c.porte) },
        { label: "Abertura", valor: formatDateBR(texto(c.dataAbertura)) },
        { label: "Atualização cadastral", valor: formatDateBR(texto(c.dataAtualizacaoCadastral)) },
        { label: "Situação cadastral", valor: texto(c.situacaoCadastral) },
        { full: true, label: "Natureza jurídica", valor: texto(c.naturezaJuridica) },
        { label: "CNAE", valor: texto(c.cnae) },
        { full: true, label: "Atividade principal", valor: texto(c.atividade) },
        ...(texto(c.creci) ? [{ label: "CRECI Jurídico", valor: texto(c.creci) }] : []),
      ],
      titulo: "Dados da empresa",
    });
  } else {
    const livre = (chave: string, label: string, full = false): Campo => ({
      chave,
      full,
      label,
      tipo: "texto",
      valor: texto(c[chave]),
      valorCru: texto(c[chave]),
    });
    const lista = (
      chave: string,
      label: string,
      opcoes: { id: number | string; label: string }[],
    ): Campo => ({
      chave,
      label,
      opcoes,
      tipo: "select",
      valor: opcao(opcoes, c[chave]),
      valorCru: texto(c[chave]),
    });

    // ESPELHO DA REVISÃO DO FORMULÁRIO (decisão do Lucas 21/jul): a validação confere
    // exatamente os campos que a revisão do wizard mostra ao fim do cadastro — mesmas seções,
    // mesma ordem, mesmos rótulos. Ver `montarCadDoc` em blocks/cadastro/cadastro-flow.tsx.
    // Por isso NÃO há nome do pai, RG nem órgão emissor: o formulário não os revisa (o dado
    // lido do documento continua salvo, só não é conferido aqui).
    // 2 = Casado, 6 = União Estável (ids do C2X, ver C2X_ESTADO_CIVIL).
    const casado = ["2", "6"].includes(texto(c.estadoCivilId));

    secoes.push({
      campos: [
        { full: true, label: "Nome", valor: titleCase(ficha.entidade.nome) },
        { label: "CPF", valor: ficha.entidade.documento },
        {
          chave: "dataNascimento",
          label: "Nascimento",
          tipo: "data",
          valor: formatDateBR(texto(c.dataNascimento)),
          valorCru: texto(c.dataNascimento).slice(0, 10),
        },
        // Derivada do nascimento, como na revisão: não se digita idade, se digita a data.
        { label: "Idade", valor: calcIdade(texto(c.dataNascimento)) },
        livre("nomeMae", "Nome da mãe", true),
        livre("naturalidade", "Naturalidade"),
        livre("nacionalidade", "Nacionalidade"),
        lista("sexoId", "Sexo", C2X_SEXO),
        lista("estadoCivilId", "Estado civil", C2X_ESTADO_CIVIL),
        // Regime de bens só existe casado/união estável — igual à revisão.
        ...(casado ? [lista("regimeBensId", "Regime de bens", C2X_REGIME_BENS)] : []),
      ],
      titulo: "Identificação",
    });

    secoes.push({
      campos: [
        lista("escolaridadeId", "Escolaridade", C2X_ESCOLARIDADE),
        lista("rendaId", "Faixa de renda", C2X_FAIXA_RENDA),
        livre("patrimonio", "Patrimônio"),
        lista("profissaoId", "Profissão", C2X_PROFISSOES),
      ],
      titulo: "Perfil",
    });
  }

  // ENDEREÇO SEMPRE VISÍVEL, mesmo vazio (Lucas 21/jul: "não vi a parte de endereço").
  // As CADs importadas do Asana não trazem endereço, e a seção simplesmente sumia — o
  // operador não tinha onde preencher justamente o que falta. O valor mostrado vem da ficha
  // quando o operador já editou, senão do endereço cadastrado.
  const endCampo = (chave: string, label: string, full = false): Campo => {
    const daFicha = texto(c[chave]);
    const doCadastro = texto(e?.[chave] ?? "");
    return {
      chave,
      full,
      label,
      tipo: "texto",
      valor: daFicha || doCadastro,
      valorCru: daFicha || doCadastro,
    };
  };

  secoes.push({
    campos: [
      endCampo("logradouro", "Logradouro", true),
      endCampo("numero", "Número"),
      endCampo("complemento", "Complemento"),
      endCampo("bairro", "Bairro"),
      endCampo("cep", "CEP"),
      endCampo("cidade", "Cidade"),
      endCampo("uf", "UF"),
    ],
    titulo: "Endereço",
  });

  secoes.push({
    campos: [
      {
        chave: "telefone",
        label: "Telefone",
        tipo: "texto",
        valor: texto(c.telefone) || ficha.contato.telefone,
        valorCru: texto(c.telefone) || ficha.contato.telefone,
      },
      {
        chave: "email",
        full: true,
        label: "E-mail",
        tipo: "texto",
        valor: texto(c.email) || ficha.contato.email,
        valorCru: texto(c.email) || ficha.contato.email,
      },
    ],
    titulo: "Contato",
  });

  // CÔNJUGE — a revisão do formulário mostra a ficha inteira dele quando casado, e é
  // material de contrato. Aqui é read-only: o cônjuge é entidade própria, com ficha própria.
  const conjuge = (c.conjuge ?? null) as Record<string, unknown> | null;
  if (conjuge && texto(conjuge.nome)) {
    secoes.push({
      campos: [
        { full: true, label: "Nome", valor: titleCase(texto(conjuge.nome)) },
        { label: "CPF", valor: texto(conjuge.cpf) },
        { label: "Nascimento", valor: formatDateBR(texto(conjuge.dataNascimento)) },
        { label: "Idade", valor: calcIdade(texto(conjuge.dataNascimento)) },
        { full: true, label: "Nome da mãe", valor: titleCase(texto(conjuge.nomeMae)) },
        { label: "Telefone", valor: texto(conjuge.telefone) },
        { full: true, label: "E-mail", valor: texto(conjuge.email) },
      ],
      titulo: "Cônjuge",
    });
  }

  // Sócios cadastrados (ficha própria de cada um).
  const socios = Array.isArray(c.socios) ? (c.socios as Record<string, unknown>[]) : [];
  socios.forEach((s, i) => {
    const end = (s.endereco ?? {}) as Record<string, string>;
    secoes.push({
      campos: [
        { full: true, label: "Nome", valor: titleCase(texto(s.nome)) },
        { label: "CPF", valor: texto(s.cpf) },
        { label: "Nascimento", valor: formatDateBR(texto(s.dataNascimento)) },
        { label: "Sexo", valor: opcao(C2X_SEXO, s.sexoId) },
        { label: "Estado civil", valor: opcao(C2X_ESTADO_CIVIL, s.estadoCivilId) },
        { label: "Telefone", valor: texto(s.telefone) },
        { full: true, label: "E-mail", valor: texto(s.email) },
        {
          full: true,
          label: "Endereço",
          valor: [titleCase(end.logradouro ?? ""), end.numero, titleCase(end.cidade ?? ""), end.uf]
            .filter(Boolean)
            .join(", "),
        },
      ],
      titulo: `Sócio ${i + 1}${s.representanteLegal ? " · representante legal" : ""}`,
    });
  });

  // Empreendimentos pedidos e corretores vinculados (imobiliária).
  const empreendimentos = Array.isArray(c.empreendimentos)
    ? (c.empreendimentos as Record<string, unknown>[])
    : [];
  if (empreendimentos.length) {
    secoes.push({
      campos: empreendimentos.map((emp, i) => ({
        full: true,
        label: `Empreendimento ${i + 1}`,
        valor: titleCase(texto(emp.label)),
      })),
      titulo: "Empreendimentos vinculados",
    });
  }

  const corretores = Array.isArray(c.corretores)
    ? (c.corretores as Record<string, unknown>[])
    : [];
  corretores.forEach((k, i) => {
    secoes.push({
      campos: [
        { full: true, label: "Nome", valor: titleCase(texto(k.nome)) },
        { label: "CPF", valor: texto(k.cpf) },
        { label: "CRECI", valor: texto(k.creci) },
        { label: "Telefone", valor: texto(k.telefone) },
        { full: true, label: "E-mail", valor: texto(k.email) },
      ],
      titulo: `Corretor ${i + 1}`,
    });
  });

  return secoes;
}

// Ficha completa (esquerda) + documento original (direita). O operador lê a ficha e confere no
// documento antes de aprovar.
function ValidacaoLadoALado({ entityId }: { entityId: string }) {
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [ativo, setAtivo] = useState<DocItem | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [pendentes, setPendentes] = useState<Set<string>>(new Set());
  const [salvos, setSalvos] = useState<Set<string>>(new Set());
  const [erroSalvar, setErroSalvar] = useState<string | null>(null);

  // CEP digitado -> traz o resto do endereço (ViaCEP), igual ao wizard de cadastro. A busca
  // nunca lança: CEP inválido ou serviço fora do ar apenas salva o CEP e o operador completa
  // na mão. Só preenche campo VAZIO, para não apagar o que ele já tenha corrigido.
  const salvarCep = async (valor: string) => {
    const achado = await buscarEnderecoPorCep(valor);
    if (!achado) {
      await salvar("cep", valor);
      return;
    }
    const atual = (ficha?.cadastro ?? {}) as Record<string, unknown>;
    const extras: Record<string, string> = {};
    for (const [campo, vindo] of Object.entries({
      bairro: achado.bairro,
      cidade: achado.cidade,
      logradouro: achado.logradouro,
      uf: achado.uf,
    })) {
      if (vindo && !texto(atual[campo])) extras[campo] = vindo;
    }
    await salvar("cep", valor, extras);
  };

  // Salva UM campo por vez, no blur (texto) ou no change (lista). Sem botão "salvar": o operador
  // passa o dia nesta tela e um botão único perde trabalho se a aba fechar no meio.
  const salvar = async (chave: string, valor: string, extras?: Record<string, string>) => {
    setErroSalvar(null);
    setPendentes((atual) => new Set(atual).add(chave));
    const campos = { [chave]: valor, ...(extras ?? {}) };
    try {
      const accessToken = await getApoloAccessToken();
      const response = await fetch(`/api/apolo/board/${entityId}`, {
        body: JSON.stringify({ campos }),
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Não foi possível salvar.");
      }
      // Reflete na ficha em memória para o select mostrar o novo rótulo na hora.
      setFicha((atual) =>
        atual ? { ...atual, cadastro: { ...atual.cadastro, ...campos } } : atual,
      );
      setSalvos((atual) => {
        const proximo = new Set(atual);
        for (const c of Object.keys(campos)) proximo.add(c);
        return proximo;
      });
    } catch (error) {
      setErroSalvar((error as Error).message);
    } finally {
      setPendentes((atual) => {
        const proximo = new Set(atual);
        proximo.delete(chave);
        return proximo;
      });
    }
  };

  useEffect(() => {
    let alive = true;
    setCarregando(true);
    void (async () => {
      try {
        const accessToken = await getApoloAccessToken();
        const headers = { Authorization: `Bearer ${accessToken}` };
        const [resDocs, resFicha] = await Promise.all([
          fetch(`/api/apolo/documentos?entityId=${encodeURIComponent(entityId)}`, {
            cache: "no-store",
            headers,
          }),
          fetch(`/api/apolo/board/${entityId}`, { cache: "no-store", headers }),
        ]);
        // ⚠️ /api/apolo/documentos devolve { documents } na RAIZ, sem envelope `data` —
        // diferente de /api/apolo/board/[id], que usa { data }. Ler data.documents aqui fazia
        // a lista vir SEMPRE vazia: a validação nunca mostrou documento nenhum, e só dava para
        // perceber depois que passou a existir documento para mostrar.
        const payloadDocs = (await resDocs.json()) as {
          documents?: DocItem[];
        };
        const payloadFicha = (await resFicha.json()) as { data?: Ficha };
        const lista = (payloadDocs.documents ?? []).filter((doc) => doc.hasFile);
        if (!alive) return;
        setDocs(lista);
        setAtivo(lista[0] ?? null);
        setFicha(payloadFicha.data ?? null);
      } catch {
        // sem documentos/ficha
      } finally {
        if (alive) setCarregando(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [entityId]);

  // Cada arquivo é servido por URL assinada (bucket privado).
  useEffect(() => {
    if (!ativo) {
      setUrl(null);
      return;
    }
    let alive = true;
    setAbrindo(true);
    setZoom(1);
    void (async () => {
      try {
        const accessToken = await getApoloAccessToken();
        const response = await fetch(`/api/apolo/documentos/${ativo.id}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const payload = (await response.json()) as { url?: string };
        if (alive) setUrl(payload.url ?? null);
      } catch {
        if (alive) setUrl(null);
      } finally {
        if (alive) setAbrindo(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ativo]);

  const ehPdf = (nome: string | null) => /\.pdf$/i.test(nome ?? "");

  return (
    <div className="mt-4 grid gap-3 xl:grid-cols-2">
      {/* ---- 1) ficha completa: os DADOS vêm primeiro (a mesma tela da revisão) ---- */}
      <div className="max-h-[70vh] overflow-y-auto rounded-xl border border-line bg-surface p-4">
        {carregando ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 aria-hidden="true" className="size-5 animate-spin text-ink-muted" />
          </div>
        ) : !ficha ? (
          <p className="py-16 text-center text-xs text-ink-muted">
            Não foi possível carregar a ficha.
          </p>
        ) : (
          <div className="grid gap-5">
            {erroSalvar ? (
              <p className="m-0 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
                {erroSalvar}
              </p>
            ) : null}
            {montarSecoes(ficha).map((secao) => (
              <div key={secao.titulo}>
                <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink">
                  {secao.titulo}
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {secao.campos.map((campo) => (
                    <div
                      className={`rounded-lg border px-3 py-2 ${
                        campo.chave ? "border-line bg-surface" : "border-line bg-subtle/40"
                      } ${campo.full ? "sm:col-span-2" : ""}`}
                      key={`${secao.titulo}-${campo.label}`}
                    >
                      <p className="m-0 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                        {campo.label}
                        {pendentes.has(campo.chave ?? "") ? (
                          <Loader2 aria-hidden="true" className="size-3 animate-spin" />
                        ) : salvos.has(campo.chave ?? "") ? (
                          <Check aria-hidden="true" className="size-3 text-emerald-600" />
                        ) : null}
                      </p>

                      {!campo.chave ? (
                        <p className="m-0 mt-0.5 text-sm text-ink">{campo.valor || "—"}</p>
                      ) : campo.tipo === "select" ? (
                        /* ⚠️ NÃO trocar por `bg-transparent`. O popup do <select> é desenhado
                           pelo browser usando a cor de fundo COMPUTADA do elemento, e
                           `transparent` resolve para BRANCO — enquanto a <option> herda o
                           `text-ink` claro do dark. Dá branco no branco, ilegível (bug visto
                           em 21/jul). O globals.css já amarra `color-scheme` ao tema, mas um
                           background explícito no select passa por cima disso. */
                        <select
                          className="mt-0.5 w-full border-0 bg-surface p-0 text-sm text-ink outline-none focus:ring-0 [&>option]:bg-surface [&>option]:text-ink"
                          onChange={(event) => void salvar(campo.chave!, event.target.value)}
                          value={campo.valorCru ?? ""}
                        >
                          <option value="">—</option>
                          {(campo.opcoes ?? []).map((o) => (
                            <option key={o.id} value={o.id.toString()}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="mt-0.5 w-full border-0 bg-transparent p-0 text-sm text-ink outline-none placeholder:text-ink-muted focus:ring-0"
                          defaultValue={campo.valorCru ?? ""}
                          key={`${campo.chave}-${campo.valorCru ?? ""}`}
                          onBlur={(event) => {
                            if (event.target.value !== (campo.valorCru ?? "")) {
                              if (campo.chave === "cep") void salvarCep(event.target.value);
                              else void salvar(campo.chave!, event.target.value);
                            }
                          }}
                          placeholder="—"
                          type={campo.tipo === "data" ? "date" : "text"}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ---- 2) documentos: a conferência vem depois dos dados ---- */}
      <div className="flex min-h-[360px] flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-line p-2">
          {carregando ? (
            <span className="px-2 py-1 text-xs text-ink-muted">Carregando documentos…</span>
          ) : docs.length === 0 ? (
            <span className="px-2 py-1 text-xs text-ink-muted">Nenhum documento anexado.</span>
          ) : (
            docs.map((doc) => (
              <button
                className={`shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${
                  ativo?.id === doc.id
                    ? "bg-inverse text-brand-ink"
                    : "text-ink-soft hover:bg-subtle"
                }`}
                key={doc.id}
                onClick={() => setAtivo(doc)}
                type="button"
              >
                {doc.label}
              </button>
            ))
          )}
        </div>

        <div className="relative min-h-0 flex-1 overflow-auto bg-subtle/60">
          {abrindo ? (
            <div className="flex h-full items-center justify-center py-16">
              <Loader2 aria-hidden="true" className="size-5 animate-spin text-ink-muted" />
            </div>
          ) : !url ? (
            <div className="flex h-full items-center justify-center py-16 text-xs text-ink-muted">
              Selecione um documento.
            </div>
          ) : ehPdf(ativo?.fileName ?? null) ? (
            <iframe className="size-full min-h-[320px]" src={url} title={ativo?.label ?? "Documento"} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={ativo?.label ?? "Documento"}
              className="mx-auto block origin-top transition-transform"
              src={url}
              style={{ transform: `scale(${zoom})` }}
            />
          )}
        </div>

        {/* Foto de celular sem zoom não dá pra conferir: lupa igual à do Chronos. */}
        {url && !ehPdf(ativo?.fileName ?? null) ? (
          <div className="flex shrink-0 items-center justify-center gap-2 border-t border-line p-2">
            {[1, 1.5, 2, 3].map((nivel) => (
              <button
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                  zoom === nivel ? "bg-inverse text-brand-ink" : "text-ink-soft hover:bg-subtle"
                }`}
                key={nivel}
                onClick={() => setZoom(nivel)}
                type="button"
              >
                {nivel}x
              </button>
            ))}
          </div>
        ) : null}
      </div>

    </div>
  );
}


function PainelConcluido({ imob }: { imob: boolean }) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 dark:border-emerald-500/30 dark:bg-emerald-500/10">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500 text-white">
          <Check aria-hidden="true" className="size-5" />
        </span>
        <div>
          <h3 className="m-0 text-sm font-semibold text-emerald-800 dark:text-emerald-200">
            {imob ? "Imobiliária habilitada" : "Cliente credenciado"}
          </h3>
          <p className="m-0 mt-1 text-xs text-emerald-700 dark:text-emerald-300">
            {imob
              ? "Os corretores aprovados já podem enviar CADs para os empreendimentos liberados."
              : "Entrou na fila do lançamento pela data e hora do pagamento, dentro do Prometeu."}
          </p>
        </div>
      </div>
    </div>
  );
}
