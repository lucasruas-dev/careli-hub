"use client";

import { useCallback, useEffect, useState } from "react";

import { ALVO_TOQUE, fonte } from "@/modules/publico/ui/tokens";

import { AlternadorDeTema, Marca, ProvedorDeTema, T, TEMA_CSS } from "./tema";

import {
  ehPortalComercial,
  ehPortalPersonalizado,
  ehPortalSoProdutos,
  portalAssinaPanteon,
  type TipoDePortal,
} from "@/lib/apolo/incorporador/perfis-de-portal";
import { TelaCarteira } from "./TelaCarteira";
import { TelaCrm } from "./TelaCrm";
// Só o portal PERSONALIZADO monta esta tela (ver `abasDoPortal`); no padrão o mapa vive em Vendas.
import { TelaProdutos } from "./TelaProdutos";
import { CarteiraLsoft } from "@/modules/lsoft/CarteiraLsoft";
import { apiDoPortal } from "@/modules/lsoft/api";
import { portalVeBaseLsoft } from "@/lib/lsoft/portais";
import { portalEmiteBoletos } from "@/lib/apolo/boletos/portais";
import { TelaBoletos } from "./TelaBoletos";
// As duas do portal COMERCIAL (o Hércules da Gurgel): o board da Têmis recortado pelo escopo e a
// fila + central do Prometeu. Ver `ABAS_COMERCIAL`.
import { TelaContratos } from "./TelaContratos";
import { TelaLancamento } from "./TelaLancamento";
// A aba Produtos do COMERCIAL é outra tela: a RÉPLICA da tela de Empreendimentos do Apolo (os seis
// cards, a tabela pai/filhos e a ficha com abas), com Vendas dentro da ficha (Lucas, 02/09/2026:
// *"produtos é replicar a tela que temos hoje em empreendimento do apolo"*). A versão anterior em
// estilo próprio do portal (TelaProdutosComercial.tsx) fica no repo, fora do fluxo.
import { ProdutosDoHercules } from "./hercules/ProdutosDoHercules";
import { TelaVendas } from "./TelaVendas";
// Os ícones do menu do COMERCIAL (Lucas, 02/09/2026), na régua do Apolo/hub: CRM = o do CRM 360
// (ContactRound), Produtos = o de Empreendimentos (Building2) — os dois de lib/apolo/catalog.ts —,
// Contratos = o da Têmis (FileSignature), Financeiro = o de Carteira (WalletCards), Lançamento = o
// do Prometeu (ListOrdered).
import { Building2, ContactRound, FileSignature, ListOrdered, WalletCards } from "lucide-react";
import type { LucideIcon } from "lucide-react";

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
  // `tipo` chega da rota de sessão (0122). Ausente em resposta antiga = incorporador.
  incorporador: { nome: string; slug: string; tipo?: TipoDePortal };
  usuario: { nome: string };
};

// "produtos" existe no portal personalizado (os cards com a logo, `TelaProdutos`) e no COMERCIAL
// (a tabela de empreendimentos com Vendas dentro, `TelaProdutosComercial`) — mesma chave, telas
// diferentes, decididas pelo tipo no corpo do Portal. No padrão, o mapa vive dentro de Vendas.
// "contratos" e "lancamento" existem SÓ no portal comercial.
type Aba =
  | "boletos"
  | "carteira"
  | "contratos"
  | "crm"
  | "lancamento"
  | "lsoft"
  | "produtos"
  | "vendas";

// Um item do menu lateral. `icone` é opcional de propósito: o portal COMERCIAL carrega ícone em
// todas as abas (pedido do Lucas, 02/09/2026); os portais de incorporador seguem só com o rótulo,
// e o <nav> renderiza o ícone quando houver.
type ItemDeAba = { chave: Aba; icone?: LucideIcon; rotulo: string };

