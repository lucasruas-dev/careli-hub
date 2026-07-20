"use client";

import { AlertTriangle, Check, Link2, Loader2, Search } from "lucide-react";
import { useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";

// COMPLETAR VÍNCULOS — corretor, e-mail do corretor e imobiliária das CADs já importadas.
//
// POR QUE ESTA TELA EXISTE: as 392 CADs do Vale do Ouro entraram com `corretor` ZERADO (0 de
// 392) porque a importação rodou antes da leitura da descrição entrar em vigor. O dado sempre
// esteve no Asana; só faltou gravar.
//
// Fluxo obrigatório: CONFERIR (read-only) → o operador olha os números e os ambíguos →
// COMPLETAR. O botão de gravar só habilita depois da conferência, de propósito: valor errado
// gravado aqui é permanente (nada no sistema sobrescreve o corretor depois).
type Plano = {
  ambiguos: { candidatos: string[]; gid: string; nome: string }[];
  amostra: {
    corretor: string | null;
    email: string | null;
    entityId: string;
    imobiliaria: string | null;
    nome: string;
  }[];
  conflitos: { campo: string; entityId: string; nomes: string[]; valores: string[] }[];
  distintos: { corretores: string[]; imobiliarias: string[] };
  escopo: { autorizados: string[]; empreendimento: string };
  grafiasEncontradas: { noAsana: string[]; noBanco: string[] };
  totais: {
    cadsNoEscopo: number;
    comVinculoDeOrigem: number;
    corretorAPreencher: number;
    corretorJaTemValor: number;
    corretorSemDado: number;
    emailAPreencher: number;
    emailJaTemValor: number;
    emailSemDado: number;
    entidadesEmConflito: number;
    foraDeEscopo: number;
    imobiliariaAPreencher: number;
    imobiliariaAmbigua: number;
    imobiliariaPorCampoGenerico: number;
    imobiliariaJaTemValor: number;
    semLinhaNaEsteira: number;
    semVinculoDeOrigem: number;
  };
  vinculoImobiliariaEmpreendimento: {
    cads: number;
    corretores: string[];
    empreendimento: string;
    imobiliaria: string;
  }[];
};

type Resultado = {
  atualizados: { corretor: number; email: number; imobiliaria: number };
  erros: string[];
  pulados: number;
  ultimoEntityId: string | null;
};

export function CompletarVinculos() {
  const [conferindo, setConferindo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [plano, setPlano] = useState<Plano | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const conferir = async () => {
    setConferindo(true);
    setErro(null);
    setResultado(null);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch("/api/apolo/asana/completar-vinculos", {
        cache: "no-store",
        headers: { Authorization: `Bearer ${token}` },
      });
      const corpo = (await resposta.json()) as { data?: Plano; error?: string };
      if (!resposta.ok || !corpo.data) {
        throw new Error(corpo.error ?? `Falha (${resposta.status}).`);
      }
      setPlano(corpo.data);
    } catch (e) {
      setErro((e as Error).message);
      setPlano(null);
    } finally {
      setConferindo(false);
    }
  };

  const completar = async () => {
    if (!plano) return;
    setGravando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch("/api/apolo/asana/completar-vinculos", {
        body: JSON.stringify({ confirmado: true }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "POST",
      });
      const corpo = (await resposta.json()) as { data?: Resultado; error?: string };
      if (!resposta.ok || !corpo.data) {
        throw new Error(corpo.error ?? `Falha (${resposta.status}).`);
      }
      setResultado(corpo.data);
      // Reconfere: os números têm que zerar depois de gravar. Se não zerarem, algo pulou.
      await conferir();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setGravando(false);
    }
  };

  const aGravar = plano
    ? plano.totais.corretorAPreencher +
      plano.totais.emailAPreencher +
      plano.totais.imobiliariaAPreencher
    : 0;

  return (
    <div className="mt-4 max-w-3xl">
      <div className="rounded-xl border border-line bg-surface p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 rounded-lg bg-subtle p-2 text-ink-soft">
            <Link2 size={16} />
          </span>
          <div className="min-w-0">
            <p className="m-0 text-sm font-bold text-ink">
              Completar vínculos das CADs (corretor e imobiliária)
            </p>
            <p className="m-0 mt-1 text-xs text-ink-soft">
              Relê o formulário do Asana e preenche o corretor, o e-mail do corretor e a
              imobiliária que ficaram vazios na importação.
            </p>
            <p className="m-0 mt-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
              Custo zero. Não consulta a MOST e não lê documento.
            </p>
            <p className="m-0 mt-1 text-xs text-ink-muted">
              Escopo travado no <b>Vale do Ouro</b>. Só preenche campo vazio, e a etapa da
              esteira não é alterada.
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-line px-3.5 py-2 text-sm font-bold text-ink hover:bg-subtle disabled:opacity-60"
            disabled={conferindo || gravando}
            onClick={() => void conferir()}
            type="button"
          >
            {conferindo ? <Loader2 className="animate-spin" size={15} /> : <Search size={15} />}
            {conferindo ? "Conferindo…" : "Conferir"}
          </button>

          {/* Só habilita depois da conferência: gravar sem olhar é o que torna erro permanente. */}
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-inverse px-3.5 py-2 text-sm font-bold text-brand-ink disabled:opacity-40"
            disabled={!plano || aGravar === 0 || gravando || conferindo}
            onClick={() => void completar()}
            type="button"
          >
            {gravando ? <Loader2 className="animate-spin" size={15} /> : <Check size={15} />}
            {gravando ? "Completando…" : `Completar ${aGravar}`}
          </button>
        </div>

        {erro ? (
          <p className="m-0 mt-3 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="shrink-0" size={14} />
            {erro}
          </p>
        ) : null}

        {plano ? (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {[
                ["CADs no escopo", plano.totais.cadsNoEscopo],
                ["Com vínculo de origem", plano.totais.comVinculoDeOrigem],
                ["Sem vínculo", plano.totais.semVinculoDeOrigem],
                ["Sem linha na esteira", plano.totais.semLinhaNaEsteira],
                ["Fora de escopo", plano.totais.foraDeEscopo],
              ].map(([label, valor]) => (
                <div className="rounded-lg border border-line bg-subtle/40 px-3 py-2" key={label}>
                  <p className="m-0 text-lg font-bold text-ink">{valor}</p>
                  <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                    {label}
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-[0.68rem] uppercase tracking-wide text-ink-muted">
                    <th className="px-2 py-1.5 font-semibold">Campo</th>
                    <th className="px-2 py-1.5 font-semibold">A preencher</th>
                    <th className="px-2 py-1.5 font-semibold">Já tem valor</th>
                    <th className="px-2 py-1.5 font-semibold">Sem dado / ambíguo</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    [
                      "Corretor",
                      plano.totais.corretorAPreencher,
                      plano.totais.corretorJaTemValor,
                      plano.totais.corretorSemDado,
                    ],
                    [
                      "E-mail do corretor",
                      plano.totais.emailAPreencher,
                      plano.totais.emailJaTemValor,
                      plano.totais.emailSemDado,
                    ],
                    [
                      "Imobiliária",
                      plano.totais.imobiliariaAPreencher,
                      plano.totais.imobiliariaJaTemValor,
                      plano.totais.imobiliariaAmbigua,
                    ],
                  ].map(([label, preencher, tem, resto]) => (
                    <tr
                      className="border-t border-black/[0.06] dark:border-white/[0.07]"
                      key={label}
                    >
                      <td className="px-2 py-2 font-medium text-ink">{label}</td>
                      <td className="px-2 py-2 font-semibold tabular-nums text-ink">
                        {preencher}
                      </td>
                      <td className="px-2 py-2 tabular-nums text-ink-soft">{tem}</td>
                      <td className="px-2 py-2 tabular-nums text-ink-soft">{resto}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Conferência de grafia: se aparecer "VOR" ou "Vale do Ouro II" aqui, o Lucas
                decide o que entra na lista autorizada ANTES de qualquer escrita. */}
            <p className="m-0 mt-3 text-xs text-ink-muted">
              <b className="text-ink-soft">Grafias no Asana:</b>{" "}
              {plano.grafiasEncontradas.noAsana.join(" · ") || "—"}
            </p>
            <p className="m-0 mt-1 text-xs text-ink-muted">
              <b className="text-ink-soft">Grafias no banco:</b>{" "}
              {plano.grafiasEncontradas.noBanco.join(" · ") || "—"}
            </p>

            {/* A escrita MENOS confiável do lote: veio do campo genérico, não do campo do Vale
                do Ouro. Fica visível porque é exatamente a que precisa de olho humano. */}
            {plano.totais.imobiliariaPorCampoGenerico > 0 ? (
              <p className="m-0 mt-3 rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2 text-xs text-ink-soft dark:bg-amber-950/20">
                <b className="text-ink">
                  {plano.totais.imobiliariaPorCampoGenerico} imobiliárias
                </b>{" "}
                virão do campo genérico (sem o Vale do Ouro no nome do campo). Conferir na amostra
                antes de gravar.
              </p>
            ) : null}

            {plano.conflitos.length > 0 ? (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50/60 p-3 dark:bg-amber-950/20">
                <p className="m-0 text-xs font-bold text-ink">
                  {plano.totais.entidadesEmConflito} entidades com CADs que discordam — NÃO serão
                  gravadas
                </p>
                <p className="m-0 mt-1 text-xs text-ink-soft">
                  Duas tasks do Asana caíram na mesma ficha (dedup por CPF) com valores
                  diferentes. Resolver à mão.
                </p>
                <ul className="m-0 mt-2 max-h-40 overflow-y-auto pl-4 text-xs text-ink-soft">
                  {plano.conflitos.map((c) => (
                    <li key={`${c.campo}-${c.entityId}`}>
                      <b className="text-ink">{c.campo}</b> — {c.nomes.join(" / ")}:{" "}
                      {c.valores.join(" | ")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {plano.ambiguos.length > 0 ? (
              <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50/60 p-3 dark:bg-amber-950/20">
                <p className="m-0 text-xs font-bold text-ink">
                  {plano.ambiguos.length} CADs com imobiliária ambígua — NÃO serão gravadas
                </p>
                <p className="m-0 mt-1 text-xs text-ink-soft">
                  Mais de um campo &ldquo;Imobiliárias Credenciadas&rdquo; preenchido e nenhum
                  do Vale do Ouro. Resolver à mão no Asana.
                </p>
                <ul className="m-0 mt-2 max-h-40 overflow-y-auto pl-4 text-xs text-ink-soft">
                  {plano.ambiguos.map((a) => (
                    <li key={a.gid}>
                      <b className="text-ink">{a.nome}</b> — {a.candidatos.join(" | ")}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {plano.vinculoImobiliariaEmpreendimento.length > 0 ? (
              <div className="mt-4">
                <p className="m-0 mb-2 text-[0.7rem] font-bold uppercase tracking-wide text-ink-soft">
                  Imobiliárias × Vale do Ouro (insumo do credenciamento)
                </p>
                <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
                  <table className="w-full border-collapse text-sm">
                    <tbody>
                      {plano.vinculoImobiliariaEmpreendimento.map((v) => (
                        <tr
                          className="border-b border-black/[0.06] last:border-b-0 dark:border-white/[0.07]"
                          key={v.imobiliaria}
                        >
                          <td className="px-2 py-2 font-medium text-ink">{v.imobiliaria}</td>
                          <td className="px-2 py-2 tabular-nums text-ink-soft">
                            {v.cads} CADs
                          </td>
                          <td className="px-2 py-2 text-xs text-ink-muted">
                            {v.corretores.join(", ") || "sem corretor"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </>
        ) : null}

        {resultado ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {[
              ["Corretores gravados", resultado.atualizados.corretor],
              ["Imobiliárias gravadas", resultado.atualizados.imobiliaria],
              ["E-mails gravados", resultado.atualizados.email],
              ["Pulados", resultado.pulados],
            ].map(([label, valor]) => (
              <div className="rounded-lg border border-line bg-subtle/40 px-3 py-2" key={label}>
                <p className="m-0 text-lg font-bold text-ink">{valor}</p>
                <p className="m-0 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                  {label}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        {resultado && resultado.erros.length > 0 ? (
          <div className="mt-3 rounded-lg border border-red-300 bg-red-50 p-3 dark:bg-red-950/30">
            <p className="m-0 text-xs font-bold text-red-800 dark:text-red-300">
              Abortado no primeiro erro (nada além do que está acima foi gravado)
            </p>
            <ul className="m-0 mt-1 pl-4 text-xs text-red-700 dark:text-red-400">
              {resultado.erros.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
            {resultado.ultimoEntityId ? (
              <p className="m-0 mt-1 text-[0.68rem] text-red-700/80 dark:text-red-400/80">
                Parou em: {resultado.ultimoEntityId}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
