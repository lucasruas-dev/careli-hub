"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Check,
  ChevronDown,
  CircleDollarSign,
  ContactRound,
  FileText,
  Files,
  Filter,
  History,
  Home,
  LayoutDashboard,
  MapPinned,
  Network,
  Search,
  Store,
  Video,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { fonte } from "@/modules/publico/ui/tokens";
import type {
  CompradorDoCrm,
  FichaComprador,
  FichaDoCrm,
  FichaImobiliaria,
  FichaProspect,
  ImobiliariaDoCrm,
  ProspectDoCrm,
  TipoDaFicha,
  UnidadeDaFicha,
  UnidadeDoCrm,
} from "@/lib/apolo/incorporador/crm";
import type {
  GrupoDoCadastro,
  RelacionamentosDaFicha,
} from "@/lib/apolo/incorporador/ficha-cadastro";
import type { DocumentoDoPortal } from "@/lib/apolo/incorporador/documentos";
import type {
  CategoriaDoHistorico,
  EventoDoHistorico,
} from "@/lib/apolo/incorporador/historico";

import { T } from "./tema";

// CRM DO INCORPORADOR — o CRM 360 do Apolo, portado para o portal e recortado no empreendimento
// do cliente.
//
// Pedido do Lucas (17/08/2026): portar as telas REAIS do Apolo, mesma estrutura, copiando o
// código, não fazendo releitura. O desenho aqui vem de três arquivos do CRM interno:
//
//   • modules/apolo/blocks/crm/entity-list.tsx — EntityColumn + EntityListItem +
//     ProfileFilterDropdown viraram ColunaDeEntidades + ItemDaLista + FiltroDePapel;
//   • modules/apolo/blocks/crm/record-workspace.tsx — RecordHeader + TabStrip viraram
//     CabecalhoDaFicha + FaixaDeAbas, com o mesmo vazio de "selecione um relacionamento";
//   • modules/apolo/blocks/crm/panels.tsx + scoped-portfolio-panel.tsx — SummaryPanel e o
//     desenho de KPIs + cards do ScopedPortfolioPanel viraram os painéis Resumo e Carteira.
//
// O QUE MUDA DE PROPÓSITO em relação ao interno:
//   • fonte de dados é SEMPRE /api/incorporador/* (lista em /crm, ficha em /crm/ficha) — nunca
//     /api/apolo/* (o gate de lá aceita qualquer c2xId; ver o aviso em sessao.ts);
//   • filtro por papel reduzido aos três papéis que o portal tem (Compradores, Cadastros em
//     andamento, Imobiliárias);
//   • Tailwind virou token T (tema claro/escuro do portal), e o dourado #A07C3B do interno não
//     entra como estado — seleção e aba ativa usam o grafite (padrão aprovado pelo Lucas);
//   • busca LOCAL (com Enter, como no interno): a lista do empreendimento já veio inteira, e
//     refazer a chamada custaria as sete consultas C2X da aba Compradores de novo.
//
// DESDE 18/08/2026 A FICHA TEM AS MESMAS 7 ABAS DA INTERNA (ordem do Lucas: *"CRM, tem que ser
// igual, cadastro, tudo que estiver no apolo tem que está aqui, os documentos"*): Resumo,
// Cadastro, Relacionamentos, Carteira, Financeiro, Documentos e Histórico. Os quatro painéis
// novos portam o desenho dos internos com as diferenças de contrato do portal:
//   • Cadastro (RegistrationPanel) — mesmos grupos, documento SEM máscara, SEM o botão Editar
//     (escrita é operação interna);
//   • Relacionamentos (RelationshipsPanel) — cônjuge/imobiliária/corretor/contratos do escopo,
//     SEM telefone/e-mail de terceiros e SEM criar/excluir vínculo;
//   • Documentos (DocumentsPanel) — três fontes via /api/incorporador/crm/documentos, SEM
//     upload e SEM remover; anexo preso no S3 do C2X aparece desabilitado com explicação;
//   • Histórico (EntityTimelinePanel) — só venda/pagamento/reunião (Iris/Hades/manuais são
//     operação interna), com os chips de categoria e o filtro de período da interna.
//
// FICOU DE FORA, declarado: AuditPanel, StatementPanel, HadesRecordWorkspace, os HeaderActions
// ("Abrir atendimento"/"Agenda" são operação interna), as subabas por unidade
// (apoloUnitSubtabs), o "Registrar" do histórico (escrita interna), os papéis de filtro que o
// portal não tem, e o CrmCommandCenter (KPIs do CRM inteiro da Careli + "novo cadastro").

// ── TIPOS DA TELA ───────────────────────────────────────────────────────────

type Aba = "compradores" | "imobiliarias" | "prospects";

type Dados = {
  compradores?: CompradorDoCrm[];
  imobiliarias?: ImobiliariaDoCrm[];
  prospects?: ProspectDoCrm[];
};

type Selecao = { id: string; tipo: TipoDaFicha };

type AbaDaFicha =
  | "cadastro"
  | "carteira"
  | "documentos"
  | "financeiro"
  | "historico"
  | "relacionamentos"
  | "resumo";

const ABAS: { chave: Aba; rotulo: string; tipo: TipoDaFicha }[] = [
  { chave: "compradores", rotulo: "Compradores", tipo: "comprador" },
  { chave: "prospects", rotulo: "Cadastros em andamento", tipo: "prospect" },
  { chave: "imobiliarias", rotulo: "Imobiliárias", tipo: "imobiliaria" },
];

// As MESMAS 7 abas do TabStrip interno (crm-tabs.ts → apoloTabs), mesma ordem e mesmos ícones.
// Lá o id da última é "timeline"; aqui o rótulo "Histórico" já é a chave.
const ABAS_DA_FICHA: { icone: LucideIcon; id: AbaDaFicha; rotulo: string }[] = [
  { icone: LayoutDashboard, id: "resumo", rotulo: "Resumo" },
  { icone: ContactRound, id: "cadastro", rotulo: "Cadastro" },
  { icone: Network, id: "relacionamentos", rotulo: "Relacionamentos" },
  { icone: MapPinned, id: "carteira", rotulo: "Carteira" },
  { icone: CircleDollarSign, id: "financeiro", rotulo: "Financeiro" },
  { icone: Files, id: "documentos", rotulo: "Documentos" },
  { icone: History, id: "historico", rotulo: "Histórico" },
];

// Quais abas cada papel tem: prospect ainda não tem unidade nem parcela (Carteira/Financeiro
// desabilitadas); a ficha de IMOBILIÁRIA segue com Resumo + Carteira — cadastro, documentos e
// histórico de uma PJ terceira são operação interna, não extrato do loteador (decisão declarada,
// pendente de ratificação do Lucas). Mesma ideia do isApoloTabUnavailableForEntity do interno:
// a aba aparece desabilitada, não some — a faixa fica estável.
const ABAS_POR_PAPEL: Record<TipoDaFicha, AbaDaFicha[]> = {
  comprador: [
    "resumo",
    "cadastro",
    "relacionamentos",
    "carteira",
    "financeiro",
    "documentos",
    "historico",
  ],
  imobiliaria: ["resumo", "carteira"],
  prospect: ["resumo", "cadastro", "relacionamentos", "documentos", "historico"],
};

// ── LAYOUT RESPONSIVO ───────────────────────────────────────────────────────
// Em CSS (não inline) pelo mesmo motivo do tema: media query não alcança estilo inline. No PC,
// duas colunas com a lista rolando sozinha (como o grid do CRM interno); no celular vira uma
// tela só — lista OU ficha, com o botão de voltar que o RecordWorkspace interno também tem.
const CSS_CRM = `
  .inc-crm {
    align-items: start;
    display: grid;
    gap: 16px;
    grid-template-columns: minmax(300px, 360px) minmax(0, 1fr);
  }
  .inc-crm-lista { max-height: calc(100dvh - 200px); }
  .inc-crm-voltar { display: none; }
  @media (max-width: 900px) {
    .inc-crm { display: block; }
    .inc-crm-lista { max-height: none; }
    .inc-crm.com-ficha .inc-crm-lista { display: none; }
    .inc-crm:not(.com-ficha) .inc-crm-ficha { display: none; }
    .inc-crm-voltar { display: flex; }
  }
`;

// ── FORMATAÇÃO ──────────────────────────────────────────────────────────────

const brl = (valor: number): string =>
  valor.toLocaleString("pt-BR", { currency: "BRL", maximumFractionDigits: 0, style: "currency" });

const dataCurta = (valor: null | string): null | string => {
  if (!valor) return null;
  const quando = new Date(valor);
  return Number.isNaN(quando.getTime()) ? null : quando.toLocaleDateString("pt-BR");
};

/** Sem acento e sem caixa: buscar "jose" tem que achar "JOSÉ". */
const normalizar = (valor: string): string =>
  valor
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

// ── A TELA ──────────────────────────────────────────────────────────────────

