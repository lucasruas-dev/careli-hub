"use client";

import { AlertTriangle, Loader2, Printer, RefreshCw, Search, Tag } from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchEventos,
  fetchFila,
  marcarEtiquetaImpressaRemoto,
} from "../../data/prometeu-operations";
import { ETIQUETA_PRINT_DOC_CSS, ETIQUETA_TELA_CSS } from "./etiqueta-css";
import { imprimirEtiquetas, imprimirEtiquetasCorretor } from "./imprimir-etiquetas";
import {
  codigoDaCredencial,
  conteudoDoQrCredencial,
} from "@/lib/prometeu/credencial";
import {
  lancamentoSemEmpreendimento,
  nomeDoLancamento,
  dataDoLancamento,
} from "@/lib/prometeu/lancamento";
import { eventoDoDia } from "@/lib/prometeu/evento-do-dia";
import type { PrometeuCredenciado, PrometeuEvento } from "@/lib/prometeu/types";

// ETIQUETA DE CREDENCIAMENTO — o crachá que o cliente usa o evento inteiro.
//
// Esta tela substitui o mockup public/prometeu/etiqueta.html, que tinha 13 clientes inventados e
// um seletor de empreendimento próprio. Duas correções de fundo, pedidas pelo Lucas:
//
//   1) os clientes NASCEM DA FILA (o que o Apolo entrega ao Prometeu). Não há lista paralela nem
//      escolha de empreendimento aqui: todo credenciado do evento está apto a imprimir.
//   2) o empreendimento e a data vêm DO EVENTO. Antes a tela deixava escolher na mão, e era isso
//      que produzia etiqueta com o lançamento errado.
//
// O QR é de verdade (o do mockup era um padrão desenhado a partir de um hash, ilegível por
// qualquer leitor). Ele carrega o id completo do credenciado — ver [[credencial.ts]] para o
// porquê de não ser o código curto e de não ser uma URL.

function documentoBR(doc: string | null): string {
  const d = (doc ?? "").replace(/\D/g, "");
  if (d.length !== 11) return doc ?? "";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function telefoneBR(tel: string | null | undefined): string {
  const d = (tel ?? "").replace(/\D/g, "");
  const s = d.startsWith("55") ? d.slice(2) : d;
  if (s.length === 11) return `(${s.slice(0, 2)}) ${s.slice(2, 7)}-${s.slice(7)}`;
  if (s.length === 10) return `(${s.slice(0, 2)}) ${s.slice(2, 6)}-${s.slice(6)}`;
  return tel?.trim() ?? "";
}

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  const primeira = partes[0]?.[0] ?? "";
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? "") : "";
  return `${primeira}${ultima}`.toUpperCase();
}

// A etiqueta em si. Mesma marcação do mockup aprovado, para o CSS térmico continuar valendo.
function Etiqueta({
  credenciado,
  dataEvento,
  empreendimento,
  qrDataUrl,
}: {
  credenciado: PrometeuCredenciado;
  dataEvento: string;
  empreendimento: string;
  qrDataUrl: string | null;
}) {
  const pago = Boolean(credenciado.pagoEm);

  return (
    <div className="etq">
      <div className="etq-top">
        <div className="etq-top-l">
          <div className="etq-emp">{empreendimento.toUpperCase()}</div>
          <div className="etq-data">
            CREDENCIAL{dataEvento ? ` · ${dataEvento}` : ""}
          </div>
        </div>
        <div className="etq-top-r">
          {/* Sem texto, por decisão do Lucas: é sinal para o time interno, não informação para
              o cliente. Quem vê sabe que há R$ 1.000 pagos a abater na negociação. */}
          {pago ? (
            <span
              aria-label="PIX pago"
              className="etq-pix"
              title="PIX de R$ 1.000 já pago"
            >
              ✓
            </span>
          ) : null}
          {/* eslint-disable-next-line @next/next/no-img-element -- impressão térmica: <img> simples
              evita o pipeline de otimização do Next, que serve WebP e some na hora de imprimir. */}
          <img alt="C2X" className="etq-logo" src="/prometeu/c2x-logo.png" />
        </div>
      </div>

      <div className="etq-body">
        <div className="etq-qrbox">
          <div className="etq-qr">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URI, sem otimização.
              <img alt="" src={qrDataUrl} />
            ) : null}
          </div>
          <div className="etq-cod">{codigoDaCredencial(credenciado.id)}</div>
        </div>

        <div className="etq-dados">
          <div className="etq-nome">{credenciado.nome}</div>
          <div className="etq-imob">{credenciado.imobiliaria ?? ""}</div>
          <div className="etq-cor">
            {credenciado.corretor ? `Corretor: ${credenciado.corretor}` : ""}
          </div>
        </div>
      </div>

      <div className="etq-foot">
        <span>
          <i>CPF</i>
          {documentoBR(credenciado.documento)}
        </span>
        <span>
          <i>TEL</i>
          {telefoneBR(credenciado.telefone)}
        </span>
      </div>
    </div>
  );
}

