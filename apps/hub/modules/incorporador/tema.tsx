"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { ehPortalPersonalizado } from "@/lib/apolo/incorporador/perfis-de-portal";
import {
  ATRIBUTO_TEMA,
  CHAVE_TEMA,
  escolhaInicialDoPortal,
  resolverTemaEfetivo,
  TEMA_PADRAO_DO_PORTAL,
  type TemaEfetivo,
  type TemaEscolhido,
} from "@/lib/apolo/incorporador/tema-portal";

// TEMA DO PORTAL DO INCORPORADOR — claro e escuro, e agora com a escolha na mão do cliente.
//
// Por que variável CSS e não os tokens em objeto: as telas públicas do repo usam estilo inline
// (ficam autocontidas, sem depender do CSS do hub), e estilo inline NÃO responde a media query nem
// a atributo no <html>. Declarando as cores como variável num <style> de uma vez, a troca de tema
// vira uma linha de CSS e alcança as quatro telas sem passar prop por ninguém.
//
// Os valores claros são os mesmos de modules/publico/ui/tokens (paleta do Panteon). Os escuros
// são a escala NEUTRA que o Lucas aprovou em 07/08 depois de reprovar cinco versões azuladas
// (#0a0a0a / #171717 / #121212 / #242424, com a borda clara e translúcida em vez de cinza
// opaco — era daí que vinha o azul).
//
// ⚠️ OS TOKENS ESTÃO EM TRÊS ESTADOS, e a razão é dura: até 18/08/2026 o escuro morava SÓ dentro
// da `@media (prefers-color-scheme: dark)`, então quem decidia era o sistema operacional do
// cliente e ele não tinha como escolher (Lucas, 18/08: *"um detalhe, temos que disponibilizar o
// dark também"*). Agora são três blocos:
//
//   1. `.inc` — a paleta CLARA completa, sem media query nenhuma em volta;
//   2. a media query, GUARDADA por `:root:not([data-inc-tema="claro"])`, para o sistema escuro não
//      atropelar quem pediu o claro de propósito;
//   3. `:root[data-inc-tema="escuro"]` — os MESMOS tokens de novo, para a escolha explícita vencer
//      no outro sentido (sistema no claro + pessoa pediu escuro).
//
// ⚠️ NENHUMA COR PODE TER SUA ÚNICA DEFINIÇÃO DENTRO DE MEDIA QUERY OU DE [data-inc-tema]. É assim
// que nasce tela com texto de um tema sobre fundo do outro: basta um token existir só no escuro
// para ele ficar sem valor no claro e o navegador desenhar preto sobre preto. Por isso os dois
// blocos escuros saem da MESMA string (`TOKENS_ESCUROS`): token novo entra uma vez e chega nos dois.

const TOKENS_CLAROS = `
    --inc-page:#f7f8fa; --inc-card:#ffffff; --inc-soft:#eef1f4;
    --inc-border:#dce2ea; --inc-text:#121722; --inc-sub:#485466; --inc-muted:#667085;
    --inc-danger:#c24135; --inc-danger-bg:#fdf3f2; --inc-gold:#a07c3b;
    --inc-ok:#2f7d59; --inc-ok-bg:#eef7f2;
    --inc-sombra:0 12px 32px rgba(0,0,0,0.14);
    --inc-btn-bg:#121722; --inc-btn-fg:#ffffff;
    color-scheme: light !important;
`;

const TOKENS_ESCUROS = `
    --inc-page:#0a0a0a; --inc-card:#171717; --inc-soft:#242424;
    --inc-border:rgb(255 255 255 / .075); --inc-text:#f7f8fa; --inc-sub:#dce2ea;
    --inc-muted:#a5afbd; --inc-danger:#e08278; --inc-danger-bg:rgb(194 65 53 / .12);
    --inc-ok:#7cc4a1; --inc-ok-bg:rgb(47 125 89 / .16);
    --inc-sombra:0 12px 32px rgba(0,0,0,0.55);
    --inc-gold:#d6b56f; --inc-btn-bg:#f7f8fa; --inc-btn-fg:#121722;
    color-scheme: dark !important;
`;

