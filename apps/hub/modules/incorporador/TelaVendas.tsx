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
// A tela tem TRÊS visões na mesma faixa. Resumo e Pipeline dividem o MESMO fetch (a rota custa
// 4+1 consultas no C2X; nada de segundo carregamento); Contratos tem fetch PRÓPRIO sob demanda —
// só quando a visão abre, com cache por recorte (useDadosDaVisao) e sem polling:
//   • CONTRATOS — a FUSÃO de 18/08/2026, pedida pelo dono: *"a tela de assinatura devia chamar
//     contratos e tirar a tela de contratos que tem hoje... no final dessa linha vai ter o
//     contrato para ser baixado"*. Eram duas visões (a lista de contratos gerados e a gestão de
//     assinatura); viraram uma, servida por /api/incorporador/vendas/assinaturas — UMA chamada. O
//     que a lista antiga mostrava não se perdeu: unidade e comprador continuam na linha, VALOR e
//     GERADO EM entraram nela, imobiliária e FATURADO EM foram para o cabeçalho do popup, a
//     situação virou chip (o mesmo `ChipDeAssinatura`) e o PDF virou o botão do FIM DA LINHA;
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

// ── CONTRATOS (a visão com fetch PRÓPRIO) ───────────────────────────────────
// Payload de /api/incorporador/vendas/assinaturas — o shape é a allowlist da rota, campo a campo.
// Nome de comprador/imobiliária/assinante aparece (o incorporador é parte do contrato); telefone,
// e-mail e documento NÃO existem no payload.

/** A situação resumida da assinatura de um contrato (lib/apolo/incorporador/contratos.ts). */
type SituacaoAssinatura = "aguardando-emissao" | "assinado" | "em-assinatura";

// COPIADO de contratos.ts, não importado, pela mesma razão de ETAPA_ORDEM: aquele módulo puxa o
// driver do MySQL, que não pode entrar no bundle de um componente "use client".
const SITUACAO_LABELS: Record<SituacaoAssinatura, string> = {
  "aguardando-emissao": "Aguardando emissão",
  assinado: "Assinado",
  "em-assinatura": "Em assinatura",
};

/**
 * O que o CONTRATO acrescenta à linha — o que a visão Contratos antiga mostrava em colunas. Nulo
 * quando o envio é de uma proposta que não é mais a viva da unidade (revenda, distrato): ali não
 * há contrato vigente de onde tirar valor, imobiliária ou PDF.
 */
type ContratoDaLinha = {
  /** ISO curto "YYYY-MM-DD" — formatar por STRING (rotuloDeYmd), nunca por new Date. */
  faturadoEm: null | string;
  /** ISO completo (created_at do histórico é datetime real): aqui rotuloDaData serve. */
  geradoEm: null | string;
  imobiliaria: null | string;
  /** Há contrato assinado no D4Sign: liga o botão de PDF (mesma UX da coluna da Carteira). */
  temContrato: boolean;
  /** A chave do botão de PDF; a rota que o recebe reconfere o escopo do lado de lá. */
  unitId: number;
  valorTabela: number;
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

/** Uma linha do esquema de assinatura de um contrato. Sem e-mail: decisão do dono, ver a rota. */
type AssinaturaDoEsquema = {
  /** ISO curto "2026-07-01" — formatar por STRING (rotuloDeYmd), nunca por new Date. */
  assinadoEm: null | string;
  /** Posição na fila. 0 = o empreendimento não usa ordem e todos assinam em paralelo. */
  degrau: number;
  nome: string;
  /** O rótulo de `perfilDeTela`, o MESMO que o painel interno mostra. */
  perfil: string;
  situacao: "aguardando" | "assinado" | "vez";
};

/** O progresso de um perfil DENTRO de um contrato: a barrinha por grupo da linha da unidade. */
type GrupoDaUnidade = { assinadas: number; naVez: boolean; perfil: string; total: number };

/** Uma linha da lista: um contrato, rotulado pela unidade dele. */
type UnidadeDeAssinatura = {
  assinadas: number;
  comprador: null | string;
  concluida: boolean;
  /** Os dados do contrato daquela venda: valor, geração, imobiliária, faturamento e o PDF. */
  contrato: ContratoDaLinha | null;
  empreendimento: string;
  /** ISO curto "2026-07-01" — formatar por STRING (rotuloDeYmd), nunca por new Date. VAZIA no
   * contrato que ainda não saiu para assinar. */
  enviadoEm: string;
  /** `contract_signatures.id`. 0 = contrato ainda sem envio (aguardando emissão). */
  envioId: number;
  esquema: AssinaturaDoEsquema[];
  grupos: GrupoDaUnidade[];
  naVez: string[];
  perfisNaVez: string[];
  /** A régua da visão antiga: assinado, em assinatura ou aguardando emissão. */
  situacao: SituacaoAssinatura;
  total: number;
  unidade: string;
};

type DadosAssinaturas = {
  assinantes: AssinanteDaTela[];
  /** O aviso do teto da lista, quando ela veio cortada. */
  aviso: null | string;
  /** Vazia quando o recorte não usa ordem de assinatura (todo mundo no degrau 0). */
  fila: { assinadas: number; degrau: number; perfis: string[]; total: number }[];
  kpis: {
    aguardandoEmissao: number;
    compradorEmAtraso: number;
    compradorOk: number;
    compradorPendente: number;
    diasAteAssinar: null | number;
    diasDesdeEnvio: null | number;
    pctCompradoresAssinaram: null | number;
    tempoMedioDias: null | number;
    unidadesComEnvio: number;
    unidadesTotalmenteAssinadas: number;
  };
  taxas: { assinadas: number; esperadas: number; perfil: string }[];
  unidades: UnidadeDeAssinatura[];
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
  // Resumo e Pipeline dividem o MESMO fetch (trocar entre elas não refaz a chamada); Contratos
  // tem fetch PRÓPRIO, disparado só quando a visão abre (custo C2X).
  const [visao, setVisao] = useState<"contratos" | "pipeline" | "resumo">("resumo");
  // A alternância UN × R$ dos KPIs do BI (página "Vendas" do Power BI do Lucas).
  const [medida, setMedida] = useState<"rs" | "un">("un");
  // O popup da proposta: aberto pela unidade clicada (kanban ou tabela), quando ela tem unitId.
  const [propostaAberta, setPropostaAberta] = useState<AlvoDaProposta | null>(null);
  // Cache por unitId, vivo enquanto a tela vive: fechar e reabrir o MESMO popup não refaz a
  // chamada (a rota custa duas consultas no C2X). Erro NÃO entra no cache — reabrir tenta de novo.
  const cacheDePropostas = useRef(new Map<number, Proposta | null>());
  // Cache por recorte (chave = emp escolhido, "" = todos), vivo enquanto a tela vive: voltar para
  // Contratos no mesmo recorte não refaz a chamada (2 queries C2X). Erro NÃO entra no cache —
  // reabrir a visão tenta de novo. E nada de polling.
  const cacheDeContratos = useRef(new Map<string, DadosAssinaturas>());

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

      {/* ── AS TRÊS VISÕES: Resumo (números), Pipeline (o kanban) e Contratos ── */}
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
 * O BOTÃO DO FIM DA LINHA — *"no final dessa linha vai ter o contrato para ser baixado"* (Lucas,
 * 18/08/2026). A MESMA UX do BotaoDeContrato da TelaCarteira: ícone de documento que abre
 * /api/incorporador/contrato?unitId=… em aba nova. O link leva o unitId, NUNCA o uuid: a rota
 * reconfere `unidadeNoEscopo` e resolve o documento no C2X a cada clique.
 *
 * ⚠️ SEM CONTRATO DISPONÍVEL, A CÉLULA É "-", NUNCA UM BOTÃO QUE ERRA: sem `temContrato` não há
 * documento assinado na D4Sign, e sem `contrato` (envio de proposta que não é mais a viva) não há
 * nem unitId para onde apontar.
 */
function BotaoDePdfDoContrato({
  contrato,
  largo,
}: {
  contrato: ContratoDaLinha | null;
  /** Versão do popup: o mesmo destino, com rótulo, porque ali sobra largura. */
  largo?: boolean;
}) {
  if (!contrato?.temContrato) {
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
        fontFamily: fonte,
        fontSize: 12,
        fontWeight: 600,
        gap: largo ? 7 : 0,
        height: 28,
        justifyContent: "center",
        padding: largo ? "0 11px" : 0,
        textDecoration: "none",
        width: largo ? "auto" : 28,
      }}
      target="_blank"
      title="Abrir contrato assinado"
    >
      <FileText aria-hidden="true" size={14} />
      {largo ? "Abrir contrato" : null}
    </a>
  );
}

