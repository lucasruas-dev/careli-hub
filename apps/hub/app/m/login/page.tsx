"use client";

import { useState, type FormEvent } from "react";
import { Loader2, LogIn } from "lucide-react";

import { useAuth } from "@/providers/auth-provider";

// Login mobile-first (tela cheia, encaixa no celular sem zoom). Usa o mesmo
// signIn do AuthProvider; ao autenticar, o provider redireciona pra /m/iris.
export default function MobileLoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const result = await signIn({ email: email.trim(), password });

      if (!result.ok) {
        setError(result.error);
        setSubmitting(false);
      }
    } catch {
      setError("Nao foi possivel validar seu acesso. Tente novamente.");
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-[100dvh] flex-col justify-center gap-7 bg-[#101820] px-6 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <div className="grid justify-items-center gap-2 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element -- asset estatico, login independe de otimizacao de imagem */}
        <img
          alt="Panteon"
          className="h-auto w-40 max-w-[65%] object-contain"
          decoding="async"
          height={772}
          src="/panteon-logo-light.png?v=1"
          width={870}
        />
        <p className="m-0 text-sm text-[#9fb0c2]">Acesso da operação</p>
      </div>

      <form
        className="grid w-full gap-3 rounded-2xl bg-white p-5"
        onSubmit={handleSubmit}
      >
        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-[#526078]">E-mail</span>
          <input
            autoCapitalize="none"
            autoComplete="email"
            className="h-12 w-full rounded-xl border border-[#d9e0ea] px-4 text-base text-[#101820] outline-none transition focus:border-[#A07C3B]"
            inputMode="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="voce@careli.com"
            type="email"
            value={email}
          />
        </label>

        <label className="grid gap-1.5">
          <span className="text-xs font-medium text-[#526078]">Senha</span>
          <input
            autoComplete="current-password"
            className="h-12 w-full rounded-xl border border-[#d9e0ea] px-4 text-base text-[#101820] outline-none transition focus:border-[#A07C3B]"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Sua senha"
            type="password"
            value={password}
          />
        </label>

        {error ? (
          <p className="m-0 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            {error}
          </p>
        ) : null}

        <button
          className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#101820] text-base font-medium text-white outline-none transition active:scale-[0.98] disabled:opacity-60"
          disabled={submitting || !email.trim() || !password}
          type="submit"
        >
          {submitting ? (
            <Loader2 aria-hidden="true" className="animate-spin" size={19} />
          ) : (
            <LogIn aria-hidden="true" size={19} />
          )}
          Entrar
        </button>
      </form>
    </main>
  );
}