// A MARCA SEGUE O TEMA ESCOLHIDO, não mais o do aparelho: com escolha explícita e a troca só na
// media query, o cliente que pedisse o escuro veria o símbolo escuro sobre o fundo escuro. Duas
// <img> em vez de <picture> com media, porque o mesmo mecanismo serve para quem só tem UMA versão
// da logo — sem a escura, a clara continua valendo nos dois temas.
//
// ⚠️ A REGRA CLARA VEM ANTES, e a ordem não é estilo, é o que faz funcionar: CSS de mesma
// especificidade resolve pela ÚLTIMA declaração. Com o `display:none` da marca escura depois dos
// blocos escuros, ele venceria lá dentro também e as DUAS logos sumiriam no tema escuro, tela sem
// marca nenhuma, que foi exatamente o que apareceu no primeiro teste de 07/08.
const MARCA_ESCURA = `
    .marca-clara { display: none; }
    .marca-escura { display: inline-block; }
    /* No escuro a logo do Panteon vale como ela é: branca, igual ao login do hub. */
    .inc-logo-panteon { filter: none; }
`;

export const TEMA_CSS = `
  .inc {${TOKENS_CLAROS}  }
  .inc .marca-clara { display: inline-block; }
  .inc .marca-escura { display: none; }

  /* A LOGO DO PANTEON É A MESMA DO LOGIN DO HUB (\`panteon-logo-light.png\`), pedido do Lucas em
     18/08/2026: *"podemos usar a logo que usamos hoje no panteon"*. Só que ela nasce BRANCA, para
     o fundo escuro de lá, e sumiria no portal claro. Como o desenho é monocromático com fundo
     transparente, \`invert(1)\` devolve exatamente a versão preta dele: uma imagem só serve os dois
     temas, sem pedir arte nova e sem risco de as duas versões saírem diferentes. */
  .inc .inc-logo-panteon { filter: invert(1); }
  .inc input::placeholder { color: var(--inc-muted); opacity: 1; }

  /* ── 1b. O QUE FICA POR BAIXO DO PORTAL ─────────────────────────────────────
     O portal é uma tela pública, mas ela nasce dentro do layout raiz do hub, e o hub tem o
     PRÓPRIO tema: o provider dele escreve color-scheme e a paleta uix INLINE no <html> de toda
     página, e o body fica com o fundo claro do hub. A div .inc cobre a janela, então quase nunca
     se vê — mas a BARRA DE ROLAGEM do documento e a faixa de "esticar" a página (o rubber band)
     saem do <html>/<body>, e no tema escuro apareciam claras.

     Duas medidas, nesta ordem:
       • os mesmos tokens declarados também na raiz, para o body ter de onde puxar a cor
         (propriedade personalizada só desce, e --inc-page nasce na .inc, que é neta do body);
       • color-scheme com !important nos blocos de token, porque estilo INLINE (o do provider do
         hub) só perde para !important — sem ele a rolagem continua desenhada em modo claro.

     ⚠️ REGRA SEPARADA, NUNCA na mesma lista de seletores da .inc: navegador sem :has descarta a
     lista INTEIRA, e o portal ficaria sem cor nenhuma. Aqui, sem :has, some só este acabamento. */
  :root:has(.inc) {${TOKENS_CLAROS}  }
  :root:has(.inc), :root:has(.inc) body { background: var(--inc-page); }

  /* ── 2. O APARELHO decide, enquanto ninguém escolheu ────────────────────────
     O :not([data-inc-tema="claro"]) é o guarda: sem ele, quem está com o sistema no escuro e
     pediu o portal claro continuaria no escuro, e metade do alternador não funcionaria.

     (Nada de crase nestes comentários: eles vivem dentro de um template literal, e uma crase
     solta aqui encerra a string e quebra o arquivo inteiro. Já aconteceu.) */
  @media (prefers-color-scheme: dark) {
    :root:not([data-inc-tema="claro"]) .inc {${TOKENS_ESCUROS}  }
    :root:not([data-inc-tema="claro"]) .inc {${MARCA_ESCURA}  }
    :root:not([data-inc-tema="claro"]):has(.inc) {${TOKENS_ESCUROS}  }
  }

  /* ── 3. A ESCOLHA EXPLÍCITA vence nos dois sentidos ─────────────────────────
     :root[data-inc-tema="escuro"] .inc pesa mais que .inc sozinho, então vale mesmo com o
     sistema no claro. Quem põe o atributo é o script que roda ANTES da tela pintar
     (SCRIPT_TEMA_ANTES_DA_PINTURA, em lib/apolo/incorporador/tema-portal). */
  :root[data-inc-tema="escuro"] .inc {${TOKENS_ESCUROS}  }
  :root[data-inc-tema="escuro"] .inc {${MARCA_ESCURA}  }
  :root[data-inc-tema="escuro"]:has(.inc) {${TOKENS_ESCUROS}  }

  /* ── A CASCA DO PORTAL: menu à esquerda, conteúdo à direita ─────────────────
     Lucas, 12/08: "no sidebar lateral queria ter poucas abas: CRM - Vendas - Carteira".
     Está em CSS e não em estilo inline pelo mesmo motivo das cores: precisa virar barra
     horizontal no celular, e media query não alcança estilo inline. */
  .inc-shell { display: flex; min-height: 100dvh; }
  .inc-side {
    background: var(--inc-card); border-right: 1px solid var(--inc-border);
    display: flex; flex: 0 0 224px; flex-direction: column;
    height: 100dvh; position: sticky; top: 0; width: 224px;
  }
  .inc-nav { display: flex; flex-direction: column; gap: 2px; padding: 10px; }
  .inc-main { flex: 1 1 auto; min-width: 0; }
  @media (max-width: 860px) {
    .inc-shell { display: block; }
    .inc-side {
      border-bottom: 1px solid var(--inc-border); border-right: none;
      flex: none; height: auto; position: static; width: auto;
    }
    /* No celular o menu vira uma faixa que rola de lado; sem isso as abas espremem e o rótulo
       quebra em duas linhas. */
    .inc-nav { flex-direction: row; overflow-x: auto; }
    .inc-nav > button { flex: 0 0 auto; }
  }
`;

