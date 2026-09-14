"use client";

import { KeyRound, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { MINIMO_DE_CARACTERES } from "@/lib/auth/senha-nova";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// O PORTÃO DA SENHA NOVA.
//
// Lucas (13/09/2026): *"quero que todos amanhã ao logar no panteon possa configurar uma senha nova.
// isso vai virar padrão, primeiro acesso eu coloco a senha como é hoje, no acesso, o sistema pede
// para ele cadastrar uma nova senha"*.
//
// ⚠️ UM COMPONENTE PRÓPRIO, E NÃO CIRURGIA NO `auth-provider`. O provider tem 600+ linhas e decide
// quem entra em todo o hub; enfiar mais um estado lá dentro, de madrugada, para uma trava que
// BLOQUEIA a tela é a receita de deixar o time inteiro de fora amanhã de manhã. Aqui o pior caso é
// o portão não aparecer — e ninguém fica trancado.
//
// ⚠️ E É POR ISSO QUE TODA FALHA LIBERA. Rede fora, resposta estranha, token velho: o portão some e
// a pessoa trabalha. O custo desse erro é um dia a mais com a senha antiga; o custo do erro
// contrário é a operação parada.

export function PortaoDeSenha() {
  const [precisa, setPrecisa] = useState(false);
  const [senha, setSenha] = useState("");
  const [repetida, setRepetida] = useState("");
  const [erro, setErro] = useState<null | string>(null);
  const [salvando, setSalvando] = useState(false);
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    let vivo = true;

    void (async () => {
      try {
        const token = await getApoloAccessToken();
        if (!token) return;
        const r = await fetch("/api/auth/senha-nova", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) return;
        const corpo = (await r.json()) as { precisa?: boolean };
        if (vivo && corpo.precisa === true) setPrecisa(true);
      } catch {
        // Ver a nota do topo: falhar aqui não tranca ninguém.
      }
    })();

    return () => {
      vivo = false;
    };
  }, []);

  const trocar = useCallback(async () => {
    setErro(null);

    // ⚠️ A CONFERÊNCIA DAS DUAS CAIXAS É AQUI E SÓ AQUI. O servidor não recebe a repetição — ele não
    // tem como saber o que a pessoa quis digitar duas vezes. Mandar as duas só daria ao servidor uma
    // chance a mais de vazar senha em log.
    if (senha !== repetida) {
      setErro("As duas senhas não são iguais.");
      return;
    }

    setSalvando(true);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch("/api/auth/senha-nova", {
        body: JSON.stringify({ senha }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const corpo = (await r.json().catch(() => null)) as null | { error?: string };
      if (!r.ok) throw new Error(corpo?.error ?? "Não foi possível trocar a senha.");
      setPronto(true);
      setPrecisa(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível trocar a senha.");
    } finally {
      setSalvando(false);
    }
  }, [repetida, senha]);

  if (pronto) {
    return (
      <div className="fixed inset-x-0 bottom-4 z-[100] mx-auto w-fit rounded-full border border-line bg-surface px-4 py-2 font-medium text-ink text-sm shadow-lg">
        Senha trocada. Da próxima vez, entre com a nova.
      </div>
    );
  }

  if (!precisa) return null;

  const curta = senha.length > 0 && senha.length < MINIMO_DE_CARACTERES;

  return (
    // ⚠️ SEM BOTÃO DE FECHAR, E SEM FECHAR NO ESC. É uma exigência, não um aviso — e um modal que
    // fecha vira um modal que todo mundo fecha.
    <div
      aria-modal="true"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
    >
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 shadow-xl">
        <div className="mb-3 flex items-center gap-2">
          <KeyRound aria-hidden="true" className="size-5 shrink-0 text-ink" />
          <h2 className="m-0 font-semibold text-base text-ink">Cadastre uma senha nova</h2>
        </div>

        {/* ⚠️ A FRASE DIZ POR QUÊ. "Por segurança" não explica nada; o motivo real é que a senha
            atual foi entregue por outra pessoa, e quem sabe disso entende o pedido na hora. */}
        <p className="m-0 text-ink-soft text-sm leading-relaxed">
          A senha que você usa hoje foi definida por quem criou o seu acesso. Escolha uma
          só sua para continuar.
        </p>

        <label className="mt-4 flex flex-col gap-1">
          <span className="font-medium text-[11px] text-ink-muted">Senha nova</span>
          <input
            autoComplete="new-password"
            className="h-9 rounded-lg border border-line bg-surface px-3 text-ink text-sm"
            onChange={(e) => setSenha(e.target.value)}
            type="password"
            value={senha}
          />
        </label>

        <label className="mt-2 flex flex-col gap-1">
          <span className="font-medium text-[11px] text-ink-muted">Repita a senha</span>
          <input
            autoComplete="new-password"
            className="h-9 rounded-lg border border-line bg-surface px-3 text-ink text-sm"
            onChange={(e) => setRepetida(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !salvando) void trocar();
            }}
            type="password"
            value={repetida}
          />
        </label>

        <p className="m-0 mt-2 text-ink-muted text-xs">
          Pelo menos {MINIMO_DE_CARACTERES} caracteres, e diferente da atual.
        </p>

        {erro ? (
          <p className="m-0 mt-2 font-medium text-rose-600 text-sm dark:text-rose-300">{erro}</p>
        ) : null}

        <button
          className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-inverse px-4 font-semibold text-brand-ink text-sm disabled:opacity-50"
          disabled={salvando || curta || senha.length === 0 || repetida.length === 0}
          onClick={() => void trocar()}
          type="button"
        >
          {salvando ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
          Salvar e continuar
        </button>
      </div>
    </div>
  );
}
