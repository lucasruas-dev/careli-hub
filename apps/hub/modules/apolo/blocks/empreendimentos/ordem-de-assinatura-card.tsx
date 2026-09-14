"use client";

import { PenLine, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import { lerRegraDeOrdem, ORDEM_MAXIMA, ORDEM_PADRAO } from "@/lib/assinatura/ordem";
import { PAPEIS, type PapelNoContrato, rotuloDoPapel } from "@/lib/assinatura/tipos";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// A ORDEM DE ASSINATURA, NO SETUP DO EMPREENDIMENTO.
//
// Lucas, 08/09/2026: *"a ordem de assinatura queremos criar dentro do empreendimento, em uma aba de
// setup (claro que temos que ter a opção de alterar antes de enviar o contrato, mas vem preenchido
// por padrão)"*.
//
// ⚠️ ESTE É O "VEM PREENCHIDO POR PADRÃO". O "alterar antes de enviar" mora na tela de envio e NÃO
// volta para cá — uma exceção de um contrato não pode virar a política do empreendimento inteiro.
//
// ⚠️ E É POR PAPEL, NÃO POR PESSOA. Quem assina muda a cada venda (outro comprador, outro cônjuge,
// às vezes três compradores); o que NÃO muda é "a vendedora assina depois dos compradores". Uma
// lista de pessoas envelheceria no primeiro contrato.
//
// ⚠️ SUBIR/DESCER EM VEZ DE ARRASTAR. Arrastar exigiria biblioteca de drag-and-drop e, no toque, é
// a interação que mais erra — e aqui um erro silencioso reordena a assinatura de TODOS os contratos
// do empreendimento. Duas setas dizem exatamente o que aconteceu, e a lista lê-se de cima para
// baixo como a fila real.

type Props = {
  code: string;
  enterpriseId: string;
};

export function OrdemDeAssinaturaCard({ code, enterpriseId }: Props) {
  const [ordenada, setOrdenada] = useState(false);
  // ⚠️ UM NÚMERO POR PAPEL, E NÃO UMA FILA. Lucas, 13/09/2026: *"eu posso colocar o comprador como
  // 1 e o resto como 2"*, e *"essa personalização é bem comum para gente"*. Com setas de subir e
  // descer, a única coisa que esta tela sabia montar era uma fila de seis degraus — não havia como
  // dizer "estes três ao mesmo tempo, depois do comprador", que é o caso comum da casa.
  const [ordens, setOrdens] = useState<Record<PapelNoContrato, number>>({
    ...ORDEM_PADRAO.ordens,
  });
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<null | string>(null);
  const [salvo, setSalvo] = useState(false);

  useEffect(() => {
    let vivo = true;
    void lerSettings(enterpriseId).then((valor) => {
      if (!vivo) return;
      setOrdenada(valor.ordenada);
      setOrdens(valor.ordens);
      setCarregando(false);
    });
    return () => {
      vivo = false;
    };
  }, [enterpriseId]);

  function definir(papel: PapelNoContrato, bruto: string) {
    setSalvo(false);
    const n = Math.trunc(Number(bruto));
    // Campo vazio ou fora do teto não mexe em nada: o operador está no meio de digitar.
    if (!Number.isFinite(n) || n < 1 || n > ORDEM_MAXIMA) return;
    setOrdens((atual) => ({ ...atual, [papel]: n }));
  }

  async function salvar() {
    setErro(null);
    setSalvando(true);
    // ⚠️ MANDA A LISTA MESMO COM A ORDEM DESLIGADA. Se ela só fosse gravada quando ligada, desligar
    // e religar perderia a ordem que alguém montou — e o operador religaria achando que voltou ao
    // que era.
    const resultado = await gravarSettings(enterpriseId, code, {
      assinaturaOrdem: ordens,
      assinaturaOrdenada: ordenada,
    });
    setSalvando(false);
    if (!resultado.ok) {
      setErro(resultado.error ?? "Falha ao salvar.");
      return;
    }
    setSalvo(true);
  }

  function voltarAoPadrao() {
    setSalvo(false);
    setOrdens({ ...ORDEM_PADRAO.ordens });
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="m-0 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        <PenLine className="size-3.5" />
        Ordem de assinatura do contrato
      </p>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-subtle/50 px-3 py-2.5">
        <div className="min-w-0">
          <p className="m-0 text-sm font-semibold text-ink">Assinam em ordem</p>
          <p className="m-0 mt-0.5 text-xs text-ink-muted">
            Ligado, cada papel só recebe o convite depois que o anterior assina. Desligado, todos
            assinam ao mesmo tempo — que é como os contratos saem hoje.
          </p>
        </div>
        <button
          aria-checked={ordenada}
          aria-label="Assinam em ordem"
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
            ordenada ? "bg-inverse" : "bg-line-strong"
          }`}
          disabled={carregando || salvando}
          onClick={() => {
            setSalvo(false);
            setOrdenada((v) => !v);
          }}
          role="switch"
          type="button"
        >
          <span
            className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${
              ordenada ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      {/* A lista fica VISÍVEL mesmo desligada, só esmaecida: é ela que o operador monta antes de
          ligar, e escondê-la faria a chave parecer não ter efeito nenhum.

          ⚠️ ORDENADA PELO NÚMERO, e não na ordem fixa do catálogo: a lista tem de LER como a fila
          real, de cima para baixo. Empate desempata pela ordem canônica, para a lista não dançar a
          cada tecla enquanto alguém digita. */}
      <div className={`mt-3 grid gap-1.5 ${ordenada ? "" : "opacity-50"}`}>
        {[...PAPEIS]
          .sort(
            (a, b) =>
              (ordens[a] ?? 99) - (ordens[b] ?? 99) || PAPEIS.indexOf(a) - PAPEIS.indexOf(b),
          )
          .map((papel) => (
            <div
              className="flex items-center gap-2 rounded-lg border border-line bg-subtle/40 px-3 py-2"
              key={papel}
            >
              <input
                aria-label={`Ordem de ${rotuloDoPapel(papel)}`}
                className="h-7 w-12 shrink-0 rounded-md border border-line bg-surface text-center text-sm font-semibold text-ink disabled:opacity-60"
                disabled={carregando || salvando}
                inputMode="numeric"
                max={ORDEM_MAXIMA}
                min={1}
                onChange={(e) => definir(papel, e.target.value)}
                type="number"
                value={ordens[papel] ?? ""}
              />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">
                {rotuloDoPapel(papel)}
              </span>
              {/* Quem divide o número com este papel assina junto com ele — dizer isso na linha
                  evita o operador ter de cruzar a lista inteira de olho para descobrir. */}
              {PAPEIS.filter((p) => p !== papel && ordens[p] === ordens[papel]).length > 0 ? (
                <span className="shrink-0 rounded-md bg-subtle px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
                  junto com{" "}
                  {PAPEIS.filter((p) => p !== papel && ordens[p] === ordens[papel])
                    .map(rotuloDoPapel)
                    .join(", ")}
                </span>
              ) : null}
            </div>
          ))}
      </div>

      <p className="m-0 mt-2 text-xs text-ink-muted">
        <strong>O mesmo número assina junto.</strong> Para o comprador assinar primeiro e todo o
        resto depois, ponha 1 nele e 2 em todos os outros. Papéis que não existirem no contrato são
        pulados e a numeração se fecha sozinha — sem cônjuge e sem corretor, o que sobra vira 1 e 2,
        sem buraco no meio.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          className="rounded-lg bg-inverse px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-60"
          disabled={carregando || salvando}
          onClick={() => void salvar()}
          type="button"
        >
          {salvando ? "Salvando…" : "Salvar a ordem"}
        </button>
        <button
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-muted disabled:opacity-60"
          disabled={carregando || salvando}
          onClick={voltarAoPadrao}
          type="button"
        >
          <RotateCcw className="size-3.5" />
          Voltar ao padrão da casa
        </button>
        {salvo ? (
          <span className="text-xs font-medium text-emerald-600 dark:text-emerald-300">
            Salvo. Vale para os próximos contratos deste empreendimento.
          </span>
        ) : null}
      </div>

      {erro ? (
        <p className="m-0 mt-2 text-xs font-medium text-rose-600 dark:text-rose-300">{erro}</p>
      ) : null}
    </div>
  );
}

// ── AS CHAMADAS ─────────────────────────────────────────────────────────────

/**
 * O que está gravado hoje.
 *
 * ⚠️ PASSA POR `lerRegraDeOrdem`, o MESMO saneador do servidor. A coluna é `jsonb` livre e pode ter
 * papel que o código não conhece mais (renomeado, removido); a tela precisa mostrar a mesma lista
 * que o envio vai usar. Duas versões dessa limpeza divergiriam no dia da primeira renomeação — e a
 * divergência seria a tela mostrando uma ordem e o contrato saindo em outra.
 */
async function lerSettings(
  enterpriseId: string,
): Promise<{ ordenada: boolean; ordens: Record<PapelNoContrato, number> }> {
  try {
    const accessToken = await getApoloAccessToken();
    const resposta = await fetch("/api/apolo/empreendimentos/settings", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = (await resposta.json()) as {
      data?: {
        settings?: Record<
          string,
          {
            assinaturaOrdem?: null | Record<string, number> | string[];
            assinaturaOrdenada?: boolean;
          }
        >;
      };
    };
    const setting = payload.data?.settings?.[enterpriseId];
    const guardado = setting?.assinaturaOrdem ?? null;
    // ⚠️ AS DUAS FORMAS PASSAM PELO MESMO SANEADOR. A coluna pode ter a LISTA antiga (uma fila) ou
    // o MAPA novo, e `lerRegraDeOrdem` converte as duas em números — a tela não precisa saber qual
    // está gravada, e uma segunda conversão aqui divergiria da do servidor no primeiro ajuste.
    const regra = lerRegraDeOrdem(
      Array.isArray(guardado)
        ? { ordenada: setting?.assinaturaOrdenada === true, papeis: guardado }
        : { ordenada: setting?.assinaturaOrdenada === true, ordens: guardado },
    );
    return { ordenada: regra.ordenada, ordens: regra.ordens };
  } catch {
    // Falha de leitura mostra o padrão da casa — e o operador só grava se clicar em Salvar.
    return { ordenada: false, ordens: { ...ORDEM_PADRAO.ordens } };
  }
}

async function gravarSettings(
  enterpriseId: string,
  code: string,
  patch: {
    assinaturaOrdem: null | Record<string, number> | string[];
    assinaturaOrdenada: boolean;
  },
): Promise<{ error?: string; ok: boolean }> {
  try {
    const accessToken = await getApoloAccessToken();
    const resposta = await fetch("/api/apolo/empreendimentos/settings", {
      body: JSON.stringify({ ...patch, code, enterpriseId }),
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      method: "PATCH",
    });
    const payload = (await resposta.json()) as { error?: string };
    if (!resposta.ok) return { error: payload.error ?? "Falha ao salvar.", ok: false };
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao salvar.", ok: false };
  }
}
