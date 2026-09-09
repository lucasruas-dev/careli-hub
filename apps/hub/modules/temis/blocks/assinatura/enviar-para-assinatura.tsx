"use client";

import { AlertTriangle, ArrowDown, ArrowUp, Loader2, Send, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ordenarSignatarios } from "@/lib/assinatura/ordem";
import { type PapelNoContrato, rotuloDoPapel } from "@/lib/assinatura/tipos";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// MANDAR O CONTRATO PARA ASSINATURA — a última tela antes do ponto sem volta.
//
// ⚠️ ESTA TELA EXISTE PORQUE O CLIQUE NÃO SE DESFAZ. A conta da Clicksign é de PRODUÇÃO (Lucas,
// 08/09/2026 — o sandbox deles está com problema), cada envelope tem CUSTO e, depois de ativado, não
// se apaga: só se cancela, e o cancelado continua na lista. Então tudo que se pode descobrir antes é
// mostrado antes — quem assina, com que e-mail, em que ordem, de onde a ordem veio, e o que impede.
//
// ⚠️ A ORDEM VEM PREENCHIDA E PODE SER MUDADA AQUI — e o que se muda aqui NÃO volta para o cadastro
// do empreendimento. Lucas, 08/09/2026: *"claro que temos que ter a opção de alterar antes de enviar
// o contrato, mas vem preenchido por padrão"*. Uma exceção de um contrato não pode virar a política
// de todos os contratos daquele produto.
//
// ⚠️ E A CONFIRMAÇÃO É EM DOIS PASSOS. Não é cerimônia: o botão fica ao lado de uma lista que a
// pessoa acabou de ler, e o custo do engano é um envelope pago e permanente na conta, com o nome de
// um comprador de verdade.

type Signatario = {
  email: string;
  nome: string;
  ordem: number;
  papel: PapelNoContrato;
  papelRotulo: string;
};

type Preparo = {
  ambiente: null | string;
  avisoDeAmbiente: null | string;
  avisos: string[];
  contrato: { criadoEm: string; documentoId: string; nome: string; versao: null | number };
  impedimento: null | string;
  ordem: {
    descricao: string;
    ordenada: boolean;
    origemDescrita: string;
    papeis: PapelNoContrato[];
  };
  signatarios: Signatario[];
};

