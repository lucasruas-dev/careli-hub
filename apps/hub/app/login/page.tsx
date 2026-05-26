"use client";

import { useAuth } from "@/providers/auth-provider";
import { TextField, Tooltip } from "@repo/uix";
import { KeyRound, Lock, LogIn, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const result = await signIn({
        email,
        password,
      });

      if (!result.ok) {
        setError(result.error);
        setIsSubmitting(false);
      }
    } catch (error) {
      setError(getLoginErrorMessage(error));
      setIsSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#101820] px-5 py-8 text-[#101820]">
      <section className="grid w-full max-w-sm gap-5">
        <div className="grid justify-items-center gap-3 text-center text-white">
          {/* eslint-disable-next-line @next/next/no-img-element -- static public asset keeps login independent from image optimization. */}
          <img
            alt="Panteon"
            className="h-auto w-56 max-w-[82vw] object-contain sm:w-64"
            decoding="async"
            height="772"
            src="/panteon-logo-light.png?v=1"
            width="870"
          />
          <h1 className="sr-only">Panteon</h1>
        </div>

        <form
          className="grid w-full gap-4 rounded-md border border-[#d9e0ea] bg-white p-5 shadow-[0_22px_60px_rgb(0_0_0_/_0.28)]"
          onSubmit={handleSubmit}
        >
          <TextField
            autoComplete="email"
            label="E-mail"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="voce@careli.com"
            startIcon={<Mail size={16} />}
            type="email"
            value={email}
          />
          <TextField
            autoComplete="current-password"
            error={error}
            label="Senha"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Senha"
            startIcon={<Lock size={16} />}
            type="password"
            value={password}
          />

          <div className="mt-1 flex items-center justify-between">
            <Tooltip content="Recuperar senha">
              <button
                aria-label="Recuperar senha"
                className="grid h-10 w-10 place-items-center rounded-md border border-[#d9e0ea] text-[#7b5f2d] outline-none transition hover:border-[#A07C3B]/40 hover:bg-[#A07C3B]/10 hover:text-[#A07C3B] focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
                type="button"
              >
                <KeyRound aria-hidden="true" size={17} />
              </button>
            </Tooltip>

            <Tooltip content="Entrar">
              <button
                aria-label="Entrar"
                className="grid h-11 w-11 place-items-center rounded-md bg-[#101820] text-white outline-none transition hover:bg-[#A07C3B] focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)] disabled:cursor-not-allowed disabled:bg-[#d8dde6] disabled:text-[#7d8796]"
                disabled={isSubmitting}
                type="submit"
              >
                <LogIn aria-hidden="true" size={18} />
              </button>
            </Tooltip>
          </div>
        </form>
      </section>
    </main>
  );
}

function getLoginErrorMessage(error: unknown) {
  if (error instanceof Error) {
    const normalizedMessage = error.message.trim().toLowerCase();

    if (
      normalizedMessage.includes("failed to fetch") ||
      normalizedMessage.includes("fetch failed") ||
      normalizedMessage.includes("network")
    ) {
      return "Nao foi possivel conectar ao Supabase agora. Verifique sua conexao e tente novamente.";
    }
  }

  return "Nao foi possivel validar seu acesso ao Panteon. Tente novamente.";
}
