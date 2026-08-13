"use client";

import { useCallback, useEffect, useState } from "react";

import { ALVO_TOQUE, fonte } from "@/modules/publico/ui/tokens";

import { Marca, T, TEMA_CSS } from "./tema";

import { TelaProdutos } from "./TelaProdutos";

// PORTAL DO INCORPORADOR — a porta e as três telas.
//
// Desenho pedido pelo Lucas (10/08): "a tela inicial para eles fazerem acesso com a logo deles",
// e dentro "Vendas - Carteira(quando tiver) - Produtos". A marca do CLIENTE manda na tela; a
// nossa aparece como assinatura discreta no rodapé, ordem dele: "sempre marcar c2x".
//
// Paleta: a das telas públicas (modules/publico/ui/tokens), a mesma do masterplan que o Cecílio
// já validou. Nada de tema próprio por cliente ainda — hoje personalização é a logo, e inventar
// cor por cliente exigiria alcançar as duas cópias da paleta que existem no repo.

type Sessao = {
  empreendimentos: string[];
  empreendimentosComCarteira: string[];
  incorporador: { nome: string; slug: string };
  usuario: { nome: string };
};

type Aba = "carteira" | "crm" | "produtos" | "vendas";

export function PortalIncorporador({
  logoEscuraUrl,
  logoUrl,
  nome,
  slug,
}: {
  logoEscuraUrl: string | null;
  logoUrl: string | null;
  nome: string;
  slug: string;
}) {
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aba, setAba] = useState<Aba>("produtos");

  const carregarSessao = useCallback(async () => {
    try {
      const resposta = await fetch("/api/incorporador/sessao", { cache: "no-store" });
      const payload = (await resposta.json()) as { data: Sessao | null };
      setSessao(payload.data);
    } catch {
      setSessao(null);
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    void carregarSessao();
  }, [carregarSessao]);

  if (carregando) {
    return <Moldura logoEscuraUrl={logoEscuraUrl} logoUrl={logoUrl} nome={nome}><div style={{ color: T.muted, fontSize: 14, textAlign: "center" }}>Carregando…</div></Moldura>;
  }

  if (!sessao) {
    return (
      <Moldura logoEscuraUrl={logoEscuraUrl} logoUrl={logoUrl} nome={nome}>
        <Porta aoEntrar={carregarSessao} slug={slug} />
      </Moldura>
    );
  }

  return (
    <Portal
      aba={aba}
      aoSair={async () => {
        await fetch("/api/incorporador/sessao", { method: "DELETE" });
        setSessao(null);
      }}
      onAba={setAba}
      sessao={sessao}
    />
  );
}

// ── A PORTA ─────────────────────────────────────────────────────────────────

function Moldura({
  children,
  logoEscuraUrl,
  logoUrl,
  nome,
}: {
  children: React.ReactNode;
  logoEscuraUrl: string | null;
  logoUrl: string | null;
  nome: string;
}) {
  return (
    <div
      className="inc"
      style={{
        alignItems: "center",
        background: T.page,
        display: "flex",
        flexDirection: "column",
        fontFamily: fonte,
        justifyContent: "center",
        minHeight: "100dvh",
        padding: 24,
      }}
    >
      <style>{TEMA_CSS}</style>

      <div style={{ maxWidth: 400, width: "100%" }}>
        {/* A marca do cliente é o assunto da tela, não um selo de canto: 256px de largura,
            referência que o Lucas deu apontando a logo do login do Panteon. */}
        <div style={{ marginBottom: 30, textAlign: "center" }}>
          <Marca
            altura={190}
            escuraUrl={logoEscuraUrl}
            largura="min(256px, 70vw)"
            nome={nome}
            url={logoUrl}
          />
        </div>

        {children}

        <div style={{ color: T.muted, fontSize: 11, marginTop: 26, textAlign: "center" }}>
          Tecnologia <b style={{ color: T.sub }}>C2X</b>
        </div>
      </div>
    </div>
  );
}

// Campo e rótulo saem daqui em vez dos tokens fixos: o token traz #ffffff de fundo e #121722 de
// texto, que no tema escuro viram campo branco brilhante e botão invisível.
const campo = {
  background: T.card,
  border: `1px solid ${T.border}`,
  borderRadius: 12,
  color: T.text,
  fontFamily: fonte,
  // ⚠️ 16px não é estética: abaixo disso o Safari do iOS dá zoom ao focar e a tela "pula".
  fontSize: 16,
  minHeight: ALVO_TOQUE,
  outline: "none",
  padding: "0 14px",
  width: "100%",
} as const;