// A ETIQUETA DO CORRETOR na tela — espelho do HTML de `imprimir-etiquetas`, para a prévia mostrar
// o que sai no papel. Mesma caixa `.etq`, sem QR: o corretor não faz check-in, e a largura livre é
// o que deixa o nome grande o bastante para ser lido de longe no salão.
function EtiquetaCorretor({
  corretor,
  dataEvento,
  empreendimento,
}: {
  corretor: { imobiliaria: null | string; nome: string };
  dataEvento: string;
  empreendimento: string;
}) {
  return (
    <div className="etq etq-corretor">
      <div className="etq-top">
        <div className="etq-top-l">
          <div className="etq-emp">{empreendimento.toUpperCase()}</div>
          <div className="etq-data">CORRETOR{dataEvento ? ` · ${dataEvento}` : ""}</div>
        </div>
        <div className="etq-top-r">
          {/* eslint-disable-next-line @next/next/no-img-element -- impressão térmica. */}
          <img alt="C2X" className="etq-logo" src="/prometeu/c2x-logo.png" />
        </div>
      </div>

      <div className="etq-body">
        <div className="etq-dados">
          <div className="etq-nome">{corretor.nome}</div>
          <div className="etq-imob">{corretor.imobiliaria ?? ""}</div>
          <div className="etq-selo">CORRETOR</div>
        </div>
      </div>
    </div>
  );
}