// ── CONTRATOS: a taxa por perfil, os blocos do painel, a lista por unidade e o quadro ─
//
// ⚠️ FUSÃO DE 18/08/2026 (o quarto desenho): *"acho que a tela de assinatura devia chamar
// contratos e tirar a tela de contratos que tem hoje. O nome da tela de assinatura vai chamar
// contrato, e aí no final dessa linha vai ter o contrato para ser baixado"*. Esta visão absorveu a
// lista de contratos gerados. ONDE CADA COISA DELA FOI PARAR:
//   • unidade e comprador → já eram a identificação da linha;
//   • VALOR e GERADO EM → linha de apoio da mesma identificação (uma linha só, discreta);
//   • IMOBILIÁRIA e FATURADO EM → cabeçalho "Dados do contrato" do popup da unidade;
//   • SITUAÇÃO DA ASSINATURA → o mesmo `ChipDeAssinatura`, na terceira coluna da linha (só quando
//     o contrato ainda não saiu para assinar; nos demais a fração "x de y" e o "parado com quem"
//     dizem mais do que o chip) e no cabeçalho do popup;
//   • PDF → o botão do FIM DA LINHA, e de novo no popup;
//   • FILTRO POR SITUAÇÃO → virou a pílula "Aguardando emissão", ao lado de Pendentes/Concluídas;
//   • BUSCA por imobiliária → continua, junto de unidade e comprador.
// O contrato gerado que ainda NÃO saiu para assinar deixou de ser só o KPI "aguardando emissão" e
// virou LINHA: era linha na visão antiga, e some-lo num contador perderia valor e faturamento.
//
// REDESENHO 18/08/2026 (o terceiro, e o que o dono desenhou por inteiro). O que ele pediu, na
// ordem em que pediu, e onde cada coisa foi parar:
//
//   1. *"essa tela tem que ser a que temos hoje no painel"* — o painel interno de assinatura
//      (modules/apolo/blocks/assinaturas/painel-assinatura.tsx, que ele usa e aprovou) entra aqui
//      em DESENHO, não em classe: os blocos de KPI, a fila por ordem e o quadro por assinante com
//      os números clicáveis. As classes Tailwind do hub viraram estilo inline com os tokens T,
//      porque o portal é tela pública e tem tema claro E escuro;
//   2. *"eu não sei o status de assinatura das unidades... um visual em barra que vai enchendo"* —
//      a LISTA POR UNIDADE virou o palco da tela. A pergunta principal aqui é por unidade, não por
//      assinante;
//   3. *"traz a unidade e os grupos, e com a barrinha também"* — cada linha mostra uma barrinha
//      POR PERFIL presente naquele contrato, e é ela que responde "falta o Incorporador";
//   4. *"ao clicar nessa unidade abre um popup... quem assinou, quem falta"* — o clique abre a
//      TABELA de assinatura daquele contrato (o termo é dele, e tabela lê melhor que linha do
//      tempo quando metade dos contratos não tem ordem nenhuma);
//   5. *"colocar filtro para saber as unidades, tipo pendente e tal"* — pílulas com contagem,
//      mais a busca por unidade, comprador e imobiliária;
//   6. *"esses cards poderiam trazer a taxa de assinatura das imobiliárias, Careli, coordenação,
//      incorporador"* — a faixa de cima virou a TAXA POR PERFIL, com o pior elo primeiro.
//
// ⚠️ OS NOMES DE PERFIL SÃO OS DO PAINEL INTERNO, e nenhum é inventado aqui: vêm de `perfilDeTela`
// (lib/apolo/painel-assinatura.ts), no servidor. Regra do Lucas: *"em vez de Careli, coloca
// Backoffice... do jeito que estamos fazendo hoje"*. Medido no C2X em 18/08/2026, os perfis que
// existem nos recortes de hoje são Comprador, Imobiliária, Backoffice, Incorporador, Coordenadora
// de venda e Corretor. Se aparecer um perfil novo no C2X, ele chega sozinho na tela.
//
// ⚠️ O QUE SAIU: os cards "Com a bola agora". Eles respondiam "de quem eu cobro", e a mesma
// resposta está agora em dois lugares melhores — a pílula "parado com <perfil>" e a coluna "Na
// vez" do quadro, que filtra a lista no clique. Manter os três seria a terceira leitura do mesmo
// dado, que é justamente o que deixou a tela longa da primeira vez.
//
// ⚠️ E-MAIL DO ASSINANTE NÃO APARECE. O painel interno mostra o e-mail sob o nome; aqui não, nem
// no quadro nem no popup. Decisão registrada: esta tela é de cliente externo, os assinantes são o
// comprador do contrato, a imobiliária e gente da Careli, e a tela responde tudo o que precisa com
// NOME e PERFIL. O e-mail nem sai do servidor.
const CSS_ASSINATURAS = `
  /* Um card por perfil que assina. São 5 ou 6 no pior caso, então auto-fit resolve sem sobrar
     órfão: eles têm o mesmo peso visual e a quebra não cria hierarquia falsa. */
  .asn-taxas { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(184px, 1fr)); }
  .asn-blocos { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(252px, 1fr)); }
  .asn-apoio { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(330px, 1fr)); }
  /* A LINHA DA UNIDADE: identificação | barrinhas por grupo | situação. As barrinhas ficam com a
     maior fração de propósito, porque são elas que o dono lê de relance. */
  .asn-linha {
    align-items: center; display: grid; gap: 14px;
    grid-template-columns: minmax(140px, 1.05fr) minmax(0, 2.3fr) minmax(116px, 0.85fr);
  }
  /* ⚠️ O PDF FICA FORA DO BOTÃO DA LINHA, não dentro: <a> dentro de <button> é HTML inválido e o
     clique do link seria engolido pelo popup. A moldura é uma grade de duas células — a linha
     clicável e a célula do documento —, e é ela que põe o contrato no FIM da linha. */
  .asn-moldura { align-items: center; display: grid; grid-template-columns: minmax(0, 1fr) auto; }
  .asn-pdf { display: flex; justify-content: flex-end; padding: 0 10px 0 6px; }
  /* Abaixo de 960px as três colunas não cabem sem espremer as barrinhas a ponto de a fração não
     caber embaixo: empilha, e a linha vira um cartãozinho. */
  @media (max-width: 960px) { .asn-linha { gap: 10px; grid-template-columns: minmax(0, 1fr); } }
  .asn-grupos { display: flex; flex-wrap: wrap; gap: 10px; }
  .asn-grupo { flex: 1 1 88px; min-width: 78px; }
  /* A tabela recolhida rola DENTRO dela mesma (cabeçalho fixo): aberta, ela não pode empurrar a
     página de volta ao comprimento que o dono reprovou. */
  .asn-rolagem { max-height: 400px; overflow: auto; }
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
  /* A linha inteira é um botão (o popup é o destino do clique), então ela precisa do afago de
     hover e do anel de foco por teclado — senão vira alvo invisível para quem navega por Tab. */
  .asn-clicavel { background: transparent; border: none; cursor: pointer; display: block;
    font: inherit; text-align: left; width: 100%; }
  .asn-clicavel:hover { background: rgb(127 127 127 / .07); }
  .asn-clicavel:focus-visible { outline: 2px solid var(--inc-text); outline-offset: -2px; }
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

/** O recorte da lista: um estado, ou "parado com o perfil X". */
type RecorteDeAssinatura =
  | "concluidas"
  | "emissao"
  | "pendentes"
  | "todas"
  | `perfil:${string}`;

/** O que o clique num número do quadro por assinante manda a lista mostrar. */
type FiltroDeAssinante = { alvo: "aguardando" | "assinado" | "vez"; nome: string };

const ANCORA_DA_LISTA = "analitico-contratos";

function SecaoContratos({
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
    "Não foi possível carregar os contratos.",
  );

  const [busca, setBusca] = useState("");
  const [recorte, setRecorte] = useState<RecorteDeAssinatura>("todas");
  const [porAssinante, setPorAssinante] = useState<FiltroDeAssinante | null>(null);
  const [aberta, setAberta] = useState<null | UnidadeDeAssinatura>(null);

  /** O clique num número do quadro joga a lista naquele recorte e desce até ela. */
  const filtrarPorAssinante = useCallback((filtro: FiltroDeAssinante) => {
    setPorAssinante(filtro);
    setRecorte("todas");
    document.getElementById(ANCORA_DA_LISTA)?.scrollIntoView({ behavior: "smooth" });
  }, []);

  if (estado.tipo === "carregando") return <Aviso texto="Carregando os contratos…" />;
  if (estado.tipo === "erro") return <Aviso texto={estado.mensagem} tom="erro" />;

  const { assinantes, aviso, fila, kpis, taxas, unidades } = estado.dados;

  if (unidades.length === 0 && kpis.aguardandoEmissao === 0) {
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <style>{CSS_ASSINATURAS}</style>
        <Aviso texto="Nenhuma venda deste recorte chegou à etapa de contrato ainda." />
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* Layout responsivo em classe pela mesma razão do CSS_RESUMO: media query não alcança
          estilo inline, e as barrinhas precisam empilhar no celular. */}
      <style>{CSS_ASSINATURAS}</style>

      <FaixaDeTaxas kpis={kpis} taxas={taxas} />
      <BlocosDoPainel kpis={kpis} />

      <ListaDeUnidades
        aviso={aviso}
        busca={busca}
        onAbrir={setAberta}
        onBuscar={setBusca}
        onLimparAssinante={() => setPorAssinante(null)}
        onRecorte={setRecorte}
        porAssinante={porAssinante}
        recorte={recorte}
        unidades={unidades}
      />

      <div className="asn-apoio">
        {fila.length > 0 ? <SecaoDaFila fila={fila} /> : null}
        <QuadroDeAssinantes
          assinantes={assinantes}
          onFiltrar={filtrarPorAssinante}
          selecionado={porAssinante}
        />
      </div>

      {aberta ? <ModalDoEsquema onFechar={() => setAberta(null)} unidade={aberta} /> : null}
    </div>
  );
}

// ── A FAIXA DE CIMA: a taxa de cada elo da cadeia ───────────────────────────
//
// *"esses cards poderiam trazer a taxa de assinatura das imobiliárias, Careli, coordenação,
// incorporador"* (Lucas, 18/08/2026). O card responde uma pergunta só: em qual elo a assinatura
// emperra. O pior vem primeiro (a ordem sai do servidor) e ganha o vermelho de alerta do tema —
// o único destaque de cor da faixa, porque dourado não é estado.
//
// Os dois indicadores que não são taxa e que ele já tinha validado (tempo médio e aguardando
// emissão) não sumiram: desceram para o bloco "Emissão", logo abaixo.

function FaixaDeTaxas({
  kpis,
  taxas,
}: {
  kpis: DadosAssinaturas["kpis"];
  taxas: DadosAssinaturas["taxas"];
}) {
  if (taxas.length === 0) return null;

  // O pior elo é o primeiro da lista (o servidor já ordena por taxa). Só vira alerta se de fato
  // estiver atrás: com tudo assinado, destacar o "menos assinado" inventaria um problema.
  const pior = taxas[0];
  const destacar = pior !== undefined && pior.assinadas < pior.esperadas ? pior.perfil : null;

  return (
    <section style={{ ...cartao, padding: 16 }}>
      <div
        style={{
          alignItems: "baseline",
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 10px",
          justifyContent: "space-between",
          marginBottom: 12,
        }}
      >
        <h2 style={titulo}>Taxa de assinatura por perfil</h2>
        <span style={{ color: T.muted, fontSize: 12.5 }}>
          {kpis.unidadesTotalmenteAssinadas === kpis.unidadesComEnvio
            ? "Todos os contratos enviados estão assinados."
            : "Quem está mais atrasado aparece primeiro."}
        </span>
      </div>
      <div className="asn-taxas">
        {taxas.map((taxa) => (
          <CardDeTaxa
            alerta={taxa.perfil === destacar}
            assinadas={taxa.assinadas}
            esperadas={taxa.esperadas}
            key={taxa.perfil}
            perfil={taxa.perfil}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Um card de taxa: percentual grande, a fração embaixo ("21 de 23") e a barra fina do tile que o
 * dono já validou. A barra é monocromática (tinta do texto), e só o card mais atrasado troca para
 * o vermelho de alerta — cor por estado aqui viraria arco-íris com cinco perfis lado a lado.
 */
function CardDeTaxa({
  alerta,
  assinadas,
  esperadas,
  perfil,
}: {
  alerta: boolean;
  assinadas: number;
  esperadas: number;
  perfil: string;
}) {
  const percentual = esperadas > 0 ? (assinadas / esperadas) * 100 : 0;
  const completo = assinadas >= esperadas;
  const tinta = alerta ? T.danger : T.text;

  return (
    <div
      style={{
        background: alerta ? T.dangerBg : T.soft,
        border: `1px solid ${alerta ? T.danger : T.border}`,
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
          color: alerta ? T.danger : T.muted,
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: "0.05em",
          lineHeight: 1.35,
          overflowWrap: "anywhere",
          textTransform: "uppercase",
        }}
      >
        {perfil}
      </div>

      <div style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: 5 }}>
        <span style={{ color: tinta, fontSize: 27, fontWeight: 700, lineHeight: 1.05 }}>
          {pct1(percentual)}
        </span>
        <span style={{ color: alerta ? T.danger : T.muted, fontSize: 13, fontWeight: 600 }}>%</span>
      </div>

      <div style={{ color: T.muted, fontSize: 11, lineHeight: 1.4, marginTop: "auto" }}>
        {inteiro(assinadas)} de {inteiro(esperadas)} assinaturas
      </div>

      <div
        aria-hidden="true"
        style={{ background: T.border, borderRadius: 999, height: 4, overflow: "hidden" }}
      >
        <div
          style={{
            background: completo ? T.ok : tinta,
            height: "100%",
            width: `${Math.min(100, Math.max(0, percentual))}%`,
          }}
        />
      </div>
    </div>
  );
}

// ── OS BLOCOS DO PAINEL INTERNO, portados ───────────────────────────────────
// Comprador, Geral e Prazo do comprador · 7 dias são os três blocos do painel que o Lucas aprovou
// (`Bloco` + `Kpi` em modules/apolo/blocks/assinaturas/painel-assinatura.tsx), com os mesmos
// números e a mesma ordem. O quarto, "Emissão", guarda os dois indicadores que já estavam nesta
// aba e que ele validou: o tempo médio de geração até a última assinatura e o aguardando emissão.
//
// O cabeçalho dourado do bloco é o único uso de ouro aqui, e é o mesmo do painel: ele rotula,
// não sinaliza estado.

function BlocosDoPainel({ kpis }: { kpis: DadosAssinaturas["kpis"] }) {
  const unidades = kpis.unidadesComEnvio;

  return (
    <div className="asn-blocos">
      <BlocoDeKpi titulo="Comprador">
        <NumeroDoBloco cor={T.ok} rotulo="Unidades assinadas" valor={inteiro(kpis.compradorOk)} />
        <NumeroDoBloco rotulo="Unidades pendentes" valor={inteiro(kpis.compradorPendente)} />
        <NumeroDoBloco cor={T.gold} rotulo="Do total" valor={porcentagem(kpis.compradorOk, unidades)} />
      </BlocoDeKpi>

      <BlocoDeKpi titulo="Geral">
        <NumeroDoBloco rotulo="Total de unidades" valor={inteiro(unidades)} />
        <NumeroDoBloco
          cor={T.ok}
          rotulo="Unidades finalizadas"
          valor={inteiro(kpis.unidadesTotalmenteAssinadas)}
        />
        <NumeroDoBloco
          cor={T.gold}
          rotulo="Do total"
          valor={porcentagem(kpis.unidadesTotalmenteAssinadas, unidades)}
        />
      </BlocoDeKpi>

      <BlocoDeKpi titulo="Prazo do comprador · 7 dias">
        <NumeroDoBloco
          cor={kpis.compradorEmAtraso > 0 ? T.danger : undefined}
          rotulo="Em atraso"
          valor={inteiro(kpis.compradorEmAtraso)}
        />
        <NumeroDoBloco rotulo="Dias até assinar" valor={numeroOuTraco(kpis.diasAteAssinar)} />
        <NumeroDoBloco rotulo="Dias desde o envio" valor={numeroOuTraco(kpis.diasDesdeEnvio)} />
      </BlocoDeKpi>

      <BlocoDeKpi titulo="Emissão">
        <NumeroDoBloco rotulo="Tempo médio em dias" valor={numeroOuTraco(kpis.tempoMedioDias)} />
        <NumeroDoBloco
          rotulo="Aguardando emissão"
          valor={inteiro(kpis.aguardandoEmissao)}
        />
      </BlocoDeKpi>
    </div>
  );
}

const porcentagem = (parte: number, todo: number): string =>
  todo > 0 ? `${Math.round((100 * parte) / todo)}%` : "—";

const numeroOuTraco = (valor: null | number): string =>
  valor === null ? "—" : pct1(valor);

function BlocoDeKpi({ children, titulo }: { children: ReactNode; titulo: string }) {
  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      <h2
        style={{
          background: T.soft,
          borderBottom: `1px solid ${T.border}`,
          color: T.gold,
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: "0.12em",
          margin: 0,
          padding: "8px 16px",
          textTransform: "uppercase",
        }}
      >
        {titulo}
      </h2>
      <div style={{ display: "flex", gap: 8, padding: 16 }}>{children}</div>
    </div>
  );
}

function NumeroDoBloco({
  cor,
  rotulo,
  valor,
}: {
  cor?: string;
  rotulo: string;
  valor: string;
}) {
  return (
    <div style={{ flex: 1, minWidth: 0, textAlign: "center" }}>
      <span
        style={{
          color: cor ?? T.text,
          display: "block",
          fontSize: 26,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 700,
          lineHeight: 1.05,
        }}
      >
        {valor}
      </span>
      <span
        style={{
          color: T.muted,
          display: "block",
          fontSize: 11.5,
          lineHeight: 1.3,
          marginTop: 6,
        }}
      >
        {rotulo}
      </span>
    </div>
  );
}

// ── O PALCO: A LISTA DE CONTRATOS, POR UNIDADE ──────────────────────────────
//
// Uma linha por CONTRATO, rotulada pela unidade (a granularidade está declarada em
// lib/apolo/incorporador/assinaturas.ts: unidade revendida tem dois contratos, com esquemas
// diferentes, e fundir os dois inventaria um esquema que não existe). Desde a fusão, o contrato
// que ainda não saiu para assinar também é linha — sem barrinha, com o chip "Aguardando emissão".
//
// A ordem vem do servidor e é a do gargalo: pendente primeiro, a que espera há mais tempo no topo,
// e as concluídas no fim — visíveis, mas sem disputar o palco.

function ListaDeUnidades({
  aviso,
  busca,
  onAbrir,
  onBuscar,
  onLimparAssinante,
  onRecorte,
  porAssinante,
  recorte,
  unidades,
}: {
  aviso: null | string;
  busca: string;
  onAbrir: (unidade: UnidadeDeAssinatura) => void;
  onBuscar: (texto: string) => void;
  onLimparAssinante: () => void;
  onRecorte: (recorte: RecorteDeAssinatura) => void;
  porAssinante: FiltroDeAssinante | null;
  recorte: RecorteDeAssinatura;
  unidades: UnidadeDeAssinatura[];
}) {
  const alvo = busca.trim().toLowerCase();

  // A BUSCA VEM ANTES DAS PÍLULAS de propósito: a contagem da pílula tem que ser o que o clique
  // vai mostrar. Contar sobre tudo faria a pílula prometer 12 e entregar 2 com a busca ativa.
  const buscadas = useMemo(
    () =>
      unidades.filter((unidade) => {
        if (porAssinante) {
          const { alvo: situacao, nome } = porAssinante;
          const casa =
            situacao === "vez"
              ? unidade.naVez.includes(nome)
              : unidade.esquema.some((item) => item.nome === nome && item.situacao === situacao);
          if (!casa) return false;
        }
        if (!alvo) return true;

        // A IMOBILIÁRIA entrou na busca com a fusão: era campo pesquisável na visão antiga.
        return (
          unidade.unidade.toLowerCase().includes(alvo) ||
          (unidade.comprador ?? "").toLowerCase().includes(alvo) ||
          (unidade.contrato?.imobiliaria ?? "").toLowerCase().includes(alvo) ||
          unidade.empreendimento.toLowerCase().includes(alvo)
        );
      }),
    [alvo, porAssinante, unidades],
  );

  const pendentes = buscadas.filter((unidade) => !unidade.concluida);
  const concluidas = buscadas.length - pendentes.length;
  // O contrato que nem saiu para assinar: era o chip "Aguardando emissão" da visão antiga, e é o
  // único estado que a fração "x de y" não conta (não há nenhuma assinatura para contar).
  const aguardandoEmissao = buscadas.filter(
    (unidade) => unidade.situacao === "aguardando-emissao",
  ).length;

  // Os perfis que estão SEGURANDO alguma unidade, do que mais segura para o que menos segura.
  // ⚠️ Uma unidade parada em dois perfis (degrau dividido) conta nos dois: a soma das pílulas pode
  // passar do total de pendentes, e é assim que tem que ser — ela espera as duas assinaturas.
  const porPerfil = useMemo(() => {
    const contagem = new Map<string, number>();
    for (const unidade of pendentes) {
      for (const perfil of unidade.perfisNaVez) {
        contagem.set(perfil, (contagem.get(perfil) ?? 0) + 1);
      }
    }
    return [...contagem.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "pt-BR"),
    );
  }, [pendentes]);

  const lista = buscadas.filter((unidade) => {
    if (recorte === "pendentes") return !unidade.concluida;
    if (recorte === "concluidas") return unidade.concluida;
    if (recorte === "emissao") return unidade.situacao === "aguardando-emissao";
    if (recorte.startsWith("perfil:")) {
      return !unidade.concluida && unidade.perfisNaVez.includes(recorte.slice(7));
    }
    return true;
  });

  const variosEmpreendimentos =
    new Set(unidades.map((unidade) => unidade.empreendimento).filter(Boolean)).size > 1;

  return (
    <section id={ANCORA_DA_LISTA} style={cartao}>
      <div
        style={{
          alignItems: "baseline",
          display: "flex",
          flexWrap: "wrap",
          gap: "4px 10px",
          justifyContent: "space-between",
        }}
      >
        <h2 style={titulo}>Contratos por unidade</h2>
        <span style={{ color: T.muted, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
          {inteiro(lista.length)} de {inteiro(unidades.length)}{" "}
          {unidades.length === 1 ? "contrato" : "contratos"}
        </span>
      </div>
      <p style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.5, margin: "6px 0 0" }}>
        Cada barra é um perfil que assina aquele contrato. Clique na unidade para ver os dados do
        contrato e a tabela de assinatura, com quem já assinou e quem falta. O contrato assinado
        abre no ícone do fim da linha.
      </p>

      {porAssinante ? (
        <div
          style={{
            alignItems: "center",
            background: T.soft,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            marginTop: 12,
            padding: "8px 12px",
          }}
        >
          <span style={{ color: T.text, fontSize: 12.5 }}>
            {porAssinante.alvo === "vez"
              ? "Contratos parados com "
              : porAssinante.alvo === "assinado"
                ? "Contratos já assinados por "
                : "Contratos em que ainda não é a vez de "}
            <b>{porAssinante.nome}</b>
          </span>
          <button
            onClick={onLimparAssinante}
            style={{
              background: "transparent",
              border: `1px solid ${T.border}`,
              borderRadius: 999,
              color: T.sub,
              cursor: "pointer",
              fontFamily: fonte,
              fontSize: 11.5,
              marginLeft: "auto",
              padding: "4px 10px",
            }}
            type="button"
          >
            limpar
          </button>
        </div>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "14px 0 0" }}>
        <Pilula
          ativo={recorte === "todas"}
          onClick={() => onRecorte("todas")}
          rotulo={`Todas (${inteiro(buscadas.length)})`}
        />
        {pendentes.length > 0 ? (
          <Pilula
            ativo={recorte === "pendentes"}
            onClick={() => onRecorte(recorte === "pendentes" ? "todas" : "pendentes")}
            rotulo={`Pendentes (${inteiro(pendentes.length)})`}
          />
        ) : null}
        {concluidas > 0 ? (
          <Pilula
            ativo={recorte === "concluidas"}
            onClick={() => onRecorte(recorte === "concluidas" ? "todas" : "concluidas")}
            rotulo={`Concluídas (${inteiro(concluidas)})`}
          />
        ) : null}
        {/* O filtro por situação da visão antiga, no que ele tinha de único: as outras duas
            situações já são Pendentes e Concluídas. */}
        {aguardandoEmissao > 0 ? (
          <Pilula
            ativo={recorte === "emissao"}
            onClick={() => onRecorte(recorte === "emissao" ? "todas" : "emissao")}
            rotulo={`${SITUACAO_LABELS["aguardando-emissao"]} (${inteiro(aguardandoEmissao)})`}
          />
        ) : null}
      </div>

      {porPerfil.length > 0 ? (
        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            marginTop: 10,
          }}
        >
          <span
            style={{
              color: T.muted,
              fontSize: 10.5,
              fontWeight: 600,
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            Parado com
          </span>
          {porPerfil.map(([perfil, quantas]) => (
            <Pilula
              ativo={recorte === `perfil:${perfil}`}
              key={perfil}
              onClick={() =>
                onRecorte(recorte === `perfil:${perfil}` ? "todas" : `perfil:${perfil}`)
              }
              rotulo={`${perfil} (${inteiro(quantas)})`}
            />
          ))}
        </div>
      ) : null}

      <label
        style={{
          alignItems: "center",
          background: T.soft,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          display: "flex",
          gap: 8,
          marginTop: 12,
          maxWidth: 340,
          padding: "0 12px",
        }}
      >
        <Search aria-hidden="true" size={15} style={{ color: T.muted, flexShrink: 0 }} />
        <input
          onChange={(evento) => onBuscar(evento.target.value)}
          placeholder="Buscar por unidade, comprador ou imobiliária"
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

      {lista.length === 0 ? (
        <p style={{ color: T.muted, fontSize: 13, margin: "22px 0 6px", textAlign: "center" }}>
          Nenhum contrato neste recorte.
        </p>
      ) : (
        <div style={{ marginTop: 12 }}>
          {lista.map((unidade, indice) => (
            <div
              // O contrato sem envio tem envioId 0: a chave só fecha com empreendimento +
              // unidade, que é a chave de unidade do servidor.
              key={`${unidade.envioId}-${unidade.empreendimento}-${unidade.unidade}`}
              style={{ borderTop: indice === 0 ? "none" : `1px solid ${T.border}` }}
            >
              <LinhaDaUnidade
                mostrarEmpreendimento={variosEmpreendimentos}
                onAbrir={() => onAbrir(unidade)}
                unidade={unidade}
              />
            </div>
          ))}
        </div>
      )}

      {aviso ? (
        <p style={{ color: T.muted, fontSize: 12, lineHeight: 1.5, margin: "14px 0 0" }}>{aviso}</p>
      ) : null}
    </section>
  );
}

/**
 * A linha do contrato: identificação, uma barrinha por perfil daquele contrato, a situação e, no
 * FIM, o documento assinado.
 *
 * ⚠️ SÓ OS PERFIS DAQUELE CONTRATO desenham barra. Perfil que não assina ali não vira barra vazia,
 * porque barra vazia diz "falta alguém" de quem nunca foi chamado.
 *
 * ⚠️ O VALOR E A GERAÇÃO ficam numa linha de apoio, esmaecidos: eles vieram da visão antiga e são
 * consulta, não a pergunta da tela. Quem manda no destaque continua sendo a barrinha.
 */
function LinhaDaUnidade({
  mostrarEmpreendimento,
  onAbrir,
  unidade,
}: {
  mostrarEmpreendimento: boolean;
  onAbrir: () => void;
  unidade: UnidadeDeAssinatura;
}) {
  const percentual = unidade.total > 0 ? (unidade.assinadas / unidade.total) * 100 : 0;
  const apoio = [
    unidade.contrato ? brl(unidade.contrato.valorTabela) : null,
    unidade.contrato?.geradoEm ? `gerado em ${rotuloDaData(unidade.contrato.geradoEm)}` : null,
  ].filter(Boolean);

  return (
    <div className="asn-moldura">
      <button
        className="asn-clicavel"
        onClick={onAbrir}
        style={{ borderRadius: 10, padding: "12px 10px" }}
        title={`Ver o contrato de ${unidade.unidade || "esta unidade"}`}
        type="button"
      >
        <div className="asn-linha">
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                color: T.text,
                fontSize: 13.5,
                fontWeight: 700,
                overflowWrap: "anywhere",
              }}
            >
              {unidade.unidade || "unidade sem nome"}
              {mostrarEmpreendimento && unidade.empreendimento ? (
                <span style={{ color: T.muted, fontWeight: 500 }}> · {unidade.empreendimento}</span>
              ) : null}
            </div>
            <div
              style={{
                color: T.muted,
                fontSize: 11.5,
                lineHeight: 1.4,
                marginTop: 2,
                overflowWrap: "anywhere",
              }}
            >
              {unidade.comprador ?? "comprador não registrado no envio"}
            </div>
            {/* O VALOR E A GERAÇÃO da visão antiga. Sem contrato vivo por trás do envio, a linha
                simplesmente não tem esses dados e some com ela — nada de "R$ 0". */}
            {apoio.length > 0 ? (
              <div
                style={{
                  color: T.muted,
                  fontSize: 11,
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1.4,
                  marginTop: 3,
                  opacity: 0.85,
                }}
              >
                {apoio.join(" · ")}
              </div>
            ) : null}
          </div>

          {unidade.situacao === "aguardando-emissao" ? (
            // Contrato gerado que não saiu para assinar: não há esquema, e barrinha vazia mentiria.
            <div style={{ color: T.muted, fontSize: 12, lineHeight: 1.5 }}>
              O contrato foi gerado e ainda não saiu para assinatura.
            </div>
          ) : unidade.grupos.length === 0 ? (
            <div style={{ color: T.muted, fontSize: 12 }}>
              Nenhum assinante ficou registrado neste envio. Não há de quem cobrar sem refazer o
              envio.
            </div>
          ) : (
            <div className="asn-grupos">
              {unidade.grupos.map((grupo) => (
                <BarraDoGrupo grupo={grupo} key={grupo.perfil} />
              ))}
            </div>
          )}

          <div style={{ minWidth: 0 }}>
            {unidade.situacao === "aguardando-emissao" ? (
              // A situação da visão antiga, no chip da visão antiga: aqui não há fração para contar.
              <ChipDeAssinatura situacao={unidade.situacao} />
            ) : (
              <div
                style={{
                  color: T.text,
                  fontSize: 13,
                  fontVariantNumeric: "tabular-nums",
                  fontWeight: 700,
                }}
              >
                {inteiro(unidade.assinadas)} de {inteiro(unidade.total)}
                <span style={{ color: T.muted, fontWeight: 500 }}>
                  {" "}
                  · {Math.round(percentual)}%
                </span>
              </div>
            )}
            <div style={{ marginTop: 4 }}>
              {unidade.situacao === "aguardando-emissao" ? (
                <span style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.4 }}>
                  {unidade.contrato?.geradoEm
                    ? rotuloDeEspera(unidade.contrato.geradoEm.slice(0, 10))
                    : "sem data de geração registrada"}
                </span>
              ) : unidade.concluida ? (
                <span
                  style={{
                    alignItems: "center",
                    color: T.ok,
                    display: "inline-flex",
                    fontSize: 11.5,
                    fontWeight: 600,
                    gap: 5,
                  }}
                >
                  <CheckCircle2 aria-hidden="true" size={13} />
                  contrato completo
                </span>
              ) : (
                <span style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.4 }}>
                  {unidade.perfisNaVez.length > 0 ? (
                    <>
                      com <b style={{ color: T.text, fontWeight: 600 }}>
                        {unidade.perfisNaVez.join(" e ")}
                      </b>
                      {" · "}
                    </>
                  ) : null}
                  {rotuloDeEspera(unidade.enviadoEm)}
                </span>
              )}
            </div>
          </div>
        </div>
      </button>

      {/* *"no final dessa linha vai ter o contrato para ser baixado"*. Fora do <button> de
          propósito (link dentro de botão é HTML inválido) e "-" quando não há documento. */}
      <div className="asn-pdf">
        <BotaoDePdfDoContrato contrato={unidade.contrato} />
      </div>
    </div>
  );
}

/**
 * A barrinha de um perfil dentro do contrato: rótulo, trilha e fração.
 *
 * OS TRÊS ESTADOS, e por que só dois tons: completo enche em verde (o verde de concluído que o
 * portal já usa em "em dia" e "contrato completo"); o grupo DA VEZ enche na tinta do texto e traz
 * o rótulo em negrito, porque é ele que a linha existe para denunciar; quem ainda espera a vez
 * fica esmaecido. Cor por perfil viraria arco-íris com cinco barras lado a lado, e o dono pediu
 * explicitamente que não virasse.
 */
function BarraDoGrupo({ grupo }: { grupo: GrupoDaUnidade }) {
  const completo = grupo.assinadas >= grupo.total;
  const percentual = grupo.total > 0 ? (grupo.assinadas / grupo.total) * 100 : 0;
  const tinta = completo ? T.ok : grupo.naVez ? T.text : T.muted;

  return (
    <div className="asn-grupo" style={{ opacity: completo || grupo.naVez ? 1 : 0.6 }}>
      <div
        style={{
          color: grupo.naVez && !completo ? T.text : T.muted,
          fontSize: 10.5,
          fontWeight: grupo.naVez && !completo ? 700 : 500,
          letterSpacing: "0.02em",
          lineHeight: 1.3,
          marginBottom: 4,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={grupo.perfil}
      >
        {grupo.perfil}
      </div>
      <div
        aria-hidden="true"
        style={{
          background: T.border,
          borderRadius: 999,
          height: 6,
          // O anel só no grupo da vez: é o destaque que faz a linha ler "falta o Incorporador".
          boxShadow: grupo.naVez && !completo ? `0 0 0 1.5px ${T.text}` : "none",
          overflow: "hidden",
        }}
      >
        <div style={{ background: tinta, height: "100%", width: `${percentual}%` }} />
      </div>
      <div
        style={{
          color: T.muted,
          fontSize: 10.5,
          fontVariantNumeric: "tabular-nums",
          marginTop: 3,
        }}
      >
        {inteiro(grupo.assinadas)} de {inteiro(grupo.total)}
      </div>
    </div>
  );
}

// ── O POPUP: OS DADOS DO CONTRATO E A TABELA DE ASSINATURA DELE ─────────────
// *"ao clicar nessa unidade abre um popup que mostra o esquema de assinatura, quem assinou, quem
// falta"*. Mesmo esqueleto do ModalDaProposta: clique fora fecha, Esc fecha, corpo rolável.
//
// ⚠️ O CABEÇALHO "DADOS DO CONTRATO" É DA FUSÃO de 18/08/2026: gerado em, valor, imobiliária e
// faturado em vieram da visão Contratos antiga, mais o botão do documento. Eles ficam ACIMA da
// tabela de assinatura, que continua sendo o corpo do popup.
//
// TABELA e não linha do tempo: o dono usou a palavra "tabela" duas vezes, e o dado a favorece —
// metade dos empreendimentos assina com a ordem DESLIGADA (todo mundo no degrau 0), e uma linha do
// tempo vertical desenharia uma sequência que ali não existe. A coluna Ordem só aparece quando o
// contrato tem ordem de verdade.
//
// SEM FETCH: o esquema já veio com a lista, na mesma resposta escopada da sessão. Popup que abre
// instantâneo em cima de dado que já está na mão é melhor do que uma chamada nova ao C2X por
// clique.

function ModalDoEsquema({
  onFechar,
  unidade,
}: {
  onFechar: () => void;
  unidade: UnidadeDeAssinatura;
}) {
  useEffect(() => {
    function aoTeclar(evento: KeyboardEvent) {
      if (evento.key === "Escape") onFechar();
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  const percentual = unidade.total > 0 ? (unidade.assinadas / unidade.total) * 100 : 0;
  // Ordem de verdade = mais de um degrau no contrato. Com todos em 0 a coluna só repetiria zero.
  const temOrdem = new Set(unidade.esquema.map((item) => item.degrau)).size > 1;
  const sublinha = [unidade.comprador, unidade.empreendimento].filter(Boolean).join(" · ");
  const dados = unidade.contrato;

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
          maxWidth: 620,
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
              <FileText aria-hidden="true" size={16} style={{ color: T.sub }} />
              Contrato · {unidade.unidade || "unidade sem nome"}
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
          {/* ── OS DADOS DO CONTRATO (a visão Contratos antiga, inteira) ──────── */}
          <div style={{ borderBottom: `1px solid ${T.border}`, padding: "14px 20px" }}>
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
              <span
                style={{
                  color: T.muted,
                  fontSize: 10.5,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                Dados do contrato
              </span>
              <ChipDeAssinatura situacao={unidade.situacao} />
            </div>

            <div
              style={{
                display: "grid",
                gap: "12px 16px",
                gridTemplateColumns: "repeat(auto-fit, minmax(126px, 1fr))",
              }}
            >
              <FatoDoModal rotulo="Gerado em" valor={rotuloDaData(dados?.geradoEm ?? null) || "-"} />
              <FatoDoModal rotulo="Valor" valor={dados ? brl(dados.valorTabela) : "-"} />
              <FatoDoModal rotulo="Imobiliária" valor={dados?.imobiliaria ?? "-"} />
              {/* Por STRING: billing_date é DATE, e new Date mostraria a véspera. */}
              <FatoDoModal rotulo="Faturado em" valor={rotuloDeYmd(dados?.faturadoEm ?? null) || "-"} />
            </div>

            <div style={{ marginTop: 12 }}>
              <BotaoDePdfDoContrato contrato={unidade.contrato} largo />
            </div>
          </div>

          {/* ── O ANDAMENTO DA ASSINATURA ─────────────────────────────────────── */}
          {unidade.situacao === "aguardando-emissao" ? null : (
            <div style={{ borderBottom: `1px solid ${T.border}`, padding: "14px 20px" }}>
              <div
                style={{
                  alignItems: "baseline",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "2px 10px",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ color: T.text, fontSize: 13, fontWeight: 700 }}>
                  {inteiro(unidade.assinadas)} de {inteiro(unidade.total)} assinaturas
                </span>
                <span style={{ color: T.muted, fontSize: 12 }}>
                  enviado em {rotuloDeYmd(unidade.enviadoEm)} · {rotuloDeEspera(unidade.enviadoEm)}
                </span>
              </div>
              <div
                aria-hidden="true"
                style={{
                  background: T.border,
                  borderRadius: 999,
                  height: 6,
                  marginTop: 8,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    background: unidade.concluida ? T.ok : T.text,
                    height: "100%",
                    width: `${percentual}%`,
                  }}
                />
              </div>
            </div>
          )}

          {unidade.situacao === "aguardando-emissao" ? (
            <p style={{ color: T.muted, fontSize: 13, margin: 0, padding: 24, textAlign: "center" }}>
              O contrato foi gerado e ainda não saiu para assinatura. Quando ele for enviado, a
              tabela de assinatura aparece aqui.
            </p>
          ) : unidade.esquema.length === 0 ? (
            <p style={{ color: T.muted, fontSize: 13, margin: 0, padding: 24, textAlign: "center" }}>
              O contrato saiu para assinatura, mas nenhum assinante ficou registrado no envio. Não
              há de quem cobrar sem refazer o envio.
            </p>
          ) : (
            <div style={{ padding: "4px 10px 14px" }}>
              <table className="asn-tabela" style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    {temOrdem ? <th style={{ textAlign: "left" }}>Ordem</th> : null}
                    <th style={{ textAlign: "left" }}>Assinante</th>
                    <th style={{ textAlign: "left" }}>Perfil</th>
                    <th style={{ textAlign: "left" }}>Situação</th>
                    <th style={{ textAlign: "right" }}>Assinou em</th>
                  </tr>
                </thead>
                <tbody>
                  {unidade.esquema.map((item, indice) => (
                    <tr key={`${item.nome}-${item.perfil}-${indice}`}>
                      {temOrdem ? (
                        <td
                          style={{
                            color: T.muted,
                            fontSize: 12.5,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {item.degrau || "—"}
                        </td>
                      ) : null}
                      <td style={{ color: T.text, fontSize: 13, fontWeight: 600 }}>{item.nome}</td>
                      <td style={{ color: T.sub, fontSize: 12.5 }}>{item.perfil}</td>
                      <td>
                        <SeloDaSituacao situacao={item.situacao} />
                      </td>
                      <td
                        style={{
                          color: T.sub,
                          fontSize: 12.5,
                          fontVariantNumeric: "tabular-nums",
                          textAlign: "right",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {rotuloDeYmd(item.assinadoEm) || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* A legenda some no contrato completo: ali não há vez nem espera para explicar. */}
              {unidade.concluida ? null : (
                <p style={{ color: T.muted, fontSize: 11.5, lineHeight: 1.5, margin: "12px 10px 0" }}>
                  Quem está em <b>é a vez</b> pode assinar agora. Quem está em <b>aguardando</b> só
                  é chamado depois que os anteriores assinarem.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** O selo de situação do popup: verde para assinado, tinta forte para a vez, esmaecido para o resto. */
function SeloDaSituacao({ situacao }: { situacao: AssinaturaDoEsquema["situacao"] }) {
  const tom: CSSProperties =
    situacao === "assinado"
      ? { background: T.okBg, color: T.ok }
      : situacao === "vez"
        ? { background: T.soft, color: T.text }
        : { background: "transparent", color: T.muted };

  return (
    <span
      style={{
        ...tom,
        borderRadius: 999,
        display: "inline-block",
        fontSize: 11.5,
        fontWeight: situacao === "aguardando" ? 500 : 600,
        padding: "3px 9px",
        whiteSpace: "nowrap",
      }}
    >
      {situacao === "assinado" ? "Assinou" : situacao === "vez" ? "É a vez" : "Aguardando"}
    </span>
  );
}

// ── A FILA, DEGRAU A DEGRAU (porte do painel interno) ───────────────────────
//
// ⚠️ ELA SÓ APARECE QUANDO O RECORTE TEM ORDEM DE VERDADE. O servidor devolve a fila vazia quando
// todo mundo está no degrau 0 — medido no C2X em 18/08/2026, é o caso do Vista Alegre e de duas
// glebas da Lagoa Bonita, onde a ordem está desligada e todos assinam em paralelo.
//
// ⚠️ O NOME DO DEGRAU É DERIVADO DOS PERFIS que assinam nele, e não da tabela fixa do painel
// interno (1 Corretor/imobiliária, 2 Comprador e cônjuge, 3 Testemunhas…). Aquela tabela descreve
// o Vale do Ouro: no LBR a ordem 3 é da Imobiliária e a 4 do Comprador, então copiá-la escreveria
// "Testemunhas" onde está a imobiliária do cliente. Rótulo derivado do dado não mente.

function SecaoDaFila({ fila }: { fila: DadosAssinaturas["fila"] }) {
  return (
    <section style={cartao}>
      <h2 style={titulo}>A fila, degrau a degrau</h2>
      <p style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.5, margin: "6px 0 14px" }}>
        Quem está num degrau só é chamado depois que todos os anteriores assinarem.
      </p>
      <div style={{ display: "grid", gap: 10 }}>
        {fila.map((degrau) => {
          const percentual = degrau.total > 0 ? (100 * degrau.assinadas) / degrau.total : 0;

          return (
            <div
              key={degrau.degrau}
              style={{
                alignItems: "center",
                display: "grid",
                gap: 10,
                gridTemplateColumns: "minmax(96px, 132px) 1fr 42px",
              }}
            >
              <span style={{ color: T.text, fontSize: 12, minWidth: 0 }}>
                {degrau.degrau}. {degrau.perfis.join(", ") || "sem perfil"}
                <span style={{ color: T.muted, display: "block", fontSize: 11 }}>
                  {inteiro(degrau.assinadas)} de {inteiro(degrau.total)}
                </span>
              </span>
              <span
                style={{
                  background: T.border,
                  borderRadius: 999,
                  display: "block",
                  height: 14,
                  overflow: "hidden",
                }}
              >
                <i
                  style={{
                    background: percentual >= 100 ? T.ok : T.text,
                    display: "block",
                    height: "100%",
                    width: `${percentual}%`,
                  }}
                />
              </span>
              <span
                style={{
                  color: T.sub,
                  fontSize: 12,
                  fontVariantNumeric: "tabular-nums",
                  textAlign: "right",
                }}
              >
                {Math.round(percentual)}%
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── O QUADRO POR ASSINANTE (o quadro do painel interno, com os números clicáveis) ─
//
// Vira APOIO, e não palco: a pergunta principal da tela agora é por unidade. O que ele mantém do
// painel do Lucas é o que faz dele útil — as três colunas (assinado, assinar, aguardando) e o
// CLIQUE no número, que joga a lista de unidades naquele recorte.
//
// ⚠️ "ASSINAR" SÓ CONTA O QUE ESTÁ COM A PESSOA. A fila é ordenada, e somar tudo que ela não
// assinou dava um número que ela não tem como resolver: no painel interno o Northon aparecia com
// 181 pendências quando só 2 estavam de fato na vez dele. A regra vem do servidor (`marcarSituacao`).

function QuadroDeAssinantes({
  assinantes,
  onFiltrar,
  selecionado,
}: {
  assinantes: AssinanteDaTela[];
  onFiltrar: (filtro: FiltroDeAssinante) => void;
  selecionado: FiltroDeAssinante | null;
}) {
  const [busca, setBusca] = useState("");

  if (assinantes.length === 0) {
    return (
      <section style={cartao}>
        <h2 style={titulo}>Quadro por assinante</h2>
        <p style={{ color: T.muted, fontSize: 13, margin: "16px 0 4px", textAlign: "center" }}>
          Nenhum assinante registrado nos contratos deste recorte.
        </p>
      </section>
    );
  }

  const alvo = busca.trim().toLowerCase();
  const lista = [...assinantes]
    .filter((assinante) => (alvo ? assinante.nome.toLowerCase().includes(alvo) : true))
    .sort(
      (a, b) => b.naVez - a.naVez || b.assinou - a.assinou || a.nome.localeCompare(b.nome, "pt-BR"),
    );

  return (
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
        <h2 style={titulo}>Quadro por assinante</h2>
        <span style={{ color: T.muted, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>
          {inteiro(assinantes.length)} {assinantes.length === 1 ? "pessoa" : "pessoas"}
        </span>
      </div>
      <p style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.5, margin: "6px 0 12px" }}>
        Clique num número para ver quais unidades ele representa. Assinar é o que está com a pessoa
        agora; aguardando é o que ainda depende de quem assina antes dela.
      </p>

      <label
        style={{
          alignItems: "center",
          background: T.soft,
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          display: "flex",
          gap: 8,
          marginBottom: 12,
          maxWidth: 280,
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
            fontSize: 13.5,
            minWidth: 0,
            outline: "none",
            padding: "8px 0",
          }}
          value={busca}
        />
      </label>

      {lista.length === 0 ? (
        <p style={{ color: T.muted, fontSize: 13, margin: "18px 0 6px", textAlign: "center" }}>
          Nenhum assinante com esse nome neste recorte.
        </p>
      ) : (
        <div className="asn-rolagem">
          <table className="asn-tabela">
            <thead>
              <tr>
                {["Assinante", "Assinado", "Assinar", "Aguardando"].map((coluna) => (
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
                  <NumeroClicavel
                    aoClicar={() => onFiltrar({ alvo: "assinado", nome: assinante.nome })}
                    ativo={selecionado?.alvo === "assinado" && selecionado.nome === assinante.nome}
                    titulo={`Contratos que ${assinante.nome} já assinou`}
                    valor={assinante.assinou}
                  />
                  <NumeroClicavel
                    aoClicar={() => onFiltrar({ alvo: "vez", nome: assinante.nome })}
                    ativo={selecionado?.alvo === "vez" && selecionado.nome === assinante.nome}
                    destaque
                    titulo={`Contratos esperando a assinatura de ${assinante.nome} agora`}
                    valor={assinante.naVez}
                  />
                  <NumeroClicavel
                    aoClicar={() => onFiltrar({ alvo: "aguardando", nome: assinante.nome })}
                    ativo={
                      selecionado?.alvo === "aguardando" && selecionado.nome === assinante.nome
                    }
                    titulo={`Contratos em que ${assinante.nome} ainda depende de outra assinatura`}
                    valor={assinante.aguardandoAnteriores}
                  />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * Um número do quadro que joga a lista de unidades naquele recorte.
 *
 * ⚠️ ZERO NÃO VIRA BOTÃO (a regra é a do painel interno): clicar num zero levaria a uma lista
 * vazia, e lista vazia depois de um clique parece tela quebrada. O zero fica esmaecido.
 */
function NumeroClicavel({
  aoClicar,
  ativo,
  destaque,
  titulo: dica,
  valor,
}: {
  aoClicar: () => void;
  ativo: boolean;
  destaque?: boolean;
  titulo: string;
  valor: number;
}) {
  if (valor === 0) {
    return <NumeroDaColuna valor={0} />;
  }

  return (
    <td style={{ textAlign: "right" }}>
      <button
        onClick={aoClicar}
        style={{
          background: ativo ? T.btnBg : "transparent",
          border: "none",
          borderRadius: 7,
          color: ativo ? T.btnFg : T.text,
          cursor: "pointer",
          fontFamily: fonte,
          fontSize: 13,
          fontVariantNumeric: "tabular-nums",
          fontWeight: destaque ? 700 : 500,
          padding: "3px 8px",
          textDecoration: ativo ? "none" : "underline dotted",
          textUnderlineOffset: 3,
        }}
        title={dica}
        type="button"
      >
        {inteiro(valor)}
      </button>
    </td>
  );
}

/**
 * Uma célula de número do quadro: tabular-nums para as casas alinharem e ZERO esmaecido, para o
 * olho pular direto no que tem número.
 */
function NumeroDaColuna({ valor }: { valor: number }) {
  const zero = valor === 0;

  return (
    <td
      style={{
        color: zero ? T.muted : T.text,
        fontSize: 13,
        fontVariantNumeric: "tabular-nums",
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