export const T = {
  border: "var(--inc-border)",
  btnBg: "var(--inc-btn-bg)",
  btnFg: "var(--inc-btn-fg)",
  card: "var(--inc-card)",
  danger: "var(--inc-danger)",
  dangerBg: "var(--inc-danger-bg)",
  gold: "var(--inc-gold)",
  muted: "var(--inc-muted)",
  // O verde de ESTADO (adimplência, "em dia"). Nasceu hardcoded no Chip da TelaCrm; virou token
  // para a próxima tela que precisar do mesmo verde não duplicar o hex. É o par do `danger`.
  ok: "var(--inc-ok)",
  okBg: "var(--inc-ok-bg)",
  page: "var(--inc-page)",
  soft: "var(--inc-soft)",
  // A sombra de popover/modal, mais funda no tema escuro (sombra clara some no fundo preto).
  sombra: "var(--inc-sombra)",
  sub: "var(--inc-sub)",
  text: "var(--inc-text)",
} as const;

// ── A ESCOLHA DO TEMA, EM REACT ─────────────────────────────────────────────
//
// O CSS acima já resolve a PINTURA sozinho (atributo no <html> + media query). Este contexto existe
// para as duas coisas que o CSS não alcança: o alternador precisa saber qual botão está aceso, e a
// TelaMasterplan precisa dizer à rota em que tema o mapa deve vir — um <iframe> é outro documento,
// ele não herda variável CSS de ninguém.

type TemaDoPortal = {
  definirEscolha: (escolha: TemaEscolhido) => void;
  /** O tema que está pintado agora — é ele que vai para o masterplan. */
  efetivo: TemaEfetivo;
  escolha: TemaEscolhido;
};

const TemaContexto = createContext<null | TemaDoPortal>(null);

