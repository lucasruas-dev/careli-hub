"use client";

import { createContext, type ReactNode, useContext, useMemo } from "react";

import { getMinutaAtualParaUpload } from "@/lib/temis/upload-midia";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// A PORTA DAS TELAS DA TÊMIS — por onde elas falam com o servidor.
//
// Lucas (16/09/2026), sobre o portal da Cecílio Rocha: a equipe dela gera o contrato, manda para
// assinatura e cria e edita as minutas dos produtos dela. As telas são AS MESMAS da Têmis da Careli
// (quadro, tela de trabalho, prévia, organização da assinatura, minutas e anexos); o que muda é a
// porta. No hub elas chamam `/api/temis/*` com o Bearer da sessão do hub; no portal chamam
// `/api/incorporador/temis/*` com o cookie `apolo_inc`, e a rota do outro lado recorta pelo escopo
// do incorporador (`autorizarTemisDoPortal`).
//
// ⚠️ UMA TELA, DUAS PORTAS, E A TELA NÃO SABE QUAL. Antes cada componente montava a URL e o
// cabeçalho na mão (`getApoloAccessToken` + `fetch("/api/temis/...")`). Copiar as telas para o
// portal trocando a URL daria duas cópias de cada uma, e a segunda envelheceria calada. Aqui elas
// pedem um SUBCAMINHO (`/trabalho?id=...`) e o provedor decide base e credencial.
//
// ⚠️ SEM PROVEDOR É O HUB, E ISSO É A GARANTIA DE QUE A TÊMIS DA CARELI NÃO MUDA. O contexto nasce
// com a porta do hub: nenhuma tela do hub precisou ganhar provedor, e cada chamada sai com a mesma
// URL, o mesmo Bearer e as mesmas opções de antes. Só o portal que confecciona contrato monta
// `<ApiDaTemisProvider {...API_DA_TEMIS_DO_PORTAL}>` por cima delas.
//
// ⚠️ O PORTAL COMERCIAL (Gurgel) NÃO GANHA PROVEDOR. A confecção das vendas dele é da Careli
// (`portalConfeccionaContrato` é falso para o comercial), e as telas que ele abre — a prévia do
// contrato na Venda — continuam exigindo a sessão do hub, exatamente como hoje.
//
// ⚠️ A BASE E A CREDENCIAL ANDAM JUNTAS, e o tipo não deixa separar. Base do portal com Bearer
// entregaria o token do hub a uma rota que não o lê; base do hub com cookie responderia 401 em
// tudo. Uma união discriminada é mais barata do que descobrir isso em produção.

export type ConfiguracaoDaApiDaTemis =
  | { autenticacao: "cookie"; base: "/api/incorporador/temis" }
  | { autenticacao: "hub"; base: "/api/temis" };

export type AutenticacaoDaApiDaTemis = ConfiguracaoDaApiDaTemis["autenticacao"];
export type BaseDaApiDaTemis = ConfiguracaoDaApiDaTemis["base"];

/** `subcaminho` é o que vem DEPOIS de `/api/temis`, com a barra: `/trabalho?id=...`. */
export type TemisFetch = (subcaminho: string, init?: RequestInit) => Promise<Response>;

export type ApiDaTemis = ConfiguracaoDaApiDaTemis & { temisFetch: TemisFetch };

export const API_DA_TEMIS_DO_HUB = {
  autenticacao: "hub",
  base: "/api/temis",
} as const satisfies ConfiguracaoDaApiDaTemis;

export const API_DA_TEMIS_DO_PORTAL = {
  autenticacao: "cookie",
  base: "/api/incorporador/temis",
} as const satisfies ConfiguracaoDaApiDaTemis;

/** O que `montarTemisFetch` usa do mundo. Existe para o teste trocar; a tela usa o padrão. */
export type DependenciasDaApiDaTemis = {
  buscar: (url: string, init: RequestInit) => Promise<Response>;
  /** A minuta aberta no editor (o registro de `upload-midia.ts`). Ausente = a do registro. */
  minutaAberta?: () => null | string;
  obterToken: () => Promise<null | string>;
};

const DEPENDENCIAS_PADRAO: Required<DependenciasDaApiDaTemis> = {
  // ⚠️ `fetch` LIDO NA HORA DA CHAMADA, e não guardado na carga do módulo: é assim que o `fetch`
  // trocado pelo teste (ou por um polyfill) continua valendo.
  buscar: (url, init) => fetch(url, init),
  minutaAberta: () => getMinutaAtualParaUpload(),
  obterToken: () => getApoloAccessToken(),
};

/** Os subcaminhos do agente da minuta, que no portal precisam dizer qual minuta está aberta. */
const SUBCAMINHOS_DO_AGENTE = new Set(["/minutas/conversar", "/minutas/marcar"]);

