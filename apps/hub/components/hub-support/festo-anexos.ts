"use client";

import { buildImageAnalysisSample } from "@/components/hub-support/hub-ticket-evidence-utils";

// COMO O PRINT CHEGA NA CONVERSA.
//
// Lucas (11/09/2026): *"capaz de reconhecer audio, imagem, arquivo prints, gravação"*.
//
// ⚠️ TRÊS PORTAS PARA A MESMA COISA, e isso é deliberado: capturar a tela, escolher um arquivo, ou
// simplesmente colar. Quem acabou de apertar PrintScreen quer colar; quem já salvou o print quer
// anexar; quem não sabe tirar print quer um botão. Uma porta só deixaria de fora a maioria.
//
// ⚠️ E A REDUÇÃO ACONTECE AQUI, NO NAVEGADOR, antes de qualquer coisa subir. O print de uma tela
// cheia em PNG passa de 3 MB, e o corpo de uma função da Vercel morre em ~4,5 MB: sem reduzir, a
// primeira pessoa que mandasse dois prints veria o Festos falhar com um erro que não explica nada.

/** O teto por print depois de reduzido. Acima disso a rota do Festos descarta em silêncio. */
const TETO_DA_AMOSTRA = 1_500_000;

/**
 * Captura a tela que a pessoa escolher e devolve um print reduzido.
 *
 * ⚠️ UM QUADRO, E NÃO UM VÍDEO. `getDisplayMedia` abre o seletor do navegador, tiramos uma foto e
 * paramos a captura imediatamente — a trilha fica viva por menos de um segundo. Gravar tela é outro
 * gesto, com outro custo, e continua morando no formulário.
 *
 * Devolve `null` quando a pessoa cancela o seletor, que é o caminho mais comum de "deu errado" aqui.
 */
export async function capturarPrintDaTela(): Promise<null | string> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    return null;
  }

  let trilha: MediaStreamTrack | undefined;

  try {
    const captura = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: true,
    });
    trilha = captura.getVideoTracks()[0];

    if (!trilha) return null;

    const video = document.createElement("video");
    video.srcObject = captura;
    video.muted = true;
    await video.play();

    // Um tique para o primeiro quadro existir: sem isto o canvas sai preto em parte dos
    // navegadores, e a pessoa manda um retângulo vazio achando que mandou a tela.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const contexto = canvas.getContext("2d");

    if (!contexto || !canvas.width || !canvas.height) return null;

    contexto.drawImage(video, 0, 0, canvas.width, canvas.height);
    video.pause();
    video.srcObject = null;

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((resultado) => resolve(resultado), "image/png");
    });

    return blob ? await prepararImagem(blob) : null;
  } catch {
    // Cancelar o seletor lança. Não é erro: é a pessoa desistindo.
    return null;
  } finally {
    trilha?.stop();
  }
}

/**
 * Reduz a imagem ao tamanho que viaja, e recusa o que não couber.
 *
 * Reusa `buildImageAnalysisSample`, a mesma redução que o formulário de chamado já faz — assim o
 * print que o Festos lê é exatamente o print que a análise de evidência leria.
 */
export async function prepararImagem(blob: Blob): Promise<null | string> {
  try {
    const amostra = await buildImageAnalysisSample(blob);

    if (!amostra || amostra.length > TETO_DA_AMOSTRA) return null;

    return amostra;
  } catch {
    return null;
  }
}

/**
 * Pega as imagens de um evento de colar.
 *
 * ⚠️ SÓ IMAGEM, E SÓ SE HOUVER. Colar texto tem que continuar colando texto — interceptar todo
 * `paste` quebraria o gesto mais comum do campo, que é colar a mensagem de erro copiada da tela.
 */
export function imagensDoPaste(evento: ClipboardEvent | React.ClipboardEvent): Blob[] {
  const itens = Array.from(
    (evento as ClipboardEvent).clipboardData?.items ??
      (evento as React.ClipboardEvent).clipboardData?.items ??
      [],
  );

  return itens
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((arquivo): arquivo is File => arquivo !== null);
}

/**
 * Grava um recado de voz e devolve o áudio.
 *
 * ⚠️ `MediaRecorder` SEM FORMATO FIXO. Cada navegador aceita um contêiner diferente (webm no
 * Chrome, mp4 no Safari); cravar `audio/webm` faria a gravação simplesmente não começar em metade
 * das máquinas do time, sem erro visível. Deixamos o navegador escolher e mandamos o que ele deu.
 */
export async function comecarAGravarVoz(): Promise<null | {
  encerrar: () => Promise<Blob | null>;
}> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    return null;
  }

  try {
    const entrada = await navigator.mediaDevices.getUserMedia({ audio: true });
    const gravador = new MediaRecorder(entrada);
    const pedacos: Blob[] = [];

    gravador.ondataavailable = (evento) => {
      if (evento.data.size > 0) pedacos.push(evento.data);
    };
    gravador.start();

    return {
      encerrar: () =>
        new Promise<Blob | null>((resolve) => {
          gravador.onstop = () => {
            // ⚠️ SOLTAR O MICROFONE É PARTE DE PARAR. Sem isto a luz do microfone fica acesa
            // depois da gravação — e a pessoa, com razão, conclui que o suporte está ouvindo.
            entrada.getTracks().forEach((trilha) => trilha.stop());
            resolve(pedacos.length ? new Blob(pedacos, { type: gravador.mimeType }) : null);
          };
          gravador.stop();
        }),
    };
  } catch {
    // Permissão negada, ou máquina sem microfone.
    return null;
  }
}

/** Manda o áudio para a transcrição e devolve o texto. */
export async function transcreverVoz(
  audio: Blob,
  accessToken: string,
): Promise<string> {
  const corpo = new FormData();
  const extensao = audio.type.includes("mp4") ? "mp4" : "webm";
  corpo.append("audio", audio, `recado.${extensao}`);

  const resposta = await fetch("/api/hub/festo/transcricao", {
    body: corpo,
    cache: "no-store",
    headers: { Authorization: `Bearer ${accessToken}` },
    method: "POST",
  });

  const payload = (await resposta.json().catch(() => null)) as null | {
    error?: unknown;
    texto?: unknown;
  };

  if (!resposta.ok || typeof payload?.texto !== "string") {
    throw new Error(
      typeof payload?.error === "string"
        ? payload.error
        : "Não consegui entender o áudio. Pode escrever?",
    );
  }

  return payload.texto;
}