export function ProvedorDeTema({
  children,
  slug,
}: {
  children: React.ReactNode;
  slug: string;
}) {
  // ⚠️ O ALTERNADOR VALE PARA TODO MUNDO, INCLUSIVE O PERSONALIZADO. Ele nasceu só no padrão
  // (17/08: "não pode afetar o portal da Cecílio"), e em 18/08/2026 o Lucas liberou: *"pode deixar
  // a Cecílio escolher também"*. O que NÃO muda para ele é o ponto de partida: o padrão escuro
  // (TEMA_PADRAO_DO_PORTAL) é do portal PADRÃO; no personalizado, quem nunca escolheu continua
  // seguindo o aparelho, exatamente como está no ar e aprovado. Ou seja: ele ganha a escolha, não
  // um tema novo por baixo.
  const personalizado = ehPortalPersonalizado(slug);

  // ⚠️ COMEÇA `null` DE PROPÓSITO: quer dizer "ainda não li o storage". O servidor renderiza sem
  // saber da escolha (localStorage só existe no navegador), então o primeiro render do cliente tem
  // que ser igual ao dele — e cravar "sistema" aqui traria um efeito colateral caro: o efeito que
  // escreve o atributo rodaria com "sistema" e APAGARIA o atributo que o script pré-pintura acabou
  // de pôr, devolvendo o piscar de branco que ele existe para evitar. Com `null` a escrita não
  // acontece até a leitura terminar, e as duas entram no mesmo lote de estado: um render só.
  const [escolha, setEscolha] = useState<null | TemaEscolhido>(null);
  const [sistemaPrefereEscuro, setSistemaPrefereEscuro] = useState(false);

  useEffect(() => {
    try {
      // Sem nada salvo entra o PADRÃO (escuro desde 18/08/2026) no portal padrão, e "sistema" no
      // personalizado — a mesma regra do script pré-pintura, para os dois não discordarem por um
      // quadro.
      setEscolha(escolhaInicialDoPortal(window.localStorage.getItem(CHAVE_TEMA), personalizado));
    } catch {
      // Storage bloqueado (modo restrito, cookie de terceiro): vale o padrão do portal.
      setEscolha(escolhaInicialDoPortal(null, personalizado));
    }
  }, [personalizado]);

  // O "sistema" tem que ser AO VIVO: quem deixa o aparelho trocar de tema ao anoitecer veria o
  // portal parado no tema da hora em que abriu a aba.
  useEffect(() => {
    const consulta = window.matchMedia("(prefers-color-scheme: dark)");
    setSistemaPrefereEscuro(consulta.matches);

    const aoMudar = (evento: MediaQueryListEvent) => setSistemaPrefereEscuro(evento.matches);
    consulta.addEventListener("change", aoMudar);

    return () => consulta.removeEventListener("change", aoMudar);
  }, []);

  // O atributo no <html> é o mesmo que o script pré-pintura escreve; aqui ele só acompanha as
  // trocas feitas com a tela já aberta. "sistema" REMOVE o atributo — é a ausência dele que
  // devolve a decisão à media query, sem precisar de uma terceira regra de CSS.
  useEffect(() => {
    if (escolha === null) return;

    const raiz = document.documentElement;

    if (escolha === "sistema") raiz.removeAttribute(ATRIBUTO_TEMA);
    else raiz.setAttribute(ATRIBUTO_TEMA, escolha);
  }, [escolha]);

  const definirEscolha = useCallback((proxima: TemaEscolhido) => {
    setEscolha(proxima);

    try {
      window.localStorage.setItem(CHAVE_TEMA, proxima);
    } catch {
      // Sem storage a escolha vale só nesta aba. Ainda é melhor do que não poder escolher.
    }
  }, []);

  const valor = useMemo<TemaDoPortal>(() => {
    // Enquanto a leitura do storage não terminou (`null`), vale o ponto de partida do perfil:
    // é o mesmo que o script pré-pintura já aplicou, então o alternador nasce com o botão certo
    // aceso em vez de piscar do "aparelho" para o real.
    const atual: TemaEscolhido = escolha ?? (personalizado ? "sistema" : TEMA_PADRAO_DO_PORTAL);

    return {
      definirEscolha,
      efetivo: resolverTemaEfetivo(atual, sistemaPrefereEscuro),
      escolha: atual,
    };
  }, [definirEscolha, escolha, personalizado, sistemaPrefereEscuro]);

  return <TemaContexto.Provider value={valor}>{children}</TemaContexto.Provider>;
}

