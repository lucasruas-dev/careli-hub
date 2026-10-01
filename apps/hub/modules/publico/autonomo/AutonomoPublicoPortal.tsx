"use client";

import { useState } from "react";

import { cpfValido } from "@/lib/apolo/documento";
import type { EmpreendimentoPublico } from "@/lib/publico/cad/regras";
import { avisoDoDocumento } from "@/lib/publico/cad/regras";
import { CadastroFlow } from "@/modules/apolo/blocks/cadastro/cadastro-flow";
import { EscolhaEmpreendimentos } from "@/modules/publico/imobiliaria/ImobiliariaPublicoPortal";
import { BotaoPrimario, Cabecalho, CampoCpf, Erro } from "@/modules/publico/ui/campos";
import { CascaPublica } from "@/modules/publico/ui/casca";
import { C } from "@/modules/publico/ui/tokens";

// O LINK PÚBLICO DO CORRETOR AUTÔNOMO (01/10/2026), no MESMO desenho do link da imobiliária:
//
//   1) EMPREENDIMENTOS: em quais ele quer atuar. É INTERESSE, e a tela diz isso: a liberação de cada
//      um é decisão da Careli, depois de aprovar o cadastro (Lucas: o autônomo "indica interesse").
//   2) CPF: o portão confere o CPF e emite a pré-sessão (trava das torneiras pagas do wizard).
//   3) WIZARD: o MESMO CadastroFlow que o time usa (tipo="corretor"), em modo público. É isso que
//      garante a mesma ficha e os mesmos dados; o que muda é quem preenche.
//
// ⚠️ NADA AQUI FALA DE FILA, CÓDIGO OU DE QUEM NA CARELI ESTÁ COM O PEDIDO
// ([[feedback_corretor_nao_ve_divisao_interna]]). A pessoa sabe o estado do cadastro dela e mais nada.
export function AutonomoPublicoPortal({
  empreendimentos,
}: {
  // Vitrine mastigada no server component (com credencial de serviço).
  empreendimentos: EmpreendimentoPublico[];
}) {
  const [interesse, setInteresse] = useState<null | string[]>(null);
  const [preSessao, setPreSessao] = useState<null | string>(null);

  if (interesse === null) {
    return (
      <EscolhaEmpreendimentos
        empreendimentos={empreendimentos}
        onConfirmar={setInteresse}
        subtitulo="Selecione um ou mais. É um pedido: a liberação de cada empreendimento é feita pela Careli depois que o seu cadastro for aprovado."
        textoVazio="No momento não há empreendimentos abertos para novos parceiros. Você pode fazer o seu cadastro mesmo assim."
        titulo="Em quais empreendimentos você quer atuar?"
        vazioSegue
      />
    );
  }

  if (!preSessao) {
    return <PortaoAutonomo onCpfConferido={setPreSessao} />;
  }

  // ⚠️ `publico-shell` (exceção do `html{min-width:1024px}` do globals.css) + `height: 100dvh`
  // (altura definida que o `h-full` interno do wizard precisa). Ver
  // [[reference_html_minwidth_quebra_mobile]].
  return (
    <div className="publico-shell" style={{ background: C.page, height: "100dvh" }}>
      <CadastroFlow
        publico={{
          extrasDoEnvio: { empreendimentosDeInteresse: interesse },
          header: "x-autonomo-pre-sessao",
          salvarUrl: "/api/publico/autonomo/cadastro",
          semChecagemCpf: true,
          sessao: preSessao,
        }}
        tipo="corretor"
      />
    </div>
  );
}

// O PORTÃO: um passo só, o CPF. Diz o que ter em mãos antes de começar, porque quem abre o link no
// celular precisa saber que vai fotografar dois documentos.
function PortaoAutonomo({ onCpfConferido }: { onCpfConferido: (preSessao: string) => void }) {
  const [cpf, setCpf] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  // "Já é autônomo" e "em análise" não são erro: são o fim do caminho para este CPF.
  const [fim, setFim] = useState<null | string>(null);

  const conferir = async () => {
    setCarregando(true);
    setErro("");
    try {
      const resposta = await fetch("/api/publico/autonomo/iniciar", {
        body: JSON.stringify({ cpf }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const dados = (await resposta.json().catch(() => ({}))) as {
        error?: string;
        mensagem?: string;
        preSessao?: string;
        status?: string;
      };
      if (!resposta.ok) throw new Error(dados.error || "Não conseguimos concluir agora.");
      if (dados.status === "ok" && dados.preSessao) {
        onCpfConferido(dados.preSessao);
        return;
      }
      if (dados.mensagem) {
        setFim(dados.mensagem);
        return;
      }
      throw new Error("Não conseguimos concluir agora.");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  if (fim) {
    return (
      <CascaPublica>
        <Cabecalho subtitulo={fim} titulo="Cadastro de corretor autônomo" />
      </CascaPublica>
    );
  }

  return (
    <CascaPublica
      rodape={
        <BotaoPrimario
          carregando={carregando}
          desabilitado={!cpfValido(cpf)}
          onClick={conferir}
          rotuloCarregando="Conferindo..."
        >
          Continuar
        </BotaoPrimario>
      }
    >
      <Cabecalho
        subtitulo="Comece pelo seu CPF. Tenha em mãos o seu documento de identificação (RG, CNH ou passaporte) e um comprovante de endereço dos últimos 3 meses: no próximo passo você fotografa os dois e a gente lê os dados para você."
        titulo="Cadastro de corretor autônomo"
      />
      <CampoCpf aoMudar={setCpf} rotulo="Seu CPF" valor={cpf} />
      <Erro>{erro || avisoDoDocumento(cpf, "cpf")}</Erro>
    </CascaPublica>
  );
}
