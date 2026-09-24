"use client";

import { AlertTriangle, ArrowRightLeft, Check, Loader2, X } from "lucide-react";
import { useState } from "react";

import { toTitleCase } from "@/lib/format/name-case";

import { getApoloAccessToken } from "../../data/apolo-operations";

// MOVER A CAD DE EMPREENDIMENTO, pelo card do Board (24/09/2026).
//
// O caso que criou a ação: a CAD do JONATAS nasceu no VEREDAS DO OURO (19) e era do VALE DO OURO
// (35). Não existia como mover a CAD; o time trocou o VÍNCULO no painel de Relacionamentos (exclui o
// 19, adiciona o 35) e a CAD ficou no 19. O crédito leu a configuração do Veredas e credenciou sem
// Serasa, e o coordenador do Vale do Ouro não via o cliente. A troca passa a ser UMA ação, que move a
// CAD, o vínculo e refaz a régua do crédito pelo empreendimento de destino (a rota decide tudo; aqui
// é só escolher o destino e mostrar o que ela respondeu).
//
// ⚠️ SÓ A COORDENAÇÃO VÊ O BOTÃO, e só na porta do hub. Quem decide é o servidor da fila: o campo
// `moverCad` só chega para admin e leader (lib/apolo/board-do-servidor.ts, `podeMoverCad`), e a rota
// confere de novo. O Board não conhece o papel de quem está logado; perguntar ao servidor é o que
// mantém a tela e a rota com a mesma régua.
//
// ⚠️ BEARER SEMPRE. A rota mora em /api/apolo/board/** e sem o Bearer responde 401 (lição da
// v1.366.0: botão que chamava rota do Apolo sem o cabeçalho parecia morto).

/**
 * Um destino possível: empreendimento de mercado que recebe CAD (pai ou grupo, nunca divisão). O
 * servidor já manda o `id` no idioma de mercado (o mesmo de `idDeMercado`), então ele se compara
 * direto com o id de mercado da CAD.
 */
export type DestinoDaCad = { id: string; nome: string };

/** O que a rota devolve no 200 (contrato de /api/apolo/board/[id]/mover-empreendimento). */
export type ResultadoDaMudanca = {
  /**
   * Frases da rota. Com `incompleto`, dizem o passo que não saiu (ex.: o PDF da CAD não foi regenerado
   * agora) e viram alerta. Sem `incompleto`, são informativas (ex.: o produto sem coordenador no C2X)
   * e aparecem como texto neutro.
   */
  avisos?: string[];
  /** `motivo` é a frase pronta da rota, avaliado ou não; vai para a dica da linha. */
  credito: { avaliado: boolean; motivo: null | string; passou: boolean | null };
  de: string;
  empreendimentoNovo: string;
  etapaAnterior: null | string;
  etapaNova: string;
  /** A CAD mudou de empreendimento, mas algum passo seguinte não terminou (ex.: a etapa não subiu). */
  incompleto?: boolean;
  para: string;
};

/**
 * A frase de quando NINGUÉM SABE se a CAD foi movida: a resposta não chegou (queda de rede) ou chegou
 * sem o corpo da rota (5xx em HTML).
 *
 * ⚠️ O TIMEOUT DA VERCEL DEVOLVE HTML, NÃO JSON (revisão de 24/09/2026; ver
 * [[reference_vercel_timeout_vira_erro_de_json]]). A rota grava a esteira no passo 1 e ainda chama a
 * etapa (avisos por WhatsApp) e o PDF (até 15 s, toca o C2X), com `maxDuration` 60. Um corte depois do
 * passo 1 chega como 504 sem corpo: a CAD JÁ está no destino, e a tela dizia "Não foi possível mover
 * a CAD (504)" e deixava o card com o `de` antigo. A nova tentativa então dava 404 ("não encontrada
 * neste empreendimento"), e o operador concluía que o sistema estava quebrado. Por isso a tela não
 * afirma falha: manda conferir e recarrega a fila, que traz o `de` de verdade.
 */
