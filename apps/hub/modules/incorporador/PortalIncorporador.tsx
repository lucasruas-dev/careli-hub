"use client";

import { useCallback, useEffect, useState } from "react";

import { ALVO_TOQUE, fonte } from "@/modules/publico/ui/tokens";

import { AlternadorDeTema, Marca, ProvedorDeTema, T, TEMA_CSS } from "./tema";

import { ehPortalPersonalizado } from "@/lib/apolo/incorporador/perfis-de-portal";
import { TelaCarteira } from "./TelaCarteira";
import { TelaCrm } from "./TelaCrm";
// Só o portal PERSONALIZADO monta esta tela (ver `abasDoPortal`); no padrão o mapa vive em Vendas.
import { TelaProdutos } from "./TelaProdutos";
import { CarteiraLsoft } from "@/modules/lsoft/CarteiraLsoft";
import { apiDoPortal } from "@/modules/lsoft/api";
import { portalVeBaseLsoft } from "@/lib/lsoft/portais";
import { TelaVendas } from "./TelaVendas";

// PORTAL DO INCORPORADOR — a porta e as telas de dentro.
//
// Desenho pedido pelo Lucas (10/08): "a tela inicial para eles fazerem acesso com a logo deles",
// e dentro "Vendas - Carteira(quando tiver)"; o CRM entra na sequência. A marca do CLIENTE manda
// na tela; a nossa aparece como assinatura discreta no rodapé, ordem dele: "sempre marcar c2x".
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

// "produtos" existe SÓ no portal personalizado (ver `abasDoPortal`). No padrão, o mapa vive
// dentro de Vendas.
type Aba = "carteira" | "crm" | "lsoft" | "produtos" | "vendas";

type DadosDoPortal = {
  logoEscuraUrl: string | null;
  logoUrl: string | null;
  nome: string;
  slug: string;
};

// O PROVEDOR DE TEMA ENVOLVE TUDO, e não só o portal de dentro: a escolha vale desde a porta (o
// login), que é a primeira tela que o cliente vê. Quem lê o tema é o alternador (para saber qual
// botão está aceso) e a TelaMasterplan (para pedir o mapa no tema certo) — a PINTURA em si sai do
// CSS, que não depende deste contexto para nada.
export function PortalIncorporador(dados: DadosDoPortal) {
  return (
    <ProvedorDeTema slug={dados.slug}>
      <PortalComTema {...dados} />
    </ProvedorDeTema>
  );
}

