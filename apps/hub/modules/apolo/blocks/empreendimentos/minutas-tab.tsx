"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  FileText,
  Info,
  Loader2,
  Plus,
  Save,
  Send,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  documentoParaHtml,
  documentoVazio,
  type NoDoDocumento,
} from "@/lib/temis/documento-html";
import { acharVariavel, classificarVariaveis, conferirBlocos, extensosOrfaos } from "@/lib/temis/variaveis";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// ABA MINUTAS — subir o contrato do loteador, editar e publicar.
//
// Pedido do Lucas (01/09/2026): *"vou liberar para o time já subi a minuta e editar"*, *"isso tem
// que está pronto"*. E o fluxo: *"o fluxo é subir a minuta que chega do loteador, vou importar, e o
// agente já le o documento, já identifica onde fica as variaveis"*.
//
// ⚠️ A CONFERÊNCIA APARECE ANTES DE PUBLICAR, e é o que separa esta tela do editor do C2X. Ela
// mostra três coisas que já produziram contrato errado: bloco condicional mal fechado (o parágrafo
// de pessoa jurídica saiu num contrato de pessoa física, no Villa Paris), variável que ninguém
// preenche (`[Nome]` sai impressa no papel) e valor sem o seu par por extenso.
//
// ⚠️ O EDITOR ENTRA POR IMPORTAÇÃO DINÂMICA. Ele carrega o Plate inteiro, e a ficha do
// empreendimento é aberta o dia todo por gente que nunca vai mexer em minuta — pagar esse download
// em toda visita à aba Unidades seria cobrar de todo mundo o custo de poucos.
const EditorDeMinuta = dynamic(() => import("@/modules/temis/editor-de-minuta"), {
  loading: () => (
    <p className="m-0 flex items-center gap-2 p-8 text-sm text-ink-muted">
      <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      Abrindo o editor…
    </p>
  ),
  ssr: false,
});

type Props = {
  enterpriseId: string;
  name: string;
  /**
   * Qual documento esta aba edita: `contrato`, `cessao`, `distrato` ou `cancelamento`.
   *
   * ⚠️ SÃO OS MESMOS VALORES DE `temis_minutas.tipo`. Sem o filtro, o Setup mostraria o termo de
   * distrato na aba da minuta e vice-versa — e alguém publicaria como contrato o texto que encerra
   * contrato.
   *
   * ⚠️ O DEFAULT É `contrato` porque a ficha do empreendimento, no Apolo, usa esta mesma aba sem
   * escolher tipo. Mudar o default quebraria aquela tela em silêncio.
   */
  tipo?: string;
};

type LinhaDeMinuta = {
  atualizado_em: string;
  criado_em: string;
  descricao: null | string;
  id: string;
  nome: string;
  origem_arquivo_nome: null | string;
  publicada_em: null | string;
  situacao: string;
  tipo: string;
  variaveis: { nome: string; ocorrencias: number }[];
  versao: number;
};

type MinutaAberta = LinhaDeMinuta & {
  conteudo: null | NoDoDocumento[];
  conteudo_html: null | string;
};

const data = (iso: null | string): string =>
  iso ? new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

const SITUACOES: Record<string, { cor: string; rotulo: string }> = {
  arquivada: { cor: "bg-subtle text-ink-muted", rotulo: "Arquivada" },
  publicada: {
    cor: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
    rotulo: "Publicada",
  },
  rascunho: {
    cor: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
    rotulo: "Rascunho",
  },
};

