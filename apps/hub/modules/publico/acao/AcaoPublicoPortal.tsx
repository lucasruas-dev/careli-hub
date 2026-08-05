"use client";

import { KeyRound, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { AcoesView } from "@/modules/caredesk/blocks/acoes/acoes-view";

// TELA PÚBLICA da ação de contato (freela sem conta do hub). Dois estados, no espírito do portal de
// CAD: 1) PORTÃO — a senha da campanha troca por um token de sessão (x-acao-sessao); 2) LISTA — a
// MESMA AcoesView do interno, agora em modo público (tokenPublico), lendo/gravando por /api/publico/acao.
//
// ⚠️ A senha só vale para ESTA campanha e nada aqui autoriza nada sozinho: o vínculo (qual ação) nasce
// do token assinado no servidor. Ver [[project_apolo_acao_contato]].

const chaveSessao = (slug: string) => `acao-sessao:${slug}`;

export function AcaoPublicoPortal({ slug }: { slug: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [senha, setSenha] = useState("");
  const [entrando, setEntrando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Evita o flash do portão antes de rehidratar a sessão salva.
  const [pronto, setPronto] = useState(false);

  // Sessão em sessionStorage (não cookie): morre ao fechar a aba, o que importa num note emprestado.
  useEffect(() => {
    const salvo = window.sessionStorage.getItem(chaveSessao(slug));
    if (salvo) setToken(salvo);
    setPronto(true);
  }, [slug]);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setEntrando(true);
    setErro(null);
    try {
      const resp = await fetch("/api/publico/acao/sessao", {
        body: JSON.stringify({ senha, slug }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const json = (await resp.json().catch(() => null)) as {
        data?: { nome?: string; token?: string };
        error?: string;
      } | null;
      if (!resp.ok || !json?.data?.token) {
        setErro(json?.error ?? "Acesso ou senha inválidos.");
        return;
      }
      window.sessionStorage.setItem(chaveSessao(slug), json.data.token);
      setToken(json.data.token);
    } catch {
      setErro("Não foi possível entrar agora. Tente de novo.");
    } finally {
      setEntrando(false);
    }
  }

  if (!pronto) return null;

  if (token) {
    // A LISTA. `publico-shell` neutraliza o min-width de 1024px (globals.css) num celular; 100dvh dá
    // a altura definida que o `h-full` interno da AcoesView precisa para rolar por dentro.
    return (
      <div className="publico-shell bg-canvas" style={{ height: "100dvh" }}>
        <AcoesView tokenPublico={token} />
      </div>
    );
  }

  // O PORTÃO.
  return (
    <div className="publico-shell flex min-h-[100dvh] items-center justify-center bg-canvas px-4">
      <form
        className="w-full max-w-sm rounded-2xl border border-line bg-surface p-7 shadow-sm"
        onSubmit={entrar}
      >
        <div className="mb-5 flex flex-col items-center text-center">
          <span className="mb-3 inline-flex size-12 items-center justify-center rounded-full bg-[#A07C3B]/12 text-[#A07C3B]">
            <KeyRound aria-hidden="true" className="size-6" />
          </span>
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-[#A07C3B]">
            Ação de contato
          </p>
          <h1 className="m-0 mt-1 text-xl font-black text-ink">Acesso da equipe</h1>
          <p className="m-0 mt-1 text-sm text-ink-muted">
            Informe a senha da campanha para abrir a lista.
          </p>
        </div>

        <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          Senha
        </label>
        <input
          autoComplete="off"
          autoFocus
          className="h-11 w-full rounded-lg border border-line bg-canvas px-3 text-sm text-ink outline-none focus:border-[#A07C3B]"
          onChange={(e) => setSenha(e.target.value)}
          placeholder="••••••••"
          type="password"
          value={senha}
        />

        {erro ? (
          <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {erro}
          </p>
        ) : null}

        <button
          className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#A07C3B] text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
          disabled={entrando || senha.length === 0}
          type="submit"
        >
          {entrando ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
          Entrar
        </button>
      </form>
    </div>
  );
}
