"use client";

import {
  AlertTriangle,
  Check,
  FileText,
  Info,
  Loader2,
  Pencil,
  Plus,
  Power,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { calcularParcela } from "@/lib/apolo/planos-comerciais";
import {
  type CategoriaDoTemis,
  conferirPlano,
  type EntradaDePlano,
  paraCalculo,
  type PlanoDoTemis,
  rotuloDoIndice,
  rotuloDoSistema,
  rotuloDoSlot,
  separarPorProntidao,
} from "@/lib/temis/planos";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// ABA PLANOS — o cadastro que decide o contrato.
//
// Pedido do Lucas (01/09/2026): *"cria já a tela dentro do empreendimento dos planos comerciais"*,
// *"vamos fazer tudo no panteon, vou cadastrar os planos dentro do panteon"*, *"esquece c2x"*.
//
// A cadeia que ele desenhou é `empreendimento → categoria → plano → minuta`, e a decisão final é do
// plano: *"o que define qual minuta usar é o plano de pagamento. na prática é a unidade x foi
// vendida no plano a, ae o contrato que vai ser gerado é do plano"*. Por isso esta tela não é um
// formulário qualquer: é onde se define, para cada jeito de pagar, QUAL papel o cliente assina.
//
// ⚠️ A SIMULAÇÃO NÃO É ENFEITE. Ela existe porque o erro mais provável aqui é digitar 0,20 achando
// que é 20% de entrada — um erro que não parece erro na tela e só aparece no contrato assinado. Com
// o preço de uma unidade ao lado, "entrada de R$ 37.080,00" é conferível de relance; "0,2" não é.
//
// ⚠️ PLANO SEM MINUTA APARECE EM DESTAQUE. É um plano que vende e trava no último passo: a venda
// acontece, o contrato não sai. Melhor o operador descobrir no cadastro que na hora de gerar.

type Props = {
  enterpriseId: string;
  name: string;
};

type MinutaResumida = {
  id: string;
  nome: string;
  publicada: boolean;
  versao: number;
};

type Carga = {
  categorias: CategoriaDoTemis[];
  minutas: MinutaResumida[];
  planos: PlanoDoTemis[];
};

type Rascunho = EntradaDePlano & { id?: string };

const INDICES: { rotulo: string; valor: string }[] = [
  { rotulo: "Sem correção", valor: "SEM_CORRECAO" },
  { rotulo: "IPCA anual", valor: "IPCA_ANUAL" },
  { rotulo: "IPCA mensal", valor: "IPCA_MENSAL" },
  { rotulo: "IGP-M anual", valor: "IGPM_ANUAL" },
  { rotulo: "INCC-M mensal", valor: "INCC_M_MENSAL" },
];

const SISTEMAS: { rotulo: string; valor: string }[] = [
  { rotulo: "SACOC — amortização pura", valor: "sacoc" },
  { rotulo: "Price — parcela fixa", valor: "price" },
  { rotulo: "SAC — parcela decrescente", valor: "sac" },
];

const SLOTS: { rotulo: string; valor: string }[] = [
  { rotulo: "Não vai à proposta", valor: "" },
  { rotulo: "À vista", valor: "avista" },
  { rotulo: "Investidor", valor: "investidor" },
  { rotulo: "Curto", valor: "curto" },
  { rotulo: "Normal", valor: "normal" },
];

const PLANO_NOVO: Rascunho = {
  categoriaId: null,
  entradaPercentual: 20,
  indiceCorrecao: "IPCA_ANUAL",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  jurosTaxa: null,
  minutaId: null,
  nome: "",
  observacao: null,
  parcelas: 120,
  sistemaAmortizacao: "sacoc",
  slot: null,
};

const dinheiro = (v: null | number): string =>
  v === null ? "—" : v.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });

