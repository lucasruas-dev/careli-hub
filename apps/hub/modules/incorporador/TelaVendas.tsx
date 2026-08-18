"use client";

import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CheckCircle2,
  ChevronDown,
  FileText,
  Map as MapaIcone,
  ReceiptText,
  Search,
  X,
} from "lucide-react";

import { fonte } from "@/modules/publico/ui/tokens";

import { T } from "./tema";
import { TelaMasterplan } from "./TelaMasterplan";

// VENDAS: como está o empreendimento do incorporador.
//
// Pedido do Lucas (17/08/2026): *"nao tem a tela produto, vai ser CRM - Vendas - Carteira"*. O
// masterplan não some com a aba Produtos: ele passa a morar AQUI, que é onde faz sentido, porque o
// mapa é outra forma de olhar as mesmas unidades desta tela.
//
// A tela tem QUATRO visões na mesma faixa. Resumo e Pipeline dividem o MESMO fetch (a rota custa
// 4+1 consultas no C2X; nada de segundo carregamento); Contratos e Assinaturas (18/08/2026) têm
// fetch PRÓPRIO sob demanda — só quando a visão abre, com cache por recorte (useDadosDaVisao) e
// sem polling:
//   • RESUMO   — uma GRADE DE BI (pedido do Lucas, 18/08/2026: "trazer o informativo top da
//     barra, deixar claro que é um gráfico... em vez de colocar um embaixo do outro, poderia
//     trazer como um BI com o analítico dando suporte"): linha 1 = faixa de KPIs; linha 2 = o
//     palco, gráfico mensal Propostas × Canceladas × Faturadas (2/3) com o ranking de
//     imobiliárias ao lado (1/3); linha 3 = composição do estoque × ritmo; linha 4 = o Cenário
//     Analítico (tabela de unidades) em largura total;
//   • PIPELINE — o kanban da VendasTab do Apolo interno (empreendimentos-view.tsx:1997/2037),
//     portado coluna a coluna: 5 colunas na ordem do funil + chips de Disponíveis e Bloqueadas.
//
// O QUE FICOU DE FORA DO PIPELINE, declarado (decisão do plano): VendaTerminaisModal (o motivo
// pode conter reprovação de crédito de PF — terminais saem só como CONTAGEM) e VendasMovimentacao
// (o feed usa rótulos internos do C2X como "Reprovado análise"). O "Cenário Analítico" do BI é a
// própria tabela de unidades do Resumo, SEM a coluna Plano (plano comercial é interno).
//
// O VendaPropostaModal ganhou (18/08/2026) a versão ESCOPADA dele: `ModalDaProposta`, apontando
// para /api/incorporador/vendas/proposta (a rota com `unidadeNoEscopo` ANTES da leitura). O que o
// modal interno mostra de combinado comercial (nome/percentual de plano, juros, corretor) NÃO
// atravessa: o payload já vem sem isso do servidor. O clique liga pela dupla unitId + etapa: o
// payload de /api/incorporador/vendas traz o `unitId` por unidade (`unidadesParaOPortal`,
// vendas-resumo.ts) e a rota da proposta reconfere o escopo do lado de lá.
//
// ⚠️ CONVENÇÃO DE VGV, registrada (pergunta 7 do plano): o card "VGV do empreendimento" soma as
// bloqueadas (o VGV é do produto inteiro); os VGVs do kanban e dos KPIs do BI somam só o que está
// em cada coluna/métrica. Recortes do mesmo conjunto, cada um rotulado com o que soma.
//
// ⚠️ O RECORTE NÃO VEM DA TELA. O seletor de empreendimento manda um id que a própria rota já
// tinha devolvido; quem decide o que ele pode ver é o cookie assinado, do outro lado.

type EmpreendimentoDaTela = {
  id: string;
  /** Código do mapa interno, quando este empreendimento tem um. */
  masterplan: null | string;
  nome: string;
};

type Balde = "bloqueada" | "disponivel" | "negociacao" | "reservado" | "vendido";

type BaldeResumo = {
  balde: Balde;
  etapas: { rotulo: string; units: number; vgv: number }[];
  rotulo: string;
  units: number;
  vgv: number;
};

type Resumo = {
  baldes: BaldeResumo[];
  /** Pessoas DISTINTAS comprando nas vendas vivas (campo novo do payload; opcional p/ degradar). */
  clientesUnicos?: number;
  perdas: { canceladas: number; distratos: number };
  total: { units: number; vgv: number };
  vendido: { units: number; vgv: number };
  vendidoPct: number;
};

type Ritmo = {
  anteriores: { units: number; vgv: number };
  mediaMensal: number;
  meses: { mes: string; units: number; vgv: number }[];
  semData: number;
};

/** A chave do estágio do funil interno — a mesma de `ApoloVendaStage`, vinda no payload. */
type Etapa = "assinatura" | "contrato" | "disponivel" | "faturado" | "proposta" | "reservado";

type Unidade = {
  balde: Balde;
  bloco: null | string;
  comprador: null | string;
  desde: null | string;
  etapa: Etapa;
  imobiliaria: null | string;
  lote: null | string;
  situacao: string;
  unidade: string;
  /**
   * O id da unidade no C2X — a CHAVE do popup da proposta (`/vendas/proposta?unitId=…`), que só
   * é seguro trafegar porque a rota confere `unidadeNoEscopo` do lado de lá (mesmo desenho do
   * `unit.id` que a TelaCarteira já usa no modal de parcelas). Nulo quando o id não veio como
   * número do C2X; sem ele o clique daquela linha não liga e a tela degrada, sem quebrar.
   */
  unitId: null | number;
  valor: number;
};

/** Um total do BI: unidades e VGV — a alternância UN/R$ escolhe qual mostrar. */
type TallyBI = { un: number; vgv: number };

type MesBI = { canceladas: TallyBI; faturadas: TallyBI; mes: string; propostas: TallyBI };

type IndicadoresBI = {
  canceladas: TallyBI;
  cancelamentoPct: number;
  deadlineMedioDias: null | number;
  faturadas: TallyBI;
  parcial: boolean;
  propostas: TallyBI;
  ranking: { nome: string; unidades: number; vgv: number }[];
  serieMensal: MesBI[];
};

/** Um balde do perfil do comprador: rótulo + contagem + percentual (0–100), já agregado. */
type FatiaDoPerfil = { percentual: number; quantidade: number; rotulo: string };

/**
 * O agregado "Quem é o comprador" (perfil-comprador.ts): SÓ baldes com contagem e percentual —
 * nenhum dado individual chega ao cliente, e é assim que tem que continuar.
 */
type PerfilComprador = {
  cidades: FatiaDoPerfil[];
  estadoCivil: FatiaDoPerfil[];
  idades: FatiaDoPerfil[];
  profissoes: FatiaDoPerfil[];
  rendaFamiliar: FatiaDoPerfil[];
  sexo: FatiaDoPerfil[];
  vendas: number;
};

type Dados = {
  bi?: IndicadoresBI | null;
  empreendimentos: EmpreendimentoDaTela[];
  filtro?: null | string;
  perfilComprador?: null | PerfilComprador;
  resumo?: Resumo;
  ritmo?: Ritmo;
  unidades?: Unidade[];
};

// ── CONTRATOS E ASSINATURAS (as visões com fetch PRÓPRIO) ───────────────────
// Payloads de /api/incorporador/vendas/contratos e /vendas/assinaturas — cada shape é a allowlist
// da rota, campo a campo. Nome de comprador/imobiliária/assinante aparece (o incorporador é parte
// do contrato); telefone, e-mail e documento NÃO existem no payload.

/** A situação resumida da assinatura de um contrato (lib/apolo/incorporador/contratos.ts). */
type SituacaoAssinatura = "aguardando-emissao" | "assinado" | "em-assinatura";

// COPIADO de contratos.ts, não importado, pela mesma razão de ETAPA_ORDEM: aquele módulo puxa o
// driver do MySQL, que não pode entrar no bundle de um componente "use client".
const SITUACAO_LABELS: Record<SituacaoAssinatura, string> = {
  "aguardando-emissao": "Aguardando emissão",
  assinado: "Assinado",
  "em-assinatura": "Em assinatura",
};

type ContratoDaTela = {
  assinatura: SituacaoAssinatura;
  bloco: null | string;
  comprador: null | string;
  /** ISO curto "YYYY-MM-DD" — formatar por STRING (rotuloDeYmd), nunca por new Date. */
  faturadoEm: null | string;
  /** ISO completo (created_at do histórico é datetime real): aqui rotuloDaData serve. */
  geradoEm: null | string;
  imobiliaria: null | string;
  lote: null | string;
  /** Há contrato assinado no D4Sign: liga o botão de PDF (mesma UX da coluna da Carteira). */
  temContrato: boolean;
  /** Rótulo compacto código+quadra+lote (VALB0218), o mesmo da carteira. */
  unidade: string;
  /** A chave do botão de PDF; a rota que o recebe reconfere o escopo do lado de lá. */
  unitId: number;
  valorTabela: number;
};

type DadosContratos = {
  /** O aviso do teto (lista cortada nos 500 mais recentes), quando houver. */
  aviso: null | string;
  contratos: ContratoDaTela[];
  /**
   * Contagem por situação do recorte INTEIRO, calculada na rota ANTES do teto: é ela que os
   * chips mostram. Opcional só por resiliência a payload antigo em cache; sem ela, o fallback
   * conta a lista exibida.
   */
  porSituacao?: Partial<Record<SituacaoAssinatura, number>>;
  /** Quantos contratos vivos o recorte tem DE VERDADE, mesmo com a lista no teto. */
  total: number;
};

type AssinanteDaTela = {
  /** Contratos em que a fila parou em alguém ANTES dele: pendência que ainda não é dele. */
  aguardandoAnteriores: number;
  assinou: number;
  /** Contratos em que a bola está COM ELE agora: o gargalo que o quadro existe para mostrar. */
  naVez: number;
  nome: string;
  papel: null | string;
};

type PendenteDaTela = {
  empreendimento: string;
  /** ISO curto "2026-07-01" — formatar por STRING (rotuloDeYmd), nunca por new Date. */
  enviadoEm: string;
  naVez: string[];
  unidade: string;
};

type DadosAssinaturas = {
  assinantes: AssinanteDaTela[];
  kpis: {
    aguardandoEmissao: number;
    pctCompradoresAssinaram: null | number;
    tempoMedioDias: null | number;
    unidadesComEnvio: number;
    unidadesTotalmenteAssinadas: number;
  };
  pendentes: PendenteDaTela[];
};

// ── O POPUP DA PROPOSTA (payload de /api/incorporador/vendas/proposta) ──────
// O shape é a allowlist da rota, campo a campo. Datas vêm como 'YYYY-MM-DD' e são formatadas por
// STRING (rotuloDeYmd), nunca por `new Date`: meia-noite UTC vira véspera no fuso de São Paulo.

type ParcelaDaEntrada = { n: number; paga: boolean; valor: number; vencimento: null | string };

type Proposta = {
  desconto: null | number;
  entrada: { parcelas: ParcelaDaEntrada[]; percentual: null | number; total: number };
  faturadoEm: null | string;
  financiamento: {
    parcelas: null | number;
    primeiroVencimento: null | string;
    valorParcela: null | number;
  };
  imobiliaria: null | string;
  unidade: string;
  valorNegociado: null | number;
  valorTabela: number;
  previsao: null | {
    desconto: null | number;
    entradaPercentual: number;
    entradaTotal: number;
    negociado: null | number;
  };
};

/** O que o modal precisa saber da unidade clicada, antes mesmo do fetch: o cabeçalho. */
type AlvoDaProposta = {
  comprador: null | string;
  imobiliaria: null | string;
  rotulo: string;
  unitId: number;
};

// ── O KANBAN (portado da VendasTab interna) ─────────────────────────────────
// As constantes vêm de empreendimentos-view.tsx:1667-1683 (VENDA_STAGE_ORDER/LABELS). Elas são
// COPIADAS e não importadas de lib/apolo/vendas de propósito: aquele módulo puxa o driver do
// MySQL, que não pode entrar no bundle de um componente "use client".
const ETAPA_ORDEM: Etapa[] = [
  "disponivel",
  "reservado",
  "proposta",
  "contrato",
  "assinatura",
  "faturado",
];

const ETAPA_LABELS: Record<Etapa, string> = {
  assinatura: "Em assinatura",
  contrato: "Contrato gerado",
  disponivel: "Disponível",
  faturado: "Faturado",
  proposta: "Proposta emitida",
  reservado: "Reservado",
};

// Escala monocromática do estoque: quanto mais perto da venda, mais forte. Nada de cor por
// estado (regra do Lucas: dourado não é estado), e assim a tela lê igual nos dois temas.
const FORCA: Record<Balde, number> = {
  bloqueada: 0.1,
  disponivel: 0.22,
  negociacao: 0.62,
  reservado: 0.4,
  vendido: 1,
};

const MESES_CURTOS = [
  "jan",
  "fev",
  "mar",
  "abr",
  "mai",
  "jun",
  "jul",
  "ago",
  "set",
  "out",
  "nov",
  "dez",
];

const brl = (valor: number): string =>
  valor.toLocaleString("pt-BR", { currency: "BRL", maximumFractionDigits: 0, style: "currency" });

/** Com centavos: no popup da proposta o centavo é o número do contrato, não ruído. */
const brlExato = (valor: number): string =>
  valor.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });

const inteiro = (valor: number): string => valor.toLocaleString("pt-BR");

const pct1 = (valor: number): string =>
  valor.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

/**
 * 'YYYY-MM-DD' → 'dd/mm/aaaa', por STRING. `new Date("2026-08-01")` é meia-noite UTC, que o
 * fuso de São Paulo mostra como 31/07 — a data do contrato voltaria um dia.
 */
