"use client";

import { useState } from "react";

import { cnpjValido, emailValido, telefoneCompleto, type EmpreendimentoPublico } from "@/lib/publico/cad/regras";
import {
  Ajuda,
  BotaoPrimario,
  Cabecalho,
  CampoCnpj,
  CampoEmail,
  CampoTelefone,
  CampoTexto,
  Erro,
  Progresso,
} from "@/modules/publico/ui/campos";
import { CascaPublica } from "@/modules/publico/ui/casca";
import { C, GOLD } from "@/modules/publico/ui/tokens";

// Auto-cadastro PÚBLICO da imobiliária (o outro link).
//
// "A imobiliária se cadastra e escolhe os empreendimentos que quer trabalhar, restrito aos
// empreendimentos que o Lucas marcou como ATIVOS" (regra já existente no sistema).
//
// A lista de ativos chega PRONTA do server component: nada é buscado no browser antes do
// primeiro paint, o que importa em 4G.
type Passo = "empresa" | "empreendimentos" | "contato" | "enviado" | "ja-credenciada";

const ORDEM: Passo[] = ["empresa", "empreendimentos", "contato"];

export function ImobiliariaPublicoFlow({
  empreendimentos,
}: {
  empreendimentos: EmpreendimentoPublico[];
}) {
  const [passo, setPasso] = useState<Passo>("empresa");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [protocolo, setProtocolo] = useState("");

  const [empresa, setEmpresa] = useState({ cnpj: "", creci: "", nomeFantasia: "", razaoSocial: "" });
  const [contato, setContato] = useState({ email: "", responsavel: "", telefone: "" });
  const [escolhidos, setEscolhidos] = useState<string[]>([]);

  const alternar = (id: string) =>
    setEscolhidos((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    );

  const enviar = async () => {
    setCarregando(true);
    setErro("");
    try {
      const resposta = await fetch("/api/publico/imobiliaria/credenciar", {
        body: JSON.stringify({
          cnpj: empresa.cnpj,
          creci: empresa.creci,
          email: contato.email,
          empreendimentos: escolhidos,
          nomeFantasia: empresa.nomeFantasia,
          razaoSocial: empresa.razaoSocial,
          responsavel: contato.responsavel,
          telefone: contato.telefone,
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const dados = (await resposta.json().catch(() => ({}))) as {
        error?: string;
        protocolo?: string;
        status?: string;
      };
      if (!resposta.ok) throw new Error(dados.error || "Não conseguimos concluir agora.");

      if (dados.status === "ja-credenciada") {
        setPasso("ja-credenciada");
        return;
      }
      setProtocolo(dados.protocolo ?? "");
      setPasso("enviado");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  const indice = ORDEM.indexOf(passo);
  const topo =
    indice >= 0 ? <Progresso passo={indice + 1} total={ORDEM.length} /> : null;

  const conteudo = () => {
    if (passo === "empresa") {
      return (
        <>
          <Cabecalho
            subtitulo="Preencha os dados da imobiliária para solicitar o credenciamento."
            titulo="Cadastro da imobiliária"
          />
          <div style={{ display: "grid", gap: 16 }}>
            <CampoCnpj
              aoMudar={(v) => setEmpresa((a) => ({ ...a, cnpj: v }))}
              rotulo="CNPJ"
              valor={empresa.cnpj}
            />
            <CampoTexto
              aoMudar={(v) => setEmpresa((a) => ({ ...a, razaoSocial: v }))}
              maiusculaInicial
              rotulo="Razão social"
              valor={empresa.razaoSocial}
            />
            <CampoTexto
              aoMudar={(v) => setEmpresa((a) => ({ ...a, nomeFantasia: v }))}
              maiusculaInicial
              rotulo="Nome fantasia"
              valor={empresa.nomeFantasia}
            />
            <CampoTexto
              ajuda="Opcional."
              aoMudar={(v) => setEmpresa((a) => ({ ...a, creci: v }))}
              rotulo="CRECI jurídico"
              valor={empresa.creci}
            />
          </div>
          <Erro>{erro}</Erro>
        </>
      );
    }

    if (passo === "empreendimentos") {
      return (
        <>
          <Cabecalho
            subtitulo="Selecione onde a imobiliária quer atuar. Aparecem aqui apenas os empreendimentos abertos para credenciamento."
            titulo="Empreendimentos"
          />
          {empreendimentos.length ? (
            <div style={{ display: "grid", gap: 10 }}>
              {empreendimentos.map((emp) => {
                const ativo = escolhidos.includes(emp.id);
                return (
                  <button
                    key={emp.id}
                    onClick={() => alternar(emp.id)}
                    style={{
                      alignItems: "center",
                      background: ativo ? C.soft : C.card,
                      border: `1.5px solid ${ativo ? C.text : C.border}`,
                      borderRadius: 14,
                      cursor: "pointer",
                      display: "flex",
                      gap: 14,
                      minHeight: 64,
                      padding: "12px 16px",
                      textAlign: "left",
                      width: "100%",
                    }}
                    type="button"
                  >
                    <span
                      aria-hidden
                      style={{
                        alignItems: "center",
                        background: ativo ? C.text : "transparent",
                        border: `1.5px solid ${ativo ? C.text : C.border}`,
                        borderRadius: 6,
                        color: "#FFFFFF",
                        display: "flex",
                        flexShrink: 0,
                        fontSize: 14,
                        height: 24,
                        justifyContent: "center",
                        width: 24,
                      }}
                    >
                      {ativo ? "✓" : ""}
                    </span>
                    <span style={{ color: C.text, fontSize: 16, fontWeight: 600 }}>{emp.name}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <Ajuda>
              Nenhum empreendimento está aberto para credenciamento no momento. Você pode
              concluir o cadastro mesmo assim: a central avisa quando abrir.
            </Ajuda>
          )}
          <Erro>{erro}</Erro>
        </>
      );
    }

    if (passo === "contato") {
      return (
        <>
          <Cabecalho subtitulo="Com quem falamos sobre este credenciamento?" titulo="Contato" />
          <div style={{ display: "grid", gap: 16 }}>
            <CampoTexto
              aoMudar={(v) => setContato((a) => ({ ...a, responsavel: v }))}
              autoComplete="name"
              maiusculaInicial
              rotulo="Responsável"
              valor={contato.responsavel}
            />
            <CampoEmail
              aoMudar={(v) => setContato((a) => ({ ...a, email: v }))}
              rotulo="E-mail"
              valor={contato.email}
            />
            <CampoTelefone
              aoMudar={(v) => setContato((a) => ({ ...a, telefone: v }))}
              rotulo="Telefone"
              valor={contato.telefone}
            />
          </div>
          <Erro>{erro}</Erro>
        </>
      );
    }

    if (passo === "ja-credenciada") {
      return (
        <Cabecalho
          subtitulo="Esse CNPJ já está credenciado conosco. Seus corretores já podem enviar CADs pelo link do formulário. Em caso de dúvida, fale com a nossa central."
          titulo="Imobiliária já credenciada"
        />
      );
    }

    return (
      <>
        <Cabecalho
          subtitulo="Recebemos a sua solicitação. Nossa equipe analisa e a central entra em contato para concluir o credenciamento."
          titulo="Solicitação enviada"
        />
        {protocolo ? (
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              padding: 18,
              textAlign: "center",
            }}
          >
            <div style={{ color: C.muted, fontSize: 12, letterSpacing: 0.6 }}>PROTOCOLO</div>
            <div style={{ fontSize: 20, fontWeight: 700, marginTop: 6, userSelect: "all" }}>
              {protocolo}
            </div>
          </div>
        ) : null}
      </>
    );
  };

  const rodape = () => {
    if (passo === "empresa") {
      return (
        <BotaoPrimario
          desabilitado={!cnpjValido(empresa.cnpj) || empresa.razaoSocial.trim().length < 3}
          onClick={() => setPasso("empreendimentos")}
        >
          Continuar
        </BotaoPrimario>
      );
    }
    if (passo === "empreendimentos") {
      return <BotaoPrimario onClick={() => setPasso("contato")}>Continuar</BotaoPrimario>;
    }
    if (passo === "contato") {
      return (
        <BotaoPrimario
          carregando={carregando}
          desabilitado={!emailValido(contato.email) || !telefoneCompleto(contato.telefone)}
          onClick={enviar}
          rotuloCarregando="Enviando..."
        >
          Solicitar credenciamento
        </BotaoPrimario>
      );
    }
    return null;
  };

  return (
    <CascaPublica rodape={rodape()} topo={topo}>
      {conteudo()}
    </CascaPublica>
  );
}
