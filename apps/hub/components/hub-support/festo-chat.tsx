"use client";

import { FestoRobo } from "@/components/hub-support/festo-robo";
import { falarComOFesto, type FalaDoChat } from "@/lib/hub-support/festo-cliente";
import { useAuth } from "@/providers/auth-provider";
import { FileText, Loader2, Send, Ticket } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// A CONVERSA COM O FESTO.
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
// ⚠️ O CHAMADO CONTINUA À MÃO, num botão visível o tempo todo. Tem gente que já sabe exatamente o
// que quer registrar e não precisa de conversa; e quando o Festos não der conta, o caminho tem que
// estar visível, não escondido atrás de uma negociação com o robô. Suporte que prende a pessoa numa
// conversa é pior do que o formulário que ele substituiu.
//
// ⚠️ O QUE AINDA NÃO ESTÁ AQUI: anexo, print, áudio e gravação de tela continuam sendo do
// formulário — o chat é texto. E o Festos ainda não LÊ o banco nem o código durante a conversa: ele
// entende, orienta e registra. Quem quiser mandar a evidência junto usa o botão do chamado.

type Fala = FalaDoChat & {
  /** O chamado que ESTA fala abriu. Vira o cartão com o protocolo. */
  chamado?: null | { protocolo: string; titulo: string };
};

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
    "Me conta o que aconteceu — pode ser do jeito que vier.",
    "Se for dúvida, eu respondo aqui mesmo. Se for problema, eu abro o chamado com o que a gente descobrir.",
  ].join(" ");
}

export function FestoChat({ aoAbrirChamado }: { aoAbrirChamado: () => void }) {
  const { hubUser } = useAuth();
  const pathname = usePathname();
  const primeiroNome = hubUser?.name?.trim().split(/\s+/)[0] ?? null;
  const [falas, setFalas] = useState<Fala[]>([
    { de: "festo", texto: abertura(primeiroNome) },
  ]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [erro, setErro] = useState<null | string>(null);
  const fim = useRef<HTMLDivElement>(null);

  // A conversa acompanha a última fala, como qualquer chat.
  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [falas, pensando]);

  async function enviar() {
    const pergunta = texto.trim();
    if (!pergunta || pensando) return;

    setTexto("");
    setErro(null);
    const comAPergunta: Fala[] = [...falas, { de: "pessoa", texto: pergunta }];
    setFalas(comAPergunta);
    setPensando(true);

    try {
      const resposta = await falarComOFesto({
        // ⚠️ A ABERTURA NÃO SOBE. Ela não saiu do modelo, e devolvê-la como se fosse dele ensinaria
        // o Festos a imitar aquele tom fixo em toda primeira resposta.
        conversa: comAPergunta.slice(1).map((fala) => ({
          de: fala.de,
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
      // ⚠️ FALHA DO FESTO NÃO PODE DEIXAR A PESSOA SEM CAMINHO. Se ele cair, o que não pode cair é
      // o suporte: a mensagem aponta o botão de chamado, que não depende de modelo nenhum.
      setErro(
        `${e instanceof Error ? e.message : "Não consegui responder agora."} Se preferir não esperar, abre o chamado aqui embaixo que alguém olha.`,
      );
    } finally {
      setPensando(false);
    }
  }

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
                className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-[13px] leading-relaxed ${
                  fala.de === "pessoa"
                    ? "rounded-br-sm bg-slate-900 text-white"
                    : "rounded-bl-sm bg-slate-100 text-slate-800"
                }`}
              >
                {fala.texto}
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
            placeholder="Escreve aqui. Ex.: não consigo salvar a proposta"
            rows={1}
            value={texto}
          />
          <button
            aria-label="Enviar"
            className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-900 text-white transition-opacity disabled:opacity-40"
            disabled={!texto.trim() || pensando}
            onClick={() => void enviar()}
            type="button"
          >
            <Send aria-hidden="true" className="size-4" />
          </button>
        </div>

        <button
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] font-semibold text-slate-600 transition-colors hover:bg-slate-50"
          onClick={aoAbrirChamado}
          type="button"
        >
          <FileText aria-hidden="true" className="size-3.5" />
          Prefiro abrir um chamado com print ou gravação
        </button>
      </div>
    </div>
  );
}
