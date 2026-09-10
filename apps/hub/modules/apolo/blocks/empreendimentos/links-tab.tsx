"use client";

import {
  Building2,
  Check,
  Copy,
  ExternalLink,
  Map as MapIcon,
  TriangleAlert,
  UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type {
  ChaveDoLink,
  LinkPublico,
} from "@/lib/hercules/links-do-empreendimento";

// A ABA LINKS — os três links públicos do empreendimento, prontos para copiar.
//
// Lucas (10/09/2026): *"ja cria a aba dos link"* · *"vai ter o espelho - cads - imobiliaria"* ·
// *"no perfil da gurgel vai ficar dentro de produtos, dentro do empreendimento"* · *"no apolo a
// mesma coisa, dentro de empreendimento"*.
//
// ⚠️ ESTE COMPONENTE MORA NA PASTA DO APOLO E É USADO NOS DOIS LUGARES. É o padrão da casa —
// `KpiCard`, `ResumoTab` e `UnidadesTab` já fazem essa viagem para a ficha do Hércules. Mexer
// aqui muda o portal da Gurgel em produção junto com o Apolo.
//
// ⚠️ A BUSCA VEM DE FORA, DE PROPÓSITO. As duas telas leem por portas diferentes e com
// autenticações diferentes: o Apolo em `/api/apolo/empreendimentos/links` com
// `Authorization: Bearer`, o portal em `/api/incorporador/produto/links` com o cookie `apolo_inc`
// e o escopo do token. Esconder isso atrás de um `fonte: string` faria parecer que dá para trocar
// uma pela outra — e a do portal recorta o que a sessão pode ver, a do Apolo não.

type Resposta = { doPai: boolean; links: LinkPublico[] };

const ICONE: Record<ChaveDoLink, typeof MapIcon> = {
  cad: UserPlus,
  espelho: MapIcon,
  imobiliaria: Building2,
};

export function LinksTab({
  buscar,
}: {
  /** Devolve os links já recortados pela porta de cada tela. Lança em erro. */
  buscar: () => Promise<Resposta>;
}) {
  const [dados, setDados] = useState<null | Resposta>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [copiado, setCopiado] = useState<null | ChaveDoLink>(null);

  useEffect(() => {
    let vivo = true;

    buscar()
      .then((r) => {
        if (vivo) {
          setDados(r);
          setErro(null);
        }
      })
      .catch((e: unknown) => {
        if (vivo) {
          setDados(null);
          setErro(e instanceof Error ? e.message : "Não consegui carregar os links.");
        }
      });

    return () => {
      vivo = false;
    };
  }, [buscar]);

  const copiar = useCallback(async (chave: ChaveDoLink, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(chave);
      // Volta sozinho: o "Copiado" é confirmação, não estado da tela.
      setTimeout(() => setCopiado((atual) => (atual === chave ? null : atual)), 1800);
    } catch {
      // Área de transferência bloqueada (http, permissão negada): o link continua na tela,
      // selecionável. Não vale travar a aba por causa disso.
      setCopiado(null);
    }
  }, []);

  if (erro) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-soft">
        {erro}
      </p>
    );
  }

  if (!dados) {
    return (
      <p className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
        Carregando os links…
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      {dados.links.map((link) => {
        const Icone = ICONE[link.chave];
        const ativo = Boolean(link.url);

        return (
          <article
            className="rounded-xl border border-line bg-surface p-4"
            key={link.chave}
          >
            <header className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
                  ativo ? "bg-[#A07C3B]/10 text-[#7A5E2C]" : "bg-subtle text-ink-muted"
                }`}
              >
                <Icone className="size-4" />
              </span>

              <div className="min-w-0 flex-1">
                <h3 className="m-0 text-sm font-semibold text-ink">{link.rotulo}</h3>
                <p className="m-0 mt-0.5 text-xs text-ink-muted">{link.descricao}</p>
              </div>

              {/* ⚠️ O SELO QUE EVITA O ERRO CARO. CAD e imobiliária são links da CASA: não vêm
                  com este empreendimento escolhido. Sem dizer isso, alguém manda o link do CAD
                  "do Garden" e o corretor cadastra no empreendimento errado. */}
              {link.doEmpreendimento ? null : (
                <span className="shrink-0 rounded-md border border-line bg-subtle px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  Link geral
                </span>
              )}
            </header>

            {link.url ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-subtle px-3 py-2 font-mono text-xs text-ink-soft">
                  {link.url}
                </code>

                <button
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#A07C3B] px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-90"
                  onClick={() => void copiar(link.chave, String(link.url))}
                  type="button"
                >
                  {copiado === link.chave ? (
                    <Check aria-hidden="true" className="size-3.5" />
                  ) : (
                    <Copy aria-hidden="true" className="size-3.5" />
                  )}
                  {copiado === link.chave ? "Copiado" : "Copiar"}
                </button>

                <a
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 py-2 text-xs font-semibold text-ink-soft transition-colors hover:text-ink"
                  href={link.url}
                  rel="noreferrer"
                  target="_blank"
                >
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                  Abrir
                </a>
              </div>
            ) : (
              // Desligado, e não escondido: uma linha que some não responde "por que não tem
              // espelho aqui?".
              <p className="mt-3 flex items-start gap-2 rounded-lg border border-line bg-subtle px-3 py-2 text-xs text-ink-muted">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                {link.motivo}
              </p>
            )}
          </article>
        );
      })}

      {/* O aviso do pai fica no rodapé, e não no card: ele explica o conjunto, não um link. */}
      {dados.doPai ? (
        <p className="m-0 px-1 text-xs text-ink-muted">
          O espelho é o mapa do produto pai — o loteamento é um só, e quem recebe o link vê a
          planta inteira. As etapas são divisão interna e não aparecem para quem está de fora.
        </p>
      ) : null}
    </div>
  );
}
