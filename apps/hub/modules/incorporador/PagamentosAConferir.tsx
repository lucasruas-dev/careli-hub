"use client";

import { Check, FileText, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { PagamentoAConferir } from "@/lib/lsoft/pagamentos-a-conferir";
import { fonte } from "@/modules/publico/ui/tokens";

import { T } from "./tema";

// PAGAMENTOS A CONFERIR — o bloco do Financeiro com o que a baixa do hub não resolveu sozinha.
//
// Lucas (30/09/2026): *"pode fazer a lista de pagamentos a conferir"*. De setembro em diante o boleto
// pago dá baixa na parcela do Garden sozinho; o que não casa com segurança aparece aqui, para o time
// abrir a ficha, resolver e marcar como conferido.
//
// ⚠️ A BUSCA É PRÓPRIA E NÃO TRAVA A CARTEIRA. A lista relê os pagamentos e as parcelas do mês, o que
// leva alguns segundos; se ela morasse no payload da carteira, a tela inteira esperaria por ela. O
// bloco só aparece quando a lista chega com algum item: sem nada a conferir, a tela fica como era.
//
// ⚠️ DOIS GRUPOS. O primeiro pede decisão e abre sozinho. O segundo é o boleto pago com a parcela em
// aberto na ficha de quem ainda está na LSoft Integração (falta dar a baixa) e fica recolhido: aberto,
// esconderia os poucos casos que importam.

type Lista = {
  conferidoDisponivel: boolean;
  conferir: PagamentoAConferir[];
  integracao: PagamentoAConferir[];
};

const brl = (valor: number): string =>
  valor.toLocaleString("pt-BR", { currency: "BRL", minimumFractionDigits: 2, style: "currency" });

/** `2026-09-16` -> `16/09/2026`. Recorte de texto: dia não tem fuso. */
const dia = (iso: null | string): string =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "-";

/** `2026-09` -> `09/2026`. */
const mes = (competencia: string): string =>
  /^\d{4}-\d{2}$/.test(competencia) ? `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}` : competencia;

export function PagamentosAConferirDoGarden({
  onAbrirFicha,
  versao,
}: {
  /** Abre a ficha do LSoft do cliente (a mesma que a linha da carteira abre). */
  onAbrirFicha: (codigo: string) => void;
  /** Sobe quando uma ficha fecha depois de gravar: a baixa dada nela pode ter resolvido um item. */
  versao: number;
}) {
  const [lista, setLista] = useState<Lista | null>(null);
  const [erro, setErro] = useState<null | string>(null);
  const ultimaBusca = useRef(0);

  const carregar = useCallback(async () => {
    // Só a última busca escreve na tela: a que volta depois de uma mais nova é descartada.
    const estaBusca = ++ultimaBusca.current;
    try {
      const r = await fetch("/api/incorporador/carteira/conferir", { cache: "no-store" });
      const corpo = (await r.json().catch(() => null)) as { data?: Lista; error?: string } | null;
      if (estaBusca !== ultimaBusca.current) return;
      if (!r.ok || !corpo?.data) {
        // 404 = este portal não tem a lista: o bloco simplesmente não existe para ele.
        setErro(r.status === 404 ? null : (corpo?.error ?? "Não foi possível carregar os pagamentos a conferir."));
        setLista(null);
        return;
      }
      // ⚠️ A RESPOSTA É CONFERIDA ANTES DE IR PARA A TELA. Um corpo 200 que não seja a lista (um proxy,
      // uma versão antiga da rota) derrubaria o Financeiro inteiro no `.length` de um campo que não
      // veio. Fora do formato, o bloco some e a carteira segue de pé.
      const { conferir, integracao } = corpo.data as Partial<Lista>;
      if (!Array.isArray(conferir) || !Array.isArray(integracao)) {
        setErro(null);
        setLista(null);
        return;
      }
      setErro(null);
      setLista({ conferidoDisponivel: corpo.data.conferidoDisponivel === true, conferir, integracao });
    } catch {
      if (estaBusca !== ultimaBusca.current) return;
      setErro("Não foi possível carregar os pagamentos a conferir.");
      setLista(null);
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar, versao]);

  // ⚠️ CONFERIDO TIRA A LINHA DAQUI, SEM RELER A LISTA (revisão de 30/09/2026). Reler custava a lista
  // inteira de novo a cada clique, e são dezenas de cliques para limpar um mês. O servidor já disse
  // que gravou; a próxima abertura da tela relê de verdade.
  const tirar = useCallback((cobrancaId: string) => {
    setLista((atual) =>
      atual
        ? {
            ...atual,
            conferir: atual.conferir.filter((item) => item.cobrancaId !== cobrancaId),
            integracao: atual.integracao.filter((item) => item.cobrancaId !== cobrancaId),
          }
        : atual,
    );
  }, []);

  if (erro) {
    return (
      <p role="alert" style={{ ...caixa, color: T.danger, fontSize: 12.5, margin: 0, padding: "10px 14px" }}>
        {erro}
      </p>
    );
  }
  if (!lista || (lista.conferir.length === 0 && lista.integracao.length === 0)) return null;

  return (
    <section style={{ ...caixa, overflow: "hidden", padding: 0 }}>
      {lista.conferir.length > 0 ? (
        <details open>
          <summary style={cabecalhoDoGrupo}>
            Pagamentos a conferir{" "}
            <span style={{ color: T.muted, fontSize: 12, fontWeight: 500 }}>({lista.conferir.length})</span>
          </summary>
          <Tabela
            conferidoDisponivel={lista.conferidoDisponivel}
            itens={lista.conferir}
            onAbrirFicha={onAbrirFicha}
            onConferido={tirar}
            onMudou={carregar}
          />
        </details>
      ) : null}

      {lista.integracao.length > 0 ? (
        <details>
          <summary
            style={{
              ...cabecalhoDoGrupo,
              borderTop: lista.conferir.length > 0 ? `1px solid ${T.border}` : "none",
            }}
          >
            Boletos pagos com a parcela em aberto na LSoft Integração{" "}
            <span style={{ color: T.muted, fontSize: 12, fontWeight: 500 }}>({lista.integracao.length})</span>
          </summary>
          <p style={{ color: T.muted, fontSize: 12.5, lineHeight: 1.5, margin: 0, padding: "0 16px 10px" }}>
            Estes clientes ainda não subiram para o Financeiro, e o boleto pago não baixa a parcela
            sozinho. Dê a baixa na ficha, com o valor e a data do boleto: feita a baixa, o boleto sai
            desta lista.
          </p>
          <Tabela
            conferidoDisponivel={lista.conferidoDisponivel}
            itens={lista.integracao}
            onAbrirFicha={onAbrirFicha}
            onConferido={tirar}
            onMudou={carregar}
          />
        </details>
      ) : null}
    </section>
  );
}

function Tabela({
  conferidoDisponivel,
  itens,
  onAbrirFicha,
  onConferido,
  onMudou,
}: {
  conferidoDisponivel: boolean;
  itens: PagamentoAConferir[];
  onAbrirFicha: (codigo: string) => void;
  onConferido: (cobrancaId: string) => void;
  onMudou: () => Promise<void> | void;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 12.5, minWidth: 900, width: "100%" }}>
        <thead>
          <tr style={{ background: T.soft }}>
            <th style={{ ...cabecalho, paddingLeft: 16 }}>Cliente</th>
            <th style={cabecalho}>Lote</th>
            <th style={cabecalho}>Mês</th>
            <th style={cabecalho}>Pago em</th>
            <th style={{ ...cabecalho, textAlign: "right" }}>Valor pago</th>
            <th style={cabecalho}>O que houve</th>
            <th style={cabecalho} />
          </tr>
        </thead>
        <tbody>
          {itens.map((item) => (
            <Linha
              conferidoDisponivel={conferidoDisponivel}
              item={item}
              key={item.cobrancaId}
              onAbrirFicha={onAbrirFicha}
              onConferido={onConferido}
              onMudou={onMudou}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Linha({
  conferidoDisponivel,
  item,
  onAbrirFicha,
  onConferido,
  onMudou,
}: {
  conferidoDisponivel: boolean;
  item: PagamentoAConferir;
  onAbrirFicha: (codigo: string) => void;
  onConferido: (cobrancaId: string) => void;
  onMudou: () => Promise<void> | void;
}) {
  const [aberto, setAberto] = useState(false);
  const [observacao, setObservacao] = useState("");
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<null | string>(null);
  // ⚠️ TRAVA CONTRA O CLIQUE DUPLO. O estado `gravando` só chega ao botão na renderização seguinte;
  // dois cliques no mesmo instante passariam os dois. A referência fecha a porta na hora.
  const enviando = useRef(false);

  async function confirmar() {
    if (enviando.current) return;
    enviando.current = true;
    setGravando(true);
    setErro(null);
    try {
      const r = await fetch("/api/incorporador/carteira/conferir", {
        // A impressão é a do motivo que ESTA linha mostra: se o problema mudou no servidor desde que
        // a lista abriu, ele recusa (409) em vez de conferir o que ninguém viu.
        body: JSON.stringify({ cobrancaId: item.cobrancaId, impressao: item.impressao, observacao }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const corpo = (await r.json().catch(() => null)) as { error?: string } | null;
      if (r.ok) {
        onConferido(item.cobrancaId);
        return;
      }
      setErro(corpo?.error ?? "Não foi possível gravar a conferência.");
      // O pagamento mudou (409) ou saiu da lista (404): a lista da tela está velha, e relê.
      if (r.status === 409 || r.status === 404) await onMudou();
    } catch {
      setErro("Não foi possível gravar a conferência.");
    } finally {
      enviando.current = false;
      setGravando(false);
    }
  }

  return (
    <>
      <tr>
        <td style={{ ...celula, color: T.text, fontWeight: 600, paddingLeft: 16 }}>
          {item.clienteNome ?? "Cliente não identificado"}
        </td>
        <td style={{ ...celula, whiteSpace: "nowrap" }}>{item.unidade}</td>
        <td style={{ ...celula, whiteSpace: "nowrap" }}>
          {mes(item.competencia)}
          {item.parcela ? <span style={{ color: T.muted }}> · {item.parcela}</span> : null}
        </td>
        <td style={{ ...celula, whiteSpace: "nowrap" }}>{dia(item.pagoEm)}</td>
        <td style={{ ...celula, color: T.text, textAlign: "right", whiteSpace: "nowrap" }}>
          {item.valorPago === null ? "-" : brl(item.valorPago)}
        </td>
        <td style={{ ...celula, lineHeight: 1.45, maxWidth: 420 }}>
          {item.motivo}
          {item.detalhe ? <span style={{ color: T.muted, display: "block" }}>{item.detalhe}</span> : null}
          {item.conferidoAntes ? (
            // A cobrança já foi conferida por outro motivo e voltou: quem olha agora precisa saber.
            <span style={{ color: T.muted, display: "block" }}>
              Já conferido em {dia(item.conferidoAntes.em)} por {item.conferidoAntes.por}:{" "}
              {item.conferidoAntes.observacao}
            </span>
          ) : null}
        </td>
        <td style={{ ...celula, textAlign: "right", whiteSpace: "nowrap" }}>
          {item.clienteCodigo ? (
            <button
              onClick={() => onAbrirFicha(item.clienteCodigo as string)}
              style={botao}
              title="Abrir a ficha do cliente, com as parcelas"
              type="button"
            >
              <FileText size={13} /> Ficha
            </button>
          ) : null}
          {conferidoDisponivel ? (
            <button
              onClick={() => setAberto((atual) => !atual)}
              style={{ ...botao, marginLeft: 6 }}
              title="Tirar este pagamento da lista, dizendo o que foi conferido"
              type="button"
            >
              <Check size={13} /> Conferido
            </button>
          ) : null}
        </td>
      </tr>
      {aberto ? (
        <tr>
          <td colSpan={7} style={{ ...celula, background: T.soft, paddingLeft: 16 }}>
            <form
              onSubmit={(evento) => {
                evento.preventDefault();
                void confirmar();
              }}
              style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: 8 }}
            >
              <input
                aria-label="O que foi conferido"
                maxLength={500}
                onChange={(evento) => setObservacao(evento.target.value)}
                placeholder="O que foi conferido? Ex.: mesmo pagamento, lançado duas vezes"
                style={{
                  background: T.card,
                  border: `1px solid ${T.border}`,
                  borderRadius: 8,
                  color: T.text,
                  flex: 1,
                  fontFamily: fonte,
                  fontSize: 12.5,
                  minWidth: 260,
                  outline: "none",
                  padding: "7px 10px",
                }}
                value={observacao}
              />
              <button
                disabled={gravando || observacao.trim().length < 3}
                style={{
                  ...botao,
                  background: T.btnBg,
                  borderColor: T.btnBg,
                  color: T.btnFg,
                  cursor: gravando || observacao.trim().length < 3 ? "default" : "pointer",
                  opacity: gravando || observacao.trim().length < 3 ? 0.6 : 1,
                }}
                type="submit"
              >
                {gravando ? <Loader2 className="inc-girando" size={13} /> : <Check size={13} />} Confirmar
              </button>
              {erro ? <span style={{ color: T.danger, fontSize: 12 }}>{erro}</span> : null}
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}

const caixa = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 14,
} as const;

const cabecalhoDoGrupo = {
  color: T.text,
  cursor: "pointer",
  fontSize: 15,
  fontWeight: 700,
  padding: "12px 16px",
} as const;

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

const botao = {
  alignItems: "center",
  background: "transparent",
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  color: T.text,
  cursor: "pointer",
  display: "inline-flex",
  fontFamily: fonte,
  fontSize: 12,
  fontWeight: 600,
  gap: 5,
  padding: "5px 10px",
} as const;
