"use client";

import { ClipboardList, Loader2, Lock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

// Só TIPOS do lib do Apolo: `empreendimentos.ts` é server-side (mysql2).
import type { ApoloEnterpriseUnit } from "@/lib/apolo/empreendimentos";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

import { AnexosDoContrato } from "./anexos-do-contrato";
import { VinculoDaUnidade } from "./categoria-da-unidade";
import { lerUniverso, type Universo } from "./vinculo-de-unidades";

// O CADASTRO DE UMA UNIDADE — a ficha do lote, dentro da aba Unidades.
//
// Lucas (21/09/2026): *"dentro da unidade eu preciso ter as abas de resumo (é o que temos hoje que
// traz os status, quem foi vendido) e preciso ter a aba cadastro de unidade a qual vai ter o
// cadastro daquela unidade a qual eu posso fazer a vinculação das categorias, inserir os anexos se
// for o caso"*.
//
// ⚠️ TRÊS ASSUNTOS, UMA TELA, E CADA UM COM A SUA PORTA. Os dados do lote (área, preço, matrícula)
// vão pela porta do cadastro de unidades do Panteon; o filho e a categoria vão pela porta do
// vínculo; os anexos vão pela porta da Têmis. Juntá-los numa rota só duplicaria três réguas —
// a da carga do C2X, a do gêmeo do terreno e a do alcance do anexo.
//
// ⚠️ O UNIVERSO É LIDO UMA VEZ SÓ, AQUI, e desce para o bloco do vínculo. É a mesma resposta que
// diz a categoria de hoje, as divisões da família e de qual delas a unidade é — e é essa divisão
// que a edição dos dados precisa para falar com a porta do cadastro.

/** A porta do hub para o cadastro de unidade que vive no Panteon. */
const ROTA_DO_PANTEON = "/api/apolo/empreendimentos/unidades/panteon";

type Props = {
  /** O código do produto na tela, para o servidor resolver a ficha consolidada. */
  codigo?: null | string;
  /** O id do produto como a ficha o conhece ("31", "pai:<uuid>" ou "group:Lagoa Bonita"). */
  enterpriseId: string;
  /** Relê a tabela de unidades. */
  recarregar: () => void;
  unidade: ApoloEnterpriseUnit;
};

const CAMPO =
  "h-9 w-full rounded-lg border border-line bg-surface px-2.5 text-xs text-ink outline-none";

const ROTULO =
  "mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-ink-muted";

/** O número como o campo brasileiro o escreve ("300,5"). Vazio quando não há valor. */
function paraCampo(n: null | number | undefined): string {
  if (n === null || n === undefined) return "";
  return String(n).replace(".", ",");
}

const SO_DIGITOS = (texto: string) =>
  [...texto].filter((c) => c >= "0" && c <= "9").join("");

/**
 * DINHEIRO SEMPRE COM CARA DE DINHEIRO (Lucas, 21/09/2026: *"onde estiver valor sempre trazer
 * formatação de moeda"*). O campo mostra "432.808,00" e é esse texto que viaja: do outro lado,
 * `numeroBR` tira o que não é número e trata o ponto como milhar quando existe vírgula.
 */
function paraMoeda(n: null | number | undefined): string {
  if (n === null || n === undefined) return "";
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

/** Reescreve o que o operador digita a cada tecla: os dois últimos dígitos são os centavos. */
function moedaEnquantoDigita(texto: string): string {
  const digitos = SO_DIGITOS(texto).slice(0, 12);
  if (!digitos) return "";
  return (Number(digitos) / 100).toLocaleString("pt-BR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

/**
 * O número que o campo representa, para comparar com o gravado.
 *
 * ⚠️ A COMPARAÇÃO É POR NÚMERO, E NÃO POR TEXTO: "432808" e "432.808,00" são o mesmo valor, e
 * comparar o texto acenderia o botão Salvar só porque a tela formatou o que já estava lá.
 */
function numeroDoCampo(texto: string): null | number {
  const limpo = texto.replace(/[.]/g, "").replace(",", ".");
  const n = Number(limpo.trim());
  return limpo.trim() && Number.isFinite(n) ? n : null;
}

export function CadastroDaUnidade({ codigo, enterpriseId, recarregar, unidade }: Props) {
  const panteonId = unidade.panteonId ? String(unidade.panteonId) : "";
  const [universo, setUniverso] = useState<null | Universo>(null);
  const [erroDoUniverso, setErroDoUniverso] = useState<null | string>(null);

  const carregarUniverso = useCallback(async () => {
    const r = await lerUniverso({ codigo, enterpriseId });
    if ("erro" in r) {
      setErroDoUniverso(r.erro);
      return;
    }
    setErroDoUniverso(null);
    setUniverso(r.data);
  }, [codigo, enterpriseId]);

  useEffect(() => {
    void carregarUniverso();
  }, [carregarUniverso]);

  const linha = universo?.unidades.find((u) => u.id === panteonId) ?? null;
  // ⚠️ A DIVISÃO DA UNIDADE, E NÃO O PRODUTO DA FICHA: a porta do cadastro recusa o pai ("este
  // produto é dividido em glebas") e a ficha consolidada nem tem id de empreendimento.
  const divisaoDaUnidade = linha?.enterpriseId ?? null;

  return (
    <div className="grid gap-4">
      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <header className="flex items-start gap-3 border-b border-line bg-subtle/40 px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-inverse text-brand-ink">
            <ClipboardList aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h4 className="m-0 text-sm font-semibold text-ink">{unidade.code}</h4>
            <p className="m-0 mt-0.5 text-xs text-ink-muted">
              {[
                [unidade.block, unidade.lot].filter(Boolean).join(" / "),
                unidade.status,
                unidade.movement?.client?.name ?? null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </header>

        <DadosDoLote
          divisaoDaUnidade={divisaoDaUnidade}
          panteonId={panteonId}
          recarregar={recarregar}
          unidade={unidade}
        />
      </section>

      {erroDoUniverso ? (
        <p className="m-0 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          {erroDoUniverso}
        </p>
      ) : null}

      <VinculoDaUnidade
        aoGravar={recarregar}
        codigo={codigo}
        enterpriseId={enterpriseId}
        recarregarUniverso={carregarUniverso}
        unidade={unidade}
        universo={universo}
      />

      {/* ⚠️ O ANEXO DA UNIDADE PRECISA DA LINHA DO PANTEON: `temis_anexos.unidade_id` referencia
          `hercules_unidades`, e sem ela não há a quem pendurar a peça. */}
      {panteonId && !unidade.semCadastroNoPanteon ? (
        <AnexosDoContrato
          codigo={codigo}
          enterpriseId={enterpriseId}
          unidade={{ id: panteonId, rotulo: unidade.code }}
        />
      ) : null}
    </div>
  );
}

/**
 * ÁREA, PREÇO E MATRÍCULA DO LOTE.
 *
 * ⚠️ QUEM DIZ SE DÁ PARA EDITAR É O SERVIDOR, e não uma régua escrita aqui. A tela pergunta
 * (`acao: "modelo"`) e, quando a resposta é uma recusa, mostra a frase dela: o produto cujo estoque
 * ainda é mantido pela carga do C2X responde *"o cadastro dela ainda não é corrigido por aqui"*, e
 * essa é a verdade que o operador precisa ler. Uma régua de tela diria a mesma coisa hoje e passaria
 * a mentir no dia em que o produto ganhasse dono.
 */
function DadosDoLote({
  divisaoDaUnidade,
  panteonId,
  recarregar,
  unidade,
}: {
  divisaoDaUnidade: null | string;
  panteonId: string;
  recarregar: () => void;
  unidade: ApoloEnterpriseUnit;
}) {
  const [tipoProduto, setTipoProduto] = useState<null | "loteamento" | "vertical">(null);
  const [recusa, setRecusa] = useState<null | string>(null);
  const [perguntando, setPerguntando] = useState(false);
  const [area, setArea] = useState("");
  const [preco, setPreco] = useState("");
  const [matricula, setMatricula] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<null | string>(null);
  const [recado, setRecado] = useState<null | string>(null);

  // O que está gravado manda nos campos: o efeito roda de novo quando a tabela é relida.
  useEffect(() => {
    setArea(paraCampo(unidade.area));
    setPreco(paraMoeda(unidade.price));
    setMatricula(unidade.registration ?? "");
    setRecado(null);
    setErro(null);
  }, [unidade.area, unidade.price, unidade.registration, unidade.id]);

  useEffect(() => {
    let vivo = true;
    if (!divisaoDaUnidade || !panteonId) return;

    async function perguntar(produto: string) {
      setPerguntando(true);
      try {
        const token = await getApoloAccessToken();
        const resposta = await fetch(ROTA_DO_PANTEON, {
          body: JSON.stringify({ acao: "modelo", enterpriseId: produto }),
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          method: "POST",
        });
        const corpo = (await resposta.json().catch(() => ({}))) as {
          data?: { produto?: { tipoProduto?: string } };
          error?: string;
        };
        if (!vivo) return;
        if (!resposta.ok) {
          setRecusa(corpo.error ?? "O cadastro deste lote não é editado por aqui.");
          return;
        }
        setRecusa(null);
        setTipoProduto(corpo.data?.produto?.tipoProduto === "vertical" ? "vertical" : "loteamento");
      } catch {
        if (vivo) setRecusa("Não foi possível conferir se este lote pode ser editado agora.");
      } finally {
        if (vivo) setPerguntando(false);
      }
    }

    void perguntar(divisaoDaUnidade);
    return () => {
      vivo = false;
    };
  }, [divisaoDaUnidade, panteonId]);

  const mudou =
    numeroDoCampo(area) !== (unidade.area ?? null) ||
    numeroDoCampo(preco) !== (unidade.price ?? null) ||
    matricula !== (unidade.registration ?? "");

  async function salvar() {
    if (!divisaoDaUnidade) return;
    const campos: Record<string, string> = {};
    if (numeroDoCampo(area) !== (unidade.area ?? null)) campos.area = area.trim();
    if (numeroDoCampo(preco) !== (unidade.price ?? null)) campos.preco = preco.trim();
    if (matricula !== (unidade.registration ?? "")) campos.matricula = matricula.trim();
    if (Object.keys(campos).length === 0) return;

    setSalvando(true);
    setErro(null);
    setRecado(null);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch(ROTA_DO_PANTEON, {
        body: JSON.stringify({
          acao: "atualizar",
          campos,
          enterpriseId: divisaoDaUnidade,
          unidadeId: panteonId,
        }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const corpo = (await resposta.json().catch(() => ({}))) as {
        data?: { avisos?: Record<string, string> };
        error?: string;
      };
      if (!resposta.ok) {
        setErro(corpo.error ?? "Não foi possível salvar o cadastro do lote.");
        return;
      }
      const avisos = Object.values(corpo.data?.avisos ?? {}).filter(Boolean);
      setRecado(avisos.length > 0 ? avisos.join(" ") : "Cadastro salvo.");
      recarregar();
    } catch {
      setErro("Não foi possível salvar o cadastro do lote agora.");
    } finally {
      setSalvando(false);
    }
  }

  if (unidade.semCadastroNoPanteon || !panteonId) {
    return (
      <p className="m-0 px-4 py-3 text-xs text-ink-muted">
        Esta unidade ainda não entrou no cadastro do Panteon. Até a próxima sincronização, área,
        preço e matrícula são os que vieram na carga.
      </p>
    );
  }

  const bloqueado = Boolean(recusa) || perguntando || !divisaoDaUnidade;

  return (
    <div className="grid gap-3 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={ROTULO} htmlFor="cadastro-area">
            {tipoProduto === "vertical" ? "Área privativa (m²)" : "Área (m²)"}
          </label>
          <input
            className={CAMPO}
            disabled={bloqueado || salvando}
            id="cadastro-area"
            inputMode="decimal"
            onChange={(e) => setArea(e.target.value)}
            placeholder="300,00"
            value={area}
          />
        </div>
        <div>
          <label className={ROTULO} htmlFor="cadastro-preco">
            Valor de tabela (R$)
          </label>
          <input
            className={CAMPO}
            disabled={bloqueado || salvando}
            id="cadastro-preco"
            inputMode="decimal"
            onChange={(e) => setPreco(moedaEnquantoDigita(e.target.value))}
            placeholder="140.401,00"
            value={preco}
          />
        </div>
        <div>
          <label className={ROTULO} htmlFor="cadastro-matricula">
            Matrícula
          </label>
          <input
            className={CAMPO}
            disabled={bloqueado || salvando}
            id="cadastro-matricula"
            onChange={(e) => setMatricula(e.target.value)}
            value={matricula}
          />
        </div>
      </div>

      {recusa ? (
        <p className="m-0 flex items-start gap-1.5 rounded-lg border border-dashed border-line px-3 py-2 text-[11px] text-ink-muted">
          <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          {recusa}
        </p>
      ) : (
        <p className="m-0 text-[11px] text-ink-muted">
          Quadra, lote e situação não mudam por aqui: a identificação é a chave que o contrato e o
          espelho já usam, e reserva, venda e bloqueio têm caminho próprio.
        </p>
      )}

      {erro ? (
        <p className="m-0 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-300">
          {erro}
        </p>
      ) : null}

      {recado ? (
        <p className="m-0 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
          {recado}
        </p>
      ) : null}

      <div className="flex justify-end">
        <button
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-bold text-brand-ink disabled:opacity-60"
          disabled={bloqueado || salvando || !mudou}
          onClick={() => void salvar()}
          type="button"
        >
          {salvando ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
          Salvar dados do lote
        </button>
      </div>
    </div>
  );
}