/** Texto do campo → número. Aceita a vírgula que o operador digita. */
function paraNumero(texto: string): null | number {
  const limpo = texto.trim().replace(/\./g, "").replace(",", ".");
  if (limpo === "") return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

/** Número → texto do campo, na vírgula do português. */
function paraTexto(valor: null | number | undefined): string {
  if (valor === null || valor === undefined) return "";
  return String(valor).replace(".", ",");
}

/** Monta um `PlanoDoTemis` a partir do rascunho, só para a prévia do cálculo. */
function planoDaPrevia(rascunho: Rascunho, entrada: null | number, juros: null | number): PlanoDoTemis {
  return {
    ativo: true,
    categoriaId: null,
    categoriaNome: null,
    criadoEm: "",
    entradaPercentual: entrada ?? 0,
    id: "",
    indiceCorrecao: rascunho.indiceCorrecao,
    jurosConvencao: rascunho.jurosConvencao ?? "equivalente",
    jurosPeriodicidade: rascunho.jurosPeriodicidade ?? "anual",
    jurosTaxa: juros,
    minutaId: null,
    minutaNome: null,
    nome: rascunho.nome,
    observacao: null,
    ordem: 0,
    parcelas: rascunho.parcelas,
    sistemaAmortizacao: rascunho.sistemaAmortizacao,
    slot: rascunho.slot ?? null,
  };
}

export function PlanosComerciaisTab({ enterpriseId, name }: Props) {
  const [carga, setCarga] = useState<Carga | null>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [aviso, setAviso] = useState<null | string>(null);
  const [recarregar, setRecarregar] = useState(0);

  const [rascunho, setRascunho] = useState<null | Rascunho>(null);
  const [salvando, setSalvando] = useState(false);
  const [problemas, setProblemas] = useState<string[]>([]);

  // Campos que aceitam vírgula ficam como TEXTO. Convertê-los a cada tecla reescreveria o campo
  // embaixo do dedo de quem está digitando "12,".
  const [entradaTexto, setEntradaTexto] = useState("20");
  const [jurosTexto, setJurosTexto] = useState("");

  // Preço da conferência. Começa vazio: um valor sugerido viraria número que ninguém escolheu.
  const [precoSimulado, setPrecoSimulado] = useState("");

  const [categoriaNova, setCategoriaNova] = useState("");
  const [criandoCategoria, setCriandoCategoria] = useState(false);

  useEffect(() => {
    let vivo = true;
    setCarga(null);
    setErro(null);

    void (async () => {
      try {
        const token = await getApoloAccessToken();
        const resposta = await fetch(
          `/api/temis/planos?enterpriseId=${encodeURIComponent(enterpriseId)}`,
          { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
        );
        const corpo = (await resposta.json().catch(() => ({}))) as {
          data?: Carga;
          error?: string;
        };

        if (!vivo) return;

        // ⚠️ FALHA FECHADA, igual à aba de política. Cair para lista vazia faria a tela dizer "este
        // empreendimento não tem plano" a partir de um timeout — e o operador cadastraria tudo de
        // novo por cima do que já existe.
        if (!resposta.ok || !corpo.data) {
          setErro(corpo.error ?? "Não foi possível carregar os planos.");
          return;
        }
        setCarga(corpo.data);
      } catch {
        if (vivo) setErro("Falha ao carregar os planos deste empreendimento.");
      }
    })();

    return () => {
      vivo = false;
    };
  }, [enterpriseId, recarregar]);

  const abrirNovo = useCallback((categoriaId: null | string) => {
    setRascunho({ ...PLANO_NOVO, categoriaId });
    setEntradaTexto("20");
    setJurosTexto("");
    setProblemas([]);
    setAviso(null);
    setErro(null);
  }, []);

  const abrirEdicao = useCallback((plano: PlanoDoTemis) => {
    setRascunho({
      ativo: plano.ativo,
      categoriaId: plano.categoriaId,
      entradaPercentual: plano.entradaPercentual,
      id: plano.id,
      indiceCorrecao: plano.indiceCorrecao,
      jurosConvencao: plano.jurosConvencao,
      jurosPeriodicidade: plano.jurosPeriodicidade,
      jurosTaxa: plano.jurosTaxa,
      minutaId: plano.minutaId,
      nome: plano.nome,
      observacao: plano.observacao,
      ordem: plano.ordem,
      parcelas: plano.parcelas,
      sistemaAmortizacao: plano.sistemaAmortizacao,
      slot: plano.slot,
    });
    setEntradaTexto(paraTexto(plano.entradaPercentual));
    setJurosTexto(paraTexto(plano.jurosTaxa));
    setProblemas([]);
    setAviso(null);
    setErro(null);
  }, []);

  const salvar = async () => {
    if (!rascunho) return;

    const entrada: EntradaDePlano = {
      ...rascunho,
      entradaPercentual: paraNumero(entradaTexto) ?? 0,
      jurosTaxa: paraNumero(jurosTexto),
    };

    // Confere no navegador ANTES de mandar, com a MESMA função que o servidor usa. O operador vê
    // todos os problemas de uma vez em vez de descobrir um por tentativa.
    const achados = conferirPlano(entrada);
    if (achados.length) {
      setProblemas(achados);
      return;
    }

    setSalvando(true);
    setProblemas([]);
    setErro(null);
    setAviso(null);

    try {
      const token = await getApoloAccessToken();
      const base = `/api/temis/planos?enterpriseId=${encodeURIComponent(enterpriseId)}`;
      const resposta = await fetch(rascunho.id ? `${base}&id=${rascunho.id}` : base, {
        body: JSON.stringify(entrada),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: rascunho.id ? "PATCH" : "POST",
      });
      const corpo = (await resposta.json().catch(() => ({}))) as { error?: string };

      if (!resposta.ok) {
        setProblemas([corpo.error ?? "Não foi possível salvar o plano."]);
        return;
      }

      setAviso(rascunho.id ? "Plano salvo." : `Plano "${entrada.nome.trim()}" criado.`);
      setRascunho(null);
      setRecarregar((n) => n + 1);
    } catch {
      setProblemas(["Falha de rede. Recarregue a tela para conferir o que foi salvo."]);
    } finally {
      setSalvando(false);
    }
  };

  /**
   * Liga ou desliga o plano.
   *
   * ⚠️ NÃO APAGA, e isso é regra do módulo: um plano que já vendeu explica um contrato assinado.
   * Desativado, ele some da venda e libera a posição na proposta, mas continua respondendo de onde
   * veio o contrato de quem comprou nele.
   */
  const alternarAtivo = async (plano: PlanoDoTemis) => {
    setSalvando(true);
    setErro(null);
    setAviso(null);

    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch(
        `/api/temis/planos?enterpriseId=${encodeURIComponent(enterpriseId)}&id=${plano.id}`,
        {
          body: JSON.stringify({
            ativo: !plano.ativo,
            categoriaId: plano.categoriaId,
            entradaPercentual: plano.entradaPercentual,
            indiceCorrecao: plano.indiceCorrecao,
            jurosConvencao: plano.jurosConvencao,
            jurosPeriodicidade: plano.jurosPeriodicidade,
            jurosTaxa: plano.jurosTaxa,
            minutaId: plano.minutaId,
            nome: plano.nome,
            observacao: plano.observacao,
            ordem: plano.ordem,
            parcelas: plano.parcelas,
            sistemaAmortizacao: plano.sistemaAmortizacao,
            slot: plano.slot,
          }),
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          method: "PATCH",
        },
      );
      const corpo = (await resposta.json().catch(() => ({}))) as { error?: string };

      if (!resposta.ok) {
        setErro(corpo.error ?? "Não foi possível mudar a situação do plano.");
        return;
      }
      setAviso(
        plano.ativo
          ? `"${plano.nome}" desativado: sai da venda, mas continua explicando os contratos já feitos nele.`
          : `"${plano.nome}" reativado.`,
      );
      setRecarregar((n) => n + 1);
    } catch {
      setErro("Falha de rede. Recarregue a tela para conferir.");
    } finally {
      setSalvando(false);
    }
  };

  const criarCategoria = async () => {
    const nome = categoriaNova.trim();
    if (!nome) return;

    setCriandoCategoria(true);
    setErro(null);
    setAviso(null);

    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch(
        `/api/temis/categorias?enterpriseId=${encodeURIComponent(enterpriseId)}`,
        {
          body: JSON.stringify({ nome }),
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          method: "POST",
        },
      );
      const corpo = (await resposta.json().catch(() => ({}))) as { error?: string };

      if (!resposta.ok) {
        setErro(corpo.error ?? "Não foi possível criar a categoria.");
        return;
      }
      setCategoriaNova("");
      setAviso(`Categoria "${nome}" criada.`);
      setRecarregar((n) => n + 1);
    } catch {
      setErro("Falha de rede ao criar a categoria.");
    } finally {
      setCriandoCategoria(false);
    }
  };

  const prontidao = useMemo(() => separarPorProntidao(carga?.planos ?? []), [carga]);

  if (erro && !carga) {
    return (
      <p className="m-0 flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {erro}
      </p>
    );
  }

  if (!carga) {
    return (
      <p className="m-0 flex items-center gap-2 p-6 text-sm text-ink-muted">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        Carregando os planos de pagamento…
      </p>
    );
  }

  // Os planos que não pendem de categoria nenhuma. É o caso comum: o ACP tem três planos e uma
  // minuta só, e não precisa de subdivisão.
  const semCategoria = carga.planos.filter((p) => !p.categoriaId);
  const preco = paraNumero(precoSimulado);

  return (
    <div className="grid gap-4 p-5">
      {/* ── O QUE ESTE EMPREENDIMENTO CONSEGUE VENDER HOJE ───────────────── */}
      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-subtle/40 px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-inverse text-brand-ink">
              <FileText aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0">
              <h4 className="m-0 text-sm font-semibold text-ink">Planos de pagamento</h4>
              <p className="m-0 mt-0.5 text-xs text-ink-muted">
                Cada plano diz como o cliente paga e QUAL minuta ele assina. É o plano da venda que
                define o contrato gerado — por isso plano sem minuta trava a venda no último passo.
              </p>
            </div>
          </div>
          <button
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90"
            onClick={() => abrirNovo(null)}
            type="button"
          >
            <Plus aria-hidden="true" className="size-4" />
            Novo plano
          </button>
        </div>

        <div className="grid gap-2 px-4 py-3 sm:grid-cols-3">
          <Numero hint="prontos para gerar contrato" tom="ok" valor={prontidao.prontos.length} />
          <Numero
            hint="ativos sem minuta vinculada"
            tom={prontidao.semMinuta.length > 0 ? "alerta" : "neutro"}
            valor={prontidao.semMinuta.length}
          />
          <Numero
            hint="minutas disponíveis aqui"
            tom={carga.minutas.length === 0 ? "alerta" : "neutro"}
            valor={carga.minutas.length}
          />
        </div>

        {carga.minutas.length === 0 ? (
          <p className="m-0 mx-4 mb-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            Nenhuma minuta cadastrada em {name} ainda. Os planos podem ser criados agora e a minuta
            vinculada depois — mas até lá o contrato não é gerado.
          </p>
        ) : null}
      </section>

      {aviso ? (
        <p className="m-0 flex items-start gap-2 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
          <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {aviso}
        </p>
      ) : null}

      {erro ? (
        <p className="m-0 flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {erro}
        </p>
      ) : null}

      {/* ── O FORMULÁRIO ─────────────────────────────────────────────────── */}
      {rascunho ? (
        <Formulario
          aoCancelar={() => setRascunho(null)}
          aoMudar={setRascunho}
          aoSalvar={() => void salvar()}
          categorias={carga.categorias}
          entradaTexto={entradaTexto}
          jurosTexto={jurosTexto}
          minutas={carga.minutas}
          mudarEntrada={setEntradaTexto}
          mudarJuros={setJurosTexto}
          mudarPreco={setPrecoSimulado}
          preco={preco}
          precoTexto={precoSimulado}
          problemas={problemas}
          rascunho={rascunho}
          salvando={salvando}
        />
      ) : null}

      {/* ── AS CATEGORIAS E SEUS PLANOS ──────────────────────────────────── */}
      {carga.categorias.map((categoria) => (
        <GrupoDePlanos
          aoDesativar={(p) => void alternarAtivo(p)}
          aoEditar={abrirEdicao}
          aoNovo={() => abrirNovo(categoria.id)}
          key={categoria.id}
          planos={carga.planos.filter((p) => p.categoriaId === categoria.id)}
          preco={preco}
          salvando={salvando}
          titulo={categoria.nome}
        />
      ))}

      {semCategoria.length > 0 || carga.categorias.length === 0 ? (
        <GrupoDePlanos
          aoDesativar={(p) => void alternarAtivo(p)}
          aoEditar={abrirEdicao}
          aoNovo={() => abrirNovo(null)}
          planos={semCategoria}
          preco={preco}
          salvando={salvando}
          titulo={carga.categorias.length === 0 ? "Planos" : "Sem categoria"}
        />
      ) : null}

      {/* ── CATEGORIA NOVA ───────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-dashed border-line bg-subtle/30 px-4 py-3">
        <p className="m-0 mb-2 text-xs text-ink-muted">
          Categorias separam planos que atendem públicos diferentes dentro do mesmo empreendimento —
          é o caso do JDG, com planos internos e externos e uma minuta para cada.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="h-9 min-w-56 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-line-strong"
            onChange={(e) => setCategoriaNova(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void criarCategoria();
            }}
            placeholder="Nome da categoria (ex.: Externa)"
            value={categoriaNova}
          />
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
            disabled={criandoCategoria || !categoriaNova.trim()}
            onClick={() => void criarCategoria()}
            type="button"
          >
            {criandoCategoria ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            Criar categoria
          </button>
        </div>
      </section>
    </div>
  );
}

function Numero({
  hint,
  tom,
  valor,
}: {
  hint: string;
  tom: "alerta" | "neutro" | "ok";
  valor: number;
}) {
  const cor =
    tom === "ok"
      ? "text-emerald-700 dark:text-emerald-300"
      : tom === "alerta"
        ? "text-amber-700 dark:text-amber-300"
        : "text-ink";

  return (
    <div className="rounded-xl border border-line bg-subtle/40 px-3 py-2.5">
      <p className={`m-0 text-xl font-semibold tabular-nums ${cor}`}>{valor}</p>
      <p className="m-0 mt-0.5 text-[11px] text-ink-muted">{hint}</p>
    </div>
  );
}

function GrupoDePlanos({
  aoDesativar,
  aoEditar,
  aoNovo,
  planos,
  preco,
  salvando,
  titulo,
}: {
  aoDesativar: (plano: PlanoDoTemis) => void;
  aoEditar: (plano: PlanoDoTemis) => void;
  aoNovo: () => void;
  planos: PlanoDoTemis[];
  preco: null | number;
  salvando: boolean;
  titulo: string;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-subtle/40 px-4 py-2.5">
        <h5 className="m-0 text-xs font-semibold uppercase tracking-wide text-ink-soft">
          {titulo}
          <span className="ml-2 font-normal normal-case text-ink-muted">
            {planos.length === 0
              ? "nenhum plano"
              : planos.length === 1
                ? "1 plano"
                : `${planos.length} planos`}
          </span>
        </h5>
        <button
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-xs font-semibold text-ink transition-colors hover:bg-subtle"
          onClick={aoNovo}
          type="button"
        >
          <Plus aria-hidden="true" className="size-3.5" />
          Plano
        </button>
      </div>

      {planos.length === 0 ? (
        <p className="m-0 px-4 py-5 text-sm text-ink-muted">Nada cadastrado aqui ainda.</p>
      ) : (
        <ul className="m-0 grid list-none gap-0 p-0">
          {planos.map((plano) => (
            <LinhaDoPlano
              aoDesativar={() => aoDesativar(plano)}
              aoEditar={() => aoEditar(plano)}
              key={plano.id}
              plano={plano}
              preco={preco}
              salvando={salvando}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function LinhaDoPlano({
  aoDesativar,
  aoEditar,
  plano,
  preco,
  salvando,
}: {
  aoDesativar: () => void;
  aoEditar: () => void;
  plano: PlanoDoTemis;
  preco: null | number;
  salvando: boolean;
}) {
  // ⚠️ O CÁLCULO PASSA POR `paraCalculo` DE PROPÓSITO. É o módulo com 27 testes medidos contra nove
  // empreendimentos reais que decide sinal e parcela; recalcular aqui na mão criaria um segundo
  // número, e a tela e o contrato passariam a discordar sem ninguém perceber.
  const simulado = preco === null ? null : calcularParcela(paraCalculo(plano), preco);

  return (
    <li
      className={`grid gap-2 border-b border-line px-4 py-3 last:border-b-0 ${
        plano.ativo ? "" : "opacity-55"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="m-0 flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
            {plano.nome}
            {plano.slot ? (
              <span className="rounded-md bg-[#A07C3B]/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#7A5E2C] dark:text-[#D2AE72]">
                {rotuloDoSlot(plano.slot)}
              </span>
            ) : null}
            {plano.ativo ? null : (
              <span className="rounded-md bg-subtle px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                Desativado
              </span>
            )}
          </p>
          <p className="m-0 mt-1 text-xs text-ink-muted">
            {plano.parcelas}x · entrada de{" "}
            {plano.entradaPercentual.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}% ·{" "}
            {plano.jurosTaxa === null
              ? "sem juros"
              : `juros de ${plano.jurosTaxa.toLocaleString("pt-BR", {
                  maximumFractionDigits: 4,
                })}% a.${plano.jurosPeriodicidade === "mensal" ? "m" : "a"}`}{" "}
            · {rotuloDoSistema(plano.sistemaAmortizacao)} · correção{" "}
            {rotuloDoIndice(plano.indiceCorrecao)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            aria-label={`Editar ${plano.nome}`}
            className="flex size-8 items-center justify-center rounded-lg border border-line bg-surface text-ink-muted transition-colors hover:text-ink"
            onClick={aoEditar}
            type="button"
          >
            <Pencil aria-hidden="true" className="size-3.5" />
          </button>
          <button
            aria-label={plano.ativo ? `Desativar ${plano.nome}` : `Reativar ${plano.nome}`}
            className="flex size-8 items-center justify-center rounded-lg border border-line bg-surface text-ink-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            disabled={salvando}
            onClick={aoDesativar}
            type="button"
          >
            <Power aria-hidden="true" className="size-3.5" />
          </button>
        </div>
      </div>

      {/* A minuta é o que separa um plano que vende de um plano que trava. */}
      {plano.minutaNome ? (
        <p className="m-0 flex items-center gap-1.5 text-xs text-ink-soft">
          <FileText aria-hidden="true" className="size-3.5 shrink-0" />
          Assina a minuta <strong className="font-semibold text-ink">{plano.minutaNome}</strong>
        </p>
      ) : plano.ativo ? (
        <p className="m-0 flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          Sem minuta: a venda neste plano acontece, mas o contrato não é gerado.
        </p>
      ) : null}

      {simulado?.parcela != null ? (
        <p className="m-0 rounded-lg bg-subtle px-2.5 py-1.5 text-xs text-ink-soft">
          Nessa unidade: sinal de{" "}
          <strong className="font-semibold tabular-nums text-ink">{dinheiro(simulado.sinal)}</strong>{" "}
          e {simulado.parcelas} parcelas de{" "}
          <strong className="font-semibold tabular-nums text-ink">
            {dinheiro(simulado.parcela)}
          </strong>
          {simulado.naturezaDaParcela === "primeira"
            ? " (a primeira; as seguintes caem)"
            : simulado.naturezaDaParcela === "inicial"
              ? " (inicial, antes da correção)"
              : ""}
          .
        </p>
      ) : null}
    </li>
  );
}

