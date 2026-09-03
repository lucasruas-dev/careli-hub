"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BadgeDollarSign,
  Ban,
  ChevronRight,
  Handshake,
  LandPlot,
  Layers,
  type LucideIcon,
  Tag,
  X,
} from "lucide-react";

import { fonte } from "@/modules/publico/ui/tokens";

import { T } from "./tema";
import { TelaVendas } from "./TelaVendas";

// PRODUTOS DO PORTAL COMERCIAL — a tela de Empreendimentos do Apolo, vestida com a paleta do
// portal e no lugar da aba Vendas do Hércules.
//
// Pedido do Lucas (02/09/2026): *"queria trazer aquela tela que temos no empreendimento (...)
// vendas tem que morar dentro da tela de produtos"*. Então a tela é a mesma que o time interno
// usa (modules/apolo/blocks/empreendimentos/empreendimentos-view.tsx: seis cards, a frase de
// contexto e a tabela com uma linha por PAI que expande os filhos), e o "Ver mais" de cada linha
// abre a TelaVendas fixa naquele produto, com botão de voltar. Vendas não sumiu: mudou de porta.
//
// O AGRUPAMENTO PAI/FILHOS vem do cadastro do Panteon (`hercules_empreendimentos`, 0123), não do
// `group:` do catálogo do C2X. Regra do Lucas: *"o espelho sempre será o pai (...) os filhos podem
// ter visões segmentadas"*. Quem soma é a rota (/api/incorporador/produtos/painel): o pai com
// filhos mostra a SOMA dos filhos autorizados, nunca o espelho do C2X, que está parado (o VLO no
// C2X ainda mostra 118 em negociação que já viraram vendas nos filhos). A tela não recalcula nada
// — só filtra os cards pela linha clicada.
//
// ⚠️ O RECORTE NÃO VEM DA TELA. Nada aqui manda id por query string para montar a lista: a rota
// lê o cookie assinado e devolve só o que a sessão do coordenador alcança. O id que sobe para a
// TelaVendas ("pai:<uuid>" ou o id do C2X) é um que a própria rota acabou de devolver, e a rota de
// vendas cruza com o escopo de novo do outro lado (fail-closed: fora do escopo = 403).

type ChaveDoCenario = "bloqueado" | "disponivel" | "negociacao" | "reservado" | "total" | "vendido";

type Contagem = { units: number; value: number };

type Cenario = Record<ChaveDoCenario, Contagem>;

type Filho = {
  codigo: string;
  id: string;
  nome: string;
  scenario: Cenario;
};

type Linha = {
  /** Rótulo de ESPELHO (números históricos do C2X, parados). Nulo na linha viva. */
  aviso?: null | string;
  cidade: null | string;
  /** "VLO", "LBF + LBR + LBP" (só os filhos autorizados) ou o code simples. */
  codigo: string;
  codes: string[];
  /** Filhos autorizados. Vazio = pai sem filho ou linha simples (empreendimento fora do cadastro). */
  etapas: number;
  filhos: Filho[];
  /** "pai:<uuid do cadastro>" para pai; id do C2X para filho ou linha simples. */
  id: string;
  nome: string;
  scenario: Cenario;
  uf: null | string;
};

type Painel = {
  /** Soma dos pais, sem repetir. */
  cards: Cenario;
  linhas: Linha[];
};

/** O produto aberto em Vendas: o id que a rota devolveu e o nome para o cabeçalho de lá. */
type ProdutoAberto = { id: string; nome: string };

// Os seis baldes, na ordem e com os ícones da tela interna (empreendimentos-view.tsx `buckets`).
const BALDES: Array<{ chave: ChaveDoCenario; icone: LucideIcon; rotulo: string }> = [
  { chave: "total", icone: Layers, rotulo: "Total" },
  { chave: "disponivel", icone: LandPlot, rotulo: "Disponível" },
  { chave: "reservado", icone: Tag, rotulo: "Reservado" },
  { chave: "negociacao", icone: Handshake, rotulo: "Em negociação" },
  { chave: "vendido", icone: BadgeDollarSign, rotulo: "Vendido" },
  { chave: "bloqueado", icone: Ban, rotulo: "Bloqueado" },
];

