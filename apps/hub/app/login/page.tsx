"use client";

import { useAuth } from "@/providers/auth-provider";
import { Badge, Button, Surface, TextField } from "@repo/uix";
import { Lock, LogIn, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("operacao@careli.local");
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
    <main className="grid min-h-screen grid-cols-[minmax(0,1fr)_28rem] bg-[#0b0d11] text-white">
      <section className="flex min-h-0 flex-col justify-between border-r border-white/[0.08] bg-[#101217] p-10">
        <div>
          <Badge variant="info">Careli Hub</Badge>
          <h1 className="m-0 mt-6 max-w-3xl text-4xl font-semibold leading-tight">
            Entrada operacional para o ecossistema Careli.
          </h1>
          <p className="m-0 mt-4 max-w-2xl text-sm leading-6 text-[#aeb7c5]">
            PulseX ja esta liberado. Os demais modulos ficam em preparacao ate a
            transicao para produto real estar pronta.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-sm text-[#c5ceda]">
          <div className="rounded-md border border-white/[0.08] bg-white/[0.035] p-3">
            PulseX ativo
          </div>
          <div className="rounded-md border border-white/[0.08] bg-white/[0.035] p-3">
            Auth mock
          </div>
          <div className="rounded-md border border-white/[0.08] bg-white/[0.035] p-3">
            Supabase futuro
          </div>
        </div>
      </section>
      <section className="grid place-items-center bg-[#f3f6fa] px-8">
        <Surface className="w-full max-w-sm">
          <div className="mb-6">
            <p className="m-0 text-xs font-semibold uppercase text-[var(--uix-text-muted)]">
              Acesso
            </p>
            <h2 className="m-0 mt-2 text-2xl font-semibold text-[var(--uix-text-primary)]">
              Entrar no Hub
            </h2>
          </div>
          <form className="grid gap-4" onSubmit={handleSubmit}>
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
            <Button
              isLoading={isSubmitting}
              startIcon={<LogIn size={16} />}
              type="submit"
              variant="primary"
            >
              Entrar
            </Button>
          </form>
        </Surface>
      </section>
    </main>
  );
}