export const FRASE_SEM_CONFIRMACAO =
  "Não deu para confirmar. Recarregue o Board para conferir onde a CAD está.";

/**
 * O seletor quando o servidor mandou a lista VAZIA: o catálogo do C2X ou o portão de CAD não carregou.
 *
 * ⚠️ LISTA VAZIA É FALHA, NÃO FATO (revisão de 24/09/2026). Oito ids recebem CAD hoje, então o servidor
 * só manda `destinos: []` quando a leitura falhou (o portão falha fechado com [], e sem o catálogo
 * nenhum destino tem nome; ver `moverCadDoUsuario` em lib/apolo/board-do-servidor.ts). O seletor dizia
 * "Nenhum destino recebendo CAD", e o coordenador concluía que os produtos estavam fechados.
 */
export const FRASE_SEM_DESTINOS = "Não foi possível carregar os empreendimentos agora.";

/** O seletor quando a lista veio, mas o único destino é o próprio produto da CAD. */
export const FRASE_SEM_OUTRO_DESTINO = "Nenhum outro empreendimento recebe CAD.";

// As etapas da esteira com as palavras da tela (as mesmas colunas do Board).
const ROTULO_DA_ETAPA: Record<string, string> = {
  cadastro: "Validação",
  correcao: "Correção",
  credenciado: "Credenciado",
  credito: "Análise de crédito",
  indeferido: "Indeferido",
  prevenda: "Pré-venda",
  revisao: "Crédito em revisão",
  validacao: "Validação",
};

export function rotuloDaEtapa(etapa: null | string | undefined): string {
  const chave = String(etapa ?? "").trim();
  return ROTULO_DA_ETAPA[chave] ?? chave;
}

/**
 * Os destinos que o seletor oferece: todos, menos o empreendimento em que a CAD já está.
 *
 * ⚠️ "ONDE A CAD JÁ ESTÁ" É O PRODUTO, NÃO O ID CRU (revisão de 24/09/2026). Há CADs gravadas em ids de
 * divisão (medido: 36 é Vale do Ouro · VOL, 2 CADs; 37, 41 e as divisões do Lagoa Bonita, 1 cada). O
 * card da CAD 36 diz VALE DO OURO, e tirar só o "36" da lista deixava o "Vale do Ouro" (35) como
 * destino: a rota sobe o 36 para o 35, conclui que é o mesmo produto e responde 400 sempre. Uma opção
 * que nunca passa. O servidor manda no item o id de MERCADO da CAD (`enterpriseIdDeMercado`, a mesma
 * régua da rota), e é por ele que o destino sai da lista. O id cru continua fora também, para a tela
 * não oferecer o próprio id quando o servidor não mandou o de mercado.
 */
export function destinosParaEscolher(
  destinos: readonly DestinoDaCad[],
  de: null | string | undefined,
  mercado?: null | string,
): DestinoDaCad[] {
  const ondeEsta = new Set(
    [de, mercado].map((id) => String(id ?? "").trim()).filter(Boolean),
  );
  return destinos.filter((destino) => !ondeEsta.has(String(destino.id).trim()));
}

/**
 * A primeira linha do seletor: "Destino" quando há o que escolher; sem opção, a frase que diz POR QUE.
 * `destinos` é a lista do servidor inteira (antes de tirar o próprio produto): vazia = não carregou.
 */
export function rotuloDoSeletor(
  destinos: readonly DestinoDaCad[],
  opcoes: readonly DestinoDaCad[],
): string {
  if (opcoes.length > 0) return "Destino";
  return destinos.length === 0 ? FRASE_SEM_DESTINOS : FRASE_SEM_OUTRO_DESTINO;
}

/**
 * A linha do resultado: empreendimento novo, etapa nova e, quando a rota avaliou o crédito contra o
 * limite do destino, se passou ou não.
 *
 * ⚠️ "AVALIADO" É SÓ QUANDO JÁ HAVIA ANÁLISE. Regra do Lucas (24/09/2026): se a CAD já tinha análise
 * de crédito recente, a rota só confere os valores contra o limite do destino e aponta se passou; se
 * não tinha e o destino exige análise, a CAD vai para a Análise de crédito, e aí a etapa nova já diz
 * tudo. Nesse caso a linha não fala de "passou", porque ninguém avaliou nada ainda.
 */