function rotuloDeYmd(ymd: null | string): string {
  const texto = String(ymd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return "";
  const [ano, mes, dia] = texto.split("-");
  return `${dia}/${mes}/${ano}`;
}

/** "2026-08" vira "ago/26". */
function rotuloDoMes(mes: string): string {
  const [ano, numero] = mes.split("-");
  const indice = Number(numero) - 1;

  return `${MESES_CURTOS[indice] ?? numero}/${(ano ?? "").slice(2)}`;
}

function rotuloDaData(iso: null | string): string {
  if (!iso) return "";
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return "";

  return data.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

const PAGINA = 40;

export function TelaVendas() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [carregando, setCarregando] = useState(true);
  const [empSelecionado, setEmpSelecionado] = useState<null | string>(null);
  const [busca, setBusca] = useState("");
  const [baldeAtivo, setBaldeAtivo] = useState<Balde | null>(null);
  const [visiveis, setVisiveis] = useState(PAGINA);
  const [mapa, setMapa] = useState<EmpreendimentoDaTela | null>(null);
  // Resumo e Pipeline dividem o MESMO fetch (trocar entre elas não refaz a chamada); Contratos e
  // Assinaturas têm fetch PRÓPRIO, disparado só quando a visão abre (custo C2X).
  const [visao, setVisao] = useState<"assinaturas" | "contratos" | "pipeline" | "resumo">(
    "resumo",
  );
  // A alternância UN × R$ dos KPIs do BI (página "Vendas" do Power BI do Lucas).
  const [medida, setMedida] = useState<"rs" | "un">("un");
  // O popup da proposta: aberto pela unidade clicada (kanban ou tabela), quando ela tem unitId.
  const [propostaAberta, setPropostaAberta] = useState<AlvoDaProposta | null>(null);
  // Cache por unitId, vivo enquanto a tela vive: fechar e reabrir o MESMO popup não refaz a
  // chamada (a rota custa duas consultas no C2X). Erro NÃO entra no cache — reabrir tenta de novo.
  const cacheDePropostas = useRef(new Map<number, Proposta | null>());
  // Cache POR VISÃO e por recorte (chave = emp escolhido, "" = todos), vivo enquanto a tela vive:
  // voltar para Contratos/Assinaturas no mesmo recorte não refaz a chamada (2 queries C2X cada).
  // Erro NÃO entra no cache — reabrir a visão tenta de novo. E nada de polling.
  const cacheDeContratos = useRef(new Map<string, DadosContratos>());
  const cacheDeAssinaturas = useRef(new Map<string, DadosAssinaturas>());

  const carregar = useCallback(async (emp: null | string) => {
    setCarregando(true);
    setErro(null);

    try {
      const endereco = emp
        ? `/api/incorporador/vendas?emp=${encodeURIComponent(emp)}`
        : "/api/incorporador/vendas";
      const resposta = await fetch(endereco, { cache: "no-store" });
      const corpo = (await resposta.json().catch(() => null)) as
        | { data?: Dados; error?: string }
        | null;

      if (!resposta.ok || !corpo?.data) {
        setErro(corpo?.error ?? "Não foi possível carregar as vendas.");
        return;
      }

      setDados(corpo.data);
    } catch {
      setErro("Não foi possível carregar as vendas.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregar(empSelecionado);
    setVisiveis(PAGINA);
  }, [carregar, empSelecionado]);

  const unidades = useMemo(() => dados?.unidades ?? [], [dados]);

  // Abre o popup da proposta. Só liga em unidade COM contrato em andamento (etapa além de
  // "disponivel") e COM unitId no payload — sem o id, não há o que buscar (ver o tipo Unidade).
  const abrirProposta = useCallback((unidade: Unidade) => {
    if (unidade.unitId == null || unidade.etapa === "disponivel") return;

    setPropostaAberta({
      comprador: unidade.comprador,
      imobiliaria: unidade.imobiliaria,
      rotulo: [unidade.bloco, unidade.lote].filter(Boolean).join(" ") || unidade.unidade,
      unitId: unidade.unitId,
    });
  }, []);

  const filtradas = useMemo(() => {
    const alvo = busca.trim().toLowerCase();

    return unidades.filter((unidade) => {
      if (baldeAtivo && unidade.balde !== baldeAtivo) return false;
      if (!alvo) return true;

      return [unidade.unidade, unidade.bloco, unidade.lote, unidade.comprador, unidade.imobiliaria]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(alvo);
    });
  }, [baldeAtivo, busca, unidades]);

  if (mapa?.masterplan) {
    return (
      <TelaMasterplan code={mapa.masterplan} nome={mapa.nome} onVoltar={() => setMapa(null)} />
    );
  }

  if (carregando && !dados) return <Aviso texto="Carregando as vendas…" />;
  if (erro) return <Aviso texto={erro} tom="erro" />;

  if (!dados || !dados.resumo || !dados.ritmo) {
    return <Aviso texto="Não foi possível carregar as vendas agora." tom="erro" />;
  }

  const { empreendimentos, resumo, ritmo } = dados;
  const comMapa = empreendimentos.filter((emp) => emp.masterplan);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* ── CABEÇALHO: quem está sendo olhado e por onde trocar ──────────────── */}
      <header>
        <h1 style={{ color: T.text, fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>Vendas</h1>
        <p style={{ color: T.muted, fontSize: 13.5, margin: 0 }}>
          {inteiro(resumo.total.units)} unidades, {brl(resumo.total.vgv)} de VGV.
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

        {/* O MASTERPLAN MORA AQUI AGORA. Abre a mesma tela que a aba Produtos abria, em tela
            cheia, com a sessão conferida do outro lado. */}
        {comMapa.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
            {comMapa.map((emp) => (
              <button
                key={emp.id}
                onClick={() => setMapa(emp)}
                style={{
                  alignItems: "center",
                  background: T.btnBg,
                  border: "none",
                  borderRadius: 10,
                  color: T.btnFg,
                  cursor: "pointer",
                  display: "inline-flex",
                  fontFamily: fonte,
                  fontSize: 13,
                  fontWeight: 600,
                  gap: 7,
                  padding: "9px 14px",
                }}
                type="button"
              >
                <MapaIcone aria-hidden="true" size={15} />
                {comMapa.length === 1 ? "Ver o mapa das unidades" : `Mapa: ${emp.nome}`}
              </button>
            ))}
          </div>
        ) : null}
      </header>

      {/* ── AS DUAS VISÕES: Resumo (números) e Pipeline (o kanban do Apolo) ──── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <Pilula
          ativo={visao === "resumo"}
          onClick={() => setVisao("resumo")}
          rotulo="Resumo"
        />
        <Pilula
          ativo={visao === "pipeline"}
          onClick={() => setVisao("pipeline")}
          rotulo="Pipeline"
        />
        <Pilula
          ativo={visao === "contratos"}
          onClick={() => setVisao("contratos")}
          rotulo="Contratos"
        />
        <Pilula
          ativo={visao === "assinaturas"}
          onClick={() => setVisao("assinaturas")}
          rotulo="Assinaturas"
        />
      </div>

      {visao === "pipeline" ? (
        <Pipeline
          busca={busca}
          onAbrirProposta={abrirProposta}
          onBusca={setBusca}
          resumo={resumo}
          unidades={unidades}
        />
      ) : visao === "contratos" ? (
        <SecaoContratos cache={cacheDeContratos.current} emp={empSelecionado} />
      ) : visao === "assinaturas" ? (
        <SecaoAssinaturas cache={cacheDeAssinaturas.current} emp={empSelecionado} />
      ) : (
        <>
          {/* A grade do BI precisa de media query (as linhas 2 e 3 empilham abaixo de ~1100px),
              e estilo inline não responde a media query — mesma razão do TEMA_CSS. Só o LAYOUT
              mora nas classes .vnd-*; o resto da tela segue inline como o resto do portal. */}
          <style>{CSS_RESUMO}</style>

          {/* ── LINHA 1: a faixa de KPIs — tudo numa régua só, denso de propósito ─ */}
          <section style={{ ...cartao, padding: "16px 20px" }}>
            <div className="vnd-kpis">
              <Numero destaque rotulo="Vendido" valor={brl(resumo.vendido.vgv)} />
              <Numero
                rotulo="Do VGV total"
                valor={`${resumo.vendidoPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
              />
              <Numero rotulo="Unidades vendidas" valor={inteiro(resumo.vendido.units)} />
              {/* PESSOAS distintas com compra em andamento (36 nas 39 vendas do VAL) — o funil
                  vivo INTEIRO, reserva e proposta inclusas, não só o vendido: num lançamento com
                  fila de reservas este número passa o vizinho, e está certo. O apoio do tile diz
                  a régua para o leitor não somar laranja com maçã. */}
              {resumo.clientesUnicos !== undefined ? (
                <Numero
                  extra="pessoas comprando neste recorte"
                  rotulo="Clientes únicos"
                  valor={inteiro(resumo.clientesUnicos)}
                />
              ) : null}
              <Numero rotulo="VGV do empreendimento" valor={brl(resumo.total.vgv)} />
              {dados.bi ? (
                <>
                  {/* Os indicadores ficam em UNIDADES na faixa (o VGV vai na linha de apoio);
                      a alternância UN × R$ mora no gráfico, que é quem re-renderiza com ela. */}
                  <Numero
                    extra={brl(dados.bi.propostas.vgv)}
                    rotulo="Propostas"
                    valor={inteiro(dados.bi.propostas.un)}
                  />
                  <Numero
                    extra={brl(dados.bi.faturadas.vgv)}
                    rotulo="Faturadas"
                    valor={inteiro(dados.bi.faturadas.un)}
                  />
                  <Numero
                    extra={brl(dados.bi.canceladas.vgv)}
                    rotulo="Canceladas"
                    valor={inteiro(dados.bi.canceladas.un)}
                  />
                  <Numero
                    rotulo="Cancelamento"
                    valor={`${dados.bi.cancelamentoPct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
                  />
                  <Numero
                    rotulo="Proposta → venda"
                    valor={
                      dados.bi.deadlineMedioDias === null
                        ? "sem dado"
                        : `${dados.bi.deadlineMedioDias.toLocaleString("pt-BR", { maximumFractionDigits: 0 })} dias`
                    }
                  />
                </>
              ) : null}
            </div>
          </section>

          {/* ── LINHA 2: o palco — o gráfico mensal (2/3) com o ranking dando suporte (1/3) ─ */}
          {dados.bi ? (
            <div className="vnd-l2">
              <PainelGraficoBI bi={dados.bi} medida={medida} onMedida={setMedida} />
              <PainelRanking ranking={dados.bi.ranking} />
            </div>
          ) : null}

          {/* ── LINHA 3: composição do estoque + ritmo, lado a lado ──────────────── */}
          <div className="vnd-l3">
          <section style={cartao}>
            <h2 style={titulo}>Composição do estoque</h2>
            <p style={{ color: T.muted, fontSize: 12.5, margin: "6px 0 0" }}>
              Todas as unidades do recorte, do estoque livre à venda faturada.
            </p>

            {/* Barra do estoque: a composição inteira numa linha só. */}
            <div
              aria-hidden="true"
              style={{
                borderRadius: 999,
                display: "flex",
                gap: 2,
                marginTop: 18,
                overflow: "hidden",
              }}
            >
              {resumo.baldes
                .filter((balde) => balde.units > 0)
                .map((balde) => (
                  <div
                    key={balde.balde}
                    style={{
                      background: T.text,
                      flex: `${balde.units} 1 0`,
                      height: 10,
                      opacity: FORCA[balde.balde],
                    }}
                    title={`${balde.rotulo}: ${balde.units}`}
                  />
                ))}
            </div>

            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 22px", marginTop: 16 }}>
              {resumo.baldes.map((balde) => (
                <LegendaBalde balde={balde} key={balde.balde} total={resumo.total.units} />
              ))}
            </div>

            {resumo.perdas.canceladas + resumo.perdas.distratos > 0 ? (
              <p style={{ color: T.muted, fontSize: 12, lineHeight: 1.5, margin: "16px 0 0" }}>
                No histórico do empreendimento há {inteiro(resumo.perdas.canceladas)} propostas
                canceladas e {inteiro(resumo.perdas.distratos)} distratos. As unidades delas
                voltaram para o estoque e já estão contadas acima.
              </p>
            ) : null}
          </section>

      {/* ── RITMO ────────────────────────────────────────────────────────────── */}
      <section style={cartao}>
        <h2 style={titulo}>Ritmo de vendas</h2>
        <p style={{ color: T.muted, fontSize: 12.5, margin: "6px 0 18px" }}>
          Unidades vendidas por mês nos últimos doze meses.
          {ritmo.mediaMensal > 0
            ? ` Média de ${ritmo.mediaMensal.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por mês desde a primeira venda do período.`
            : ""}
        </p>

        <GraficoRitmo ritmo={ritmo} />

        {ritmo.anteriores.units > 0 ? (
          <p style={{ color: T.muted, fontSize: 12, margin: "14px 0 0" }}>
            Antes deste período: {inteiro(ritmo.anteriores.units)} unidades,{" "}
            {brl(ritmo.anteriores.vgv)}.
          </p>
        ) : null}
        {ritmo.semData > 0 ? (
          <p style={{ color: T.muted, fontSize: 12, margin: "6px 0 0" }}>
            {inteiro(ritmo.semData)} unidades vendidas não têm data de conclusão registrada e ficam
            fora do gráfico.
          </p>
        ) : null}
      </section>
          </div>

          {/* ── LINHA 4: QUEM É O COMPRADOR — o perfil agregado, no desenho do relatório do Vale
              do Ouro que o Lucas elogiou (public/bi/vale-do-ouro-*.html, seção #perfil),
              adaptado aos tokens do portal. Só baldes com contagem + percentual, nada individual.
              ⚠️ A ORDEM É PEDIDO DO DONO (18/08/2026): estoque e ritmo vêm ANTES porque são a
              leitura operacional do dia (o que tenho para vender, em que velocidade); o perfil de
              quem compra é contexto, leitura mais lenta, e por isso desceu para cá. */}
          {dados.perfilComprador && dados.perfilComprador.vendas > 0 ? (
            <SecaoPerfilComprador perfil={dados.perfilComprador} />
          ) : null}

      {/* ── LINHA 5: o Cenário Analítico (a tabela de unidades) em largura total ─ */}
      <section style={cartao}>
        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            justifyContent: "space-between",
          }}
        >
          <h2 style={titulo}>
            Cenário analítico{" "}
            <span style={{ color: T.muted, fontSize: 12, fontWeight: 500 }}>
              unidade a unidade
            </span>
          </h2>

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
              onChange={(evento) => {
                setBusca(evento.target.value);
                setVisiveis(PAGINA);
              }}
              placeholder="Quadra, lote ou comprador"
              style={{
                background: "transparent",
                border: "none",
                color: T.text,
                flex: 1,
                fontFamily: fonte,
                fontSize: 14,
                minWidth: 0,
                outline: "none",
                padding: "9px 0",
              }}
              value={busca}
            />
          </label>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "14px 0 4px" }}>
          <Pilula
            ativo={baldeAtivo === null}
            onClick={() => {
              setBaldeAtivo(null);
              setVisiveis(PAGINA);
            }}
            rotulo={`Todas (${inteiro(resumo.total.units)})`}
          />
          {resumo.baldes
            .filter((balde) => balde.units > 0)
            .map((balde) => (
              <Pilula
                ativo={baldeAtivo === balde.balde}
                key={balde.balde}
                onClick={() => {
                  setBaldeAtivo(baldeAtivo === balde.balde ? null : balde.balde);
                  setVisiveis(PAGINA);
                }}
                rotulo={`${balde.rotulo} (${inteiro(balde.units)})`}
              />
            ))}
        </div>

        <TabelaUnidades onAbrirProposta={abrirProposta} unidades={filtradas.slice(0, visiveis)} />

        {filtradas.length === 0 ? (
          <p style={{ color: T.muted, fontSize: 13, margin: "16px 0 0", textAlign: "center" }}>
            Nenhuma unidade encontrada com esse filtro.
          </p>
        ) : null}

        {filtradas.length > visiveis ? (
          <button
            onClick={() => setVisiveis((atual) => atual + PAGINA)}
            style={{
              background: "transparent",
              border: `1px solid ${T.border}`,
              borderRadius: 10,
              color: T.sub,
              cursor: "pointer",
              fontFamily: fonte,
              fontSize: 13,
              marginTop: 14,
              padding: "10px 12px",
              width: "100%",
            }}
            type="button"
          >
            Ver mais {inteiro(Math.min(PAGINA, filtradas.length - visiveis))} de{" "}
            {inteiro(filtradas.length)}
          </button>
        ) : null}
      </section>
        </>
      )}

      {/* O popup da proposta vale nas DUAS visões (kanban e tabela), por isso mora aqui fora. */}
      {propostaAberta ? (
        <ModalDaProposta
          alvo={propostaAberta}
          cache={cacheDePropostas.current}
          onFechar={() => setPropostaAberta(null)}
        />
      ) : null}
    </div>
  );
}

