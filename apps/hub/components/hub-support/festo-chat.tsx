"use client";

import {
  capturarPrintDaTela,
  comecarAGravarVoz,
  imagensDoPaste,
  prepararImagem,
  transcreverVoz,
} from "@/components/hub-support/festo-anexos";
import { FestoRobo } from "@/components/hub-support/festo-robo";
import {
  falarComOFesto,
  type FalaDoChat,
  tokenDaSessao,
} from "@/lib/hub-support/festo-cliente";
import { useAuth } from "@/providers/auth-provider";
import {
  ImagePlus,
  Loader2,
  Mic,
  MonitorUp,
  Send,
  Square,
  Ticket,
  X,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// A CONVERSA COM O FESTOS.
//
// Lucas (11/09/2026), vendo o formulário abrir no lugar do chat: *"não foi essa tela que pensei,
// pensei em um chat"*. E antes, corrigindo o enquadramento inteiro: *"não queria um canal de
// abertura de ticket, queria uma plataforma de atendimento ao usuario"*.
//
// ⚠️ A DIFERENÇA NÃO É COSMÉTICA. No formulário, o primeiro ato da pessoa já é abrir um chamado —
// ela descreve o problema para uma fila e vai embora esperando. Na conversa, o primeiro ato é
// contar o que houve, e o chamado passa a ser CONSEQUÊNCIA: nasce quando o assunto não se resolve
// ali, e nasce preenchido pelo Festos. Muita coisa se resolve ali.
//
// ⚠️ E NÃO HÁ MAIS BOTÃO DE ABRIR CHAMADO. Lucas, 11/09/2026: *"abrir chamado é com o Festos"* e
// *"não precisa de um botão para abrir chamados"*. O botão mantinha viva a ideia que a conversa veio
// substituir — a de que registrar é um ato da PESSOA, feito num formulário. Aqui é ele quem abre, e
// com o que a conversa apurou; quem chega sabendo o que quer registrar simplesmente conta em uma
// frase, e o chamado nasce igual.
//
// ⚠️ PRINT, COLAR E ÁUDIO ENTRAM AQUI; vídeo, não. A Claude lê imagem nativamente e não lê vídeo, e
// a voz vira TEXTO antes de ser enviada, com a pessoa revisando o que foi entendido.

type Fala = FalaDoChat & {
  /** O chamado que ESTA fala abriu. Vira o cartão com o protocolo. */
  chamado?: null | { protocolo: string; titulo: string };
};

/** Quantos prints cabem numa mensagem. O mesmo teto que a rota aplica do outro lado. */
const PRINTS_POR_MENSAGEM = 2;

/**
 * A abertura, escrita e não gerada.
 *
 * ⚠️ A PRIMEIRA FRASE NÃO PODE CUSTAR UMA CHAMADA DE MODELO. Ela é igual toda vez, aparece antes de
 * a pessoa digitar qualquer coisa, e pagar por ela seria gastar em toda abertura do painel —
 * inclusive nas que a pessoa fecha em seguida.
 */
function abertura(primeiroNome: null | string): string {
  return [
    primeiroNome ? `Oi, ${primeiroNome}!` : "Oi!",
    "Me conta o que aconteceu — pode ser do jeito que vier, por escrito, por áudio ou mandando um print.",
    "Se for dúvida, eu respondo aqui mesmo. Se for problema, eu abro o chamado com o que a gente descobrir.",
  ].join(" ");
}

export function FestoChat() {
  const { hubUser } = useAuth();
  const pathname = usePathname();
  const primeiroNome = hubUser?.name?.trim().split(/\s+/)[0] ?? null;
  const [falas, setFalas] = useState<Fala[]>([
    { de: "festo", texto: abertura(primeiroNome) },
  ]);
  const [texto, setTexto] = useState("");
  /** Os prints escolhidos e ainda não enviados. */
  const [prints, setPrints] = useState<string[]>([]);
  const [pensando, setPensando] = useState(false);
  const [ocupado, setOcupado] = useState<null | "print" | "transcrevendo">(null);
  const [gravando, setGravando] = useState<null | {
    encerrar: () => Promise<Blob | null>;
  }>(null);
  const [erro, setErro] = useState<null | string>(null);
  const fim = useRef<HTMLDivElement>(null);
  const arquivo = useRef<HTMLInputElement>(null);

  // A conversa acompanha a última fala, como qualquer chat.
  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [falas, pensando, prints]);

  async function juntarPrints(blobs: Blob[]) {
    const espaco = PRINTS_POR_MENSAGEM - prints.length;
    if (espaco <= 0) return;

    const preparados = (
      await Promise.all(blobs.slice(0, espaco).map(prepararImagem))
    ).filter((imagem): imagem is string => Boolean(imagem));

    if (preparados.length < blobs.slice(0, espaco).length) {
      setErro("Alguma imagem não deu para usar. Tenta com um print menor.");
    }

    if (preparados.length) {
      setPrints((atuais) => [...atuais, ...preparados].slice(0, PRINTS_POR_MENSAGEM));
    }
  }

  async function enviar() {
    const pergunta = texto.trim();
    if ((!pergunta && prints.length === 0) || pensando) return;

    const imagens = prints;
    setTexto("");
    setPrints([]);
    setErro(null);
    const comAPergunta: Fala[] = [
      ...falas,
      { de: "pessoa", imagens, texto: pergunta },
    ];
    setFalas(comAPergunta);
    setPensando(true);

    try {
      const resposta = await falarComOFesto({
        // ⚠️ A ABERTURA NÃO SOBE. Ela não saiu do modelo, e devolvê-la como se fosse dele ensinaria
        // o Festos a imitar aquele tom fixo em toda primeira resposta.
        conversa: comAPergunta.slice(1).map((fala) => ({
          de: fala.de,
          imagens: fala.imagens,
          texto: fala.texto,
        })),
        // A tela em que a pessoa está é o que separa "não consigo salvar" de "não consigo salvar na
        // proposta do Hércules" — e é de graça: o caminho já está no navegador.
        tela: pathname,
      });

      setFalas((atual) => [
        ...atual,
        { chamado: resposta.chamado, de: "festo", texto: resposta.texto },
      ]);
    } catch (e) {
      // ⚠️ QUANDO ELE CAI, A PESSOA PRECISA SABER O QUE FAZER. Não existe mais botão de chamado para
      // apontar, então o que resta é o caminho humano — e dizer isso é melhor do que deixar um erro
      // seco na tela de quem já estava com problema.
      setErro(
        `${e instanceof Error ? e.message : "Não consegui responder agora."} Tenta de novo daqui a pouco; se for urgente, chama alguém do time.`,
      );
    } finally {
      setPensando(false);
    }
  }

  async function alternarGravacao() {
    if (gravando) {
      const audio = await gravando.encerrar();
      setGravando(null);

      if (!audio) return;

      setOcupado("transcrevendo");
      try {
        const transcrito = await transcreverVoz(audio, await tokenDaSessao());
        // ⚠️ O TEXTO VAI PARA O CAMPO, e não direto para o Festos. A transcrição erra nome próprio
        // e número; deixar a pessoa ver e corrigir antes de enviar custa um segundo e evita um
        // chamado aberto com o relato trocado.
        setTexto((atual) => (atual ? `${atual} ${transcrito}` : transcrito));
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não consegui entender o áudio.");
      } finally {
        setOcupado(null);
      }
      return;
    }

    const gravador = await comecarAGravarVoz();

    if (!gravador) {
      setErro("Não consegui usar o microfone. Confere a permissão do navegador?");
      return;
    }

    setErro(null);
    setGravando(gravador);
  }

  const podeEnviar = Boolean(texto.trim() || prints.length) && !pensando;

  return (
    <div className="flex h-[26rem] flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {falas.map((fala, indice) => (
          <div key={`${fala.de}-${indice}`}>
            <div
              className={`flex items-end gap-2 ${fala.de === "pessoa" ? "justify-end" : ""}`}
            >
              {fala.de === "festo" ? (
                <FestoRobo className="size-7 shrink-0" />
              ) : null}
              <div
                className={`max-w-[80%] space-y-2 rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                  fala.de === "pessoa"
                    ? "rounded-br-sm bg-slate-900 text-white"
                    : "rounded-bl-sm bg-slate-100 text-slate-800"
                }`}
              >
                {fala.imagens?.length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {fala.imagens.map((imagem, posicao) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt="Print enviado"
                        className="max-h-32 rounded-lg border border-white/20"
                        key={posicao}
                        src={imagem}
                      />
                    ))}
                  </div>
                ) : null}
                {fala.texto ? (
                  <p className="m-0 whitespace-pre-wrap">{fala.texto}</p>
                ) : null}
              </div>
            </div>

            {/* ⚠️ O PROTOCOLO GANHA CARTÃO PRÓPRIO, e não fica só dentro do texto do Festos. É o
                único dado desta conversa que a pessoa vai precisar copiar depois — e procurá-lo no
                meio de um parágrafo três dias depois é exatamente o atrito que o chat veio tirar. */}
            {fala.chamado ? (
              <div className="ml-9 mt-2 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2">
                <Ticket
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-emerald-600"
                />
                <div className="min-w-0">
                  <p className="m-0 text-[12px] font-semibold text-emerald-900">
                    Chamado {fala.chamado.protocolo}
                  </p>
                  <p className="m-0 mt-0.5 text-[12px] leading-snug text-emerald-800">
                    {fala.chamado.titulo}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        ))}

        {pensando ? (
          <div className="flex items-center gap-2 text-[12px] text-slate-500">
            <FestoRobo className="size-7 shrink-0" estado="pulando" />
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            Pensando…
          </div>
        ) : null}

        {erro ? (
          <p className="m-0 rounded-xl bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
            {erro}
          </p>
        ) : null}

        <div ref={fim} />
      </div>

      <div className="border-t border-slate-100 p-3">
        {prints.length ? (
          <div className="mb-2 flex flex-wrap gap-2">
            {prints.map((imagem, posicao) => (
              <div className="relative" key={posicao}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  alt="Print a enviar"
                  className="h-14 rounded-lg border border-slate-200"
                  src={imagem}
                />
                <button
                  aria-label="Tirar este print"
                  className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-slate-900 text-white"
                  onClick={() =>
                    setPrints((atuais) => atuais.filter((_, i) => i !== posicao))
                  }
                  type="button"
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          <textarea
            aria-label="Conte o que aconteceu"
            className="max-h-28 min-h-[2.5rem] flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-800 outline-none focus:border-slate-400"
            onChange={(ev) => setTexto(ev.target.value)}
            // ⚠️ ENTER ENVIA, SHIFT+ENTER QUEBRA LINHA. É o que a pessoa já espera de qualquer
            // conversa — e obrigá-la a clicar num botão a cada frase faria o chat render menos que
            // o formulário que ele veio substituir.
            onKeyDown={(ev) => {
              if (ev.key === "Enter" && !ev.shiftKey) {
                ev.preventDefault();
                void enviar();
              }
            }}
            // Colar print é o gesto de quem acabou de apertar PrintScreen. Texto continua colando
            // normalmente: só entra aqui o que vier como arquivo de imagem.
            onPaste={(ev) => {
              const imagens = imagensDoPaste(ev);
              if (imagens.length) {
                ev.preventDefault();
                void juntarPrints(imagens);
              }
            }}
            placeholder={
              gravando ? "Gravando… fale e toque no quadrado" : "Escreve, cola um print ou grava um áudio"
            }
            rows={1}
            value={texto}
          />
          <button
            aria-label="Enviar"
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-900 text-white transition-opacity disabled:opacity-40"
            disabled={!podeEnviar}
            onClick={() => void enviar()}
            type="button"
          >
            <Send aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="mt-2 flex items-center gap-1">
          <input
            accept="image/*"
            className="hidden"
            multiple
            onChange={(ev) => {
              const escolhidos = Array.from(ev.target.files ?? []);
              ev.target.value = "";
              if (escolhidos.length) void juntarPrints(escolhidos);
            }}
            ref={arquivo}
            type="file"
          />

          <BotaoDoChat
            aoClicar={async () => {
              setOcupado("print");
              const print = await capturarPrintDaTela();
              setOcupado(null);
              if (print) setPrints((atuais) => [...atuais, print].slice(0, PRINTS_POR_MENSAGEM));
            }}
            desabilitado={prints.length >= PRINTS_POR_MENSAGEM || ocupado !== null}
            icone={
              ocupado === "print" ? (
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              ) : (
                <MonitorUp aria-hidden="true" className="size-3.5" />
              )
            }
            rotulo="Print da tela"
          />

          <BotaoDoChat
            aoClicar={() => arquivo.current?.click()}
            desabilitado={prints.length >= PRINTS_POR_MENSAGEM || ocupado !== null}
            icone={<ImagePlus aria-hidden="true" className="size-3.5" />}
            rotulo="Imagem"
          />

          <BotaoDoChat
            aoClicar={alternarGravacao}
            desabilitado={ocupado === "print" || ocupado === "transcrevendo"}
            destacado={Boolean(gravando)}
            icone={
              ocupado === "transcrevendo" ? (
                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              ) : gravando ? (
                <Square aria-hidden="true" className="size-3.5" />
              ) : (
                <Mic aria-hidden="true" className="size-3.5" />
              )
            }
            rotulo={
              gravando ? "Parar" : ocupado === "transcrevendo" ? "Ouvindo…" : "Áudio"
            }
          />
        </div>
      </div>
    </div>
  );
}

function BotaoDoChat({
  aoClicar,
  desabilitado,
  destacado,
  icone,
  rotulo,
}: {
  aoClicar: () => void | Promise<void>;
  desabilitado?: boolean;
  destacado?: boolean;
  icone: React.ReactNode;
  rotulo: string;
}) {
  return (
    <button
      className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors disabled:opacity-40 ${
        destacado
          ? "bg-rose-50 text-rose-600"
          : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"
      }`}
      disabled={desabilitado}
      onClick={() => void aoClicar()}
      title={rotulo}
      type="button"
    >
      {icone}
      {rotulo}
    </button>
  );
}
