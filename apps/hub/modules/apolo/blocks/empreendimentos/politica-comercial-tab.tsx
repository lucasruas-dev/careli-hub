"use client";

import {
  AlertTriangle,
  Building2,
  Check,
  Handshake,
  Info,
  Loader2,
  Lock,
  Search,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { PoliticaComercialDoEmpreendimento } from "@/lib/apolo/politica-comercial";
import { ENTRADA_MINIMA_PERCENTUAL } from "@/lib/hercules/composicoes";

import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";
import { CategoriasTab } from "@/modules/apolo/blocks/empreendimentos/categorias-tab";
import { PlanosComerciaisTab } from "@/modules/apolo/blocks/empreendimentos/planos-comerciais-tab";

// ABA POLÍTICAS COMERCIAIS do empreendimento.
//
// Pedido do Lucas (17/08/2026): "no cadastro do empreendimento, podemos trazer a aba políticas
// comerciais, e lá podemos registrar o valor de comissão, bem como o valor da gestão de carteira e
// os planos comerciais aprovados para aquele empreendimento".
//
// ⚠️ A TELA SEPARA O QUE É DO C2X DO QUE É NOSSO, e isso não é enfeite: a regra de precedência é
// que o C2X manda no financeiro enquanto a migração não acontece, e só a % de gestão de carteira
// nasce no Apolo. Sem a marcação, o operador não sabe onde ir mudar — e o incorporador vai perguntar
// de onde saiu o número.
//
// ⚠️ VAZIO NA GESTÃO DE CARTEIRA SIGNIFICA "NÃO FAZEMOS A GESTÃO desse empreendimento", não "falta
// preencher" (Lucas, 17/08). É por isso que o campo não tem valor sugerido: um 97% pré-preenchido
// viraria dado cadastrado sem ninguém ter decidido.

type Props = {
  /** Em qual sub-aba abrir. Serve ao link antigo que apontava para "Planos". */
  abaInicial?: SubAba;
  code: string;
  codes: string[];
  enterpriseId: string;
  name: string;
};

/**
 * AS TRÊS FACES DA POLÍTICA COMERCIAL.
 *
 * Lucas (07/09/2026): *"acho que planos tem que estar dentro das políticas comerciais, uma aba"* e,
 * sobre a criação de categoria estar na aba de planos, *"está no lugar errado isso, não devia estar
 * em planos"*.
 *
 * ⚠️ ERAM TRÊS ABAS IRMÃS NO PRIMEIRO NÍVEL dizendo a mesma coisa em pedaços: a política é o acordo
 * com o incorporador (comissão, entrada mínima, split), a categoria organiza o que ele vende, e o
 * plano é como o cliente paga. Quem configura uma configura as três na mesma sentada — e a
 * categoria, que só existe para agrupar planos, estava escondida no rodapé da lista de planos.
 *
 * ⚠️ A CATEGORIA GANHA ABA PRÓPRIA, e não é excesso de tela: ela é o que separa público interno de
 * externo no mesmo empreendimento (o JDG tem seis planos, três de cada), e essa decisão vem ANTES
 * de cadastrar plano. Enterrada no fim de outra lista, ninguém a encontrava — foi exatamente o que
 * aconteceu.
 */
type SubAba = "categorias" | "gestao" | "planos";

const SUB_ABAS: { id: SubAba; rotulo: string }[] = [
  { id: "gestao", rotulo: "Gestão e comissão" },
  { id: "categorias", rotulo: "Categorias" },
  { id: "planos", rotulo: "Planos" },
];

/**
 * O padrão da casa, quando o empreendimento não cadastrou o seu.
 *
 * ⚠️ IMPORTADO, NÃO REDIGITADO: é a mesma constante que o simulador obedece
 * (`lib/hercules/composicoes.ts`). Escrever "10" aqui criaria uma segunda verdade, e a tela passaria
 * a prometer um piso diferente do que a conta aplica no dia em que o número mudar.
 */
const PADRAO_DA_CASA = ENTRADA_MINIMA_PERCENTUAL;

const pct = (v: null | number): string =>
  v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}%`;

/** O que a busca de entidades devolve e a tela mostra na lista de candidatas a coordenadora. */
type EntidadeAchada = {
  documento: string;
  id: string;
  nome: string;
};

/** Os campos do rateio da corretagem, cada um com o nome que o PATCH espera. */
type CampoSalvavel = "coordenadora" | "entrada" | "gestao" | "imobiliaria";

const CHAVE_DO_CAMPO: Record<CampoSalvavel, string> = {
  coordenadora: "comissaoCoordenadoraPercentual",
  entrada: "entradaMinimaPercentual",
  gestao: "gestaoCarteiraPercentual",
  imobiliaria: "comissaoImobiliariaPercentual",
};

/** Número do banco → texto do campo, com a vírgula que o operador digita. Nulo vira vazio. */
const paraCampo = (v: null | number): string =>
  v === null || v === undefined ? "" : String(v).replace(".", ",");

const ROTULO_DO_CAMPO: Record<CampoSalvavel, string> = {
  coordenadora: "Comissão da coordenadora",
  entrada: "Entrada mínima",
  gestao: "Gestão de carteira",
  imobiliaria: "Comissão da imobiliária",
};

export function PoliticaComercialTab({
  abaInicial = "gestao",
  code,
  codes,
  enterpriseId,
  name,
}: Props) {
  const [subAba, setSubAba] = useState<SubAba>(abaInicial);
  const [politicas, setPoliticas] = useState<PoliticaComercialDoEmpreendimento[] | null>(null);
  const [erro, setErro] = useState<null | string>(null);

  // Um campo por divisão: a edição é POR EMPREENDIMENTO, mas o valor é gravado em cada divisão,
  // porque é nelas que as parcelas penduram. Ver o comentário do `salvar`.
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  // A entrada mínima tem o próprio rascunho: a tela salva um campo por vez, e a rota recusa os
  // dois juntos justamente para não sobrescrever o que o operador não tocou.
  const [rascunhoEntrada, setRascunhoEntrada] = useState<Record<string, string>>({});
  // O rateio da corretagem (migration 0145) segue a mesma disciplina: um rascunho por campo,
  // porque cada um sobe sozinho no PATCH.
  const [rascunhoCoordenadora, setRascunhoCoordenadora] = useState<Record<string, string>>({});
  const [rascunhoImobiliaria, setRascunhoImobiliaria] = useState<Record<string, string>>({});
  // Busca da entidade da coordenadora. Reusa a rota de busca de entidades do Apolo
  // (`/api/apolo/relationships?q=`), a mesma que o modal de relacionamento e a troca de imobiliária
  // da CAD já usam — não vale inventar rota para procurar entidade pelo nome.
  const [buscaCoordenadora, setBuscaCoordenadora] = useState("");
  const [achados, setAchados] = useState<EntidadeAchada[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<null | string>(null);
  const [recarregar, setRecarregar] = useState(0);

  // ⚠️ CHAVE ESTÁVEL, não o array. `codes` é uma prop nova a cada render do pai, então usá-lo direto
  // na dependência do efeito dispara refetch em loop.
  const chaveDosCodes = codes.join(",");

  useEffect(() => {
    let vivo = true;
    setPoliticas(null);
    setErro(null);
    setAviso(null);

    void (async () => {
      try {
        const token = await getApoloAccessToken();
        const resposta = await fetch(
          `/api/apolo/empreendimentos/politica?codes=${encodeURIComponent(chaveDosCodes)}`,
          { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
        );
        const corpo = (await resposta.json()) as {
          data?: { politicas?: PoliticaComercialDoEmpreendimento[] };
          error?: string;
        };

        if (!vivo) return;

        if (!resposta.ok) {
          setErro(corpo.error ?? "Não foi possível carregar a política comercial.");
          return;
        }

        const lista = corpo.data?.politicas ?? [];
        setPoliticas(lista);
        setRascunho(
          Object.fromEntries(
            lista.map((p) => [
              p.enterpriseId,
              p.gestaoCarteiraApolo === null
                ? ""
                : String(p.gestaoCarteiraApolo).replace(".", ","),
            ]),
          ),
        );
        setRascunhoCoordenadora(
          Object.fromEntries(
            lista.map((p) => [p.enterpriseId, paraCampo(p.comissaoCoordenadoraApolo)]),
          ),
        );
        setRascunhoImobiliaria(
          Object.fromEntries(
            lista.map((p) => [p.enterpriseId, paraCampo(p.comissaoImobiliariaApolo)]),
          ),
        );
        setBuscaCoordenadora("");
        setAchados([]);
      } catch {
        if (vivo) setErro("Falha ao carregar a política comercial.");
      }
    })();

    return () => {
      vivo = false;
    };
  }, [chaveDosCodes, recarregar]);

  /**
   * Grava a % em TODAS as divisões do empreendimento.
   *
   * O Lucas edita "Vale do Ouro: 97%" uma vez; o Apolo grava em VOC e VOL. A regra dele é "por
   * empreendimento, sempre a carteira será por empreendimento", e as divisões existem por
   * particularidade (fases, sócios) mas refletem ao empreendimento único. Gravar nas divisões
   * mantém o dado no nível onde o dinheiro está, sem precisar resolver herança na hora de somar.
   */
  const salvar = async (valor: string, campo: CampoSalvavel = "gestao") => {
    if (!politicas) return;

    setSalvando(true);
    setErro(null);
    setAviso(null);

    // Lista vazia = nada para gravar. Sem isto, o laço não rodava e a tela dizia "salva" sem ter
    // mandado requisição nenhuma — o pior tipo de confirmação.
    if (politicas.length === 0) {
      setErro("Nenhum empreendimento carregado: recarregue a tela antes de salvar.");
      setSalvando(false);
      return;
    }

    try {
      const token = await getApoloAccessToken();
      const limpo = valor.trim();

      // UMA chamada para TODAS as divisões: é o servidor que percorre, e ele relata o que gravou
      // se algo falhar no meio.
      const resposta = await fetch("/api/apolo/empreendimentos/politica", {
        body: JSON.stringify({
          code: politicas[0]?.code ?? null,
          enterpriseIds: politicas.map((p) => p.enterpriseId),
          // UM CAMPO POR VEZ: a rota recusa dois na mesma chamada, justamente para não sobrescrever
          // o que o operador não tocou com o valor que a tela tinha em memória.
          [CHAVE_DO_CAMPO[campo]]: limpo === "" ? null : limpo,
        }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "PATCH",
      });

      const corpo = (await resposta.json().catch(() => ({}))) as {
        data?: { divisoes?: number };
        error?: string;
      };

      if (!resposta.ok) {
        setErro(corpo.error ?? "Não foi possível salvar.");
        // Recarrega: depois de uma falha parcial o banco pode ter mudado, e manter a tela no valor
        // antigo esconderia isso do operador.
        setRecarregar((n) => n + 1);
        return;
      }

      const numero = limpo === "" ? null : Number(limpo.replace(",", "."));
      setPoliticas((atual) =>
        (atual ?? []).map((p) => ({
          ...p,
          ...(campo === "gestao"
            ? { gestaoCarteiraApolo: numero }
            : campo === "entrada"
              ? { entradaMinimaApolo: numero }
              : campo === "coordenadora"
                ? { comissaoCoordenadoraApolo: numero }
                : { comissaoImobiliariaApolo: numero }),
        })),
      );

      const divisoes = corpo.data?.divisoes ?? politicas.length;
      const nome = ROTULO_DO_CAMPO[campo];
      setAviso(
        limpo === ""
          ? campo === "gestao"
            ? "Gestão de carteira removida: este empreendimento passa a não ter carteira administrada."
            : campo === "entrada"
              ? `Entrada mínima removida: volta a valer o padrão da casa (${PADRAO_DA_CASA}%).`
              : // ⚠️ REMOVER NÃO É ZERAR, e a frase precisa dizer isso: o contrato volta a sair com a
                // lacuna à mostra, para alguém preencher — que é diferente de imprimir 0%.
                `${nome} removida: o contrato de corretagem volta a sair com a lacuna em branco.`
          : divisoes > 1
            ? `${nome} salva nas ${divisoes} divisões deste empreendimento.`
            : `${nome} salva.`,
      );
    } catch {
      setErro("Falha de rede. Recarregue a tela para conferir o que foi salvo.");
      setRecarregar((n) => n + 1);
    } finally {
      setSalvando(false);
    }
  };

  /**
   * Procura a entidade que será a coordenadora de vendas.
   *
   * ⚠️ SEM FILTRO DE PERFIL, de propósito: a coordenadora de vendas aparece cadastrada ora como
   * parceira, ora como pessoa jurídica, e filtrar por um papel esconderia justamente a que o
   * operador está procurando. O nome e o documento na lista bastam para ele escolher certo.
   */
  const procurarCoordenadora = async (termo: string) => {
    const alvo = termo.trim();
    if (alvo.length < 3) {
      setAchados([]);
      return;
    }

    setBuscando(true);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch(`/api/apolo/relationships?q=${encodeURIComponent(alvo)}`, {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const corpo = (await resposta.json().catch(() => ({}))) as {
        data?: { entities?: Array<{ displayName: string; documentMasked: string; id: string }> };
      };
      setAchados(
        (corpo.data?.entities ?? []).slice(0, 8).map((e) => ({
          documento: e.documentMasked ?? "",
          id: e.id,
          nome: e.displayName,
        })),
      );
    } catch {
      setErro("Falha ao buscar a entidade. Tente de novo.");
    } finally {
      setBuscando(false);
    }
  };

  /**
   * Aponta (ou desaponta) a coordenadora de vendas do empreendimento.
   *
   * Mesma regra do percentual: UMA chamada para TODAS as divisões, e é o servidor quem percorre e
   * relata o que gravou se algo falhar no meio.
   */
  const salvarCoordenadora = async (entityId: null | string, nome: null | string) => {
    if (!politicas || politicas.length === 0) {
      setErro("Nenhum empreendimento carregado: recarregue a tela antes de salvar.");
      return;
    }

    setSalvando(true);
    setErro(null);
    setAviso(null);

    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch("/api/apolo/empreendimentos/politica", {
        body: JSON.stringify({
          code: politicas[0]?.code ?? null,
          coordenadoraEntityId: entityId,
          enterpriseIds: politicas.map((p) => p.enterpriseId),
        }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "PATCH",
      });

      const corpo = (await resposta.json().catch(() => ({}))) as {
        data?: { divisoes?: number };
        error?: string;
      };

      if (!resposta.ok) {
        setErro(corpo.error ?? "Não foi possível salvar.");
        setRecarregar((n) => n + 1);
        return;
      }

      setPoliticas((atual) =>
        (atual ?? []).map((p) => ({
          ...p,
          coordenadoraEntityId: entityId,
          coordenadoraNome: nome,
        })),
      );
      setBuscaCoordenadora("");
      setAchados([]);

      const divisoes = corpo.data?.divisoes ?? politicas.length;
      setAviso(
        entityId === null
          ? "Coordenadora removida: o contrato de corretagem volta a sair com o bloco em branco."
          : divisoes > 1
            ? `Coordenadora ${nome} salva nas ${divisoes} divisões deste empreendimento.`
            : `Coordenadora ${nome} salva.`,
      );
    } catch {
      setErro("Falha de rede. Recarregue a tela para conferir o que foi salvo.");
      setRecarregar((n) => n + 1);
    } finally {
      setSalvando(false);
    }
  };

  // ⚠️ BUSCA COM ESPERA DE 350ms, e não uma requisição por tecla: é o mesmo intervalo do modal de
  // relacionamento, e a razão é custo — digitar "coordenadora" dispararia treze consultas.
  //
  // ⚠️ ESTE HOOK FICA ANTES DOS `return` CONDICIONAIS abaixo: hook depois de return condicional
  // muda a contagem de hooks entre renders e o React derruba a árvore (erro #310, incidente
  // 22/jul na ficha do cliente).
  useEffect(() => {
    const termo = buscaCoordenadora.trim();
    if (termo.length < 3) {
      setAchados([]);
      return;
    }
    // ⚠️ SÓ O TERMO NAS DEPENDÊNCIAS. `procurarCoordenadora` é uma função nova a cada render;
    // colocá-la aqui remarcaria o timer a cada render e a busca nunca dispararia.
    const id = setTimeout(() => void procurarCoordenadora(termo), 350);
    return () => clearTimeout(id);
  }, [buscaCoordenadora]);

  if (erro && !politicas) {
    return (
      <p className="m-0 flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {erro}
      </p>
    );
  }

  if (!politicas) {
    return (
      <p className="m-0 flex items-center gap-2 p-6 text-sm text-ink-muted">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        Carregando a política comercial…
      </p>
    );
  }

  // ⚠️ AS DIVISÕES PODEM DISCORDAR, E O LAGOA BONITA É O CASO. Regra do Lucas: "do Lagoa Bonita
  // fazemos somente do LBF" — o LBR e o LBP não têm gestora de recebíveis no split. Escolher
  // `politicas[0]` como referência fazia a tela AFIRMAR o que estivesse na divisão que o banco
  // devolvesse primeiro: se viesse o LBR, ela diria "a Careli não administra a carteira deste
  // empreendimento", frase falsa sobre um empreendimento onde administramos.
  //
  // A consolidação segue a regra do negócio: se ALGUMA divisão tem gestão, o empreendimento tem.
  const ref = politicas[0];
  const comSplit = politicas.filter(
    (p) => p.gestaoCarteiraSplit !== null && p.gestaoCarteiraSplit !== undefined,
  );
  const splitDoEmpreendimento = comSplit[0]?.gestaoCarteiraSplit ?? null;
  // Divisões com percentuais DIFERENTES entre si: não dá para resumir num número só, e esconder
  // isso seria pior do que mostrar.
  const splitsDivergentes =
    new Set(comSplit.map((p) => p.gestaoCarteiraSplit)).size > 1 ||
    (comSplit.length > 0 && comSplit.length < politicas.length);

  // Os campos vindos do C2X (comissão, entrada mínima, parcelas do sinal, juros) são exibidos a
  // partir da primeira divisão. Isso vale enquanto elas concordam — quando não, a tela precisa
  // dizer, em vez de eleger uma em silêncio.
  const divergemNoC2x =
    new Set(
      politicas.map((p) =>
        [p.comissaoTotal, p.entradaMinima, p.maxParcelasSinal, p.jurosAtraso].join("|"),
      ),
    ).size > 1;

  const avisosUnicos = [...new Set(politicas.flatMap((p) => p.avisos))];
  const valorAtual = ref ? (rascunho[ref.enterpriseId] ?? "") : "";
  const semGestao = politicas.every((p) => p.gestaoCarteiraApolo === null);

  // A entrada mínima cadastrada no Apolo. Como a gestão de carteira, o valor é do EMPREENDIMENTO e
  // fica gravado em cada divisão; se alguma divergir, a tela mostra a primeira e o operador salva
  // por cima, igualando as duas.
  const entradaCadastrada = politicas.find((p) => p.entradaMinimaApolo !== null)?.entradaMinimaApolo ?? null;
  const valorDaEntrada = ref
    ? (rascunhoEntrada[ref.enterpriseId] ??
      (entradaCadastrada === null ? "" : String(entradaCadastrada).replace(".", ",")))
    : "";

  // ── O RATEIO DA CORRETAGEM (migration 0145) ──────────────────────────────
  // Mesma leitura das irmãs: o valor é do EMPREENDIMENTO e fica gravado em cada divisão; a tela
  // mostra a primeira que tiver e o operador salva por cima, igualando as demais.
  const comissaoCoordenadora =
    politicas.find((p) => p.comissaoCoordenadoraApolo !== null)?.comissaoCoordenadoraApolo ?? null;
  const comissaoImobiliaria =
    politicas.find((p) => p.comissaoImobiliariaApolo !== null)?.comissaoImobiliariaApolo ?? null;
  const coordenadoraId = politicas.find((p) => p.coordenadoraEntityId)?.coordenadoraEntityId ?? null;
  const coordenadoraNome = politicas.find((p) => p.coordenadoraNome)?.coordenadoraNome ?? null;

  const valorDaCoordenadora = ref
    ? (rascunhoCoordenadora[ref.enterpriseId] ?? paraCampo(comissaoCoordenadora))
    : "";
  const valorDaImobiliaria = ref
    ? (rascunhoImobiliaria[ref.enterpriseId] ?? paraCampo(comissaoImobiliaria))
    : "";

  // ⚠️ A SOMA SÓ EXISTE SE ALGUMA DAS DUAS EXISTIR. Com as duas nulas o total é "não cadastrado",
  // NÃO 0% — imprimir zero afirmaria que ninguém recebe comissão neste empreendimento, que é uma
  // decisão de negócio que ninguém tomou. Com UMA preenchida, a soma é o que há: a outra ponta
  // continua em branco e a tela avisa.
  const comissaoDoContrato =
    comissaoCoordenadora === null && comissaoImobiliaria === null
      ? null
      : (comissaoCoordenadora ?? 0) + (comissaoImobiliaria ?? 0);
  // O número do C2X existe para CONFERÊNCIA: é a mesma base (o valor vendido), então a soma acima
  // deveria bater com ele. Quando não bate, alguém errou de um dos dois lados.
  const comissaoDoC2x = ref?.comissaoTotal ?? null;
  const somaDivergeDoC2x =
    comissaoDoContrato !== null &&
    comissaoDoC2x !== null &&
    Math.abs(comissaoDoContrato - comissaoDoC2x) > 0.001;

  const faixa = (
    <div className="flex flex-wrap gap-1 border-b border-line px-5 pt-4">
      {SUB_ABAS.map((x) => (
        <button
          className={`rounded-t-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
            subAba === x.id
              ? "bg-surface text-ink shadow-[inset_0_-2px_0_0_currentColor]"
              : "text-ink-muted hover:text-ink"
          }`}
          key={x.id}
          onClick={() => setSubAba(x.id)}
          type="button"
        >
          {x.rotulo}
        </button>
      ))}
    </div>
  );

  if (subAba === "categorias") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {faixa}
        <CategoriasTab codigo={codes[0] ?? code} enterpriseId={enterpriseId} name={name} />
      </div>
    );
  }

  if (subAba === "planos") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {faixa}
        <PlanosComerciaisTab enterpriseId={enterpriseId} name={name} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {faixa}
      <div className="grid gap-4 p-5">
      {/* ── A GESTÃO DE CARTEIRA: o que é NOSSO ─────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex items-start gap-3 border-b border-line bg-subtle/40 px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-inverse text-brand-ink">
            <Check aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h4 className="m-0 text-sm font-semibold text-ink">Gestão de carteira</h4>
            <p className="m-0 mt-0.5 text-xs text-ink-muted">
              O percentual das parcelas do financiamento que fica com o incorporador. É o que define
              o valor líquido dele, e vem do split cadastrado no C2X. O campo abaixo só é preciso
              quando a negociação mudou e o C2X ainda não reflete.
            </p>
          </div>
        </div>

        <div className="grid gap-3 px-4 py-4">
          <label className="grid gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              % do incorporador {splitDoEmpreendimento === null ? "" : "(exceção)"}
            </span>
            <span className="flex items-center gap-2">
              <input
                className="h-9 w-32 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-line-strong"
                inputMode="decimal"
                onChange={(evento) =>
                  setRascunho((atual) =>
                    ref ? { ...atual, [ref.enterpriseId]: evento.target.value } : atual,
                  )
                }
                placeholder="97,5"
                value={valorAtual}
              />
              <button
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={salvando}
                onClick={() => void salvar(valorAtual)}
                type="button"
              >
                {salvando ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                Salvar
              </button>
            </span>
          </label>

          {splitDoEmpreendimento !== null ? (
            <p className="m-0 flex items-start gap-2 rounded-lg bg-subtle px-3 py-2 text-xs text-ink-soft">
              <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              O split do C2X dá {pct(splitDoEmpreendimento)} ao incorporador nas mensalidades
              {splitsDivergentes
                ? ` (${comSplit.map((p) => p.code ?? p.enterpriseId).join(", ")})`
                : ""}
              .
              {semGestao
                ? " É este o valor em uso."
                : " O campo acima está preenchido e tem prioridade sobre ele."}
            </p>
          ) : null}

          {/* ── A ENTRADA MÍNIMA: a segunda coisa que nasce no Apolo ────────
              Lucas (03/09/2026): *"vamos ter um campo dentro da parte que vamos cadastrar a
              política comercial e lá vamos apontar a % mínima"*. Fica aqui, no bloco do que é
              NOSSO, e não junto dos campos do C2X — a leitura do legado (`entradaMinima`) continua
              embaixo, como referência, e as duas não se misturam. */}
          <label className="grid gap-1.5 border-t border-line pt-4">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              % mínima de entrada
            </span>
            <span className="flex items-center gap-2">
              <input
                className="h-9 w-32 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-line-strong"
                inputMode="decimal"
                onChange={(evento) =>
                  setRascunhoEntrada((atual) =>
                    ref ? { ...atual, [ref.enterpriseId]: evento.target.value } : atual,
                  )
                }
                placeholder={String(PADRAO_DA_CASA)}
                value={valorDaEntrada}
              />
              <button
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={salvando}
                onClick={() => void salvar(valorDaEntrada, "entrada")}
                type="button"
              >
                {salvando ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                Salvar
              </button>
            </span>
            <span className="text-xs text-ink-soft">
              {entradaCadastrada === null
                ? `Não cadastrada: vale o padrão da casa, ${PADRAO_DA_CASA}%. O simulador não oferece composição abaixo disso.`
                : `O simulador e a proposta não aceitam entrada abaixo de ${pct(entradaCadastrada)} do valor da unidade.`}
              {ref?.entradaMinima !== null && ref?.entradaMinima !== undefined
                ? ` O C2X registra ${pct(ref.entradaMinima)} para este empreendimento.`
                : ""}
            </span>
          </label>

          {/* ⚠️ Só afirma "não administramos" quando NENHUMA divisão tem gestão. No Lagoa Bonita
              administramos só o LBF: olhar uma divisão sorteada diria o contrário. */}
          {semGestao && splitDoEmpreendimento === null ? (
            <p className="m-0 flex items-start gap-2 rounded-lg bg-subtle px-3 py-2 text-xs text-ink-soft">
              <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              Sem gestão de carteira cadastrada. Pela regra, isso significa que a Careli não
              administra a carteira deste empreendimento, e a aba Carteira não aparece para o
              incorporador.
            </p>
          ) : null}

          {splitsDivergentes ? (
            <p className="m-0 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              As divisões deste empreendimento não têm o mesmo split. Administramos a carteira de{" "}
              {comSplit.map((p) => p.code ?? p.enterpriseId).join(", ")} e não das demais. É o caso
              do Lagoa Bonita, onde só o LBF tem gestão. Salvar o campo acima grava a mesma % em
              todas as divisões, inclusive nas que hoje não têm gestão.
            </p>
          ) : null}

          {politicas.length > 1 ? (
            <p className="m-0 text-xs text-ink-muted">
              Este empreendimento tem {politicas.length} divisões (
              {politicas.map((p) => p.code).join(", ")}). O percentual vale para todas.
            </p>
          ) : null}

          {aviso ? (
            <p className="m-0 rounded-lg bg-subtle px-3 py-2 text-xs font-medium text-ink">
              {aviso}
            </p>
          ) : null}

          {erro ? (
            <p className="m-0 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              {erro}
            </p>
          ) : null}
        </div>
      </section>

      {/* ── O QUE VEM DO C2X: leitura ────────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex items-start gap-3 border-b border-line bg-subtle/40 px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-subtle text-ink-muted">
            <Lock aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h4 className="m-0 text-sm font-semibold text-ink">Comissão e entrada</h4>
            <p className="m-0 mt-0.5 text-xs text-ink-muted">
              Vem do C2X e só muda lá, na política comercial do empreendimento.
            </p>
          </div>
        </div>

        {/* ⚠️ NÃO EXISTE "% DO INCORPORADOR NA ENTRADA" FIXA, e mostrar uma seria enganoso.
            O `commissioning_incorporador` do C2X (3% no Recanto) é a fatia dele DENTRO da cadeia de
            comissionamento, e aparece na tabela abaixo junto dos outros papéis. O que ele recebe da
            entrada é o COMPLEMENTO, e depende da entrada que CADA CLIENTE fechou: com 10% de
            entrada sobram 30% para ele, com 20% sobram 65%, com 33% sobram 78,79%. Eu tinha posto
            "Comissão do incorporador: 3%" em destaque aqui, e o Lucas leu como o que ele recebe —
            que é exatamente a confusão que este aviso evita. */}
        <p className="m-0 flex items-start gap-2 border-b border-line bg-subtle/20 px-4 py-3 text-xs text-ink-soft">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            A comissão de {pct(ref?.comissaoTotal ?? null)} é sobre o valor do lote, e o
            incorporador recebe o que sobra da entrada. Como a entrada muda de contrato para
            contrato, a fatia dele também muda: quanto maior a entrada do cliente, maior a parte
            dele. Só as parcelas do financiamento têm percentual fixo, que é a gestão de carteira
            acima.
          </span>
        </p>

        {/* ⚠️ Os campos abaixo saem da PRIMEIRA divisão, o que só é honesto enquanto as divisões
            concordam. Quando divergem, a tela avisa em vez de eleger uma em silêncio — foi o erro
            que a gestão de carteira cometia, e o Lagoa Bonita é o contraexemplo vivo. */}
        {divergemNoC2x ? (
          <p className="m-0 flex items-start gap-2 border-b border-line bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              As divisões deste empreendimento têm política diferente entre si no C2X. Os números
              abaixo são os de {ref?.code ?? ref?.enterpriseId}; confira divisão a divisão antes de
              usá-los como referência.
            </span>
          </p>
        ) : null}

        <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Campo label="Comissão total" valor={pct(ref?.comissaoTotal ?? null)} />
          <Campo label="Entrada mínima" valor={pct(ref?.entradaMinima ?? null)} />
          <Campo
            label="Parcelas do sinal"
            valor={ref?.maxParcelasSinal === null || ref?.maxParcelasSinal === undefined ? "—" : String(ref.maxParcelasSinal)}
          />
          <Campo label="Juros por atraso" valor={pct(ref?.jurosAtraso ?? null)} />
          <Campo label="Multa por atraso" valor={pct(ref?.multaAtraso ?? null)} />
          <Campo
            label="Divisão da parcela no C2X"
            valor={
              ref?.gestaoCarteiraC2x === null || ref?.gestaoCarteiraC2x === undefined
                ? "—"
                : `${pct(ref.gestaoCarteiraC2x)} loteador · ${pct(ref.gestaoCarteiraCareliC2x)} Careli`
            }
          />
        </div>
      </section>

      {/* ── O RATEIO DA CORRETAGEM: o que é NOSSO, e é PALIATIVO ──────────
          Lucas (08/09/2026): *"em janeiro vamos migrar o financeiro, ou seja até lá, vamos fazer um
          paliativo, nessa tela coloca comissão para coordenadora e imobiliária, vou apontar e vc
          tira esse valor do valor total vendido. mas isso é paliativo"*.

          ⚠️ FICA FORA DO BLOCO DO CADEADO de propósito: "Comissão e entrada" vem do C2X e só muda
          lá; estes três campos nascem no Apolo e o operador edita aqui. Juntá-los num bloco só
          ensinaria que o cadeado é decorativo. */}
      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex items-start gap-3 border-b border-line bg-subtle/40 px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-inverse text-brand-ink">
            <Handshake aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h4 className="m-0 text-sm font-semibold text-ink">Rateio da corretagem</h4>
            <p className="m-0 mt-0.5 text-xs text-ink-muted">
              É o que o contrato de corretagem imprime; é cadastro do Panteon, não do C2X, e vale
              até a migração do financeiro em janeiro.
            </p>
          </div>
        </div>

        <div className="grid gap-3 px-4 py-4">
          {/* QUEM É A COORDENADORA. Sem ela os percentuais saem calculados e o bloco
              "a. COORDENADORA DE VENDAS" continua com cinco colchetes no papel. */}
          <div className="grid gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Coordenadora de vendas
            </span>

            {coordenadoraId ? (
              <span className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-2 rounded-lg border border-line bg-subtle/40 px-3 py-1.5 text-sm text-ink">
                  <Building2 aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted" />
                  {/* Id que não resolve nome = entidade arquivada ou fundida (a 0145 não criou FK
                      de propósito). Dizer isso é melhor do que mostrar um uuid. */}
                  {coordenadoraNome ?? "Entidade não encontrada: aponte de novo."}
                </span>
                <button
                  aria-label="Remover a coordenadora de vendas"
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-semibold text-ink-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={salvando}
                  onClick={() => void salvarCoordenadora(null, null)}
                  type="button"
                >
                  <X aria-hidden="true" className="size-4" />
                </button>
              </span>
            ) : (
              <span className="grid gap-1.5">
                <span className="flex items-center gap-2">
                  <span className="relative flex h-9 min-w-0 flex-1 items-center sm:max-w-sm">
                    <Search
                      aria-hidden="true"
                      className="pointer-events-none absolute left-3 size-3.5 text-ink-muted"
                    />
                    <input
                      className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-3 text-sm text-ink outline-none focus:border-line-strong"
                      onChange={(evento) => setBuscaCoordenadora(evento.target.value)}
                      placeholder="Procure pelo nome ou CNPJ"
                      value={buscaCoordenadora}
                    />
                  </span>
                  {buscando ? (
                    <Loader2 aria-hidden="true" className="size-4 animate-spin text-ink-muted" />
                  ) : null}
                </span>

                {achados.length > 0 ? (
                  <span className="grid gap-1 rounded-lg border border-line bg-subtle/30 p-1 sm:max-w-sm">
                    {achados.map((entidade) => (
                      <button
                        className="flex items-baseline justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm text-ink transition-colors hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={salvando}
                        key={entidade.id}
                        onClick={() => void salvarCoordenadora(entidade.id, entidade.nome)}
                        type="button"
                      >
                        <span className="min-w-0 truncate">{entidade.nome}</span>
                        <span className="shrink-0 text-[11px] tabular-nums text-ink-muted">
                          {entidade.documento}
                        </span>
                      </button>
                    ))}
                  </span>
                ) : null}

                <span className="text-xs text-ink-soft">
                  Não cadastrada: o contrato de corretagem sai com o bloco da coordenadora em
                  branco (nome, CNPJ, endereço, telefone e e-mail).
                </span>
              </span>
            )}
          </div>

          <div className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                Comissão da coordenadora (%)
              </span>
              <span className="flex items-center gap-2">
                <input
                  className="h-9 w-28 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-line-strong"
                  inputMode="decimal"
                  onChange={(evento) =>
                    setRascunhoCoordenadora((atual) =>
                      ref ? { ...atual, [ref.enterpriseId]: evento.target.value } : atual,
                    )
                  }
                  placeholder="1,5"
                  value={valorDaCoordenadora}
                />
                <button
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={salvando}
                  onClick={() => void salvar(valorDaCoordenadora, "coordenadora")}
                  type="button"
                >
                  {salvando ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                  Salvar
                </button>
              </span>
            </label>

            <label className="grid gap-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                Comissão da imobiliária (%)
              </span>
              <span className="flex items-center gap-2">
                <input
                  className="h-9 w-28 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-line-strong"
                  inputMode="decimal"
                  onChange={(evento) =>
                    setRascunhoImobiliaria((atual) =>
                      ref ? { ...atual, [ref.enterpriseId]: evento.target.value } : atual,
                    )
                  }
                  placeholder="4,5"
                  value={valorDaImobiliaria}
                />
                <button
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={salvando}
                  onClick={() => void salvar(valorDaImobiliaria, "imobiliaria")}
                  type="button"
                >
                  {salvando ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                  Salvar
                </button>
              </span>
            </label>
          </div>

          {/* ⚠️ A SOMA É A CONFERÊNCIA. As duas são sobre o valor VENDIDO, a mesma base do
              `total_value_commission` do C2X — então o total daqui deveria bater com o de lá.
              Com as duas nulas o texto diz "não cadastrado", nunca 0%: zero afirmaria que ninguém
              recebe comissão neste empreendimento, decisão que ninguém tomou. */}
          <p className="m-0 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg bg-subtle px-3 py-2 text-xs text-ink-soft">
            <span className="font-semibold text-ink">
              Comissão total do contrato:{" "}
              {comissaoDoContrato === null ? "não cadastrado" : pct(comissaoDoContrato)}
            </span>
            {comissaoDoC2x === null ? null : <span>O C2X registra {pct(comissaoDoC2x)}.</span>}
            {somaDivergeDoC2x ? (
              <span className="font-medium text-amber-700 dark:text-amber-300">
                Os dois não batem: confira de que lado está o erro.
              </span>
            ) : null}
          </p>

          {comissaoDoContrato !== null &&
          (comissaoCoordenadora === null || comissaoImobiliaria === null) ? (
            <p className="m-0 flex items-start gap-2 rounded-lg bg-subtle px-3 py-2 text-xs text-ink-soft">
              <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              Falta uma das duas pontas:{" "}
              {comissaoCoordenadora === null ? "a coordenadora" : "a imobiliária"} está sem
              percentual, e o contrato sai com essa linha em branco. Zero é uma decisão válida e
              precisa ser digitada — vazio é lacuna.
            </p>
          ) : null}
        </div>
      </section>

      {/* ── O SPLIT CADASTRADO NO C2X: o rateio de VERDADE, que vem para o Panteon com a migração
          do financeiro. Continua read-only, como o bloco do cadeado acima. */}
      {(ref?.splitCadastrado.length ?? 0) > 0 ? (
        <section className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex items-start gap-3 border-b border-line bg-subtle/40 px-4 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-subtle text-ink-muted">
              <Lock aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0">
              <h4 className="m-0 text-sm font-semibold text-ink">Divisão do pagamento (split)</h4>
              <p className="m-0 mt-0.5 text-xs text-ink-muted">
                É este cadastro que gera os boletos e define quanto cada um recebe. Cada tipo de
                pagamento divide 100% do valor. Vem do C2X e só muda lá.
                {ref?.splitNome ? ` Split ativo: ${ref.splitNome}.` : ""}
              </p>
            </div>
          </div>

          <div className="px-4 py-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {ref?.splitCadastrado.map((grupo) => {
                const fecha = Math.abs(grupo.total - 100) <= 0.01;
                return (
                  <div
                    className="overflow-hidden rounded-xl border border-line bg-subtle/30"
                    key={grupo.grupo}
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                      <span className="text-xs font-semibold text-ink">{grupo.grupo}</span>
                      {/* Se não fecha 100%, o rateio está incompleto e o boleto sai errado. */}
                      <span
                        className={
                          fecha
                            ? "text-[11px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-300"
                            : "text-[11px] font-semibold tabular-nums text-amber-700 dark:text-amber-300"
                        }
                      >
                        {grupo.total.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%
                        {fecha ? "" : " ⚠"}
                      </span>
                    </div>
                    <div className="grid gap-1.5 px-3 py-2.5">
                      {grupo.linhas.map((linha, indice) => (
                        <div
                          className="flex items-baseline justify-between gap-3 text-sm"
                          key={`${linha.perfil}-${indice}`}
                        >
                          <span className="min-w-0">
                            <span className="text-ink">{linha.perfil}</span>
                            {linha.quemRecebe ? (
                              <span className="block truncate text-[11px] text-ink-muted">
                                {linha.quemRecebe}
                              </span>
                            ) : null}
                          </span>
                          <span className="shrink-0 tabular-nums text-ink">
                            {linha.percentual === null
                              ? linha.fixo === null
                                ? "—"
                                : linha.fixo.toLocaleString("pt-BR", {
                                    currency: "BRL",
                                    style: "currency",
                                  })
                              : pct(linha.percentual)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}

      {/* ── O QUE ESTÁ FURADO, quando está ──────────────────────────────── */}
      {avisosUnicos.length > 0 ? (
        <section className="overflow-hidden rounded-2xl border border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex items-start gap-3 px-4 py-3">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300"
            />
            <div className="min-w-0">
              <h4 className="m-0 text-sm font-semibold text-amber-900 dark:text-amber-200">
                Confira a política de {name} ({code})
              </h4>
              <ul className="m-0 mt-1.5 grid list-disc gap-1 pl-4 text-xs text-amber-900 dark:text-amber-200">
                {avisosUnicos.map((texto) => (
                  <li key={texto}>{texto}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}
      </div>
    </div>
  );
}

function Campo({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-xl border border-line bg-subtle/40 px-3 py-2.5">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      <span className="mt-1 block text-sm font-semibold tabular-nums text-ink">{valor}</span>
    </div>
  );
}
