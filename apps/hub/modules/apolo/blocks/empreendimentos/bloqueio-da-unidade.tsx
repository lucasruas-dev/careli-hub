"use client";

import { Ban, Loader2, LockOpen, X } from "lucide-react";
import { useEffect, useState } from "react";

// Só TIPOS do lib do Apolo: `empreendimentos.ts` é server-side (mysql2).
import type { ApoloEnterpriseUnit } from "@/lib/apolo/empreendimentos";
import {
  conferirBloqueio,
  type ErroDoBloqueio,
  LIMITE_DO_DETALHE,
  MOTIVO_ABERTO,
  MOTIVOS_DE_BLOQUEIO,
} from "@/lib/hercules/bloqueio-de-unidade";

import { getApoloAccessToken } from "../../data/apolo-operations";

// BLOQUEAR E DESBLOQUEAR NA ABA UNIDADES DO APOLO.
//
// Lucas (18/09/2026): *"cadastro apolo, interações comerciais hercules"* · *"eu posso por exemplo,
// bloquear uma unidade dentro do apolo e isso tem que refletir no hercules"*.
//
// ⚠️ A REGRA NÃO MORA NA TELA. Quem decide se pode é o servidor
// (/api/apolo/empreendimentos/unidades/bloqueio → lib/hercules/bloquear-unidade-server.ts, a MESMA
// regra da Venda do Hércules). A tela só não oferece o que já sabe que vai ser recusado, e mostra a
// frase do servidor quando ele recusa.
//
// ⚠️ A MODAL NÃO É A DO PORTAL (`ModalDeCancelamento`), e não por gosto: aquela fala com a rota do
// portal pelo cookie e pinta com o tema do portal. O que é compartilhado é o que importa: a lista de
// motivos, o "Outro" que exige texto e a conferência (`conferirBloqueio`), todos de
// lib/hercules/bloqueio-de-unidade.ts. A mesma conferência roda de novo no servidor.

const ROTA = "/api/apolo/empreendimentos/unidades/bloqueio";

/**
 * O botão da linha: "Bloquear" na unidade disponível, "Desbloquear" na bloqueada.
 *
 * ⚠️ APAGADO E CALADO NA UNIDADE EM PROCESSO (reserva, proposta, contrato, assinatura, venda), como
 * na Venda do Hércules (Lucas, 14/09/2026: *"o botão fica apagado mas sem mensagem nenhuma quando
 * tem reserva, proposta assinatura, fatura"*): o selo ao lado já diz por quê.
 *
 * ⚠️ DESBLOQUEAR SÓ O QUE FOI BLOQUEADO NO PANTEON. O bloqueio herdado do C2X (sem carimbo) fica
 * apagado com a explicação no hover; o servidor recusaria de qualquer jeito. Quando o carimbo não
 * pôde ser lido (`bloqueio` ausente), o botão fica ligado e o servidor decide.
 */
export function AcaoDeBloqueio({
  recarregar,
  unidade,
}: {
  recarregar: () => void;
  unidade: ApoloEnterpriseUnit;
}) {
  const [bloqueando, setBloqueando] = useState(false);
  const [desbloqueando, setDesbloqueando] = useState(false);
  const [recado, setRecado] = useState<null | string>(null);

  // Sem linha no Panteon não há o que bloquear: a unidade nem existe no cadastro.
  if (!unidade.panteonId || unidade.semCadastroNoPanteon) {
    return null;
  }
  const panteonId = unidade.panteonId;

  const bloqueada = unidade.bucket === "bloqueado";
  const livre = unidade.bucket === "disponivel";
  const herdadoDoC2x = bloqueada && unidade.bloqueio === null;

  async function desbloquear() {
    setRecado(null);
    setDesbloqueando(true);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch(ROTA, {
        body: JSON.stringify({ unidadeId: panteonId }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "DELETE",
      });
      const corpo = (await resposta.json().catch(() => null)) as null | { error?: string };
      if (!resposta.ok) {
        setRecado(corpo?.error ?? "Não foi possível desbloquear.");
        return;
      }
      recarregar();
    } catch {
      setRecado("Não foi possível desbloquear agora.");
    } finally {
      setDesbloqueando(false);
    }
  }

  const base =
    "inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 text-xs font-semibold text-ink transition-colors hover:border-ink/40 hover:bg-subtle disabled:cursor-default disabled:opacity-40 disabled:hover:border-line disabled:hover:bg-surface";

  return (
    <div className="inline-flex flex-col items-end gap-1">
      {bloqueada ? (
        // ⚠️ SEM MODAL, E DE PROPÓSITO (o mesmo desenho da Venda do Hércules): desbloquear não
        // guarda nada e é reversível; bloquear é que pergunta o motivo, porque o motivo precisa
        // sobreviver meses.
        <button
          className={base}
          disabled={herdadoDoC2x || desbloqueando}
          onClick={() => void desbloquear()}
          title={
            herdadoDoC2x
              ? "Este bloqueio veio do C2X, e é lá que ele se desfaz."
              : "Devolver o lote ao estoque"
          }
          type="button"
        >
          {desbloqueando ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          ) : (
            <LockOpen aria-hidden="true" className="size-3.5" />
          )}
          Desbloquear
        </button>
      ) : (
        <button
          className={base}
          disabled={!livre}
          onClick={() => {
            setRecado(null);
            setBloqueando(true);
          }}
          title={livre ? "Tirar o lote da venda, com o motivo" : undefined}
          type="button"
        >
          <Ban aria-hidden="true" className="size-3.5" />
          Bloquear
        </button>
      )}

      {recado ? (
        <p className="m-0 max-w-[240px] text-right text-[11px] font-semibold text-rose-600 dark:text-rose-400" role="alert">
          {recado}
        </p>
      ) : null}

      {bloqueando ? (
        <ModalDeBloqueio
          aoBloquear={() => {
            setBloqueando(false);
            recarregar();
          }}
          aoFechar={() => setBloqueando(false)}
          unidade={{ codigo: unidade.code, id: panteonId }}
        />
      ) : null}
    </div>
  );
}

