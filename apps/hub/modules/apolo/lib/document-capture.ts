// Captura de documento no cliente, compartilhada por TODOS os formulários do Apolo que sobem
// arquivo (wizard de cadastro + aba Documentos do CRM). Um lugar só pra a regra não divergir.
//
// CLIENT-ONLY: usa canvas/Image/URL — nunca importar em código server.
//
// A regra em uma frase: a imagem que vai pra LEITURA (MOST) é de alta qualidade, pra a IA
// enxergar texto miúdo de conta de luz; a que vai pro DRIVE é comprimida, pra caber no POST
// (o Vercel corta request acima de ~4.5MB) e economizar storage. PDF: pra LEITURA é RASTERIZADO
// em alta (senão a MOST rasteriza em DPI baixo e reprova por "baixa confiança"); pro DRIVE segue
// intacto — ver [[reference_most_qualidade_pdf_vs_print]].

export type ArquivoCapturado = {
  fileBase64: string;
  fileName: string;
  mimeType: string;
};

export function ehPdf(file: File): boolean {
  return file.type.includes("pdf") || file.name.toLowerCase().endsWith(".pdf");
}

// Imagem vira .jpg quando é reencodada pelo canvas.
export function trocarExtensaoParaJpg(nome: string): string {
  return `${nome.replace(/\.[^.]+$/, "")}.jpg`;
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

// Redimensiona (mantendo proporção), gira `graus` (0/90/180/270) e reencoda JPEG. A rotação
// existe porque foto de documento vinda do WhatsApp costuma chegar deitada, e a MOST NÃO gira a
// imagem antes de tentar reconhecer — foto girada 90° volta com result vazio.
export function comprimirImagem(
  file: File,
  maxLado: number,
  qualidade: number,
  graus = 0,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
      const w = Math.round(img.width * escala);
      const h = Math.round(img.height * escala);
      const canvas = document.createElement("canvas");
      // Em 90°/270° o canvas troca largura por altura.
      const deitado = graus === 90 || graus === 270;
      canvas.width = deitado ? h : w;
      canvas.height = deitado ? w : h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("Canvas indisponível."));
        return;
      }
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((graus * Math.PI) / 180);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
      resolve(canvas.toDataURL("image/jpeg", qualidade));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Imagem inválida."));
    };
    img.src = url;
  });
}

// Rasteriza a 1ª página de um PDF num JPEG de alta resolução, pra a MOST ler como se fosse um
// print. Motivo: PDF e imagem batem no MESMO endpoint de imagem da MOST; entregando o PDF cru, é
// ELA que rasteriza — num DPI baixo que deixa o texto miúdo da conta ilegível pro OCR e reprova
// por "baixa confiança". Só a 1ª página: a MOST processa só ela, e o comprovante traz o endereço
// na primeira. pdf.js é pesado (~1,3MB) — import DINÂMICO, só carrega quando o arquivo é PDF.
async function rasterizarPdf(file: File, maxLado: number, qualidade: number): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  // Worker servido do /public (independe do bundler); a versão é casada com pdfjs-dist no build.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  const dados = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: dados });
  const doc = await loadingTask.promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const escala = Math.max(1, maxLado / Math.max(base.width, base.height));
    const viewport = page.getViewport({ scale: escala });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas indisponível.");
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL("image/jpeg", qualidade);
  } finally {
    void loadingTask.destroy();
  }
}

// Vai pra LEITURA (MOST): alta qualidade (2600px @ 0.9). Um arquivo por chamada, então cabe no
// limite individual. Comprimir demais aqui degrada o OCR — foi o que fez o endereço vir vazio.
export async function arquivoParaLeitura(file: File, graus = 0): Promise<ArquivoCapturado> {
  if (ehPdf(file)) {
    // Rasteriza a 1ª página em alta pra a MOST ler como um print. Se o pdf.js falhar (PDF
    // protegido, fonte exótica), cai no fallback: manda o PDF cru (comportamento antigo).
    try {
      const jpeg = await rasterizarPdf(file, 2600, 0.9);
      return { fileBase64: jpeg, fileName: trocarExtensaoParaJpg(file.name), mimeType: "image/jpeg" };
    } catch {
      return { fileBase64: await fileToBase64(file), fileName: file.name, mimeType: file.type || "application/pdf" };
    }
  }
  return {
    fileBase64: await comprimirImagem(file, 2600, 0.9, graus),
    fileName: trocarExtensaoParaJpg(file.name),
    mimeType: "image/jpeg",
  };
}

// Vai pro DRIVE: compressão forte (1500px @ 0.72) pra caber no POST e economizar storage. Usa a
// mesma rotação que a leitura reconheceu, pra o arquivo guardado ficar em pé.
export async function arquivoParaDrive(file: File, graus = 0): Promise<ArquivoCapturado> {
  if (ehPdf(file)) {
    return { fileBase64: await fileToBase64(file), fileName: file.name, mimeType: file.type || "application/pdf" };
  }
  return {
    fileBase64: await comprimirImagem(file, 1500, 0.72, graus),
    fileName: trocarExtensaoParaJpg(file.name),
    mimeType: "image/jpeg",
  };
}