/**
 * `/minutas/marcar` → `/minutas/marcar?minutaId=<a minuta aberta>`, só nos subcaminhos do agente.
 *
 * ⚠️ POR QUE (decisão do Lucas, 16/09/2026: escrita só no que a Cecílio opera). No portal o agente
 * só trabalha sobre minuta de produto que o portal opera, e a rota confere pela `minutaId`. O editor
 * manda só o texto; a minuta aberta vive no mesmo registro que o upload de mídia do Plate já usa
 * (`setMinutaAtualParaUpload`, preenchido ao montar o editor). Sem minuta aberta, ou com o parâmetro
 * já na URL, o subcaminho passa intacto e a rota decide (sem id é 404).
 */
export function subcaminhoComMinutaAberta(subcaminho: string, minutaAberta: null | string): string {
  const minuta = minutaAberta?.trim();
  if (!minuta) return subcaminho;

  const caminho = subcaminho.startsWith("/") ? subcaminho : `/${subcaminho}`;
  const inicioDaBusca = caminho.indexOf("?");
  const semBusca = inicioDaBusca === -1 ? caminho : caminho.slice(0, inicioDaBusca);
  if (!SUBCAMINHOS_DO_AGENTE.has(semBusca)) return subcaminho;

  const parametros = new URLSearchParams(inicioDaBusca === -1 ? "" : caminho.slice(inicioDaBusca + 1));
  if (parametros.has("minutaId")) return subcaminho;
  parametros.set("minutaId", minuta);
  return `${semBusca}?${parametros.toString()}`;
}

/**
 * `/api/temis` + `/trabalho?id=1` → `/api/temis/trabalho?id=1`.
 *
 * ⚠️ A BARRA É GARANTIDA AQUI, e não confiada a quem chama: `trabalho` sem barra viraria
 * `/api/temistrabalho`, um 404 que não diz de onde veio.
 */
export function urlDaTemis(base: BaseDaApiDaTemis, subcaminho: string): string {
  const caminho = subcaminho.startsWith("/") ? subcaminho : `/${subcaminho}`;
  return `${base}${caminho}`;
}

/**
 * Os cabeçalhos do `init` como objeto simples.
 *
 * ⚠️ OBJETO SIMPLES, E NÃO `Headers`, de propósito: todas as chamadas que esta camada substituiu
 * mandavam `{ Authorization, "Content-Type" }` como objeto. Manter a forma é o que deixa a chamada
 * do hub byte a byte igual à de antes — inclusive para quem a inspeciona num teste.
 */
function cabecalhosComoObjeto(cabecalhos: HeadersInit | undefined): Record<string, string> {
  if (!cabecalhos) return {};
  if (typeof Headers !== "undefined" && cabecalhos instanceof Headers) {
    return Object.fromEntries(cabecalhos.entries());
  }
  if (Array.isArray(cabecalhos)) return Object.fromEntries(cabecalhos);
  return { ...(cabecalhos as Record<string, string>) };
}

function semAuthorization(cabecalhos: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(cabecalhos).filter(([nome]) => nome.toLowerCase() !== "authorization"),
  );
}

/**
 * A função que as telas chamam, para UMA porta.
 *
 * - `hub`: pede o token a `getApoloAccessToken()` A CADA CHAMADA, como cada tela fazia, e manda
 *   `Authorization: Bearer <token>`. Sem sessão, `getApoloAccessToken` LANÇA antes de qualquer
 *   `fetch`, e a promessa rejeita com o mesmo erro — os `catch` das telas continuam pegando o que
 *   pegavam.
 * - `cookie`: nenhum token é pedido e nenhum `Authorization` sai, nem se a tela mandar um. Vai
 *   `credentials: "same-origin"`, que é como o cookie `apolo_inc` acompanha a chamada.
 */
export function montarTemisFetch(
  configuracao: ConfiguracaoDaApiDaTemis,
  dependencias: DependenciasDaApiDaTemis = DEPENDENCIAS_PADRAO,
): TemisFetch {
  if (configuracao.autenticacao === "cookie") {
    const minutaAberta = dependencias.minutaAberta ?? DEPENDENCIAS_PADRAO.minutaAberta;
    return (subcaminho, init = {}) =>
      dependencias.buscar(
        urlDaTemis(configuracao.base, subcaminhoComMinutaAberta(subcaminho, minutaAberta())),
        {
          ...init,
          // ⚠️ O TOKEN DO HUB NUNCA SAI PELA PORTA DO PORTAL: quem está no portal pode ter uma aba
          // do hub aberta no mesmo navegador, e a credencial de lá não é a desta tela.
          credentials: "same-origin",
          headers: semAuthorization(cabecalhosComoObjeto(init.headers)),
        },
      );
  }

  return async (subcaminho, init = {}) => {
    const token = await dependencias.obterToken();
    return dependencias.buscar(urlDaTemis(configuracao.base, subcaminho), {
      ...init,
      headers: { ...cabecalhosComoObjeto(init.headers), Authorization: `Bearer ${token}` },
    });
  };
}

