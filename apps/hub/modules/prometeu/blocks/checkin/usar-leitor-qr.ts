"use client";

import jsQR from "jsqr";
import { useCallback, useEffect, useRef, useState } from "react";

// LEITOR DE QR da câmera do celular, para o check-in do organizador.
//
// Dois caminhos, porque nenhum sozinho cobre o time inteiro no dia do evento:
//
//   1) BarcodeDetector — nativo, rápido, sem custo de CPU. Existe no Chrome/Android, que é o
//      caso mais comum, mas NÃO existe no Safari do iPhone nem no Firefox.
//   2) jsQR — JavaScript puro, funciona em qualquer navegador. Mais pesado, então roda em
//      intervalo controlado em vez de a cada frame.
//
// Se dependêssemos só do nativo, o organizador que aparecesse com iPhone ficaria sem check-in
// na porta do evento, sem tempo de resolver.

type EstadoDoLeitor =
  | "parado"
  | "pedindo-camera"
  | "lendo"
  | "sem-camera"
  | "sem-permissao";

type BarcodeDetectorLike = {
  detect: (fonte: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

// A cada quanto tempo tentamos decodificar. Menos que isso trava o celular; mais que isso o
// organizador sente a leitura "demorando" com o crachá parado na frente da câmera.
const INTERVALO_MS = 220;

export function usarLeitorQr({
  aoLer,
  ativo,
}: {
  aoLer: (valor: string) => void;
  ativo: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<BarcodeDetectorLike | null>(null);
  const aoLerRef = useRef(aoLer);
  const [estado, setEstado] = useState<EstadoDoLeitor>("parado");

  // Guarda o callback numa ref: sem isso, cada render remontaria a câmera (a permissão pisca e a
  // leitura reinicia no meio da fila).
  useEffect(() => {
    aoLerRef.current = aoLer;
  }, [aoLer]);

  const parar = useCallback(() => {
    for (const trilha of streamRef.current?.getTracks() ?? []) {
      trilha.stop();
    }
    streamRef.current = null;
    setEstado("parado");
  }, []);

  useEffect(() => {
    if (!ativo) {
      parar();
      return;
    }

    let cancelado = false;
    let timer: number | null = null;

    const ler = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;

      if (cancelado || !video || !canvas || video.readyState < 2) {
        return;
      }

      try {
        if (detectorRef.current) {
          const achados = await detectorRef.current.detect(video);
          const valor = achados[0]?.rawValue;
          if (valor) {
            aoLerRef.current(valor);
            return;
          }
        }

        // Caminho jsQR: precisa do frame rasterizado num canvas.
        const largura = video.videoWidth;
        const altura = video.videoHeight;

        if (!largura || !altura) {
          return;
        }

        canvas.width = largura;
        canvas.height = altura;
        const contexto = canvas.getContext("2d", { willReadFrequently: true });

        if (!contexto) {
          return;
        }

        contexto.drawImage(video, 0, 0, largura, altura);
        const imagem = contexto.getImageData(0, 0, largura, altura);
        const achado = jsQR(imagem.data, largura, altura, {
          inversionAttempts: "dontInvert",
        });

        if (achado?.data) {
          aoLerRef.current(achado.data);
        }
      } catch {
        // Frame ruim (foco, movimento, luz): a próxima tentativa resolve. Não derruba a câmera.
      }
    };

    void (async () => {
      setEstado("pedindo-camera");

      const detectorGlobal = (
        window as unknown as {
          BarcodeDetector?: new (opcoes: { formats: string[] }) => BarcodeDetectorLike;
        }
      ).BarcodeDetector;

      if (detectorGlobal) {
        try {
          detectorRef.current = new detectorGlobal({ formats: ["qr_code"] });
        } catch {
          detectorRef.current = null;
        }
      } else {
        detectorRef.current = null;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setEstado("sem-camera");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          // facingMode "environment" = câmera traseira. Sem isso o celular abre a frontal e o
          // organizador fica se filmando enquanto a fila espera.
          video: { facingMode: { ideal: "environment" } },
        });

        if (cancelado) {
          for (const trilha of stream.getTracks()) trilha.stop();
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }

        setEstado("lendo");
        timer = window.setInterval(() => void ler(), INTERVALO_MS);
      } catch (erro) {
        const negada =
          erro instanceof DOMException &&
          (erro.name === "NotAllowedError" || erro.name === "SecurityError");
        setEstado(negada ? "sem-permissao" : "sem-camera");
      }
    })();

    return () => {
      cancelado = true;
      if (timer !== null) window.clearInterval(timer);
      parar();
    };
  }, [ativo, parar]);

  return { canvasRef, estado, videoRef };
}