// A COR DE CADA BALDE, em variável CSS e não em hex solto no estilo inline. O motivo é o mesmo do
// tema.tsx: estilo inline não responde a media query nem ao atributo do <html>, e um roxo escuro
// que lê bem no claro some no fundo preto. Cada cor tem o par claro/escuro declarado nos TRÊS
// estados do tema (claro sem guarda · aparelho escuro guardado · escolha explícita), igual ao
// TEMA_CSS — nenhuma cor pode ter a única definição dentro de media query ou de [data-inc-tema].
//
// "total" não tem cor: é o neutro (T.text), como na tela interna.
const COR_DO_BALDE: Record<ChaveDoCenario, string> = {
  bloqueado: "var(--prd-bloqueado)",
  disponivel: "var(--prd-disponivel)",
  negociacao: "var(--prd-negociacao)",
  reservado: "var(--prd-reservado)",
  total: T.text,
  vendido: "var(--prd-vendido)",
};

const CORES_CLARAS = `
    --prd-disponivel:#2f7d59; --prd-reservado:#b45309; --prd-negociacao:#6d28d9;
    --prd-vendido:#1d4ed8; --prd-bloqueado:#c24135;
`;

const CORES_ESCURAS = `
    --prd-disponivel:#7cc4a1; --prd-reservado:#fbbf24; --prd-negociacao:#a78bfa;
    --prd-vendido:#60a5fa; --prd-bloqueado:#e08278;
`;

const CSS_PRODUTOS = `
  .inc-prd {${CORES_CLARAS}  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-inc-tema="claro"]) .inc-prd {${CORES_ESCURAS}  }
  }
  :root[data-inc-tema="escuro"] .inc-prd {${CORES_ESCURAS}  }

  /* O hover da linha mora aqui porque estilo inline não tem :hover. A linha SELECIONADA pinta
     pelo estilo inline (fundo suave + filete dourado), que vence a classe. */
  .inc-prd-linha { transition: background-color .12s ease; }
  .inc-prd-linha:hover { background: var(--inc-soft); }
`;

// R$ sem centavos: é VGV, e centavo em VGV é ruído (mesma régua do `brl` da TelaVendas).
const brl = (valor: number): string =>
  valor.toLocaleString("pt-BR", { currency: "BRL", maximumFractionDigits: 0, style: "currency" });

const inteiro = (valor: number): string => valor.toLocaleString("pt-BR");