/**
 * O tema em uso. Fora do provedor devolve o claro seguindo o aparelho: quem chama é tela
 * de portal, e uma tela que se recusa a renderizar por causa de contexto de COR seria pior do que
 * a cor errada.
 */
export function useTemaDoPortal(): TemaDoPortal {
  return (
    useContext(TemaContexto) ?? {
      definirEscolha: () => undefined,
      efetivo: "claro",
      escolha: "sistema",
    }
  );
}

const OPCOES: { Icone: typeof Sun; chave: TemaEscolhido; rotulo: string }[] = [
  { Icone: Sun, chave: "claro", rotulo: "Tema claro" },
  { Icone: Moon, chave: "escuro", rotulo: "Tema escuro" },
  { Icone: Monitor, chave: "sistema", rotulo: "Seguir o aparelho" },
];

/**
 * O ALTERNADOR: claro / escuro / seguir o aparelho, em três ícones.
 *
 * TRÊS estados e não dois porque "seguir o aparelho" é o padrão e precisa ter volta: quem tocou no
 * claro por engano no celular não teria como voltar a acompanhar o modo noturno se o controle só
 * alternasse entre dois. Ícone e `title`, sem rótulo escrito — é o padrão do Lucas para controle
 * secundário (ícones no lugar de texto), e o rodapé do sidebar tem 224px no total.
 *
 * ⚠️ ELE NÃO APARECE NO PORTAL PERSONALIZADO (Cecílio). Regra do Lucas (17/08/2026): o sistema
 * dele é outro projeto, já aprovado e em uso pelo cliente, e o padrão não passa por cima. Lá o
 * tema continua vindo do aparelho, exatamente como está no ar hoje — e o masterplan dele continua
 * chegando claro. Ver [[perfis-de-portal]].
 */
export function AlternadorDeTema() {
  const { definirEscolha, escolha } = useTemaDoPortal();

  return (
    <div
      aria-label="Tema da tela"
      role="group"
      style={{
        border: `1px solid ${T.border}`,
        borderRadius: 9,
        display: "inline-flex",
        gap: 2,
        padding: 2,
      }}
    >
      {OPCOES.map(({ Icone, chave, rotulo }) => {
        const ativo = escolha === chave;

        return (
          <button
            aria-label={rotulo}
            aria-pressed={ativo}
            key={chave}
            onClick={() => definirEscolha(chave)}
            style={{
              alignItems: "center",
              background: ativo ? T.soft : "transparent",
              border: "none",
              borderRadius: 7,
              color: ativo ? T.text : T.muted,
              cursor: "pointer",
              display: "inline-flex",
              justifyContent: "center",
              padding: "5px 8px",
            }}
            title={rotulo}
            type="button"
          >
            <Icone aria-hidden="true" size={14} strokeWidth={ativo ? 2.4 : 2} />
          </button>
        );
      })}
    </div>
  );
}

/**
 * A marca, na versão certa para cada tema. Quem não tem versão em negativo continua com a clara
 * nos dois: melhor a logo dele um pouco fora de tom do que sumida.
 */
export function Marca({
  altura,
  escuraUrl,
  largura,
  nome,
  url,
}: {
  altura: number;
  escuraUrl: string | null;
  largura: number | string;
  nome: string;
  url: string | null;
}) {
  if (!url && !escuraUrl) {
    return <span style={{ color: T.text, fontSize: 22, fontWeight: 600 }}>{nome}</span>;
  }

  // ⚠️ SEM `display` AQUI. Ele mora no CSS acima, e a razão é dura: estilo inline vence regra
  // de classe, então um `display` neste objeto reacende a logo que o tema mandou esconder — foi
  // assim que as DUAS marcas apareceram na mesma tela, uma embaixo da outra.
  const estilo = {
    maxHeight: altura,
    maxWidth: largura,
    objectFit: "contain" as const,
    width: "100%",
  };

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- asset local, sem otimização */}
      <img alt={nome} className="marca-clara" src={url ?? escuraUrl ?? ""} style={estilo} />
      {escuraUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- asset local, sem otimização
        <img alt={nome} className="marca-escura" src={escuraUrl} style={estilo} />
      ) : null}
    </>
  );
}