export function EnviarParaAssinatura({
  aoFechar,
  propostaId,
}: {
  aoFechar: () => void;
  propostaId: string;
}) {
  const [preparo, setPreparo] = useState<null | Preparo>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [enviado, setEnviado] = useState<null | { envelopeId: string; nome: string }>(null);

  // A ordem editada NESTE envio. Nasce igual à do cadastro e nunca volta para lá.
  const [ordenada, setOrdenada] = useState(false);
  const [papeis, setPapeis] = useState<PapelNoContrato[]>([]);

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    void (async () => {
      try {
        const accessToken = await getApoloAccessToken();
        const resposta = await fetch(
          `/api/temis/assinatura/enviar?proposta=${encodeURIComponent(propostaId)}`,
          { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const payload = (await resposta.json()) as { data?: Preparo; erro?: string };
        if (!vivo) return;
        if (!resposta.ok || !payload.data) {
          setErro(payload.erro ?? "Não consegui montar o envio.");
          return;
        }
        setPreparo(payload.data);
        setOrdenada(payload.data.ordem.ordenada);
        setPapeis(payload.data.ordem.papeis);
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : "Não consegui montar o envio.");
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [propostaId]);

  /**
   * A lista com a ordem que o operador está vendo AGORA.
   *
   * ⚠️ RECALCULADA NO NAVEGADOR PELA MESMA FUNÇÃO DO SERVIDOR (`ordenarSignatarios`). Reimplementar
   * a numeração aqui — "o índice + 1" — daria uma tela que mostra 1,2,3 e um envelope que sai 1,1,2:
   * quem tem o mesmo papel assina JUNTO, e os números se compactam quando um papel não existe no
   * contrato. Duas contas para o mesmo número é a divergência que ninguém percebe até o envelope
   * estar na conta.
   */
  const emOrdem = useMemo(() => {
    if (!preparo) return [];
    const pessoas = preparo.signatarios.map((s) => ({
      email: s.email,
      nome: s.nome,
      papel: s.papel,
    }));
    return ordenarSignatarios(pessoas, { ordenada, papeis })
      .map((s) => ({ ...s, papelRotulo: rotuloDoPapel(s.papel) }))
      .sort((a, b) => a.ordem - b.ordem);
  }, [ordenada, papeis, preparo]);

  const mover = useCallback((indice: number, direcao: -1 | 1) => {
    setPapeis((atual) => {
      const destino = indice + direcao;
      if (destino < 0 || destino >= atual.length) return atual;
      const copia = [...atual];
      const [movido] = copia.splice(indice, 1);
      if (movido) copia.splice(destino, 0, movido);
      return copia;
    });
  }, []);

  async function enviar() {
    setErro(null);
    setEnviando(true);
    try {
      const accessToken = await getApoloAccessToken();
      const resposta = await fetch("/api/temis/assinatura/enviar", {
        body: JSON.stringify({ ordem: { ordenada, papeis }, propostaId }),
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await resposta.json()) as {
        data?: { envelopeId: string; nome: string };
        erro?: string;
      };
      if (!resposta.ok || !payload.data) {
        setErro(payload.erro ?? "Não consegui enviar.");
        setConfirmando(false);
        return;
      }
      setEnviado(payload.data);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui enviar.");
      setConfirmando(false);
    } finally {
      setEnviando(false);
    }
  }

  // Só os papéis que EXISTEM neste contrato aparecem para reordenar: mostrar "testemunha" e
  // "interveniente" num contrato que não tem nenhum dos dois é pedir para a pessoa arrumar uma fila
  // que não vai acontecer.
  const papeisPresentes = useMemo(() => {
    const presentes = new Set((preparo?.signatarios ?? []).map((s) => s.papel));
    return papeis.filter((p) => presentes.has(p));
  }, [papeis, preparo]);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-line bg-surface p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="m-0 text-sm font-semibold text-ink">Enviar para assinatura</h2>
            <p className="m-0 mt-0.5 text-xs text-ink-muted">Clicksign · o envelope não se apaga depois de enviado.</p>
          </div>
          <button
            aria-label="Fechar"
            className="rounded-md border border-line p-1 text-ink-muted"
            onClick={aoFechar}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        {carregando ? (
          <p className="mt-4 flex items-center gap-2 text-xs text-ink-muted">
            <Loader2 className="size-3.5 animate-spin" />
            Montando o envio…
          </p>
        ) : null}

        {enviado ? (
          <div className="mt-4 rounded-lg border border-emerald-300/70 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
            <p className="m-0 font-semibold">Enviado.</p>
            <p className="m-0 mt-1">
              O envelope <span className="font-semibold">{enviado.nome}</span> foi criado, ativado e
              os convites saíram. Id na Clicksign: {enviado.envelopeId}.
            </p>
          </div>
        ) : null}

        {erro ? (
          <p className="mt-3 rounded-lg border border-rose-300/70 bg-rose-50 p-2.5 text-xs font-medium text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
            {erro}
          </p>
        ) : null}

        {preparo && !enviado ? (
          <>
            {/* ⚠️ O AMBIENTE VEM PRIMEIRO. Um contrato assinado no sandbox NÃO tem validade
                jurídica, e a API responde 200 exatamente igual nos dois. */}
            {preparo.avisoDeAmbiente ? (
              <p className="mt-3 rounded-lg border border-amber-300/70 bg-amber-50 p-2.5 text-xs font-semibold text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
                {preparo.avisoDeAmbiente}
              </p>
            ) : null}

            <div className="mt-3 rounded-lg border border-line bg-subtle/40 p-2.5">
              <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                O papel que vai
              </p>
              <p className="m-0 mt-1 break-words text-xs font-semibold text-ink">
                {preparo.contrato.nome}
              </p>
              <p className="m-0 mt-0.5 text-[0.7rem] text-ink-muted">
                É a versão vigente. Gerar de novo cria outra versão — esta é a que sai.
              </p>
            </div>

            {preparo.impedimento ? (
              <p className="mt-3 flex items-start gap-1.5 rounded-lg border border-rose-300/70 bg-rose-50 p-2.5 text-xs font-medium text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{preparo.impedimento}</span>
              </p>
            ) : null}

            {preparo.avisos.map((aviso) => (
              <p
                className="mt-2 flex items-start gap-1.5 rounded-lg border border-amber-300/60 bg-amber-50/70 p-2.5 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                key={aviso}
              >
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{aviso}</span>
              </p>
            ))}

            {/* ── QUEM ASSINA ── */}
            <p className="m-0 mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Quem assina ({emOrdem.length})
            </p>
            <div className="mt-1.5 grid gap-1.5">
              {emOrdem.map((s) => (
                <div
                  className="flex items-center gap-2 rounded-lg border border-line bg-subtle/40 px-2.5 py-2"
                  key={s.email || s.nome}
                >
                  <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-inverse text-[11px] font-semibold text-white">
                    {ordenada ? s.ordem : "•"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-ink">{s.nome}</span>
                    <span className="block truncate text-[0.7rem] text-ink-muted">
                      {s.papelRotulo} · {s.email || "sem e-mail"}
                    </span>
                  </span>
                </div>
              ))}
            </div>

            {/* ── A ORDEM ── */}
            <div className="mt-4 rounded-lg border border-line p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="m-0 text-xs font-semibold text-ink">Assinam em ordem</p>
                  <p className="m-0 mt-0.5 text-[0.7rem] text-ink-muted">
                    Veio {preparo.ordem.origemDescrita}. O que mudar aqui vale só para este envio.
                  </p>
                </div>
                <button
                  aria-checked={ordenada}
                  aria-label="Assinam em ordem"
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    ordenada ? "bg-inverse" : "bg-line-strong"
                  }`}
                  disabled={enviando}
                  onClick={() => setOrdenada((v) => !v)}
                  role="switch"
                  type="button"
                >
                  <span
                    className={`inline-block size-3.5 rounded-full bg-white shadow transition-transform ${
                      ordenada ? "translate-x-5" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {ordenada ? (
                <div className="mt-2 grid gap-1">
                  {papeisPresentes.map((papel) => {
                    const i = papeis.indexOf(papel);
                    return (
                      <div
                        className="flex items-center gap-2 rounded-md border border-line px-2 py-1.5"
                        key={papel}
                      >
                        <span className="min-w-0 flex-1 truncate text-[0.7rem] text-ink">
                          {rotuloDoPapel(papel)}
                        </span>
                        <button
                          aria-label={`Subir ${rotuloDoPapel(papel)}`}
                          className="rounded border border-line p-0.5 text-ink-muted disabled:opacity-30"
                          disabled={i <= 0 || enviando}
                          onClick={() => mover(i, -1)}
                          type="button"
                        >
                          <ArrowUp className="size-3" />
                        </button>
                        <button
                          aria-label={`Descer ${rotuloDoPapel(papel)}`}
                          className="rounded border border-line p-0.5 text-ink-muted disabled:opacity-30"
                          disabled={i < 0 || i >= papeis.length - 1 || enviando}
                          onClick={() => mover(i, 1)}
                          type="button"
                        >
                          <ArrowDown className="size-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="m-0 mt-1.5 text-[0.7rem] text-ink-muted">
                  Todos recebem o convite ao mesmo tempo.
                </p>
              )}
            </div>

            {/* ── O BOTÃO ── */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {confirmando ? (
                <>
                  <button
                    className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
                    disabled={enviando}
                    onClick={() => void enviar()}
                    type="button"
                  >
                    {enviando ? "Enviando…" : "Confirmo: enviar agora"}
                  </button>
                  <button
                    className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-muted"
                    disabled={enviando}
                    onClick={() => setConfirmando(false)}
                    type="button"
                  >
                    Voltar
                  </button>
                  <span className="text-[0.7rem] text-ink-muted">
                    O envelope será criado na conta e não poderá ser apagado.
                  </span>
                </>
              ) : (
                <button
                  className="inline-flex items-center gap-1.5 rounded-lg bg-inverse px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  disabled={Boolean(preparo.impedimento) || enviando}
                  onClick={() => setConfirmando(true)}
                  type="button"
                >
                  <Send className="size-3.5" />
                  Enviar para assinatura
                </button>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
