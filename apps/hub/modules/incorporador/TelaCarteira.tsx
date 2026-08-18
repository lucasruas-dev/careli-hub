"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpDown, ExternalLink, FileText, Search, WalletCards, X } from "lucide-react";

import { fonte } from "@/modules/publico/ui/tokens";
import type {
  ExtratoParcela,
  IndicadoresDaCarteira,
  MesDaSerie,
  TotalLiquido,
} from "@/lib/apolo/incorporador/carteira-liquida";

import { T } from "./tema";

// A CARTEIRA DO INCORPORADOR — a CarteiraTab do Apolo interno, portada para o portal, com o
// LÍQUIDO que é dele ao lado do bruto que a Careli administra.
//
// Pedido do Lucas (17/08/2026): portar as telas REAIS do Apolo, mesma estrutura, copiando o
// código, não fazendo releitura; *"o que temos que ter adicional é trazer os valores líquidos"*.
// O desenho vem de modules/apolo/blocks/empreendimentos/empreendimentos-view.tsx:
//
//   • CarteiraTab (2432)          — os 8 CarteiraCard + a tabela por unidade;
//   • CarteiraHead (3295)         — o cabeçalho ordenável;
//   • filterCarteiraUnits (3334) e sortCarteiraUnits (3368) — funções puras, portadas sem
//     mudança de lógica (só o tipo: comprador/imobiliária chegam como nome, não como objeto);
//   • UnitFinancialStatus (3837)  — o selo Em dia / N vencida(s);
//   • UnitCarteiraModal (2977)    — o modal de parcelas, apontando para /api/incorporador/parcelas
//     (a rota escopada com `unidadeNoEscopo`; a interna aceita unitId cru e NÃO atravessa aqui).
//
// A tela tem DUAS abas:
//   • CARTEIRA     — a réplica da aba interna + a coluna nova "Valor líquido" por unidade;
//   • INDICADORES  — os KPIs do BI de Gestão de Carteira (?indicadores=1): receita líquida,
//     transferida, inadimplente e %, série mensal previsto × transferido, extrato com filtros.
//
// O QUE FICOU DE FORA, declarado (decisão do plano):
//   • coluna/selo "Cobrança" e o CobrancaFunnel/CobrancaModal — promessa, acordo e negociação são
//     operação interna do Hades; entra só se o Lucas aprovar expor o funil ao cliente.
//
// O QUE ENTROU DEPOIS, por ordem do Lucas (18/08/2026): *"temos que trazer o contrato e nas
// parcelas dentro de carteira o link do boleto do asaas"* — os dois itens que estavam de fora de
// propósito até essa data:
//   • coluna "Contrato" (ícone como o da interna, empreendimentos-view ~2716) — abre
//     /api/incorporador/contrato?unitId=… em aba nova; a rota é ESCOPADA (unidadeNoEscopo) e
//     resolve o uuid no C2X, nunca aceita uuid do navegador; sem contrato assinado, a célula é "-";
//   • link "Boleto" por parcela no modal — a rota de parcelas passou a mandar `boletoUrl` (a
//     fatura Asaas; ver lib/apolo/incorporador/parcelas-portal.ts); parcela paga mantém o link,
//     esmaecido, porque a fatura vira o comprovante.
//
// ⚠️ O RECORTE NÃO VEM DA TELA. O seletor de empreendimento manda um id que a própria rota já
// devolveu; quem decide o que ele pode ver é o cookie assinado, do outro lado.

// ── TIPOS DO PAYLOAD (allowlist da rota /api/incorporador/carteira) ──────────

type Resumo = {
  clients: number;
  contracts: number;
  criticalContracts: number;
  /** Fração 0–1 (mesma matemática do Hades). A tela multiplica por 100 UMA vez, aqui. */
  delinquencyRate: number;
  overdueAmount: number;
  overdueClients: number;
  overdueInstallments: number;
  paidAmount: number;
  recoveryAmount: number;
  toReceiveAmount: number;
  totalPortfolio: number;
};

type Liquido = {
  motivos: string[];
  /** `true` = a leitura bateu no teto e a soma NÃO é completa. A tela avisa. */
  parcial: boolean;
  porSplit: number;
  recebido: number;
  recebidoBruto: number;
  semLiquido: number;
  total: number;
};

type LiquidoDaUnidade = {
  bruto: number;
  liquido: number;
  parcelasPagas: number;
  semLiquido: number;
};

type UnidadeDaTela = {
  block: null | string;
  client: null | string;
  code: string;
  contractCode: null | string;
  empreendimento: null | string;
  faturadoAt: null | string;
  id: string;
  imobiliaria: null | string;
  liquido: LiquidoDaUnidade | null;
  lot: null | string;
  maxOverdueDays: number;
  overdueAmount: number;
  overdueInstallments: number;
  paidAmount: number;
  /** `true` = contrato assinado no D4Sign. Só o sinal: o uuid não chega à tela; o PDF vem da rota escopada. */
  temContrato: boolean;
  toReceiveAmount: number;
  totalContract: number;
};

type EmpreendimentoDaTela = { id: string; nome: string };

type Dados = {
  bruto: null | Resumo;
  empreendimentos?: EmpreendimentoDaTela[];
  filtro?: null | string;
  indicadores?: IndicadoresDaCarteira | null;
  liquido: null | Liquido;
  semCarteira?: boolean;
  unidades?: number;
  units?: UnidadeDaTela[];
};

/** Uma parcela do modal — allowlist de /api/incorporador/parcelas (ParcelaDoPortal). */
type ParcelaDaUnidade = {
  amount: number;
  /** Fatura/boleto Asaas (ordem do Lucas, 18/08/2026). Paga, o mesmo link vira o comprovante. */
  boletoUrl: null | string;
  competence: null | string;
  dueDate: null | string;
  id: string;
  number: string;
  overdueDays: number;
  paidAmount: number;
  paidAt: null | string;
  status: "a_vencer" | "liquidada" | "vencida";
  type: null | string;
};

// ── FORMATAÇÃO ──────────────────────────────────────────────────────────────

const brl = (valor: number): string =>
  valor.toLocaleString("pt-BR", { currency: "BRL", maximumFractionDigits: 0, style: "currency" });

const inteiro = (valor: number): string => valor.toLocaleString("pt-BR");

