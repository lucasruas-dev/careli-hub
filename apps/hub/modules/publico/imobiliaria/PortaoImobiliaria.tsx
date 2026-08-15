"use client";

import { useState } from "react";

import { cnpjValido } from "@/lib/publico/cad/regras";
import { BotaoPrimario, Cabecalho, CampoCnpj, Erro } from "@/modules/publico/ui/campos";
import { CascaPublica } from "@/modules/publico/ui/casca";

// ANTESSALA da imobiliária pública: um passo só, confirmar o CNPJ. É a trava de custo do
// auto-cadastro — o CadastroFlow completo que vem depois faz OCR do cartão CNPJ + enrich-company
// (torneiras PAGAS), então antes de abri-lo o servidor confere o CNPJ e emite a pré-sessão.
export function PortaoImobiliaria({
  onCnpjConferido,
  onJaCredenciada,
}: {
  // Recebe o token de pré-sessão amarrado ao CNPJ. A partir daí o CadastroFlow assume.
  onCnpjConferido: (preSessao: string) => void;
  // Já credenciada: em vez do wizard completo, o portal segue para a habilitação.
  onJaCredenciada?: (preSessao: string, nome: null | string) => void;
}) {
  const [cnpj, setCnpj] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [jaCredenciada, setJaCredenciada] = useState(false);

  const conferir = async () => {
    setCarregando(true);
    setErro("");
    try {
      const resposta = await fetch("/api/publico/imobiliaria/iniciar", {
        body: JSON.stringify({ cnpj }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const dados = (await resposta.json().catch(() => ({}))) as {
        nome?: string | null;
        error?: string;
        preSessao?: string;
        status?: string;
      };
      if (!resposta.ok) throw new Error(dados.error || "Não conseguimos concluir agora.");

      // JÁ CREDENCIADA: segue para a HABILITAÇÃO (não para o cadastro completo). Antes parava
      // aqui numa tela sem saída, e a imobiliária que só queria um empreendimento novo ficava
      // sem caminho — foi o que o Lucas viu ao testar (15/08).
      if (dados.status === "ja-credenciada" && dados.preSessao) {
        onJaCredenciada?.(dados.preSessao, dados.nome ?? null);
        return;
      }
      if (dados.status === "ja-credenciada") {
        setJaCredenciada(true);
        return;
      }
      if (dados.preSessao) {
        onCnpjConferido(dados.preSessao);
        return;
      }
      throw new Error("Não conseguimos concluir agora.");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  if (jaCredenciada) {
    return (
      <CascaPublica>
        <Cabecalho
          subtitulo="Esse CNPJ já está credenciado conosco. Seus corretores já podem enviar CADs pelo link do formulário. Em caso de dúvida, fale com a nossa central."
          titulo="Imobiliária já credenciada"
        />
      </CascaPublica>
    );
  }

  return (
    <CascaPublica
      rodape={
        <BotaoPrimario
          carregando={carregando}
          desabilitado={!cnpjValido(cnpj)}
          onClick={conferir}
          rotuloCarregando="Conferindo..."
        >
          Continuar
        </BotaoPrimario>
      }
    >
      <Cabecalho
        subtitulo="Vamos credenciar a sua imobiliária. Comece informando o CNPJ: no próximo passo você envia o cartão CNPJ e a gente lê os dados para você."
        titulo="Cadastro da imobiliária"
      />
      <CampoCnpj aoMudar={setCnpj} rotulo="CNPJ da imobiliária" valor={cnpj} />
      <Erro>{erro}</Erro>
    </CascaPublica>
  );
}