export function TelaCrm() {
  const [aba, setAba] = useState<Aba>("compradores");
  // Cache por aba: trocar de papel e voltar não repete a leitura, que no caso dos compradores
  // são sete consultas no C2X. Regra preservada da tela anterior.
  const [cache, setCache] = useState<Partial<Record<Aba, Dados>>>({});
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<null | string>(null);

  // Busca com Enter, como no EntityColumn interno: o input guarda o texto, e só o Enter (ou o
  // clique na lupa) SUBMETE. `buscaFeita` é o que de fato filtra — apagar o texto sem apertar
  // Enter não destrava a lista, e é por isso que o "Limpar filtros" olha para a busca submetida.
  const [busca, setBusca] = useState("");
  const [buscaFeita, setBuscaFeita] = useState("");

  const [selecao, setSelecao] = useState<null | Selecao>(null);
  const [abaDaFicha, setAbaDaFicha] = useState<AbaDaFicha>("resumo");

  // Cache das fichas já abertas: reabrir a mesma pessoa não paga a rota de novo (a ficha do
  // comprador conta parcelas de até 15 unidades no C2X por chamada).
  const [fichas, setFichas] = useState<Record<string, FichaDoCrm>>({});
  const [fichaCarregando, setFichaCarregando] = useState(false);
  const [fichaErro, setFichaErro] = useState<null | string>(null);

  const carregar = useCallback(async (alvo: Aba) => {
    setCarregando(true);
    setErro(null);

    try {
      const resposta = await fetch(`/api/incorporador/crm?aba=${alvo}`, { cache: "no-store" });
      const corpo = (await resposta.json().catch(() => null)) as
        | { data?: Dados; error?: string }
        | null;

      if (!resposta.ok || !corpo?.data) {
        setErro(corpo?.error ?? "Não foi possível carregar o CRM.");
        return;
      }

      const recebido = corpo.data;
      setCache((atual) => ({ ...atual, [alvo]: recebido }));
    } catch {
      setErro("Não foi possível carregar o CRM.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    if (cache[aba]) {
      // O erro é de UMA aba, não da tela: sem isto, a falha ao carregar Compradores continuaria
      // escrita em cima da lista de Cadastros que já tinha vindo inteira.
      setErro(null);
      return;
    }
    void carregar(aba);
  }, [aba, cache, carregar]);

  // A ficha: busca em /api/incorporador/crm/ficha (NUNCA /api/apolo/*). O servidor reconfere o
  // pertencimento ao escopo a cada chamada — id de fora simplesmente vira 404.
  useEffect(() => {
    if (!selecao) return;

    const chave = `${selecao.tipo}:${selecao.id}`;
    if (fichas[chave]) {
      setFichaErro(null);
      return;
    }

    let ativo = true;
    setFichaCarregando(true);
    setFichaErro(null);

    (async () => {
      try {
        const resposta = await fetch(
          `/api/incorporador/crm/ficha?tipo=${selecao.tipo}&id=${encodeURIComponent(selecao.id)}`,
          { cache: "no-store" },
        );
        const corpo = (await resposta.json().catch(() => null)) as
          | { data?: { ficha?: FichaDoCrm }; error?: string }
          | null;

        if (!ativo) return;

        const ficha = corpo?.data?.ficha;
        if (!resposta.ok || !ficha) {
          setFichaErro(corpo?.error ?? "Não foi possível carregar a ficha.");
          return;
        }

        setFichas((atual) => ({ ...atual, [chave]: ficha }));
      } catch {
        if (ativo) setFichaErro("Não foi possível carregar a ficha.");
      } finally {
        if (ativo) setFichaCarregando(false);
      }
    })();

    return () => {
      ativo = false;
    };
  }, [selecao, fichas]);

  const abrirFicha = useCallback((tipo: TipoDaFicha, id: string) => {
    setSelecao({ id, tipo });
    // Toda ficha abre no Resumo: a pessoa anterior podia estar no Financeiro, e o prospect nem
    // tem essa aba.
    setAbaDaFicha("resumo");
  }, []);

  const dados = cache[aba];
  const termo = normalizar(buscaFeita.trim());
  const temFiltro = termo.length > 0;

  const compradores = useMemo(() => {
    const lista = dados?.compradores ?? [];
    if (!termo) return lista;
    return lista.filter((item) =>
      normalizar(
        `${item.nome} ${item.imobiliaria ?? ""} ${item.unidades.map((u) => u.codigo).join(" ")}`,
      ).includes(termo),
    );
  }, [dados, termo]);

  const prospects = useMemo(() => {
    const lista = dados?.prospects ?? [];
    if (!termo) return lista;
    return lista.filter((item) =>
      normalizar(
        `${item.nome} ${item.imobiliaria ?? ""} ${item.corretor ?? ""} ${item.etapa}`,
      ).includes(termo),
    );
  }, [dados, termo]);

  const imobiliarias = useMemo(() => {
    const lista = dados?.imobiliarias ?? [];
    if (!termo) return lista;
    return lista.filter((item) => normalizar(item.nome).includes(termo));
  }, [dados, termo]);

  const total =
    aba === "compradores"
      ? compradores.length
      : aba === "prospects"
        ? prospects.length
        : imobiliarias.length;

  const chaveDaFicha = selecao ? `${selecao.tipo}:${selecao.id}` : null;
  const ficha = chaveDaFicha ? (fichas[chaveDaFicha] ?? null) : null;

  return (
    <>
      <style>{CSS_CRM}</style>

      <h1 style={{ color: T.text, fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>CRM</h1>
      <p style={{ color: T.muted, fontSize: 13.5, margin: "0 0 18px" }}>
        Quem está comprando, quem está em cadastro e quais imobiliárias atuam no seu empreendimento.
      </p>

      <div className={`inc-crm${selecao ? " com-ficha" : ""}`}>
        <ColunaDeEntidades
          aba={aba}
          busca={busca}
          cache={cache}
          carregando={carregando}
          compradores={compradores}
          erro={erro}
          imobiliarias={imobiliarias}
          onAbrirFicha={abrirFicha}
          onBusca={setBusca}
          onLimparFiltros={() => {
            setBusca("");
            setBuscaFeita("");
          }}
          onSubmeterBusca={() => setBuscaFeita(busca)}
          onTrocarAba={setAba}
          prospects={prospects}
          selecao={selecao}
          temFiltro={temFiltro}
          total={total}
        />

        <FichaDaEntidade
          aba={abaDaFicha}
          carregando={fichaCarregando}
          erro={fichaErro}
          ficha={ficha}
          onTrocarAba={setAbaDaFicha}
          onVoltar={() => setSelecao(null)}
          selecionada={selecao !== null}
        />
      </div>
    </>
  );
}

// ── COLUNA ESQUERDA (porta o EntityColumn do CRM interno) ───────────────────

function ColunaDeEntidades({
  aba,
  busca,
  cache,
  carregando,
  compradores,
  erro,
  imobiliarias,
  onAbrirFicha,
  onBusca,
  onLimparFiltros,
  onSubmeterBusca,
  onTrocarAba,
  prospects,
  selecao,
  temFiltro,
  total,
}: {
  aba: Aba;
  busca: string;
  cache: Partial<Record<Aba, Dados>>;
  carregando: boolean;
  compradores: CompradorDoCrm[];
  erro: null | string;
  imobiliarias: ImobiliariaDoCrm[];
  onAbrirFicha: (tipo: TipoDaFicha, id: string) => void;
  onBusca: (valor: string) => void;
  onLimparFiltros: () => void;
  onSubmeterBusca: () => void;
  onTrocarAba: (aba: Aba) => void;
  prospects: ProspectDoCrm[];
  selecao: null | Selecao;
  temFiltro: boolean;
  total: number;
}) {
  const ocupado = carregando || Boolean(erro);
  const dados = cache[aba];

  return (
    <aside
      className="inc-crm-lista"
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 14,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <div style={{ borderBottom: `1px solid ${T.border}`, flexShrink: 0, padding: "12px 14px" }}>
        {/* Busca só no Enter (ou clicando a lupa) — não filtra a cada tecla. Igual ao interno. */}
        <div
          style={{
            alignItems: "center",
            background: T.soft,
            border: `1px solid ${T.border}`,
            borderRadius: 12,
            display: "flex",
            gap: 8,
            padding: "0 12px",
          }}
        >
          <button
            aria-label="Buscar"
            disabled={ocupado}
            onClick={onSubmeterBusca}
            style={{
              background: "transparent",
              border: "none",
              color: T.muted,
              cursor: ocupado ? "default" : "pointer",
              display: "flex",
              flexShrink: 0,
              padding: 0,
            }}
            type="button"
          >
            <Search aria-hidden="true" size={16} />
          </button>
          <input
            disabled={ocupado}
            onChange={(evento) => onBusca(evento.target.value)}
            onKeyDown={(evento) => {
              if (evento.key === "Enter") {
                evento.preventDefault();
                onSubmeterBusca();
              }
            }}
            placeholder="Buscar e apertar Enter…"
            style={{
              background: "transparent",
              border: "none",
              color: T.text,
              fontFamily: fonte,
              // 16px: abaixo disso o Safari do iOS dá zoom ao focar e a tela pula.
              fontSize: 16,
              minHeight: 40,
              outline: "none",
              width: "100%",
            }}
            type="search"
            value={busca}
          />
        </div>

        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 10,
          }}
        >
          <FiltroDePapel
            cache={cache}
            desabilitado={ocupado}
            onTrocar={onTrocarAba}
            valor={aba}
          />
          {/* Limpa a busca submetida: só apagar o texto do input não destrava a lista, porque a
              busca só re-executa no Enter. Mesmo racional do "Limpar filtros" interno. */}
          {temFiltro ? (
            <button
              onClick={onLimparFiltros}
              style={{
                alignItems: "center",
                background: "transparent",
                border: "none",
                borderRadius: 999,
                color: T.muted,
                cursor: "pointer",
                display: "inline-flex",
                fontFamily: fonte,
                fontSize: 11,
                fontWeight: 600,
                gap: 4,
                marginLeft: "auto",
                padding: "6px 10px",
              }}
              type="button"
            >
              <X aria-hidden="true" size={12} />
              Limpar filtros
            </button>
          ) : null}
        </div>
      </div>

      <div
        style={{
          alignContent: "start",
          display: "grid",
          flex: "1 1 auto",
          gap: 8,
          minHeight: 0,
          overflowY: "auto",
          padding: 12,
        }}
      >
        {erro ? <VazioDaLista texto={erro} tom="erro" /> : null}
        {!erro && carregando && !dados ? <VazioDaLista texto="Carregando…" /> : null}
        {!erro && dados && total === 0 ? (
          <VazioDaLista
            texto={
              temFiltro
                ? "Nenhum resultado para esta busca."
                : aba === "compradores"
                  ? "Nenhuma venda registrada neste empreendimento ainda."
                  : aba === "prospects"
                    ? "Nenhum cadastro em andamento neste empreendimento."
                    : "Nenhuma imobiliária atuando neste empreendimento ainda."
            }
          />
        ) : null}

        {!erro && dados && aba === "compradores"
          ? compradores.map((item) => (
              <ItemDaLista
                key={item.id}
                onAbrir={() => onAbrirFicha("comprador", item.id)}
                selecionado={selecao?.tipo === "comprador" && selecao.id === item.id}
              >
                <MioloComprador comprador={item} />
              </ItemDaLista>
            ))
          : null}
        {!erro && dados && aba === "prospects"
          ? prospects.map((item) => (
              <ItemDaLista
                key={item.id}
                onAbrir={() => onAbrirFicha("prospect", item.id)}
                selecionado={selecao?.tipo === "prospect" && selecao.id === item.id}
              >
                <MioloProspect prospect={item} />
              </ItemDaLista>
            ))
          : null}
        {!erro && dados && aba === "imobiliarias"
          ? imobiliarias.map((item) => (
              <ItemDaLista
                key={item.id}
                onAbrir={() => onAbrirFicha("imobiliaria", item.id)}
                selecionado={selecao?.tipo === "imobiliaria" && selecao.id === item.id}
              >
                <MioloImobiliaria imobiliaria={item} />
              </ItemDaLista>
            ))
          : null}
      </div>
    </aside>
  );
}

/**
 * Porta o ProfileFilterDropdown do CRM interno: popover controlado (não o `<select>` nativo, que
 * abre com fundo branco e quebra no tema escuro), fecha ao clicar fora ou ao selecionar. Aqui as
 * opções são só os três papéis do portal, e a contagem da aba já carregada aparece na opção.
 */
function FiltroDePapel({
  cache,
  desabilitado,
  onTrocar,
  valor,
}: {
  cache: Partial<Record<Aba, Dados>>;
  desabilitado: boolean;
  onTrocar: (aba: Aba) => void;
  valor: Aba;
}) {
  const [aberto, setAberto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!aberto) return;

    function aoClicarFora(evento: MouseEvent) {
      if (ref.current && !ref.current.contains(evento.target as Node)) {
        setAberto(false);
      }
    }

    document.addEventListener("mousedown", aoClicarFora);
    return () => document.removeEventListener("mousedown", aoClicarFora);
  }, [aberto]);

  const rotuloAtual = ABAS.find((item) => item.chave === valor)?.rotulo ?? "Filtro";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        aria-expanded={aberto}
        aria-haspopup="listbox"
        disabled={desabilitado}
        onClick={() => setAberto((atual) => !atual)}
        style={{
          alignItems: "center",
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          color: T.sub,
          cursor: desabilitado ? "default" : "pointer",
          display: "inline-flex",
          fontFamily: fonte,
          fontSize: 12,
          fontWeight: 600,
          gap: 8,
          height: 32,
          opacity: desabilitado ? 0.6 : 1,
          padding: "0 10px",
        }}
        type="button"
      >
        <Filter aria-hidden="true" size={14} style={{ color: T.muted }} />
        {rotuloAtual}
        <ChevronDown
          aria-hidden="true"
          size={14}
          style={{
            color: T.muted,
            transform: aberto ? "rotate(180deg)" : "none",
            transition: "transform .15s",
          }}
        />
      </button>

      {aberto ? (
        <div
          role="listbox"
          style={{
            background: T.card,
            border: `1px solid ${T.border}`,
            borderRadius: 12,
            boxShadow: T.sombra,
            left: 0,
            marginTop: 4,
            minWidth: 200,
            overflow: "hidden",
            padding: 4,
            position: "absolute",
            top: "100%",
            zIndex: 30,
          }}
        >
          {ABAS.map((opcao) => {
            const ativa = opcao.chave === valor;
            // A contagem só aparece depois que a aba carregou: mostrar zero antes da leitura
            // diria "não tem ninguém" para quem tem.
            const quantos = cache[opcao.chave]?.[opcao.chave]?.length;

            return (
              <button
                aria-selected={ativa}
                key={opcao.chave}
                onClick={() => {
                  onTrocar(opcao.chave);
                  setAberto(false);
                }}
                role="option"
                style={{
                  alignItems: "center",
                  background: ativa ? T.soft : "transparent",
                  border: "none",
                  borderRadius: 8,
                  color: ativa ? T.text : T.sub,
                  cursor: "pointer",
                  display: "flex",
                  fontFamily: fonte,
                  fontSize: 12,
                  fontWeight: 600,
                  gap: 12,
                  justifyContent: "space-between",
                  padding: "7px 10px",
                  textAlign: "left",
                  width: "100%",
                }}
                type="button"
              >
                {opcao.rotulo}
                {quantos === undefined ? "" : ` · ${quantos}`}
                {ativa ? <Check aria-hidden="true" size={14} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Porta o EntityListItem: um card clicável, com o estado selecionado marcado pela borda. No
 * interno a seleção é dourada (#A07C3B); aqui é o grafite do tema — dourado não é estado.
 */
function ItemDaLista({
  children,
  onAbrir,
  selecionado,
}: {
  children: React.ReactNode;
  onAbrir: () => void;
  selecionado: boolean;
}) {
  return (
    <article
      style={{
        background: selecionado ? T.soft : T.card,
        border: `1px solid ${selecionado ? T.sub : T.border}`,
        borderRadius: 12,
        transition: "border-color .15s, background .15s",
      }}
    >
      <button
        onClick={onAbrir}
        style={{
          background: "transparent",
          border: "none",
          cursor: "pointer",
          display: "block",
          fontFamily: fonte,
          padding: 12,
          textAlign: "left",
          width: "100%",
        }}
        type="button"
      >
        {children}
      </button>
    </article>
  );
}

// OS MIOLOS DOS CARDS, no padrão do EntityListItem do CRM 360 interno: cidade/UF sob o nome e
// a fileira de chips de papel + situação. ⚠️ SEM O CPF NO CARD: o Lucas viu a lista com
// "documento nome" (como a interna faz) e recuou na hora (18/08/2026): "não gostei do CPF aqui
// no card, deixa ele somente no cadastro mesmo". O documento agora aparece SÓ na aba Cadastro
// da ficha — nem no card, nem no chip do cabeçalho.
function tituloDoCard(_documento: null | string, nome: string): string {
  return nome;
}

function MioloComprador({ comprador }: { comprador: CompradorDoCrm }) {
  return (
    <>
      <div style={nomeDoCard}>{tituloDoCard(comprador.documento, comprador.nome)}</div>
      {comprador.local ? (
        <div style={{ color: T.muted, fontSize: 12, marginTop: 2 }}>{comprador.local}</div>
      ) : null}

      <div style={{ color: T.muted, fontSize: 12.5, marginTop: 6 }}>
        {comprador.unidades.length} unidade{comprador.unidades.length === 1 ? "" : "s"}
        {comprador.total > 0 ? ` · ${brl(comprador.total)} contratado` : ""}
      </div>

      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        <Chip texto="Comprador" tom="neutro" />
        {/* A COR DIZ A ADIMPLÊNCIA, como no CRM interno: chip verde adimplente, vermelho em
            atraso. Sem badge separado — a cor já é o recado. */}
        <Chip
          texto={
            comprador.situacao === "em_atraso"
              ? `Em atraso · ${comprador.parcelasEmAtraso} parcela${comprador.parcelasEmAtraso === 1 ? "" : "s"}`
              : comprador.situacao === "em_dia"
                ? "Em dia"
                : "Sem parcelas"
          }
          tom={
            comprador.situacao === "em_atraso"
              ? "alerta"
              : comprador.situacao === "em_dia"
                ? "bom"
                : "neutro"
          }
        />
      </div>

      {/* O box de imobiliária do EntityListItem interno, no tema do portal. */}
      {comprador.imobiliaria ? (
        <div
          style={{
            background: T.soft,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            marginTop: 10,
            padding: "8px 12px",
          }}
        >
          <div style={{ color: T.muted, fontSize: 11, fontWeight: 500 }}>Imobiliária</div>
          <div style={{ color: T.text, fontSize: 13, fontWeight: 600, marginTop: 2 }}>
            {comprador.imobiliaria}
          </div>
        </div>
      ) : null}
    </>
  );
}

function MioloProspect({ prospect }: { prospect: ProspectDoCrm }) {
  const desde = dataCurta(prospect.desde);

  return (
    <>
      <div style={nomeDoCard}>{tituloDoCard(prospect.documento, prospect.nome)}</div>
      {prospect.local ? (
        <div style={{ color: T.muted, fontSize: 12, marginTop: 2 }}>{prospect.local}</div>
      ) : null}

      <div style={{ color: T.muted, fontSize: 12.5, marginTop: 6 }}>
        {[prospect.imobiliaria, prospect.corretor, desde ? `desde ${desde}` : null]
          .filter(Boolean)
          .join(" · ")}
      </div>

      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        <Chip texto="Cadastro em andamento" tom="neutro" />
        <Chip texto={prospect.etapa} tom={prospect.etapa === "Credenciado" ? "bom" : "neutro"} />
      </div>
    </>
  );
}

function MioloImobiliaria({ imobiliaria }: { imobiliaria: ImobiliariaDoCrm }) {
  return (
    <>
      <div style={nomeDoCard}>{tituloDoCard(imobiliaria.documento, imobiliaria.nome)}</div>

      <div style={{ color: T.muted, fontSize: 12.5, marginTop: 6 }}>
        {imobiliaria.unidades} unidade{imobiliaria.unidades === 1 ? "" : "s"}
        {" · "}
        {imobiliaria.compradores} comprador{imobiliaria.compradores === 1 ? "" : "es"}
        {imobiliaria.vgv > 0 ? ` · ${brl(imobiliaria.vgv)}` : ""}
      </div>

      <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        <Chip texto="Imobiliária" tom="neutro" />
        <Chip
          texto={imobiliaria.credenciada ? "Credenciada" : "Em habilitação"}
          tom={imobiliaria.credenciada ? "bom" : "neutro"}
        />
      </div>
    </>
  );
}

function VazioDaLista({ texto, tom }: { texto: string; tom?: "erro" }) {
  return (
    <div
      style={{
        alignContent: "center",
        background: tom === "erro" ? T.dangerBg : "transparent",
        border: `1px dashed ${tom === "erro" ? T.danger : T.border}`,
        borderRadius: 12,
        color: tom === "erro" ? T.danger : T.muted,
        fontSize: 13,
        fontWeight: 600,
        minHeight: 160,
        padding: 16,
        textAlign: "center",
      }}
    >
      {texto}
    </div>
  );
}

// ── FICHA À DIREITA (porta RecordHeader + TabStrip do record-workspace) ─────

function FichaDaEntidade({
  aba,
  carregando,
  erro,
  ficha,
  onTrocarAba,
  onVoltar,
  selecionada,
}: {
  aba: AbaDaFicha;
  carregando: boolean;
  erro: null | string;
  ficha: FichaDoCrm | null;
  onTrocarAba: (aba: AbaDaFicha) => void;
  onVoltar: () => void;
  selecionada: boolean;
}) {
  return (
    <section
      className="inc-crm-ficha"
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 14,
        display: "flex",
        flexDirection: "column",
        minHeight: 320,
        overflow: "hidden",
      }}
    >
      {/* No celular a ficha ocupa a tela; o voltar é o mesmo gesto do RecordWorkspace interno. */}
      {selecionada ? (
        <button
          className="inc-crm-voltar"
          onClick={onVoltar}
          style={{
            alignItems: "center",
            background: "transparent",
            border: "none",
            borderBottom: `1px solid ${T.border}`,
            color: T.sub,
            cursor: "pointer",
            fontFamily: fonte,
            fontSize: 12,
            fontWeight: 600,
            gap: 6,
            padding: "10px 16px",
            textAlign: "left",
            width: "100%",
          }}
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={14} />
          Voltar para a lista
        </button>
      ) : null}

      {ficha ? <CabecalhoDaFicha ficha={ficha} /> : null}
      {ficha ? <FaixaDeAbas ativa={aba} onTrocar={onTrocarAba} papel={ficha.papel} /> : null}

      <div style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto", padding: 16 }}>
        {!selecionada ? (
          // Estado sem seleção: o convite do RecordWorkspace interno ("Selecione um
          // relacionamento"), no vocabulário do portal.
          <div
            style={{
              alignContent: "center",
              border: `1px dashed ${T.border}`,
              borderRadius: 12,
              color: T.muted,
              display: "grid",
              gap: 6,
              justifyItems: "center",
              minHeight: 280,
              padding: 24,
              textAlign: "center",
            }}
          >
            <ContactRound aria-hidden="true" size={28} style={{ color: T.muted }} />
            <div style={{ color: T.text, fontSize: 15, fontWeight: 600 }}>
              Selecione alguém na lista
            </div>
            <div style={{ fontSize: 13 }}>
              A ficha completa aparece aqui: cadastro, relacionamentos, carteira, financeiro,
              documentos e histórico.
            </div>
          </div>
        ) : null}

        {selecionada && erro ? (
          <div
            style={{
              background: T.dangerBg,
              border: `1px solid ${T.danger}`,
              borderRadius: 12,
              color: T.danger,
              fontSize: 14,
              padding: 30,
              textAlign: "center",
            }}
          >
            {erro}
          </div>
        ) : null}

        {selecionada && !erro && !ficha && carregando ? (
          <div
            style={{
              alignContent: "center",
              border: `1px dashed ${T.border}`,
              borderRadius: 12,
              color: T.muted,
              display: "grid",
              minHeight: 280,
              padding: 24,
              textAlign: "center",
            }}
          >
            Carregando a ficha…
          </div>
        ) : null}

        {ficha ? <PainelDaFicha aba={aba} ficha={ficha} /> : null}
      </div>
    </section>
  );
}

/**
 * Porta o RecordHeader interno: quadrado com o ícone (prédio para PJ, pessoa para PF), nome,
 * e a linha de chips (papel + situação + documento mascarado). Sem os HeaderActions internos
 * ("Abrir atendimento"/"Agenda"): atendimento e agenda são operação da Careli.
 */
function CabecalhoDaFicha({ ficha }: { ficha: FichaDoCrm }) {
  const ehEmpresa = ficha.papel === "imobiliaria";
  const Icone = ehEmpresa ? Building2 : ContactRound;
  const rotuloDoPapel =
    ficha.papel === "comprador"
      ? "Comprador"
      : ficha.papel === "prospect"
        ? "Cadastro em andamento"
        : "Imobiliária";
  const tomDaSituacao: "alerta" | "bom" | "neutro" =
    ficha.situacao === "Em atraso"
      ? "alerta"
      : ficha.situacao === "Em dia" || ficha.situacao === "Credenciada" || ficha.situacao === "Credenciado"
        ? "bom"
        : "neutro";

  return (
    <header
      style={{ borderBottom: `1px solid ${T.border}`, flexShrink: 0, padding: "12px 16px" }}
    >
      <div style={{ alignItems: "center", display: "flex", gap: 12 }}>
        <div
          style={{
            alignItems: "center",
            background: T.soft,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            color: T.sub,
            display: "flex",
            flexShrink: 0,
            height: 36,
            justifyContent: "center",
            width: 36,
          }}
        >
          <Icone aria-hidden="true" size={16} />
        </div>
        <div style={{ minWidth: 0 }}>
          <h2
            style={{
              color: T.text,
              fontSize: 17,
              fontWeight: 600,
              margin: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {ficha.nome}
          </h2>
          <div
            style={{
              alignItems: "center",
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 4,
            }}
          >
            <Chip texto={rotuloDoPapel} tom="neutro" />
            <Chip texto={ficha.situacao} tom={tomDaSituacao} />
            {/* O documento fica SÓ na aba Cadastro (Lucas, 18/08/2026) — nada de CPF no cabeçalho. */}
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * Porta o TabStrip interno: faixa de abas com ícone, a ativa em grafite (`bg-inverse` +
 * `text-brand-ink` lá, T.btnBg + T.btnFg aqui). Aba que o papel não tem fica desabilitada em
 * vez de sumir — a faixa não pula quando a pessoa troca de comprador para prospect.
 */
function FaixaDeAbas({
  ativa,
  onTrocar,
  papel,
}: {
  ativa: AbaDaFicha;
  onTrocar: (aba: AbaDaFicha) => void;
  papel: TipoDaFicha;
}) {
  const disponiveis = ABAS_POR_PAPEL[papel];

  return (
    <nav
      aria-label="Áreas da ficha"
      style={{
        borderBottom: `1px solid ${T.border}`,
        flexShrink: 0,
        overflowX: "auto",
        padding: "8px 12px",
      }}
    >
      <div style={{ display: "flex", gap: 4 }}>
        {ABAS_DA_FICHA.map((item) => {
          const Icone = item.icone;
          const desabilitada = !disponiveis.includes(item.id);
          const ativaAqui = ativa === item.id && !desabilitada;

          return (
            <button
              aria-current={ativaAqui ? "page" : undefined}
              disabled={desabilitada}
              key={item.id}
              onClick={() => onTrocar(item.id)}
              style={{
                alignItems: "center",
                background: ativaAqui ? T.btnBg : "transparent",
                border: "none",
                borderRadius: 10,
                color: ativaAqui ? T.btnFg : T.sub,
                cursor: desabilitada ? "not-allowed" : "pointer",
                display: "inline-flex",
                flexShrink: 0,
                fontFamily: fonte,
                fontSize: 13,
                fontWeight: 600,
                gap: 8,
                height: 36,
                opacity: desabilitada ? 0.45 : 1,
                padding: "0 12px",
              }}
              type="button"
            >
              <Icone aria-hidden="true" size={15} />
              {item.rotulo}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ── PAINÉIS DA FICHA ────────────────────────────────────────────────────────

function PainelDaFicha({ aba, ficha }: { aba: AbaDaFicha; ficha: FichaDoCrm }) {
  if (ficha.papel === "imobiliaria") {
    // Imobiliária segue com Resumo + Carteira (a faixa desabilita o resto — ver ABAS_POR_PAPEL).
    return aba === "carteira" ? (
      <CarteiraImobiliaria ficha={ficha} />
    ) : (
      <ResumoImobiliaria ficha={ficha} />
    );
  }

  // Comprador e prospect dividem as abas novas: o payload das duas fichas carrega cadastro e
  // relacionamentos, e documentos/histórico buscam nas rotas escopadas pela chave da ficha.
  if (aba === "cadastro") return <CadastroDaFicha grupos={ficha.cadastro} />;
  if (aba === "relacionamentos") return <RelacionamentosDaFichaPainel ficha={ficha} />;
  if (aba === "documentos") return <DocumentosDaFicha id={ficha.id} tipo={ficha.papel} />;
  if (aba === "historico") return <HistoricoDaFicha id={ficha.id} tipo={ficha.papel} />;

  if (ficha.papel === "prospect") {
    // Prospect não tem unidade nem parcela: fora das abas acima, sobra o Resumo.
    return <ResumoProspect ficha={ficha} />;
  }

  if (aba === "carteira") return <CarteiraComprador ficha={ficha} />;
  if (aba === "financeiro") return <FinanceiroComprador ficha={ficha} />;
  return <ResumoComprador ficha={ficha} />;
}

// ── RESUMO (desenho do SummaryPanel interno: PanelTitle + grid de InfoTiles) ─

function ResumoComprador({ ficha }: { ficha: FichaComprador }) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Secao eyebrow="Resumo" titulo="Identidade">
        <GradeDeTiles>
          <Tile rotulo="Nome" valor={ficha.nome} />
          <Tile rotulo="Documento" valor={ficha.documento ?? "-"} />
          <Tile rotulo="Papel" valor="Comprador" />
          <Tile rotulo="Situação" valor={ficha.situacao} />
          <Tile rotulo="Imobiliária" valor={ficha.imobiliaria ?? "-"} />
          <Tile rotulo="Unidades" valor={String(ficha.unidades.length)} />
        </GradeDeTiles>
      </Secao>

      {/* O "Cenário financeiro" do SummaryPanel interno, com os totais da ficha. */}
      <Secao eyebrow="Financeiro" titulo="Cenário financeiro">
        <GradeDeTiles>
          <Tile rotulo="Contratado" valor={brl(ficha.totais.total)} />
          <Tile rotulo="Pago" valor={brl(ficha.totais.pago)} />
          <Tile rotulo="A receber" valor={brl(ficha.totais.aReceber)} />
          <Tile
            rotulo="Vencido"
            tom={ficha.totais.vencido > 0 ? "alerta" : undefined}
            valor={brl(ficha.totais.vencido)}
          />
          <Tile
            rotulo="Parcelas vencidas"
            tom={ficha.totais.parcelasVencidas > 0 ? "alerta" : undefined}
            valor={String(ficha.totais.parcelasVencidas)}
          />
          <Tile
            rotulo="Maior atraso"
            tom={ficha.totais.maiorAtrasoDias > 0 ? "alerta" : undefined}
            valor={ficha.totais.maiorAtrasoDias > 0 ? `${ficha.totais.maiorAtrasoDias} dias` : "-"}
          />
        </GradeDeTiles>
      </Secao>

      <Secao eyebrow="Unidades" titulo="O que este comprador tem">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {ficha.unidades.map((unidade) => (
            <span key={unidade.codigo} style={pilula}>
              <b style={{ color: T.text, fontWeight: 600 }}>{unidade.codigo}</b>
              {" · "}
              {unidade.etapa}
              {unidade.valor > 0 ? ` · ${brl(unidade.valor)}` : ""}
            </span>
          ))}
        </div>
      </Secao>
    </div>
  );
}

function ResumoProspect({ ficha }: { ficha: FichaProspect }) {
  const desde = dataCurta(ficha.desde);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Secao eyebrow="Resumo" titulo="Identidade">
        <GradeDeTiles>
          <Tile rotulo="Nome" valor={ficha.nome} />
          <Tile rotulo="Documento" valor={ficha.documento ?? "-"} />
          <Tile rotulo="Papel" valor="Cadastro em andamento" />
          <Tile rotulo="Situação no fluxo de cadastro" valor={ficha.situacao} />
        </GradeDeTiles>
      </Secao>

      <Secao eyebrow="Origem" titulo="Por onde chegou">
        <GradeDeTiles>
          <Tile rotulo="Empreendimento" valor={ficha.empreendimento ?? "-"} />
          <Tile rotulo="Imobiliária" valor={ficha.imobiliaria ?? "-"} />
          <Tile rotulo="Corretor" valor={ficha.corretor ?? "-"} />
          <Tile rotulo="Local" valor={ficha.local ?? "-"} />
          <Tile rotulo="Cadastro desde" valor={desde ?? "-"} />
        </GradeDeTiles>
      </Secao>
    </div>
  );
}

function ResumoImobiliaria({ ficha }: { ficha: FichaImobiliaria }) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Secao eyebrow="Resumo" titulo="Identidade">
        <GradeDeTiles>
          <Tile rotulo="Nome" valor={ficha.nome} />
          <Tile rotulo="Documento" valor={ficha.documento ?? "-"} />
          <Tile rotulo="Papel" valor="Imobiliária" />
          <Tile rotulo="Situação" valor={ficha.situacao} />
        </GradeDeTiles>
      </Secao>

      <Secao eyebrow="Desempenho" titulo="Números no seu empreendimento">
        <GradeDeTiles>
          <Tile rotulo="Unidades vendidas" valor={String(ficha.totais.unidades)} />
          <Tile rotulo="VGV" valor={brl(ficha.totais.vgv)} />
          <Tile rotulo="Compradores" valor={String(ficha.compradores)} />
          <Tile rotulo="Cadastros em andamento" valor={String(ficha.cads)} />
          <Tile
            rotulo="Ranking por VGV"
            valor={`${ficha.ranking.posicao}º de ${ficha.ranking.total}`}
          />
        </GradeDeTiles>
      </Secao>
    </div>
  );
}

// ── CARTEIRA (desenho do ScopedPortfolioPanel: KPIs em cima, cards embaixo) ─

function CarteiraComprador({ ficha }: { ficha: FichaComprador }) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* O header de KPIs do ScopedPortfolioPanel, com os totais da ficha. */}
      <div style={cartaoDeSecao}>
        <GradeDeTiles>
          <Tile rotulo="Carteira" valor={brl(ficha.totais.total)} />
          <Tile rotulo="Pago" valor={brl(ficha.totais.pago)} />
          <Tile rotulo="A receber" valor={brl(ficha.totais.aReceber)} />
          <Tile
            rotulo="Vencido"
            tom={ficha.totais.vencido > 0 ? "alerta" : undefined}
            valor={brl(ficha.totais.vencido)}
          />
        </GradeDeTiles>
      </div>

      <RotuloDeGrupo icone={MapPinned} texto="Unidades" total={ficha.unidades.length} />

      {ficha.unidades.length === 0 ? (
        <div style={{ ...cartaoDeSecao, color: T.muted, fontSize: 13, fontWeight: 500 }}>
          Nenhuma unidade nesta ficha.
        </div>
      ) : (
        <div style={gradeDeCards}>
          {ficha.unidades.map((unidade) => (
            <CardDeUnidade key={unidade.codigo} unidade={unidade} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * O card de grupo do ScopedPortfolioPanel, adaptado à unidade da ficha: ícone num quadrado,
 * título, chip de adimplência quando há cobrança, e o par Carteira/Vencido embaixo.
 */
function CardDeUnidade({ unidade }: { unidade: UnidadeDaFicha }) {
  const fin = unidade.financeiro;
  const inadimplente = fin ? fin.vencido > 0 || fin.parcelasVencidas > 0 : false;
  const posicao = [
    unidade.quadra ? `Q${unidade.quadra}` : null,
    unidade.lote ? `L${unidade.lote}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article style={{ ...cartaoDeSecao, padding: 14 }}>
      <div
        style={{
          alignItems: "flex-start",
          display: "flex",
          gap: 10,
          justifyContent: "space-between",
        }}
      >
        <div style={{ alignItems: "center", display: "flex", gap: 8, minWidth: 0 }}>
          <span
            style={{
              alignItems: "center",
              background: T.soft,
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              color: T.sub,
              display: "flex",
              flexShrink: 0,
              height: 32,
              justifyContent: "center",
              width: 32,
            }}
          >
            <MapPinned aria-hidden="true" size={15} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: T.text, fontSize: 13.5, fontWeight: 600 }}>
              {unidade.codigo}
              {posicao ? (
                <span style={{ color: T.muted, fontWeight: 500 }}> · {posicao}</span>
              ) : null}
            </div>
            {unidade.empreendimento ? (
              <div style={{ color: T.muted, fontSize: 12 }}>{unidade.empreendimento}</div>
            ) : null}
          </div>
        </div>
        {fin ? (
          <Chip
            texto={inadimplente ? "Inadimplente" : "Adimplente"}
            tom={inadimplente ? "alerta" : "bom"}
          />
        ) : null}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        <span style={pilula}>{unidade.etapa}</span>
        {unidade.valor > 0 ? <span style={pilula}>{brl(unidade.valor)}</span> : null}
      </div>

      {fin ? (
        <div
          style={{
            display: "grid",
            gap: 8,
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            marginTop: 12,
          }}
        >
          <Tile rotulo="Pago" valor={brl(fin.pago)} />
          <Tile
            rotulo="Vencido"
            tom={fin.vencido > 0 ? "alerta" : undefined}
            valor={brl(fin.vencido)}
          />
        </div>
      ) : (
        <div style={{ color: T.muted, fontSize: 12, marginTop: 12 }}>
          Ainda sem cobrança: a venda desta unidade não faturou.
        </div>
      )}
    </article>
  );
}

function CarteiraImobiliaria({ ficha }: { ficha: FichaImobiliaria }) {
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={cartaoDeSecao}>
        <GradeDeTiles>
          <Tile rotulo="Unidades vendidas" valor={String(ficha.totais.unidades)} />
          <Tile rotulo="VGV" valor={brl(ficha.totais.vgv)} />
          <Tile rotulo="Compradores" valor={String(ficha.compradores)} />
          <Tile
            rotulo="Ranking por VGV"
            valor={`${ficha.ranking.posicao}º de ${ficha.ranking.total}`}
          />
        </GradeDeTiles>
      </div>

      <RotuloDeGrupo icone={Store} texto="Unidades vendidas" total={ficha.unidadesVendidas.length} />

      {ficha.unidadesVendidas.length === 0 ? (
        <div style={{ ...cartaoDeSecao, color: T.muted, fontSize: 13, fontWeight: 500 }}>
          Nenhuma venda ativa desta imobiliária no recorte atual.
        </div>
      ) : (
        <div style={gradeDeCards}>
          {ficha.unidadesVendidas.map((unidade) => (
            <CardDeVenda key={unidade.codigo} unidade={unidade} />
          ))}
        </div>
      )}
    </div>
  );
}

function CardDeVenda({ unidade }: { unidade: UnidadeDoCrm }) {
  const posicao = [
    unidade.quadra ? `Q${unidade.quadra}` : null,
    unidade.lote ? `L${unidade.lote}` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article style={{ ...cartaoDeSecao, padding: 14 }}>
      <div style={{ alignItems: "center", display: "flex", gap: 8, minWidth: 0 }}>
        <span
          style={{
            alignItems: "center",
            background: T.soft,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            color: T.sub,
            display: "flex",
            flexShrink: 0,
            height: 32,
            justifyContent: "center",
            width: 32,
          }}
        >
          <Building2 aria-hidden="true" size={15} />
        </span>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: T.text, fontSize: 13.5, fontWeight: 600 }}>
            {unidade.codigo}
            {posicao ? <span style={{ color: T.muted, fontWeight: 500 }}> · {posicao}</span> : null}
          </div>
          {unidade.empreendimento ? (
            <div style={{ color: T.muted, fontSize: 12 }}>{unidade.empreendimento}</div>
          ) : null}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        <span style={pilula}>{unidade.estagio}</span>
        {unidade.vgv > 0 ? <span style={pilula}>{brl(unidade.vgv)}</span> : null}
      </div>
    </article>
  );
}

// ── FINANCEIRO (parcelas agregadas da ficha, por unidade) ───────────────────

function FinanceiroComprador({ ficha }: { ficha: FichaComprador }) {
  const comCobranca = ficha.unidades.filter((unidade) => unidade.financeiro !== null);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Secao eyebrow="Financeiro" titulo="Totais do comprador">
        <GradeDeTiles>
          <Tile rotulo="Contratado" valor={brl(ficha.totais.total)} />
          <Tile rotulo="Pago" valor={brl(ficha.totais.pago)} />
          <Tile rotulo="A receber" valor={brl(ficha.totais.aReceber)} />
          <Tile
            rotulo="Vencido"
            tom={ficha.totais.vencido > 0 ? "alerta" : undefined}
            valor={brl(ficha.totais.vencido)}
          />
          <Tile
            rotulo="Parcelas vencidas"
            tom={ficha.totais.parcelasVencidas > 0 ? "alerta" : undefined}
            valor={String(ficha.totais.parcelasVencidas)}
          />
          <Tile
            rotulo="Maior atraso"
            tom={ficha.totais.maiorAtrasoDias > 0 ? "alerta" : undefined}
            valor={ficha.totais.maiorAtrasoDias > 0 ? `${ficha.totais.maiorAtrasoDias} dias` : "-"}
          />
        </GradeDeTiles>
      </Secao>

      <Secao eyebrow="Por unidade" titulo="Parcelas de cada unidade">
        {comCobranca.length === 0 ? (
          <div style={{ color: T.muted, fontSize: 13 }}>
            Nenhuma unidade com cobrança ainda: as vendas deste comprador não faturaram.
          </div>
        ) : (
          // A tabela rola dentro do próprio container: a ficha nunca estoura a largura da tela.
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                borderCollapse: "collapse",
                fontFamily: fonte,
                fontSize: 13,
                minWidth: 560,
                width: "100%",
              }}
            >
              <thead>
                <tr>
                  <CelulaCabecalho texto="Unidade" />
                  <CelulaCabecalho texto="Contratado" numero />
                  <CelulaCabecalho texto="Pago" numero />
                  <CelulaCabecalho texto="Vencido" numero />
                  <CelulaCabecalho texto="Em dia" numero />
                  <CelulaCabecalho texto="Vencidas" numero />
                </tr>
              </thead>
              <tbody>
                {comCobranca.map((unidade) => {
                  const fin = unidade.financeiro;
                  if (!fin) return null;

                  return (
                    <tr key={unidade.codigo} style={{ borderTop: `1px solid ${T.border}` }}>
                      <td style={{ ...celula, color: T.text, fontWeight: 600 }}>
                        {unidade.codigo}
                      </td>
                      <td style={{ ...celula, textAlign: "right" }}>{brl(fin.total)}</td>
                      <td style={{ ...celula, textAlign: "right" }}>{brl(fin.pago)}</td>
                      <td
                        style={{
                          ...celula,
                          color: fin.vencido > 0 ? T.danger : T.sub,
                          fontWeight: fin.vencido > 0 ? 600 : 400,
                          textAlign: "right",
                        }}
                      >
                        {brl(fin.vencido)}
                      </td>
                      {/* `parcelasEmDia: null` = a leitura das parcelas falhou nessa unidade.
                          Mostra travessão de tabela, nunca 0 — zero afirmaria que está tudo
                          vencido (regra da ficha no servidor, preservada aqui). */}
                      <td style={{ ...celula, textAlign: "right" }}>
                        {fin.parcelasEmDia === null ? "–" : fin.parcelasEmDia}
                      </td>
                      <td
                        style={{
                          ...celula,
                          color: fin.parcelasVencidas > 0 ? T.danger : T.sub,
                          fontWeight: fin.parcelasVencidas > 0 ? 600 : 400,
                          textAlign: "right",
                        }}
                      >
                        {fin.parcelasVencidas}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Secao>
    </div>
  );
}

// ── CADASTRO (porta o RegistrationPanel interno: mesmos grupos, sem o Editar)

function CadastroDaFicha({ grupos }: { grupos: GrupoDoCadastro[] }) {
  if (grupos.length === 0) {
    return (
      <VazioDePainel texto="O cadastro completo desta ficha ainda não está disponível." />
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {grupos.map((grupo) => (
        <Secao eyebrow={grupo.eyebrow} key={grupo.titulo} titulo={grupo.titulo}>
          <GradeDeTiles>
            {grupo.campos.map((campo) => (
              <Tile key={campo.rotulo} rotulo={campo.rotulo} valor={campo.valor} />
            ))}
          </GradeDeTiles>
        </Secao>
      ))}
    </div>
  );
}

// ── RELACIONAMENTOS (porta o RelationshipsPanel interno, só leitura) ────────

function RelacionamentosDaFichaPainel({
  ficha,
}: {
  ficha: FichaComprador | FichaProspect;
}) {
  const rede: RelacionamentosDaFicha = ficha.relacionamentos;
  const vinculos = [
    rede.conjuge ? { nome: rede.conjuge.nome, papel: "Cônjuge" } : null,
    rede.imobiliaria ? { nome: rede.imobiliaria, papel: "Imobiliária" } : null,
    rede.corretor ? { nome: rede.corretor, papel: "Corretor" } : null,
  ].filter((vinculo): vinculo is { nome: string; papel: string } => vinculo !== null);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Sem o "+ Adicionar" nem o excluir do painel interno: vínculo é operação da Careli. Os
          cards também não trazem telefone/e-mail — contato de terceiro não sai no portal. */}
      <Secao eyebrow="Rede" titulo="Relacionamentos">
        {vinculos.length === 0 ? (
          <div style={{ color: T.muted, fontSize: 13 }}>
            Nenhum relacionamento registrado para esta ficha.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {vinculos.map((vinculo) => (
              <div
                key={`${vinculo.papel}:${vinculo.nome}`}
                style={{
                  alignItems: "center",
                  background: T.soft,
                  border: `1px solid ${T.border}`,
                  borderRadius: 10,
                  display: "flex",
                  gap: 10,
                  justifyContent: "space-between",
                  padding: "10px 12px",
                }}
              >
                <span style={{ color: T.text, fontSize: 13.5, fontWeight: 600, minWidth: 0 }}>
                  {vinculo.nome}
                </span>
                <Chip texto={vinculo.papel} tom="neutro" />
              </div>
            ))}
          </div>
        )}
      </Secao>

      <Secao eyebrow="Contratos" titulo="Contratos no seu empreendimento">
        {rede.contratos.length === 0 ? (
          <div style={{ color: T.muted, fontSize: 13 }}>
            {ficha.papel === "prospect"
              ? "O cadastro ainda não virou contrato."
              : "Nenhum contrato no recorte atual."}
          </div>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {rede.contratos.map((contrato) => (
              <span key={contrato.codigo} style={pilula}>
                <b style={{ color: T.text, fontWeight: 600 }}>{contrato.codigo}</b>
                {" · "}
                {contrato.etapa}
                {contrato.empreendimento ? ` · ${contrato.empreendimento}` : ""}
              </span>
            ))}
          </div>
        )}
      </Secao>
    </div>
  );
}

// ── DOCUMENTOS (porta o DocumentsPanel interno: 3 fontes, sem upload/excluir)

const ROTULO_DA_FONTE: Record<DocumentoDoPortal["fonte"], string> = {
  apolo: "Cadastro",
  c2x: "Guardado no C2X",
  contrato: "Contrato",
};

function DocumentosDaFicha({ id, tipo }: { id: string; tipo: TipoDaFicha }) {
  const [documentos, setDocumentos] = useState<DocumentoDoPortal[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro(null);
    setDocumentos(null);

    (async () => {
      try {
        const resposta = await fetch(
          `/api/incorporador/crm/documentos?tipo=${tipo}&id=${encodeURIComponent(id)}`,
          { cache: "no-store" },
        );
        const corpo = (await resposta.json().catch(() => null)) as
          | { data?: { documentos?: DocumentoDoPortal[] }; error?: string }
          | null;

        if (!ativo) return;

        if (!resposta.ok || !corpo?.data?.documentos) {
          setErro(corpo?.error ?? "Não foi possível carregar os documentos.");
          return;
        }

        setDocumentos(corpo.data.documentos);
      } catch {
        if (ativo) setErro("Não foi possível carregar os documentos.");
      } finally {
        if (ativo) setCarregando(false);
      }
    })();

    return () => {
      ativo = false;
    };
  }, [id, tipo]);

  if (erro) return <VazioDePainel texto={erro} tom="erro" />;
  if (carregando || documentos === null) {
    return <VazioDePainel texto="Carregando os documentos…" />;
  }
  if (documentos.length === 0) {
    return <VazioDePainel texto="Nenhum documento registrado para esta ficha ainda." />;
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Secao eyebrow="Documentos" titulo="Documentos da ficha">
        <div style={{ display: "grid", gap: 8 }}>
          {documentos.map((documento) => (
            <LinhaDeDocumento documento={documento} fichaId={id} key={documento.id} tipo={tipo} />
          ))}
        </div>
      </Secao>
    </div>
  );
}

function LinhaDeDocumento({
  documento,
  fichaId,
  tipo,
}: {
  documento: DocumentoDoPortal;
  fichaId: string;
  tipo: TipoDaFicha;
}) {
  const quando = dataCurta(documento.criadoEm);
  const meta = [documento.tipo, quando].filter(Boolean).join(" · ");

  const abrir = () => {
    // Navegação simples: a rota responde o próprio arquivo (redirect assinado ou PDF proxiado).
    // A sessão vai no cookie — nada de token na URL.
    const url = `/api/incorporador/crm/documentos/abrir?tipo=${tipo}&id=${encodeURIComponent(fichaId)}&fonte=${documento.fonte}&doc=${encodeURIComponent(documento.id)}`;
    window.open(url, "_blank", "noopener");
  };

  return (
    <div
      style={{
        alignItems: "center",
        background: T.soft,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        display: "flex",
        gap: 10,
        padding: "10px 12px",
      }}
    >
      <span
        style={{
          alignItems: "center",
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          color: T.sub,
          display: "flex",
          flexShrink: 0,
          height: 32,
          justifyContent: "center",
          width: 32,
        }}
      >
        <FileText aria-hidden="true" size={15} />
      </span>

      <div style={{ flex: "1 1 auto", minWidth: 0 }}>
        <div
          style={{
            color: T.text,
            fontSize: 13.5,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {documento.nome}
        </div>
        {meta ? <div style={{ color: T.muted, fontSize: 12, marginTop: 2 }}>{meta}</div> : null}
      </div>

      <Chip texto={ROTULO_DA_FONTE[documento.fonte]} tom="neutro" />

      {/* Anexo preso no S3 do C2X: botão desabilitado com a explicação no tooltip (title no
          span porque botão desabilitado não dispara tooltip em todo navegador). NUNCA inventar
          URL para ele. Registro do Apolo sem arquivo ganha a explicação própria — dizer "está
          no C2X" para ele seria mentira. */}
      <span
        title={
          documento.abrivel
            ? "Abrir documento"
            : documento.fonte === "c2x"
              ? "Este arquivo está guardado no arquivo interno do C2X. Fale com a Careli para disponibilizá-lo."
              : "Este registro ainda não tem arquivo disponível."
        }
      >
        <button
          aria-label={documento.abrivel ? `Abrir ${documento.nome}` : `${documento.nome} indisponível`}
          disabled={!documento.abrivel}
          onClick={abrir}
          style={{
            alignItems: "center",
            background: T.card,
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            color: T.sub,
            cursor: documento.abrivel ? "pointer" : "not-allowed",
            display: "inline-flex",
            fontFamily: fonte,
            fontSize: 12,
            fontWeight: 600,
            gap: 6,
            height: 32,
            opacity: documento.abrivel ? 1 : 0.45,
            padding: "0 10px",
          }}
          type="button"
        >
          Abrir
        </button>
      </span>
    </div>
  );
}

// ── HISTÓRICO (porta o EntityTimelinePanel: chips de fonte + período, sem o Registrar) ─

const CATEGORIAS_DO_HISTORICO: {
  chave: CategoriaDoHistorico;
  icone: LucideIcon;
  rotulo: string;
}[] = [
  { chave: "venda", icone: Home, rotulo: "Vendas" },
  { chave: "pagamento", icone: CircleDollarSign, rotulo: "Pagamentos" },
  { chave: "reuniao", icone: Video, rotulo: "Reuniões" },
];

const TZ = "America/Sao_Paulo";

/** Dia (YYYY-MM-DD) no fuso de Brasília — en-CA formata como YYYY-MM-DD (igual à interna). */
function diaIso(valor: string): string {
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? "" : data.toLocaleDateString("en-CA", { timeZone: TZ });
}

function horaCurta(valor: string): string {
  const data = new Date(valor);
  return Number.isNaN(data.getTime())
    ? ""
    : data.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

function rotuloDoDia(dia: string): string {
  const hoje = diaIso(new Date().toISOString());
  const ontem = diaIso(new Date(Date.now() - 86400000).toISOString());
  if (dia === hoje) return "Hoje";
  if (dia === ontem) return "Ontem";
  const data = new Date(`${dia}T12:00:00`);
  return data.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

function HistoricoDaFicha({ id, tipo }: { id: string; tipo: TipoDaFicha }) {
  const [eventos, setEventos] = useState<EventoDoHistorico[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);
  const [categoria, setCategoria] = useState<"todas" | CategoriaDoHistorico>("todas");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro(null);
    setEventos(null);

    (async () => {
      try {
        const resposta = await fetch(
          `/api/incorporador/crm/historico?tipo=${tipo}&id=${encodeURIComponent(id)}`,
          { cache: "no-store" },
        );
        const corpo = (await resposta.json().catch(() => null)) as
          | { data?: { eventos?: EventoDoHistorico[] }; error?: string }
          | null;

        if (!ativo) return;

        if (!resposta.ok || !corpo?.data?.eventos) {
          setErro(corpo?.error ?? "Não foi possível carregar o histórico.");
          return;
        }

        setEventos(corpo.data.eventos);
      } catch {
        if (ativo) setErro("Não foi possível carregar o histórico.");
      } finally {
        if (ativo) setCarregando(false);
      }
    })();

    return () => {
      ativo = false;
    };
  }, [id, tipo]);

  const filtrados = useMemo(() => {
    return (eventos ?? []).filter((evento) => {
      if (categoria !== "todas" && evento.categoria !== categoria) return false;
      const dia = diaIso(evento.data);
      if (de && dia < de) return false;
      if (ate && dia > ate) return false;
      return true;
    });
  }, [eventos, categoria, de, ate]);

  // Agrupa por dia preservando a ordem (mais recente primeiro), como a interna.
  const grupos = useMemo(() => {
    const mapa = new Map<string, EventoDoHistorico[]>();
    for (const evento of filtrados) {
      const dia = diaIso(evento.data);
      const lista = mapa.get(dia);
      if (lista) lista.push(evento);
      else mapa.set(dia, [evento]);
    }
    return [...mapa.entries()];
  }, [filtrados]);

  if (erro) return <VazioDePainel texto={erro} tom="erro" />;
  if (carregando || eventos === null) {
    return <VazioDePainel texto="Montando o histórico…" />;
  }

  const contagem = (chave: CategoriaDoHistorico) =>
    eventos.filter((evento) => evento.categoria === chave).length;

  const chipDeFiltro = (
    ativa: boolean,
    rotulo: string,
    total: number,
    aoClicar: () => void,
    Icone?: LucideIcon,
  ) => (
    <button
      key={rotulo}
      onClick={aoClicar}
      style={{
        alignItems: "center",
        background: ativa ? T.btnBg : T.card,
        border: `1px solid ${ativa ? T.btnBg : T.border}`,
        borderRadius: 10,
        color: ativa ? T.btnFg : T.sub,
        cursor: "pointer",
        display: "inline-flex",
        fontFamily: fonte,
        fontSize: 12,
        fontWeight: 600,
        gap: 6,
        height: 32,
        padding: "0 10px",
      }}
      type="button"
    >
      {Icone ? <Icone aria-hidden="true" size={13} /> : null}
      {rotulo}
      <span
        style={{
          background: ativa ? "rgb(255 255 255 / .18)" : T.soft,
          borderRadius: 999,
          fontSize: 11,
          padding: "1px 7px",
        }}
      >
        {total}
      </span>
    </button>
  );

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {chipDeFiltro(categoria === "todas", "Tudo", eventos.length, () =>
            setCategoria("todas"),
          )}
          {CATEGORIAS_DO_HISTORICO.map((item) =>
            chipDeFiltro(
              categoria === item.chave,
              item.rotulo,
              contagem(item.chave),
              () => setCategoria(item.chave),
              item.icone,
            ),
          )}
        </div>

        <div style={{ alignItems: "center", display: "flex", gap: 6 }}>
          <input
            aria-label="De"
            max={ate || undefined}
            onChange={(evento) => setDe(evento.target.value)}
            style={campoDeData}
            type="date"
            value={de}
          />
          <span style={{ color: T.muted, fontSize: 12 }}>até</span>
          <input
            aria-label="Até"
            min={de || undefined}
            onChange={(evento) => setAte(evento.target.value)}
            style={campoDeData}
            type="date"
            value={ate}
          />
        </div>
      </div>

      {filtrados.length === 0 ? (
        <VazioDePainel texto="Nenhum registro no período." />
      ) : (
        <div style={{ ...cartaoDeSecao, padding: "4px 16px" }}>
          {grupos.map(([dia, itens]) => (
            <div key={dia}>
              <div
                style={{
                  color: T.muted,
                  fontSize: 10.5,
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  padding: "10px 0 4px",
                  textTransform: "uppercase",
                }}
              >
                {rotuloDoDia(dia)}
              </div>
              <ol style={{ borderLeft: `1px solid ${T.border}`, listStyle: "none", margin: 0, padding: 0 }}>
                {itens.map((evento) => (
                  <LinhaDoHistorico evento={evento} key={evento.id} />
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LinhaDoHistorico({ evento }: { evento: EventoDoHistorico }) {
  const meta = CATEGORIAS_DO_HISTORICO.find((item) => item.chave === evento.categoria);
  const Icone = meta?.icone ?? History;

  return (
    <li
      style={{
        alignItems: "flex-start",
        display: "flex",
        gap: 10,
        padding: "10px 0 10px 16px",
        position: "relative",
      }}
    >
      <span
        style={{
          alignItems: "center",
          background: T.soft,
          border: `1px solid ${T.border}`,
          borderRadius: 999,
          color: T.sub,
          display: "flex",
          flexShrink: 0,
          height: 28,
          justifyContent: "center",
          left: -14,
          position: "absolute",
          top: 10,
          width: 28,
        }}
      >
        <Icone aria-hidden="true" size={13} />
      </span>
      <div style={{ flex: "1 1 auto", minWidth: 0, paddingLeft: 18 }}>
        <div style={{ alignItems: "baseline", display: "flex", gap: 10, justifyContent: "space-between" }}>
          <span
            style={{
              color: T.text,
              fontSize: 13.5,
              fontWeight: 600,
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {evento.titulo}
            {evento.valor != null && evento.valor > 0 ? (
              <span style={{ color: T.sub, fontWeight: 500 }}> · {brl(evento.valor)}</span>
            ) : null}
          </span>
          {/* Pagamento do C2X só tem a DATA: mostrar hora seria artefato de fuso (regra da
              interna, preservada). */}
          {evento.dataSemHora ? null : (
            <span style={{ color: T.muted, flexShrink: 0, fontSize: 12 }}>
              {horaCurta(evento.data)}
            </span>
          )}
        </div>
        {evento.descricao ? (
          <div
            style={{
              color: T.muted,
              fontSize: 12,
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {evento.descricao}
          </div>
        ) : null}
      </div>
    </li>
  );
}

const campoDeData = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  color: T.text,
  fontFamily: fonte,
  fontSize: 12.5,
  height: 32,
  outline: "none",
  padding: "0 8px",
} as const;

/** O vazio/erro dos painéis que buscam dados próprios (documentos, histórico). */
function VazioDePainel({ texto, tom }: { texto: string; tom?: "erro" }) {
  return (
    <div
      style={{
        alignContent: "center",
        background: tom === "erro" ? T.dangerBg : "transparent",
        border: `1px dashed ${tom === "erro" ? T.danger : T.border}`,
        borderRadius: 12,
        color: tom === "erro" ? T.danger : T.muted,
        fontSize: 13,
        fontWeight: 600,
        minHeight: 160,
        padding: 16,
        textAlign: "center",
      }}
    >
      {texto}
    </div>
  );
}

// ── PEÇAS COMPARTILHADAS (portas de apolo-ui: PanelTitle, InfoTile, Pill) ───

const nomeDoCard = {
  color: T.text,
  fontSize: 14.5,
  fontWeight: 600,
} as const;

const pilula = {
  background: T.soft,
  borderRadius: 999,
  color: T.muted,
  display: "inline-block",
  fontSize: 12,
  padding: "5px 10px",
} as const;

const cartaoDeSecao = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  padding: 16,
} as const;

const gradeDeCards = {
  display: "grid",
  gap: 10,
  gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
} as const;

const celula = {
  color: T.sub,
  padding: "10px 12px",
  whiteSpace: "nowrap",
} as const;

function CelulaCabecalho({ numero, texto }: { numero?: boolean; texto: string }) {
  return (
    <th
      style={{
        color: T.muted,
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: "0.04em",
        padding: "6px 12px",
        textAlign: numero ? "right" : "left",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {texto}
    </th>
  );
}

/** O PanelTitle interno: olho pequeno em caixa alta + título, dentro de um cartão de seção. */
function Secao({
  children,
  eyebrow,
  titulo,
}: {
  children: React.ReactNode;
  eyebrow: string;
  titulo: string;
}) {
  return (
    <section style={cartaoDeSecao}>
      <div
        style={{
          color: T.muted,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        {eyebrow}
      </div>
      <div style={{ color: T.text, fontSize: 15, fontWeight: 600, marginTop: 2 }}>{titulo}</div>
      <div style={{ marginTop: 14 }}>{children}</div>
    </section>
  );
}

/** O InfoTile interno: rótulo pequeno em caixa alta + valor em destaque. */
function Tile({ rotulo, tom, valor }: { rotulo: string; tom?: "alerta"; valor: string }) {
  return (
    <div>
      <div
        style={{
          color: T.muted,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {rotulo}
      </div>
      <div
        style={{
          color: tom === "alerta" ? T.danger : T.text,
          fontSize: 15,
          fontWeight: 600,
          marginTop: 2,
          overflowWrap: "anywhere",
        }}
      >
        {valor}
      </div>
    </div>
  );
}

function GradeDeTiles({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gap: 12,
        gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
      }}
    >
      {children}
    </div>
  );
}

/** A linha de rótulo de grupo do ScopedPortfolioPanel: ícone + plural + contagem numa bolinha. */
function RotuloDeGrupo({
  icone: Icone,
  texto,
  total,
}: {
  icone: LucideIcon;
  texto: string;
  total: number;
}) {
  return (
    <div
      style={{
        alignItems: "center",
        color: T.muted,
        display: "flex",
        fontSize: 11,
        fontWeight: 600,
        gap: 8,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
      }}
    >
      <Icone aria-hidden="true" size={15} style={{ color: T.sub }} />
      {texto}
      <span
        style={{
          background: T.soft,
          borderRadius: 999,
          color: T.muted,
          fontSize: 11,
          padding: "2px 8px",
        }}
      >
        {total}
      </span>
    </div>
  );
}

function Chip({ texto, tom }: { texto: string; tom: "alerta" | "bom" | "neutro" }) {
  // O par verde/vermelho de adimplência do CRM interno. O verde virou token do tema (`T.ok`)
  // para as outras telas do portal usarem o MESMO verde sem duplicar o hex.
  const cor = tom === "alerta" ? T.danger : tom === "bom" ? T.ok : T.muted;

  return (
    <span
      style={{
        background: tom === "alerta" ? T.dangerBg : tom === "bom" ? T.okBg : T.soft,
        borderRadius: 999,
        color: cor,
        flexShrink: 0,
        fontSize: 11.5,
        fontWeight: 600,
        padding: "4px 9px",
      }}
    >
      {texto}
    </span>
  );
}
