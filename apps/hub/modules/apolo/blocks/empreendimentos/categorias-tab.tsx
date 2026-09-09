"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  FolderTree,
  ListOrdered,
  Loader2,
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { descreverRegra } from "@/lib/assinatura/ordem";
import { PAPEIS, type PapelNoContrato, rotuloDoPapel } from "@/lib/assinatura/tipos";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// AS CATEGORIAS DO EMPREENDIMENTO — o recorte que tem contrato próprio.
//
// Lucas (07/09/2026), definindo o que a categoria é: *"pode ser fase, condomínio e loteamento,
// lotes caucionados, TUDO QUE EU PRECISAR TER UMA MINUTA ESPECÍFICA EU TENHO QUE TER COMO
// CATEGORIA"*. E: *"eu posso criar uma subcategoria da categoria"*, *"isso tem que estar refletido
// no cadastro das unidades"*.
//
// ⚠️ O CRITÉRIO NÃO É GEOGRÁFICO NEM COMERCIAL — É DOCUMENTAL. Perguntado se a motivação era uma ou
// outra, ele respondeu *"pode ser os dois"*. O que define uma categoria não é onde o lote está nem
// para quem ele é vendido: é o fato de aquele conjunto assinar um instrumento diferente.
//
// ⚠️ E É ELA QUE FECHA A CADEIA DO CONTRATO:
//
//     unidade → categoria → planos da categoria → plano da venda → minuta
//
// Sem ela, a regra do Lucas (*"o que define qual minuta usar é o plano de pagamento"*) começava no
// meio da corrente: o plano decidia a minuta, mas nada dizia quais planos valiam para aquele lote.
//
// ⚠️ SEM CATEGORIA É O ESTADO NORMAL, e não cadastro faltando (*"quando eu tiver categorias sim, as
// unidades vão apontar para essa categoria; se eu não tiver, não aponta"*). São 5.540 unidades
// vivas em 36 empreendimentos, e a maioria esmagadora assina a minuta única do produto.

/** Uma ordem já resolvida, do jeito que a rota devolve. */
type Ordem = {
  ordenada: boolean;
  papeis: PapelNoContrato[];
};

type Categoria = {
  categoriaPaiId: null | string;
  id: string;
  nome: string;
  /**
   * A ordem que valeria SEM regra própria — do empreendimento, da categoria mãe, ou o padrão da
   * casa. `null` = a rota não conseguiu apurar (ver `ordemDoEmpreendimento` na rota).
   */
  ordemHerdada: null | (Ordem & { origem: "categoria" | "empreendimento" | "padrao"; rotulo: string });
  /** O que ESTA categoria decide por si. `null` = herda — é o estado das duas que existem hoje. */
  ordemPropria: null | Ordem;
  /** Quantos lotes já apontam para ela. É o que diz se dá para desmontar sem dor. */
  unidades?: number;
};

/** O rascunho do painel de ordem: o que o operador está mexendo antes de salvar. */
type RascunhoDaOrdem = {
  ordenada: boolean;
  papeis: PapelNoContrato[];
  /** `false` = vai voltar a herdar (grava a lista nula). É o lever que chega ao estado "herda". */
  propria: boolean;
};

const frase = (ordem: Ordem): string =>
  descreverRegra({ ordenada: ordem.ordenada, papeis: ordem.papeis }, rotuloDoPapel);

/**
 * De onde vem a ordem herdada, em uma frase.
 *
 * ⚠️ NUNCA DIZ SÓ "SEM ORDEM". A tela precisa nomear a regra que vai valer — do empreendimento, da
 * categoria mãe ou o padrão da casa —, porque campo vazio numa tela de herança é lido como "não há
 * regra", e o operador cadastra uma cópia "por segurança". A partir daí a categoria para de seguir
 * o empreendimento e ninguém percebe: os dois cadastros são iguais no dia em que foram feitos.
 */
const origemDaHeranca = (herdada: NonNullable<Categoria["ordemHerdada"]>): string => {
  if (herdada.origem === "empreendimento") return `Herda de ${herdada.rotulo}`;
  if (herdada.origem === "categoria") return `Herda de "${herdada.rotulo}"`;
  return "Herda o padrão da casa";
};

