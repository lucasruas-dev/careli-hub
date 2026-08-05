"use client";

import { useEffect, useRef, useState } from "react";

import {
  comandarPalco,
  fetchPalco,
  type PalcoEstado,
} from "@/modules/prometeu/data/prometeu-operations";

// O MAESTRO dos telões, dentro do Setup (pedido do Lucas, 01/08): um comando aqui muda a
// música/vídeo de FUNDO de TODAS as TVs do evento ao mesmo tempo (broadcast + estado salvo no
// evento). As CHAMADAS de cada telão seguem independentes — isto só rege o fundo.
export function MaestroConteudo() {
  const [ytUrl, setYtUrl] = useState("");
  const [volume, setVolume] = useState(80);
  const [mudo, setMudo] = useState(false);
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const [mandando, setMandando] = useState(false);
  // Links da TV independente (token, sem login) — vêm do GET do palco, atrás do login do Setup.
  const [linksTv, setLinksTv] = useState<{ salao?: string | null; secretaria?: string | null }>({});
  // O slider dispara muitos onChange: o debounce manda UM comando quando a mão para.
  const volumeTimer = useRef<number | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await fetchPalco();
      if (data?.linksTv) setLinksTv(data.linksTv);
      const p = data?.palco;
      if (!p) return;
      if (typeof p.volume === "number") setVolume(p.volume);
      if (typeof p.mudo === "boolean") setMudo(p.mudo);
    })();
  }, []);

  function copiarLink(rotulo: string, link: string | null | undefined) {
    if (!link) {
      setStatus({ msg: "Link indisponível (segredo não configurado).", ok: false });
      return;
    }
    void navigator.clipboard.writeText(link).then(
      () => setStatus({ msg: `✓ Link da TV (${rotulo}) copiado — cole no navegador da TV`, ok: true }),
      () => setStatus({ msg: "Não consegui copiar — selecione e copie manualmente.", ok: false }),
    );
  }

  async function mandar(cmd: PalcoEstado, rotulo: string) {
    setMandando(true);
    const { error } = await comandarPalco(cmd);
    setMandando(false);
    setStatus(
      error
        ? { msg: error, ok: false }
        : { msg: `✓ ${rotulo} — aplicado em todas as TVs`, ok: true },
    );
  }

  function extrairYT(s: string): string | null {
    const m =
      s.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([\w-]{11})/) ?? s.match(/^([\w-]{11})$/);
    return m?.[1] ?? null;
  }

  function tocarVideo() {
    const id = extrairYT(ytUrl.trim());
    if (!id) {
      setStatus({ msg: "Link do YouTube inválido.", ok: false });
      return;
    }
    void mandar({ tocando: true, videoId: id }, "Novo vídeo em todos os telões");
  }

  function aoMudarVolume(v: number) {
    setVolume(v);
    if (volumeTimer.current) window.clearTimeout(volumeTimer.current);
    volumeTimer.current = window.setTimeout(() => {
      void mandar({ volume: v }, `Volume ${v}%`);
    }, 400);
  }

  const botao =
    "rounded-lg px-4 py-2.5 text-sm font-bold text-white transition-transform active:scale-[0.97] disabled:opacity-50";

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider text-ink-muted">
          Vídeo/música do YouTube
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            className="flex-1 rounded-lg border border-black/10 bg-canvas px-3 py-2.5 text-sm dark:border-white/10"
            inputMode="url"
            onChange={(e) => setYtUrl(e.target.value)}
            placeholder="Cole o link do YouTube"
            type="text"
            value={ytUrl}
          />
          <button
            className={`${botao} bg-[#A07C3B]`}
            disabled={mandando}
            onClick={tocarVideo}
            type="button"
          >
            ▶ Tocar em todos os telões
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          className={`${botao} bg-emerald-700`}
          disabled={mandando}
          onClick={() => void mandar({ tocando: true }, "Play em todos")}
          type="button"
        >
          ▶ Play
        </button>
        <button
          className={`${botao} bg-orange-800`}
          disabled={mandando}
          onClick={() => void mandar({ tocando: false }, "Pause em todos")}
          type="button"
        >
          ⏸ Pausar
        </button>
        <button
          className={`${botao} ${mudo ? "bg-red-700" : "bg-slate-600"}`}
          disabled={mandando}
          onClick={() => {
            const novo = !mudo;
            setMudo(novo);
            void mandar({ mudo: novo }, novo ? "Áudio cortado em todos" : "Áudio religado em todos");
          }}
          type="button"
        >
          {mudo ? "🔇 Áudio cortado (DJ)" : "🔊 Cortar o áudio (DJ)"}
        </button>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-bold uppercase tracking-wider text-ink-muted">
          Volume de fundo
        </label>
        <div className="flex items-center gap-3">
          <input
            className="h-8 flex-1 accent-[#A07C3B]"
            max={100}
            min={0}
            onChange={(e) => aoMudarVolume(Number(e.target.value))}
            type="range"
            value={volume}
          />
          <span className="min-w-12 text-right text-sm font-bold tabular-nums">{volume}%</span>
        </div>
        <p className="text-xs text-ink-muted">
          Durante um anúncio de chamada, o telão abaixa sozinho e depois volta a este volume.
        </p>
      </div>

      <div className="space-y-2 border-t border-black/10 pt-4 dark:border-white/10">
        <label className="text-xs font-bold uppercase tracking-wider text-ink-muted">
          TVs independentes (sem login)
        </label>
        <p className="text-xs text-ink-muted">
          Cole o link no navegador da TV e pronto: o telão abre direto no canal, sem operador e
          sem sessão para vencer. O link vale enquanto este lançamento durar.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            className={`${botao} bg-slate-700`}
            onClick={() => copiarLink("salão", linksTv.salao)}
            type="button"
          >
            📺 Copiar link · Telão do salão
          </button>
          <button
            className={`${botao} bg-slate-700`}
            onClick={() => copiarLink("secretaria", linksTv.secretaria)}
            type="button"
          >
            📺 Copiar link · Telão da secretaria
          </button>
        </div>
      </div>

      {status ? (
        <p
          className={`rounded-lg px-3 py-2 text-sm ${
            status.ok
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
              : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
          }`}
        >
          {status.msg}
        </p>
      ) : null}
    </div>
  );
}
