"use client";

import { AlertTriangle, Loader2, LogIn } from "lucide-react";
import { useEffect, useState } from "react";

import { loginOperador } from "../../data/prometeu-operations";

// LOGIN do operador do evento — a porta de entrada de quem NÃO tem conta do hub (freelas, e os
// gestores externos). Decisão do Lucas (31/jul): externo entra por aqui, interno usa o hub.
//
// Serve CELULAR e PC no mesmo layout: no celular é uma coluna só (o cartão ocupa a tela); a partir
// de `lg` vira duas colunas, com a identidade do lançamento à esquerda e o formulário à direita —
// no PC um cartãozinho perdido no meio da tela parece página quebrada.
//
// A credencial é username (nome.sobrenome) + senha, NÃO é o usuário do hub. O erro vem genérico da
// rota ("Usuário ou senha inválidos.") de propósito.

// Só o nome do lançamento, de uma rota pública que não devolve mais nada. É o que dá ao freela a
// certeza de que abriu o link certo antes de digitar a senha.
async function buscarLancamento(): Promise<string | null> {
  try {
    const r = await fetch("/api/publico/prometeu/evento", { cache: "no-store" });
    if (!r.ok) return null;
    const corpo = (await r.json()) as { data?: { nome?: string | null } };
    return corpo.data?.nome?.trim() || null;
  } catch {
    return null;
  }
}

export function LoginOperador({ aoEntrar }: { aoEntrar: () => void }) {
  const [username, setUsername] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [lancamento, setLancamento] = useState<string | null>(null);

  useEffect(() => {
    void (async () => setLancamento(await buscarLancamento()))();
  }, []);

  async function entrar() {
    if (enviando) return;
    const usuario = username.trim();
    if (!usuario || !senha) return;

    setErro(null);
    setEnviando(true);
    const { data, error } = await loginOperador(usuario, senha);
    setEnviando(false);

    if (error || !data) {
      setErro(error ?? "Usuário ou senha inválidos.");
      return;
    }

    aoEntrar();
  }

  const titulo = lancamento ?? "Lançamento";

  return (
    <main className="publico-shell relative flex min-h-[100dvh] w-full flex-col overflow-hidden bg-[#0b1017] text-white">
      {/* brilho dourado ao fundo, o mesmo idioma visual das outras telas do evento */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [background:radial-gradient(900px_500px_at_15%_-10%,rgba(203,162,90,.16),transparent_60%),radial-gradient(700px_400px_at_100%_100%,rgba(22,40,58,.9),transparent_55%)]"
      />

      {/* `content-center` (e não `items-center`): no celular as duas partes viram duas linhas de
          grade e `items-center` as ESTICAVA pela altura toda, abrindo um vão morto entre o título e
          o formulário. Com `content-center` o conjunto fica centralizado como um bloco só. */}
      <div className="relative mx-auto grid w-full max-w-6xl flex-1 content-center gap-7 px-6 py-8 lg:grid-cols-2 lg:items-center lg:gap-16 lg:px-10 lg:py-10">
        {/* IDENTIDADE — no celular fica em cima, compacta; no PC ocupa a coluna da esquerda */}
        <header className="text-center lg:text-left">
          {/* eslint-disable-next-line @next/next/no-img-element -- logo estatica, sem otimizacao */}
          <img
            alt="C2X"
            className="mx-auto h-7 w-auto opacity-95 lg:mx-0 lg:h-9"
            src="/c2x-logo-branca.png"
          />
          <p className="m-0 mt-6 text-[11px] font-black uppercase tracking-[0.22em] text-[#cba25a] lg:mt-10">
            Lançamento
          </p>
          <h1 className="m-0 mt-1 text-balance text-[34px] font-black leading-[1.05] lg:text-[52px]">
            {titulo}
          </h1>
          <p className="m-0 mt-3 text-sm text-white/55 lg:mt-5 lg:max-w-sm lg:text-base">
            Acesso da equipe do evento. Entre com o usuário e a senha que a organização criou para
            você.
          </p>
        </header>

        {/* FORMULÁRIO */}
        <div className="w-full lg:justify-self-end lg:max-w-md">
          <form
            className="space-y-3 rounded-3xl border border-white/10 bg-white/[0.04] p-5 backdrop-blur-sm lg:p-7"
            onSubmit={(e) => {
              e.preventDefault();
              void entrar();
            }}
          >
            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-white/70">Usuário</span>
              <input
                autoCapitalize="none"
                autoComplete="username"
                autoCorrect="off"
                className="h-12 w-full rounded-xl border border-white/15 bg-black/25 px-3.5 text-base text-white outline-none transition placeholder:text-white/30 focus:border-[#cba25a]"
                inputMode="text"
                onChange={(e) => setUsername(e.target.value)}
                placeholder="nome.sobrenome"
                spellCheck={false}
                value={username}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-xs font-bold text-white/70">Senha</span>
              <input
                autoComplete="current-password"
                className="h-12 w-full rounded-xl border border-white/15 bg-black/25 px-3.5 text-base text-white outline-none transition placeholder:text-white/30 focus:border-[#cba25a]"
                onChange={(e) => setSenha(e.target.value)}
                placeholder="Sua senha"
                type="password"
                value={senha}
              />
            </label>

            {erro ? (
              <p className="m-0 flex items-center gap-2 rounded-xl border border-red-400/40 bg-red-500/15 px-3 py-2.5 text-[13px] text-red-200">
                <AlertTriangle aria-hidden="true" className="size-4 shrink-0" />
                {erro}
              </p>
            ) : null}

            <button
              className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#cba25a] text-base font-black text-[#101820] transition active:scale-[.99] disabled:opacity-50"
              disabled={enviando || !username.trim() || !senha}
              type="submit"
            >
              {enviando ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <LogIn aria-hidden="true" className="size-[18px]" />
              )}
              Entrar
            </button>

            <p className="m-0 pt-1 text-center text-[11px] leading-relaxed text-white/35">
              Perdeu a senha? Fale com a organização do evento.
            </p>
          </form>
        </div>
      </div>
    </main>
  );
}