function Formulario({
  aoCancelar,
  aoMudar,
  aoSalvar,
  categorias,
  entradaTexto,
  jurosTexto,
  minutas,
  mudarEntrada,
  mudarJuros,
  mudarPreco,
  preco,
  precoTexto,
  problemas,
  rascunho,
  salvando,
}: {
  aoCancelar: () => void;
  aoMudar: (r: Rascunho) => void;
  aoSalvar: () => void;
  categorias: CategoriaDoTemis[];
  entradaTexto: string;
  jurosTexto: string;
  minutas: MinutaResumida[];
  mudarEntrada: (v: string) => void;
  mudarJuros: (v: string) => void;
  mudarPreco: (v: string) => void;
  preco: null | number;
  precoTexto: string;
  problemas: string[];
  rascunho: Rascunho;
  salvando: boolean;
}) {
  // A prévia usa o rascunho VIVO, com os textos já convertidos: é ela que denuncia o 0,20 digitado
  // no lugar de 20 antes de o plano virar contrato.
  const previa =
    preco === null
      ? null
      : calcularParcela(
          paraCalculo(planoDaPrevia(rascunho, paraNumero(entradaTexto), paraNumero(jurosTexto))),
          preco,
        );

  const campo =
    "h-9 w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-line-strong";
  const rotulo = "text-[11px] font-semibold uppercase tracking-wide text-ink-muted";

  return (
    <section className="overflow-hidden rounded-2xl border border-[#A07C3B]/40 bg-surface shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-subtle/40 px-4 py-3">
        <h4 className="m-0 text-sm font-semibold text-ink">
          {rascunho.id ? "Editar plano" : "Novo plano"}
        </h4>
        <button
          aria-label="Fechar"
          className="flex size-8 items-center justify-center rounded-lg border border-line bg-surface text-ink-muted transition-colors hover:text-ink"
          onClick={aoCancelar}
          type="button"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>

      <div className="grid gap-3 px-4 py-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className={rotulo}>Nome do plano</span>
            <input
              className={campo}
              onChange={(e) => aoMudar({ ...rascunho, nome: e.target.value })}
              placeholder="PLANO NORMAL 120X"
              value={rascunho.nome}
            />
          </label>

          <label className="grid gap-1.5">
            <span className={rotulo}>Categoria</span>
            <select
              className={campo}
              onChange={(e) => aoMudar({ ...rascunho, categoriaId: e.target.value || null })}
              value={rascunho.categoriaId ?? ""}
            >
              <option value="">Sem categoria</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1.5">
            <span className={rotulo}>Parcelas</span>
            <input
              className={campo}
              inputMode="numeric"
              onChange={(e) =>
                aoMudar({ ...rascunho, parcelas: Number(e.target.value.replace(/\D/g, "")) || 0 })
              }
              value={rascunho.parcelas || ""}
            />
          </label>

          <label className="grid gap-1.5">
            <span className={rotulo}>Entrada (%)</span>
            <input
              className={campo}
              inputMode="decimal"
              onChange={(e) => mudarEntrada(e.target.value)}
              placeholder="20"
              value={entradaTexto}
            />
            {/* ⚠️ O aviso fica aqui, e não num tooltip, porque este é o erro que sai caro: 0,20 em
                vez de 20 faz a entrada virar vinte centavos por cento e o contrato sair torto. */}
            <span className="text-[11px] text-ink-muted">20 significa 20%, não 0,20.</span>
          </label>

          <label className="grid gap-1.5">
            <span className={rotulo}>Posição na proposta</span>
            <select
              className={campo}
              onChange={(e) => aoMudar({ ...rascunho, slot: e.target.value || null })}
              value={rascunho.slot ?? ""}
            >
              {SLOTS.map((s) => (
                <option key={s.valor} value={s.valor}>
                  {s.rotulo}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1.5">
            <span className={rotulo}>Juros (%)</span>
            <input
              className={campo}
              inputMode="decimal"
              onChange={(e) => mudarJuros(e.target.value)}
              placeholder="vazio = sem juros"
              value={jurosTexto}
            />
            <span className="text-[11px] text-ink-muted">
              Vazio é plano SEM juros, não campo por preencher.
            </span>
          </label>

          <label className="grid gap-1.5">
            <span className={rotulo}>Periodicidade dos juros</span>
            <select
              className={campo}
              onChange={(e) => aoMudar({ ...rascunho, jurosPeriodicidade: e.target.value })}
              value={rascunho.jurosPeriodicidade ?? "anual"}
            >
              <option value="anual">ao ano</option>
              <option value="mensal">ao mês</option>
            </select>
          </label>

          <label className="grid gap-1.5">
            <span className={rotulo}>Sistema</span>
            <select
              className={campo}
              onChange={(e) => aoMudar({ ...rascunho, sistemaAmortizacao: e.target.value })}
              value={rascunho.sistemaAmortizacao}
            >
              {SISTEMAS.map((s) => (
                <option key={s.valor} value={s.valor}>
                  {s.rotulo}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <span className={rotulo}>Correção do saldo</span>
            <select
              className={campo}
              onChange={(e) => aoMudar({ ...rascunho, indiceCorrecao: e.target.value })}
              value={rascunho.indiceCorrecao}
            >
              {INDICES.map((i) => (
                <option key={i.valor} value={i.valor}>
                  {i.rotulo}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5">
            <span className={rotulo}>Minuta que este plano assina</span>
            <select
              className={campo}
              onChange={(e) => aoMudar({ ...rascunho, minutaId: e.target.value || null })}
              value={rascunho.minutaId ?? ""}
            >
              <option value="">Sem minuta (o contrato não é gerado)</option>
              {minutas.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                  {m.publicada ? ` · v${m.versao}` : " · rascunho"}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="grid gap-1.5">
          <span className={rotulo}>Observação (opcional)</span>
          <input
            className={campo}
            onChange={(e) => aoMudar({ ...rascunho, observacao: e.target.value || null })}
            placeholder="Ex.: só para clientes vindos de imobiliária credenciada"
            value={rascunho.observacao ?? ""}
          />
        </label>

        {/* ── A CONFERÊNCIA ────────────────────────────────────────────── */}
        <div className="grid gap-2 rounded-xl border border-line bg-subtle/40 px-3 py-3">
          <label className="grid gap-1.5 sm:max-w-56">
            <span className={rotulo}>Conferir com o preço de uma unidade</span>
            <input
              className={campo}
              inputMode="decimal"
              onChange={(e) => mudarPreco(e.target.value)}
              placeholder="185400"
              value={precoTexto}
            />
          </label>

          {previa?.parcela != null ? (
            <p className="m-0 text-sm text-ink">
              Sinal de <strong className="font-semibold tabular-nums">{dinheiro(previa.sinal)}</strong>{" "}
              e {previa.parcelas} parcelas de{" "}
              <strong className="font-semibold tabular-nums">{dinheiro(previa.parcela)}</strong>
              {previa.naturezaDaParcela === "primeira"
                ? " (a primeira; as seguintes caem)"
                : previa.naturezaDaParcela === "inicial"
                  ? " (inicial, antes da correção)"
                  : ""}
              .
            </p>
          ) : (
            <p className="m-0 text-xs text-ink-muted">
              Digite o preço de uma unidade para ver o sinal e a parcela que este plano produz. É a
              forma mais rápida de perceber uma entrada ou uma taxa digitada errado.
            </p>
          )}
        </div>

        {problemas.length > 0 ? (
          <ul className="m-0 grid list-none gap-1 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2.5 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            {problemas.map((p) => (
              <li className="flex items-start gap-2" key={p}>
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                {p}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={salvando}
            onClick={aoSalvar}
            type="button"
          >
            {salvando ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
            {rascunho.id ? "Salvar plano" : "Criar plano"}
          </button>
          <button
            className="inline-flex h-9 items-center rounded-lg border border-line bg-surface px-4 text-sm font-semibold text-ink transition-colors hover:bg-subtle"
            onClick={aoCancelar}
            type="button"
          >
            Cancelar
          </button>
        </div>
      </div>
    </section>
  );
}