/**
 * Dá para chamar agora, ou a resposta certa é "sessão expirada" sem gastar a chamada?
 *
 * ⚠️ EXISTE PARA O AGENTE DA MINUTA, e só faz sentido onde a chamada é CARA: lá cada leitura é um
 * modelo de fronteira sobre o contrato inteiro, e o editor já recusava antes de começar quando o
 * hub não tinha token ("O agente respondeu 401" foi o primeiro teste real).
 *
 * - `hub`: a mesma pergunta de antes, `getApoloAccessToken()` com o lançamento virando `false`.
 * - `cookie`: `true`. O `apolo_inc` é `httpOnly`, a tela não o enxerga; quem confere é a rota, e o
 *   401 dela volta como resposta, que o editor já sabe escrever.
 */
export async function sessaoDisponivel(
  configuracao: ConfiguracaoDaApiDaTemis,
  obterToken: DependenciasDaApiDaTemis["obterToken"] = DEPENDENCIAS_PADRAO.obterToken,
): Promise<boolean> {
  if (configuracao.autenticacao === "cookie") return true;
  try {
    return Boolean(await obterToken());
  } catch {
    return false;
  }
}

/** A recusa da IA do editor no portal, dita antes de qualquer ida à rede. */
export const MENSAGEM_DA_IA_NO_PORTAL = "A IA do editor não está disponível no portal.";

/**
 * Os cabeçalhos do pedido à IA do Plate no editor de minutas (`/api/ai/command`), pela porta em uso.
 *
 * ⚠️ A ROTA DA IA DO EDITOR SÓ EXISTE NO HUB (revisão da onda 3, achado 22). Ela exige a sessão do
 * hub (`authorizeApoloWrite`) e não tem espelho no portal. Antes, o editor aberto no portal pedia o
 * token do hub a `getApoloAccessToken` e o mandava junto: quem tivesse uma aba do hub aberta no
 * mesmo navegador entregaria a credencial da Careli a um pedido feito da tela do portal, e quem não
 * tivesse via "Sessão administrativa ausente".
 *
 * - `hub`: o de sempre. Pede o token A CADA PEDIDO e manda `Authorization: Bearer` e o JSON.
 * - `cookie` (portal): REJEITA com `MENSAGEM_DA_IA_NO_PORTAL` sem pedir token e sem montar pedido
 *   nenhum. O menu de IA continua no editor (tirar o kit quebraria a barra de blocos, a barra `/` e a
 *   barra flutuante, que chamam o plugin direto); a recusa aparece como o erro do menu.
 */
export async function cabecalhosDaIaDoEditor(
  autenticacao: AutenticacaoDaApiDaTemis,
  cabecalhos: HeadersInit | undefined,
  obterToken: DependenciasDaApiDaTemis["obterToken"] = DEPENDENCIAS_PADRAO.obterToken,
): Promise<Headers> {
  if (autenticacao === "cookie") throw new Error(MENSAGEM_DA_IA_NO_PORTAL);

  const token = await obterToken();
  const headers = new Headers(cabecalhos);
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");
  return headers;
}

// ⚠️ O VALOR PADRÃO É UMA CONSTANTE DE MÓDULO, e a identidade dela importa: `temisFetch` entra na
// lista de dependências dos `useCallback`/`useEffect` das telas. Uma função nova a cada render
// refaria a busca a cada render — no editor da minuta, isso é chamar o agente de novo.
const API_PADRAO: ApiDaTemis = {
  ...API_DA_TEMIS_DO_HUB,
  temisFetch: montarTemisFetch(API_DA_TEMIS_DO_HUB),
};

const ContextoDaApiDaTemis = createContext<ApiDaTemis>(API_PADRAO);

export function ApiDaTemisProvider({
  children,
  ...configuracao
}: ConfiguracaoDaApiDaTemis & { children: ReactNode }) {
  const { autenticacao, base } = configuracao;
  // Mesma regra da constante acima: só muda de identidade se a porta mudar.
  const valor = useMemo<ApiDaTemis>(() => {
    const porta = { autenticacao, base } as ConfiguracaoDaApiDaTemis;
    return { ...porta, temisFetch: montarTemisFetch(porta) };
  }, [autenticacao, base]);

  return <ContextoDaApiDaTemis.Provider value={valor}>{children}</ContextoDaApiDaTemis.Provider>;
}

/** A porta em uso. Sem provedor acima, a do hub. */
export function useApiDaTemis(): ApiDaTemis {
  return useContext(ContextoDaApiDaTemis);
}