// ── PEÇAS ───────────────────────────────────────────────────────────────────

const cartao = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 14,
  padding: 20,
} as const;

const titulo = { color: T.text, fontSize: 15, fontWeight: 700, margin: 0 } as const;

/** "há N dias" do card do kanban (porta o formatTimeInStage interno, só a parte usada aqui). */
function tempoNaEtapa(iso: null | string): null | string {
  if (!iso) return null;
  const entao = new Date(iso).getTime();
  if (Number.isNaN(entao)) return null;

  const dias = Math.max(0, Math.floor((Date.now() - entao) / 86_400_000));
  if (dias === 0) return "há poucas horas";
  if (dias === 1) return "há 1 dia";
  if (dias < 30) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  if (meses < 12) return meses === 1 ? "há 1 mês" : `há ${meses} meses`;
  const anos = Math.floor(meses / 12);
  return anos === 1 ? "há 1 ano" : `há ${anos} anos`;
}

// ── PIPELINE: o kanban da VendasTab do Apolo, no tema do portal ──────────────
//
// Porta KanbanColumn (empreendimentos-view.tsx:1997) e VendaCard (2037), peça a peça:
//   • 5 colunas na ordem do funil (ETAPA_ORDEM sem "disponivel", como a interna);
//   • busca por unidade/comprador/imobiliária, contagem e VGV por coluna sobre o VISÍVEL;
//   • chips de Disponíveis, Bloqueadas e terminais (só contagem — decisão declarada no topo).
// O que muda de propósito: sem hover dourado (#A07C3B não é estado no portal) e Tailwind virou
// token T. O card com contrato é CLICÁVEL e abre o ModalDaProposta (a versão escopada do
// VendaPropostaModal interno) — desde que o payload traga o unitId, ver o tipo Unidade.
function Pipeline({
  busca,
  onAbrirProposta,
  onBusca,
  resumo,
  unidades,
}: {
  busca: string;
  onAbrirProposta: (unidade: Unidade) => void;
  onBusca: (valor: string) => void;
  resumo: Resumo;
  unidades: Unidade[];
}) {
  const alvo = busca.trim().toLowerCase();
  const bate = (unidade: Unidade) =>
    !alvo ||
    [unidade.unidade, unidade.bloco, unidade.lote, unidade.comprador, unidade.imobiliaria]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(alvo);

  // Bloqueada tem `etapa` "disponivel" mas balde "bloqueada": ela NÃO entra em coluna nenhuma
  // (vira chip), exatamente como a interna separa estoque travado do funil.
  const doFunil = unidades.filter((unidade) => unidade.balde !== "bloqueada");
  const disponiveis = doFunil.filter((unidade) => unidade.etapa === "disponivel");
  const bloqueadas = resumo.baldes.find((balde) => balde.balde === "bloqueada");

  return (
    <section style={cartao}>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        <h2 style={titulo}>
          Pipeline de vendas{" "}
          <span style={{ color: T.muted, fontSize: 12, fontWeight: 500 }}>
            {inteiro(resumo.total.units)} unidades · VGV {brl(resumo.total.vgv)}
          </span>
        </h2>
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
            onChange={(evento) => onBusca(evento.target.value)}
            placeholder="Unidade, comprador, imobiliária"
            style={{
              background: "transparent",
              border: "none",
              color: T.text,
              flex: 1,
              fontFamily: fonte,
              fontSize: 14,
              minWidth: 0,
              outline: "none",
              padding: "9px 0",
            }}
            value={busca}
          />
        </label>
      </div>

      {/* As 5 colunas do funil, roláveis de lado como no Apolo. */}
      <div style={{ marginTop: 14, overflowX: "auto", paddingBottom: 4 }}>
        <div style={{ display: "flex", gap: 10 }}>
          {ETAPA_ORDEM.filter((etapa) => etapa !== "disponivel").map((etapa) => (
            <ColunaDoKanban
              etapa={etapa}
              key={etapa}
              onAbrirProposta={onAbrirProposta}
              unidades={doFunil.filter(
                (unidade) => unidade.etapa === etapa && bate(unidade),
              )}
            />
          ))}
        </div>
      </div>

      {/* Estoque + perdas, cluster à parte (contagens; o detalhe é interno). */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <ChipDeEstoque rotulo="Disponíveis" valor={disponiveis.length} />
        {bloqueadas && bloqueadas.units > 0 ? (
          <ChipDeEstoque rotulo="Bloqueadas" valor={bloqueadas.units} />
        ) : null}
        {resumo.perdas.canceladas > 0 ? (
          <ChipDeEstoque alerta rotulo="Propostas canceladas" valor={resumo.perdas.canceladas} />
        ) : null}
        {resumo.perdas.distratos > 0 ? (
          <ChipDeEstoque alerta rotulo="Distratos" valor={resumo.perdas.distratos} />
        ) : null}
      </div>
    </section>
  );
}

function ColunaDoKanban({
  etapa,
  onAbrirProposta,
  unidades,
}: {
  etapa: Etapa;
  onAbrirProposta: (unidade: Unidade) => void;
  unidades: Unidade[];
}) {
  const vgv = unidades.reduce((soma, unidade) => soma + unidade.valor, 0);

  return (
    <div
      style={{
        background: T.soft,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        width: 224,
      }}
    >
      <div
        style={{
          alignItems: "center",
          borderBottom: `1px solid ${T.border}`,
          display: "flex",
          gap: 8,
          justifyContent: "space-between",
          padding: "8px 12px",
        }}
      >
        <span
          style={{
            background: T.card,
            border: `1px solid ${T.border}`,
            borderRadius: 999,
            color: T.sub,
            fontSize: 11,
            fontWeight: 600,
            padding: "2px 8px",
          }}
        >
          {ETAPA_LABELS[etapa]}
        </span>
        <span style={{ color: T.text, fontSize: 12, fontWeight: 600 }}>{unidades.length}</span>
      </div>
      <p style={{ color: T.muted, fontSize: 11, margin: 0, padding: "6px 12px 0" }}>
        VGV {brl(vgv)}
      </p>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          maxHeight: "52vh",
          overflowY: "auto",
          padding: 8,
        }}
      >
        {unidades.length === 0 ? (
          <p style={{ color: T.muted, fontSize: 11, margin: 0, padding: "24px 0", textAlign: "center" }}>
            Vazio
          </p>
        ) : (
          unidades.map((unidade, indice) => (
            <CardDoKanban
              key={`${unidade.unidade}-${indice}`}
              onAbrirProposta={onAbrirProposta}
              unidade={unidade}
            />
          ))
        )}
      </div>
    </div>
  );
}

/** A unidade tem proposta para abrir? Etapa além de "disponivel" E o unitId no payload. */
function temPropostaParaAbrir(unidade: Unidade): boolean {
  return unidade.unitId != null && unidade.etapa !== "disponivel";
}

