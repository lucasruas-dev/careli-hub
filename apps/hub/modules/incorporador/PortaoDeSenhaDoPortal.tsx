"use client";

import { useCallback, useEffect, useState } from "react";

import { MINIMO_DE_CARACTERES } from "@/lib/auth/senha-nova";

// O PORTÃO DA SENHA NOVA — lado do portal (comercial e incorporador).
//
// ⚠️ É O IRMÃO DE `components/auth/portao-de-senha.tsx`, E ELES NÃO SE FUNDEM. O hub autentica com
// token do Supabase Auth no cabeçalho; o portal, com cookie httpOnly assinado. As duas telas
// perguntam a coisa certa ao servidor certo, e o que elas de fato compartilham — a régua da senha —
// mora em `lib/auth/senha-nova.ts`. Unificar o componente obrigaria a passar o modo de autenticação
// por prop, que é a mesma coisa com um nome pior.
//
// ⚠️ TODA FALHA LIBERA. Rede fora, cookie velho, resposta estranha: o portão some e a pessoa
// trabalha. O custo desse erro é um dia a mais com a senha antiga; o contrário é o corretor sem
// conseguir abrir a mesa de venda com o cliente na frente dele.
//
// ⚠️ SEM TOKEN NO CORPO E SEM `usuarioId`: a conta sai do cookie, no servidor. Ver a nota da rota.

export function PortaoDeSenhaDoPortal() {
  const [precisa, setPrecisa] = useState(false);
  const [senha, setSenha] = useState("");
  const [repetida, setRepetida] = useState("");
  const [erro, setErro] = useState<null | string>(null);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;

    void (async () => {
      try {
        const r = await fetch("/api/incorporador/senha-nova", { cache: "no-store" });
        if (!r.ok) return;
        const corpo = (await r.json()) as { precisa?: boolean };
        if (vivo && corpo.precisa === true) setPrecisa(true);
      } catch {
        // Ver a nota do topo.
      }
    })();

    return () => {
      vivo = false;
    };
  }, []);

  const trocar = useCallback(async () => {
    setErro(null);
    if (senha !== repetida) {
      setErro("As duas senhas não são iguais.");
      return;
    }

    setSalvando(true);
    try {
      const r = await fetch("/api/incorporador/senha-nova", {
        body: JSON.stringify({ senha }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const corpo = (await r.json().catch(() => null)) as null | { error?: string };
      if (!r.ok) throw new Error(corpo?.error ?? "Não foi possível trocar a senha.");
      setPrecisa(false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível trocar a senha.");
    } finally {
      setSalvando(false);
    }
  }, [repetida, senha]);

  if (!precisa) return null;

  const curta = senha.length > 0 && senha.length < MINIMO_DE_CARACTERES;

  return (
    <div
      aria-modal="true"
      role="dialog"
      style={{
        alignItems: "center",
        background: "rgba(0,0,0,.62)",
        backdropFilter: "blur(3px)",
        display: "flex",
        inset: 0,
        justifyContent: "center",
        padding: 16,
        position: "fixed",
        zIndex: 1000,
      }}
    >
      {/* ⚠️ ESTILO INLINE, e não Tailwind: o portal tem tema próprio (claro/escuro por
          `data-inc-tema`) e não compartilha os tokens do hub. Cor de token daqui sairia errada lá. */}
      <div
        style={{
          background: "var(--inc-surface, #fff)",
          border: "1px solid var(--inc-border, #e4e4e7)",
          borderRadius: 16,
          boxShadow: "0 18px 48px rgba(0,0,0,.28)",
          color: "var(--inc-text, #18181b)",
          maxWidth: 420,
          padding: 24,
          width: "100%",
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 700, margin: "0 0 8px" }}>
          Cadastre uma senha nova
        </h2>
        <p style={{ fontSize: 13, lineHeight: 1.55, margin: 0, opacity: 0.78 }}>
          A senha que você usa hoje foi definida por quem criou o seu acesso. Escolha uma só sua
          para continuar.
        </p>

        {[
          { rotulo: "Senha nova", set: setSenha, valor: senha },
          { rotulo: "Repita a senha", set: setRepetida, valor: repetida },
        ].map((campo) => (
          <label
            key={campo.rotulo}
            style={{ display: "block", marginTop: 14 }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, opacity: 0.7 }}>{campo.rotulo}</span>
            <input
              autoComplete="new-password"
              onChange={(e) => campo.set(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !salvando) void trocar();
              }}
              style={{
                background: "transparent",
                border: "1px solid var(--inc-border, #e4e4e7)",
                borderRadius: 8,
                color: "inherit",
                font: "inherit",
                fontSize: 14,
                height: 38,
                marginTop: 4,
                padding: "0 10px",
                width: "100%",
              }}
              type="password"
              value={campo.valor}
            />
          </label>
        ))}

        <p style={{ fontSize: 11.5, margin: "8px 0 0", opacity: 0.62 }}>
          Pelo menos {MINIMO_DE_CARACTERES} caracteres, e diferente da atual.
        </p>

        {erro ? (
          <p style={{ color: "#dc2626", fontSize: 13, fontWeight: 600, margin: "8px 0 0" }}>
            {erro}
          </p>
        ) : null}

        <button
          disabled={salvando || curta || senha.length === 0 || repetida.length === 0}
          onClick={() => void trocar()}
          style={{
            background: "var(--inc-accent, #18181b)",
            border: "none",
            borderRadius: 8,
            color: "#fff",
            cursor: salvando ? "progress" : "pointer",
            font: "inherit",
            fontSize: 14,
            fontWeight: 700,
            height: 38,
            marginTop: 16,
            opacity: salvando || curta || !senha || !repetida ? 0.5 : 1,
            width: "100%",
          }}
          type="button"
        >
          {salvando ? "Salvando…" : "Salvar e continuar"}
        </button>
      </div>
    </div>
  );
}