export function resumoDaMudanca(resultado: ResultadoDaMudanca): string {
  const partes = [
    toTitleCase(resultado.empreendimentoNovo || resultado.para),
    rotuloDaEtapa(resultado.etapaNova),
  ].filter(Boolean);
  if (resultado.credito.avaliado) {
    partes.push(
      resultado.credito.passou
        ? "Crédito passou no limite do destino"
        : "Crédito não passou no limite do destino",
    );
  }
  return partes.join(" · ");
}

/** A dica da linha (hover): a frase do crédito que a rota mandou. Os avisos ficam à vista. */
export function dicaDaMudanca(resultado: ResultadoDaMudanca): string {
  return String(resultado.credito.motivo ?? "").trim();
}

/**
 * O que a tela ESCREVE embaixo da linha: os avisos da rota, sem repetição. `incompleto` sem aviso
 * nenhum ainda ganha uma frase, para nunca virar um alerta sem explicação.
 *
 * ⚠️ A ROTA PODE REPETIR O MESMO AVISO (revisão de 24/09/2026): o passo dos vínculos empurra "O vínculo
 * com o empreendimento anterior não foi arquivado." uma vez para cada vínculo da origem que falha (35 e
 * a divisão 37, por exemplo). A frase repetida não diz nada a mais, e na lista virava item dobrado.
 */
export function avisosDaMudanca(resultado: ResultadoDaMudanca): string[] {
  const avisos = [
    ...new Set(
      (resultado.avisos ?? []).map((frase) => String(frase ?? "").trim()).filter(Boolean),
    ),
  ];
  if (avisos.length === 0 && resultado.incompleto) {
    return ["A troca não terminou. Confira a etapa da CAD no Board."];
  }
  return avisos;
}

/**
 * O ícone da linha: `reprovado` (o crédito não passou no limite do destino), `atencao` (a troca foi
 * feita, mas algum passo não saiu) ou `ok`.
 *
 * ⚠️ PASSO QUE NÃO SAIU NÃO É CHECK VERDE (revisão de 24/09/2026). A rota devolve 200 com `incompleto`
 * quando os passos depois da troca falham (vínculo, etapa, PDF), e a tela mostrava o check verde com os
 * avisos só no hover, que nem existe no toque do celular. O caso que assusta: a consulta passou no
 * limite do destino, a etapa não subiu, e a linha dizia "Crédito passou" com o verde de tudo certo. O
 * reprovado vence porque é a notícia mais grave; os avisos aparecem escritos embaixo nos dois casos.
 *
 * ⚠️ QUEM DECIDE O ALERTA É `incompleto`, NÃO A EXISTÊNCIA DE AVISO (terceira rodada, 24/09/2026). A rota
 * também manda aviso informativo, que não é falha de passo (o produto sem coordenador no C2X, por
 * exemplo: medido, 6 de 6 avisos do Lagoa Bonita falham assim, e reenviar não resolve). Pintar esse
 * aviso de âmbar em todo Mover para aquele destino fazia do alerta um ruído permanente, e o âmbar de
 * uma falha real passava despercebido. Aviso sem `incompleto` é texto neutro, com o ícone de sempre.
 */
export type TomDoResultado = "atencao" | "ok" | "reprovado";

export function tomDoResultado(resultado: ResultadoDaMudanca): TomDoResultado {
  if (resultado.credito.avaliado && !resultado.credito.passou) return "reprovado";
  if (resultado.incompleto) return "atencao";
  return "ok";
}

/**
 * O que a chamada devolve à tela. `incerto` = ninguém sabe se o servidor gravou: a tela manda conferir
 * e recarrega a fila em vez de afirmar que falhou (ver `FRASE_SEM_CONFIRMACAO`).
 */