const rotulo = {
  color: T.sub,
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  letterSpacing: 0.2,
  marginBottom: 6,
} as const;

function Porta({ aoEntrar, slug }: { aoEntrar: () => Promise<void>; slug: string }) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const entrar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setErro(null);
    setEnviando(true);

    try {
      const resposta = await fetch("/api/incorporador/sessao", {
        body: JSON.stringify({ email, senha }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await resposta.json().catch(() => null)) as { error?: string } | null;

      if (!resposta.ok) {
        setErro(payload?.error ?? "Não foi possível entrar.");
        return;
      }

      await aoEntrar();
    } catch {
      setErro("Não foi possível entrar. Verifique a conexão.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form
      onSubmit={entrar}
      style={{
        background: T.card,
        border: `1px solid ${T.border}`,
        borderRadius: 16,
        padding: 24,
      }}
    >
      <div style={{ color: T.text, fontSize: 17, fontWeight: 600, marginBottom: 4 }}>
        Portal do incorporador
      </div>
      <div style={{ color: T.muted, fontSize: 13, marginBottom: 20 }}>
        Acompanhe vendas, carteira e produtos.
      </div>

      <label htmlFor="inc-email" style={rotulo}>
        E-mail
      </label>
      <input
        autoComplete="username"
        id="inc-email"
        onChange={(e) => setEmail(e.target.value)}
        style={{ ...campo, marginBottom: 14 }}
        type="email"
        value={email}
      />

      <label htmlFor="inc-senha" style={rotulo}>
        Senha
      </label>
      <input
        autoComplete="current-password"
        id="inc-senha"
        onChange={(e) => setSenha(e.target.value)}
        style={{ ...campo, marginBottom: 18 }}
        type="password"
        value={senha}
      />

      {erro ? (
        <div
          role="alert"
          style={{
            background: "#fdf3f2",
            border: `1px solid ${T.danger}33`,
            borderRadius: 10,
            color: T.danger,
            fontSize: 13,
            marginBottom: 14,
            padding: "10px 12px",
          }}
        >
          {erro}
        </div>
      ) : null}

      <button
        disabled={enviando || !email || !senha}
        style={{
          background: T.btnBg,
          border: "none",
          borderRadius: 12,
          color: T.btnFg,
          cursor: "pointer",
          fontFamily: fonte,
          fontSize: 16,
          fontWeight: 600,
          minHeight: ALVO_TOQUE,
          opacity: enviando || !email || !senha ? 0.5 : 1,
          width: "100%",
        }}
        type="submit"
      >
        {enviando ? "Entrando…" : "Entrar"}
      </button>

      <div style={{ color: T.muted, fontSize: 11.5, marginTop: 14, textAlign: "center" }}>
        Esqueceu a senha? Fale com a Careli.
      </div>
    </form>
  );
}

// ── O PORTAL ────────────────────────────────────────────────────────────────

// "no sidebar lateral queria ter poucas abas: CRM - Vendas - Carteira" (Lucas, 12/08). Produtos
// continua na lista porque já está no ar e é por onde o Cecílio abre o masterplan; tirar seria
// remover função de cliente ativo para cumprir uma contagem de abas.
const ABAS: { chave: Aba; rotulo: string }[] = [
  { chave: "crm", rotulo: "CRM" },
  { chave: "vendas", rotulo: "Vendas" },
  { chave: "carteira", rotulo: "Carteira" },
  { chave: "produtos", rotulo: "Produtos" },
];

// A logo do incorporador NÃO entra aqui de propósito: ela recebe na porta (o login) e o portal
// é Panteon para todo mundo. Por isso o Portal não recebe mais `logoUrl`/`logoEscuraUrl`.
function Portal({
  aba,
  aoSair,
  onAba,
  sessao,
}: {
  aba: Aba;
  aoSair: () => Promise<void>;
  onAba: (aba: Aba) => void;
  sessao: Sessao;
}) {
  // "Carteira (quando tiver)": some inteira quando nenhum empreendimento deste incorporador tem
  // carteira administrada pela Careli. Aba que abre vazia vira chamado.
  const temCarteira = sessao.empreendimentosComCarteira.length > 0;
  const abas = ABAS.filter((item) => item.chave !== "carteira" || temCarteira);

  return (
    <div className="inc" style={{ background: T.page, fontFamily: fonte }}>
      <style>{TEMA_CSS}</style>

      <div className="inc-shell">
        <aside className="inc-side">
          {/* DENTRO DO PORTAL A MARCA É O PANTEON (Lucas, 12/08): "somente a tela de login eu
              quero com a marca da Cecílio, as demais pode ser o Panteon mesmo". O portal é o
              nosso produto e serve a todos os incorporadores da carteira; a marca do cliente
              recebe ele na porta e o Panteon conduz daí em diante. O nome do incorporador fica
              logo abaixo, que é o que responde "estou vendo a carteira de quem?".

              O símbolo tem versão preta e branca; a logo horizontal do Panteon só existe em
              branco (`panteon-logo-light.png`, feita para o fundo escuro do login do hub), e
              sumiria no tema claro daqui. Por isso: símbolo + o nome escrito em texto, que
              acompanha o tema sozinho pela variável de cor. */}
          <div style={{ borderBottom: `1px solid ${T.border}`, padding: "16px 16px 14px" }}>
            <span style={{ alignItems: "center", display: "flex", gap: 8 }}>
              <Marca
                altura={24}
                escuraUrl="/panteon-mark-light.png"
                largura={24}
                nome="Panteon"
                url="/panteon-mark.png"
              />
              <span style={{ color: T.text, fontSize: 16, fontWeight: 700, letterSpacing: 0.2 }}>
                Panteon
              </span>
            </span>
            <span
              style={{
                color: T.sub,
                display: "block",
                fontSize: 13,
                fontWeight: 600,
                marginTop: 8,
              }}
            >
              {sessao.incorporador.nome}
            </span>
          </div>

          <nav className="inc-nav">
            {abas.map((item) => (
              <button
                key={item.chave}
                onClick={() => onAba(item.chave)}
                style={{
                  background: aba === item.chave ? T.soft : "transparent",
                  border: "none",
                  borderRadius: 8,
                  color: aba === item.chave ? T.text : T.muted,
                  cursor: "pointer",
                  fontFamily: fonte,
                  fontSize: 14,
                  fontWeight: aba === item.chave ? 600 : 500,
                  padding: "9px 12px",
                  textAlign: "left",
                  width: "100%",
                }}
                type="button"
              >
                {item.rotulo}
              </button>
            ))}
          </nav>

          {/* `marginTop:auto` prende o rodapé embaixo no desktop; no celular a casca vira bloco e
              ele volta a ser uma linha normal logo depois do menu. */}
          <div
            style={{
              borderTop: `1px solid ${T.border}`,
              marginTop: "auto",
              padding: "12px 16px 16px",
            }}
          >
            <span style={{ color: T.muted, display: "block", fontSize: 12.5, marginBottom: 8 }}>
              {sessao.usuario.nome}
            </span>
            <button
              onClick={() => void aoSair()}
              style={{
                background: "transparent",
                border: `1px solid ${T.border}`,
                borderRadius: 8,
                color: T.sub,
                cursor: "pointer",
                fontFamily: fonte,
                fontSize: 12.5,
                padding: "7px 12px",
                width: "100%",
              }}
              type="button"
            >
              Sair
            </button>
          </div>
        </aside>

        <div className="inc-main">
          <main style={{ margin: "0 auto", maxWidth: 1180, padding: "26px 20px 40px" }}>
            {aba === "crm" ? <EmBreve titulo="CRM" /> : null}
            {aba === "produtos" ? <TelaProdutos /> : null}
            {aba === "vendas" ? <EmBreve titulo="Vendas" /> : null}
            {aba === "carteira" ? <EmBreve titulo="Carteira" /> : null}
          </main>

          <footer
            style={{
              borderTop: `1px solid ${T.border}`,
              color: T.muted,
              fontSize: 11.5,
              padding: "16px 20px",
              textAlign: "center",
            }}
          >
            <span style={{ color: T.gold }}>●</span> Tecnologia <b style={{ color: T.sub }}>C2X</b>
          </footer>
        </div>
      </div>
    </div>
  );
}

function EmBreve({ titulo }: { titulo: string }) {
  return (
    <div
      style={{
        background: T.card,
        border: `1px dashed ${T.border}`,
        borderRadius: 14,
        color: T.muted,
        fontSize: 14,
        padding: 40,
        textAlign: "center",
      }}
    >
      <b style={{ color: T.text }}>{titulo}</b> entra na próxima rodada.
    </div>
  );
}