type DadosDoPortal = {
  logoEscuraUrl: string | null;
  logoUrl: string | null;
  nome: string;
  slug: string;
  /** Vem do banco pela página do servidor, junto com a marca: decide abas e assinatura. */
  tipo: TipoDePortal;
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

function PortalComTema({ logoEscuraUrl, logoUrl, nome, slug, tipo }: DadosDoPortal) {
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [carregando, setCarregando] = useState(true);
  // Abre em Vendas: é a primeira pergunta do dono do empreendimento e a única aba que existe para
  // todo mundo (Carteira só aparece para quem tem carteira administrada, CRM ainda está por vir).
  // ⚠️ MENOS no portal SÓ PRODUTOS, onde Vendas não existe: abrir nela deixaria a tela em branco,
  // porque o corpo renderiza por `aba` e nenhum ramo casaria. Ver [[perfis-de-portal]].
  // ⚠️ E MENOS no COMERCIAL, pelo mesmo motivo: lá Vendas virou Produtos (02/09/2026), e a chave
  // "vendas" não está mais em `ABAS_COMERCIAL`.
  const [aba, setAba] = useState<Aba>(
    ehPortalComercial(tipo) || ehPortalSoProdutos(slug) ? "produtos" : "vendas",
  );

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
    return <Moldura logoEscuraUrl={logoEscuraUrl} logoUrl={logoUrl} nome={nome} slug={slug} tipo={tipo}><div style={{ color: T.muted, fontSize: 14, textAlign: "center" }}>Carregando…</div></Moldura>;
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
      <Moldura logoEscuraUrl={logoEscuraUrl} logoUrl={logoUrl} nome={nome} slug={slug} tipo={tipo}>
        <Porta aoEntrar={carregarSessao} slug={slug} tipo={tipo} />
        {/* O aviso de sessão cruzada NÃO aparece no portal comercial (Lucas, 02/09/2026: "tira
            essa frase que você está conectado com CER, não faz sentido"): o coordenador é gente
            da Careli e costuma ter a sessão de um portal de incorporador aberta no mesmo
            navegador — para ele isso não é confusão, é rotina. */}
        {sessao && !daCasa && !ehPortalComercial(tipo) ? (
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
      logoEscuraUrl={logoEscuraUrl}
      logoUrl={logoUrl}
      onAba={setAba}
      sessao={sessao}
      tipo={tipo}
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
  tipo,
}: {
  children: React.ReactNode;
  logoEscuraUrl: string | null;
  logoUrl: string | null;
  nome: string;
  slug: string;
  tipo: TipoDePortal;
}) {
  // ⚠️ A ASSINATURA DO PANTEON NA PORTA. O Lucas viu o login da Lagoa Bonita com o nome solto e
  // apontou (18/08/2026): *"aqui faltou a logo do Panteon em cima do Lagoa Bonita"*. O padrão é
  // "quem é a plataforma" em cima e "de quem é a carteira" embaixo, o mesmo eixo do sidebar de
  // dentro.
  //
  // Os portais PERSONALIZADOS ficam de fora: lá a porta é a marca do cliente. Era só o Cecílio
  // até 31/08/2026, quando o Lucas viu o login da MMendes com as duas marcas empilhadas —
  // *"nesses perfis que vamos fazer personalizado, pode tirar a logo do panteon"*. A regra mora
  // em `portalAssinaPanteon`, e não num `!ehPortalPersonalizado` aqui: são duas perguntas
  // diferentes (ver a nota lá).
  const assinaPanteon = portalAssinaPanteon(slug, tipo);
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

function Porta({
  aoEntrar,
  slug,
  tipo,
}: {
  aoEntrar: () => Promise<void>;
  slug: string;
  tipo: TipoDePortal;
}) {
  // A porta do COMERCIAL fala com o coordenador (Lucas, 02/09/2026: "portal do coordenador").
  const comercial = ehPortalComercial(tipo);
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
      {/* No comercial o título fica centralizado (Lucas, 02/09/2026: "centralizar"); o portal do
          incorporador está aprovado como está e continua alinhado à esquerda. */}
      <div
        style={{
          color: T.text,
          fontSize: 17,
          fontWeight: 600,
          marginBottom: 4,
          textAlign: comercial ? "center" : "left",
        }}
      >
        {comercial ? "Portal do coordenador" : "Portal do incorporador"}
      </div>
      <div
        style={{
          color: T.muted,
          fontSize: 13,
          marginBottom: 20,
          textAlign: comercial ? "center" : "left",
        }}
      >
        {comercial
          ? "Vendas, contratos e lançamentos dos seus empreendimentos."
          : "Acompanhe as vendas e a carteira do seu empreendimento."}
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
const ABAS: ItemDeAba[] = [
  { chave: "crm", rotulo: "CRM" },
  { chave: "vendas", rotulo: "Vendas" },
  { chave: "carteira", rotulo: "Carteira" },
];

// ⚠️ O CECILIO NAO PERDE A ABA PRODUTOS. O portal dele e um projeto PERSONALIZADO, ja aprovado e
// em uso pelo cliente (regra do Lucas, 17/08/2026), e o padrao nao pode passar por cima: tirar
// Produtos aqui apagaria a porta por onde ele abre o masterplan do Garden todo dia.
// Ver [[perfis-de-portal]].
const ABAS_PERSONALIZADO: ItemDeAba[] = [
  ...ABAS,
  { chave: "produtos", rotulo: "Produtos" },
];

// ⚠️ A ABA DO LSOFT NÃO SEGUE "PERSONALIZADO x PADRÃO", e a razão é concreta: existem DOIS portais
// do Cecílio — `cecilio-rocha` (o personalizado, congelado) e `cer` (o que a equipe dele usa hoje,
// que roda no padrão). Amarrar ao personalizado deixaria o CER de fora, que é justamente quem vai
// validar a base; amarrar ao padrão daria a aba a Vista Alegre e Lagoa Bonita, que não têm nada
// com a carteira do Garden. Por isso a lista própria em lib/lsoft/portais.
const ABA_LSOFT: ItemDeAba = { chave: "lsoft", rotulo: "LSoft Integração" };

// ⚠️ A ABA DE BOLETOS TEM LISTA PRÓPRIA, pelo mesmo motivo da do LSoft — e um a mais: ela EMITE
// cobrança, não só lê. Quem enxerga cada carteira está em `lib/apolo/boletos/portais.ts`, e o
// vínculo de `apolo_incorporador_empreendimentos` não serve aqui porque nenhum destes prédios
// existe no Panteon (Lucas, 01/09/2026: *"não tem empreendimento para essas empresas ainda dentro
// o panteon"*). Sumir a aba não é a trava: a rota confere a mesma lista a cada chamada.
const ABA_BOLETOS: ItemDeAba = { chave: "boletos", rotulo: "Boletos" };

// ⚠️ SÓ PRODUTOS É EXCLUSIVO: entra ANTES de tudo e sai com uma aba só. O sócio que recebe este
// perfil (MMendes, no Garden) não vê CRM, Vendas, Carteira nem LSoft — inclusive porque a base do
// LSoft é da carteira do Cecílio, não dele. Ver [[perfis-de-portal]].
const ABAS_SO_PRODUTOS: ItemDeAba[] = [
  { chave: "produtos", rotulo: "Produtos" },
];

// O PORTAL COMERCIAL — o Hércules dos coordenadores (Lucas, 02/09/2026): *"a gente vai ter no
// hercules, CRM - Vendas - Contratos - financeiro"* e depois *"a tela de lançamento (a tela do
// prometeu) só com a fila e a central"*. "Financeiro" é a mesma tela Carteira, com o nome que o
// time comercial usa; a sessão do comercial marca TODO empreendimento como "com carteira" (ver
// `escopoDoUsuario`), então a aba nunca some por aqui.
//
// ⚠️ VENDAS VIROU PRODUTOS, na mesma posição (Lucas, 02/09/2026: *"queria trazer aquela tela que
// temos no empreendimento (...) vendas tem que morar dentro da tela de produtos"*). A TelaVendas
// não saiu do comercial: ela é a aba Vendas da ficha do produto (`ProdutosDoHercules` → "Ver
// mais" → `FichaDoProduto`), fixa no produto clicado.
const ABAS_COMERCIAL: ItemDeAba[] = [
  { chave: "crm", icone: ContactRound, rotulo: "CRM" },
  { chave: "produtos", icone: Building2, rotulo: "Produtos" },
  { chave: "contratos", icone: FileSignature, rotulo: "Contratos" },
  { chave: "carteira", icone: WalletCards, rotulo: "Financeiro" },
  { chave: "lancamento", icone: ListOrdered, rotulo: "Lançamento" },
];

export function abasDoPortal(slug: string, tipo?: TipoDePortal): ItemDeAba[] {
  // ⚠️ O TIPO VEM ANTES DAS LISTAS DE SLUG. As listas protegem perfis já aprovados do padrão; o
  // comercial não é um deles, é outro produto — e decidido pelo banco, não por slug em código.
  if (ehPortalComercial(tipo)) return ABAS_COMERCIAL;
  if (ehPortalSoProdutos(slug)) return ABAS_SO_PRODUTOS;

  let abas = ehPortalPersonalizado(slug) ? ABAS_PERSONALIZADO : ABAS;
  if (portalVeBaseLsoft(slug)) abas = [...abas, ABA_LSOFT];
  if (portalEmiteBoletos(slug)) abas = [...abas, ABA_BOLETOS];
  return abas;
}

// A logo do incorporador NÃO veste o portal de dentro: ela recebe na porta (o login) e o portal
// é Panteon para todo mundo. A EXCEÇÃO é o portal COMERCIAL — é o time da Careli operando sob a
// marca dele (Lucas, 02/09/2026: *"para esse perfil da Gurgel, quero que use a logo deles no
// lugar da logo do Panteon"*). Por isso as URLs chegam até aqui, e só o comercial as usa.
function Portal({
  aba,
  aoSair,
  logoEscuraUrl,
  logoUrl,
  onAba,
  sessao,
  tipo,
}: {
  aba: Aba;
  aoSair: () => Promise<void>;
  logoEscuraUrl: string | null;
  logoUrl: string | null;
  onAba: (aba: Aba) => void;
  sessao: Sessao;
  tipo: TipoDePortal;
}) {
  const comercial = ehPortalComercial(tipo);
  // "Carteira (quando tiver)": some inteira quando nenhum empreendimento deste incorporador tem
  // carteira administrada pela Careli. Aba que abre vazia vira chamado.
  const temCarteira = sessao.empreendimentosComCarteira.length > 0;
  const abas = abasDoPortal(sessao.incorporador.slug, tipo).filter(
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
            {comercial ? (
              // A MARCA DO TIME no lugar do Panteon. A arte é horizontal, então ocupa a largura
              // do menu e limita pela altura; o nome não se repete embaixo — a logo já o diz.
              <Marca
                altura={44}
                escuraUrl={logoEscuraUrl}
                largura="100%"
                nome={sessao.incorporador.nome}
                url={logoUrl}
              />
            ) : (
              <>
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
              </>
            )}
          </div>

          <nav className="inc-nav">
            {abas.map((item) => (
              <button
                key={item.chave}
                onClick={() => onAba(item.chave)}
                style={{
                  alignItems: "center",
                  background: aba === item.chave ? T.soft : "transparent",
                  border: "none",
                  borderRadius: 8,
                  color: aba === item.chave ? T.text : T.muted,
                  cursor: "pointer",
                  display: "flex",
                  fontFamily: fonte,
                  fontSize: 14,
                  fontWeight: aba === item.chave ? 600 : 500,
                  gap: 9,
                  padding: "9px 12px",
                  textAlign: "left",
                  width: "100%",
                }}
                type="button"
              >
                {/* ÍCONE (16px) + RÓTULO em toda aba que trouxer `icone` — hoje só o comercial.
                    Sem ícone a linha é a de sempre: o flex com gap não muda a altura, porque o
                    ícone é menor que a linha de texto. */}
                {item.icone ? (
                  <item.icone aria-hidden="true" size={16} style={{ flexShrink: 0 }} />
                ) : null}
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
            {/* No comercial, Financeiro é PARCELAS: Ato e Sinal, valor cheio, boleto por parcela (Lucas,
                02/09/2026: "aqui o financeiro não tem carteira, é Parcelas"). */}
            {aba === "carteira" ? (
              <TelaCarteira modo={comercial ? "coordenador" : "incorporador"} />
            ) : null}
            {/* A MESMA chave, DUAS telas: no COMERCIAL é a réplica da tela de Empreendimentos do
                Apolo (lista + ficha com Resumo · Cadastro · Imobiliárias · Vendas · Contratos);
                no PERSONALIZADO são os cards com a logo (o Cecílio abre o masterplan do Garden
                por aqui todo dia, e o padrão não passa por cima dele). O padrão não chega aqui:
                `abasDoPortal` não oferece a aba fora desses dois. */}
            {aba === "produtos" ? (
              comercial ? <ProdutosDoHercules /> : <TelaProdutos />
            ) : null}
            {/* A MESMA tela do time interno, falando com a API do portal (cookie de sessão, sem
                token, e sem o botão da MOST: quem paga o enriquecimento é a Careli). */}
            {aba === "lsoft" ? <CarteiraLsoft api={apiDoPortal} /> : null}
            {aba === "boletos" ? <TelaBoletos /> : null}
            {/* Só o portal COMERCIAL chega aqui: `abasDoPortal` não oferece as duas fora dele. */}
            {aba === "contratos" ? <TelaContratos /> : null}
            {aba === "lancamento" ? <TelaLancamento /> : null}
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