export function TelaProdutosComercial() {
  const [painel, setPainel] = useState<Painel | null>(null);
  const [erro, setErro] = useState<null | string>(null);
  // A linha marcada, que FILTRA os cards (mesmo gesto da tela interna: 1 clique marca, o mesmo
  // clique de novo desmarca). Guarda o id, e não a linha: pai e filho moram em listas diferentes.
  const [selecionada, setSelecionada] = useState<null | string>(null);
  // O produto com Vendas aberta. Estado, e não rota: o portal é uma tela só, e o coordenador
  // volta para a tabela sem recarregar nada (mesmo desenho do masterplan na TelaProdutos).
  const [aberto, setAberto] = useState<ProdutoAberto | null>(null);

  useEffect(() => {
    let vivo = true;

    (async () => {
      try {
        const resposta = await fetch("/api/incorporador/produtos/painel", { cache: "no-store" });
        const corpo = (await resposta.json().catch(() => null)) as
          | { data?: Painel; error?: string }
          | null;

        if (!vivo) return;

        if (!resposta.ok || !corpo?.data) {
          setErro(corpo?.error ?? "Não foi possível carregar os produtos.");
          return;
        }

        setPainel(corpo.data);
      } catch {
        if (vivo) setErro("Não foi possível carregar os produtos.");
      }
    })();

    return () => {
      vivo = false;
    };
  }, []);

  // Id → o que a linha (pai, filho ou simples) mostra. É o índice que resolve o clique: a linha
  // selecionada pode ser um filho, e o filho não está em `linhas`, está dentro do pai.
  const porId = useMemo(() => {
    const indice = new Map<string, { nome: string; scenario: Cenario }>();

    for (const linha of painel?.linhas ?? []) {
      indice.set(linha.id, { nome: linha.nome, scenario: linha.scenario });
      for (const filho of linha.filhos) {
        indice.set(filho.id, { nome: filho.nome, scenario: filho.scenario });
      }
    }

    return indice;
  }, [painel]);

  if (aberto) {
    // ⚠️ A `key` é o id DE PROPÓSITO: a TelaVendas nasce com `empSelecionado = empFixo` e não
    // acompanha a prop depois. Trocar de produto sem passar pela tabela (não acontece hoje, mas
    // pode) precisa remontar a tela, e a key garante isso.
    return (
      <TelaVendas
        empFixo={aberto.id}
        key={aberto.id}
        nomeFixo={aberto.nome}
        onVoltar={() => setAberto(null)}
      />
    );
  }

  if (erro) return <Aviso texto={erro} tom="erro" />;
  if (!painel) return <Esqueleto />;

  if (painel.linhas.length === 0) {
    return <Aviso texto="Nenhum produto liberado para este acesso ainda." />;
  }

  const marcada = selecionada ? porId.get(selecionada) : undefined;
  const cenario = marcada?.scenario ?? painel.cards;
  const totalDeProdutos = painel.linhas.length;

  return (
    <div className="inc-prd" style={{ display: "grid", gap: 16 }}>
      <style>{CSS_PRODUTOS}</style>

      <header>
        <h1 style={{ color: T.text, fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>Produtos</h1>
        <p style={{ color: T.muted, fontSize: 13.5, margin: 0 }}>
          {totalDeProdutos === 1 ? "1 empreendimento" : `${totalDeProdutos} empreendimentos`},{" "}
          {inteiro(painel.cards.total.units)} unidades, {brl(painel.cards.total.value)} de VGV.
        </p>
      </header>

      {/* ── OS SEIS CARDS: o cenário de todos os pais, ou o da linha marcada ── */}
      <section
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(168px, 1fr))",
        }}
      >
        {BALDES.map((balde) => (
          <CardDoBalde
            contagem={cenario[balde.chave]}
            cor={COR_DO_BALDE[balde.chave]}
            icone={balde.icone}
            key={balde.chave}
            rotulo={balde.rotulo}
          />
        ))}
      </section>

      {/* Deixa explícito a que empreendimento os cards se referem. */}
      <div style={{ alignItems: "center", display: "flex", gap: 8, minHeight: 28 }}>
        {marcada ? (
          <button
            onClick={() => setSelecionada(null)}
            style={{
              alignItems: "center",
              background: "transparent",
              border: `1px solid ${T.gold}`,
              borderRadius: 999,
              color: T.gold,
              cursor: "pointer",
              display: "inline-flex",
              fontFamily: fonte,
              fontSize: 12,
              fontWeight: 600,
              gap: 6,
              padding: "5px 12px",
            }}
            title="Voltar a ver todos os empreendimentos"
            type="button"
          >
            {marcada.nome}
            <span style={{ color: T.muted, fontWeight: 500 }}>· clique de novo para ver todos</span>
            <X aria-hidden="true" size={13} />
          </button>
        ) : (
          <span style={{ color: T.muted, fontSize: 12, fontWeight: 500 }}>
            Todos os empreendimentos · clique numa linha para filtrar os cards
          </span>
        )}
      </div>

      {/* ── A TABELA: uma linha por pai, os filhos dobrados dentro ─────────── */}
      <section
        style={{
          background: T.card,
          border: `1px solid ${T.border}`,
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        {/* A tabela rola SOZINHA no celular: sem isto, a página inteira ganha rolagem horizontal. */}
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: 900, width: "100%" }}>
            <thead>
              <tr style={{ background: T.soft }}>
                <Cabecalho alinhar="left">Empreendimento</Cabecalho>
                <Cabecalho>Unidades</Cabecalho>
                <Cabecalho>Disponível</Cabecalho>
                <Cabecalho>Reservado</Cabecalho>
                <Cabecalho>Negociação</Cabecalho>
                <Cabecalho>Vendido</Cabecalho>
                <Cabecalho>Bloqueado</Cabecalho>
                <Cabecalho>VGV</Cabecalho>
                <Cabecalho alinhar="left"> </Cabecalho>
              </tr>
            </thead>
            <tbody>
              {painel.linhas.map((linha) => (
                <LinhasDoEmpreendimento
                  key={linha.id}
                  linha={linha}
                  onAbrir={setAberto}
                  onSelecionar={(id) => setSelecionada((atual) => (atual === id ? null : id))}
                  selecionada={selecionada}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ── AS LINHAS DE UM PAI (e dos filhos, quando abertas) ──────────────────────

function LinhasDoEmpreendimento({
  linha,
  onAbrir,
  onSelecionar,
  selecionada,
}: {
  linha: Linha;
  onAbrir: (produto: ProdutoAberto) => void;
  onSelecionar: (id: string) => void;
  selecionada: null | string;
}) {
  const [expandida, setExpandida] = useState(false);
  const temFilhos = linha.filhos.length > 0;
  const local = [linha.cidade, linha.uf].filter(Boolean).join("/");

  return (
    <>
      <tr
        className="inc-prd-linha"
        onClick={() => onSelecionar(linha.id)}
        style={estiloDaLinha(selecionada === linha.id)}
      >
        <td style={{ ...celula, padding: "10px 12px 10px 14px" }}>
          <div style={{ alignItems: "center", display: "flex", gap: 8 }}>
            {temFilhos ? (
              <button
                aria-expanded={expandida}
                aria-label={expandida ? "Recolher etapas" : "Expandir etapas"}
                onClick={(evento) => {
                  // O chevron só dobra/desdobra: sem o stop, cada abrir também marcava a linha.
                  evento.stopPropagation();
                  setExpandida((valor) => !valor);
                }}
                style={{
                  alignItems: "center",
                  background: T.soft,
                  border: `1px solid ${T.border}`,
                  borderRadius: 6,
                  color: T.muted,
                  cursor: "pointer",
                  display: "inline-flex",
                  flexShrink: 0,
                  height: 20,
                  justifyContent: "center",
                  padding: 0,
                  width: 20,
                }}
                type="button"
              >
                <ChevronRight
                  aria-hidden="true"
                  size={14}
                  style={{
                    transform: expandida ? "rotate(90deg)" : "none",
                    transition: "transform .15s ease",
                  }}
                />
              </button>
            ) : (
              <span style={{ display: "inline-block", flexShrink: 0, width: 20 }} />
            )}

            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  color: T.text,
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {linha.nome}
                {temFilhos ? (
                  <span style={{ color: T.muted, fontSize: 11, fontWeight: 500, marginLeft: 6 }}>
                    ({linha.etapas} {linha.etapas === 1 ? "etapa" : "etapas"})
                  </span>
                ) : null}
              </div>
              <div
                style={{
                  color: T.muted,
                  fontSize: 12,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {/* O aviso do espelho ("Histórico · mesmos lotes de VOC + VOL") entra na
                    sublinha: número parado do C2X não pode passar por pipeline vivo. */}
                {[linha.codigo, linha.aviso, local].filter(Boolean).join(" · ")}
              </div>
            </div>
          </div>
        </td>
        <CelulasDoCenario forte scenario={linha.scenario} />
        <td style={{ ...celula, textAlign: "right", whiteSpace: "nowrap" }}>
          <BotaoVerMais onClick={() => onAbrir({ id: linha.id, nome: linha.nome })} />
        </td>
      </tr>

      {expandida
        ? linha.filhos.map((filho) => (
            <tr
              className="inc-prd-linha"
              key={filho.id}
              onClick={() => onSelecionar(filho.id)}
              style={estiloDaLinha(selecionada === filho.id)}
            >
              <td style={{ ...celula, padding: "8px 12px 8px 42px" }}>
                <div style={{ color: T.sub, fontWeight: 600, letterSpacing: "0.02em" }}>
                  {filho.codigo}
                </div>
                {filho.nome && filho.nome !== filho.codigo ? (
                  <div style={{ color: T.muted, fontSize: 12 }}>{filho.nome}</div>
                ) : null}
              </td>
              <CelulasDoCenario scenario={filho.scenario} />
              <td style={{ ...celula, textAlign: "right", whiteSpace: "nowrap" }}>
                <BotaoVerMais onClick={() => onAbrir({ id: filho.id, nome: filho.nome })} />
              </td>
            </tr>
          ))
        : null}
    </>
  );
}

// A linha marcada ganha o fundo suave e o filete dourado à esquerda, como na tela interna. É
// estilo inline de propósito: vence o :hover da classe, então a marcada não "apaga" ao passar o
// mouse.
function estiloDaLinha(marcada: boolean) {
  return {
    background: marcada ? T.soft : undefined,
    boxShadow: marcada ? `inset 3px 0 0 ${T.gold}` : undefined,
    cursor: "pointer",
  } as const;
}

function CelulasDoCenario({ forte = false, scenario }: { forte?: boolean; scenario: Cenario }) {
  const neutro = { color: forte ? T.text : T.sub, fontWeight: forte ? 600 : 500 } as const;

  return (
    <>
      <td style={{ ...numero, ...neutro }}>{inteiro(scenario.total.units)}</td>
      <td style={{ ...numero, color: COR_DO_BALDE.disponivel }}>
        {inteiro(scenario.disponivel.units)}
      </td>
      <td style={{ ...numero, color: COR_DO_BALDE.reservado }}>
        {inteiro(scenario.reservado.units)}
      </td>
      <td style={{ ...numero, color: COR_DO_BALDE.negociacao }}>
        {inteiro(scenario.negociacao.units)}
      </td>
      {/* Vendido em negrito: é o número que o coordenador procura primeiro. */}
      <td style={{ ...numero, color: COR_DO_BALDE.vendido, fontWeight: 700 }}>
        {inteiro(scenario.vendido.units)}
      </td>
      <td style={{ ...numero, color: COR_DO_BALDE.bloqueado }}>
        {inteiro(scenario.bloqueado.units)}
      </td>
      <td style={{ ...numero, ...neutro }}>{brl(scenario.total.value)}</td>
    </>
  );
}

function Cabecalho({
  alinhar = "right",
  children,
}: {
  alinhar?: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <th
      style={{
        borderBottom: `1px solid ${T.border}`,
        color: T.muted,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        padding: "9px 12px",
        textAlign: alinhar,
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function BotaoVerMais({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={(evento) => {
        // O clique da linha marca/desmarca; o botão abre Vendas. Sem o stop, faria os dois.
        evento.stopPropagation();
        onClick();
      }}
      style={{
        background: T.soft,
        border: `1px solid ${T.border}`,
        borderRadius: 8,
        color: T.sub,
        cursor: "pointer",
        fontFamily: fonte,
        fontSize: 11.5,
        fontWeight: 600,
        padding: "5px 10px",
        whiteSpace: "nowrap",
      }}
      title="Abrir as vendas deste produto"
      type="button"
    >
      Ver mais
    </button>
  );
}

// ── O CARD DE UM BALDE ──────────────────────────────────────────────────────
// Ícone à esquerda, chip "N unid." à direita, o R$ grande e o rótulo embaixo — o KpiCard da tela
// interna (empreendimentos-view.tsx), com os tokens do portal no lugar das classes do hub.

function CardDoBalde({
  contagem,
  cor,
  icone: Icone,
  rotulo,
}: {
  contagem: Contagem;
  cor: string;
  icone: LucideIcon;
  rotulo: string;
}) {
  return (
    <div
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 14,
        minWidth: 0,
        padding: 14,
      }}
    >
      <div
        style={{
          alignItems: "flex-start",
          display: "flex",
          gap: 8,
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            alignItems: "center",
            background: T.soft,
            border: `1px solid ${T.border}`,
            borderRadius: 10,
            color: cor,
            display: "inline-flex",
            flexShrink: 0,
            height: 32,
            justifyContent: "center",
            width: 32,
          }}
        >
          <Icone aria-hidden="true" size={16} />
        </span>
        <span
          style={{
            background: T.soft,
            border: `1px solid ${T.border}`,
            borderRadius: 999,
            color: T.muted,
            fontSize: 10.5,
            fontVariantNumeric: "tabular-nums",
            fontWeight: 600,
            padding: "2px 8px",
            whiteSpace: "nowrap",
          }}
        >
          {inteiro(contagem.units)} unid.
        </span>
      </div>
      <p
        style={{
          color: T.text,
          fontSize: 18,
          fontVariantNumeric: "tabular-nums",
          fontWeight: 600,
          margin: "10px 0 0",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {brl(contagem.value)}
      </p>
      <p style={{ color: T.muted, fontSize: 12, fontWeight: 500, margin: 0 }}>{rotulo}</p>
    </div>
  );
}

// ── ESTADOS: carregando, erro, vazio ────────────────────────────────────────

function Esqueleto() {
  const pele = {
    background: T.card,
    border: `1px solid ${T.border}`,
    borderRadius: 14,
  } as const;

  return (
    <div aria-busy="true" aria-live="polite" style={{ display: "grid", gap: 12 }}>
      <span style={{ height: 0, overflow: "hidden", position: "absolute", width: 0 }}>
        Carregando
      </span>
      <div
        style={{
          display: "grid",
          gap: 10,
          gridTemplateColumns: "repeat(auto-fit, minmax(168px, 1fr))",
        }}
      >
        {BALDES.map((balde) => (
          <div className="animate-pulse" key={balde.chave} style={{ ...pele, height: 96 }} />
        ))}
      </div>
      <div className="animate-pulse" style={{ ...pele, height: 260 }} />
    </div>
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

const celula = {
  borderBottom: `1px solid ${T.border}`,
  color: T.sub,
  padding: "10px 12px",
  verticalAlign: "middle",
} as const;

// Coluna de número: tabular-nums para as casas alinharem, alinhado à direita.
const numero = {
  ...celula,
  fontVariantNumeric: "tabular-nums",
  fontWeight: 500,
  textAlign: "right",
  whiteSpace: "nowrap",
} as const;
