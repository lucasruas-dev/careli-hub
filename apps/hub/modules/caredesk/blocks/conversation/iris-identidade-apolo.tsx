"use client";

import {
  AlertTriangle,
  Building2,
  Check,
  Link2,
  Loader2,
  Pencil,
  RefreshCw,
  UserPlus,
  UserRound,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { IdentidadeDoContato } from "@/lib/iris/apolo/identidade-contato";

// CADASTRO NO APOLO — o primeiro bloco da aba Cliente do cockpit.
//
// Antes desta tela, o operador não tinha como saber se quem está do outro lado tem ficha no
// Apolo. O painel mostrava nome e telefone e, quando não conseguia resolver o cadastro, exibia
// traços — o MESMO desenho de quem realmente não tem cadastro. Duas situações opostas com a
// mesma cara: ou o operador duplicava ficha de alguém que já existe, ou tratava como estranho
// quem é corretor parceiro há meses.
//
// Aqui cada estado tem cara própria, inclusive o de falha. "Não consegui verificar" nunca é
// desenhado como "não tem cadastro".

type Props = {
  /** O token da sessão da Iris vem por prop, como nos outros blocos: o helper mora no IrisPage. */
  getAccessToken: () => Promise<string>;
  /** Nome que veio do WhatsApp, para pré-preencher o cadastro rápido. */
  nomeDoContato?: null | string;
  onCadastrar?: (dados: { nome: null | string; telefone: string }) => void;
  onEditar?: (entidadeId: string) => void;
  onVincular?: (dados: { nome: null | string; telefone: string }) => void;
  telefone: null | string;
};

const ROTULO_PAPEL: Record<string, string> = {
  acesso_incorporador: "Acesso de incorporador",
  colaborador: "Colaborador",
  corretor: "Corretor",
  imobiliaria: "Imobiliária",
  incorporador: "Incorporador",
  pessoa_fisica: "Pessoa física",
  pessoa_juridica: "Pessoa jurídica",
  prospect: "Prospect",
  usuario: "Usuário",
};

/** Papéis que descrevem o CADASTRO, não o que a pessoa é para o negócio. Escondidos: dizer que
 *  alguém é "pessoa física" e "usuário" ocupa a linha e não informa nada ao operador. */
const PAPEL_TECNICO = new Set(["pessoa_fisica", "pessoa_juridica", "usuario"]);

const ROTULO_VINCULO: Record<string, string> = {
  conjuge: "cônjuge",
  corretor: "corretor",
  empreendimento: "trabalha em",
  representante_legal: "representante legal",
  socio: "sócio",
};

function rotuloDoVinculo(tipo: string): string {
  const chave = tipo.toLowerCase().trim();
  return ROTULO_VINCULO[chave] ?? tipo;
}

export function IrisIdentidadeApolo({
  getAccessToken,
  nomeDoContato,
  onCadastrar,
  onEditar,
  onVincular,
  telefone,
}: Props) {
  const [identidade, setIdentidade] = useState<IdentidadeDoContato | null>(null);
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    if (!telefone?.trim()) {
      setIdentidade({ estado: "nenhum" });
      return;
    }

    setCarregando(true);
    try {
      const token = await getAccessToken();
      const resposta = await fetch(
        `/api/iris/apolo/identidade?telefone=${encodeURIComponent(telefone)}`,
        { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
      );
      const corpo = (await resposta.json().catch(() => null)) as {
        data?: IdentidadeDoContato;
      } | null;

      // Falha vira ESTADO, não um painel vazio: o operador precisa saber que ninguém olhou.
      setIdentidade(
        resposta.ok && corpo?.data
          ? corpo.data
          : { estado: "indisponivel", motivo: "Não foi possível consultar o Apolo agora." },
      );
    } catch {
      setIdentidade({
        estado: "indisponivel",
        motivo: "Não foi possível consultar o Apolo agora.",
      });
    }
    setCarregando(false);
  }, [getAccessToken, telefone]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const moldura = (conteudo: React.ReactNode, cor: string) => (
    <div className={`overflow-hidden rounded-xl border ${cor}`}>{conteudo}</div>
  );

  const titulo = (
    <div className="flex items-center justify-between gap-2 px-4 pt-3">
      <span className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-ink-soft">
        Cadastro no Apolo
      </span>
      <button
        aria-label="Verificar de novo"
        className="text-ink-soft transition-colors hover:text-ink disabled:opacity-40"
        disabled={carregando}
        onClick={() => void carregar()}
        type="button"
      >
        {carregando ? (
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
        ) : (
          <RefreshCw aria-hidden="true" className="size-3.5" />
        )}
      </button>
    </div>
  );

  const botao = (
    rotulo: string,
    Icone: typeof UserPlus,
    onClick: (() => void) | undefined,
    destaque?: boolean,
  ) =>
    onClick ? (
      <button
        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
          destaque
            ? "border-[#A07C3B] bg-[#A07C3B] text-white hover:bg-[#8d6c33]"
            : "border-line text-ink hover:bg-subtle"
        }`}
        onClick={onClick}
        type="button"
      >
        <Icone aria-hidden="true" className="size-3.5" />
        {rotulo}
      </button>
    ) : null;

  if (!identidade || (carregando && !identidade)) {
    return moldura(
      <>
        {titulo}
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-ink-soft">
          <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          Verificando…
        </div>
      </>,
      "border-line/70 bg-surface",
    );
  }

  if (identidade.estado === "indisponivel") {
    // ⚠️ Cara PRÓPRIA, diferente de "não tem cadastro". O operador não deve cadastrar ninguém
    // baseado nesta tela: pode existir ficha e a consulta é que falhou.
    return moldura(
      <>
        {titulo}
        <div className="px-4 pb-3 pt-1.5">
          <p className="m-0 flex items-start gap-2 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              Não foi possível verificar agora. <strong>Não cadastre</strong> sem conferir: pode
              existir ficha.
            </span>
          </p>
          <div className="mt-2.5">
            {botao("Tentar de novo", RefreshCw, () => void carregar())}
          </div>
        </div>
      </>,
      "border-amber-300 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/[0.06]",
    );
  }

  if (identidade.estado === "entidade") {
    const papeis = identidade.papeis
      .map((papel) => papel.profile)
      .filter((papel) => !PAPEL_TECNICO.has(papel));

    return moldura(
      <>
        {titulo}
        <div className="px-4 pb-3 pt-1.5">
          <p className="m-0 flex items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            <Check aria-hidden="true" className="size-4" />
            Cadastrado
          </p>
          <p className="m-0 mt-1 text-sm font-semibold text-ink">{identidade.nome}</p>
          {identidade.documentoMascarado ? (
            <p className="m-0 text-xs text-ink-soft">{identidade.documentoMascarado}</p>
          ) : null}

          {papeis.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {papeis.map((papel) => (
                <span
                  className="rounded-full border border-[#A07C3B]/30 bg-[#A07C3B]/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-[#7A5E2C] dark:text-[#d9b877]"
                  key={papel}
                >
                  {ROTULO_PAPEL[papel] ?? papel}
                </span>
              ))}
            </div>
          ) : null}

          {identidade.vinculos.length ? (
            <div className="mt-2.5 space-y-1">
              {identidade.vinculos.slice(0, 4).map((vinculo, indice) => (
                <p
                  className="m-0 flex items-center gap-1.5 text-xs text-ink-soft"
                  key={`${vinculo.tipo}-${vinculo.entidadeId ?? indice}`}
                >
                  <Building2 aria-hidden="true" className="size-3 shrink-0" />
                  <span className="truncate">
                    {rotuloDoVinculo(vinculo.tipo)}
                    {vinculo.entidade ? ` · ${vinculo.entidade}` : ""}
                  </span>
                </p>
              ))}
              {identidade.vinculos.length > 4 ? (
                <p className="m-0 text-[11px] text-ink-soft">
                  e mais {identidade.vinculos.length - 4}
                </p>
              ) : null}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2">
            {botao("Editar cadastro", Pencil, () => onEditar?.(identidade.entidadeId))}
          </div>
        </div>
      </>,
      "border-emerald-300/70 bg-emerald-50/50 dark:border-emerald-500/25 dark:bg-emerald-500/[0.05]",
    );
  }

  if (identidade.estado === "vinculo") {
    return moldura(
      <>
        {titulo}
        <div className="px-4 pb-3 pt-1.5">
          <p className="m-0 flex items-center gap-1.5 text-sm font-semibold text-blue-700 dark:text-blue-300">
            <Link2 aria-hidden="true" className="size-4" />
            Sem ficha própria, mas conhecido
          </p>
          {identidade.nome ? (
            <p className="m-0 mt-1 text-sm font-semibold text-ink">{identidade.nome}</p>
          ) : null}
          <div className="mt-1.5 space-y-1">
            {identidade.vinculos.slice(0, 4).map((vinculo, indice) => (
              <p
                className="m-0 text-xs text-ink-soft"
                key={`${vinculo.tipo}-${vinculo.entidadeId ?? indice}`}
              >
                É <strong className="text-ink">{rotuloDoVinculo(vinculo.tipo)}</strong>
                {vinculo.entidade ? (
                  <>
                    {" "}
                    de <span className="text-ink">{vinculo.entidade}</span>
                  </>
                ) : null}
              </p>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {botao(
              "Criar ficha própria",
              UserPlus,
              () =>
                onCadastrar?.({
                  nome: identidade.nome ?? nomeDoContato ?? null,
                  telefone: telefone ?? "",
                }),
              true,
            )}
          </div>
        </div>
      </>,
      "border-blue-300/70 bg-blue-50/50 dark:border-blue-500/25 dark:bg-blue-500/[0.05]",
    );
  }

  return moldura(
    <>
      {titulo}
      <div className="px-4 pb-3 pt-1.5">
        <p className="m-0 flex items-center gap-1.5 text-sm font-semibold text-ink">
          <UserRound aria-hidden="true" className="size-4 text-ink-soft" />
          Sem cadastro
        </p>
        <p className="m-0 mt-1 text-xs text-ink-soft">
          Este telefone não aparece em nenhuma ficha nem como contato de alguém.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {botao(
            "Cadastrar",
            UserPlus,
            () => onCadastrar?.({ nome: nomeDoContato ?? null, telefone: telefone ?? "" }),
            true,
          )}
          {botao("Vincular a alguém", Link2, () =>
            onVincular?.({ nome: nomeDoContato ?? null, telefone: telefone ?? "" }),
          )}
        </div>
      </div>
    </>,
    "border-line/70 bg-surface",
  );
}
