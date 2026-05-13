"use client";

import { useAuth } from "@/providers/auth-provider";
import { TextField, Tooltip } from "@repo/uix";
import { KeyRound, Lock, LogIn, Mail } from "lucide-react";
import Image from "next/image";
import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("operacao@careli.com.br");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const result = await signIn({
      email,
      password,
    });

    if (!result.ok) {
      setError(result.error);
      setIsSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#f3f6fa] px-6 py-10 text-[#101820]">
      <section className="w-full max-w-[25rem]">
        <div className="mb-8 grid justify-items-center text-center">
          <span className="grid h-20 w-20 place-items-center rounded-md border border-[#d9e0ea] bg-white p-3 shadow-sm">
            <Image
              alt="Careli"
              className="h-full w-full object-contain"
              height={80}
              priority
              src="/logoc.png"
              width={80}
            />
          </span>
          <h1 className="m-0 mt-5 text-3xl font-semibold tracking-normal text-[#101820]">
            Hub Careli
          </h1>
          <p className="m-0 mt-2 text-sm font-medium text-[#667085]">
            Central Operacional
          </p>
        </div>

        <form
          className="grid gap-4 rounded-md border border-[#d9e0ea] bg-white p-6 shadow-[0_20px_55px_rgb(16_24_32_/_0.10)]"
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
                className="grid h-11 w-11 place-items-center rounded-md bg-[#A07C3B] text-white outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)] disabled:cursor-not-allowed disabled:bg-[#d8dde6] disabled:text-[#7d8796]"
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