export type RespostaDoMover =
  | { data: null | ResultadoDaMudanca; ok: true }
  | { error: string; incerto: boolean; ok: false };

/** Chama a rota. Nunca lança: devolve o dado ou a mensagem que a tela mostra. */
export async function moverCadDeEmpreendimento(entrada: {
  de: string;
  entityId: string;
  para: string;
}): Promise<RespostaDoMover> {
  // Sem sessão nada saiu da tela: isto é falha certa, não incerteza.
  let token: null | string;
  try {
    token = await getApoloAccessToken();
  } catch {
    return {
      error: "A sessão expirou. Entre de novo para mover a CAD.",
      incerto: false,
      ok: false,
    };
  }

  let resposta: Response;
  try {
    resposta = await fetch(
      `/api/apolo/board/${encodeURIComponent(entrada.entityId)}/mover-empreendimento`,
      {
        body: JSON.stringify({ de: entrada.de, para: entrada.para }),
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      },
    );
  } catch {
    // Queda de rede: o pedido pode ter chegado e gravado. A tela manda conferir em vez de afirmar.
    return { error: FRASE_SEM_CONFIRMACAO, incerto: true, ok: false };
  }

  // Resposta que não é JSON (timeout da Vercel devolve HTML) não pode virar exceção calada. Corpo que
  // é JSON mas não é objeto (uma string solta) conta como "sem corpo da rota".
  const bruto: unknown = await resposta.json().catch(() => null);
  const corpo =
    bruto && typeof bruto === "object"
      ? (bruto as { data?: ResultadoDaMudanca; error?: unknown })
      : null;
  const erroDaRota = typeof corpo?.error === "string" ? corpo.error.trim() : "";

  if (!resposta.ok) {
    // A rota falou: é a frase dela (os 4xx e os 503 dela saem ANTES de qualquer escrita).
    if (erroDaRota) return { error: erroDaRota, incerto: false, ok: false };
    // 5xx sem o corpo da rota: foi a plataforma que respondeu, e a troca pode ter acontecido.
    if (resposta.status >= 500) return { error: FRASE_SEM_CONFIRMACAO, incerto: true, ok: false };
    return {
      error: `Não foi possível mover a CAD (${resposta.status}).`,
      incerto: false,
      ok: false,
    };
  }
  return { data: corpo?.data ?? null, ok: true };
}

// A linha que fica embaixo do botão depois do 200. `tom` decide o ícone; `dica` é a frase do crédito
// (hover); `avisos` ficam escritos, à vista, em âmbar só quando `avisosEmAlerta` (a rota disse
// `incompleto`), e neutros quando são só informação.
type LinhaDoResultado = {
  avisos: string[];
  avisosEmAlerta: boolean;
  dica: string;
  texto: string;
  tom: TomDoResultado;
};

function linhaDoResultado(resultado: null | ResultadoDaMudanca): LinhaDoResultado {
  if (!resultado) {
    return { avisos: [], avisosEmAlerta: false, dica: "", texto: "CAD movida.", tom: "ok" };
  }
  return {
    avisos: avisosDaMudanca(resultado),
    avisosEmAlerta: resultado.incompleto === true,
    dica: dicaDaMudanca(resultado),
    texto: resumoDaMudanca(resultado),
    tom: tomDoResultado(resultado),
  };
}