/** A pergunta do motivo, antes de o lote sair da venda. */
function ModalDeBloqueio({
  aoBloquear,
  aoFechar,
  unidade,
}: {
  aoBloquear: () => void;
  aoFechar: () => void;
  unidade: { codigo: string; id: string };
}) {
  const [motivo, setMotivo] = useState("");
  const [detalhe, setDetalhe] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [errosDoServidor, setErrosDoServidor] = useState<ErroDoBloqueio[]>([]);
  const [erroDoServidor, setErroDoServidor] = useState<null | string>(null);

  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") aoFechar();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aoFechar]);

  const pedido = { detalhe, motivo, unidadeId: unidade.id };
  // A MESMA conferência que o servidor faz: a tela não deixa confirmar, a rota não aceita forjado.
  const erros = conferirBloqueio(pedido);
  const erroDe = (campo: "detalhe" | "motivo") =>
    (tentou ? erros.find((e) => e.campo === campo)?.mensagem : undefined) ??
    errosDoServidor.find((e) => e.campo === campo)?.mensagem ??
    null;

  async function bloquear() {
    setTentou(true);
    setErroDoServidor(null);
    setErrosDoServidor([]);
    if (erros.length > 0) return;

    setEnviando(true);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch(ROTA, {
        body: JSON.stringify(pedido),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const corpo = (await resposta.json().catch(() => null)) as null | {
        erros?: ErroDoBloqueio[];
        error?: string;
      };
      if (!resposta.ok) {
        if (corpo?.erros?.length) setErrosDoServidor(corpo.erros);
        setErroDoServidor(corpo?.error ?? (corpo?.erros?.length ? null : "Não foi possível bloquear."));
        return;
      }
      aoBloquear();
    } catch {
      setErroDoServidor("Não foi possível bloquear agora.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[var(--uix-z-modal)] grid place-items-center bg-black/40 p-4 text-left">
      <button
        aria-label="Fechar"
        className="absolute inset-0 cursor-default"
        onClick={aoFechar}
        type="button"
      />
      <div
        aria-modal="true"
        className="relative z-10 flex max-h-[86vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl"
        role="dialog"
      >
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <p className="m-0 flex items-center gap-2 text-sm font-semibold text-ink">
              <Ban aria-hidden="true" className="size-4 text-ink-muted" />
              Bloquear {unidade.codigo}
            </p>
            <p className="m-0 mt-0.5 text-xs text-ink-muted">
              Sai da venda no Hércules e do espelho público na hora. Só volta quando alguém desbloquear.
            </p>
          </div>
          <button
            aria-label="Voltar"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
            onClick={aoFechar}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>

        <div className="grid min-h-0 gap-4 overflow-auto p-5">
          <section>
            <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Motivo
            </p>
            <div className="flex flex-wrap gap-1.5">
              {MOTIVOS_DE_BLOQUEIO.map((opcao) => {
                const escolhido = opcao === motivo;
                return (
                  <button
                    aria-pressed={escolhido}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                      escolhido
                        ? "border-transparent bg-inverse text-brand-ink"
                        : "border-line bg-surface text-ink-soft hover:border-ink/30 hover:text-ink"
                    }`}
                    key={opcao}
                    onClick={() => setMotivo(opcao)}
                    type="button"
                  >
                    {opcao}
                  </button>
                );
              })}
            </div>
            {erroDe("motivo") ? <Erro texto={erroDe("motivo") ?? ""} /> : null}
          </section>

          <section>
            <label
              className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted"
              htmlFor="detalhe-do-bloqueio"
            >
              {motivo === MOTIVO_ABERTO ? "Escreva o motivo" : "Detalhe (opcional)"}
            </label>
            <textarea
              className={`w-full resize-y rounded-lg border bg-subtle/60 px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-ink/40 ${
                erroDe("detalhe") ? "border-rose-400" : "border-line"
              }`}
              id="detalhe-do-bloqueio"
              maxLength={LIMITE_DO_DETALHE}
              onChange={(evento) => setDetalhe(evento.target.value)}
              placeholder="Para quem ler daqui a três meses saber se ainda vale."
              rows={3}
              value={detalhe}
            />
            {erroDe("detalhe") ? <Erro texto={erroDe("detalhe") ?? ""} /> : null}
            <p className="m-0 mt-1 text-[11px] text-ink-muted">
              Fica gravado na unidade, com o seu nome e a data.
            </p>
          </section>

          {erroDoServidor ? <Erro texto={erroDoServidor} /> : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button
            className="h-9 rounded-lg border border-line bg-surface px-3.5 text-sm font-semibold text-ink-soft transition-colors hover:bg-subtle hover:text-ink"
            onClick={aoFechar}
            type="button"
          >
            Voltar
          </button>
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-bold text-brand-ink disabled:opacity-60"
            disabled={enviando}
            onClick={() => void bloquear()}
            type="button"
          >
            {enviando ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            Bloquear unidade
          </button>
        </footer>
      </div>
    </div>
  );
}

function Erro({ texto }: { texto: string }) {
  return (
    <p className="m-0 mt-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400" role="alert">
      {texto}
    </p>
  );
}