function CardDoKanban({
  onAbrirProposta,
  unidade,
}: {
  onAbrirProposta: (unidade: Unidade) => void;
  unidade: Unidade;
}) {
  // Faturado mostra a DATA da venda; estágio ativo mostra o tempo parado (regra da interna).
  const rodape =
    unidade.etapa === "faturado"
      ? unidade.desde
        ? `faturado em ${rotuloDaData(unidade.desde)}`
        : null
      : tempoNaEtapa(unidade.desde);

  const estiloDoCard = {
    background: T.card,
    border: `1px solid ${T.border}`,
    borderRadius: 10,
    padding: "10px 10px 8px",
  } as const;

  const conteudo = (
    <>
      <div style={{ alignItems: "center", display: "flex", gap: 8, justifyContent: "space-between" }}>
        <span style={{ color: T.text, fontSize: 12, fontWeight: 700 }}>{unidade.unidade}</span>
        <span style={{ color: T.sub, fontSize: 11, fontWeight: 500 }}>{brl(unidade.valor)}</span>
      </div>
      {unidade.comprador ? (
        <p
          style={{
            color: T.text,
            fontSize: 11,
            fontWeight: 600,
            margin: "4px 0 0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {unidade.comprador}
        </p>
      ) : null}
      {unidade.imobiliaria ? (
        <p
          style={{
            color: T.muted,
            fontSize: 11,
            margin: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {unidade.imobiliaria}
        </p>
      ) : null}
      {rodape ? (
        <p style={{ color: T.muted, fontSize: 10, margin: "3px 0 0" }}>{rodape}</p>
      ) : null}
    </>
  );

  // Com proposta para abrir, o card é um BOTÃO de verdade (teclado incluso); sem, segue caixa
  // estática — nada de cursor de clique em coisa que não abre.
  if (temPropostaParaAbrir(unidade)) {
    return (
      <button
        onClick={() => onAbrirProposta(unidade)}
        style={{
          ...estiloDoCard,
          cursor: "pointer",
          display: "block",
          fontFamily: fonte,
          textAlign: "left",
          width: "100%",
        }}
        title="Ver a proposta"
        type="button"
      >
        {conteudo}
      </button>
    );
  }

  return <div style={estiloDoCard}>{conteudo}</div>;
}

function ChipDeEstoque({
  alerta,
  rotulo,
  valor,
}: {
  alerta?: boolean;
  rotulo: string;
  valor: number;
}) {
  return (
    <span
      style={{
        alignItems: "center",
        background: alerta ? T.dangerBg : T.soft,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        color: alerta ? T.danger : T.sub,
        display: "inline-flex",
        fontSize: 12,
        fontWeight: 600,
        gap: 8,
        padding: "6px 12px",
      }}
    >
      {rotulo}
      <span style={{ color: alerta ? T.danger : T.text, fontWeight: 700 }}>{inteiro(valor)}</span>
    </span>
  );
}

// ── A GRADE DO BI (visão Resumo) ─────────────────────────────────────────────
// Só o LAYOUT responsivo mora aqui: media query não alcança estilo inline (mesma razão do
// TEMA_CSS), então as linhas 2 e 3 empilham via classe. Abaixo de ~1100px o palco e a dupla
// composição × ritmo viram uma coluna só.
const CSS_RESUMO = `
  .vnd-kpis { display: grid; gap: 14px 24px; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); }
  .vnd-kpis > div { min-width: 0; }
  .vnd-l2 { align-items: stretch; display: grid; gap: 16px; grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); }
  .vnd-l3 { display: grid; gap: 16px; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .vnd-perfil { display: grid; gap: 14px; grid-template-columns: repeat(3, minmax(0, 1fr)); margin-top: 16px; }
  /* ⚠️ O GRÁFICO EMPILHA ANTES DO RESTO (1200, não 1100), e é medida, não gosto: entre 1100 e
     1200 ele dividia a linha com o ranking e o palco caía para ~480px, onde os 36 rótulos de topo
     de barra do modo R$ ficavam com 3,4px de folga entre si (o ponto mais apertado do gráfico
     inteiro). Ocupando a linha toda nessa faixa, a folga volta para ~15px. Acima de 1200 a linha
     dupla continua, com folga de 9px ou mais. */
  @media (max-width: 1200px) {
    .vnd-l2 { grid-template-columns: minmax(0, 1fr); }
  }
  @media (max-width: 1100px) {
    .vnd-l3, .vnd-perfil { grid-template-columns: minmax(0, 1fr); }
  }
`;

// PALETA DAS SÉRIES — decisão de MARCA validada com o Lucas em 18/08/2026: o portal é grafite
// com preto, então Propostas (a série de volume) usa o grafite fixo #6b7280, um meio-tom neutro
// que lê igual nos dois temas; Faturadas usa a tinta do texto (o tom mais forte, porque é a
// série que conta a história); Canceladas é a única exceção cromática, no vermelho de alerta do
// tema. Dourado não entra: dourado não é estado.
const SERIES_BI = [
  { chave: "propostas" as const, cor: "#6b7280", rotulo: "Propostas" },
  { chave: "canceladas" as const, cor: T.danger, rotulo: "Canceladas" },
  { chave: "faturadas" as const, cor: T.text, rotulo: "Faturadas" },
];

// Anatomia vertical do gráfico: ~280px de palco (240px de plotagem + rótulos dos meses), com as
// barras escalando até 204px para o rótulo de topo nunca colidir com o teto do painel.
// ⚠️ O TETO DA BARRA CAIU DE 216 PARA 204 em 18/08/2026: com o rótulo ESCALONADO em dois
// níveis (ver `elevacaoDoRotulo`), o nível de cima sobe até ~29px acima da barra mais alta, e com
// 216 esse rótulo saía pelo teto do palco.
const ALTURA_PLOT = 240;
const ALTURA_BARRA = 204;

// O respiro entre o rótulo e o topo da barra, e o salto de um nível de rótulo para o outro.
// 14 = os ~11px de altura do rótulo mais 3px de folga: menos que isso e os dois níveis se
// encostam em vez de se separarem.
const FOLGA_ATE_A_BARRA = 3;
const SALTO_DO_NIVEL = 14;

/**
 * A forma MAIS CURTA de um valor em R$: "1,2M", "378k". É o rótulo de TOPO DE BARRA no modo R$,
 * onde cada coluna tem ~15px de largura e o mês inteiro ~50px para três rótulos. O `compacto`
 * ("1,2 mi", "850 mil") continua no eixo e no tooltip, que têm espaço de sobra.
 */
const compactoCurto = (valor: number): string => {
  if (valor >= 1_000_000)
    return `${(valor / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  if (valor >= 1_000) return `${Math.round(valor / 1_000).toLocaleString("pt-BR")}k`;

  return inteiro(valor);
};

/** "1,2 mi" / "850 mil" — para o eixo e o tooltip (o valor cheio fica no tooltip). */
const compacto = (valor: number): string => {
  if (valor >= 1_000_000)
    return `${(valor / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (valor >= 1_000)
    return `${(valor / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil`;
  return inteiro(valor);
};

/**
 * Ticks do eixo Y: números redondos (família 1 · 2 · 2,5 · 5), mirando 3-4 linhas, topo ≥
 * máximo. No modo unidades os passos fracionários são descartados (meio lote não existe).
 */
function ticksDoEixo(maximo: number, inteiros: boolean): number[] {
  const alvo = Math.max(maximo, 1);
  const magnitude = 10 ** Math.floor(Math.log10(alvo));
  const passos = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5]
    // O toPrecision mata o ruído de ponto flutuante (0.1 × 100 = 10.000000000000002), que
    // derrubaria o filtro de inteiros e sujaria o rótulo do tick.
    .map((fator) => Number((fator * magnitude).toPrecision(12)))
    .filter((passo) => !inteiros || Number.isInteger(passo));

  let escolhido = passos[passos.length - 1] ?? 1;
  let melhorDistancia = Number.POSITIVE_INFINITY;
  let topoEscolhido = Number.POSITIVE_INFINITY;
  for (const passo of passos) {
    const contagem = Math.ceil(alvo / passo);
    if (contagem > 5) continue;
    const distancia = Math.abs(contagem - 3.5);
    const topoCandidato = contagem * passo;
    // Empate de distância resolve primeiro pela MENOR folga do topo (com máximo 1 os passos
    // 1, 2 e 5 empatam em contagem 1 — sem este critério o laço ficava com o 5 e a barra
    // desenhava a 1/5 da altura) e, persistindo o empate, pelo passo MAIOR (menos linhas =
    // grade mais recessiva; com máximo 10 segue escolhendo [5, 10]).
    if (
      distancia < melhorDistancia ||
      (distancia === melhorDistancia &&
        (topoCandidato < topoEscolhido ||
          (topoCandidato === topoEscolhido && passo > escolhido)))
    ) {
      melhorDistancia = distancia;
      topoEscolhido = topoCandidato;
      escolhido = passo;
    }
  }

  const contagem = Math.ceil(alvo / escolhido);
  return Array.from({ length: contagem }, (_, indice) =>
    Number(((indice + 1) * escolhido).toPrecision(12)),
  );
}

// ── LINHA 2, O PALCO: o gráfico mensal com anatomia completa ─────────────────
// Eixo Y com ticks redondos + gridlines horizontais recessivas, linha de base mais forte,
// colunas agrupadas por mês (barra ≤ 24px, topo arredondado, vão de 2px — o vão separa, nunca
// borda), rótulo de valor SELETIVO no topo, tooltip pela faixa do mês inteira e legenda junto
// do toggle UN × R$. Nada de segundo eixo, número em toda barra ou texto na cor da série.
function PainelGraficoBI({
  bi,
  medida,
  onMedida,
}: {
  bi: IndicadoresBI;
  medida: "rs" | "un";
  onMedida: (medida: "rs" | "un") => void;
}) {
  // O hover marca o MÊS: o alvo é a faixa inteira, bem maior que a barra.
  const [mesAtivo, setMesAtivo] = useState<null | number>(null);

  const meses = bi.serieMensal;
  const valorDe = (tally: TallyBI): number => (medida === "un" ? tally.un : tally.vgv);
  const maximo = Math.max(
    0,
    ...meses.flatMap((mes) => SERIES_BI.map((serie) => valorDe(mes[serie.chave]))),
  );
  const ticks = ticksDoEixo(maximo, medida === "un");
  const topo = ticks[ticks.length - 1] ?? 1;
  const formatar = (valor: number): string => (medida === "un" ? inteiro(valor) : compacto(valor));
  // O rótulo de TOPO DE BARRA usa a forma mais curta: no modo R$ ele divide ~50px de mês com
  // outros dois, e "378k" ocupa metade de "378 mil".
  const rotularValor = (valor: number): string =>
    medida === "un" ? inteiro(valor) : compactoCurto(valor);

  // ── O ESCALONAMENTO DOS RÓTULOS, EM DOIS NÍVEIS ──────────────────────────────
  // Toda barra com valor rotula (regra do dono), e no modo R$ o rótulo ("1,4M") mede ~21px numa
  // coluna cujo passo é ~15px: deitado lado a lado, vizinho invade vizinho. A saída é alternar a
  // ALTURA do rótulo, para que dois rótulos que poderiam se tocar nunca dividam a mesma linha.
  //
  // ⚠️ O NÍVEL SAI DO CONFLITO REAL, NÃO DE UMA REGRA FIXA POR SÉRIE, e cada pedaço da conta veio
  // de uma medição na tela:
  //   • fixar "Canceladas em cima, Propostas e Faturadas embaixo" resolveria só DENTRO do mês: o
  //     passo entre séries é 15,0px e o passo na FRONTEIRA entre dois meses é 16,1px, ou seja,
  //     Faturadas de agosto e Propostas de setembro ficariam no mesmo nível a 16px uma da outra;
  //   • alternar por coluna par/ímpar resolvia rótulo contra rótulo, mas deixava TRÊS rótulos
  //     escritos em cima da BARRA vizinha (o rótulo mede 21px numa coluna de 13px, então ele
  //     transborda para os lados e cai sobre a barra alta do lado).
  // Por isso o rótulo sobe até passar o topo da barra mais alta entre a dele e as duas vizinhas, e
  // só sobe MAIS um nível quando ficaria na mesma linha do rótulo imediatamente à esquerda. Com
  // barras de altura parecida isso vira o zigue-zague de dois níveis, e não acumula: o terceiro
  // rótulo já volta para o nível de baixo (a diferença para o segundo é exatamente um salto).
  const alturasDasColunas = meses.flatMap((mes) =>
    SERIES_BI.map((serie) => {
      const valor = valorDe(mes[serie.chave]);

      return valor > 0 ? Math.max((valor / topo) * ALTURA_BARRA, 2) : 0;
    }),
  );
  const niveisDosRotulos = alturasDasColunas.reduce<number[]>((niveis, altura, coluna) => {
    // Coluna sem barra não tem rótulo; o zero aqui é só para o índice continuar batendo.
    if (altura === 0) {
      niveis.push(0);

      return niveis;
    }

    const maiorPerto = Math.max(
      alturasDasColunas[coluna - 1] ?? 0,
      altura,
      alturasDasColunas[coluna + 1] ?? 0,
    );
    const nivelBase = maiorPerto + FOLGA_ATE_A_BARRA;
    // Só a coluna imediatamente à esquerda disputa espaço: a de duas casas já está a ~30px, e o
    // rótulo mais largo mede 21px.
    const daEsquerda = (alturasDasColunas[coluna - 1] ?? 0) > 0 ? niveis[coluna - 1] ?? 0 : null;
    const brigaComAEsquerda =
      daEsquerda !== null && Math.abs(nivelBase - daEsquerda) < SALTO_DO_NIVEL;

    niveis.push(brigaComAEsquerda && daEsquerda !== null ? daEsquerda + SALTO_DO_NIVEL : nivelBase);

    return niveis;
  }, []);
  /** Quanto o rótulo desta coluna sobe acima do topo da própria barra (o fio guia preenche). */
  const elevacaoDoRotulo = (coluna: number): number =>
    Math.max(
      0,
      (niveisDosRotulos[coluna] ?? 0) - (alturasDasColunas[coluna] ?? 0) - FOLGA_ATE_A_BARRA,
    );

  return (
    <section style={{ ...cartao, display: "flex", flexDirection: "column" }}>
      <div
        style={{
          alignItems: "flex-start",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        <div>
          <h2 style={titulo}>Propostas × Canceladas × Faturadas</h2>
          <p style={{ color: T.muted, fontSize: 12.5, margin: "6px 0 0" }}>
            Mês a mês, {medida === "un" ? "contadas por unidade" : "somadas em R$"}.
          </p>
        </div>
        <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "8px 14px" }}>
          {/* Legenda: bolinha da série + nome em cor de TEXTO (a identidade fica na bolinha). */}
          {SERIES_BI.map((serie) => (
            <span
              key={serie.chave}
              style={{
                alignItems: "center",
                color: T.sub,
                display: "inline-flex",
                fontSize: 11.5,
                gap: 6,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  background: serie.cor,
                  borderRadius: 999,
                  display: "inline-block",
                  height: 9,
                  width: 9,
                }}
              />
              {serie.rotulo}
            </span>
          ))}
          <div style={{ display: "flex", gap: 6 }}>
            <Pilula ativo={medida === "un"} onClick={() => onMedida("un")} rotulo="Unidades" />
            <Pilula ativo={medida === "rs"} onClick={() => onMedida("rs")} rotulo="R$" />
          </div>
        </div>
      </div>

      {meses.length === 0 ? (
        <p style={{ color: T.muted, fontSize: 13, margin: "auto 0", padding: "60px 0", textAlign: "center" }}>
          Sem movimento de propostas no período.
        </p>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            {/* Calha do eixo Y: ticks centrados nas gridlines. Tabular-nums SÓ aqui e em coluna
                de tabela — nunca nos números grandes. */}
            <div style={{ flexShrink: 0, height: ALTURA_PLOT, position: "relative", width: 46 }}>
              {ticks.map((tick) => (
                <span
                  key={tick}
                  style={{
                    bottom: (tick / topo) * ALTURA_BARRA,
                    color: T.muted,
                    fontSize: 10,
                    fontVariantNumeric: "tabular-nums",
                    position: "absolute",
                    right: 0,
                    transform: "translateY(50%)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatar(tick)}
                </span>
              ))}
            </div>

            <div style={{ flex: 1, height: ALTURA_PLOT, minWidth: 0, position: "relative" }}>
              {/* Gridlines HORIZONTAIS: 1px sólidas na cor da borda — recessivas de propósito,
                  nunca tracejadas. */}
              {ticks.map((tick) => (
                <div
                  aria-hidden="true"
                  key={tick}
                  style={{
                    background: T.border,
                    bottom: (tick / topo) * ALTURA_BARRA,
                    height: 1,
                    left: 0,
                    position: "absolute",
                    right: 0,
                  }}
                />
              ))}
              {/* A linha de base (eixo X): 1px mais forte que a grade — o chão do gráfico. */}
              <div
                aria-hidden="true"
                style={{
                  background: T.muted,
                  bottom: 0,
                  height: 1,
                  left: 0,
                  position: "absolute",
                  right: 0,
                }}
              />

              {/* As faixas de mês. */}
              <div style={{ display: "flex", inset: 0, position: "absolute" }}>
                {meses.map((mes, indice) => {
                  // Perto das bordas o tooltip ancora no lado, senão vazaria do painel.
                  const alinhamento =
                    indice <= 1 ? "esquerda" : indice >= meses.length - 2 ? "direita" : "centro";

                  return (
                    <div
                      key={mes.mes}
                      onMouseEnter={() => setMesAtivo(indice)}
                      onMouseLeave={() =>
                        setMesAtivo((atual) => (atual === indice ? null : atual))
                      }
                      style={{
                        alignItems: "flex-end",
                        background: mesAtivo === indice ? T.soft : "transparent",
                        display: "flex",
                        flex: 1,
                        // O VÃO separa as barras vizinhas (nunca borda). Subiu de 2 para 5 em
                        // 18/08/2026: com as três séries rotulando, os 3px a mais são o respiro
                        // que impede o rótulo de uma barra de encostar no da vizinha.
                        gap: 5,
                        justifyContent: "center",
                        minWidth: 0,
                        padding: "0 3px",
                        position: "relative",
                      }}
                    >
                      {SERIES_BI.map((serie, indiceDaSerie) => {
                        const valor = valorDe(mes[serie.chave]);
                        // ⚠️ TODA BARRA COM VALOR ROTULA. Decisão do dono em 18/08/2026: *"ainda
                        // tem barra sem indicador"*. A regra anterior era SELETIVA (Faturadas
                        // sempre, das outras só a maior do mês) e deixava muda a barra cinza de
                        // propostas e quase toda barra vermelha de canceladas. Não voltar atrás:
                        // se dois rótulos brigarem por espaço, o conserto é no FORMATO, no VÃO e
                        // na ALTURA do rótulo, nunca em esconder número.
                        //
                        // O que a regra seletiva evitava, resolvido de outro jeito: rótulo
                        // deitado em 10px, o formato mais curto que existe no modo R$
                        // (`compactoCurto`: "378k", "1,2M", metade da largura de "850 mil"), vão
                        // de 5px entre as séries e o ESCALONAMENTO em dois níveis
                        // (`elevacaoDoRotulo`). Barra zerada continua sem desenhar e sem rotular.
                        const coluna = indice * SERIES_BI.length + indiceDaSerie;
                        const elevacao = valor > 0 ? elevacaoDoRotulo(coluna) : 0;

                        return (
                          <div
                            key={serie.chave}
                            style={{
                              alignItems: "center",
                              display: "flex",
                              flex: "1 1 0",
                              flexDirection: "column",
                              justifyContent: "flex-end",
                              maxWidth: 24, // teto de largura da barra
                              minWidth: 0,
                            }}
                          >
                            {valor > 0 ? (
                              // Rótulo DEITADO e em cor de TEXTO, nunca na cor da série: a
                              // identidade da série já está na barra embaixo dele.
                              <span
                                style={{
                                  color: serie.chave === "faturadas" ? T.text : T.muted,
                                  fontSize: 10,
                                  fontWeight: 600,
                                  lineHeight: 1.1,
                                  marginBottom: FOLGA_ATE_A_BARRA,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {rotularValor(valor)}
                              </span>
                            ) : null}
                            {/* O FIO GUIA do nível de cima: 1px discreto que liga o rótulo
                                elevado à barra dele. É ele que ocupa a elevação (a coluna é um
                                flex vertical ancorado embaixo), então some sozinho no nível de
                                baixo, onde a elevação é zero. */}
                            {elevacao > 0 ? (
                              <span
                                aria-hidden="true"
                                style={{
                                  background: T.muted,
                                  flexShrink: 0,
                                  height: elevacao,
                                  opacity: 0.35,
                                  width: 1,
                                }}
                              />
                            ) : null}
                            {/* Valor ZERO não desenha marca — nada de altura mínima inventada. */}
                            {valor > 0 ? (
                              <div
                                style={{
                                  background: serie.cor,
                                  borderRadius: "4px 4px 0 0", // topo arredondado, base reta
                                  height: Math.max((valor / topo) * ALTURA_BARRA, 2),
                                  width: "100%",
                                }}
                              />
                            ) : null}
                          </div>
                        );
                      })}

                      {mesAtivo === indice ? (
                        <TooltipDoMes alinhamento={alinhamento} medida={medida} mes={mes} />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Rótulos dos meses, espelhando as faixas (mesmo flex, mesma calha). */}
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            <div aria-hidden="true" style={{ flexShrink: 0, width: 46 }} />
            <div style={{ display: "flex", flex: 1, minWidth: 0 }}>
              {meses.map((mes) => {
                // Mês sem dado NENHUM continua no eixo — só esmaece (sumir do eixo leria
                // como mês inexistente, não como mês parado).
                const vazio = SERIES_BI.every((serie) => valorDe(mes[serie.chave]) === 0);

                return (
                  <div
                    key={mes.mes}
                    style={{
                      color: T.muted,
                      flex: 1,
                      fontSize: 10.5,
                      minWidth: 0,
                      opacity: vazio ? 0.45 : 1,
                      overflow: "hidden",
                      padding: "0 3px",
                      textAlign: "center",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {rotuloDoMes(mes.mes)}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {bi.parcial ? (
        <p style={{ color: T.muted, fontSize: 12, margin: "12px 0 0" }}>
          O histórico deste recorte é muito grande e a leitura foi limitada: os números desta
          seção podem estar incompletos.
        </p>
      ) : null}
    </section>
  );
}

/** Tooltip da faixa do mês: o mês + as três séries, bolinha da cor e valor CHEIO. */
function TooltipDoMes({
  alinhamento,
  medida,
  mes,
}: {
  alinhamento: "centro" | "direita" | "esquerda";
  medida: "rs" | "un";
  mes: MesBI;
}) {
  const posicao: CSSProperties =
    alinhamento === "esquerda"
      ? { left: 0 }
      : alinhamento === "direita"
        ? { right: 0 }
        : { left: "50%", transform: "translateX(-50%)" };

  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 10,
        boxShadow: T.sombra,
        fontSize: 11.5,
        minWidth: 150,
        padding: "8px 10px",
        pointerEvents: "none",
        position: "absolute",
        top: 0,
        whiteSpace: "nowrap",
        zIndex: 5,
        ...posicao,
      }}
    >
      <div style={{ color: T.text, fontWeight: 700, marginBottom: 4 }}>{rotuloDoMes(mes.mes)}</div>
      {SERIES_BI.map((serie) => (
        <div
          key={serie.chave}
          style={{ alignItems: "center", color: T.sub, display: "flex", gap: 6, padding: "1px 0" }}
        >
          <span
            aria-hidden="true"
            style={{
              background: serie.cor,
              borderRadius: 999,
              display: "inline-block",
              flexShrink: 0,
              height: 8,
              width: 8,
            }}
          />
          <span style={{ marginRight: 8 }}>{serie.rotulo}</span>
          {/* Valor em cor de texto, nunca na cor da série. */}
          <span style={{ color: T.text, fontWeight: 600, marginLeft: "auto" }}>
            {medida === "un" ? inteiro(mes[serie.chave].un) : brl(mes[serie.chave].vgv)}
          </span>
        </div>
      ))}
    </div>
  );
}

/** O painel de suporte do palco: o "Ranking de Imobiliária" do BI, na mesma altura do gráfico. */
function PainelRanking({
  ranking,
}: {
  ranking: { nome: string; unidades: number; vgv: number }[];
}) {
  return (
    <section style={{ ...cartao, display: "flex", flexDirection: "column" }}>
      <h2 style={titulo}>Imobiliárias por unidades vendidas</h2>
      <p style={{ color: T.muted, fontSize: 12.5, margin: "6px 0 0" }}>
        Quem está vendendo o empreendimento.
      </p>

      {ranking.length === 0 ? (
        <p style={{ color: T.muted, fontSize: 13, margin: "auto 0", padding: "40px 0", textAlign: "center" }}>
          Nenhuma venda por imobiliária neste recorte.
        </p>
      ) : (
        // A lista rola por dentro: o painel acompanha a altura do gráfico ao lado (grid
        // stretch) e, empilhado no celular, o maxHeight segura rankings compridos.
        <div style={{ flex: 1, marginTop: 10, maxHeight: 360, minHeight: 0, overflowY: "auto" }}>
          {ranking.map((linha, indice) => (
            <div
              key={linha.nome}
              style={{
                alignItems: "center",
                borderBottom:
                  indice === ranking.length - 1 ? "none" : `1px solid ${T.border}`,
                display: "flex",
                gap: 10,
                padding: "9px 0",
              }}
            >
              <span
                style={{ color: T.muted, flexShrink: 0, fontSize: 11, fontWeight: 600, width: 22 }}
              >
                {indice + 1}º
              </span>
              <span
                style={{
                  color: T.text,
                  flex: 1,
                  fontSize: 12.5,
                  fontWeight: 600,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {linha.nome}
              </span>
              {/* Colunas de número alinhadas: tabular-nums é permitido AQUI (coluna de tabela). */}
              <span
                style={{
                  color: T.text,
                  flexShrink: 0,
                  fontSize: 13,
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 700,
                }}
              >
                {inteiro(linha.unidades)}
              </span>
              <span
                style={{
                  color: T.muted,
                  flexShrink: 0,
                  fontSize: 11,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {brl(linha.vgv)}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Um tile de KPI da faixa (linha 1 da grade): rótulo pequeno em caixa alta + número grande +
 * linha de apoio opcional (o VGV do indicador).
 * ⚠️ SEM tabular-nums no número grande, de propósito: tabular é para coluna de tabela e eixo.
 */
function Numero({
  destaque,
  extra,
  rotulo,
  valor,
}: {
  destaque?: boolean;
  extra?: string;
  rotulo: string;
  valor: string;
}) {
  return (
    <div>
      <div
        style={{
          color: T.muted,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}
      >
        {rotulo}
      </div>
      <div
        style={{
          color: T.text,
          fontSize: destaque ? 25 : 20,
          fontWeight: destaque ? 700 : 600,
          lineHeight: 1.2,
          marginTop: 4,
        }}
      >
        {valor}
      </div>
      {extra ? <div style={{ color: T.muted, fontSize: 11, marginTop: 2 }}>{extra}</div> : null}
    </div>
  );
}

function LegendaBalde({ balde, total }: { balde: BaldeResumo; total: number }) {
  const parte = total > 0 ? (balde.units / total) * 100 : 0;

  return (
    <div style={{ minWidth: 132 }}>
      <div style={{ alignItems: "center", display: "flex", gap: 7 }}>
        <span
          aria-hidden="true"
          style={{
            background: T.text,
            borderRadius: 3,
            display: "inline-block",
            height: 10,
            opacity: FORCA[balde.balde],
            width: 10,
          }}
        />
        <span style={{ color: T.sub, fontSize: 12.5, fontWeight: 600 }}>{balde.rotulo}</span>
      </div>
      <div style={{ color: T.text, fontSize: 16, fontWeight: 600, marginTop: 3 }}>
        {inteiro(balde.units)}
        <span style={{ color: T.muted, fontSize: 11.5, fontWeight: 500, marginLeft: 6 }}>
          {parte.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%
        </span>
      </div>
      <div style={{ color: T.muted, fontSize: 11.5 }}>{brl(balde.vgv)}</div>
      {balde.etapas.length > 1 ? (
        // Só abre o detalhe quando há mais de uma etapa dentro do balde: com uma só, o rótulo do
        // balde já diz tudo e a linha extra vira ruído.
        <div style={{ color: T.muted, fontSize: 11, lineHeight: 1.5, marginTop: 3 }}>
          {balde.etapas.map((etapa) => `${etapa.rotulo}: ${etapa.units}`).join(", ")}
        </div>
      ) : null}
    </div>
  );
}

function GraficoRitmo({ ritmo }: { ritmo: Ritmo }) {
  const topo = Math.max(...ritmo.meses.map((mes) => mes.units), 1);

  return (
    <div style={{ display: "flex", gap: 6, height: 140 }}>
      {ritmo.meses.map((mes) => {
        // Rótulo em TODA barra com venda, pedido do Lucas (18/08/2026): "colocar o valor no
        // top da barra, aqui só veio em um". Série única com 12 pontos aguenta rotular tudo
        // sem virar poluição (o gráfico de 3 séries ao lado é que seleciona). Mês zerado não
        // rotula: o traço esmaecido já diz "sem venda".
        const rotular = mes.units > 0;

        return (
        <div
          key={mes.mes}
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            justifyContent: "flex-end",
            minWidth: 0,
          }}
          title={`${rotuloDoMes(mes.mes)}: ${inteiro(mes.units)} unidades, ${brl(mes.vgv)}`}
        >
          {rotular ? (
            // Rótulo em cor de TEXTO, nunca na cor da série.
            <div
              style={{
                color: T.text,
                fontSize: 11,
                fontWeight: 600,
                marginBottom: 4,
                textAlign: "center",
              }}
            >
              {inteiro(mes.units)}
            </div>
          ) : null}
          <div
            style={{
              background: T.text,
              borderRadius: "5px 5px 0 0",
              // Mês sem venda mantém um traço fino: barra de altura zero some e o eixo fica
              // com buraco, que se lê como mês inexistente em vez de mês sem venda.
              height: `${Math.max((mes.units / topo) * 96, 2)}px`,
              opacity: mes.units > 0 ? 0.85 : 0.16,
            }}
          />
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
        );
      })}
    </div>
  );
}

function TabelaUnidades({
  onAbrirProposta,
  unidades,
}: {
  onAbrirProposta: (unidade: Unidade) => void;
  unidades: Unidade[];
}) {
  if (unidades.length === 0) return null;

  return (
    // A tabela rola SOZINHA no celular: sem isto, a página inteira ganha rolagem horizontal.
    <div style={{ marginTop: 12, overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 640, width: "100%" }}>
        <thead>
          <tr>
            {["Unidade", "Situação", "Desde", "Valor", "Comprador", "Imobiliária"].map((coluna) => (
              <th
                key={coluna}
                style={{
                  borderBottom: `1px solid ${T.border}`,
                  color: T.muted,
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  padding: "8px 10px 8px 0",
                  textAlign: coluna === "Valor" ? "right" : "left",
                  textTransform: "uppercase",
                  whiteSpace: "nowrap",
                }}
              >
                {coluna}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {unidades.map((unidade, indice) => {
            const rotulo =
              [unidade.bloco, unidade.lote].filter(Boolean).join(" ") || unidade.unidade;
            const clicavel = temPropostaParaAbrir(unidade);

            return (
            <tr
              key={`${unidade.unidade}-${indice}`}
              // A linha inteira aceita o clique (alvo generoso); o BOTÃO no código da unidade é
              // quem dá o acesso por teclado e a pista visual.
              onClick={clicavel ? () => onAbrirProposta(unidade) : undefined}
              style={clicavel ? { cursor: "pointer" } : undefined}
              title={clicavel ? "Ver a proposta" : undefined}
            >
              <td style={{ ...celula, color: T.text, fontWeight: 600, whiteSpace: "nowrap" }}>
                {clicavel ? (
                  <button
                    onClick={(evento) => {
                      // O clique da linha já abre; sem o stop, o mesmo abrir rodaria duas vezes.
                      evento.stopPropagation();
                      onAbrirProposta(unidade);
                    }}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "inherit",
                      cursor: "pointer",
                      font: "inherit",
                      fontWeight: 600,
                      padding: 0,
                      textDecorationLine: "underline",
                      textDecorationStyle: "dotted",
                      textUnderlineOffset: 3,
                    }}
                    type="button"
                  >
                    {rotulo}
                  </button>
                ) : (
                  rotulo
                )}
              </td>
              <td style={{ ...celula, whiteSpace: "nowrap" }}>
                <span style={{ alignItems: "center", display: "inline-flex", gap: 7 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      background: T.text,
                      borderRadius: 3,
                      display: "inline-block",
                      height: 8,
                      opacity: FORCA[unidade.balde],
                      width: 8,
                    }}
                  />
                  {unidade.situacao}
                </span>
              </td>
              <td style={{ ...celula, whiteSpace: "nowrap" }}>{rotuloDaData(unidade.desde)}</td>
              {/* Coluna de número em tabela: aqui SIM tabular-nums, para as casas alinharem. */}
              <td
                style={{
                  ...celula,
                  color: T.text,
                  fontVariantNumeric: "tabular-nums",
                  textAlign: "right",
                  whiteSpace: "nowrap",
                }}
              >
                {brl(unidade.valor)}
              </td>
              <td style={celula}>{unidade.comprador ?? ""}</td>
              <td style={celula}>{unidade.imobiliaria ?? ""}</td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const celula = {
  borderBottom: `1px solid ${T.border}`,
  color: T.sub,
  padding: "10px 10px 10px 0",
} as const;

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

// ── QUEM É O COMPRADOR (o desenho do relatório do Vale do Ouro) ─────────────
// Porta a seção #perfil de public/bi/vale-do-ouro-*.html peça a peça: card Sexo com a barra
// bipartida + Idade, card Estado civil + Renda familiar, card Profissões + Onde mora. O que muda
// de propósito: paleta ouro/terra virou grafite com preto (token T; dourado não é estado) e as
// classes .split/.kv/.mini-lb viraram componentes com estilo inline, como o resto do portal.
// Números no padrão do relatório: contagem em negrito, percentual esmaecido.

function SecaoPerfilComprador({ perfil }: { perfil: PerfilComprador }) {
  return (
    <section style={cartao}>
      <h2 style={titulo}>
        Quem é o comprador{" "}
        <span style={{ color: T.muted, fontSize: 12, fontWeight: 500 }}>
          perfil agregado, sem dado individual
        </span>
      </h2>
      <p style={{ color: T.muted, fontSize: 12.5, margin: "6px 0 0" }}>
        O retrato de quem está comprando, somado sobre {inteiro(perfil.vendas)}{" "}
        {perfil.vendas === 1 ? "venda" : "vendas"} em andamento e concluídas.
      </p>

      <div className="vnd-perfil">
        <CartaoDoPerfil>
          <MiniRotulo texto="Sexo" />
          <BarraDeSexo fatias={perfil.sexo} />
          <MiniRotulo espacoAcima texto="Idade" />
          {perfil.idades.map((fatia) => (
            <LinhaDoPerfil fatia={fatia} key={fatia.rotulo} />
          ))}
        </CartaoDoPerfil>

        <CartaoDoPerfil>
          <MiniRotulo texto="Estado civil" />
          {perfil.estadoCivil.slice(0, 4).map((fatia) => (
            <LinhaDoPerfil fatia={fatia} key={fatia.rotulo} />
          ))}
          <MiniRotulo espacoAcima texto="Renda familiar" />
          {perfil.rendaFamiliar.slice(0, 5).map((fatia) => (
            <LinhaDoPerfil fatia={fatia} key={fatia.rotulo} />
          ))}
        </CartaoDoPerfil>

        <CartaoDoPerfil>
          <MiniRotulo texto="Profissões mais comuns" />
          {perfil.profissoes.slice(0, 6).map((fatia) => (
            <LinhaDoPerfil fatia={fatia} key={fatia.rotulo} />
          ))}
          <MiniRotulo espacoAcima texto="Onde mora" />
          {perfil.cidades.length === 0 ? (
            <p style={{ color: T.muted, fontSize: 12.5, margin: 0 }}>
              Os cadastros deste recorte ainda não têm endereço informado.
            </p>
          ) : (
            perfil.cidades.slice(0, 5).map((fatia) => (
              <LinhaDoPerfil fatia={fatia} key={fatia.rotulo} />
            ))
          )}
        </CartaoDoPerfil>
      </div>
    </section>
  );
}

function CartaoDoPerfil({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        background: T.soft,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        minWidth: 0,
        padding: "14px 16px",
      }}
    >
      {children}
    </div>
  );
}

/** O rótulo de bloco do relatório (o .mini-lb): caixa alta pequena, espaçada. */
function MiniRotulo({ espacoAcima, texto }: { espacoAcima?: boolean; texto: string }) {
  return (
    <div
      style={{
        color: T.muted,
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: "0.11em",
        marginBottom: 8,
        marginTop: espacoAcima ? 18 : 0,
        textTransform: "uppercase",
      }}
    >
      {texto}
    </div>
  );
}

/** Uma linha do perfil: rótulo à esquerda; contagem em NEGRITO + percentual esmaecido à direita. */
function LinhaDoPerfil({ fatia }: { fatia: FatiaDoPerfil }) {
  return (
    <div
      style={{
        alignItems: "baseline",
        borderBottom: `1px solid ${T.border}`,
        display: "flex",
        fontSize: 13,
        gap: 10,
        justifyContent: "space-between",
        padding: "4.5px 0",
      }}
    >
      <span
        style={{
          color: T.sub,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {fatia.rotulo}
      </span>
      {/* Coluna de números do relatório: tabular-nums é permitido aqui. */}
      <span
        style={{
          color: T.muted,
          flexShrink: 0,
          fontSize: 12.5,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        <b style={{ color: T.text }}>{inteiro(fatia.quantidade)}</b> · {pct1(fatia.percentual)}%
      </span>
    </div>
  );
}

/**
 * A barra bipartida do relatório (o .split): homens de um lado, mulheres do outro, o percentual
 * escrito dentro. Grafite com preto no lugar do ouro/terra: o lado maior usa a tinta do texto, o
 * outro o meio-tom. Quem não é masculino/feminino (ou não informou) sai como linha abaixo; sem os
 * dois lados apurados, a barra nem desenha e a lista comum assume.
 */
function BarraDeSexo({ fatias }: { fatias: FatiaDoPerfil[] }) {
  const masculino = fatias.find((fatia) => /^masc/i.test(fatia.rotulo));
  const feminino = fatias.find((fatia) => /^fem/i.test(fatia.rotulo));
  const demais = fatias.filter((fatia) => fatia !== masculino && fatia !== feminino);

  const m = masculino?.quantidade ?? 0;
  const f = feminino?.quantidade ?? 0;

  if (m === 0 || f === 0) {
    // Um lado só (ou nenhum): barra bipartida de um pedaço não informa — vira lista.
    return (
      <>
        {fatias.map((fatia) => (
          <LinhaDoPerfil fatia={fatia} key={fatia.rotulo} />
        ))}
      </>
    );
  }

  // O percentual da BARRA é sobre m+f (como no relatório): a barra responde "entre homens e
  // mulheres, quanto é cada um"; o "Não informado" segue como linha, com o percentual geral.
  const pctM = Math.round((m / (m + f)) * 100);

  const lado = (pctLado: number, forte: boolean): CSSProperties => ({
    alignItems: "center",
    background: forte ? T.text : T.muted,
    color: T.card,
    display: "flex",
    fontSize: 11.5,
    fontWeight: 700,
    justifyContent: "center",
    overflow: "hidden",
    whiteSpace: "nowrap",
    width: `${pctLado}%`,
  });

  return (
    <>
      <div
        style={{
          borderRadius: 8,
          display: "flex",
          height: 26,
          marginBottom: 4,
          overflow: "hidden",
        }}
      >
        <div style={lado(pctM, m >= f)}>{pctM}% homens</div>
        <div style={lado(100 - pctM, f > m)}>{100 - pctM}% mulheres</div>
      </div>
      {demais.map((fatia) => (
        <LinhaDoPerfil fatia={fatia} key={fatia.rotulo} />
      ))}
    </>
  );
}

// ── O MODAL DA PROPOSTA (porta o padrão do ModalDeParcelas da TelaCarteira) ──
// Mesmo esqueleto: overlay com botão-fundo (clique fora fecha), Esc fecha, cartão com cabeçalho
// unidade + comprador + imobiliária, corpo rolável. A fonte é /api/incorporador/vendas/proposta
// (escopada com `unidadeNoEscopo`); o cache por unitId vive na TelaVendas — reabrir não refaz a
// chamada, e erro não entra no cache para a próxima tentativa poder funcionar.

type EstadoDaProposta =
  | { proposta: null | Proposta; tipo: "pronta" }
  | { tipo: "carregando" }
  | { mensagem: string; tipo: "erro" };

function ModalDaProposta({
  alvo,
  cache,
  onFechar,
}: {
  alvo: AlvoDaProposta;
  cache: Map<number, Proposta | null>;
  onFechar: () => void;
}) {
  const [estado, setEstado] = useState<EstadoDaProposta>({ tipo: "carregando" });

  useEffect(() => {
    // Cache primeiro: proposta já lida (inclusive a resposta "sem proposta") não busca de novo.
    const guardada = cache.get(alvo.unitId);
    if (guardada !== undefined) {
      setEstado({ proposta: guardada, tipo: "pronta" });
      return;
    }

    let ativo = true;

    async function carregar() {
      try {
        const resposta = await fetch(
          `/api/incorporador/vendas/proposta?unitId=${encodeURIComponent(alvo.unitId)}`,
          { cache: "no-store" },
        );
        const corpo = (await resposta.json().catch(() => null)) as
          | { data?: null | Proposta; error?: string }
          | null;

        if (!resposta.ok || corpo?.data === undefined) {
          throw new Error(corpo?.error ?? "Não foi possível carregar a proposta.");
        }

        cache.set(alvo.unitId, corpo.data);
        if (ativo) setEstado({ proposta: corpo.data, tipo: "pronta" });
      } catch (falha) {
        if (ativo) {
          setEstado({
            mensagem:
              falha instanceof Error ? falha.message : "Não foi possível carregar a proposta.",
            tipo: "erro",
          });
        }
      }
    }

    setEstado({ tipo: "carregando" });
    void carregar();
    return () => {
      ativo = false;
    };
  }, [alvo.unitId, cache]);

  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") onFechar();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  const proposta = estado.tipo === "pronta" ? estado.proposta : null;
  // A imobiliária pode vir da linha clicada OU do payload (revenda antiga sem vínculo na tela).
  const imobiliaria = alvo.imobiliaria ?? proposta?.imobiliaria ?? null;
  const sublinha = [alvo.comprador, imobiliaria].filter(Boolean).join(" · ");

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
          maxWidth: 560,
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
              <ReceiptText aria-hidden="true" size={16} style={{ color: T.sub }} />
              Proposta · {alvo.rotulo}
            </p>
            {sublinha ? (
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
                {sublinha}
              </p>
            ) : null}
          </div>
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
              flexShrink: 0,
              height: 32,
              justifyContent: "center",
              width: 32,
            }}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </header>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {estado.tipo === "erro" ? (
            <p
              style={{
                color: T.danger,
                fontSize: 13,
                fontWeight: 600,
                margin: 0,
                padding: 24,
                textAlign: "center",
              }}
            >
              {estado.mensagem}
            </p>
          ) : estado.tipo === "carregando" ? (
            <p style={{ color: T.muted, fontSize: 13, margin: 0, padding: 24, textAlign: "center" }}>
              Carregando a proposta…
            </p>
          ) : proposta === null ? (
            <p style={{ color: T.muted, fontSize: 13, margin: 0, padding: 24, textAlign: "center" }}>
              Esta unidade não tem uma proposta registrada.
            </p>
          ) : (
            <CorpoDaProposta proposta={proposta} />
          )}
        </div>
      </div>
    </div>
  );
}

function CorpoDaProposta({ proposta }: { proposta: Proposta }) {
  const { desconto, entrada, faturadoEm, financiamento, previsao, valorNegociado, valorTabela } =
    proposta;
  const totalDeParcelas = entrada.parcelas.length;
  // "previsto" = o plano comercial do contrato, antes de qualquer parcela emitida. Pedido do
  // Lucas (18/08/2026): a proposta existe desde a etapa "Proposta emitida", e o popup dizia
  // "a definir" em tudo — o plano já conta a entrada e o prazo.
  const previsto = previsao !== null;

  return (
    <>
      {/* ── DESCONTO: tabela × negociado, a régua do popup ───────────────────── */}
      <div
        style={{
          borderBottom: `1px solid ${T.border}`,
          display: "grid",
          gap: 8,
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          padding: "12px 20px",
        }}
      >
        <FatoDoModal rotulo="Valor de tabela" valor={brlExato(valorTabela)} />
        <FatoDoModal
          rotulo={previsto ? "Negociado (previsto)" : "Valor negociado"}
          valor={
            valorNegociado !== null
              ? brlExato(valorNegociado)
              : previsao?.negociado != null
                ? brlExato(previsao.negociado)
                : "a definir"
          }
        />
        <FatoDoModal
          rotulo={previsto ? "Desconto (previsto)" : "Desconto"}
          valor={(() => {
            const d = desconto ?? previsao?.desconto ?? null;
            return d === null ? "a definir" : d > 0 ? brlExato(d) : "Sem desconto";
          })()}
        />
      </div>
      {valorNegociado === null ? (
        <p
          style={{
            borderBottom: `1px solid ${T.border}`,
            color: T.muted,
            fontSize: 12,
            lineHeight: 1.5,
            margin: 0,
            padding: "10px 20px",
          }}
        >
          {previsto
            ? "As parcelas ainda não foram emitidas: os valores acima e a entrada abaixo são o PREVISTO pelo plano comercial do contrato, e viram definitivos na emissão."
            : "As parcelas do financiamento desta venda ainda não foram emitidas: o valor negociado e o desconto aparecem aqui assim que elas forem geradas."}
        </p>
      ) : null}

      {/* ── ENTRADA: total, percentual e o parcelamento com o que já foi pago ── */}
      <div style={{ borderBottom: `1px solid ${T.border}`, padding: "14px 20px" }}>
        <MiniRotulo texto={previsto ? "Entrada (prevista pelo plano)" : "Entrada"} />
        <p style={{ color: T.text, fontSize: 15, fontWeight: 700, margin: 0 }}>
          {brlExato(previsto && previsao ? previsao.entradaTotal : entrada.total)}
          {(previsto && previsao ? previsao.entradaPercentual : entrada.percentual) !== null ? (
            <span style={{ color: T.muted, fontSize: 12, fontWeight: 500, marginLeft: 8 }}>
              {pct1((previsto && previsao ? previsao.entradaPercentual : entrada.percentual) ?? 0)}%
              do valor da venda
            </span>
          ) : null}
        </p>

        {totalDeParcelas === 0 ? (
          <p style={{ color: T.muted, fontSize: 12.5, margin: "8px 0 0" }}>
            {previsto
              ? "O parcelamento da entrada aparece aqui quando as parcelas forem emitidas."
              : "Sem parcelas de entrada registradas."}
          </p>
        ) : (
          <div style={{ marginTop: 8 }}>
            {entrada.parcelas.map((parcela) => (
              <div
                key={parcela.n}
                style={{
                  alignItems: "center",
                  borderBottom:
                    parcela.n === totalDeParcelas ? "none" : `1px solid ${T.border}`,
                  display: "flex",
                  fontSize: 13,
                  gap: 10,
                  justifyContent: "space-between",
                  padding: "6px 0",
                }}
              >
                <span style={{ color: T.sub, whiteSpace: "nowrap" }}>
                  Parcela {parcela.n} de {totalDeParcelas}
                </span>
                <span
                  style={{
                    alignItems: "center",
                    display: "inline-flex",
                    flexShrink: 0,
                    gap: 8,
                  }}
                >
                  {parcela.vencimento ? (
                    <span style={{ color: T.muted, fontSize: 12 }}>
                      vence em {rotuloDeYmd(parcela.vencimento)}
                    </span>
                  ) : null}
                  {/* Valor em coluna: tabular-nums para as casas alinharem. */}
                  <span
                    style={{
                      color: T.text,
                      fontVariantNumeric: "tabular-nums",
                      fontWeight: 600,
                    }}
                  >
                    {brlExato(parcela.valor)}
                  </span>
                  <span
                    style={{
                      background: parcela.paga ? T.okBg : T.soft,
                      border: `1px solid ${T.border}`,
                      borderRadius: 999,
                      color: parcela.paga ? T.ok : T.muted,
                      fontSize: 10.5,
                      fontWeight: 700,
                      padding: "2px 8px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {parcela.paga ? "Paga" : "Em aberto"}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── FINANCIAMENTO: o tempo da venda ──────────────────────────────────── */}
      <div style={{ padding: "14px 20px" }}>
        <MiniRotulo texto="Financiamento" />
        {financiamento.parcelas === null ? (
          <p style={{ color: T.muted, fontSize: 12.5, margin: 0 }}>
            Sem financiamento registrado para esta venda.
          </p>
        ) : (
          <>
            <p style={{ color: T.text, fontSize: 15, fontWeight: 700, margin: 0 }}>
              {financiamento.valorParcela !== null
                ? `${inteiro(financiamento.parcelas)}x de ${brlExato(financiamento.valorParcela)}`
                : `Previsto em ${inteiro(financiamento.parcelas)} parcelas mensais`}
            </p>
            {financiamento.primeiroVencimento ? (
              <p style={{ color: T.muted, fontSize: 12.5, margin: "4px 0 0" }}>
                Primeira parcela em {rotuloDeYmd(financiamento.primeiroVencimento)}.
              </p>
            ) : financiamento.valorParcela === null ? (
              <p style={{ color: T.muted, fontSize: 12.5, margin: "4px 0 0" }}>
                O valor de cada parcela aparece quando o financiamento for emitido.
              </p>
            ) : null}
          </>
        )}

        {faturadoEm ? (
          <p style={{ color: T.muted, fontSize: 12, margin: "12px 0 0" }}>
            Venda faturada em {rotuloDeYmd(faturadoEm)}.
          </p>
        ) : null}
      </div>
    </>
  );
}

/** Um fato do topo do modal, no padrão do MiniFato da carteira: rótulo pequeno + valor forte. */
function FatoDoModal({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          color: T.muted,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        }}
      >
        {rotulo}
      </div>
      <div
        style={{
          color: T.text,
          fontSize: 14,
          fontWeight: 700,
          marginTop: 2,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {valor}
      </div>
    </div>
  );
}

// ── CONTRATOS E ASSINATURAS: as visões com fetch próprio ─────────────────────
//
// O QUE FICOU DE FORA, declarado: ordenação clicável nas tabelas novas (a ordem já vem decidida
// do servidor: contratos do mais recente, assinantes pelo gargalo); "dias desde o envio" e o
// prazo por linha do painel interno (o payload do portal não os traz); export/CSV. O filtro de
// empreendimento é o das pílulas do topo da tela — o recorte global vale nas quatro visões.

type EstadoDeVisao<Tipo> =
  | { dados: Tipo; tipo: "pronto" }
  | { mensagem: string; tipo: "erro" }
  | { tipo: "carregando" };

/**
 * O fetch de uma visão sob demanda, no mesmo desenho do ModalDaProposta: cache primeiro (chave =
 * recorte), erro fora do cache, flag `ativo` contra setState depois do unmount. O efeito roda
 * quando a visão MONTA (a troca de visão desmonta a seção) e quando o recorte muda.
 */
function useDadosDaVisao<Tipo>(
  caminho: string,
  emp: null | string,
  cache: Map<string, Tipo>,
  mensagemDeErro: string,
): EstadoDeVisao<Tipo> {
  const [estado, setEstado] = useState<EstadoDeVisao<Tipo>>({ tipo: "carregando" });

  useEffect(() => {
    const chave = emp ?? "";
    const guardado = cache.get(chave);
    if (guardado !== undefined) {
      setEstado({ dados: guardado, tipo: "pronto" });
      return;
    }

    let ativo = true;

    async function carregar() {
      try {
        const endereco = emp ? `${caminho}?emp=${encodeURIComponent(emp)}` : caminho;
        const resposta = await fetch(endereco, { cache: "no-store" });
        const corpo = (await resposta.json().catch(() => null)) as
          | { data?: Tipo; error?: string }
          | null;

        if (!resposta.ok || corpo?.data === undefined) {
          throw new Error(corpo?.error ?? mensagemDeErro);
        }

        cache.set(chave, corpo.data);
        if (ativo) setEstado({ dados: corpo.data, tipo: "pronto" });
      } catch (falha) {
        if (ativo) {
          setEstado({
            mensagem: falha instanceof Error ? falha.message : mensagemDeErro,
            tipo: "erro",
          });
        }
      }
    }

    setEstado({ tipo: "carregando" });
    void carregar();
    return () => {
      ativo = false;
    };
  }, [cache, caminho, emp, mensagemDeErro]);

  return estado;
}

/**
 * O chip da coluna Assinatura: assinado no verde T.ok, em assinatura neutro, aguardando emissão
 * esmaecido. É a única cor de estado da tabela — e verde de "concluído" é permitido (o que não é
 * estado é o dourado).
 */
function ChipDeAssinatura({ situacao }: { situacao: SituacaoAssinatura }) {
  const tom: CSSProperties =
    situacao === "assinado"
      ? { background: T.okBg, color: T.ok }
      : situacao === "em-assinatura"
        ? { background: T.soft, color: T.sub }
        : { background: "transparent", color: T.muted, opacity: 0.75 };

  return (
    <span
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 700,
        padding: "2px 9px",
        whiteSpace: "nowrap",
        ...tom,
      }}
    >
      {SITUACAO_LABELS[situacao]}
    </span>
  );
}

/**
 * O botão da coluna Contrato — a MESMA UX do BotaoDeContrato da TelaCarteira: ícone de documento
 * que abre /api/incorporador/contrato?unitId=… em aba nova. O link leva o unitId, NUNCA o uuid: a
 * rota reconfere `unidadeNoEscopo` e resolve o documento no C2X a cada clique. Sem contrato
 * assinado, a célula é "-", igual à carteira.
 */
function BotaoDePdfDoContrato({ contrato }: { contrato: ContratoDaTela }) {
  if (!contrato.temContrato) {
    return <span style={{ color: T.muted, fontSize: 12 }}>-</span>;
  }

  return (
    <a
      href={`/api/incorporador/contrato?unitId=${encodeURIComponent(contrato.unitId)}`}
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

// ── CONTRATOS: a tabela dos contratos gerados, com a situação da assinatura ──
function SecaoContratos({
  cache,
  emp,
}: {
  cache: Map<string, DadosContratos>;
  emp: null | string;
}) {
  const estado = useDadosDaVisao(
    "/api/incorporador/vendas/contratos",
    emp,
    cache,
    "Não foi possível carregar os contratos.",
  );
  const [busca, setBusca] = useState("");
  const [situacaoAtiva, setSituacaoAtiva] = useState<null | SituacaoAssinatura>(null);

  if (estado.tipo === "carregando") return <Aviso texto="Carregando os contratos…" />;
  if (estado.tipo === "erro") return <Aviso texto={estado.mensagem} tom="erro" />;

  const { aviso, contratos, porSituacao, total } = estado.dados;
  const alvo = busca.trim().toLowerCase();

  const filtrados = contratos.filter((contrato) => {
    if (situacaoAtiva && contrato.assinatura !== situacaoAtiva) return false;
    if (!alvo) return true;

    return [contrato.unidade, contrato.bloco, contrato.lote, contrato.comprador, contrato.imobiliaria]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(alvo);
  });

  // Os chips contam o recorte INTEIRO (a rota calcula antes do teto de 500), como o título:
  // contar a lista cortada faria os números do topo divergirem entre si. O fallback local só
  // atende payload antigo em cache, e aí conta a lista exibida.
  const contagemDaSituacao = (situacao: SituacaoAssinatura): number =>
    porSituacao?.[situacao] ??
    contratos.filter((contrato) => contrato.assinatura === situacao).length;
  const situacoes: SituacaoAssinatura[] = ["assinado", "em-assinatura", "aguardando-emissao"];

  return (
    <section style={cartao}>
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          justifyContent: "space-between",
        }}
      >
        <div>
          {/* O CONTADOR do topo: o total do recorte, mesmo quando a lista bateu no teto. */}
          <h2 style={titulo}>
            {inteiro(total)} {total === 1 ? "contrato gerado" : "contratos gerados"}
          </h2>
          <p style={{ color: T.muted, fontSize: 12.5, margin: "6px 0 0" }}>
            As vendas deste recorte que já têm contrato, com a situação da assinatura.
          </p>
        </div>

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
              fontSize: 14,
              minWidth: 0,
              outline: "none",
              padding: "9px 0",
            }}
            value={busca}
          />
        </label>
      </div>

      {/* Filtro por situação da assinatura: só situações com contrato aparecem (ruído zero). */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "14px 0 4px" }}>
        <Pilula
          ativo={situacaoAtiva === null}
          onClick={() => setSituacaoAtiva(null)}
          rotulo={`Todos (${inteiro(total)})`}
        />
        {situacoes
          .filter((situacao) => contagemDaSituacao(situacao) > 0)
          .map((situacao) => (
            <Pilula
              ativo={situacaoAtiva === situacao}
              key={situacao}
              onClick={() =>
                setSituacaoAtiva(situacaoAtiva === situacao ? null : situacao)
              }
              rotulo={`${SITUACAO_LABELS[situacao]} (${inteiro(contagemDaSituacao(situacao))})`}
            />
          ))}
      </div>

      {contratos.length === 0 ? (
        <p style={{ color: T.muted, fontSize: 13, margin: "20px 0 4px", textAlign: "center" }}>
          Nenhuma venda deste recorte chegou à etapa de contrato ainda.
        </p>
      ) : (
        <>
          {/* A tabela rola SOZINHA no celular, como o Cenário Analítico. */}
          <div style={{ marginTop: 12, overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 880, width: "100%" }}>
              <thead>
                <tr>
                  {[
                    "Unidade",
                    "Comprador",
                    "Imobiliária",
                    "Gerado em",
                    "Valor",
                    "Assinatura",
                    "Faturado em",
                    "Contrato",
                  ].map((coluna) => (
                    <th
                      key={coluna}
                      style={{
                        borderBottom: `1px solid ${T.border}`,
                        color: T.muted,
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: "0.04em",
                        padding: "8px 10px 8px 0",
                        textAlign: coluna === "Valor" ? "right" : "left",
                        textTransform: "uppercase",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {coluna}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtrados.map((contrato) => (
                  <tr key={contrato.unitId}>
                    <td style={{ ...celula, color: T.text, fontWeight: 600, whiteSpace: "nowrap" }}>
                      {contrato.unidade}
                    </td>
                    <td style={celula}>{contrato.comprador ?? ""}</td>
                    <td style={celula}>{contrato.imobiliaria ?? ""}</td>
                    <td style={{ ...celula, whiteSpace: "nowrap" }}>
                      {rotuloDaData(contrato.geradoEm) || "-"}
                    </td>
                    {/* Coluna de número em tabela: aqui SIM tabular-nums. */}
                    <td
                      style={{
                        ...celula,
                        color: T.text,
                        fontVariantNumeric: "tabular-nums",
                        textAlign: "right",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {brl(contrato.valorTabela)}
                    </td>
                    <td style={{ ...celula, whiteSpace: "nowrap" }}>
                      <ChipDeAssinatura situacao={contrato.assinatura} />
                    </td>
                    {/* Por STRING: billing_date é DATE, e new Date mostraria a véspera. */}
                    <td style={{ ...celula, whiteSpace: "nowrap" }}>
                      {rotuloDeYmd(contrato.faturadoEm) || "-"}
                    </td>
                    <td style={{ ...celula, whiteSpace: "nowrap" }}>
                      <BotaoDePdfDoContrato contrato={contrato} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filtrados.length === 0 ? (
            <p style={{ color: T.muted, fontSize: 13, margin: "16px 0 0", textAlign: "center" }}>
              Nenhum contrato encontrado com esse filtro.
            </p>
          ) : null}
        </>
      )}

      {aviso ? (
        <p style={{ color: T.muted, fontSize: 12, lineHeight: 1.5, margin: "14px 0 0" }}>{aviso}</p>
      ) : null}
    </section>
  );
}

// ── ASSINATURAS: os KPIs, quem está com a bola e o quadro completo recolhido ─
//
// REDESENHO 18/08/2026. O Lucas reprovou a primeira versão: *"não gostei da tela de assinatura,
// está longa, fiquei perdido ao tentar usá-la"*. O problema não era o dado, era a HIERARQUIA: a
// tabela dos 63 assinantes ocupava o palco e, como 61 deles têm 0 na vez e 0 aguardando, o
// acionável (os 3 contratos parados) virava agulha no palheiro. A ordem agora é:
//   1. KPIs — mantidos, mas em TILE de verdade, com barra fina onde o número é uma fração
//      (compradores que assinaram e unidades 100% assinadas);
//   2. COM A BOLA AGORA — o palco: só quem tem `naVez > 0`, em CARD, com a lista das unidades
//      que esperam por ele e há quanto tempo. É o que o dono cobra, de quem ele cobra;
//   3. o quadro dos 63 recolhido num <details> com busca, ordenado por assinados.
//
// ⚠️ A LISTA "Contratos aguardando assinatura" FOI FUNDIDA nos cards, não removida: ela dizia
// exatamente o que os cards dizem (a mesma unidade, a mesma pessoa na vez, a mesma data de
// envio), só que espalhada por linha em vez de agrupada por quem tem que agir — duas leituras do
// mesmo dado, e era metade do comprimento que incomodou. O ÚNICO resíduo que card nenhum cobre é
// o envio SEM assinante registrado (`naVez` vazio, ver o LEFT JOIN em
// lib/apolo/incorporador/assinaturas.ts): esse continua visível, em bloco próprio logo abaixo.
//
// ⚠️ NÃO EXISTE nome de comprador no payload dos pendentes — o shape é empreendimento + unidade +
// enviadoEm + naVez[] (PendenteDaTela). O card identifica a pendência por UNIDADE, empreendimento
// (só quando o recorte tem mais de um) e tempo de espera; trazer o comprador exigiria mexer na
// rota, que está fora deste redesenho.
const CSS_ASSINATURAS = `
  /* São QUATRO tiles, número fixo, então a grade é fixa e a quebra é 4 → 2x2 → 1. Com auto-fit
     a faixa quebrava em 3 + 1 e sobrava um KPI órfão na segunda linha, que é justo o tipo de
     irregularidade que salta aos olhos numa faixa de topo. */
  .asn-kpis { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
  @media (max-width: 1120px) { .asn-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 560px) { .asn-kpis { grid-template-columns: minmax(0, 1fr); } }
  .asn-cards { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
  /* auto-FIT (e não auto-fill) + teto de 520px no card: com auto-fill sobrava trilho vazio à
     direita quando só uma pessoa está com a bola, e sem o teto esse card único esticava a linha
     inteira. Assim ele fica do tamanho dos irmãos, tenha um ou quatro. */
  .asn-cards > article { max-width: 520px; }
  /* Abaixo de ~900px o card fica estreito demais para a linha "unidade … há N dias": empilha. */
  @media (max-width: 900px) { .asn-cards { grid-template-columns: minmax(0, 1fr); } }
  .asn-sumario { cursor: pointer; list-style: none; }
  .asn-sumario::-webkit-details-marker { display: none; }
  .asn-seta { flex: 0 0 auto; transition: transform .16s ease; }
  details[open] .asn-seta { transform: rotate(180deg); }
  /* A tabela recolhida rola DENTRO dela mesma (cabeçalho fixo): aberta, ela não pode empurrar a
     página de volta ao comprimento que o dono reprovou. */
  .asn-rolagem { max-height: 420px; overflow: auto; }
  .asn-tabela { border-collapse: separate; border-spacing: 0; min-width: 520px; width: 100%; }
  .asn-tabela thead th {
    background: var(--inc-card); box-shadow: inset 0 -1px 0 var(--inc-border);
    color: var(--inc-muted); font-size: 11px; font-weight: 600; letter-spacing: .04em;
    padding: 9px 10px 9px 0; position: sticky; text-transform: uppercase; top: 0;
    white-space: nowrap; z-index: 1;
  }
  .asn-tabela td { padding: 9px 10px 9px 0; }
  .asn-tabela thead th:first-child, .asn-tabela tbody td:first-child { padding-left: 10px; }
  /* Zebra em cinza TRANSLÚCIDO, não em token: o mesmo valor serve nos dois temas (sobre branco
     vira quase-cinza, sobre preto vira quase-grafite) sem precisar de segunda regra no dark. */
  .asn-tabela tbody tr:nth-child(2n) td { background: rgb(127 127 127 / .06); }
`;

/** Quantos dias inteiros desde 'YYYY-MM-DD', pela data LOCAL (new Date do ymd é UTC: erra um dia). */
function diasDesdeYmd(ymd: null | string): null | number {
  const texto = String(ymd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(texto)) return null;
  const [ano, mes, dia] = texto.split("-").map(Number);
  const entao = new Date(ano ?? 0, (mes ?? 1) - 1, dia ?? 1).getTime();
  if (Number.isNaN(entao)) return null;

  return Math.max(0, Math.floor((Date.now() - entao) / 86_400_000));
}

/** "há 12 dias" / "há 1 dia" / "hoje" — a espera, do jeito que se fala. */
function rotuloDeEspera(ymd: null | string): string {
  const dias = diasDesdeYmd(ymd);
  if (dias === null) return "";
  if (dias === 0) return "hoje";

  return dias === 1 ? "há 1 dia" : `há ${inteiro(dias)} dias`;
}

function SecaoAssinaturas({
  cache,
  emp,
}: {
  cache: Map<string, DadosAssinaturas>;
  emp: null | string;
}) {
  const estado = useDadosDaVisao(
    "/api/incorporador/vendas/assinaturas",
    emp,
    cache,
    "Não foi possível carregar as assinaturas.",
  );

  if (estado.tipo === "carregando") return <Aviso texto="Carregando as assinaturas…" />;
  if (estado.tipo === "erro") return <Aviso texto={estado.mensagem} tom="erro" />;

  const { assinantes, kpis, pendentes } = estado.dados;

  // O palco: só quem tem contrato parado ESPERANDO por ele. A ordem já vem do servidor pelo
  // gargalo; reordenar aqui é barato e deixa o card independente de mudança na rota.
  const comABola = assinantes
    .filter((assinante) => assinante.naVez > 0)
    .sort((a, b) => b.naVez - a.naVez || a.nome.localeCompare(b.nome, "pt-BR"));

  // O resíduo que card nenhum cobre: envio válido sem NENHUM assinante registrado.
  const semDono = pendentes.filter((pendente) => pendente.naVez.length === 0);
  const paradosComDono = pendentes.length - semDono.length;

  // O empreendimento só entra na linha quando o recorte tem mais de um: no recorte de um
  // loteamento só, repetir o nome em toda linha é ruído.
  const variosEmpreendimentos =
    new Set(pendentes.map((pendente) => pendente.empreendimento).filter(Boolean)).size > 1;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Layout responsivo em classe pela mesma razão do CSS_RESUMO: media query não alcança
          estilo inline, e os cards precisam empilhar no celular. */}
      <style>{CSS_ASSINATURAS}</style>

      {/* ── OS KPIs ──────────────────────────────────────────────────────────── */}
      <section style={{ ...cartao, padding: 16 }}>
        <div className="asn-kpis">
          <TileDeAssinatura
            apoio="das assinaturas de comprador já colhidas"
            progresso={kpis.pctCompradoresAssinaram}
            rotulo="Compradores que assinaram"
            sufixo="%"
            valor={
              kpis.pctCompradoresAssinaram === null ? null : pct1(kpis.pctCompradoresAssinaram)
            }
          />
          <TileDeAssinatura
            apoio="unidades com contrato enviado para assinar"
            progresso={
              kpis.unidadesComEnvio > 0
                ? (kpis.unidadesTotalmenteAssinadas / kpis.unidadesComEnvio) * 100
                : null
            }
            rotulo="Unidades 100% assinadas"
            sufixo={`de ${inteiro(kpis.unidadesComEnvio)}`}
            valor={inteiro(kpis.unidadesTotalmenteAssinadas)}
          />
          <TileDeAssinatura
            apoio="da geração do contrato à última assinatura"
            rotulo="Tempo médio"
            sufixo="dias"
            valor={kpis.tempoMedioDias === null ? null : pct1(kpis.tempoMedioDias)}
          />
          <TileDeAssinatura
            apoio="contratos que ainda não saíram para assinar"
            rotulo="Aguardando emissão"
            valor={inteiro(kpis.aguardandoEmissao)}
          />
        </div>
      </section>

      {/* ── O PALCO: COM A BOLA AGORA ────────────────────────────────────────── */}
      <section style={cartao}>
        <div
          style={{
            alignItems: "baseline",
            display: "flex",
            flexWrap: "wrap",
            gap: "4px 10px",
            justifyContent: "space-between",
          }}
        >
          <h2 style={titulo}>Com a bola agora</h2>
          {comABola.length > 0 ? (
            <span style={{ color: T.muted, fontSize: 12.5 }}>
              {inteiro(paradosComDono)}{" "}
              {paradosComDono === 1 ? "contrato parado" : "contratos parados"} com{" "}
              {inteiro(comABola.length)} {comABola.length === 1 ? "pessoa" : "pessoas"}
            </span>
          ) : null}
        </div>
        <p style={{ color: T.muted, fontSize: 12.5, margin: "6px 0 0" }}>
          A fila destes contratos parou nestas pessoas. É delas que a assinatura depende agora.
        </p>

        {comABola.length === 0 ? (
          // O ESTADO VAZIO DE VERDADE: ninguém está segurando nada. Sem tabela, sem lista, sem
          // fazer o dono procurar. O Vista Alegre vive neste estado; a Lagoa Bonita, não.
          <div
            style={{
              alignItems: "center",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "34px 0 26px",
              textAlign: "center",
            }}
          >
            <CheckCircle2 aria-hidden="true" size={30} style={{ color: T.ok }} />
            <p style={{ color: T.text, fontSize: 15, fontWeight: 700, margin: 0 }}>
              Ninguém está segurando contrato
            </p>
            <p style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.55, margin: 0, maxWidth: 440 }}>
              Nenhum contrato enviado está parado esperando assinatura neste recorte.
              {kpis.aguardandoEmissao > 0
                ? ` ${inteiro(kpis.aguardandoEmissao)} ${kpis.aguardandoEmissao === 1 ? "contrato ainda não saiu" : "contratos ainda não saíram"} para assinar, veja o indicador acima.`
                : ""}
            </p>
          </div>
        ) : (
          <div className="asn-cards" style={{ marginTop: 14 }}>
            {comABola.map((assinante) => (
              <CardComABola
                assinante={assinante}
                key={`${assinante.nome}-${assinante.papel ?? ""}`}
                mostrarEmpreendimento={variosEmpreendimentos}
                pendentes={pendentes.filter((pendente) =>
                  pendente.naVez.includes(assinante.nome),
                )}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── O RESÍDUO: envio que saiu sem nenhum assinante registrado ────────── */}
      {semDono.length > 0 ? (
        <section style={cartao}>
          <h2 style={titulo}>
            Sem assinante registrado{" "}
            <span style={{ color: T.muted, fontSize: 12, fontWeight: 500 }}>
              ({inteiro(semDono.length)})
            </span>
          </h2>
          <p style={{ color: T.muted, fontSize: 12.5, margin: "6px 0 0" }}>
            O contrato saiu para assinatura, mas nenhum assinante ficou registrado no envio. Não há
            de quem cobrar sem refazer o envio.
          </p>
          <div style={{ marginTop: 10 }}>
            {semDono.map((pendente, indice) => (
              <div
                key={`${pendente.empreendimento}-${pendente.unidade}-${pendente.enviadoEm}-${indice}`}
                style={{
                  alignItems: "baseline",
                  borderTop: indice === 0 ? "none" : `1px solid ${T.border}`,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "2px 10px",
                  padding: "8px 0",
                }}
              >
                <span style={{ color: T.text, fontSize: 13, fontWeight: 700 }}>
                  {pendente.unidade || "unidade sem nome"}
                </span>
                {variosEmpreendimentos && pendente.empreendimento ? (
                  <span style={{ color: T.muted, fontSize: 12 }}>{pendente.empreendimento}</span>
                ) : null}
                <span
                  style={{
                    color: T.muted,
                    fontSize: 12,
                    marginLeft: "auto",
                    whiteSpace: "nowrap",
                  }}
                >
                  enviado em {rotuloDeYmd(pendente.enviadoEm)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* ── O QUADRO COMPLETO, RECOLHIDO ─────────────────────────────────────── */}
      <QuadroCompletoDeAssinantes assinantes={assinantes} />
    </div>
  );
}

/**
 * Um tile de KPI da faixa de assinaturas: rótulo em caixa alta, número grande com o sufixo
 * discreto ao lado, linha de apoio e, quando o número é uma FRAÇÃO de algo, a barra fina que
 * mostra quanto falta. A barra é monocromática (tinta do texto sobre a borda): dourado não é
 * estado, e cor por estado aqui só confundiria com o verde de "assinado".
 * ⚠️ SEM tabular-nums no número grande, igual ao `Numero` do Resumo: tabular é para coluna.
 */
function TileDeAssinatura({
  apoio,
  progresso,
  rotulo,
  sufixo,
  valor,
}: {
  apoio: string;
  progresso?: null | number;
  rotulo: string;
  sufixo?: string;
  valor: null | string;
}) {
  const barra = progresso === null || progresso === undefined ? null : Math.min(100, Math.max(0, progresso));

  return (
    <div
      style={{
        background: T.soft,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minWidth: 0,
        padding: "13px 14px 14px",
      }}
    >
      <div
        style={{
          color: T.muted,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "0.05em",
          lineHeight: 1.35,
          textTransform: "uppercase",
        }}
      >
        {rotulo}
      </div>

      {valor === null ? (
        <div style={{ color: T.muted, fontSize: 17, fontWeight: 600, lineHeight: 1.2 }}>
          sem dado
        </div>
      ) : (
        <div style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: 5 }}>
          <span style={{ color: T.text, fontSize: 27, fontWeight: 700, lineHeight: 1.05 }}>
            {valor}
          </span>
          {sufixo ? (
            <span style={{ color: T.muted, fontSize: 13, fontWeight: 600 }}>{sufixo}</span>
          ) : null}
        </div>
      )}

      <div style={{ color: T.muted, fontSize: 11, lineHeight: 1.4, marginTop: "auto" }}>
        {apoio}
      </div>

      {barra === null ? null : (
        <div
          aria-hidden="true"
          style={{ background: T.border, borderRadius: 999, height: 4, overflow: "hidden" }}
        >
          <div style={{ background: T.text, height: "100%", width: `${barra}%` }} />
        </div>
      )}
    </div>
  );
}

/** Quantas unidades o card mostra antes de resumir o resto em "+N". */
const UNIDADES_NO_CARD = 4;

/**
 * O CARD do gargalo: quem está com a bola, quantos contratos pararam nele e QUAIS unidades
 * esperam por ele, da espera mais antiga para a mais nova (a ordem que vem do servidor).
 * O número mora num selo invertido (grafite com preto), que é o único destaque forte da tela.
 */
function CardComABola({
  assinante,
  mostrarEmpreendimento,
  pendentes,
}: {
  assinante: AssinanteDaTela;
  mostrarEmpreendimento: boolean;
  pendentes: PendenteDaTela[];
}) {
  const visiveis = pendentes.slice(0, UNIDADES_NO_CARD);
  const restantes = pendentes.length - visiveis.length;

  return (
    <article
      style={{
        background: T.soft,
        border: `1px solid ${T.border}`,
        borderRadius: 12,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        minWidth: 0,
        padding: 14,
      }}
    >
      <header style={{ alignItems: "center", display: "flex", gap: 12 }}>
        <span
          style={{
            alignItems: "center",
            background: T.btnBg,
            borderRadius: 11,
            color: T.btnFg,
            display: "flex",
            flex: "0 0 auto",
            fontSize: 20,
            fontWeight: 700,
            height: 42,
            justifyContent: "center",
            minWidth: 42,
            padding: "0 8px",
          }}
        >
          {inteiro(assinante.naVez)}
        </span>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              color: T.text,
              fontSize: 15.5,
              fontWeight: 700,
              lineHeight: 1.25,
              overflowWrap: "anywhere",
            }}
          >
            {assinante.nome}
          </div>
          <div style={{ color: T.muted, fontSize: 11.5, marginTop: 2 }}>
            {assinante.papel ? `${assinante.papel} · ` : ""}
            {assinante.naVez === 1 ? "1 contrato esperando" : `${inteiro(assinante.naVez)} contratos esperando`}
          </div>
        </div>
      </header>

      {visiveis.length === 0 ? (
        <p style={{ color: T.muted, fontSize: 12, margin: 0 }}>
          As unidades desta pendência não vieram na lista de contratos deste recorte.
        </p>
      ) : (
        <div>
          <div
            style={{
              color: T.muted,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            Unidades esperando
          </div>
          <div style={{ marginTop: 4 }}>
            {visiveis.map((pendente, indice) => (
              <div
                key={`${pendente.empreendimento}-${pendente.unidade}-${pendente.enviadoEm}-${indice}`}
                style={{
                  alignItems: "baseline",
                  borderTop: indice === 0 ? "none" : `1px solid ${T.border}`,
                  display: "flex",
                  gap: 10,
                  padding: "7px 0",
                }}
              >
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      color: T.text,
                      fontSize: 13,
                      fontWeight: 700,
                      overflowWrap: "anywhere",
                    }}
                  >
                    {pendente.unidade || "unidade sem nome"}
                  </span>
                  {mostrarEmpreendimento && pendente.empreendimento ? (
                    <span style={{ color: T.muted, fontSize: 11.5 }}>
                      {" "}
                      {pendente.empreendimento}
                    </span>
                  ) : null}
                </span>
                <span
                  style={{
                    color: T.muted,
                    fontSize: 11.5,
                    fontVariantNumeric: "tabular-nums",
                    marginLeft: "auto",
                    whiteSpace: "nowrap",
                  }}
                  title={`Enviado em ${rotuloDeYmd(pendente.enviadoEm)}`}
                >
                  {rotuloDeEspera(pendente.enviadoEm)}
                </span>
              </div>
            ))}
          </div>
          {restantes > 0 ? (
            <div
              style={{ borderTop: `1px solid ${T.border}`, color: T.muted, fontSize: 12, paddingTop: 7 }}
            >
              +{inteiro(restantes)} {restantes === 1 ? "unidade" : "unidades"}
            </div>
          ) : null}
        </div>
      )}
    </article>
  );
}

/**
 * O QUADRO COMPLETO, recolhido: o histórico dos 63 assinantes vira consulta, não palco. Fechado
 * por padrão, com busca por nome e ordenado por ASSINADOS (o que faz sentido num quadro de
 * histórico; o gargalo já está nos cards acima).
 *
 * ⚠️ AS COLUNAS "Na vez" e "Aguardando" NÃO SOMEM quando estão zeradas para todo mundo: coluna
 * que aparece e desaparece conforme o recorte faz o leitor duvidar do que está vendo. Os zeros
 * ficam esmaecidos (T.muted) e o número que importa fica na tinta do texto.
 */
function QuadroCompletoDeAssinantes({ assinantes }: { assinantes: AssinanteDaTela[] }) {
  const [busca, setBusca] = useState("");

  if (assinantes.length === 0) {
    return (
      <section style={cartao}>
        <h2 style={titulo}>Quadro por assinante</h2>
        <p style={{ color: T.muted, fontSize: 13, margin: "16px 0 4px", textAlign: "center" }}>
          Nenhum contrato deste recorte saiu para assinatura ainda.
        </p>
      </section>
    );
  }

  const alvo = busca.trim().toLowerCase();
  const lista = [...assinantes]
    .filter((assinante) => (alvo ? assinante.nome.toLowerCase().includes(alvo) : true))
    .sort(
      (a, b) =>
        b.assinou - a.assinou || b.naVez - a.naVez || a.nome.localeCompare(b.nome, "pt-BR"),
    );

  return (
    <details style={{ ...cartao, padding: 0 }}>
      <summary
        className="asn-sumario"
        style={{
          alignItems: "center",
          display: "flex",
          gap: 10,
          justifyContent: "space-between",
          padding: "15px 20px",
        }}
      >
        <span style={{ minWidth: 0 }}>
          <span style={{ ...titulo, fontSize: 14 }}>
            Ver todos os assinantes ({inteiro(assinantes.length)})
          </span>
          <span style={{ color: T.muted, display: "block", fontSize: 12, marginTop: 3 }}>
            O histórico completo: quem já assinou quantos contratos.
          </span>
        </span>
        <ChevronDown aria-hidden="true" className="asn-seta" size={17} style={{ color: T.muted }} />
      </summary>

      <div style={{ borderTop: `1px solid ${T.border}`, padding: "14px 20px 18px" }}>
        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            justifyContent: "space-between",
            marginBottom: 12,
          }}
        >
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
              placeholder="Buscar assinante pelo nome"
              style={{
                background: "transparent",
                border: "none",
                color: T.text,
                flex: 1,
                fontFamily: fonte,
                fontSize: 14,
                minWidth: 0,
                outline: "none",
                padding: "8px 0",
              }}
              value={busca}
            />
          </label>
          <span style={{ color: T.muted, fontSize: 12, fontVariantNumeric: "tabular-nums" }}>
            {alvo
              ? `${inteiro(lista.length)} de ${inteiro(assinantes.length)}`
              : `${inteiro(assinantes.length)} assinantes`}
          </span>
        </div>

        {lista.length === 0 ? (
          <p style={{ color: T.muted, fontSize: 13, margin: "18px 0 6px", textAlign: "center" }}>
            Nenhum assinante com esse nome neste recorte.
          </p>
        ) : (
          <div className="asn-rolagem">
            <table className="asn-tabela">
              <thead>
                <tr>
                  {["Assinante", "Assinados", "Na vez", "Aguardando"].map((coluna) => (
                    <th key={coluna} style={{ textAlign: coluna === "Assinante" ? "left" : "right" }}>
                      {coluna}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lista.map((assinante) => (
                  <tr key={`${assinante.nome}-${assinante.papel ?? ""}`}>
                    <td style={{ color: T.text, fontSize: 13, fontWeight: 600 }}>
                      {assinante.nome}
                      {assinante.papel ? (
                        <span style={{ color: T.muted, fontWeight: 500 }}> · {assinante.papel}</span>
                      ) : null}
                    </td>
                    <NumeroDaColuna valor={assinante.assinou} />
                    <NumeroDaColuna destaque valor={assinante.naVez} />
                    <NumeroDaColuna valor={assinante.aguardandoAnteriores} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.5, margin: "12px 0 0" }}>
          Na vez é o contrato parado esperando a pessoa. Aguardando é o que ainda depende de alguém
          antes dela na ordem de assinatura.
        </p>
      </div>
    </details>
  );
}

/**
 * Uma célula de número do quadro: tabular-nums para as casas alinharem, ZERO esmaecido para o
 * olho pular direto no que tem número, e o "na vez" positivo na tinta do texto (é o único que
 * pede ação). Sem pílula: a pílula era do tempo em que esta tabela era o palco.
 */
function NumeroDaColuna({ destaque, valor }: { destaque?: boolean; valor: number }) {
  const zero = valor === 0;

  return (
    <td
      style={{
        color: zero ? T.muted : T.text,
        fontSize: 13,
        fontVariantNumeric: "tabular-nums",
        fontWeight: !zero && destaque ? 700 : 500,
        opacity: zero ? 0.55 : 1,
        textAlign: "right",
        whiteSpace: "nowrap",
      }}
    >
      {inteiro(valor)}
    </td>
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