export function MoverCad({
  de,
  destinos,
  entityId,
  mercado,
  onConferir,
  onMovida,
}: {
  /** O empreendimento da CAD que o card mostra (o `enterpriseId` do card). */
  de: string;
  destinos: readonly DestinoDaCad[];
  entityId: string;
  /** O id de MERCADO da CAD (`enterpriseIdDeMercado` do item): o produto que não entra como destino. */
  mercado?: null | string;
  /** Resposta incerta (rede, 5xx sem corpo): a tela recarrega a fila para o card mostrar onde a CAD está. */
  onConferir?: () => void;
  /** Depois do 200: a tela recarrega a fila (a etapa e o rótulo novos vêm do banco). */
  onMovida: (resultado: null | ResultadoDaMudanca) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [para, setPara] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<null | { incerto: boolean; texto: string }>(null);
  const [resultado, setResultado] = useState<LinhaDoResultado | null>(null);

  const opcoes = destinosParaEscolher(destinos, de, mercado);

  const confirmar = async () => {
    if (!para || enviando) return;
    setEnviando(true);
    setErro(null);
    setResultado(null);
    const r = await moverCadDeEmpreendimento({ de, entityId, para });
    setEnviando(false);
    if (!r.ok) {
      setErro({ incerto: r.incerto, texto: r.error });
      if (r.incerto) {
        // A CAD pode já estar no destino: o seletor fecha (o `de` dele pode estar velho) e a fila
        // recarrega para o card dizer onde ela está.
        setAberto(false);
        setPara("");
        onConferir?.();
      }
      return;
    }
    setResultado(linhaDoResultado(r.data));
    setAberto(false);
    setPara("");
    onMovida(r.data);
  };

  return (
    <div className="mt-2 grid gap-1.5">
      {aberto ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            aria-label="Empreendimento de destino"
            className="h-8 min-w-0 max-w-full rounded-lg border border-line bg-surface px-2 text-xs text-ink outline-none focus:border-ink/40"
            disabled={enviando || opcoes.length === 0}
            onChange={(event) => setPara(event.target.value)}
            value={para}
          >
            <option value="">{rotuloDoSeletor(destinos, opcoes)}</option>
            {opcoes.map((destino) => (
              <option key={destino.id} value={destino.id}>
                {toTitleCase(destino.nome)}
              </option>
            ))}
          </select>
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-inverse px-3 text-xs font-semibold text-brand-ink transition-opacity hover:opacity-90 disabled:opacity-40"
            disabled={!para || enviando}
            onClick={() => void confirmar()}
            title="Move a CAD, o vínculo e refaz o crédito pelo destino"
            type="button"
          >
            {enviando ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : null}
            Mover
          </button>
          <button
            aria-label="Cancelar"
            className="inline-flex size-8 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:bg-subtle hover:text-ink disabled:opacity-40"
            disabled={enviando}
            onClick={() => {
              setAberto(false);
              setPara("");
              setErro(null);
            }}
            title="Cancelar"
            type="button"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      ) : (
        <div>
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium text-ink-soft transition-colors hover:bg-subtle hover:text-ink"
            onClick={() => {
              setAberto(true);
              setErro(null);
            }}
            title="Mover a CAD para outro empreendimento"
            type="button"
          >
            <ArrowRightLeft aria-hidden="true" className="size-3.5" />
            Mover CAD
          </button>
        </div>
      )}

      {erro ? (
        <p
          className={`m-0 flex items-start gap-1.5 text-xs ${
            erro.incerto
              ? "text-amber-900 dark:text-amber-200"
              : "text-rose-700 dark:text-rose-300"
          }`}
          data-incerto={erro.incerto ? "sim" : undefined}
          role="alert"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{erro.texto}</span>
        </p>
      ) : null}

      {resultado ? (
        <div className="grid gap-0.5" data-tom={resultado.tom} role="status">
          <p className="m-0 flex items-start gap-1.5 text-xs text-ink" title={resultado.dica || undefined}>
            {resultado.tom === "reprovado" ? (
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-rose-600" />
            ) : resultado.tom === "atencao" ? (
              <AlertTriangle
                aria-hidden="true"
                className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400"
              />
            ) : (
              <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
            )}
            <span>{resultado.texto}</span>
          </p>
          {resultado.avisos.length ? (
            <ul
              className={`m-0 grid list-none gap-0.5 p-0 pl-5 text-xs ${
                resultado.avisosEmAlerta ? "text-amber-900 dark:text-amber-200" : "text-ink-muted"
              }`}
              data-avisos={resultado.avisosEmAlerta ? "alerta" : "informativo"}
            >
              {/* Key pela posição: a frase não é chave (duas iguais já quebraram a lista). */}
              {resultado.avisos.map((aviso, indice) => (
                <li key={`aviso-${indice}`}>{aviso}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