function PortalComTema({ logoEscuraUrl, logoUrl, nome, slug }: DadosDoPortal) {
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [carregando, setCarregando] = useState(true);
  // Abre em Vendas: é a primeira pergunta do dono do empreendimento e a única aba que existe para
  // todo mundo (Carteira só aparece para quem tem carteira administrada, CRM ainda está por vir).
  const [aba, setAba] = useState<Aba>("vendas");

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
    return <Moldura logoEscuraUrl={logoEscuraUrl} logoUrl={logoUrl} nome={nome} slug={slug}><div style={{ color: T.muted, fontSize: 14, textAlign: "center" }}>Carregando…</div></Moldura>;
  }

  // ⚠️ A SESSAO TEM QUE SER DESTE PORTAL. O cookie e um so por navegador, entao quem tem sessao
  // aberta de um incorporador e abre a URL de OUTRO via com a marca do endereco (que vem do slug)
  // e os dados do cookie: nome, empreendimentos e carteira do primeiro, sob a logo do segundo.
  // O dado nunca vazou (toda rota filtra pela sessao), mas a TELA mentia sobre de quem ele era —
  // e foi exatamente o que apareceu ao abrir /incorporador/bill com sessao do Cecilio.
  //
  // Sessao de outro portal = tratada como quem nao entrou: mostra a porta, com a marca certa.
  const daCasa = sessao?.incorporador.slug === slug;

  if (!sessao || !daCasa) {
    return (
      <Moldura logoEscuraUrl={logoEscuraUrl} logoUrl={logoUrl} nome={nome} slug={slug}>
        <Porta aoEntrar={carregarSessao} slug={slug} />
        {sessao && !daCasa ? (
          <p
            style={{
              color: T.muted,
              fontSize: 12.5,
              lineHeight: 1.5,
              margin: "14px auto 0",
              maxWidth: 360,
              textAlign: "center",
            }}
          >
            Voce esta conectado como <b style={{ color: T.sub }}>{sessao.incorporador.nome}</b>.
            Para ver {nome}, entre com o acesso deste portal.
          </p>
        ) : null}
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
  slug,
}: {
  children: React.ReactNode;
  logoEscuraUrl: string | null;
  logoUrl: string | null;
  nome: string;
  slug: string;
}) {
  // ⚠️ A ASSINATURA DO PANTEON NA PORTA. O Lucas viu o login da Lagoa Bonita com o nome solto e
  // apontou (18/08/2026): *"aqui faltou a logo do Panteon em cima do Lagoa Bonita"*. O padrão é
  // "quem é a plataforma" em cima e "de quem é a carteira" embaixo, o mesmo eixo do sidebar de
  // dentro. O portal PERSONALIZADO (Cecílio) fica de fora: lá a porta é a marca dele, decisão
  // dele mesmo já aprovada. Ver [[perfis-de-portal]].
  const assinaPanteon = !ehPortalPersonalizado(slug);
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
        position: "relative",
      }}
    >
      <style>{TEMA_CSS}</style>

      {/* O ALTERNADOR NA PORTA, num canto e só isso. Aqui ele não é assunto — a tela é a marca do
          cliente e dois campos — mas precisa existir: quem prefere o escuro escolhe ANTES de
          entrar, e a escolha já vale na tela de login. No portal PERSONALIZADO o próprio
          `AlternadorDeTema` não renderiza nada (ver [[perfis-de-portal]]). */}
      <div style={{ position: "absolute", right: 16, top: 16 }}>
        <AlternadorDeTema />
      </div>

      <div style={{ maxWidth: 400, width: "100%" }}>
        {assinaPanteon ? (
          <div
            style={{
              alignItems: "center",
              display: "flex",
              gap: 11,
              justifyContent: "center",
              marginBottom: 22,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- asset local, sem otimização */}
            <img
              alt="Panteon"
              className="inc-logo-panteon"
              src="/panteon-logo-light.png"
              // ⚠️ LIMITE PELA ALTURA, não pela largura: a arte é quase quadrada (870x772), então
              // 230px de largura viravam 211px de altura e a tela de login passava a ROLAR.
              // Medido: com 160px de teto a porta inteira cabe na janela.
              style={{ height: "auto", maxHeight: 160, maxWidth: "min(200px, 58vw)", objectFit: "contain", width: "auto" }}
            />
          </div>
        ) : null}

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
        // O slug diz em QUAL portal ela esta entrando: o mesmo e-mail pode ter acesso a varios.
        body: JSON.stringify({ email, senha, slug }),
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
        Acompanhe as vendas e a carteira do seu empreendimento.
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
            // ⚠️ ERA O HEX CRAVADO `#fdf3f2`, que é rosa-claro: no tema escuro virava uma faixa
            // branca gritando no meio do cartão preto. `dangerBg` é o mesmo rosa no claro e o
            // vermelho translúcido no escuro — o token já existia, faltava usar.
            background: T.dangerBg,
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

// "no sidebar lateral queria ter poucas abas: CRM - Vendas - Carteira" (Lucas, 12/08), fechado em
// 17/08/2026: *"nao tem a tela produto, vai ser CRM - Vendas - Carteira"*.
//
// Produtos SAIU, e o masterplan não foi junto: ele passou para dentro de Vendas (TelaVendas), que
// é onde faz sentido, porque o mapa é outra forma de olhar as mesmas unidades. Era essa a única
// função que a aba Produtos entregava para cliente ativo, e ela continua a um clique.
const ABAS: { chave: Aba; rotulo: string }[] = [
  { chave: "crm", rotulo: "CRM" },
  { chave: "vendas", rotulo: "Vendas" },
  { chave: "carteira", rotulo: "Carteira" },
];

// ⚠️ O CECILIO NAO PERDE A ABA PRODUTOS. O portal dele e um projeto PERSONALIZADO, ja aprovado e
// em uso pelo cliente (regra do Lucas, 17/08/2026), e o padrao nao pode passar por cima: tirar
// Produtos aqui apagaria a porta por onde ele abre o masterplan do Garden todo dia.
// Ver [[perfis-de-portal]].
const ABAS_PERSONALIZADO: { chave: Aba; rotulo: string }[] = [
  ...ABAS,
  { chave: "produtos", rotulo: "Produtos" },
];

// ⚠️ A ABA DO LSOFT NÃO SEGUE "PERSONALIZADO x PADRÃO", e a razão é concreta: existem DOIS portais
// do Cecílio — `cecilio-rocha` (o personalizado, congelado) e `cer` (o que a equipe dele usa hoje,
// que roda no padrão). Amarrar ao personalizado deixaria o CER de fora, que é justamente quem vai
// validar a base; amarrar ao padrão daria a aba a Vista Alegre e Lagoa Bonita, que não têm nada
// com a carteira do Garden. Por isso a lista própria em lib/lsoft/portais.
const ABA_LSOFT: { chave: Aba; rotulo: string } = { chave: "lsoft", rotulo: "LSoft Integração" };

export function abasDoPortal(slug: string): { chave: Aba; rotulo: string }[] {
  const base = ehPortalPersonalizado(slug) ? ABAS_PERSONALIZADO : ABAS;
  return portalVeBaseLsoft(slug) ? [...base, ABA_LSOFT] : base;
}

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
  const abas = abasDoPortal(sessao.incorporador.slug).filter(
    (item) => item.chave !== "carteira" || temCarteira,
  );

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

            {/* O TEMA FICA JUNTO DO "SAIR", que é onde vive o que é da PESSOA e não da carteira:
                quem ela é, como ela quer ver a tela e a saída. Fora do menu de abas de propósito —
                tema não é um lugar do portal, é um ajuste. */}
            <div style={{ marginBottom: 8 }}>
              <AlternadorDeTema />
            </div>

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
          {/* LARGURA TOTAL, como as telas internas do Apolo (Lucas, 18/08/2026: "a tela aqui no
              apolo parece maior"). O miolo era travado em maxWidth 1180 e centrado; agora ocupa a
              viewport inteira com padding lateral, em TODAS as abas — o mesmo comportamento do
              CRM 360 interno. */}
          <main style={{ padding: "26px 24px 40px" }}>
            {aba === "crm" ? <TelaCrm /> : null}
            {aba === "vendas" ? <TelaVendas /> : null}
            {aba === "carteira" ? <TelaCarteira /> : null}
            {/* Só o portal personalizado chega aqui: `abasDoPortal` não oferece a aba no padrão. */}
            {aba === "produtos" ? <TelaProdutos /> : null}
            {/* A MESMA tela do time interno, falando com a API do portal (cookie de sessão, sem
                token, e sem o botão da MOST: quem paga o enriquecimento é a Careli). */}
            {aba === "lsoft" ? <CarteiraLsoft api={apiDoPortal} /> : null}
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
