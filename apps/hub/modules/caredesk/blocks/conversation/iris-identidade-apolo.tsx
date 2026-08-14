"use client";

import {
  AlertTriangle,
  Check,
  ExternalLink,
  Link2,
  Loader2,
  Pencil,
  RefreshCw,
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
  /**
   * Avisa o painel de quem é este contato, para os campos Cliente, CPF/CNPJ e E-mail deixarem de
   * mostrar "-" quando a ficha existe. Era o caso da Ilza: o bloco dizia "Cadastrado" e o campo
   * Cliente logo abaixo continuava vazio, porque ele só olhava o phone-match.
   */
  onIdentidade?: (identidade: IdentidadeDoContato) => void;
  /** Muda de valor quando o cockpit grava algo: força reconsultar em vez de mostrar o estado
   *  velho. Sem isto o operador cadastra e continua lendo "Sem cadastro". */
  recarregar?: number;
  onEditar?: (entidadeId: string) => void;
  onVincular?: (dados: { nome: null | string; telefone: string }) => void;
  telefone: null | string;
};

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
  onEditar,
  onIdentidade,
  onVincular,
  recarregar,
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
      const resultado: IdentidadeDoContato =
        resposta.ok && corpo?.data
          ? corpo.data
          : { estado: "indisponivel", motivo: "Não foi possível consultar o Apolo agora." };

      setIdentidade(resultado);
      onIdentidade?.(resultado);
    } catch {
      const falha: IdentidadeDoContato = {
        estado: "indisponivel",
        motivo: "Não foi possível consultar o Apolo agora.",
      };
      setIdentidade(falha);
      onIdentidade?.(falha);
    }
    setCarregando(false);
  }, [getAccessToken, onIdentidade, telefone]);

  useEffect(() => {
    void carregar();
    // `recarregar` entra de propósito: é o sinal de que o cockpit acabou de gravar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregar, recarregar]);

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
    Icone: typeof Link2,
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
    // UMA LINHA e o botão (pedido do Lucas, 14/08). Papel, perfil e vínculos saíram daqui e vão
    // no FORMULÁRIO: no painel eles empurravam para baixo o que o operador lê o tempo todo
    // (telefone, e-mail, assunto), e só interessam na hora de conferir ou corrigir o cadastro.
    // Os dados em si não se perdem: o nome e o documento passam a preencher os campos Cliente e
    // CPF/CNPJ logo abaixo, via onIdentidade.
    return moldura(
      <>
        {titulo}
        <div className="flex items-center justify-between gap-3 px-4 pb-3 pt-1.5">
          <p className="m-0 flex min-w-0 items-center gap-1.5 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            <Check aria-hidden="true" className="size-4 shrink-0" />
            Cadastrado no Apolo
          </p>
          {/* Só aparece quando REALMENTE edita. `() => onEditar?.(...)` seria uma função sempre
              definida: o botão apareceria mesmo sem handler e não faria nada ao clicar, que é o
              tipo de detalhe que faz o operador achar que o sistema travou. */}
          {botao(
            "Editar",
            Pencil,
            onEditar ? () => onEditar(identidade.entidadeId) : undefined,
          )}
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
            {/* Sem ficha própria: quem cria é o Apolo. Daqui o operador só abre o cadastro lá. */}
            <a
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#A07C3B] bg-[#A07C3B] px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#8d6c33]"
              href="/apolo"
              rel="noreferrer"
              target="_blank"
            >
              <ExternalLink aria-hidden="true" className="size-3.5" />
              Cadastrar no Apolo
            </a>
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
          {/* Ficha nova é no Apolo; aqui o operador só é levado até lá. */}
          <a
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#A07C3B] bg-[#A07C3B] px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[#8d6c33]"
            href="/apolo"
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink aria-hidden="true" className="size-3.5" />
            Cadastrar no Apolo
          </a>
          {botao(
            "Vincular a alguém",
            Link2,
            onVincular
              ? () => onVincular({ nome: nomeDoContato ?? null, telefone: telefone ?? "" })
              : undefined,
          )}
        </div>
      </div>
    </>,
    "border-line/70 bg-surface",
  );
}
