"use client";

import {
  Archive,
  ArrowLeft,
  CalendarDays,
  ChevronRight,
  Flame,
  LayoutDashboard,
  ListOrdered,
  Loader2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { dataDoLancamento, nomeDoLancamento } from "@/lib/prometeu/lancamento";
import type { PrometeuEvento } from "@/lib/prometeu/types";
import { CentralView } from "@/modules/prometeu/blocks/central/central-view";
import { FilaView } from "@/modules/prometeu/blocks/fila/fila-view";
import { fetchEventos } from "@/modules/prometeu/data/prometeu-operations";
import { LancamentoProvider } from "@/modules/prometeu/lancamento-contexto";
import { fonte } from "@/modules/publico/ui/tokens";

import { T, useTemaDoPortal } from "./tema";

// LANÇAMENTO — a tela do Prometeu dentro do portal COMERCIAL (o Hércules da Gurgel).
//
// Pedido do Lucas (02/09/2026): *"a tela de lançamento (a tela do prometeu) só com a fila e a
// central"*. É isso e nada mais: o coordenador escolhe o lançamento e opera a FILA (quem está
// habilitado e ainda não chegou) e a CENTRAL (o comando do dia). Setup, etiqueta, check-in de
// posto, telão e relatórios continuam no hub — o coordenador não monta lançamento, ele opera.
//
// AS DUAS VIEWS SÃO AS MESMAS DO HUB, sem cópia: `FilaView` e `CentralView` já falam com
// /api/prometeu/* por fetch same-origin, e sem sessão Supabase o cliente simplesmente não manda
// Authorization — o cookie do portal (`apolo_inc`) vai junto. Duas portas o deixam passar, e as
// duas precisam conhecer a rota: o GATE do proxy (proxy.ts, lista de caminhos EXATOS liberados
// para o `apolo_inc` sob /api/prometeu/) e, dentro da rota, `autorizarOperacaoComCoordenador`
// (lib/prometeu/operador-server.ts), que reconhece o coordenador e carrega o recorte dele.
// GET /api/prometeu/eventos já devolve só os lançamentos dos empreendimentos do vínculo dele; a
// lista aqui é o que a rota mandou.
//
// ⚠️ NEM TODA CHAMADA DAS DUAS VIEWS PASSA. Eventos, fila, credenciados, reservas e operadores
// têm recorte e estão liberadas; jornada (modal da ficha), link-fila, mesa, pa e palco ainda não
// conhecem o escopo do coordenador e respondem 401 para ele — fail-closed, de propósito, até cada
// uma ganhar o recorte. O que depende delas mostra o erro da rota, não dado de outro lançamento.
//
// A ESCOLHA DO LANÇAMENTO reproduz a tela inicial do Prometeu (blocks/selecao/selecao-lancamento):
// vivos primeiro, encerrados e arquivados no fim, para consulta. Ela NÃO é reutilizada porque
// veste o tema do hub (classes `bg-canvas`, `text-ink`) e carrega o botão "Novo lançamento", que
// leva ao Setup — porta que o coordenador não tem.
//
// ⚠️ ARQUIVADO CONTINUA NA LISTA, igual ao hub (Lucas, 31/08/2026: *"quero que mesmo arquivado
// deixa aparecendo igual aos outros"*). É a única porta para a fila e a central de um dia que
// já passou; sumir daqui seria perder o acesso ao histórico.

type SubAba = "central" | "fila";

const STATUS_ROTULO: Record<string, string> = {
  ativo: "Preparação",
  em_andamento: "Em andamento",
  encerrado: "Encerrado",
  rascunho: "Rascunho",
};

// A prioridade de quem está VIVO: quem está em andamento manda, depois o ativo, depois o
// rascunho — a mesma régua de `eventoDoDia` (lib/prometeu/evento-do-dia). Dentro da mesma
// prioridade vale a ordem em que a rota mandou, para dois lançamentos ativos não trocarem de
// lugar entre uma carga e outra.
const PRIORIDADE_DO_STATUS: Record<string, number> = {
  ativo: 1,
  em_andamento: 0,
  rascunho: 2,
};

function estaEncerrado(evento: PrometeuEvento): boolean {
  return Boolean(evento.arquivadoEm) || evento.status === "encerrado";
}

// ⚠️ AS CLASSES DA FILA SÃO DO HUB, E O PORTAL TEM OUTRO TEMA. `FilaView` pinta com as cores
// semânticas do Tailwind (`bg-surface`, `text-ink`, `border-line`…), que o `@theme` do hub declara
// no `:root` como `var(--color-*)` apontando para a paleta `--uix-*` que o ThemeProvider do hub
// escreve no <html>. Aqui dentro o <html> está no tema do HUB (claro, para quem não tem sessão
// lá) enquanto o portal abre ESCURO por padrão — sem este bloco a fila sairia um retângulo claro
// no meio da tela escura, com a Central escura logo ao lado.
//
// A saída é redeclarar as MESMAS variáveis `--color-*` neste contêiner, apontando para os tokens
// do portal (`--inc-*`, de ./tema). Propriedade personalizada desce: todo `bg-surface` daqui para
// dentro passa a valer `--inc-card`, e a fila muda de tema junto com o alternador do portal, sem
// tocar em uma linha do FilaView. Funciona porque o `@theme` do hub NÃO é `inline`: as classes
// emitem `var(--color-surface)` e não o valor final.
//
// E o `data-uix-theme` no mesmo contêiner: é o que a Central (`[data-uix-theme="dark"] .pcx`) e
// as variantes `dark:` do Tailwind (`[data-uix-theme="dark"] *`) leem para escurecer. Vai no
// elemento, não no <html>, para não mexer no tema do hub de quem tem as duas sessões.
//
// ⚠️ UM CASO NÃO SE DESFAZ DAQUI: hub no escuro (o <html>) e portal no claro. O seletor da
// Central casa com QUALQUER ancestral escuro, então ela ficaria escura dentro do portal claro.
// Não acontece com o coordenador (ele não tem sessão do hub); acontece com quem usa os dois no
// mesmo navegador e escolhe temas opostos. Está registrado, não resolvido.
const CSS_LANCAMENTO = `
  .inc-lanc-prometeu {
    --color-canvas: var(--inc-page);
    --color-surface: var(--inc-card);
    --color-raised: var(--inc-card);
    --color-subtle: var(--inc-soft);
    --color-inverse: var(--inc-btn-bg);
    --color-ink: var(--inc-text);
    --color-ink-soft: var(--inc-sub);
    --color-ink-muted: var(--inc-muted);
    --color-line: var(--inc-border);
    --color-line-strong: var(--inc-border);
    --color-brand: var(--inc-gold);
    --color-brand-ink: var(--inc-btn-fg);
    color: var(--inc-text);
    /* A fila e a central rolam POR DENTRO, como no hub: com altura definida aqui, o \`h-full\`
       das duas tem de onde medir e o cabeçalho da tabela da fila continua grudado no topo. */
    display: flex;
    flex-direction: column;
    height: calc(100dvh - 236px);
    min-height: 480px;
  }
  .inc-lanc-prometeu > * { flex: 1 1 auto; min-height: 0; }
  /* ⚠️ O MESMO BREAKPOINT DA CASCA (TEMA_CSS): abaixo de 860px o menu lateral vira um bloco em
     cima (.inc-shell { display:block }) e os 236px deixam de ser a conta certa — o contêiner
     passava da viewport e a página ganhava rolagem dupla (fora e dentro da fila), com o cabeçalho
     da tabela escondido atrás do menu. No celular a altura é do conteúdo. */
  @media (max-width: 860px) {
    .inc-lanc-prometeu { height: auto; min-height: 70dvh; }
  }

  /* O cartão de lançamento acende a borda dourada ao passar o mouse — o mesmo sinal da tela
     inicial do Prometeu. Em CSS porque :hover não existe em estilo inline. */
  .inc-lanc-card { transition: border-color .15s ease; }
  .inc-lanc-card:hover { border-color: var(--inc-gold) !important; }
  .inc-lanc-card:hover .inc-lanc-seta { color: var(--inc-text); }
`;

export function TelaLancamento() {
  const [eventos, setEventos] = useState<PrometeuEvento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);
  const [escolhido, setEscolhido] = useState<null | PrometeuEvento>(null);
  const [subAba, setSubAba] = useState<SubAba>("fila");

  useEffect(() => {
    let vivo = true;
    // `true` = com arquivados. É a tela de ESCOLHA, a única que pede a lista completa; a fila e
    // a central seguem pedindo sem arquivados, como no hub.
    void fetchEventos(true).then((r) => {
      if (!vivo) return;
      if (r.error) setErro(r.error);
      else setEventos(r.data ?? []);
      setCarregando(false);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const { encerrados, vivos } = useMemo(() => {
    const ordenados = eventos
      .map((evento, indice) => ({ evento, indice }))
      .sort((a, b) => {
        const pa = PRIORIDADE_DO_STATUS[a.evento.status] ?? 9;
        const pb = PRIORIDADE_DO_STATUS[b.evento.status] ?? 9;
        return pa - pb || a.indice - b.indice;
      })
      .map(({ evento }) => evento);

    return {
      encerrados: eventos.filter(estaEncerrado),
      vivos: ordenados.filter((evento) => !estaEncerrado(evento)),
    };
  }, [eventos]);

  return (
    <>
      <style>{CSS_LANCAMENTO}</style>

      {escolhido ? (
        <>
          <CabecalhoDoLancamento
            aoTrocar={() => setEscolhido(null)}
            evento={escolhido}
            onSubAba={setSubAba}
            subAba={subAba}
          />
          <ConteudoDoPrometeu evento={escolhido} subAba={subAba} />
        </>
      ) : (
        <>
          <h1 style={{ color: T.text, fontSize: 20, fontWeight: 600, margin: "0 0 4px" }}>
            Lançamento
          </h1>
          <p style={{ color: T.muted, fontSize: 13.5, margin: "0 0 18px" }}>
            A fila e a central do dia, nos lançamentos dos seus empreendimentos. Escolha um para
            operar.
          </p>

          {erro ? <Aviso texto={erro} tom="erro" /> : null}

          {carregando ? (
            <Aviso texto="Carregando os lançamentos…" tom="neutro" />
          ) : eventos.length === 0 && !erro ? (
            <Aviso texto="Nenhum lançamento nos seus empreendimentos." tom="neutro" />
          ) : (
            <div style={{ display: "grid", gap: 10, maxWidth: 720 }}>
              {vivos.map((evento) => (
                <CartaoDeLancamento
                  aoEscolher={() => {
                    setEscolhido(evento);
                    setSubAba("fila");
                  }}
                  evento={evento}
                  key={evento.id}
                />
              ))}
              {vivos.length === 0 && eventos.length > 0 ? (
                <Aviso texto="Nenhum lançamento em preparação ou em andamento." tom="neutro" />
              ) : null}

              {encerrados.length > 0 ? (
                <>
                  <p
                    style={{
                      color: T.muted,
                      fontSize: 11,
                      fontWeight: 700,
                      letterSpacing: "0.12em",
                      margin: "12px 0 0",
                      padding: "0 4px",
                      textTransform: "uppercase",
                    }}
                  >
                    Encerrados — consulta
                  </p>
                  {encerrados.map((evento) => (
                    <CartaoDeLancamento
                      aoEscolher={() => {
                        setEscolhido(evento);
                        setSubAba("fila");
                      }}
                      consulta
                      evento={evento}
                      key={evento.id}
                    />
                  ))}
                </>
              ) : null}
            </div>
          )}
        </>
      )}
    </>
  );
}

// ── A ESCOLHA ───────────────────────────────────────────────────────────────

function CartaoDeLancamento({
  aoEscolher,
  consulta = false,
  evento,
}: {
  aoEscolher: () => void;
  /** Encerrado ou arquivado: entra apagado, para consulta, sem passar por operação. */
  consulta?: boolean;
  evento: PrometeuEvento;
}) {
  const nome = nomeDoLancamento(evento) || evento.nome;
  const data = dataDoLancamento(evento.dataEvento);
  const codigo = evento.enterpriseCode?.trim() ?? "";
  // O nome do EVENTO aparece só quando é outra coisa além do empreendimento ("2ª fase", "dia 2"):
  // repetir "Vale do Ouro" embaixo de "Vale do Ouro" é ruído.
  const nomeDoEvento = evento.nome?.trim() && evento.nome.trim() !== nome ? evento.nome.trim() : "";

  return (
    <button
      className="inc-lanc-card"
      onClick={aoEscolher}
      style={{
        alignItems: "center",
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 14,
        cursor: "pointer",
        display: "flex",
        fontFamily: fonte,
        gap: 14,
        opacity: consulta ? 0.75 : 1,
        padding: "14px 18px",
        textAlign: "left",
        width: "100%",
      }}
      type="button"
    >
      <span
        aria-hidden="true"
        style={{
          alignItems: "center",
          border: `1px solid ${consulta ? T.border : T.gold}`,
          borderRadius: 12,
          color: consulta ? T.muted : T.gold,
          display: "grid",
          flex: "0 0 auto",
          height: 42,
          placeItems: "center",
          width: 42,
        }}
      >
        {consulta ? <Archive size={19} /> : <Flame size={19} />}
      </span>

      <span style={{ flex: "1 1 auto", minWidth: 0 }}>
        <span
          style={{
            color: T.text,
            display: "block",
            fontSize: 15.5,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {nome}
        </span>
        <span
          style={{
            alignItems: "center",
            color: T.muted,
            display: "flex",
            flexWrap: "wrap",
            fontSize: 12.5,
            gap: 8,
            marginTop: 4,
          }}
        >
          {nomeDoEvento ? <span style={{ color: T.sub }}>{nomeDoEvento}</span> : null}
          {codigo ? <Chip texto={codigo} /> : null}
          <span style={{ alignItems: "center", display: "inline-flex", gap: 5 }}>
            <CalendarDays aria-hidden="true" size={13} />
            {data || "sem data"}
          </span>
          <Chip texto={STATUS_ROTULO[evento.status] ?? evento.status} />
          {/* ⚠️ ARQUIVADO PRECISA SE ANUNCIAR: divide a lista com os encerrados, mas não é a mesma
              coisa. Encerrado fechou o dia; arquivado saiu de circulação e não recebe check-in. */}
          {evento.arquivadoEm ? <Chip texto="Arquivado" /> : null}
        </span>
      </span>

      <ChevronRight
        aria-hidden="true"
        className="inc-lanc-seta"
        size={18}
        style={{ color: T.muted, flex: "0 0 auto" }}
      />
    </button>
  );
}

function Chip({ texto }: { texto: string }) {
  return (
    <span
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        padding: "1px 8px",
      }}
    >
      {texto}
    </span>
  );
}

// O mesmo bloco de estado das outras telas do portal (TelaCarteira): tracejado para o vazio e
// para o "carregando", sólido e vermelho para o erro, com a MENSAGEM da rota — é ela que diz se
// foi sessão vencida, base fora ou empreendimento sem vínculo.
function Aviso({ texto, tom }: { texto: string; tom: "erro" | "neutro" }) {
  const erro = tom === "erro";
  return (
    <div
      style={{
        alignItems: "center",
        background: erro ? T.dangerBg : T.card,
        border: `1px ${erro ? "solid" : "dashed"} ${erro ? T.danger : T.border}`,
        borderRadius: 14,
        color: erro ? T.danger : T.muted,
        display: "flex",
        fontSize: 14,
        gap: 10,
        justifyContent: "center",
        marginBottom: 12,
        maxWidth: 720,
        padding: erro ? "14px 18px" : 40,
        textAlign: "center",
      }}
    >
      {!erro && texto.startsWith("Carregando") ? (
        <Loader2 aria-hidden="true" className="inc-girando" size={16} />
      ) : null}
      {texto}
    </div>
  );
}

// ── O LANÇAMENTO ESCOLHIDO ──────────────────────────────────────────────────

const SUB_ABAS: { chave: SubAba; Icone: typeof ListOrdered; rotulo: string }[] = [
  { chave: "fila", Icone: ListOrdered, rotulo: "Fila" },
  { chave: "central", Icone: LayoutDashboard, rotulo: "Central" },
];

function CabecalhoDoLancamento({
  aoTrocar,
  evento,
  onSubAba,
  subAba,
}: {
  aoTrocar: () => void;
  evento: PrometeuEvento;
  onSubAba: (aba: SubAba) => void;
  subAba: SubAba;
}) {
  const nome = nomeDoLancamento(evento) || evento.nome;
  const data = dataDoLancamento(evento.dataEvento);
  const status = evento.arquivadoEm
    ? "Arquivado"
    : (STATUS_ROTULO[evento.status] ?? evento.status);

  // ⚠️ ARQUIVADO SÓ TEM A FILA. A Central pede a lista de lançamentos SEM arquivados
  // (fetchEventos() sem flag) e, quando nenhum lançamento vivo sobra no recorte, cai no
  // "Nenhum lançamento cadastrado ainda" com o botão "Criar o primeiro" — cujo POST exige
  // sessão do hub e devolve 401 ao coordenador. Arquivado é consulta, e a fila é a porta do
  // histórico; a Central fica para os vivos.
  const subAbas = evento.arquivadoEm ? SUB_ABAS.filter((s) => s.chave === "fila") : SUB_ABAS;

  return (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        flexWrap: "wrap",
        gap: 12,
        marginBottom: 14,
      }}
    >
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <button
          onClick={aoTrocar}
          style={{
            alignItems: "center",
            background: "transparent",
            border: "none",
            color: T.muted,
            cursor: "pointer",
            display: "inline-flex",
            fontFamily: fonte,
            fontSize: 12.5,
            gap: 6,
            margin: "0 0 4px",
            padding: 0,
          }}
          type="button"
        >
          <ArrowLeft aria-hidden="true" size={14} />
          Trocar lançamento
        </button>
        <h1
          style={{
            color: T.text,
            fontSize: 20,
            fontWeight: 600,
            margin: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {nome}
        </h1>
        <p style={{ color: T.muted, fontSize: 13, margin: "4px 0 0" }}>
          {[data, status].filter(Boolean).join(" · ")}
        </p>
      </div>

      {/* As duas sub-abas, no mesmo desenho do menu lateral do portal: fundo suave na ativa. */}
      <div
        aria-label="Tela do lançamento"
        role="tablist"
        style={{
          border: `1px solid ${T.border}`,
          borderRadius: 10,
          display: "inline-flex",
          gap: 2,
          padding: 3,
        }}
      >
        {subAbas.map(({ chave, Icone, rotulo }) => {
          const ativa = subAba === chave;
          return (
            <button
              aria-selected={ativa}
              key={chave}
              onClick={() => onSubAba(chave)}
              role="tab"
              style={{
                alignItems: "center",
                background: ativa ? T.soft : "transparent",
                border: "none",
                borderRadius: 8,
                color: ativa ? T.text : T.muted,
                cursor: "pointer",
                display: "inline-flex",
                fontFamily: fonte,
                fontSize: 13.5,
                fontWeight: ativa ? 600 : 500,
                gap: 7,
                padding: "7px 14px",
              }}
              type="button"
            >
              <Icone aria-hidden="true" size={15} strokeWidth={ativa ? 2.4 : 2} />
              {rotulo}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ConteudoDoPrometeu({ evento, subAba }: { evento: PrometeuEvento; subAba: SubAba }) {
  // O tema EFETIVO do portal (já resolvido o "seguir o aparelho") vira o atributo que a Central
  // e as variantes `dark:` leem. Ver a nota em CSS_LANCAMENTO.
  const { efetivo } = useTemaDoPortal();

  return (
    <div
      className="inc-lanc-prometeu"
      data-uix-theme={efetivo === "escuro" ? "dark" : "light"}
    >
      {/* `key` no provider: trocar de lançamento REMONTA a view. Sem isso a Fila/Central
          carregariam o novo id sobre o estado (busca, modal, polling) do lançamento anterior. */}
      <LancamentoProvider key={evento.id} value={evento}>
        {/* Arquivado nunca abre a Central (ver CabecalhoDoLancamento): mesmo com `subAba` presa
            em "central" de um lançamento anterior, aqui cai na fila. */}
        {subAba === "fila" || evento.arquivadoEm ? <FilaView /> : <CentralView />}
      </LancamentoProvider>
    </div>
  );
}
