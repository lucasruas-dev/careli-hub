"use client";

import { AlertTriangle, Check, Loader2, Pause, Play, RefreshCw, Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";

// DISPARO EM MASSA da cobrança PIX da pré-venda.
//
// A tela é deliberadamente sem graça: o que importa é ver, antes de começar, quantas pessoas vão
// receber uma cobrança de R$ 1.000 e quem está sem contato — e poder PARAR no meio. O servidor
// processa um lote pequeno por chamada; aqui é só o laço, o placar e o botão de parar.

type Amostra = {
  email: string | null;
  empreendimento: string | null;
  nome: string;
  problemas: string[];
  telefone: string | null;
};

type Previa = {
  amostra: Amostra[];
  jaDisparados: number;
  pendentes: number;
  valor: number;
};

type Resultado = {
  email?: string;
  entityId: string;
  erro?: string;
  nome: string;
  paymentId?: string;
  whatsapp?: string;
};

const TAMANHO_LOTE = 5;

export function DisparoMassaPix() {
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ciente, setCiente] = useState(false);
  const [feitos, setFeitos] = useState<Resultado[]>([]);
  const [parou, setParou] = useState<string | null>(null);
  // Ref porque o laço roda dentro de um callback: state não chegaria a tempo do próximo ciclo.
  const pararRef = useRef(false);

  const carregarPrevia = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/apolo/asaas/disparo-lote", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const corpo = (await r.json()) as { data?: Previa; error?: string };
      if (!r.ok) setErro(corpo.error ?? `Falha (${r.status}).`);
      else setPrevia(corpo.data ?? null);
    } catch (e) {
      setErro((e as Error).message);
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregarPrevia();
  }, [carregarPrevia]);

  // `umSo` = manda para UMA pessoa e para. É como se confere o disparo de verdade (mensagem,
  // ficha anexada, link do PIX) antes de soltar os 296 — sem depender de ficha de teste.
  const disparar = useCallback(async (umSo = false) => {
    pararRef.current = false;
    setRodando(true);
    setParou(null);
    setErro(null);
    setFeitos([]);

    const token = await getApoloAccessToken();

    // Vai chamando lote a lote até acabar, parar sozinho, ou o operador apertar Parar.
    for (;;) {
      if (pararRef.current) {
        setParou("Parado por você.");
        break;
      }

      try {
        const r = await fetch("/api/apolo/asaas/disparo-lote", {
          body: JSON.stringify({ confirmado: true, tamanho: umSo ? 1 : TAMANHO_LOTE }),
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          method: "POST",
        });
        const corpo = (await r.json()) as {
          data?: { parou: string | null; restantes: number; resultados: Resultado[] };
          error?: string;
        };

        if (!r.ok) {
          setErro(corpo.error ?? `Falha (${r.status}).`);
          break;
        }
        const d = corpo.data;
        if (!d) break;

        setFeitos((atual) => [...atual, ...d.resultados]);
        setPrevia((p) => (p ? { ...p, pendentes: d.restantes } : p));

        if (d.parou) {
          setParou(d.parou);
          break;
        }
        if (umSo) {
          setParou("Enviado para 1 pessoa. Confira o resultado antes de soltar o resto.");
          break;
        }
        if (d.restantes === 0 || d.resultados.length === 0) break;
      } catch (e) {
        setErro((e as Error).message);
        break;
      }
    }

    setRodando(false);
    void carregarPrevia();
  }, [carregarPrevia]);

  const enviados = feitos.filter((f) => f.whatsapp === "enviado").length;
  const falhas = feitos.filter((f) => f.erro || f.whatsapp?.startsWith("erro")).length;
  const semContato = previa?.amostra.filter((a) => a.problemas.length > 0) ?? [];

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-black/[0.07] bg-surface p-4 dark:border-white/[0.08]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="m-0 text-base font-bold text-ink">Disparo do PIX da pré-venda</h2>
            <p className="m-0 mt-1 text-xs text-ink-soft">
              Emite a cobrança no Asaas e manda a mensagem com a ficha (CAD) anexada, por WhatsApp e
              por e-mail. Quem já tem cobrança emitida nunca entra de novo.
            </p>
          </div>
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2 text-sm text-ink hover:bg-black/[0.03] disabled:opacity-40 dark:border-white/10"
            disabled={carregando || rodando}
            onClick={() => void carregarPrevia()}
            type="button"
          >
            {carregando ? (
              <Loader2 className="animate-spin" size={15} />
            ) : (
              <RefreshCw size={15} />
            )}
            Atualizar
          </button>
        </div>

        {previa ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <Placar
              destaque
              detalhe={`R$ ${previa.valor.toLocaleString("pt-BR")} cada`}
              rotulo="Vão receber a cobrança"
              valor={String(previa.pendentes)}
            />
            <Placar
              detalhe="não entram de novo"
              rotulo="Já têm PIX emitido"
              valor={String(previa.jaDisparados)}
            />
            <Placar
              detalhe="nos 30 primeiros da fila"
              rotulo="Com contato faltando"
              valor={String(semContato.length)}
            />
          </div>
        ) : null}

        {semContato.length > 0 ? (
          <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-50/40 p-3 dark:bg-amber-950/20">
            <p className="m-0 flex items-center gap-1.5 text-xs font-semibold text-ink">
              <AlertTriangle className="text-amber-600" size={14} />
              Estes vão falhar no canal que está faltando (o outro canal ainda sai)
            </p>
            <ul className="m-0 mt-1.5 grid list-none gap-1 p-0">
              {semContato.map((a) => (
                <li className="text-xs text-ink-soft" key={a.nome}>
                  <b className="text-ink">{a.nome}</b> · {a.problemas.join(", ")}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {erro ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {erro}
        </p>
      ) : null}

      <section className="rounded-xl border border-amber-400/50 bg-amber-50/50 p-4 dark:bg-amber-950/20">
        <label className="flex items-start gap-2.5">
          <input
            checked={ciente}
            className="mt-0.5"
            disabled={rodando}
            onChange={(e) => setCiente(e.target.checked)}
            type="checkbox"
          />
          <span className="text-sm text-ink-soft">
            Entendo que isto <b className="text-ink">emite cobrança real e envia mensagem</b> para{" "}
            <b className="text-ink">{previa?.pendentes ?? 0} pessoas</b>, e que não há como
            desenviar.
          </span>
        </label>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-black/15 px-4 py-2 text-sm font-semibold text-ink hover:bg-black/[0.03] disabled:opacity-40 dark:border-white/15"
            disabled={!ciente || rodando || (previa?.pendentes ?? 0) === 0}
            onClick={() => void disparar(true)}
            type="button"
          >
            <Send size={15} /> Disparar 1 e conferir
          </button>

          <button
            className="inline-flex items-center gap-2 rounded-lg bg-[#101820] px-4 py-2 text-sm font-semibold text-[#cba25a] hover:bg-[#1c2733] disabled:opacity-40"
            disabled={!ciente || rodando || (previa?.pendentes ?? 0) === 0}
            onClick={() => void disparar()}
            type="button"
          >
            {rodando ? <Loader2 className="animate-spin" size={15} /> : <Play size={15} />}
            {rodando ? "Disparando..." : `Disparar todos (${previa?.pendentes ?? 0})`}
          </button>

          {rodando ? (
            <button
              className="inline-flex items-center gap-2 rounded-lg border border-rose-500/40 px-4 py-2 text-sm font-semibold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
              onClick={() => {
                pararRef.current = true;
              }}
              type="button"
            >
              <Pause size={15} /> Parar
            </button>
          ) : null}
        </div>
      </section>

      {feitos.length > 0 || parou ? (
        <section className="rounded-xl border border-black/[0.07] bg-surface p-4 dark:border-white/[0.08]">
          <div className="mb-3 flex items-center gap-2">
            {rodando ? (
              <Loader2 className="animate-spin text-ink-muted" size={16} />
            ) : (
              <Check className="text-emerald-600" size={16} />
            )}
            <h3 className="m-0 text-sm font-bold text-ink">
              {enviados} enviados · {falhas} com falha
            </h3>
          </div>

          {parou ? (
            <p className="m-0 mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              Parou: {parou}
            </p>
          ) : null}

          <ul className="m-0 grid max-h-96 list-none gap-1 overflow-y-auto p-0">
            {feitos.map((f) => {
              const falhou = Boolean(f.erro) || f.whatsapp?.startsWith("erro");
              return (
                <li
                  className="flex flex-wrap items-center gap-x-2 text-xs"
                  key={`${f.entityId}-${f.paymentId ?? "sem"}`}
                >
                  {falhou ? (
                    <AlertTriangle className="shrink-0 text-rose-600" size={13} />
                  ) : (
                    <Send className="shrink-0 text-emerald-600" size={13} />
                  )}
                  <b className="text-ink">{f.nome}</b>
                  <span className={falhou ? "text-rose-600" : "text-ink-muted"}>
                    {f.erro ?? f.whatsapp}
                  </span>
                  {f.email ? <span className="text-ink-muted">· e-mail: {f.email}</span> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function Placar(props: {
  destaque?: boolean;
  detalhe: string;
  rotulo: string;
  valor: string;
}) {
  return (
    <div
      className={`rounded-lg px-3 py-2 ${
        props.destaque ? "bg-[#101820] text-[#cba25a]" : "bg-black/[0.04] dark:bg-white/[0.06]"
      }`}
    >
      <div className={`text-xl font-bold tabular-nums ${props.destaque ? "" : "text-ink"}`}>
        {props.valor}
      </div>
      <div className={`text-[0.7rem] font-semibold ${props.destaque ? "" : "text-ink-soft"}`}>
        {props.rotulo}
      </div>
      <div className={`text-[0.64rem] ${props.destaque ? "opacity-75" : "text-ink-muted"}`}>
        {props.detalhe}
      </div>
    </div>
  );
}