const pct = (valor: number): string =>
  `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/** ISO/`YYYY-MM-DD` vira dd/mm/aaaa no fuso de São Paulo; vazio vira traço. */
function dia(valor: null | string): string {
  if (!valor) return "-";
  // 'YYYY-MM-DD' cru é montado na mão: passar por Date deslocaria o dia conforme o fuso.
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    const [ano, mes, diaN] = valor.split("-");
    return `${diaN}/${mes}/${ano}`;
  }
  const data = new Date(valor);
  return Number.isNaN(data.getTime())
    ? "-"
    : data.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/** Competência (ISO) vira mm/aaaa, em UTC como a interna (formatMonth). */
function mesDeCompetencia(valor: null | string): string {
  if (!valor) return "-";
  const data = new Date(valor);
  return Number.isNaN(data.getTime())
    ? "-"
    : data.toLocaleDateString("pt-BR", { month: "2-digit", timeZone: "UTC", year: "numeric" });
}

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-08" vira "ago/26". */
function rotuloDoMes(mes: string): string {
  const [ano, numero] = mes.split("-");
  const indice = Number(numero) - 1;
  return `${MESES_CURTOS[indice] ?? numero}/${(ano ?? "").slice(2)}`;
}

const SITUACAO_LABELS: Record<ExtratoParcela["situacao"], string> = {
  a_vencer: "A vencer",
  paga: "Paga",
  vencida: "Vencida",
};

// ── FILTRO E ORDENAÇÃO DA TABELA (portados de filterCarteiraUnits/sortCarteiraUnits) ─────────
// Mudanças em relação à interna, declaradas: sem a coluna "cobranca" (não portada) e com a coluna
// nova "liquido"; comprador/imobiliária são strings (a rota do portal manda só o nome).

type FiltroDaCarteira = "em_dia" | "inadimplente" | "todos";
type ColunaDaCarteira = "codigo" | "faturado" | "liquido" | "situacao" | "vencido" | "vgv";
type OrdemDaCarteira = { coluna: ColunaDaCarteira; direcao: "asc" | "desc" };

function filtrarUnidades(
  units: UnidadeDaTela[],
  busca: string,
  status: FiltroDaCarteira,
): UnidadeDaTela[] {
  const alvo = busca.trim().toLowerCase();

  return units.filter((unit) => {
    if (status === "inadimplente" && unit.overdueInstallments === 0) return false;
    if (status === "em_dia" && unit.overdueInstallments > 0) return false;
    if (!alvo) return true;

    return [unit.code, unit.block, unit.lot, unit.client, unit.imobiliaria]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(alvo);
  });
}

function ordenarUnidades(units: UnidadeDaTela[], ordem: OrdemDaCarteira): UnidadeDaTela[] {
  const fator = ordem.direcao === "asc" ? 1 : -1;

  return [...units].sort((a, b) => {
    if (ordem.coluna === "vgv") return (a.totalContract - b.totalContract) * fator;
    if (ordem.coluna === "vencido") return (a.overdueAmount - b.overdueAmount) * fator;
    if (ordem.coluna === "situacao") {
      return (a.overdueInstallments - b.overdueInstallments) * fator;
    }
    if (ordem.coluna === "liquido") {
      // Unidade sem líquido apurado fica no fim do "maior primeiro": -1 perde de qualquer soma.
      return ((a.liquido?.liquido ?? -1) - (b.liquido?.liquido ?? -1)) * fator;
    }
    if (ordem.coluna === "faturado") {
      return (
        (new Date(a.faturadoAt ?? 0).getTime() - new Date(b.faturadoAt ?? 0).getTime()) * fator
      );
    }
    return a.code.localeCompare(b.code, "pt-BR", { numeric: true }) * fator;
  });
}

// ── A TELA ──────────────────────────────────────────────────────────────────

export function TelaCarteira() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [carregando, setCarregando] = useState(true);
  const [empSelecionado, setEmpSelecionado] = useState<null | string>(null);
  const [aba, setAba] = useState<"carteira" | "indicadores">("carteira");
  const [consultadoEm, setConsultadoEm] = useState<Date | null>(null);

  // A aba Indicadores tem estado próprio: a leitura ampliada (?indicadores=1) custa mais no C2X e
  // só roda quando o cliente ABRE a aba. `indicadoresDe` guarda de qual recorte o dado é, para o
  // seletor de empreendimento invalidar o cache.
  const [indicadores, setIndicadores] = useState<IndicadoresDaCarteira | null>(null);
  const [indicadoresDe, setIndicadoresDe] = useState<null | string>(null);
  const [indicadoresErro, setIndicadoresErro] = useState<null | string>(null);
  const [indicadoresCarregando, setIndicadoresCarregando] = useState(false);

  const carregar = useCallback(async (emp: null | string) => {
    setCarregando(true);
    setErro(null);
    try {
      const endereco = emp
        ? `/api/incorporador/carteira?code=${encodeURIComponent(emp)}`
        : "/api/incorporador/carteira";
      const r = await fetch(endereco, { cache: "no-store" });
      const corpo = (await r.json().catch(() => null)) as { data?: Dados; error?: string } | null;
      if (!r.ok || !corpo?.data) {
        setErro(corpo?.error ?? "Não foi possível carregar a carteira.");
        return;
      }
      setDados(corpo.data);
      setConsultadoEm(new Date());
    } catch {
      setErro("Não foi possível carregar a carteira.");
    } finally {
      setCarregando(false);
    }
  }, []);

  const carregarIndicadores = useCallback(async (emp: null | string) => {
    setIndicadoresCarregando(true);
    setIndicadoresErro(null);
    try {
      const endereco = emp
        ? `/api/incorporador/carteira?indicadores=1&code=${encodeURIComponent(emp)}`
        : "/api/incorporador/carteira?indicadores=1";
      const r = await fetch(endereco, { cache: "no-store" });
      const corpo = (await r.json().catch(() => null)) as { data?: Dados; error?: string } | null;
      if (!r.ok || !corpo?.data) {
        setIndicadoresErro(corpo?.error ?? "Não foi possível carregar os indicadores.");
        return;
      }
      setIndicadores(corpo.data.indicadores ?? null);
      setIndicadoresDe(emp ?? "");
      setConsultadoEm(new Date());
    } catch {
      setIndicadoresErro("Não foi possível carregar os indicadores.");
    } finally {
      setIndicadoresCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar(empSelecionado);
  }, [carregar, empSelecionado]);

  // Abre a aba Indicadores (ou troca o empreendimento com ela aberta) → busca o dado dela.
  useEffect(() => {
    if (aba !== "indicadores") return;
    if (indicadoresDe === (empSelecionado ?? "") && indicadores) return;
    void carregarIndicadores(empSelecionado);
  }, [aba, carregarIndicadores, empSelecionado, indicadores, indicadoresDe]);

  if (carregando && !dados) return <Aviso texto="Carregando a carteira…" />;
  if (erro) return <Aviso texto={erro} tom="erro" />;

  if (!dados || dados.semCarteira || !dados.bruto) {
    return <Aviso texto="Nenhum empreendimento com carteira administrada pela Careli." />;
  }

  const empreendimentos = dados.empreendimentos ?? [];

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ── CABEÇALHO: o que está sendo olhado, por onde trocar, e as abas ──── */}
      <header>
        <h1 style={{ color: T.text, fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>
          Carteira
        </h1>
        <p style={{ color: T.muted, fontSize: 13.5, margin: 0 }}>
          {inteiro(dados.bruto.contracts)} contratos, {brl(dados.bruto.totalPortfolio)} de
          carteira administrada pela Careli.
          {consultadoEm ? (
            // O "carimbo" do BI: aqui o dado é vivo, então a hora é a da consulta.
            <span>
              {" "}
              Consultado às{" "}
              {consultadoEm.toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
                timeZone: "America/Sao_Paulo",
              })}
              .
            </span>
          ) : null}
        </p>

        {empreendimentos.length > 1 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
            <Pilula
              ativo={empSelecionado === null}
              onClick={() => setEmpSelecionado(null)}
              rotulo="Todos"
            />
            {empreendimentos.map((emp) => (
              <Pilula
                ativo={empSelecionado === emp.id}
                key={emp.id}
                onClick={() => setEmpSelecionado(emp.id)}
                rotulo={emp.nome}
              />
            ))}
          </div>
        ) : null}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          <Pilula
            ativo={aba === "carteira"}
            onClick={() => setAba("carteira")}
            rotulo="Carteira"
          />
          <Pilula
            ativo={aba === "indicadores"}
            onClick={() => setAba("indicadores")}
            rotulo="Indicadores"
          />
        </div>
      </header>

      {aba === "carteira" ? (
        <AbaCarteira bruto={dados.bruto} liquido={dados.liquido} units={dados.units ?? []} />
      ) : (
        <AbaIndicadores
          carregando={indicadoresCarregando}
          erro={indicadoresErro}
          indicadores={indicadores}
        />
      )}
    </div>
  );
}

// ── ABA CARTEIRA (a réplica da CarteiraTab interna) ─────────────────────────

function AbaCarteira({
  bruto,
  liquido,
  units,
}: {
  bruto: Resumo;
  liquido: Liquido | null;
  units: UnidadeDaTela[];
}) {
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<FiltroDaCarteira>("todos");
  const [ordem, setOrdem] = useState<OrdemDaCarteira>({ coluna: "vencido", direcao: "desc" });
  const [unidadeAberta, setUnidadeAberta] = useState<UnidadeDaTela | null>(null);

  const visiveis = useMemo(
    () => ordenarUnidades(filtrarUnidades(units, busca, filtro), ordem),
    [busca, filtro, ordem, units],
  );

  const parteRecebida = bruto.totalPortfolio
    ? (bruto.paidAmount / bruto.totalPortfolio) * 100
    : 0;

  return (
    <>
      {/* ── O QUE É DELE: o líquido, antes de tudo ──────────────────────────── */}
      <section style={cartao}>
        <h2 style={titulo}>O que já entrou para você</h2>
        <p style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.5, margin: "6px 0 16px" }}>
          Da parcela que o comprador paga, uma parte é comissão, gestão e coordenação. O valor
          abaixo é a sua, já descontado o rateio de cada parcela.
        </p>

        {liquido === null ? (
          // ⚠️ Não mostrar R$ 0,00 aqui. Zero, para quem recebeu, é acusação de erro nosso.
          <p style={{ color: T.muted, fontSize: 13, margin: 0 }}>
            Não foi possível calcular o valor líquido agora. O time da Careli já consegue ver isso
            por aqui.
          </p>
        ) : (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 28 }}>
              <Numero destaque rotulo="Seu líquido recebido" valor={brl(liquido.recebido)} />
              <Numero rotulo="Bruto pago pelos compradores" valor={brl(liquido.recebidoBruto)} />
              <Numero rotulo="Parcelas pagas" valor={inteiro(liquido.total)} />
            </div>

            {liquido.semLiquido > 0 ? (
              <p style={{ color: T.muted, fontSize: 12, lineHeight: 1.5, margin: "14px 0 0" }}>
                {liquido.semLiquido} de {liquido.total} parcelas ainda não entraram nesta conta
                {liquido.motivos.length > 0 ? `: ${liquido.motivos.join("; ")}` : "."}
              </p>
            ) : null}
            {liquido.parcial ? (
              <p style={{ color: T.danger, fontSize: 12, lineHeight: 1.5, margin: "8px 0 0" }}>
                A carteira deste recorte é muito grande e a leitura foi limitada: os valores de
                líquido podem estar incompletos.
              </p>
            ) : null}
          </>
        )}
      </section>

      {/* ── O CENÁRIO DA CARTEIRA: os 8 cartões da CarteiraTab interna ─────────
          Mesmos rótulos e mesmas dicas; o tom colorido do interno virou o par neutro/alerta do
          portal (cor não é estado, exceto o vermelho de atraso). */}
      <section
        style={{
          display: "grid",
          gap: 8,
          gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
        }}
      >
        <CartaoDaCarteira
          dica={`${inteiro(bruto.contracts)} contrato(s)`}
          rotulo="Carteira total"
          valor={brl(bruto.totalPortfolio)}
        />
        <CartaoDaCarteira
          dica={`${pct(parteRecebida)} da carteira`}
          rotulo="Recebido"
          valor={brl(bruto.paidAmount)}
        />
        <CartaoDaCarteira
          dica="parcelas em dia"
          rotulo="A receber"
          valor={brl(bruto.toReceiveAmount)}
        />
        <CartaoDaCarteira
          dica={`${inteiro(bruto.overdueInstallments)} parcela(s) · ${inteiro(bruto.overdueClients)} cliente(s)`}
          rotulo="Vencido"
          tom={bruto.overdueAmount > 0 ? "alerta" : undefined}
          valor={brl(bruto.overdueAmount)}
        />
        <CartaoDaCarteira
          dica={`${inteiro(bruto.criticalContracts)} contrato(s) crítico(s)`}
          rotulo="Inadimplência"
          tom={bruto.delinquencyRate > 0 ? "alerta" : undefined}
          // ⚠️ ×100 UMA VEZ, AQUI. `delinquencyRate` chega como fração 0–1 (carteira.ts:246); a
          // tela antiga esquecia a multiplicação e mostrava "0,1%" onde era 12% — era o passo 0
          // do plano. A interna faz o mesmo ×100 (empreendimentos-view.tsx:2640).
          valor={pct(bruto.delinquencyRate * 100)}
        />
        <CartaoDaCarteira
          dica="pago no mês"
          rotulo="Recuperação"
          valor={brl(bruto.recoveryAmount)}
        />
        <CartaoDaCarteira
          dica="com contrato ativo"
          rotulo="Clientes"
          valor={inteiro(bruto.clients)}
        />
        <CartaoDaCarteira
          dica="com parcela vencida"
          rotulo="Inadimplentes"
          tom={bruto.overdueClients > 0 ? "alerta" : undefined}
          valor={inteiro(bruto.overdueClients)}
        />
      </section>

      {/* ── A CARTEIRA POR UNIDADE (a tabela da CarteiraTab) ──────────────────
          Colunas da interna SEM Cobrança (declarado no topo), MAIS a coluna nova "Valor líquido"
          (o pedido literal do Lucas) e a coluna Contrato, liberada em 18/08/2026 (ver o
          cabeçalho do arquivo). */}
      <section style={{ ...cartao, overflow: "hidden", padding: 0 }}>
        <div
          style={{
            alignItems: "center",
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            justifyContent: "space-between",
            padding: "12px 16px",
          }}
        >
          <h2 style={titulo}>
            Carteira por unidade{" "}
            <span style={{ color: T.muted, fontSize: 12, fontWeight: 500 }}>
              ({inteiro(visiveis.length)})
            </span>
          </h2>
          <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
            <label
              style={{
                alignItems: "center",
                background: T.soft,
                border: `1px solid ${T.border}`,
                borderRadius: 10,
                display: "flex",
                gap: 8,
                minWidth: 220,
                padding: "0 12px",
              }}
            >
              <Search aria-hidden="true" size={15} style={{ color: T.muted, flexShrink: 0 }} />
              <input
                onChange={(evento) => setBusca(evento.target.value)}
                placeholder="Unidade, comprador, imobiliária"
                style={{
                  background: "transparent",
                  border: "none",
                  color: T.text,
                  flex: 1,
                  fontFamily: fonte,
                  fontSize: 13.5,
                  minWidth: 0,
                  outline: "none",
                  padding: "8px 0",
                }}
                value={busca}
              />
            </label>
            <select
              onChange={(evento) => setFiltro(evento.target.value as FiltroDaCarteira)}
              style={seletor}
              value={filtro}
            >
              <option value="todos">Todas</option>
              <option value="inadimplente">Inadimplentes</option>
              <option value="em_dia">Em dia</option>
            </select>
          </div>
        </div>

        <div style={{ maxHeight: "58vh", overflow: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 1120, width: "100%" }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 5 }}>
              <tr style={{ background: T.soft }}>
                <CabecalhoOrdenavel coluna="codigo" ordem={ordem} onOrdenar={setOrdem} rotulo="Unidade" />
                <th style={cabecalho}>Comprador / Imobiliária</th>
                <CabecalhoOrdenavel coluna="faturado" ordem={ordem} onOrdenar={setOrdem} rotulo="Faturado" />
                <CabecalhoOrdenavel alinhar="right" coluna="vgv" ordem={ordem} onOrdenar={setOrdem} rotulo="VGV" />
                <th style={{ ...cabecalho, textAlign: "right" }}>Pago</th>
                <th style={{ ...cabecalho, textAlign: "right" }}>A receber</th>
                <CabecalhoOrdenavel alinhar="right" coluna="vencido" ordem={ordem} onOrdenar={setOrdem} rotulo="Vencido" />
                <CabecalhoOrdenavel alinhar="right" coluna="liquido" ordem={ordem} onOrdenar={setOrdem} rotulo="Valor líquido" />
                <CabecalhoOrdenavel coluna="situacao" ordem={ordem} onOrdenar={setOrdem} rotulo="Situação" />
                {/* A coluna do pedido do Lucas (18/08/2026): o contrato assinado, como na interna. */}
                <th style={{ ...cabecalho, textAlign: "center" }}>Contrato</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((unit) => (
                <tr
                  key={unit.id}
                  onClick={() => setUnidadeAberta(unit)}
                  style={{ cursor: "pointer" }}
                  title="Ver as parcelas desta unidade"
                >
                  <td style={{ ...celula, paddingLeft: 16 }}>
                    <p style={{ color: T.text, fontSize: 13, fontWeight: 600, margin: 0 }}>
                      {unit.code}
                    </p>
                    <p style={{ color: T.muted, fontSize: 11.5, margin: 0 }}>
                      {[unit.block, unit.lot].filter(Boolean).join(" / ")}
                      {unit.empreendimento ? ` · ${unit.empreendimento}` : ""}
                    </p>
                  </td>
                  <td style={celula}>
                    {unit.client ? (
                      <p
                        style={{
                          color: T.text,
                          fontSize: 12,
                          fontWeight: 600,
                          margin: 0,
                          maxWidth: 240,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {unit.client}
                      </p>
                    ) : (
                      <span style={{ color: T.muted, fontSize: 12 }}>-</span>
                    )}
                    {unit.imobiliaria ? (
                      <p
                        style={{
                          color: T.muted,
                          fontSize: 12,
                          margin: 0,
                          maxWidth: 240,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {unit.imobiliaria}
                      </p>
                    ) : null}
                  </td>
                  <td style={{ ...celula, whiteSpace: "nowrap" }}>{dia(unit.faturadoAt)}</td>
                  <td style={{ ...celula, color: T.text, fontWeight: 500, textAlign: "right", whiteSpace: "nowrap" }}>
                    {brl(unit.totalContract)}
                  </td>
                  <td style={{ ...celula, textAlign: "right", whiteSpace: "nowrap" }}>
                    {brl(unit.paidAmount)}
                  </td>
                  <td style={{ ...celula, textAlign: "right", whiteSpace: "nowrap" }}>
                    {brl(unit.toReceiveAmount)}
                  </td>
                  <td
                    style={{
                      ...celula,
                      color: unit.overdueAmount ? T.danger : T.sub,
                      fontWeight: unit.overdueAmount ? 600 : 400,
                      textAlign: "right",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {unit.overdueAmount ? brl(unit.overdueAmount) : "-"}
                  </td>
                  <td style={{ ...celula, textAlign: "right", whiteSpace: "nowrap" }}>
                    {unit.liquido ? (
                      <>
                        <span style={{ color: T.text, fontWeight: 600 }}>
                          {brl(unit.liquido.liquido)}
                        </span>
                        {unit.liquido.semLiquido > 0 ? (
                          // A regra do "nunca R$ 0,00 calado" vale por unidade também: se parte
                          // das parcelas não entrou na conta, a linha diz quantas faltam.
                          <p style={{ color: T.muted, fontSize: 10.5, margin: 0 }}>
                            faltam {unit.liquido.semLiquido} parcela(s)
                          </p>
                        ) : null}
                      </>
                    ) : (
                      <span style={{ color: T.muted }} title="Líquido ainda não apurado">
                        -
                      </span>
                    )}
                  </td>
                  <td style={{ ...celula, whiteSpace: "nowrap" }}>
                    <SituacaoDaUnidade unit={unit} />
                  </td>
                  <td style={{ ...celula, textAlign: "center" }}>
                    <BotaoDeContrato unit={unit} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visiveis.length === 0 ? (
          <p style={{ color: T.muted, fontSize: 13, margin: 0, padding: 24, textAlign: "center" }}>
            Nenhuma unidade nesse filtro.
          </p>
        ) : null}
      </section>

      {unidadeAberta ? (
        <ModalDeParcelas onFechar={() => setUnidadeAberta(null)} unit={unidadeAberta} />
      ) : null}
    </>
  );
}

// ── ABA INDICADORES (o BI de Gestão de Carteira) ────────────────────────────

function AbaIndicadores({
  carregando,
  erro,
  indicadores,
}: {
  carregando: boolean;
  erro: null | string;
  indicadores: IndicadoresDaCarteira | null;
}) {
  if (carregando && !indicadores) return <Aviso texto="Calculando os indicadores…" />;
  if (erro) return <Aviso texto={erro} tom="erro" />;
  if (!indicadores) {
    return <Aviso texto="Não foi possível calcular os indicadores agora." tom="erro" />;
  }

  const { contadores, kpis } = indicadores;

  return (
    <>
      {/* Os KPIs da página "Gestão de Carteira" do BI. Os percentuais chegam JÁ em 0–100. */}
      <section style={cartao}>
        <h2 style={titulo}>Receita líquida da carteira</h2>
        <p style={{ color: T.muted, fontSize: 12.5, margin: "6px 0 16px" }}>
          Os valores desta aba são o SEU líquido, parcela a parcela, já descontado o rateio.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 28 }}>
          <Numero destaque rotulo="Receita líquida total" valor={brl(kpis.receitaLiquida.liquido)} />
          <Numero rotulo="Transferida (paga)" valor={brl(kpis.transferida.liquido)} />
          <Numero
            rotulo="Inadimplente"
            tom={kpis.inadimplente.liquido > 0 ? "alerta" : undefined}
            valor={brl(kpis.inadimplente.liquido)}
          />
          <Numero
            rotulo="% Inadimplência"
            tom={kpis.inadimplenciaPct > 0 ? "alerta" : undefined}
            valor={pct(kpis.inadimplenciaPct)}
          />
          <Numero rotulo="Parcelas" valor={inteiro(contadores.parcelas)} />
          <Numero rotulo="Clientes" valor={inteiro(contadores.clientes)} />
          <Numero rotulo="Unidades" valor={inteiro(contadores.unidades)} />
        </div>

        <AvisoDeCalculo motivos={indicadores.motivos} totais={[kpis.receitaLiquida]} />
      </section>

      {/* O gráfico do BI: previsto × transferido por mês, com a % de inadimplência por mês. */}
      <section style={cartao}>
        <h2 style={titulo}>Previsto × transferido, mês a mês</h2>
        <p style={{ color: T.muted, fontSize: 12.5, margin: "6px 0 16px" }}>
          Pelo vencimento (previsto) e pela data de pagamento (transferido), nos últimos doze
          meses. O percentual é a inadimplência do mês.
        </p>
        <GraficoDaCarteira meses={indicadores.serieMensal} />
      </section>

      {/* O extrato analítico do BI, com os filtros da página. */}
      <ExtratoAnalitico extrato={indicadores.extrato} extratoTotal={indicadores.extratoTotal} />
    </>
  );
}

/** O aviso de "não somei tudo": parcelas sem líquido calculável nunca somem caladas. */
function AvisoDeCalculo({ motivos, totais }: { motivos: string[]; totais: TotalLiquido[] }) {
  const semLiquido = totais.reduce((soma, total) => soma + total.semLiquido, 0);
  if (semLiquido === 0) return null;

  return (
    <p style={{ color: T.muted, fontSize: 12, lineHeight: 1.5, margin: "14px 0 0" }}>
      {inteiro(semLiquido)} parcela(s) ficaram fora da conta do líquido
      {motivos.length > 0 ? `: ${motivos.join("; ")}` : "."}
    </p>
  );
}

function GraficoDaCarteira({ meses }: { meses: MesDaSerie[] }) {
  const topo = Math.max(...meses.flatMap((mes) => [mes.previsto, mes.transferido]), 1);

  return (
    <div>
      <div style={{ display: "flex", gap: 6, height: 150 }}>
        {meses.map((mes) => (
          <div
            key={mes.mes}
            style={{
              display: "flex",
              flex: 1,
              flexDirection: "column",
              justifyContent: "flex-end",
              minWidth: 0,
            }}
            title={`${rotuloDoMes(mes.mes)}: previsto ${brl(mes.previsto)}, transferido ${brl(mes.transferido)}, inadimplência ${pct(mes.inadimplenciaPct)}`}
          >
            <div
              style={{
                color: mes.inadimplenciaPct > 0 ? T.danger : "transparent",
                fontSize: 10,
                fontWeight: 600,
                marginBottom: 4,
                textAlign: "center",
                whiteSpace: "nowrap",
              }}
            >
              {pct(mes.inadimplenciaPct)}
            </div>
            <div
              style={{
                alignItems: "flex-end",
                display: "flex",
                gap: 2,
                height: 96,
                justifyContent: "center",
              }}
            >
              {/* Previsto em meio-tom, transferido em tom cheio — série monocromática. */}
              <div
                style={{
                  background: T.text,
                  borderRadius: "3px 3px 0 0",
                  flex: 1,
                  height: `${Math.max((mes.previsto / topo) * 96, 2)}px`,
                  maxWidth: 16,
                  opacity: mes.previsto > 0 ? 0.35 : 0.12,
                }}
              />
              <div
                style={{
                  background: T.text,
                  borderRadius: "3px 3px 0 0",
                  flex: 1,
                  height: `${Math.max((mes.transferido / topo) * 96, 2)}px`,
                  maxWidth: 16,
                  opacity: mes.transferido > 0 ? 0.95 : 0.12,
                }}
              />
            </div>
            <div
              style={{
                color: T.muted,
                fontSize: 10.5,
                marginTop: 6,
                overflow: "hidden",
                textAlign: "center",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {rotuloDoMes(mes.mes)}
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 10 }}>
        <Legenda opacidade={0.35} rotulo="Previsto (por vencimento)" />
        <Legenda opacidade={0.95} rotulo="Transferido (por pagamento)" />
      </div>
    </div>
  );
}

function Legenda({ opacidade, rotulo }: { opacidade: number; rotulo: string }) {
  return (
    <span style={{ alignItems: "center", color: T.sub, display: "inline-flex", fontSize: 11.5, gap: 6 }}>
      <span
        aria-hidden="true"
        style={{
          background: T.text,
          borderRadius: 3,
          display: "inline-block",
          height: 10,
          opacity: opacidade,
          width: 10,
        }}
      />
      {rotulo}
    </span>
  );
}

const PAGINA_DO_EXTRATO = 60;

/** O extrato do BI, com os filtros da página: ano, mês, perfil, status e busca por unidade. */
function ExtratoAnalitico({
  extrato,
  extratoTotal,
}: {
  extrato: ExtratoParcela[];
  extratoTotal: number;
}) {
  const [ano, setAno] = useState("");
  const [mes, setMes] = useState("");
  const [perfil, setPerfil] = useState("");
  const [situacao, setSituacao] = useState("");
  const [busca, setBusca] = useState("");
  const [visiveis, setVisiveis] = useState(PAGINA_DO_EXTRATO);

  const anos = useMemo(
    () =>
      [...new Set(extrato.map((p) => (p.vencimento ?? "").slice(0, 4)).filter(Boolean))].sort(
        (a, b) => b.localeCompare(a),
      ),
    [extrato],
  );
  const perfis = useMemo(
    () => [...new Set(extrato.map((p) => p.perfil).filter(Boolean))].sort(),
    [extrato],
  );

  const filtradas = useMemo(() => {
    const alvo = busca.trim().toLowerCase();

    return extrato.filter((parcela) => {
      const vencimento = parcela.vencimento ?? "";
      if (ano && vencimento.slice(0, 4) !== ano) return false;
      if (mes && vencimento.slice(5, 7) !== mes) return false;
      if (perfil && parcela.perfil !== perfil) return false;
      if (situacao && parcela.situacao !== situacao) return false;
      if (!alvo) return true;

      return [parcela.unidade, parcela.cliente, parcela.imobiliaria]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(alvo);
    });
  }, [ano, busca, extrato, mes, perfil, situacao]);

  // A linha de Total do BI, sobre o RECORTE filtrado (é o que a página do Power BI faz).
  const totais = useMemo(
    () =>
      filtradas.reduce(
        (soma, parcela) => ({
          liquido: soma.liquido + (parcela.liquido ?? 0),
          valor: soma.valor + parcela.valor,
        }),
        { liquido: 0, valor: 0 },
      ),
    [filtradas],
  );

  return (
    <section style={{ ...cartao, overflow: "hidden", padding: 0 }}>
      <div
        style={{
          alignItems: "center",
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          justifyContent: "space-between",
          padding: "12px 16px",
        }}
      >
        <h2 style={titulo}>
          Extrato da carteira{" "}
          <span style={{ color: T.muted, fontSize: 12, fontWeight: 500 }}>
            ({inteiro(filtradas.length)})
          </span>
        </h2>
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}>
          <label
            style={{
              alignItems: "center",
              background: T.soft,
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              display: "flex",
              gap: 8,
              minWidth: 180,
              padding: "0 12px",
            }}
          >
            <Search aria-hidden="true" size={15} style={{ color: T.muted, flexShrink: 0 }} />
            <input
              onChange={(evento) => {
                setBusca(evento.target.value);
                setVisiveis(PAGINA_DO_EXTRATO);
              }}
              placeholder="Unidade ou cliente"
              style={{
                background: "transparent",
                border: "none",
                color: T.text,
                flex: 1,
                fontFamily: fonte,
                fontSize: 13,
                minWidth: 0,
                outline: "none",
                padding: "8px 0",
              }}
              value={busca}
            />
          </label>
          <select onChange={(e) => { setAno(e.target.value); setVisiveis(PAGINA_DO_EXTRATO); }} style={seletor} value={ano}>
            <option value="">Todo ano</option>
            {anos.map((opcao) => (
              <option key={opcao} value={opcao}>
                {opcao}
              </option>
            ))}
          </select>
          <select onChange={(e) => { setMes(e.target.value); setVisiveis(PAGINA_DO_EXTRATO); }} style={seletor} value={mes}>
            <option value="">Todo mês</option>
            {MESES_CURTOS.map((rotulo, indice) => {
              const valor = String(indice + 1).padStart(2, "0");
              return (
                <option key={valor} value={valor}>
                  {rotulo}
                </option>
              );
            })}
          </select>
          <select onChange={(e) => { setPerfil(e.target.value); setVisiveis(PAGINA_DO_EXTRATO); }} style={seletor} value={perfil}>
            <option value="">Todo perfil</option>
            {perfis.map((opcao) => (
              <option key={opcao} value={opcao}>
                {opcao}
              </option>
            ))}
          </select>
          <select onChange={(e) => { setSituacao(e.target.value); setVisiveis(PAGINA_DO_EXTRATO); }} style={seletor} value={situacao}>
            <option value="">Toda situação</option>
            <option value="paga">Paga</option>
            <option value="a_vencer">A vencer</option>
            <option value="vencida">Vencida</option>
          </select>
        </div>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 960, width: "100%" }}>
          <thead>
            <tr style={{ background: T.soft }}>
              {["Unidade", "Cliente", "Imobiliária", "Perfil", "Parcela", "Vencimento", "Pagamento", "Valor", "Valor líquido", "Situação"].map(
                (coluna) => (
                  <th
                    key={coluna}
                    style={{
                      ...cabecalho,
                      ...(coluna === "Unidade" ? { paddingLeft: 16 } : null),
                      textAlign:
                        coluna === "Valor" || coluna === "Valor líquido" ? "right" : "left",
                    }}
                  >
                    {coluna}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {filtradas.slice(0, visiveis).map((parcela, indice) => (
              <tr key={`${parcela.unidade}-${parcela.numero}-${parcela.vencimento ?? ""}-${indice}`}>
                <td style={{ ...celula, color: T.text, fontWeight: 600, paddingLeft: 16, whiteSpace: "nowrap" }}>
                  {parcela.unidade}
                  {parcela.empreendimento ? (
                    <p style={{ color: T.muted, fontSize: 10.5, fontWeight: 400, margin: 0 }}>
                      {parcela.empreendimento}
                    </p>
                  ) : null}
                </td>
                <td style={{ ...celula, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {parcela.cliente ?? "-"}
                </td>
                <td style={{ ...celula, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {parcela.imobiliaria ?? "-"}
                </td>
                <td style={{ ...celula, whiteSpace: "nowrap" }}>{parcela.perfil}</td>
                <td style={{ ...celula, whiteSpace: "nowrap" }}>{parcela.numero}</td>
                <td style={{ ...celula, whiteSpace: "nowrap" }}>{dia(parcela.vencimento)}</td>
                <td style={{ ...celula, whiteSpace: "nowrap" }}>{dia(parcela.pagoEm)}</td>
                <td style={{ ...celula, textAlign: "right", whiteSpace: "nowrap" }}>
                  {brl(parcela.valor)}
                </td>
                <td style={{ ...celula, color: T.text, fontWeight: 600, textAlign: "right", whiteSpace: "nowrap" }}>
                  {parcela.liquido === null ? (
                    <span
                      style={{ color: T.muted, fontWeight: 400 }}
                      title={parcela.motivo ?? "Líquido não calculado"}
                    >
                      -
                    </span>
                  ) : (
                    brl(parcela.liquido)
                  )}
                </td>
                <td style={{ ...celula, whiteSpace: "nowrap" }}>
                  <PilulaDeSituacao situacao={parcela.situacao} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7} style={{ ...celula, color: T.text, fontWeight: 700, paddingLeft: 16 }}>
                Total do recorte
              </td>
              <td style={{ ...celula, color: T.text, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>
                {brl(totais.valor)}
              </td>
              <td style={{ ...celula, color: T.text, fontWeight: 700, textAlign: "right", whiteSpace: "nowrap" }}>
                {brl(totais.liquido)}
              </td>
              <td style={celula} />
            </tr>
          </tfoot>
        </table>
      </div>

      {filtradas.length === 0 ? (
        <p style={{ color: T.muted, fontSize: 13, margin: 0, padding: 24, textAlign: "center" }}>
          Nenhuma parcela nesse filtro.
        </p>
      ) : null}

      {filtradas.length > visiveis ? (
        <button
          onClick={() => setVisiveis((atual) => atual + PAGINA_DO_EXTRATO)}
          style={{
            background: "transparent",
            border: "none",
            borderTop: `1px solid ${T.border}`,
            color: T.sub,
            cursor: "pointer",
            fontFamily: fonte,
            fontSize: 13,
            padding: "12px",
            width: "100%",
          }}
          type="button"
        >
          Ver mais {inteiro(Math.min(PAGINA_DO_EXTRATO, filtradas.length - visiveis))} de{" "}
          {inteiro(filtradas.length)}
        </button>
      ) : null}

      {extratoTotal > extrato.length ? (
        <p style={{ color: T.muted, fontSize: 12, margin: 0, padding: "10px 16px" }}>
          Mostrando as {inteiro(extrato.length)} parcelas mais recentes de {inteiro(extratoTotal)}.
        </p>
      ) : null}
    </section>
  );
}

function PilulaDeSituacao({ situacao }: { situacao: ExtratoParcela["situacao"] }) {
  const cor = situacao === "vencida" ? T.danger : situacao === "paga" ? T.ok : T.sub;
  const fundo = situacao === "vencida" ? T.dangerBg : situacao === "paga" ? T.okBg : T.soft;

  return (
    <span
      style={{
        background: fundo,
        borderRadius: 999,
        color: cor,
        display: "inline-flex",
        fontSize: 11,
        fontWeight: 600,
        padding: "3px 9px",
      }}
    >
      {SITUACAO_LABELS[situacao]}
    </span>
  );
}

// ── O MODAL DE PARCELAS (porta o UnitCarteiraModal interno) ─────────────────
// Diferenças declaradas: a fonte é /api/incorporador/parcelas (escopada com `unidadeNoEscopo`),
// COM a coluna Boleto desde 18/08/2026 (a rota passou a mandar `boletoUrl`, a fatura Asaas — ver
// o cabeçalho do arquivo) e sem o clique no nome do comprador (não há entityId no payload do
// portal).

type FiltroDeParcela = "a_vencer" | "liquidada" | "todas" | "vencida";
type ColunaDeParcela = "competencia" | "pagamento" | "status" | "valor" | "vencimento";
type OrdemDeParcela = { coluna: ColunaDeParcela; direcao: "asc" | "desc" };

function filtrarParcelas(itens: ParcelaDaUnidade[], filtro: FiltroDeParcela): ParcelaDaUnidade[] {
  if (filtro === "todas") return itens;
  return itens.filter((item) => item.status === filtro);
}

function ordenarParcelas(itens: ParcelaDaUnidade[], ordem: OrdemDeParcela): ParcelaDaUnidade[] {
  const fator = ordem.direcao === "asc" ? 1 : -1;
  const tempo = (valor: null | string) => (valor ? new Date(valor).getTime() : 0);
  const pesoDoStatus: Record<ParcelaDaUnidade["status"], number> = {
    a_vencer: 2,
    liquidada: 1,
    vencida: 3,
  };

  return [...itens].sort((a, b) => {
    if (ordem.coluna === "valor") return (a.amount - b.amount) * fator;
    if (ordem.coluna === "competencia") return (tempo(a.competence) - tempo(b.competence)) * fator;
    if (ordem.coluna === "pagamento") return (tempo(a.paidAt) - tempo(b.paidAt)) * fator;
    if (ordem.coluna === "status") return (pesoDoStatus[a.status] - pesoDoStatus[b.status]) * fator;
    return (tempo(a.dueDate) - tempo(b.dueDate)) * fator;
  });
}

function ModalDeParcelas({
  onFechar,
  unit,
}: {
  onFechar: () => void;
  unit: UnidadeDaTela;
}) {
  const [parcelas, setParcelas] = useState<null | ParcelaDaUnidade[]>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [filtro, setFiltro] = useState<FiltroDeParcela>("todas");
  const [ordem, setOrdem] = useState<OrdemDeParcela>({ coluna: "vencimento", direcao: "asc" });

  useEffect(() => {
    let ativo = true;

    async function carregar() {
      try {
        setErro(null);
        const r = await fetch(
          `/api/incorporador/parcelas?unitId=${encodeURIComponent(unit.id)}`,
          { cache: "no-store" },
        );
        const corpo = (await r.json().catch(() => null)) as
          | { data?: { installments: ParcelaDaUnidade[] }; error?: string }
          | null;

        if (!r.ok || !corpo?.data) {
          throw new Error(corpo?.error ?? "Não foi possível carregar as parcelas.");
        }
        if (ativo) setParcelas(corpo.data.installments);
      } catch (falha) {
        if (ativo) {
          setErro(falha instanceof Error ? falha.message : "Falha ao carregar as parcelas.");
        }
      }
    }

    void carregar();
    return () => {
      ativo = false;
    };
  }, [unit.id]);

  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") onFechar();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  const linhas = parcelas ? ordenarParcelas(filtrarParcelas(parcelas, filtro), ordem) : [];

  return (
    <div
      style={{
        alignItems: "center",
        background: "rgba(0,0,0,0.4)",
        display: "flex",
        inset: 0,
        justifyContent: "center",
        padding: 16,
        position: "fixed",
        zIndex: 60,
      }}
    >
      <button
        aria-label="Fechar"
        onClick={onFechar}
        style={{
          background: "transparent",
          border: "none",
          cursor: "default",
          inset: 0,
          position: "absolute",
        }}
        type="button"
      />
      <div
        style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 16,
          boxShadow: T.sombra,
          display: "flex",
          flexDirection: "column",
          maxHeight: "85vh",
          maxWidth: 760,
          overflow: "hidden",
          position: "relative",
          width: "100%",
          zIndex: 1,
        }}
      >
        <header
          style={{
            alignItems: "flex-start",
            borderBottom: `1px solid ${T.border}`,
            display: "flex",
            gap: 12,
            justifyContent: "space-between",
            padding: "14px 20px",
          }}
        >
          <div style={{ minWidth: 0 }}>
            <p
              style={{
                alignItems: "center",
                color: T.text,
                display: "flex",
                fontSize: 14,
                fontWeight: 700,
                gap: 8,
                margin: 0,
              }}
            >
              <WalletCards aria-hidden="true" size={16} style={{ color: T.sub }} />
              Carteira · {unit.code}
            </p>
            {unit.client ? (
              <p
                style={{
                  color: T.sub,
                  fontSize: 12,
                  margin: "2px 0 0",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {unit.client}
                {unit.imobiliaria ? ` · ${unit.imobiliaria}` : ""}
              </p>
            ) : null}
          </div>
          <div style={{ alignItems: "center", display: "flex", flexShrink: 0, gap: 8 }}>
            {/* O contrato também no cabeçalho do modal (ordem do Lucas, 18/08/2026). */}
            {unit.temContrato ? (
              <a
                href={`/api/incorporador/contrato?unitId=${encodeURIComponent(unit.id)}`}
                rel="noopener noreferrer"
                style={{
                  alignItems: "center",
                  background: T.soft,
                  border: `1px solid ${T.border}`,
                  borderRadius: 8,
                  color: T.sub,
                  display: "inline-flex",
                  fontSize: 11.5,
                  fontWeight: 600,
                  gap: 6,
                  height: 32,
                  padding: "0 10px",
                }}
                target="_blank"
                title="Abrir contrato assinado"
              >
                <FileText aria-hidden="true" size={13} />
                Contrato
              </a>
            ) : null}
            <button
              aria-label="Fechar"
              onClick={onFechar}
              style={{
                alignItems: "center",
                background: "transparent",
                border: "none",
                borderRadius: 8,
                color: T.muted,
                cursor: "pointer",
                display: "flex",
                height: 32,
                justifyContent: "center",
                width: 32,
              }}
              type="button"
            >
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        </header>

        <div
          style={{
            borderBottom: `1px solid ${T.border}`,
            display: "grid",
            gap: 8,
            gridTemplateColumns: "repeat(4, 1fr)",
            padding: "12px 20px",
          }}
        >
          <MiniFato rotulo="VGV" valor={brl(unit.totalContract)} />
          <MiniFato rotulo="Pago" valor={brl(unit.paidAmount)} />
          <MiniFato
            rotulo="Vencido"
            tom={unit.overdueAmount > 0 ? "alerta" : undefined}
            valor={brl(unit.overdueAmount)}
          />
          {/* A coluna nova da tela, no modal também: a fatia do incorporador nesta unidade. */}
          <MiniFato
            rotulo="Seu líquido"
            valor={unit.liquido ? brl(unit.liquido.liquido) : "-"}
          />
        </div>

        {parcelas && parcelas.length > 0 ? (
          <div
            style={{
              alignItems: "center",
              borderBottom: `1px solid ${T.border}`,
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              justifyContent: "space-between",
              padding: "10px 20px",
            }}
          >
            <p style={{ color: T.muted, fontSize: 12, margin: 0 }}>
              {inteiro(linhas.length)}
              {linhas.length !== parcelas.length ? ` de ${inteiro(parcelas.length)}` : ""} parcelas
            </p>
            <select
              onChange={(evento) => setFiltro(evento.target.value as FiltroDeParcela)}
              style={seletor}
              value={filtro}
            >
              <option value="todas">Todas</option>
              <option value="liquidada">Liquidadas</option>
              <option value="vencida">Vencidas</option>
              <option value="a_vencer">A vencer</option>
            </select>
          </div>
        ) : null}

        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {erro ? (
            <p style={{ color: T.danger, fontSize: 13, fontWeight: 600, margin: 0, padding: 24, textAlign: "center" }}>
              {erro}
            </p>
          ) : !parcelas ? (
            <p style={{ color: T.muted, fontSize: 13, margin: 0, padding: 24, textAlign: "center" }}>
              Carregando as parcelas…
            </p>
          ) : parcelas.length === 0 ? (
            <p style={{ color: T.muted, fontSize: 13, margin: 0, padding: 24, textAlign: "center" }}>
              Sem parcelas registradas.
            </p>
          ) : (
            <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 700, width: "100%" }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 5 }}>
                <tr style={{ background: T.soft }}>
                  <th style={{ ...cabecalho, paddingLeft: 20 }}>Parcela</th>
                  <CabecalhoDeParcela coluna="competencia" ordem={ordem} onOrdenar={setOrdem} rotulo="Competência" />
                  <CabecalhoDeParcela coluna="vencimento" ordem={ordem} onOrdenar={setOrdem} rotulo="Vencimento" />
                  <CabecalhoDeParcela coluna="pagamento" ordem={ordem} onOrdenar={setOrdem} rotulo="Pagamento" />
                  <CabecalhoDeParcela alinhar="right" coluna="valor" ordem={ordem} onOrdenar={setOrdem} rotulo="Valor" />
                  <CabecalhoDeParcela coluna="status" ordem={ordem} onOrdenar={setOrdem} rotulo="Status" />
                  {/* O boleto por parcela (ordem do Lucas, 18/08/2026). */}
                  <th style={{ ...cabecalho, paddingRight: 20, textAlign: "right" }}>Boleto</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((parcela) => (
                  <tr key={parcela.id}>
                    <td style={{ ...celula, paddingLeft: 20 }}>
                      <p style={{ color: T.text, fontSize: 13, fontWeight: 600, margin: 0 }}>
                        {parcela.number}
                      </p>
                      <p style={{ color: T.muted, fontSize: 11.5, margin: 0 }}>
                        {parcela.type ?? "-"}
                      </p>
                    </td>
                    <td style={{ ...celula, whiteSpace: "nowrap" }}>
                      {mesDeCompetencia(parcela.competence)}
                    </td>
                    <td style={{ ...celula, whiteSpace: "nowrap" }}>{dia(parcela.dueDate)}</td>
                    <td style={{ ...celula, whiteSpace: "nowrap" }}>
                      {parcela.paidAt ? dia(parcela.paidAt) : "-"}
                    </td>
                    <td style={{ ...celula, color: T.text, fontWeight: 500, textAlign: "right", whiteSpace: "nowrap" }}>
                      {brl(parcela.amount)}
                    </td>
                    <td style={{ ...celula, whiteSpace: "nowrap" }}>
                      <PilulaDeParcela parcela={parcela} />
                    </td>
                    <td style={{ ...celula, paddingRight: 20, textAlign: "right", whiteSpace: "nowrap" }}>
                      <LinkDeBoleto parcela={parcela} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * O link de Fatura/Boleto da parcela (ordem do Lucas, 18/08/2026). Parcela paga mantém o link,
 * ESMAECIDO mas clicável: no Asaas a mesma fatura vira o comprovante. Sem URL, sem link.
 */
function LinkDeBoleto({ parcela }: { parcela: ParcelaDaUnidade }) {
  if (!parcela.boletoUrl) {
    return <span style={{ color: T.muted, fontSize: 12 }}>-</span>;
  }

  const paga = parcela.status === "liquidada";

  return (
    <a
      href={parcela.boletoUrl}
      rel="noopener noreferrer"
      style={{
        alignItems: "center",
        background: T.soft,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        color: T.sub,
        display: "inline-flex",
        fontSize: 11,
        fontWeight: 600,
        gap: 5,
        opacity: paga ? 0.55 : 1,
        padding: "3px 9px",
      }}
      target="_blank"
      title={paga ? "Parcela paga — abrir o comprovante no Asaas" : "Abrir a fatura/boleto no Asaas"}
    >
      <ExternalLink aria-hidden="true" size={11} />
      Boleto
    </a>
  );
}

function PilulaDeParcela({ parcela }: { parcela: ParcelaDaUnidade }) {
  if (parcela.status === "liquidada") {
    return <PilulaBase cor={T.ok} fundo={T.okBg} texto="Liquidada" />;
  }
  if (parcela.status === "vencida") {
    return (
      <PilulaBase
        cor={T.danger}
        fundo={T.dangerBg}
        texto={`Vencida${parcela.overdueDays ? ` · ${parcela.overdueDays}d` : ""}`}
      />
    );
  }
  return <PilulaBase cor={T.sub} fundo={T.soft} texto="A vencer" />;
}

function PilulaBase({ cor, fundo, texto }: { cor: string; fundo: string; texto: string }) {
  return (
    <span
      style={{
        background: fundo,
        borderRadius: 999,
        color: cor,
        display: "inline-flex",
        fontSize: 11,
        fontWeight: 600,
        padding: "3px 9px",
      }}
    >
      {texto}
    </span>
  );
}

function MiniFato({
  rotulo,
  tom,
  valor,
}: {
  rotulo: string;
  tom?: "alerta";
  valor: string;
}) {
  return (
    <div
      style={{
        background: T.soft,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        padding: "8px 12px",
      }}
    >
      <p style={{ color: T.muted, fontSize: 11, margin: 0 }}>{rotulo}</p>
      <p
        style={{
          color: tom === "alerta" ? T.danger : T.text,
          fontSize: 13,
          fontWeight: 600,
          margin: 0,
        }}
      >
        {valor}
      </p>
    </div>
  );
}

// ── PEÇAS COMPARTILHADAS DA TELA ────────────────────────────────────────────

const cartao = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 14,
  padding: 20,
} as const;

const titulo = { color: T.text, fontSize: 15, fontWeight: 700, margin: 0 } as const;

const cabecalho = {
  borderBottom: `1px solid ${T.border}`,
  color: T.muted,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.04em",
  padding: "9px 10px",
  textAlign: "left",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
} as const;

const celula = {
  borderBottom: `1px solid ${T.border}`,
  color: T.sub,
  padding: "9px 10px",
  verticalAlign: "top",
} as const;

const seletor = {
  background: T.soft,
  border: `1px solid ${T.border}`,
  borderRadius: 10,
  color: T.text,
  fontFamily: fonte,
  fontSize: 12.5,
  fontWeight: 500,
  height: 36,
  outline: "none",
  padding: "0 10px",
} as const;

/** O cabeçalho ordenável da tabela de unidades (porta o CarteiraHead interno). */
function CabecalhoOrdenavel({
  alinhar = "left",
  coluna,
  onOrdenar,
  ordem,
  rotulo,
}: {
  alinhar?: "left" | "right";
  coluna: ColunaDaCarteira;
  onOrdenar: (ordem: OrdemDaCarteira) => void;
  ordem: OrdemDaCarteira;
  rotulo: string;
}) {
  const ativo = ordem.coluna === coluna;

  return (
    <th style={{ ...cabecalho, textAlign: alinhar }}>
      <button
        onClick={() =>
          onOrdenar({
            coluna,
            direcao: ativo && ordem.direcao === "asc" ? "desc" : "asc",
          })
        }
        style={{
          alignItems: "center",
          background: "transparent",
          border: "none",
          color: ativo ? T.text : T.muted,
          cursor: "pointer",
          display: "inline-flex",
          fontFamily: fonte,
          fontSize: 11,
          fontWeight: 600,
          gap: 4,
          letterSpacing: "0.04em",
          padding: 0,
          textTransform: "uppercase",
        }}
        type="button"
      >
        {rotulo}
        <ArrowUpDown aria-hidden="true" size={12} style={{ opacity: ativo ? 1 : 0.4 }} />
      </button>
    </th>
  );
}

/** O cabeçalho ordenável do modal (porta o InstallmentHead interno). */
function CabecalhoDeParcela({
  alinhar = "left",
  coluna,
  onOrdenar,
  ordem,
  rotulo,
}: {
  alinhar?: "left" | "right";
  coluna: ColunaDeParcela;
  onOrdenar: (ordem: OrdemDeParcela) => void;
  ordem: OrdemDeParcela;
  rotulo: string;
}) {
  const ativo = ordem.coluna === coluna;

  return (
    <th style={{ ...cabecalho, textAlign: alinhar }}>
      <button
        onClick={() =>
          onOrdenar({
            coluna,
            direcao: ativo && ordem.direcao === "asc" ? "desc" : "asc",
          })
        }
        style={{
          alignItems: "center",
          background: "transparent",
          border: "none",
          color: ativo ? T.text : T.muted,
          cursor: "pointer",
          display: "inline-flex",
          fontFamily: fonte,
          fontSize: 11,
          fontWeight: 600,
          gap: 4,
          letterSpacing: "0.04em",
          padding: 0,
          textTransform: "uppercase",
        }}
        type="button"
      >
        {rotulo}
        <ArrowUpDown aria-hidden="true" size={12} style={{ opacity: ativo ? 1 : 0.4 }} />
      </button>
    </th>
  );
}

/** O selo de situação da unidade (porta o UnitFinancialStatus interno). */
function SituacaoDaUnidade({ unit }: { unit: UnidadeDaTela }) {
  if (unit.overdueInstallments > 0) {
    return (
      <PilulaBase
        cor={T.danger}
        fundo={T.dangerBg}
        texto={`${unit.overdueInstallments} vencida(s) · ${unit.maxOverdueDays}d`}
      />
    );
  }
  return <PilulaBase cor={T.ok} fundo={T.okBg} texto="Em dia" />;
}

/**
 * O botão da coluna Contrato (ordem do Lucas, 18/08/2026) — o ícone de documento da interna
 * (empreendimentos-view ~2716), abrindo o PDF em aba nova.
 *
 * ⚠️ O link leva o unitId, NUNCA o uuid: a rota /api/incorporador/contrato reconfere o escopo e
 * resolve o documento no C2X a cada clique. O uuid nem chega à tela — `temContrato` é só o sinal.
 * Sem contrato assinado, a célula é "-", igual à interna.
 */
function BotaoDeContrato({ unit }: { unit: UnidadeDaTela }) {
  if (!unit.temContrato) {
    return <span style={{ color: T.muted, fontSize: 12 }}>-</span>;
  }

  return (
    <a
      href={`/api/incorporador/contrato?unitId=${encodeURIComponent(unit.id)}`}
      onClick={(evento) => evento.stopPropagation()}
      rel="noopener noreferrer"
      style={{
        alignItems: "center",
        background: T.soft,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        color: T.sub,
        display: "inline-flex",
        height: 28,
        justifyContent: "center",
        width: 28,
      }}
      target="_blank"
      title="Abrir contrato assinado"
    >
      <FileText aria-hidden="true" size={14} />
    </a>
  );
}

/** O CarteiraCard interno, no tema do portal: rótulo, número e a dica embaixo. */
function CartaoDaCarteira({
  dica,
  rotulo,
  tom,
  valor,
}: {
  dica: string;
  rotulo: string;
  tom?: "alerta";
  valor: string;
}) {
  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        padding: 14,
      }}
    >
      <p style={{ color: T.muted, fontSize: 11.5, fontWeight: 500, margin: 0 }}>{rotulo}</p>
      <p
        style={{
          color: tom === "alerta" ? T.danger : T.text,
          fontSize: 17,
          fontWeight: 600,
          margin: "4px 0 0",
        }}
      >
        {valor}
      </p>
      <p style={{ color: T.muted, fontSize: 11, margin: "2px 0 0" }}>{dica}</p>
    </div>
  );
}

function Numero({
  destaque,
  rotulo,
  tom,
  valor,
}: {
  destaque?: boolean;
  rotulo: string;
  tom?: "alerta";
  valor: string;
}) {
  return (
    <div style={{ minWidth: 130 }}>
      <div
        style={{
          color: T.muted,
          fontSize: 11,
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
          fontSize: destaque ? 28 : 20,
          fontWeight: destaque ? 700 : 600,
          marginTop: 4,
        }}
      >
        {valor}
      </div>
    </div>
  );
}

function Pilula({
  ativo,
  onClick,
  rotulo,
}: {
  ativo: boolean;
  onClick: () => void;
  rotulo: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: ativo ? T.btnBg : "transparent",
        border: `1px solid ${ativo ? "transparent" : T.border}`,
        borderRadius: 999,
        color: ativo ? T.btnFg : T.sub,
        cursor: "pointer",
        fontFamily: fonte,
        fontSize: 12.5,
        fontWeight: ativo ? 600 : 500,
        padding: "7px 14px",
      }}
      type="button"
    >
      {rotulo}
    </button>
  );
}

function Aviso({ texto, tom }: { texto: string; tom?: "erro" }) {
  return (
    <div
      style={{
        background: tom === "erro" ? T.dangerBg : T.card,
        border: `1px ${tom === "erro" ? "solid" : "dashed"} ${tom === "erro" ? T.danger : T.border}`,
        borderRadius: 14,
        color: tom === "erro" ? T.danger : T.muted,
        fontSize: 14,
        padding: 40,
        textAlign: "center",
      }}
    >
      {texto}
    </div>
  );
}
