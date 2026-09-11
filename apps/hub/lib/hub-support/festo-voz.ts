import type { CacaVoiceSettings } from "@/lib/iris/tts";

// A VOZ DO FESTOS.
//
// Lucas (11/09/2026): *"deixa ele responder em audio também, vou escolher a voz no eleven"*.
//
// ⚠️ O MOTOR JÁ EXISTE e não vamos duplicá-lo: `lib/iris/tts.ts` fala com a ElevenLabs desde 4/jul,
// é o que dá voz à CACÁ no WhatsApp, e a chave (`ELEVENLABS_API_KEY`) já está no ambiente. O que
// este arquivo acrescenta é só o que é do Festos: a voz dele, o ajuste dela, e o preparo do texto.
//
// ⚠️ E A VOZ PRECISA SER OUTRA. A da CACÁ é a voz que fala com o CLIENTE, no WhatsApp; se o suporte
// interno falasse com a mesma, as duas viravam a mesma pessoa na cabeça de quem ouve as duas — e é
// justamente quem trabalha aqui dentro que ouve as duas.

/**
 * A voz escolhida pelo Lucas na biblioteca da ElevenLabs.
 *
 * ⚠️ ENQUANTO ESTIVER VAZIA, O FESTOS NÃO FALA — e isso é deliberado. Sem voz própria, a única
 * alternativa seria emprestar a da CACÁ, e o suporte interno passaria a soar como a atendente que
 * fala com o cliente. Ficar mudo por alguns dias é melhor do que estrear com a voz errada: a
 * primeira impressão de um personagem se dá uma vez só.
 *
 * Para ligar: `FESTO_VOICE_ID` no ambiente, ou o id aqui embaixo, e um deploy.
 */
export const FESTO_VOICE_ID = process.env.FESTO_VOICE_ID?.trim() || "";

/** O Festos tem voz? Se não tem, o botão de ouvir nem aparece. */
export function oFestosTemVoz(): boolean {
  return Boolean(FESTO_VOICE_ID) && Boolean(process.env.ELEVENLABS_API_KEY?.trim());
}

/**
 * O ajuste da voz dele.
 *
 * ⚠️ MAIS ESTÁVEL E MENOS ESTILIZADO QUE A CACÁ (que roda 0,40 / 0,45). O Festos lê explicação
 * técnica — nome de tela, número de protocolo, passo a passo —, e estilo alto nesse tipo de texto
 * produz entonação dramática em cima de instrução, que soa falso e atrapalha entender. Fala um
 * tiquinho mais devagar pelo mesmo motivo.
 */
export const FESTO_VOICE_SETTINGS: CacaVoiceSettings = {
  similarity_boost: 0.8,
  speed: 0.96,
  stability: 0.55,
  style: 0.3,
  use_speaker_boost: true,
};

/**
 * ⚠️ TETO DE 700 CARACTERES, e ele é de custo E de paciência. A ElevenLabs cobra por caractere, e
 * ninguém no suporte ouve um minuto de robô falando: as respostas do Festos são de 2 a 6 linhas por
 * instrução, e o que passar disso quase sempre é uma lista que se lê melhor do que se ouve.
 */
const TETO_DE_CARACTERES = 700;

/**
 * Prepara o texto para ser falado.
 *
 * ⚠️ O QUE SE LÊ E O QUE SE OUVE NÃO SÃO A MESMA COISA. Três coisas quebram a fala e todas aparecem
 * na resposta do Festos: link (vira uma sopa de letras lida caractere a caractere), marcação
 * (asterisco e hífen de lista viram ruído) e o PROTOCOLO — "HD-0102" sai como "agá-dê-zero-cento e
 * dois" ou coisa pior. O protocolo continua escrito na tela, no cartão verde; na voz ele vira
 * "o número do chamado está aqui na tela".
 */
export function textoParaVoz(texto: string): string {
  const limpo = String(texto ?? "")
    // Link não se fala. O texto continua na tela para quem quiser clicar.
    .replace(/https?:\/\/\S+/g, "o link que está aqui na conversa")
    // Protocolo: "HD-0102" e companhia.
    .replace(/\b[A-Z]{2,4}-\d{3,6}\b/g, "o número do chamado, que está aqui na tela")
    // Marcação de negrito e itálico.
    .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, "$1")
    // Marcador de lista no começo da linha vira pausa.
    .replace(/^\s*[-•]\s*/gm, "")
    // Caminho de tela ("/hercules/venda") não se fala.
    .replace(/(?:^|\s)\/[a-z0-9/_-]{3,}/gi, " ")
    .replace(/[ \t]+/g, " ")
    .trim();

  if (limpo.length <= TETO_DE_CARACTERES) {
    return limpo;
  }

  // ⚠️ CORTA NO FIM DE UMA FRASE, e não no meio de uma palavra. Áudio que termina em "prop" é pior
  // do que áudio curto: quem ouve acha que a conexão caiu e repete a pergunta.
  const pedaco = limpo.slice(0, TETO_DE_CARACTERES);
  const ultimoPonto = Math.max(
    pedaco.lastIndexOf(". "),
    pedaco.lastIndexOf("! "),
    pedaco.lastIndexOf("? "),
  );

  return ultimoPonto > TETO_DE_CARACTERES / 2
    ? pedaco.slice(0, ultimoPonto + 1)
    : `${pedaco.trimEnd()}. O resto está escrito aqui na conversa.`;
}
