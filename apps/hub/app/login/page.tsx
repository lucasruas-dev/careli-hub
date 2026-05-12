"use client";

import {
  pulsexChannels,
  pulsexPresenceUsers,
} from "@/lib/pulsex";
import type { PulseXChannel } from "@/lib/pulsex";
import { useAuth } from "@/providers/auth-provider";
import { isHubModuleActive, orderedHubModules } from "@repo/shared";
import { Badge, Button, Surface, TextField } from "@repo/uix";
import {
  Activity,
  Lock,
  LogIn,
  Mail,
  MessageSquareText,
  Radio,
  ShieldCheck,
  Users,
} from "lucide-react";
import Image from "next/image";
import { useState, type FormEvent } from "react";

const onlineUsers = pulsexPresenceUsers.filter(
  (user) => user.status === "online",
);
const loginPulseXChannels: readonly PulseXChannel[] = pulsexChannels;
const activeModulesCount = orderedHubModules.filter(isHubModuleActive).length;
const unreadPulseXCount = loginPulseXChannels.reduce(
  (total, channel) => total + (channel.unreadCount ?? 0),
  0,
);
const operationalStatus = [
  {
    icon: <Radio size={16} />,
    label: "Hub",
    value: "Operacional",
  },
  {
    icon: <MessageSquareText size={16} />,
    label: "PulseX",
    value: "Online",
  },
  {
    icon: <Users size={16} />,
    label: "Usuarios online",
    value: String(onlineUsers.length),
  },
  {
    icon: <ShieldCheck size={16} />,
    label: "Modulos ativos",
    value: String(activeModulesCount),
  },
] as const;

const activityItems = [
  {
    label: "PulseX",
    meta: `${unreadPulseXCount} nao lidas`,
    status: "online",
  },
  {
    label: "Guardian",
    meta: "Em preparacao",
    status: "preparing",
  },
  {
    label: "Agenda / Financeiro / Drive",
    meta: "Aguardando liberacao",
    status: "queued",
  },
] as const;

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
    <main className="grid min-h-screen grid-cols-[minmax(0,1fr)_27rem] bg-[#edf1f6] text-[#17202f]">
      <section className="relative overflow-hidden border-r border-[#d9e0ea]">
        <div className="absolute inset-x-0 top-0 h-1 bg-[#A07C3B]" />
        <div className="grid min-h-screen grid-rows-[auto_minmax(0,1fr)_auto] px-10 py-8">
          <header className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-md border border-[#d9e0ea] bg-white p-1.5 shadow-sm">
                <Image
                  alt=""
                  aria-hidden="true"
                  className="h-full w-full object-contain"
                  height={48}
                  priority
                  src="/logo-hub.png"
                  width={48}
                />
              </span>
              <div>
                <p className="m-0 text-base font-semibold text-[#101820]">
                  Careli Hub
                </p>
                <p className="m-0 text-xs uppercase text-[#6f7c8f]">
                  Central operacional
                </p>
              </div>
            </div>
            <Badge variant="success">Operacional</Badge>
          </header>

          <div className="grid content-center gap-6 py-8">
            <div className="max-w-3xl">
              <p className="m-0 text-xs font-semibold uppercase text-[#8A682F]">
                Entrada segura
              </p>
              <h1 className="m-0 mt-3 text-4xl font-semibold leading-tight text-[#101820]">
                Acesso ao centro operacional Careli.
              </h1>
              <p className="m-0 mt-4 max-w-2xl text-sm leading-6 text-[#5c6878]">
                Acompanhe comunicacao, presenca e modulos liberados em um unico
                ambiente de operacao.
              </p>
            </div>

            <div className="grid grid-cols-4 gap-3">
              {operationalStatus.map((item) => (
                <div
                  className="min-h-24 rounded-md border border-[#d9e0ea] bg-white/80 p-3 shadow-[0_10px_30px_rgb(16_24_32_/_0.05)]"
                  key={item.label}
                >
                  <div className="flex items-center justify-between gap-2 text-[#8A682F]">
                    {item.icon}
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  </div>
                  <p className="m-0 mt-4 text-xs text-[#6f7c8f]">
                    {item.label}
                  </p>
                  <p className="m-0 mt-1 text-base font-semibold text-[#101820]">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_20rem] gap-4">
              <section className="rounded-md border border-[#d9e0ea] bg-white/85 p-4 shadow-[0_14px_38px_rgb(16_24_32_/_0.06)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="m-0 text-sm font-semibold text-[#101820]">
                      Operacao em andamento
                    </p>
                    <p className="m-0 mt-1 text-xs text-[#6f7c8f]">
                      Sinais principais do Hub nesta sessao.
                    </p>
                  </div>
                  <Activity aria-hidden="true" className="text-[#A07C3B]" size={18} />
                </div>
                <div className="mt-4 grid gap-3">
                  {activityItems.map((item) => (
                    <div
                      className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 border-t border-[#edf1f6] pt-3 first:border-t-0 first:pt-0"
                      key={item.label}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full data-[status=online]:bg-emerald-500 data-[status=preparing]:bg-[#A07C3B] data-[status=queued]:bg-[#95a0af]"
                        data-status={item.status}
                      />
                      <span className="truncate text-sm font-medium text-[#253044]">
                        {item.label}
                      </span>
                      <span className="text-xs text-[#6f7c8f]">{item.meta}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-md border border-[#d9e0ea] bg-[#101820] p-4 text-white shadow-[0_14px_38px_rgb(16_24_32_/_0.12)]">
                <div className="flex items-center justify-between gap-3">
                  <p className="m-0 text-sm font-semibold">Presenca</p>
                  <Badge variant="info">{onlineUsers.length} online</Badge>
                </div>
                <div className="mt-4 grid gap-3">
                  {pulsexPresenceUsers.map((user) => (
                    <div
                      className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3"
                      key={user.id}
                    >
                      <span className="relative grid h-8 w-8 place-items-center rounded-full bg-white/10 text-xs font-semibold">
                        {user.initials}
                        <span
                          className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-[#101820] data-[status=away]:bg-amber-400 data-[status=busy]:bg-[#A07C3B] data-[status=offline]:bg-zinc-400 data-[status=online]:bg-emerald-500"
                          data-status={user.status}
                        />
                      </span>
                      <span className="truncate text-sm">{user.label}</span>
                      <span className="text-xs text-white/55">{user.role}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>

          <footer className="flex items-center justify-between gap-4 border-t border-[#d9e0ea] pt-4 text-xs text-[#6f7c8f]">
            <span>PulseX online</span>
            <span>Guardian em preparacao</span>
            <span>Careli Operacao</span>
          </footer>
        </div>
      </section>

      <section className="grid place-items-center bg-[#f7f9fc] px-8">
        <Surface
          bordered
          className="w-full max-w-[23rem] shadow-[0_20px_50px_rgb(16_24_32_/_0.12)]"
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="m-0 text-xs font-semibold uppercase text-[#8A682F]">
                Acesso
              </p>
              <h2 className="m-0 mt-2 text-2xl font-semibold text-[var(--uix-text-primary)]">
                Entrar no Hub
              </h2>
              <p className="m-0 mt-2 text-xs leading-5 text-[var(--uix-text-muted)]">
                Sessao operacional da Careli.
              </p>
            </div>
            <span className="grid h-9 w-9 place-items-center rounded-md bg-[#101820] text-white">
              <Lock aria-hidden="true" size={17} />
            </span>
          </div>
          <form className="grid gap-3.5" onSubmit={handleSubmit}>
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
