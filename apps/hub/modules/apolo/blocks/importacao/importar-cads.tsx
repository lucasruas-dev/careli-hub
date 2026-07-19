"use client";

import {
  AlertTriangle,
  Check,
  CircleHelp,
  Loader2,
  Search,
  UserCheck,
  UserX,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { getApoloAccessToken } from "../../data/apolo-operations";

// Importar as CADs do Asana — primeiro lote: "Finalizado" do Vale do Ouro.
//
// Essas CADs já viraram cadastro no Apolo, então casamos por NOME e marcamos como credenciado:
// custo ZERO de iOCR. Casar nome errado imprime credencial com nome trocado no dia do evento,
// por isso nada é aplicado sozinho — a tela mostra as quatro listas e a pessoa escolhe.

type Cad = {
  corretor: string | null;
  criadoEm: string | null;
  empreendimento: string | null;
  gid: string;
  imobiliaria: string | null;
  nome: string;
  secao: string;
};
type Candidato = { documento: string | null; id: string; nome: string };
type Item = { cad: Cad; candidatos: Candidato[]; jaImportado: boolean };
type Diagnostico = {
  descartadasPorEmpreendimento: number;
  porSecao: Record<string, number>;
  valoresEmpreendimento: string[];
};
type Preview = {
  ambiguos: Item[];
  casados: Item[];
  diagnostico: Diagnostico;
  empreendimento: string;
  jaImportados: Item[];
  naoCasados: Item[];
  secoes: string[];
  secoesEncontradas: string[];
  total: number;
};

export function ImportarCads() {
  const [empreendimento, setEmpreendimento] = useState("Vale do Ouro");
  const [secoes, setSecoes] = useState("Finalizado");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  // Começa com todos os casamentos certos marcados; ambíguos e sem-casamento ficam de fora.
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set());
  // Para os ambíguos, qual candidato a pessoa escolheu.
  const [escolhaAmbigua, setEscolhaAmbigua] = useState<Record<string, string>>({});

  const escanear = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    setAviso(null);
    try {
      const token = await getApoloAccessToken();
      const url = `/api/apolo/asana/importar?empreendimento=${encodeURIComponent(empreendimento)}&secoes=${encodeURIComponent(secoes)}`;
      const resposta = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const corpo = (await resposta.json()) as { data?: Preview; error?: string };
      if (!resposta.ok) {
        setErro(corpo.error ?? `Falha (${resposta.status}).`);
        setPreview(null);
      } else {
        setPreview(corpo.data ?? null);
        setSelecionados(new Set((corpo.data?.casados ?? []).map((i) => i.cad.gid)));
        setEscolhaAmbigua({});
      }
    } catch (e) {
      setErro((e as Error).message);
    }
    setCarregando(false);
  }, [empreendimento, secoes]);

  // O que será efetivamente gravado: casamentos certos marcados + ambíguos resolvidos à mão.
  const itensParaAplicar = useMemo(() => {
    if (!preview) return [];

    // Os dados da CAD vão junto: é o que preenche empreendimento, imobiliária e corretor na
    // fila do Board (cadastro antigo não tem metadata.cadastro para o Board ler).
    const dados = (i: Item) => ({
      corretor: i.cad.corretor,
      empreendimento: i.cad.empreendimento,
      gid: i.cad.gid,
      imobiliaria: i.cad.imobiliaria,
      secao: i.cad.secao,
    });

    const doCasado = preview.casados
      .filter((i) => selecionados.has(i.cad.gid))
      .map((i) => ({ ...dados(i), entityId: i.candidatos[0]!.id }));

    const doAmbiguo = preview.ambiguos
      .filter((i) => escolhaAmbigua[i.cad.gid])
      .map((i) => ({ ...dados(i), entityId: escolhaAmbigua[i.cad.gid]! }));

    // Já importados marcados: reaplica só os DADOS (o vínculo não duplica). É como se completa
    // uma importação anterior que gravou menos campos.
    const doJaImportado = preview.jaImportados
      .filter((i) => selecionados.has(i.cad.gid) && i.candidatos.length === 1)
      .map((i) => ({ ...dados(i), entityId: i.candidatos[0]!.id }));

    return [...doCasado, ...doAmbiguo, ...doJaImportado];
  }, [escolhaAmbigua, preview, selecionados]);

  const aplicar = useCallback(async () => {
    if (itensParaAplicar.length === 0) return;
    setAplicando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch("/api/apolo/asana/importar", {
        body: JSON.stringify({
          confirmado: true,
          etapa: "credenciado",
          itens: itensParaAplicar,
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const corpo = (await resposta.json()) as {
        data?: { erros: { gid: string; motivo: string }[]; ignorados: number; vinculados: number };
        error?: string;
      };
      if (!resposta.ok) {
        setErro(corpo.error ?? `Falha (${resposta.status}).`);
      } else {
        const r = corpo.data;
        setAviso(
          `${r?.vinculados ?? 0} CADs marcadas como credenciadas.` +
            (r?.ignorados ? ` ${r.ignorados} já tinham sido importadas antes.` : "") +
            (r?.erros?.length ? ` ${r.erros.length} com erro.` : ""),
        );
        await escanear();
      }
    } catch (e) {
      setErro((e as Error).message);
    }
    setAplicando(false);
  }, [escanear, itensParaAplicar]);

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-black/[0.07] bg-surface p-4 dark:border-white/[0.08]">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1.5 block text-[0.68rem] font-semibold uppercase tracking-wide text-ink-muted">
              Empreendimento
            </span>
            <input
              className="rounded-lg border border-black/10 bg-canvas px-3 py-2 text-sm text-ink dark:border-white/10"
              onChange={(e) => setEmpreendimento(e.target.value)}
              value={empreendimento}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[0.68rem] font-semibold uppercase tracking-wide text-ink-muted">
              Seções (separadas por vírgula)
            </span>
            <input
              className="w-64 rounded-lg border border-black/10 bg-canvas px-3 py-2 text-sm text-ink dark:border-white/10"
              onChange={(e) => setSecoes(e.target.value)}
              value={secoes}
            />
          </label>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-[#A07C3B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#8d6c33] disabled:opacity-50"
            disabled={carregando}
            onClick={() => void escanear()}
            type="button"
          >
            {carregando ? (
              <Loader2 className="animate-spin" size={15} />
            ) : (
              <Search size={15} />
            )}
            Procurar CADs
          </button>
        </div>
        <p className="mt-2 text-xs text-ink-muted">
          A busca é gratuita: lê o Asana e compara com o Apolo, sem ler nenhum documento.
        </p>
      </section>

      {erro ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {erro}
        </p>
      ) : null}
      {aviso ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          {aviso}
        </p>
      ) : null}

      {preview ? (
        <>
          {preview.secoesEncontradas.length > 0 ? (
            <p className="text-xs text-ink-muted">
              Seções no projeto:{" "}
              {preview.secoesEncontradas
                .map((s) => `${s} (${preview.diagnostico.porSecao[s] ?? 0})`)
                .join(" · ")}
            </p>
          ) : null}

          {/* Quando a busca volta vazia, mostrar POR QUÊ — em vez de deixar adivinhar a grafia. */}
          {preview.total === 0 && preview.diagnostico.valoresEmpreendimento.length > 0 ? (
            <section className="rounded-xl border border-amber-400/50 bg-amber-50/60 p-4 dark:bg-amber-950/25">
              <p className="text-sm font-semibold text-ink">
                A seção tem CADs, mas nenhuma com o empreendimento “{preview.empreendimento}”
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                {preview.diagnostico.descartadasPorEmpreendimento} CADs foram descartadas só
                por esse filtro. Estes são os valores que existem nas CADs dessa seção — clique
                em um para buscar por ele:
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {preview.diagnostico.valoresEmpreendimento.map((valor) => (
                  <button
                    key={valor}
                    className="rounded-lg border border-black/10 bg-canvas px-2.5 py-1 text-xs font-medium text-ink hover:bg-black/[0.04] dark:border-white/10 dark:hover:bg-white/[0.06]"
                    onClick={() => setEmpreendimento(valor)}
                    type="button"
                  >
                    {valor}
                  </button>
                ))}
                <button
                  className="rounded-lg border border-dashed border-black/20 px-2.5 py-1 text-xs font-medium text-ink-soft hover:text-ink dark:border-white/20"
                  onClick={() => setEmpreendimento("")}
                  type="button"
                >
                  Todos os empreendimentos
                </button>
              </div>
            </section>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Contador cor="#22a95b" label="Casaram" valor={preview.casados.length} />
            <Contador cor="#e0a52e" label="Ambíguos" valor={preview.ambiguos.length} />
            <Contador cor="#e0554a" label="Sem cadastro" valor={preview.naoCasados.length} />
            <Contador cor="#64748b" label="Já importados" valor={preview.jaImportados.length} />
          </div>

          {preview.total === 0 && preview.diagnostico.valoresEmpreendimento.length === 0 ? (
            <p className="rounded-xl border border-black/[0.07] py-10 text-center text-sm text-ink-muted dark:border-white/[0.08]">
              Nenhuma CAD nessas seções. Confira a grafia contra a lista de seções acima.
            </p>
          ) : null}

          {preview.casados.length > 0 ? (
            <Grupo
              cor="#22a95b"
              descricao="Nome bateu com exatamente um cadastro do Apolo. Desmarque o que não quiser importar."
              icone={<UserCheck size={16} />}
              titulo={`Casaram (${preview.casados.length})`}
            >
              {preview.casados.map((item) => (
                <label
                  key={item.cad.gid}
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-black/[0.06] px-3 py-2 dark:border-white/[0.07]"
                >
                  <input
                    checked={selecionados.has(item.cad.gid)}
                    onChange={(e) => {
                      setSelecionados((atual) => {
                        const novo = new Set(atual);
                        if (e.target.checked) novo.add(item.cad.gid);
                        else novo.delete(item.cad.gid);
                        return novo;
                      });
                    }}
                    type="checkbox"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{item.cad.nome}</p>
                    <p className="truncate text-xs text-ink-muted">
                      {item.cad.imobiliaria ?? "sem imobiliária"}
                      {item.cad.corretor ? ` · ${item.cad.corretor}` : ""}
                      {` · ${item.cad.secao}`}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-ink-soft">
                    {item.candidatos[0]?.documento ?? "—"}
                  </span>
                </label>
              ))}
            </Grupo>
          ) : null}

          {preview.ambiguos.length > 0 ? (
            <Grupo
              cor="#e0a52e"
              descricao="O mesmo nome existe em mais de um cadastro. Escolha qual é, ou deixe de fora."
              icone={<CircleHelp size={16} />}
              titulo={`Ambíguos (${preview.ambiguos.length})`}
            >
              {preview.ambiguos.map((item) => (
                <div
                  key={item.cad.gid}
                  className="rounded-lg border border-amber-400/40 bg-amber-50/40 px-3 py-2 dark:bg-amber-950/20"
                >
                  <p className="text-sm font-medium text-ink">{item.cad.nome}</p>
                  <p className="mb-2 text-xs text-ink-muted">
                    {item.cad.imobiliaria ?? "sem imobiliária"} · {item.cad.secao}
                  </p>
                  <select
                    className="w-full rounded-md border border-black/10 bg-canvas px-2 py-1.5 text-sm text-ink dark:border-white/10"
                    onChange={(e) =>
                      setEscolhaAmbigua((atual) => ({
                        ...atual,
                        [item.cad.gid]: e.target.value,
                      }))
                    }
                    value={escolhaAmbigua[item.cad.gid] ?? ""}
                  >
                    <option value="">Deixar de fora</option>
                    {item.candidatos.map((candidato) => (
                      <option key={candidato.id} value={candidato.id}>
                        {candidato.nome} · {candidato.documento ?? "sem documento"}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </Grupo>
          ) : null}

          {preview.naoCasados.length > 0 ? (
            <Grupo
              cor="#e0554a"
              descricao="Não existe cadastro com esse nome no Apolo. Estas precisam do cadastro completo (e aí sim leitura de documento)."
              icone={<UserX size={16} />}
              titulo={`Sem cadastro no Apolo (${preview.naoCasados.length})`}
            >
              <div className="flex flex-wrap gap-1.5">
                {preview.naoCasados.map((item) => (
                  <span
                    key={item.cad.gid}
                    className="rounded bg-black/[0.05] px-2 py-1 text-xs text-ink-soft dark:bg-white/[0.07]"
                    title={`${item.cad.imobiliaria ?? "sem imobiliária"} · ${item.cad.secao}`}
                  >
                    {item.cad.nome}
                  </span>
                ))}
              </div>
            </Grupo>
          ) : null}

          {preview.jaImportados.length > 0 ? (
            <Grupo
              cor="#64748b"
              descricao="Já vinculadas antes. Marcar aqui NÃO duplica: só reescreve os dados (empreendimento, imobiliária, corretor) na ficha, para completar uma importação anterior."
              icone={<Check size={16} />}
              titulo={`Já importados (${preview.jaImportados.length})`}
            >
              <button
                className="mb-2 rounded-lg border border-black/10 px-2.5 py-1 text-xs font-semibold text-ink hover:bg-black/[0.04] dark:border-white/10 dark:hover:bg-white/[0.06]"
                onClick={() => {
                  const gids = preview.jaImportados
                    .filter((i) => i.candidatos.length === 1)
                    .map((i) => i.cad.gid);
                  setSelecionados((atual) => {
                    const novo = new Set(atual);
                    const todosMarcados = gids.every((g) => novo.has(g));
                    for (const g of gids) {
                      if (todosMarcados) novo.delete(g);
                      else novo.add(g);
                    }
                    return novo;
                  });
                }}
                type="button"
              >
                Marcar/desmarcar todos para atualizar
              </button>
              <div className="space-y-1">
                {preview.jaImportados.map((item) => (
                  <label
                    key={item.cad.gid}
                    className={`flex items-center gap-2.5 rounded-lg border border-black/[0.06] px-3 py-1.5 dark:border-white/[0.07] ${
                      item.candidatos.length === 1 ? "cursor-pointer" : "opacity-60"
                    }`}
                  >
                    <input
                      checked={selecionados.has(item.cad.gid)}
                      disabled={item.candidatos.length !== 1}
                      onChange={(e) => {
                        setSelecionados((atual) => {
                          const novo = new Set(atual);
                          if (e.target.checked) novo.add(item.cad.gid);
                          else novo.delete(item.cad.gid);
                          return novo;
                        });
                      }}
                      type="checkbox"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">
                      {item.cad.nome}
                    </span>
                    <span className="shrink-0 text-[0.66rem] text-ink-muted">
                      {item.cad.empreendimento ?? "sem empreendimento"}
                    </span>
                  </label>
                ))}
              </div>
            </Grupo>
          ) : null}

          {itensParaAplicar.length > 0 ? (
            <div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-xl border border-black/[0.07] bg-surface/95 p-4 backdrop-blur dark:border-white/[0.08]">
              <AlertTriangle className="shrink-0 text-amber-600" size={17} />
              <p className="min-w-0 flex-1 text-sm text-ink-soft">
                <b className="text-ink">{itensParaAplicar.length} CADs</b> serão marcadas como
                credenciadas e vinculadas às suas tasks no Asana. Nenhum documento é lido.
              </p>
              <button
                className="inline-flex items-center gap-2 rounded-lg bg-[#101820] px-4 py-2 text-sm font-semibold text-[#cba25a] hover:bg-[#1c2733] disabled:opacity-50"
                disabled={aplicando}
                onClick={() => void aplicar()}
                type="button"
              >
                {aplicando ? (
                  <Loader2 className="animate-spin" size={15} />
                ) : (
                  <Check size={15} />
                )}
                Importar {itensParaAplicar.length}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Contador(props: { cor: string; label: string; valor: number }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-black/[0.07] bg-surface px-3 py-1.5 dark:border-white/[0.08]">
      <span className="h-2 w-2 rounded-full" style={{ background: props.cor }} />
      <span className="text-sm font-bold tabular-nums text-ink">{props.valor}</span>
      <span className="text-xs text-ink-muted">{props.label}</span>
    </div>
  );
}

function Grupo(props: {
  children: React.ReactNode;
  cor: string;
  descricao: string;
  icone: React.ReactNode;
  titulo: string;
}) {
  return (
    <section className="rounded-xl border border-black/[0.07] bg-surface p-4 dark:border-white/[0.08]">
      <header className="mb-1 flex items-center gap-2">
        <span style={{ color: props.cor }}>{props.icone}</span>
        <h3 className="text-sm font-bold text-ink">{props.titulo}</h3>
      </header>
      <p className="mb-3 text-xs text-ink-muted">{props.descricao}</p>
      <div className="space-y-1.5">{props.children}</div>
    </section>
  );
}