type Props = {
  /**
   * O código de UMA etapa, quando a ficha é a consolidada.
   *
   * ⚠️ A FICHA CONSOLIDADA NÃO TEM ID DE EMPREENDIMENTO: o Apolo monta a linha do produto agrupado
   * com `id: "group:Lagoa Bonita"`, que é rótulo e não chave. O código é o caminho de volta ao
   * cadastro — e daí ao pai, onde as categorias moram.
   */
  codigo?: null | string;
  enterpriseId: string;
  name: string;
};

export function CategoriasTab({ codigo, enterpriseId, name }: Props) {
  const [categorias, setCategorias] = useState<Categoria[] | null>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [aviso, setAviso] = useState<null | string>(null);
  const [recarregar, setRecarregar] = useState(0);
  /** As divisões do empreendimento discordam entre si? Cada frase é a regra de uma delas. */
  const [divergencia, setDivergencia] = useState<null | string[]>(null);

  /** Qual categoria está com o painel de ordem aberto, e o rascunho dela. */
  const [ordemAberta, setOrdemAberta] = useState<null | string>(null);
  const [rascunho, setRascunho] = useState<null | RascunhoDaOrdem>(null);
  const [salvandoOrdem, setSalvandoOrdem] = useState(false);

  /**
   * ⚠️ TODA CHAMADA LEVA `enterpriseId` E `codigo`. A ficha consolidada manda `group:Lagoa Bonita`,
   * que é rótulo e não chave: é o CÓDIGO que leva ao cadastro e, dele, ao pai onde as categorias
   * moram. Sem os dois, o PATCH e o DELETE não acham a linha e a tela dizia "salvo" à toa.
   */
  const params = (extra?: Record<string, string>) => {
    const qs = new URLSearchParams({ enterpriseId, nome: name });
    if (codigo) qs.set("codigo", codigo);
    for (const [chave, valor] of Object.entries(extra ?? {})) qs.set(chave, valor);
    return qs.toString();
  };

  /** Onde a nova categoria vai nascer: `null` = primeiro nível; um id = subcategoria dele. */
  const [criandoSob, setCriandoSob] = useState<null | string | undefined>(undefined);
  const [nomeNovo, setNomeNovo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [apagando, setApagando] = useState<null | string>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const qs = new URLSearchParams({ enterpriseId, nome: name });
      if (codigo) qs.set("codigo", codigo);
      const token = await getApoloAccessToken();
      const r = await fetch(`/api/temis/categorias?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const corpo = (await r.json().catch(() => ({}))) as {
        data?: { categorias: Categoria[]; divergenciaDoEmpreendimento?: null | string[] };
        error?: string;
      };
      if (!r.ok || !corpo.data) {
        setErro(corpo.error ?? "Não consegui carregar as categorias.");
        setCategorias([]);
        return;
      }
      setCategorias(corpo.data.categorias);
      setDivergencia(corpo.data.divergenciaDoEmpreendimento ?? null);
    } catch {
      setErro("Falha de rede ao carregar as categorias.");
      setCategorias([]);
    }
  }, [codigo, enterpriseId, name]);

  useEffect(() => {
    void carregar();
  }, [carregar, recarregar]);

  const criar = async () => {
    const nome = nomeNovo.trim();
    if (!nome || criandoSob === undefined) return;

    setSalvando(true);
    setErro(null);
    setAviso(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(`/api/temis/categorias?${params()}`, {
        body: JSON.stringify({ categoriaPaiId: criandoSob, nome }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const corpo = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setErro(corpo.error ?? "Não consegui criar a categoria.");
        return;
      }
      setNomeNovo("");
      setCriandoSob(undefined);
      setAviso(`Categoria "${nome}" criada.`);
      setRecarregar((n) => n + 1);
    } catch {
      setErro("Falha de rede ao criar a categoria.");
    } finally {
      setSalvando(false);
    }
  };

  const apagar = async (categoria: Categoria) => {
    const lotes = categoria.unidades ?? 0;
    const pergunta =
      lotes > 0
        ? `"${categoria.nome}" tem ${lotes === 1 ? "1 lote" : `${lotes} lotes`}. Eles voltam a seguir a regra geral do empreendimento. Excluir?`
        : `Excluir a categoria "${categoria.nome}"?`;
    if (!window.confirm(pergunta)) return;

    setApagando(categoria.id);
    setErro(null);
    setAviso(null);
    try {
      const token = await getApoloAccessToken();
      // ⚠️ O `enterpriseId` VOLTOU PARA A URL: a rota exige empreendimento E id, e esta chamada
      // mandava só o id — todo clique em "Excluir" voltava 400 ("Informe o empreendimento e a
      // categoria."), nenhuma categoria era apagada pela tela.
      const r = await fetch(`/api/temis/categorias?${params({ id: categoria.id })}`, {
        headers: { Authorization: `Bearer ${token}` },
        method: "DELETE",
      });
      const corpo = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setErro(corpo.error ?? "Não consegui excluir a categoria.");
        return;
      }
      setAviso(`"${categoria.nome}" foi excluída.`);
      setRecarregar((n) => n + 1);
    } catch {
      setErro("Falha de rede ao excluir a categoria.");
    } finally {
      setApagando(null);
    }
  };

  /**
   * Abre o painel da ordem.
   *
   * ⚠️ O RASCUNHO NASCE DA HERDADA quando a categoria não tem regra própria — e não de uma lista em
   * branco. Quem liga "ordem própria" costuma querer MUDAR uma coisa na ordem que já vale, não
   * montar tudo do zero; começar do vazio faria a primeira gravação ser uma ordem que ninguém
   * comparou com a que estava valendo.
   */
  const abrirOrdem = (categoria: Categoria) => {
    setErro(null);
    setAviso(null);
    if (ordemAberta === categoria.id) {
      setOrdemAberta(null);
      setRascunho(null);
      return;
    }
    const base = categoria.ordemPropria ?? categoria.ordemHerdada;
    setOrdemAberta(categoria.id);
    setRascunho({
      ordenada: base?.ordenada ?? false,
      papeis: [...(base?.papeis ?? PAPEIS)],
      propria: categoria.ordemPropria !== null,
    });
  };

  const mover = (indice: number, passo: -1 | 1) => {
    setRascunho((atual) => {
      if (!atual) return atual;
      const destino = indice + passo;
      if (destino < 0 || destino >= atual.papeis.length) return atual;
      const papeis = [...atual.papeis];
      const daqui = papeis[indice];
      const dali = papeis[destino];
      if (!daqui || !dali) return atual;
      papeis[indice] = dali;
      papeis[destino] = daqui;
      return { ...atual, papeis };
    });
  };

  /**
   * Grava o par.
   *
   * ⚠️ "VOLTAR A HERDAR" MANDA A LISTA NULA, e não uma lista vazia. Nulo é o estado "herda" no
   * banco; `[]` seria uma regra própria que não ordena nada — a categoria pararia de seguir o
   * empreendimento sem ninguém ter pedido, e a tela mostraria a mesma coisa nos dois casos.
   */
  const salvarOrdem = async (categoria: Categoria) => {
    if (!rascunho) return;

    setSalvandoOrdem(true);
    setErro(null);
    setAviso(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(`/api/temis/categorias?${params({ id: categoria.id })}`, {
        body: JSON.stringify(
          rascunho.propria
            ? { assinaturaOrdem: rascunho.papeis, assinaturaOrdenada: rascunho.ordenada }
            : { assinaturaOrdem: null, assinaturaOrdenada: false },
        ),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "PATCH",
      });
      const corpo = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) {
        setErro(corpo.error ?? "Não consegui salvar a ordem de assinatura.");
        return;
      }
      setAviso(
        rascunho.propria
          ? `"${categoria.nome}" passou a ter ordem própria.`
          : `"${categoria.nome}" voltou a herdar a ordem do empreendimento.`,
      );
      setOrdemAberta(null);
      setRascunho(null);
      setRecarregar((n) => n + 1);
    } catch {
      setErro("Falha de rede ao salvar a ordem de assinatura.");
    } finally {
      setSalvandoOrdem(false);
    }
  };

  const filhasDe = (paiId: null | string) =>
    (categorias ?? []).filter((c) => c.categoriaPaiId === paiId);

  /**
   * O painel da ordem de assinatura de uma categoria.
   *
   * ⚠️ A HERDADA FICA NO TOPO, SEMPRE — inclusive quando a categoria já tem ordem própria. É ela
   * que diz o que a regra própria está sobrepondo e para onde a categoria volta se for limpa; sem
   * isso, "voltar a herdar" é um botão que ninguém sabe para onde leva.
   */
  const painelDaOrdem = (categoria: Categoria) => {
    if (!rascunho) return null;
    const herdada = categoria.ordemHerdada;

    return (
      <div className="grid gap-3 rounded-xl border border-line bg-subtle/30 px-3 py-3">
        {herdada ? (
          <p className="m-0 text-xs text-ink-muted">
            <span className="font-semibold text-ink">{origemDaHeranca(herdada)}:</span>{" "}
            {frase(herdada)}
          </p>
        ) : (
          <p className="m-0 text-xs text-amber-800 dark:text-amber-200">
            Não consegui ler a ordem cadastrada no empreendimento agora. Recarregue antes de
            cadastrar uma ordem aqui, para não sobrepor sem saber o que está sobrepondo.
          </p>
        )}

        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            checked={rascunho.propria}
            className="mt-0.5 size-4 accent-current"
            onChange={(e) => setRascunho({ ...rascunho, propria: e.target.checked })}
            type="checkbox"
          />
          <span>
            Esta categoria tem ordem própria
            <span className="block text-xs font-normal text-ink-muted">
              Sobrepõe o que vem de cima. Desmarcado, ela volta a herdar.
            </span>
          </span>
        </label>

        {rascunho.propria ? (
          <>
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                checked={rascunho.ordenada}
                className="mt-0.5 size-4 accent-current"
                onChange={(e) => setRascunho({ ...rascunho, ordenada: e.target.checked })}
                type="checkbox"
              />
              <span>
                Assinam em ordem
                <span className="block text-xs font-normal text-ink-muted">
                  Desmarcado, todos assinam ao mesmo tempo — que é como sai a maioria dos contratos
                  hoje.
                </span>
              </span>
            </label>

            <div
              className={`grid gap-1 ${rascunho.ordenada ? "" : "pointer-events-none opacity-40"}`}
            >
              {rascunho.papeis.map((papel, indice) => (
                <div
                  className="flex items-center gap-2 rounded-lg border border-line bg-surface px-2 py-1.5"
                  key={papel}
                >
                  <span className="w-5 shrink-0 text-center text-xs font-semibold text-ink-muted">
                    {indice + 1}
                  </span>
                  <span className="text-sm text-ink">{rotuloDoPapel(papel)}</span>
                  <div className="ml-auto flex shrink-0 items-center gap-1">
                    <button
                      aria-label={`Subir ${rotuloDoPapel(papel)}`}
                      className="inline-flex size-7 items-center justify-center rounded-md border border-line text-ink-muted transition-colors hover:bg-subtle disabled:opacity-30"
                      disabled={indice === 0}
                      onClick={() => mover(indice, -1)}
                      type="button"
                    >
                      <ArrowUp aria-hidden="true" className="size-3.5" />
                    </button>
                    <button
                      aria-label={`Descer ${rotuloDoPapel(papel)}`}
                      className="inline-flex size-7 items-center justify-center rounded-md border border-line text-ink-muted transition-colors hover:bg-subtle disabled:opacity-30"
                      disabled={indice === rascunho.papeis.length - 1}
                      onClick={() => mover(indice, 1)}
                      type="button"
                    >
                      <ArrowDown aria-hidden="true" className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/*
              ⚠️ NÃO HÁ COMO REMOVER UM PAPEL DA LISTA, e não é lacuna: "papel ausente assina por
              último" é a regra do banco, então tirar um papel dá no mesmo que empurrá-lo para o
              fim. Um botão de remover criaria dois jeitos de dizer a mesma coisa — e um deles
              (lista de um papel só) fica perto demais da lista vazia, que o banco recusa.
            */}
            <p className="m-0 text-xs text-ink-muted">
              Quem não assina o contrato simplesmente não entra na conta: os presentes assumem 1, 2,
              3 na ordem acima, e quem divide posição assina ao mesmo tempo.
            </p>
          </>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-inverse px-4 text-xs font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:opacity-40"
            disabled={salvandoOrdem}
            onClick={() => void salvarOrdem(categoria)}
            type="button"
          >
            {salvandoOrdem ? <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> : null}
            Salvar ordem
          </button>
          {categoria.ordemPropria && rascunho.propria ? (
            <button
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:bg-subtle"
              onClick={() => setRascunho({ ...rascunho, propria: false })}
              type="button"
            >
              <Undo2 aria-hidden="true" className="size-3.5" />
              Voltar a herdar
            </button>
          ) : null}
          <button
            className="inline-flex h-8 items-center rounded-lg border border-line bg-surface px-3 text-xs text-ink-muted transition-colors hover:bg-subtle"
            onClick={() => {
              setOrdemAberta(null);
              setRascunho(null);
            }}
            type="button"
          >
            Cancelar
          </button>
        </div>
      </div>
    );
  };

  const campoNovo = (sob: null | string) => (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <input
        autoFocus
        className="h-9 min-w-56 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-line-strong"
        onChange={(e) => setNomeNovo(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void criar();
          if (e.key === "Escape") setCriandoSob(undefined);
        }}
        placeholder={sob ? "Nome da subcategoria (ex.: Fase 1)" : "Nome da categoria (ex.: Lotes caucionados)"}
        value={nomeNovo}
      />
      <button
        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:opacity-40"
        disabled={salvando || !nomeNovo.trim()}
        onClick={() => void criar()}
        type="button"
      >
        {salvando ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
        Criar
      </button>
      <button
        className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-3 text-sm text-ink-muted transition-colors hover:bg-subtle"
        onClick={() => setCriandoSob(undefined)}
        type="button"
      >
        Cancelar
      </button>
    </div>
  );

  /**
   * ⚠️ A ÁRVORE SE DESENHA SOZINHA, e a profundidade é do negócio: condomínio dentro de loteamento,
   * fase dentro de condomínio, caucionados dentro da fase. Limitar em dois níveis obrigaria o Lucas
   * a inventar nome composto no dia em que precisasse do terceiro.
   */
  const ramo = (categoria: Categoria, nivel: number) => (
    <div key={categoria.id}>
      <div
        className="flex flex-wrap items-center gap-2 border-b border-line/70 py-2 last:border-b-0"
        style={{ paddingLeft: nivel * 20 }}
      >
        {nivel > 0 ? (
          <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted" />
        ) : null}
        <span className="text-sm font-semibold text-ink">{categoria.nome}</span>
        {categoria.unidades ? (
          <span className="rounded-md bg-subtle px-1.5 py-0.5 text-[10px] font-semibold text-ink-soft">
            {categoria.unidades === 1 ? "1 lote" : `${categoria.unidades} lotes`}
          </span>
        ) : null}

        {/*
          ⚠️ O SELO DIZ SE A ORDEM É PRÓPRIA OU HERDADA SEM ABRIR NADA. Numa árvore de recortes, o
          que interessa de relance é quem saiu da regra do empreendimento — e isso é invisível se a
          diferença só aparece dentro do painel.
        */}
        <span
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
            categoria.ordemPropria
              ? "bg-inverse/10 text-ink"
              : "border border-line text-ink-muted"
          }`}
          title={
            categoria.ordemPropria
              ? frase(categoria.ordemPropria)
              : categoria.ordemHerdada
                ? frase(categoria.ordemHerdada)
                : undefined
          }
        >
          {categoria.ordemPropria
            ? "Ordem própria"
            : categoria.ordemHerdada
              ? origemDaHeranca(categoria.ordemHerdada)
              : "Ordem não apurada"}
        </span>

        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:bg-subtle"
            onClick={() => abrirOrdem(categoria)}
            type="button"
          >
            <ListOrdered aria-hidden="true" className="size-3.5" />
            Ordem de assinatura
          </button>
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:bg-subtle"
            onClick={() => {
              setNomeNovo("");
              setCriandoSob(categoria.id);
            }}
            type="button"
          >
            <Plus aria-hidden="true" className="size-3.5" />
            Subcategoria
          </button>
          <button
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 disabled:opacity-40 dark:text-rose-300 dark:hover:bg-rose-500/10"
            disabled={apagando === categoria.id}
            onClick={() => void apagar(categoria)}
            type="button"
          >
            {apagando === categoria.id ? (
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" className="size-3.5" />
            )}
            Excluir
          </button>
        </div>
      </div>

      {ordemAberta === categoria.id ? (
        <div className="pb-3" style={{ paddingLeft: (nivel + 1) * 20 }}>
          {painelDaOrdem(categoria)}
        </div>
      ) : null}

      {criandoSob === categoria.id ? (
        <div style={{ paddingLeft: (nivel + 1) * 20 }}>{campoNovo(categoria.id)}</div>
      ) : null}

      {filhasDe(categoria.id).map((filha) => ramo(filha, nivel + 1))}
    </div>
  );

  return (
    <div className="grid gap-4 p-5">
      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-subtle/40 px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-inverse text-brand-ink">
              <FolderTree aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0">
              <h4 className="m-0 text-sm font-semibold text-ink">Categorias de {name}</h4>
              <p className="m-0 mt-0.5 text-xs text-ink-muted">
                Todo recorte do empreendimento que assina um contrato diferente — fase, condomínio,
                loteamento, lotes caucionados. É a categoria que decide quais planos valem para o
                lote, e o plano decide a minuta. A ordem de assinatura vem do empreendimento; a
                categoria só precisa cadastrar a sua quando ela assina em outra ordem.
              </p>
            </div>
          </div>
          <button
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90"
            onClick={() => {
              setNomeNovo("");
              setCriandoSob(null);
            }}
            type="button"
          >
            <Plus aria-hidden="true" className="size-4" />
            Nova categoria
          </button>
        </div>

        <div className="px-4 py-3">
          {/*
            ⚠️ A DIVERGÊNCIA É AVISADA, E NÃO RESOLVIDA NO CHUTE. A categoria atravessa as divisões
            do empreendimento ("é tudo junto"), então com LBF numa ordem e LBP em outra não existe
            resposta certa para "o que a categoria herda" — e uma resposta escolhida no silêncio é
            pior que a pergunta, porque some da tela.
          */}
          {divergencia ? (
            <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <p className="m-0 font-semibold">
                As divisões deste empreendimento têm ordens de assinatura diferentes.
              </p>
              <ul className="m-0 mt-1 list-disc pl-4">
                {divergencia.map((linha) => (
                  <li key={linha}>{linha}</li>
                ))}
              </ul>
              <p className="m-0 mt-1">
                As categorias valem para todas as divisões: acerte no Setup do empreendimento, ou dê
                ordem própria à categoria.
              </p>
            </div>
          ) : null}

          {criandoSob === null ? campoNovo(null) : null}

          {!categorias ? (
            <p className="m-0 flex items-center gap-2 py-4 text-sm text-ink-muted">
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              Carregando…
            </p>
          ) : categorias.length === 0 ? (
            <p className="m-0 py-4 text-sm text-ink-muted">
              Nenhuma categoria em {name}. Sem categoria, todos os lotes seguem a mesma minuta do
              produto — que é o caso da maioria dos empreendimentos.
            </p>
          ) : (
            <div className="grid">{filhasDe(null).map((c) => ramo(c, 0))}</div>
          )}
        </div>
      </section>

      {aviso ? (
        <p className="m-0 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
          {aviso}
        </p>
      ) : null}
      {erro ? (
        <p className="m-0 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
