"use client";

import { Camera, Check, Loader2, Printer, QrCode, X } from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";

import { codigoDoCupom, conteudoDoQrDoCupom, ehIdDeCupom } from "@/lib/prometeu/reservas-evento";

import {
  fetchCupom,
  marcarPaImpressaRemoto,
  type CupomReservaLinha,
} from "../../data/prometeu-operations";
import { usarLeitorQr } from "../checkin/usar-leitor-qr";
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

function usarLeitorWedge(aoLer: (valor: string) => void, ativo: boolean) {
  const bufferRef = useRef("");
  const ultimoRef = useRef(0);
  const aoLerRef = useRef(aoLer);

  useEffect(() => {
    aoLerRef.current = aoLer;
  }, [aoLer]);

  useEffect(() => {
    if (!ativo) return;
    const aoTeclar = (ev: KeyboardEvent) => {
      const agora = Date.now();
      if (agora - ultimoRef.current > 300) bufferRef.current = "";
      ultimoRef.current = agora;
      if (ev.key === "Enter") {
        const lido = bufferRef.current.trim();
        bufferRef.current = "";
        if (lido.length >= 6) aoLerRef.current(lido);
        return;
      }
      if (ev.key.length === 1) bufferRef.current += ev.key;
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [ativo]);
}

function horaBR(iso: null | string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function PostoPaView() {
  const [erro, setErro] = useState<null | string>(null);
  const [ocupado, setOcupado] = useState(false);
  const [cameraAberta, setCameraAberta] = useState(false);
  const [segundaVia, setSegundaVia] = useState<null | CupomCarregado>(null);
  const [sucesso, setSucesso] = useState<null | { folhas: number; nome: string }>(null);

  const imprimir = useCallback(async (cupom: CupomCarregado) => {
    const qrDataUrl = await QRCode.toDataURL(conteudoDoQrDoCupom(cupom.grupoId), {
      margin: 1,
      width: 220,
    });
    // Os proponentes viajam gravados na reserva; reserva antiga sem eles = titular a 100%.
    const proponentes = cupom.reservas[0]?.proponentes?.length
      ? cupom.reservas[0].proponentes.map((p) => ({
          documento: p.documento,
          nome: p.nome,
          percentual: p.percentual,
        }))
      : [{ documento: cupom.cliente.documento, nome: cupom.cliente.nome, percentual: 100 }];

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
      const jaImpressa = cupom.reservas.some((linha) => linha.paImpressaVezes > 0);
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

  usarLeitorWedge((v) => void aoBipar(v), !segundaVia);
  const leitorCamera = usarLeitorQr({
    aoLer: (v) => void aoBipar(v),
    ativo: cameraAberta && !segundaVia,
  });

  return (
    <div className="grid h-full min-h-0 place-items-center bg-canvas p-6">
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
              {sucesso.folhas} {sucesso.folhas === 1 ? "folha de PA" : "folhas de PA"} na impressora
            </p>
          </>
        ) : segundaVia ? (
          <div className="rounded-2xl border border-line bg-surface p-6">
            <p className="text-lg font-bold text-ink">{segundaVia.cliente.nome}</p>
            <p className="mt-2 text-sm text-ink-soft">
              PA já impressa às{" "}
              <b>{horaBR(segundaVia.reservas[0]?.paImpressaEm ?? null)}</b>. Imprimir 2ª via?
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
                <video ref={leitorCamera.videoRef} className="block w-full" muted playsInline />
                <canvas ref={leitorCamera.canvasRef} className="hidden" />
              </div>
            ) : (
              <span className="mx-auto grid h-24 w-24 place-items-center rounded-2xl border-2 border-dashed border-line text-ink-muted">
                {ocupado ? (
                  <Loader2 aria-hidden="true" className="animate-spin" size={44} />
                ) : (
                  <QrCode aria-hidden="true" size={44} />
                )}
              </span>
            )}
            <p className="mt-4 text-xl font-semibold text-ink">Bipe o cupom de reserva</p>
            <p className="mt-1 text-sm text-ink-muted">
              A proposta sai sozinha — uma folha por unidade.
            </p>
            <button
              className="mx-auto mt-4 inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition hover:text-ink"
              onClick={() => setCameraAberta((v) => !v)}
              type="button"
            >
              {cameraAberta ? <X aria-hidden="true" size={16} /> : <Camera aria-hidden="true" size={16} />}
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
