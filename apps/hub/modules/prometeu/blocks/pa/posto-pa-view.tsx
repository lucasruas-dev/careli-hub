"use client";

import { Camera, Check, Loader2, Printer, QrCode, X } from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useState } from "react";

import {
  codigoDoCupom,
  conteudoDoQrDoCupom,
  ehIdDeCupom,
} from "@/lib/prometeu/cupom";

import {
  fetchCupom,
  marcarPaImpressaRemoto,
  type CupomReservaLinha,
} from "../../data/prometeu-operations";
import { usarLeitorQr } from "../checkin/usar-leitor-qr";
import { ListaDeReservas } from "./lista-de-reservas";
import { usarLeitorWedge } from "../usar-leitor-wedge";
import { imprimirFolhasDaPa } from "./imprimir-pa";

// A ÁREA DE IMPRESSÃO DA PA — mãos livres (Lucas, 24/08).
//
// A tela só escuta o leitor de mesa: bipou o cupom → as folhas de PA saem sozinhas na A4
// (uma por unidade; Chrome em modo quiosque imprime sem diálogo). Papel físico que o CORRETOR
// usa para montar a proposta e levar à secretária. Cupom já impresso → avisa a hora e pergunta
// se é 2ª via, em vez de duplicar papel calado.

type CupomCarregado = {
  cliente: {
    corretor: null | string;
    documento: null | string;
    imobiliaria: null | string;
    nome: string;
  };
  evento: { id: string; incorporadora: null | string; nome: string } | null;
  grupoId: string;
  reservas: CupomReservaLinha[];
};

// ⚠️ O LEITOR USB VEM DO HOOK COMPARTILHADO (../usar-leitor-wedge). A cópia local que existia
// aqui tinha os dois defeitos consertados na Reserva em 28/08/2026 e ficou para trás: (1) não
// passava por `normalizarLeituraDoQr`, então o cupom bipado com o separador trocado pelo layout
// de teclado era reprovado por `ehIdDeCupom` e a tela dizia "Isso não parece um cupom de
// reserva" com a fila esperando; (2) não cancelava a ação padrão do Enter, que re-clicava o
// botão focado — aqui, "Usar a câmera" ou o "Cancelar" da 2ª via. A regra de aceite é a mesma
// (rajada de 6+ caracteres fora de campo).