export function MinutasTab({ enterpriseId, name, tipo = "contrato" }: Props) {
  const [minutas, setMinutas] = useState<LinhaDeMinuta[] | null>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [aviso, setAviso] = useState<null | string>(null);
  const [recarregar, setRecarregar] = useState(0);

  const [aberta, setAberta] = useState<MinutaAberta | null>(null);
  const [documento, setDocumento] = useState<NoDoDocumento[]>(documentoVazio());
  const [sujo, setSujo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [nomeNovo, setNomeNovo] = useState("");
  const [criando, setCriando] = useState(false);

  useEffect(() => {
    let vivo = true;
    setMinutas(null);
    setErro(null);

    void (async () => {
      try {
        const token = await getApoloAccessToken();
        const r = await fetch(
          `/api/temis/minutas?enterpriseId=${encodeURIComponent(enterpriseId)}&tipo=${encodeURIComponent(tipo)}`,
          {
            cache: "no-store",
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        const corpo = (await r.json().catch(() => ({}))) as {
          data?: { minutas: LinhaDeMinuta[] };
          error?: string;
        };
        if (!vivo) return;

        // Falha fechada: lista vazia por erro faria o jurídico subir de novo o que já existe.
        if (!r.ok || !corpo.data) {
          setErro(corpo.error ?? "Não foi possível carregar as minutas.");
          return;
        }
        setMinutas(corpo.data.minutas);
      } catch {
        if (vivo) setErro("Falha ao carregar as minutas deste empreendimento.");
      }
    })();

    return () => {
      vivo = false;
    };
  }, [enterpriseId, recarregar, tipo]);

  const abrir = useCallback(async (id: string) => {
    setErro(null);
    setAviso(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(`/api/temis/minutas?id=${id}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const corpo = (await r.json().catch(() => ({}))) as {
        data?: { minuta: MinutaAberta };
        error?: string;
      };
      if (!r.ok || !corpo.data) {
        setErro(corpo.error ?? "Não consegui abrir a minuta.");
        return;
      }
      const minuta = corpo.data.minuta;
      setAberta(minuta);
      setDocumento(minuta.conteudo?.length ? minuta.conteudo : documentoVazio());
      setSujo(false);
    } catch {
      setErro("Falha ao abrir a minuta.");
    }
  }, []);

  const criar = async () => {
    const nome = nomeNovo.trim();
    if (!nome) return;

    setCriando(true);
    setErro(null);
    setAviso(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(`/api/temis/minutas?enterpriseId=${encodeURIComponent(enterpriseId)}`, {
        body: JSON.stringify({ nome, tipo }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const corpo = (await r.json().catch(() => ({}))) as { data?: { id: string }; error?: string };
      if (!r.ok || !corpo.data) {
        setErro(corpo.error ?? "Não consegui criar a minuta.");
        return;
      }
      setNomeNovo("");
      setRecarregar((n) => n + 1);
      await abrir(corpo.data.id);
    } catch {
      setErro("Falha de rede ao criar a minuta.");
    } finally {
      setCriando(false);
    }
  };

  const salvar = async () => {
    if (!aberta) return;

    setSalvando(true);
    setErro(null);
    setAviso(null);

    try {
      const token = await getApoloAccessToken();
      const r = await fetch(`/api/temis/minutas?id=${aberta.id}`, {
        body: JSON.stringify({
          conteudo: documento,
          conteudoHtml: documentoParaHtml(documento),
        }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "PATCH",
      });
      const corpo = (await r.json().catch(() => ({}))) as {
        data?: { id: string; novaVersao?: number; versaoNova?: boolean };
        error?: string;
      };

      if (!r.ok || !corpo.data) {
        setErro(corpo.error ?? "Não consegui salvar.");
        return;
      }

      setSujo(false);
      setRecarregar((n) => n + 1);

      // ⚠️ Salvar sobre uma PUBLICADA não altera a publicada: abre a versão seguinte. A tela precisa
      // dizer isso e trocar para a nova, senão o próximo salvamento abriria uma terceira versão.
      if (corpo.data.versaoNova) {
        setAviso(
          `Esta minuta estava publicada, então a edição abriu a versão ${corpo.data.novaVersao} como rascunho. A versão publicada continua valendo até você publicar a nova.`,
        );
        await abrir(corpo.data.id);
      } else {
        setAviso("Rascunho salvo.");
      }
    } catch {
      setErro("Falha de rede. Nada foi salvo — não feche a tela.");
    } finally {
      setSalvando(false);
    }
  };

  const publicar = async () => {
    if (!aberta) return;

    if (sujo) {
      setErro("Salve o rascunho antes de publicar: o que está na tela ainda não está gravado.");
      return;
    }

    setSalvando(true);
    setErro(null);
    setAviso(null);

    try {
      const token = await getApoloAccessToken();
      const r = await fetch(`/api/temis/minutas?id=${aberta.id}&acao=publicar`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "PATCH",
      });
      const corpo = (await r.json().catch(() => ({}))) as {
        data?: { arquivadas: number; planosMigrados: number };
        error?: string;
      };

      if (!r.ok) {
        setErro(corpo.error ?? "Não consegui publicar.");
        return;
      }

      const migrados = corpo.data?.planosMigrados ?? 0;
      setAviso(
        migrados > 0
          ? `Minuta publicada. ${migrados} plano(s) que usavam a versão anterior já apontam para esta.`
          : "Minuta publicada. Vincule-a a um plano na aba Planos para que as vendas gerem contrato.",
      );
      setRecarregar((n) => n + 1);
      await abrir(aberta.id);
    } catch {
      setErro("Falha de rede ao publicar.");
    } finally {
      setSalvando(false);
    }
  };

  // A conferência roda sobre o que está NA TELA, e não sobre o que foi salvo: é assim que o aviso
  // aparece enquanto ainda dá para corrigir.
  const conferencia = useMemo(() => {
    const html = documentoParaHtml(documento);
    const { conhecidas, desconhecidas } = classificarVariaveis(html);
    return {
      blocos: conferirBlocos(html),
      conhecidas,
      desconhecidas,
      orfaos: extensosOrfaos(html),
      tamanho: html.length,
    };
  }, [documento]);

  if (erro && !minutas && !aberta) {
    return (
      <p className="m-0 flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {erro}
      </p>
    );
  }

  // ── O EDITOR ─────────────────────────────────────────────────────────────
  if (aberta) {
    const situacao = SITUACOES[aberta.situacao] ?? SITUACOES.rascunho!;

    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <header className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
          <button
            aria-label="Voltar para a lista de minutas"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-subtle text-ink-muted transition-colors hover:text-ink"
            onClick={() => {
              if (sujo && !window.confirm("Há alterações não salvas. Sair mesmo assim?")) return;
              setAberta(null);
              setAviso(null);
              setErro(null);
            }}
            type="button"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
          </button>

          <div className="min-w-0 flex-1">
            <h4 className="m-0 flex flex-wrap items-center gap-2 truncate text-sm font-semibold text-ink">
              {aberta.nome}
              <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${situacao.cor}`}>
                {situacao.rotulo} · v{aberta.versao}
              </span>
              {sujo ? (
                <span className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                  não salvo
                </span>
              ) : null}
            </h4>
            <p className="m-0 truncate text-xs text-ink-muted">
              {conferencia.conhecidas.length} variáveis · {conferencia.tamanho.toLocaleString("pt-BR")}{" "}
              caracteres · salvo em {data(aberta.atualizado_em)}
            </p>
          </div>

          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
            disabled={salvando}
            onClick={() => void salvar()}
            type="button"
          >
            {salvando ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Save aria-hidden="true" className="size-4" />
            )}
            Salvar
          </button>

          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={salvando || conferencia.blocos.length > 0}
            onClick={() => void publicar()}
            title={
              conferencia.blocos.length > 0
                ? "Corrija os blocos condicionais antes de publicar"
                : "Publicar esta versão"
            }
            type="button"
          >
            <Send aria-hidden="true" className="size-4" />
            Publicar
          </button>
        </header>

        {aviso ? <Faixa tom="ok">{aviso}</Faixa> : null}
        {erro ? <Faixa tom="erro">{erro}</Faixa> : null}

        <Conferencia conferencia={conferencia} />

        <EditorDeMinuta
          aoAvisar={(texto) => {
            setAviso(texto);
            setSujo(true);
          }}
          aoMudar={(valor) => {
            setDocumento(valor);
            setSujo(true);
          }}
          // ⚠️ A CHAVE É O ID DA MINUTA. Sem ela, abrir outra minuta reaproveitaria o editor com o
          // documento da anterior — o Plate só lê `valorInicial` na montagem.
          enterpriseId={enterpriseId}
          key={aberta.id}
          valorInicial={documento}
        />
      </div>
    );
  }

  // ── A LISTA ──────────────────────────────────────────────────────────────
  return (
    <div className="grid gap-4 p-5">
      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex items-start gap-3 border-b border-line bg-subtle/40 px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-inverse text-brand-ink">
            <FileText aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h4 className="m-0 text-sm font-semibold text-ink">Minutas de {name}</h4>
            <p className="m-0 mt-0.5 text-xs text-ink-muted">
              O texto do contrato. Suba o arquivo que o loteador entregou, marque onde entram os
              dados do sistema e publique. Quem decide qual minuta a venda usa é o plano de pagamento.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-4 py-3">
          <input
            className="h-9 min-w-64 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-line-strong"
            onChange={(e) => setNomeNovo(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void criar();
            }}
            placeholder="Nome da minuta (ex.: JDG-COMPRA-E-VENDA-NORMAL)"
            value={nomeNovo}
          />
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={criando || !nomeNovo.trim()}
            onClick={() => void criar()}
            type="button"
          >
            {criando ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <Plus aria-hidden="true" className="size-4" />
            )}
            Nova minuta
          </button>
        </div>
      </section>

      {aviso ? <Faixa tom="ok">{aviso}</Faixa> : null}
      {erro ? <Faixa tom="erro">{erro}</Faixa> : null}

      {!minutas ? (
        <p className="m-0 flex items-center gap-2 p-6 text-sm text-ink-muted">
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          Carregando as minutas…
        </p>
      ) : minutas.length === 0 ? (
        <p className="m-0 rounded-2xl border border-dashed border-line bg-subtle/30 px-4 py-8 text-center text-sm text-ink-muted">
          Nenhuma minuta cadastrada em {name}. Dê um nome acima e o editor abre em seguida — lá dentro
          você importa o .docx do loteador.
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-0 overflow-hidden rounded-2xl border border-line bg-surface p-0">
          {minutas.map((m) => {
            const situacao = SITUACOES[m.situacao] ?? SITUACOES.rascunho!;
            const quantas = Array.isArray(m.variaveis) ? m.variaveis.length : 0;

            return (
              <li className="border-b border-line last:border-b-0" key={m.id}>
                <button
                  className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-subtle/50"
                  onClick={() => void abrir(m.id)}
                  type="button"
                >
                  <div className="min-w-0 flex-1">
                    <p className="m-0 flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                      {m.nome}
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${situacao.cor}`}
                      >
                        {situacao.rotulo} · v{m.versao}
                      </span>
                    </p>
                    <p className="m-0 mt-0.5 text-xs text-ink-muted">
                      {quantas > 0 ? `${quantas} variáveis · ` : "sem variáveis marcadas · "}
                      {m.origem_arquivo_nome ? `${m.origem_arquivo_nome} · ` : ""}
                      alterada em {data(m.atualizado_em)}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Faixa({ children, tom }: { children: React.ReactNode; tom: "erro" | "ok" }) {
  const classe =
    tom === "ok"
      ? "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
      : "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200";

  return (
    <p className={`m-0 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${classe}`}>
      {tom === "ok" ? (
        <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      ) : (
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      )}
      {children}
    </p>
  );
}

type Conferido = {
  blocos: { texto: string }[];
  conhecidas: { nome: string; ocorrencias: number }[];
  desconhecidas: { nome: string; ocorrencias: number }[];
  orfaos: string[];
};

/**
 * O que a minuta ainda tem de errado, enquanto dá para corrigir.
 *
 * ⚠️ TRÊS AVISOS, TRÊS ERROS QUE JÁ ACONTECERAM. Bloco mal fechado imprimiu o parágrafo de pessoa
 * jurídica num contrato de pessoa física (Villa Paris). Variável desconhecida sai literal no papel —
 * é o `[Nome]` das minutas antigas. Extenso órfão é sobra de copiar e colar, e some com o número.
 */
function Conferencia({ conferencia }: { conferencia: Conferido }) {
  const limpo =
    conferencia.blocos.length === 0 &&
    conferencia.desconhecidas.length === 0 &&
    conferencia.orfaos.length === 0;

  if (limpo) {
    return (
      <section className="flex items-center gap-2 rounded-xl border border-line bg-subtle/40 px-3 py-2 text-xs text-ink-soft">
        <Check aria-hidden="true" className="size-3.5 shrink-0 text-emerald-600" />
        {conferencia.conhecidas.length} variáveis reconhecidas, blocos fechados corretamente.
        {conferencia.conhecidas.length === 0
          ? " Nenhuma variável ainda: o contrato sairia igual para todo comprador."
          : ""}
      </section>
    );
  }

  return (
    <section className="grid gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      {conferencia.blocos.length > 0 ? (
        <div>
          <p className="m-0 flex items-center gap-1.5 font-semibold">
            <AlertTriangle aria-hidden="true" className="size-3.5" />
            {conferencia.blocos.length} bloco(s) condicional(is) mal fechado(s) — impede publicar
          </p>
          <ul className="m-0 mt-1 grid list-disc gap-0.5 pl-6">
            {conferencia.blocos.slice(0, 5).map((b) => (
              <li key={b.texto}>{b.texto}</li>
            ))}
          </ul>
          <p className="m-0 mt-1 opacity-80">
            É o que faz o contrato imprimir o trecho de pessoa jurídica num comprador pessoa física.
          </p>
        </div>
      ) : null}

      {conferencia.desconhecidas.length > 0 ? (
        <div>
          <p className="m-0 flex items-center gap-1.5 font-semibold">
            <Info aria-hidden="true" className="size-3.5" />
            {conferencia.desconhecidas.length} marcador(es) que o sistema não preenche
          </p>
          <p className="m-0 mt-1">
            {conferencia.desconhecidas
              .slice(0, 8)
              .map((d) => `[${d.nome}]`)
              .join(", ")}{" "}
            — sai impresso assim no contrato. Troque pelo item certo no menu "Inserir variável".
          </p>
        </div>
      ) : null}

      {conferencia.orfaos.length > 0 ? (
        <div>
          <p className="m-0 flex items-center gap-1.5 font-semibold">
            <Info aria-hidden="true" className="size-3.5" />
            {conferencia.orfaos.length} valor(es) por extenso sem o número ao lado
          </p>
          <p className="m-0 mt-1">
            {conferencia.orfaos
              .map((o) => {
                const par = acharVariavel(o)?.extensoDe;
                return par ? `[${o}] sem [${par}]` : `[${o}]`;
              })
              .join(", ")}
            .
          </p>
        </div>
      ) : null}
    </section>
  );
}