export function EtiquetaView() {
  const [eventos, setEventos] = useState<PrometeuEvento[]>([]);
  const [eventoId, setEventoId] = useState("");
  const [credenciados, setCredenciados] = useState<PrometeuCredenciado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [imobiliaria, setImobiliaria] = useState("Todas as imobiliárias");
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [qrPorId, setQrPorId] = useState<Record<string, string>>({});
  const [preparando, setPreparando] = useState(false);
  // CLIENTES ou CORRETORES. Duas listas da MESMA fila: o corretor não tem cadastro próprio no
  // Prometeu, ele é o nome que veio junto de cada CAD.
  const [aba, setAba] = useState<"clientes" | "corretores">("clientes");

  useEffect(() => {
    void (async () => {
      const { data } = await fetchEventos();
      const lista = data ?? [];
      setEventos(lista);
      // ⚠️ MESMA REGRA DAS OUTRAS TELAS: quem está EM ANDAMENTO manda, senão o ativo, senão um
      // rascunho. Aqui era `find(status === "ativo") ?? lista[0]`, e o `?? lista[0]` abria no
      // evento mais RECENTE — que, com um lançamento encerrado no banco, era justamente ele.
      const ativo = eventoDoDia(lista);
      if (ativo) setEventoId(ativo.id);
      else setCarregando(false);
    })();
  }, []);

  const carregar = useCallback(async () => {
    if (!eventoId) return;
    setCarregando(true);
    setErro(null);
    const { data, error } = await fetchFila(eventoId);
    if (error) setErro(error);
    setCredenciados(data?.credenciados ?? []);
    setCarregando(false);
  }, [eventoId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const evento = useMemo(
    () => eventos.find((e) => e.id === eventoId) ?? null,
    [eventos, eventoId],
  );
  const empreendimento = nomeDoLancamento(evento);
  const dataEvento = dataDoLancamento(evento?.dataEvento);
  const semEmpreendimento = lancamentoSemEmpreendimento(evento);

  const imobiliarias = useMemo(() => {
    const nomes = new Set<string>();
    for (const c of credenciados) {
      if (c.imobiliaria?.trim()) nomes.add(c.imobiliaria.trim());
    }
    return ["Todas as imobiliárias", ...Array.from(nomes).sort()];
  }, [credenciados]);

  const filtrados = useMemo(() => {
    const alvo = busca.trim().toLowerCase();
    return credenciados.filter((c) => {
      const casaImob =
        imobiliaria === "Todas as imobiliárias" || c.imobiliaria === imobiliaria;
      if (!casaImob) return false;
      if (!alvo) return true;
      return `${c.nome} ${c.documento ?? ""} ${c.imobiliaria ?? ""} ${
        c.corretor ?? ""
      } ${codigoDaCredencial(c.id)}`
        .toLowerCase()
        .includes(alvo);
    });
  }, [busca, credenciados, imobiliaria]);

  const selecionado = useMemo(
    () => credenciados.find((c) => c.id === selecionadoId) ?? null,
    [credenciados, selecionadoId],
  );

  // OS CORRETORES DO LANÇAMENTO, tirados da própria fila.
  //
  // ⚠️ NÃO HÁ CADASTRO DE CORRETOR NO PROMETEU: o que existe é o nome que veio com cada CAD. Então
  // a lista é o conjunto DISTINTO desses nomes — 69 no Vale do Ouro, para 609 credenciados.
  //
  // A chave junta nome + imobiliária porque o mesmo nome pode aparecer por duas imobiliárias, e aí
  // são dois crachás diferentes. A comparação normaliza caixa e espaço: o dado vem digitado à mão
  // em CAD diferente, e "João Silva" e "JOAO SILVA " são a mesma pessoa.
  const corretores = useMemo(() => {
    const mapa = new Map<string, { imobiliaria: null | string; nome: string }>();

    for (const c of credenciados) {
      const nome = (c.corretor ?? "").trim();
      if (!nome) continue;

      const imobiliaria = (c.imobiliaria ?? "").trim() || null;
      const chave = `${nome.toLowerCase()}|${(imobiliaria ?? "").toLowerCase()}`;
      if (!mapa.has(chave)) mapa.set(chave, { imobiliaria, nome });
    }

    return [...mapa.values()].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [credenciados]);

  const corretoresFiltrados = useMemo(() => {
    const alvo = busca.trim().toLowerCase();
    return corretores.filter((c) => {
      const casaImob =
        imobiliaria === "Todas as imobiliárias" || c.imobiliaria === imobiliaria;
      if (!casaImob) return false;
      if (!alvo) return true;
      return `${c.nome} ${c.imobiliaria ?? ""}`.toLowerCase().includes(alvo);
    });
  }, [busca, corretores, imobiliaria]);

  const imprimirCorretores = useCallback(
    async (lista: { imobiliaria: null | string; nome: string }[]) => {
      if (lista.length === 0) return;
      await imprimirEtiquetasCorretor(lista, { dataEvento, empreendimento });
    },
    [dataEvento, empreendimento],
  );

  // Gera os QR que faltam e DEVOLVE o mapa completo (id -> dataURL) da lista pedida. Devolver em
  // vez de só gravar no state é o que a impressão precisa: logo após gerar, o state ainda está
  // com o valor antigo no closure, e mandar para a impressora com o QR pela metade queima
  // etiqueta física.
  const garantirQrs = useCallback(
    async (lista: PrometeuCredenciado[]): Promise<Record<string, string>> => {
      const faltando = lista.filter((c) => !qrPorId[c.id]);
      const gerados = await Promise.all(
        faltando.map(async (c) => {
          const url = await QRCode.toDataURL(conteudoDoQrCredencial(c.id), {
            errorCorrectionLevel: "M",
            margin: 0,
            // 203dpi numa área de 26mm: gerar acima disso não melhora o papel e pesa a tela.
            width: 260,
          });
          return [c.id, url] as const;
        }),
      );

      const mapa: Record<string, string> = { ...qrPorId };
      for (const [id, url] of gerados) mapa[id] = url;

      if (gerados.length > 0) {
        setQrPorId((atual) => {
          const proximo = { ...atual };
          for (const [id, url] of gerados) proximo[id] = url;
          return proximo;
        });
      }

      return mapa;
    },
    [qrPorId],
  );

  useEffect(() => {
    if (selecionado) void garantirQrs([selecionado]);
  }, [garantirQrs, selecionado]);

  const imprimir = useCallback(
    async (lista: PrometeuCredenciado[]) => {
      if (lista.length === 0) return;
      setPreparando(true);
      const mapa = await garantirQrs(lista);
      setPreparando(false);

      await imprimirEtiquetas(
        lista.map((c) => ({ credenciado: c, qrDataUrl: mapa[c.id] ?? "" })),
        {
          aoImprimir: (ids) => {
            void (async () => {
              for (const id of ids) await marcarEtiquetaImpressaRemoto(id);
              await carregar();
            })();
          },
          dataEvento,
          empreendimento,
        },
      );
    },
    [carregar, dataEvento, empreendimento, garantirQrs],
  );

  const jaImpressas = credenciados.filter((c) => c.etiquetaImpressaEm).length;
  const comPix = credenciados.filter((c) => c.pagoEm).length;

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 p-3">
      <style>{ETIQUETA_TELA_CSS}</style>

      <header className="shrink-0 rounded-xl border border-line bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="m-0 text-sm font-bold text-ink">
                Etiqueta de credenciamento
              </p>
              {empreendimento ? (
                <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-[#A07C3B]/30 bg-[#A07C3B]/10 px-2.5 text-[11px] font-semibold text-[#7A5E2C] dark:text-[#d9b978]">
                  <Tag aria-hidden="true" className="size-3.5" />
                  {empreendimento}
                  {dataEvento ? ` · ${dataEvento}` : ""}
                </span>
              ) : null}
            </div>
            <p className="m-0 mt-0.5 text-xs text-ink-muted">
              Todo credenciado do lançamento pode imprimir. A lista vem da fila, do que o Apolo
              entrega.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-9 rounded-lg border border-line/70 bg-surface px-2 text-sm text-ink outline-none"
              onChange={(e) => setEventoId(e.target.value)}
              value={eventoId}
            >
              {eventos.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.nome}
                  {ev.status === "ativo" ? " (ativo)" : ""}
                </option>
              ))}
            </select>
            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-semibold text-ink hover:bg-subtle"
              onClick={() => void carregar()}
              type="button"
            >
              <RefreshCw aria-hidden="true" className="size-4" /> Atualizar
            </button>
          </div>
        </div>

        {/* CLIENTES | CORRETORES — duas listas da mesma fila. O corretor não tem cadastro no
            Prometeu: ele é o nome que veio junto de cada CAD, e a lista é o conjunto distinto. */}
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {(["clientes", "corretores"] as const).map((chave) => (
            <button
              className={`h-8 rounded-lg px-3 text-xs font-semibold transition-colors ${
                aba === chave
                  ? "bg-[#101820] text-[#cba25a]"
                  : "border border-line text-ink-soft hover:bg-subtle"
              }`}
              key={chave}
              onClick={() => {
                setAba(chave);
                setSelecionadoId(null);
              }}
              type="button"
            >
              {chave === "clientes"
                ? `Clientes (${credenciados.length})`
                : `Corretores (${corretores.length})`}
            </button>
          ))}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
          <span>
            <b className="text-ink">{credenciados.length}</b> credenciados
          </span>
          <span>
            <b className="text-ink">{comPix}</b> com PIX pago
          </span>
          <span>
            <b className="text-ink">{jaImpressas}</b> já impressas
          </span>
        </div>

        {semEmpreendimento ? (
          <p className="m-0 mt-2 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900">
            <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
            O evento não está ligado a um empreendimento: a etiqueta sairia sem o nome do
            lançamento. Configure em Setup antes de imprimir.
          </p>
        ) : null}
      </header>

      {erro ? (
        <p className="m-0 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="size-3.5 shrink-0" /> {erro}
        </p>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface">
          <div className="shrink-0 space-y-2 border-b border-line p-3">
            <label className="relative block">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
              />
              <input
                className="h-9 w-full rounded-lg border border-line/70 bg-surface pl-8 pr-3 text-sm text-ink outline-none"
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Nome, CPF, imobiliária ou código..."
                value={busca}
              />
            </label>
            <select
              className="h-9 w-full rounded-lg border border-line/70 bg-surface px-2 text-sm text-ink outline-none"
              onChange={(e) => setImobiliaria(e.target.value)}
              value={imobiliaria}
            >
              {imobiliarias.map((nome) => (
                <option key={nome} value={nome}>
                  {nome}
                </option>
              ))}
            </select>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {carregando ? (
              <p className="m-0 flex items-center gap-2 p-4 text-xs text-ink-muted">
                <Loader2 className="size-3.5 animate-spin" /> Carregando os credenciados...
              </p>
            ) : aba === "corretores" ? (
              corretoresFiltrados.length === 0 ? (
                <p className="m-0 p-4 text-xs text-ink-muted">
                  {corretores.length === 0
                    ? "Nenhum corretor na fila ainda. O nome vem junto de cada CAD."
                    : "Nenhum corretor com esse filtro."}
                </p>
              ) : (
                <ul className="m-0 list-none space-y-1 p-2">
                  {corretoresFiltrados.map((c) => (
                    <li key={`${c.nome}|${c.imobiliaria ?? ""}`}>
                      <div className="flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 hover:bg-subtle">
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#101820] text-[11px] font-bold text-[#cba25a]">
                          {iniciais(c.nome)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-ink">
                            {c.nome}
                          </span>
                          <span className="block truncate text-[11px] text-ink-muted">
                            {c.imobiliaria ?? "Sem imobiliária"}
                          </span>
                        </span>
                        <button
                          className="shrink-0 rounded-lg border border-line px-2 py-1 text-[11px] font-semibold text-ink hover:bg-subtle"
                          onClick={() => void imprimirCorretores([c])}
                          type="button"
                        >
                          Imprimir
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )
            ) : filtrados.length === 0 ? (
              <p className="m-0 p-4 text-xs text-ink-muted">
                {credenciados.length === 0
                  ? "Ninguém credenciado ainda. Quem for credenciado no Apolo entra aqui automaticamente."
                  : "Nenhum credenciado com esse filtro."}
              </p>
            ) : (
              <ul className="m-0 list-none space-y-1 p-2">
                {filtrados.map((c) => {
                  const ativo = c.id === selecionadoId;
                  return (
                    <li key={c.id}>
                      <button
                        className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                          ativo
                            ? "border-[#A07C3B]/50 bg-[#A07C3B]/10"
                            : "border-transparent hover:bg-subtle"
                        }`}
                        onClick={() => setSelecionadoId(c.id)}
                        type="button"
                      >
                        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[#101820] text-[11px] font-bold text-[#cba25a]">
                          {iniciais(c.nome)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-semibold text-ink">
                              {c.nome}
                            </span>
                            {c.pagoEm ? (
                              <span
                                className="grid size-4 shrink-0 place-items-center rounded-full bg-emerald-600 text-[9px] font-black text-white"
                                title="PIX de R$ 1.000 já pago"
                              >
                                ✓
                              </span>
                            ) : null}
                          </span>
                          <span className="block truncate text-[11px] text-ink-muted">
                            {c.imobiliaria ?? "Sem imobiliária"} ·{" "}
                            {documentoBR(c.documento) || "sem CPF"}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          <span className="block font-mono text-[10px] font-bold text-ink-muted">
                            {codigoDaCredencial(c.id)}
                          </span>
                          {c.etiquetaImpressaEm ? (
                            <span className="block text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                              impressa
                            </span>
                          ) : null}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <p className="m-0 text-sm font-bold text-ink">Etiqueta</p>
            <span className="text-[11px] text-ink-muted">
              {aba === "corretores" ? "crachá do corretor" : "cola no crachá do cliente"}
            </span>
          </div>

          <div className="etq-preview grid min-h-0 flex-1 place-items-center overflow-auto p-6">
            {aba === "corretores" ? (
              corretoresFiltrados[0] ? (
                <EtiquetaCorretor
                  corretor={corretoresFiltrados[0]}
                  dataEvento={dataEvento}
                  empreendimento={empreendimento}
                />
              ) : (
                <p className="m-0 text-xs text-ink-muted">
                  Nenhum corretor na fila para gerar etiqueta.
                </p>
              )
            ) : selecionado ? (
              <Etiqueta
                credenciado={selecionado}
                dataEvento={dataEvento}
                empreendimento={empreendimento}
                qrDataUrl={qrPorId[selecionado.id] ?? null}
              />
            ) : (
              <p className="m-0 text-xs text-ink-muted">
                Selecione um cliente na lista para gerar a etiqueta.
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-line px-4 py-3">
            {aba === "corretores" ? (
              <button
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#101820] px-4 text-sm font-semibold text-[#e8d5a8] hover:bg-[#1b2732] disabled:opacity-50"
                disabled={corretoresFiltrados.length === 0}
                onClick={() => void imprimirCorretores(corretoresFiltrados)}
                type="button"
              >
                <Printer aria-hidden="true" className="size-4" />
                Imprimir todas ({corretoresFiltrados.length})
              </button>
            ) : null}
            <button
              className={`inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-sm font-semibold text-ink hover:bg-subtle disabled:opacity-50 ${
                aba === "corretores" ? "hidden" : ""
              }`}
              disabled={preparando || filtrados.length === 0}
              onClick={() => void imprimir(filtrados)}
              type="button"
            >
              {preparando ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Printer aria-hidden="true" className="size-4" />
              )}
              Imprimir todas ({filtrados.length})
            </button>
            <button
              className={`inline-flex h-10 items-center gap-2 rounded-lg bg-[#101820] px-4 text-sm font-semibold text-[#e8d5a8] hover:bg-[#1b2732] disabled:opacity-50 ${
                aba === "corretores" ? "hidden" : ""
              }`}
              disabled={!selecionado || preparando}
              onClick={() => void (selecionado && imprimir([selecionado]))}
              type="button"
            >
              <Printer aria-hidden="true" className="size-4" /> Imprimir etiqueta
            </button>
          </div>
        </div>
      </div>

    </section>
  );
}