function horaBR(iso: null | string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function PostoPaView() {
  // BIPAR ou LISTA. O bip é o caminho de mãos livres; a lista é a saída manual, que existe
  // porque o leitor não vai estar pronto para o evento de amanhã (Lucas, 29/08: *"para amanhã
  // terá que ser manualmente mesmo"*). Ela também é onde se reemite uma proposta e se cancela
  // uma reserva — as três coisas partem da mesma pergunta.
  const [modo, setModo] = useState<"bipar" | "lista">("bipar");
  const [erro, setErro] = useState<null | string>(null);
  const [ocupado, setOcupado] = useState(false);
  const [cameraAberta, setCameraAberta] = useState(false);
  const [segundaVia, setSegundaVia] = useState<null | CupomCarregado>(null);
  const [sucesso, setSucesso] = useState<null | {
    folhas: number;
    nome: string;
  }>(null);

  const imprimir = useCallback(async (cupom: CupomCarregado) => {
    const qrDataUrl = await QRCode.toDataURL(
      conteudoDoQrDoCupom(cupom.grupoId),
      {
        margin: 1,
        width: 220,
      },
    );
    // Os proponentes viajam gravados na reserva; reserva antiga sem eles = titular a 100%.
    const proponentes = cupom.reservas[0]?.proponentes?.length
      ? cupom.reservas[0].proponentes.map((p) => ({
          documento: p.documento,
          nome: p.nome,
          percentual: p.percentual,
        }))
      : [
          {
            documento: cupom.cliente.documento,
            nome: cupom.cliente.nome,
            percentual: 100,
          },
        ];

    await imprimirFolhasDaPa({
      codigoCupom: codigoDoCupom(cupom.grupoId),
      corretor: cupom.cliente.corretor,
      dataExtensa: new Date().toLocaleDateString("pt-BR", {
        day: "numeric",
        month: "long",
        year: "numeric",
      }),
      imobiliaria: cupom.cliente.imobiliaria,
      incorporadora: cupom.evento?.incorporadora ?? null,
      lancamento: cupom.evento?.nome ?? "Lançamento",
      // A marca no topo da folha. URL absoluta: dentro do iframe about:blank o caminho
      // relativo não resolve — mesma lição do cupom e da etiqueta.
      logoSrc: new URL(
        "/prometeu/c2x-logo.png",
        window.location.origin,
      ).toString(),
      proponentes,
      qrDataUrl,
      unidades: cupom.reservas.map((r) => ({
        area: r.area,
        codigo: r.codigo,
        lote: r.lote,
        precoTabela: r.precoTabela,
        quadra: r.quadra,
        reservadaEm: new Date(r.createdAt).toLocaleString("pt-BR", {
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          month: "2-digit",
          year: "numeric",
        }),
      })),
    });
    void marcarPaImpressaRemoto(cupom.grupoId);
    setSucesso({ folhas: cupom.reservas.length, nome: cupom.cliente.nome });
    window.setTimeout(() => setSucesso(null), 4_000);
  }, []);

  const aoBipar = useCallback(
    async (lido: string) => {
      const grupoId = lido.trim();
      if (ocupado) return;
      if (!ehIdDeCupom(grupoId)) {
        setErro("Isso não parece um cupom de reserva.");
        return;
      }
      setOcupado(true);
      setErro(null);

      const r = await fetchCupom(grupoId);
      if (r.error || !r.data) {
        setErro(r.error ?? "Cupom não encontrado.");
        setOcupado(false);
        return;
      }

      const cupom: CupomCarregado = { ...r.data, grupoId };
      const jaImpressa = cupom.reservas.some(
        (linha) => linha.paImpressaVezes > 0,
      );
      if (jaImpressa) {
        // Segunda via é decisão humana — o toque confirma.
        setSegundaVia(cupom);
      } else {
        await imprimir(cupom);
      }
      setCameraAberta(false);
      setOcupado(false);
    },
    [imprimir, ocupado],
  );

  // Imprimir a partir da LISTA: busca o cupom pelo grupo e cai no mesmo caminho do bip — a
  // folha, o carimbo de impressa e a contagem de vias são exatamente os mesmos.
  const imprimirPorGrupo = useCallback(
    async (grupoId: string) => {
      const r = await fetchCupom(grupoId);
      if (r.error || !r.data) {
        setErro(r.error ?? "Cupom não encontrado.");
        return;
      }
      await imprimir({ ...r.data, grupoId });
    },
    [imprimir],
  );

  // ⚠️ O LEITOR SÓ ESCUTA NO MODO BIPAR. Na lista o operador digita no campo de busca, e o
  // wedge trataria a digitação rápida como leitura de cupom.
  usarLeitorWedge((v) => void aoBipar(v), modo === "bipar" && !segundaVia);
  const leitorCamera = usarLeitorQr({
    aoLer: (v) => void aoBipar(v),
    ativo: modo === "bipar" && cameraAberta && !segundaVia,
  });

  const abas = (
    <div className="mx-auto mb-4 flex w-fit shrink-0 gap-1 rounded-xl border border-line bg-surface p-1">
      {(
        [
          ["bipar", "Bipar cupom"],
          ["lista", "Reservas do evento"],
        ] as const
      ).map(([chave, rotulo]) => (
        <button
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
            modo === chave
              ? "bg-[#2C2C2A] text-[#F1EFE8]"
              : "text-ink-soft hover:text-ink"
          }`}
          key={chave}
          onClick={() => {
            setModo(chave);
            setErro(null);
            setCameraAberta(false);
          }}
          type="button"
        >
          {rotulo}
        </button>
      ))}
    </div>
  );

  if (modo === "lista") {
    return (
      <div className="flex h-full min-h-0 flex-col bg-canvas p-4">
        {abas}
        {erro ? (
          <p className="mx-auto mb-3 max-w-3xl rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
            {erro}
          </p>
        ) : null}
        <div className="min-h-0 flex-1">
          <ListaDeReservas aoImprimir={imprimirPorGrupo} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center bg-canvas p-6">
      {abas}
      <div className="w-full max-w-md text-center">
        {erro ? (
          <p className="mb-4 rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
            {erro}
          </p>
        ) : null}

        {sucesso ? (
          <>
            <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[#2C2C2A] text-[#F1EFE8]">
              <Printer aria-hidden="true" size={38} />
            </span>
            <p className="mt-4 text-2xl font-bold text-ink">{sucesso.nome}</p>
            <p className="mt-1 text-lg text-ink-soft">
              {sucesso.folhas}{" "}
              {sucesso.folhas === 1 ? "folha de PA" : "folhas de PA"} na
              impressora
            </p>
          </>
        ) : segundaVia ? (
          <div className="rounded-2xl border border-line bg-surface p-6">
            <p className="text-lg font-bold text-ink">
              {segundaVia.cliente.nome}
            </p>
            <p className="mt-2 text-sm text-ink-soft">
              PA já impressa às{" "}
              <b>{horaBR(segundaVia.reservas[0]?.paImpressaEm ?? null)}</b>.
              Imprimir 2ª via?
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <button
                className="grid h-12 w-12 place-items-center rounded-xl border border-line text-ink"
                onClick={() => setSegundaVia(null)}
                title="Cancelar"
                type="button"
              >
                <X aria-hidden="true" size={20} />
              </button>
              <button
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#2C2C2A] px-6 text-base font-bold text-[#F1EFE8]"
                onClick={() => {
                  const cupom = segundaVia;
                  setSegundaVia(null);
                  void imprimir(cupom);
                }}
                type="button"
              >
                <Printer aria-hidden="true" size={18} /> 2ª via
              </button>
            </div>
          </div>
        ) : (
          <>
            {cameraAberta ? (
              <div className="mx-auto w-full overflow-hidden rounded-xl border border-line">
                <video
                  ref={leitorCamera.videoRef}
                  className="block w-full"
                  muted
                  playsInline
                />
                <canvas ref={leitorCamera.canvasRef} className="hidden" />
              </div>
            ) : (
              <span className="mx-auto grid h-24 w-24 place-items-center rounded-2xl border-2 border-dashed border-line text-ink-muted">
                {ocupado ? (
                  <Loader2
                    aria-hidden="true"
                    className="animate-spin"
                    size={44}
                  />
                ) : (
                  <QrCode aria-hidden="true" size={44} />
                )}
              </span>
            )}
            <p className="mt-4 text-xl font-semibold text-ink">
              Bipe o cupom de reserva
            </p>
            <p className="mt-1 text-sm text-ink-muted">
              A proposta sai sozinha — uma folha por unidade.
            </p>
            <button
              className="mx-auto mt-4 inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition hover:text-ink"
              onClick={() => setCameraAberta((v) => !v)}
              type="button"
            >
              {cameraAberta ? (
                <X aria-hidden="true" size={16} />
              ) : (
                <Camera aria-hidden="true" size={16} />
              )}
              {cameraAberta ? "Fechar câmera" : "Usar a câmera"}
            </button>
            {sucesso ? null : (
              <p className="mt-6 text-xs text-ink-muted">
                <Check aria-hidden="true" className="mr-1 inline" size={12} />
                Pronto para o próximo cupom
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
