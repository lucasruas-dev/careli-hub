"use client";

import dynamicImport from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { buscarEnderecoPorCep } from "@/modules/apolo/lib/cep";
import {
  cnpjValido,
  cpfValido,
  emailValido,
  nomeCompletoValido,
  progresso,
  proximoEstado,
  telefoneCompleto,
  type EmpreendimentoPublico,
  type EstadoCad,
} from "@/lib/publico/cad/regras";
import {
  Ajuda,
  BotaoPrimario,
  BotaoSecundario,
  Cabecalho,
  CampoCep,
  CampoCnpj,
  CampoCpf,
  CampoEmail,
  CampoTelefone,
  CampoTexto,
  Erro,
  Progresso,
} from "@/modules/publico/ui/campos";
import { CascaPublica } from "@/modules/publico/ui/casca";
import { C, GOLD } from "@/modules/publico/ui/tokens";

// Formulário PÚBLICO de CAD do corretor. Link enviável por WhatsApp, sem login.
//
// O FLUXO (palavras do Lucas): o corretor chega e se identifica pelo CPF. Se já é cadastrado,
// segue direto. Se não é, a própria tela oferece o cadastro: CNPJ da imobiliária (se passar,
// ela é credenciada), dados dele, CRECI buscado na MOST com queda para digitação. Depois
// aparecem SÓ os empreendimentos que a imobiliária dele está habilitada a trabalhar: mais de
// um, ele escolhe; só um, pula direto para o formulário.
//
// ⚠️ NADA AQUI AUTORIZA NADA. A tela não decide quem entra: ela desenha o que o servidor
// respondeu. O vínculo da CAD (corretor + imobiliária + empreendimento) nasce do token
// assinado, no servidor, e o que este componente mandar no corpo é descartado.
//
// A CACÁ entra sob demanda (dynamic import): quem não abre o chat não baixa o chat. O corretor
// está em 4G.
const AssistenteCaca = dynamicImport(
  () => import("@/modules/publico/caca/AssistenteCaca").then((m) => m.AssistenteCaca),
  { ssr: false },
);

type PassoCad = "cliente" | "documento" | "endereco" | "revisao";

type Ficha = {
  endereco: {
    bairro: string;
    cep: string;
    cidade: string;
    complemento: string;
    logradouro: string;
    numero: string;
    uf: string;
  };
  identidade: {
    cpf: string;
    dataNascimento: string;
    nomeMae: string;
    nome: string;
    orgaoEmissor: string;
    rg: string;
  };
  perfil: { email: string; telefone: string };
};

const FICHA_VAZIA: Ficha = {
  endereco: { bairro: "", cep: "", cidade: "", complemento: "", logradouro: "", numero: "", uf: "" },
  identidade: { cpf: "", dataNascimento: "", nome: "", nomeMae: "", orgaoEmissor: "", rg: "" },
  perfil: { email: "", telefone: "" },
};

type Anexo = { categoria: string; fileBase64: string; fileName: string; mimeType: string };

const CHAVE_SESSAO = "cad-publico-sessao";

export function CadPublicoFlow({ whatsappCentral }: { whatsappCentral: string }) {
  const [estado, setEstado] = useState<EstadoCad>("identificar");
  const [passoCad, setPassoCad] = useState<PassoCad>("documento");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [chatAberto, setChatAberto] = useState(false);

  // Sessão em sessionStorage (não cookie): morre ao fechar a aba, o que importa num celular
  // emprestado, e não viaja sozinha (sem CSRF).
  const [sessao, setSessao] = useState("");
  const [preSessao, setPreSessao] = useState("");

  const [cpf, setCpf] = useState("");
  const [cnpj, setCnpj] = useState("");
  const [corretor, setCorretor] = useState({ creci: "", email: "", nome: "", telefone: "" });
  const [buscandoCreci, setBuscandoCreci] = useState(false);
  const [creciLido, setCreciLido] = useState(false);
  // true = o nome veio da MOST e o campo fica travado; false = a busca não achou e ele digita.
  const [nomeLido, setNomeLido] = useState(false);
  const cpfCreciBuscado = useRef("");

  const [imobiliaria, setImobiliaria] = useState("");
  const [empreendimentos, setEmpreendimentos] = useState<EmpreendimentoPublico[]>([]);
  const [empreendimento, setEmpreendimento] = useState<EmpreendimentoPublico | null>(null);

  const [ficha, setFicha] = useState<Ficha>(FICHA_VAZIA);
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [lendoDocumento, setLendoDocumento] = useState(false);
  const [protocolo, setProtocolo] = useState("");
  const [cadBase64, setCadBase64] = useState("");
  const [motivoCentral, setMotivoCentral] = useState("");

  useEffect(() => {
    const salva = window.sessionStorage.getItem(CHAVE_SESSAO);
    if (salva) setSessao(salva);
  }, []);

  useEffect(() => {
    if (sessao) window.sessionStorage.setItem(CHAVE_SESSAO, sessao);
  }, [sessao]);

  const avancar = useCallback(
    (evento: Parameters<typeof proximoEstado>[1]) => {
      setErro("");
      setEstado((atual) => proximoEstado(atual, evento));
    },
    [],
  );

  // Cliente HTTP das rotas públicas. Toda chamada leva a sessão no HEADER, nunca em query
  // string: o token identifica uma pessoa e query string entra em log e Referer.
  const chamar = useCallback(
    async <T,>(
      caminho: string,
      opcoes: { corpo?: unknown; metodo?: "GET" | "POST"; pre?: string; token?: string } = {},
    ): Promise<T> => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (opcoes.token) headers["x-cad-sessao"] = opcoes.token;
      if (opcoes.pre) headers["x-cad-pre-sessao"] = opcoes.pre;

      const resposta = await fetch(`/api/publico/cad/${caminho}`, {
        body: opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined,
        headers,
        method: opcoes.metodo ?? "POST",
      });
      const dados = (await resposta.json().catch(() => ({}))) as T & { error?: string };
      if (!resposta.ok) throw new Error(dados?.error || "Não conseguimos concluir agora.");
      return dados;
    },
    [],
  );

  // Depois de identificar/cadastrar: decide entre escolher o empreendimento e pular a etapa.
  const seguirComSessao = useCallback(
    (dados: { empreendimentos?: EmpreendimentoPublico[]; imobiliaria?: string; sessao?: string }, novo: boolean) => {
      const lista = dados.empreendimentos ?? [];
      setSessao(dados.sessao ?? "");
      setImobiliaria(dados.imobiliaria ?? "");
      setEmpreendimentos(lista);
      // Regra do Lucas: "se tiver somente uma seguir para o formulário".
      if (lista.length === 1) {
        setEmpreendimento(lista[0] ?? null);
        setPassoCad("documento");
      }
      avancar(
        novo
          ? { empreendimentos: lista.length, tipo: "cadastrado" }
          : { empreendimentos: lista.length, tipo: "cpf-conhecido" },
      );
    },
    [avancar],
  );

  // ---------------- S0 identificar ----------------
  const identificar = async () => {
    setCarregando(true);
    setErro("");
    try {
      const dados = await chamar<{
        empreendimentos?: EmpreendimentoPublico[];
        imobiliaria?: string;
        nome?: string;
        sessao?: string;
        status: string;
      }>("sessao", { corpo: { cpf } });

      if (dados.status === "novo") {
        avancar({ tipo: "cpf-novo" });
      } else if (dados.status === "conhecido") {
        seguirComSessao(dados, false);
      } else if (dados.status === "sem-empreendimento") {
        setMotivoCentral("sem-empreendimento");
        avancar({ tipo: "sem-empreendimento" });
      } else {
        setMotivoCentral("credenciamento");
        avancar({ tipo: "sem-empreendimento" });
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  // ---------------- S1 CNPJ ----------------
  const conferirCnpj = async () => {
    setCarregando(true);
    setErro("");
    try {
      const dados = await chamar<{ credenciada: boolean; nome?: string; preSessao?: string }>(
        "imobiliaria",
        { corpo: { cnpj } },
      );
      if (!dados.credenciada || !dados.preSessao) {
        setMotivoCentral("credenciamento");
        avancar({ tipo: "cnpj-recusado" });
        return;
      }
      setPreSessao(dados.preSessao);
      setImobiliaria(dados.nome ?? "");
      avancar({ tipo: "cnpj-ok" });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  // ---------------- S3 CRECI ----------------
  // Uma consulta por CPF, e SÓ depois do CNPJ ter passado: o CNPJ credenciado é a autorização
  // que paga a consulta (~R$ 1,60). O useRef é a mesma trava do wizard interno.
  useEffect(() => {
    // Dispara em "dados", NÃO em "creci": o nome precisa chegar a tempo de aparecer preenchido
    // na tela "Seus dados", que vem ANTES do passo do CRECI. Como bônus, quando o corretor
    // termina de digitar e-mail e telefone o CRECI já chegou, e o passo seguinte abre pronto,
    // sem espera. É uma chamada só, servindo os dois passos.
    if (estado !== "dados" || !preSessao) return;
    if (cpfCreciBuscado.current === cpf) return;
    cpfCreciBuscado.current = cpf;

    let vivo = true;
    setBuscandoCreci(true);
    chamar<{ creci: string; nome: string }>("creci", { corpo: { cpf }, pre: preSessao })
      .then((dados) => {
        if (!vivo) return;
        if (dados.nome) {
          setCorretor((atual) => ({ ...atual, nome: dados.nome }));
          // Trava o campo: nome da base não se digita por cima.
          setNomeLido(true);
        }
        if (dados.creci) {
          setCorretor((atual) => ({ ...atual, creci: dados.creci }));
          setCreciLido(true);
        }
      })
      // "Não encontrado" não é erro: o campo só fica editável e o corretor digita o dele.
      .catch(() => undefined)
      .finally(() => {
        if (vivo) setBuscandoCreci(false);
      });

    return () => {
      vivo = false;
    };
  }, [chamar, cpf, estado, preSessao]);

  // ---------------- S4 confirmar ----------------
  const cadastrar = async () => {
    setCarregando(true);
    setErro("");
    try {
      const dados = await chamar<{
        empreendimentos?: EmpreendimentoPublico[];
        imobiliaria?: string;
        sessao?: string;
        status: string;
      }>("corretor", {
        corpo: { cpf, creci: corretor.creci, email: corretor.email, nome: corretor.nome, telefone: corretor.telefone },
        pre: preSessao,
      });

      if (dados.status === "sem-empreendimento") {
        setMotivoCentral("sem-empreendimento");
        avancar({ tipo: "sem-empreendimento" });
        return;
      }
      seguirComSessao(dados, true);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  // ---------------- S5 empreendimento ----------------
  const escolherEmpreendimento = async (emp: EmpreendimentoPublico) => {
    setCarregando(true);
    setErro("");
    try {
      const dados = await chamar<{ sessao: string }>("empreendimentos", {
        corpo: { enterpriseId: emp.id },
        token: sessao,
      });
      setSessao(dados.sessao);
      setEmpreendimento(emp);
      setPassoCad("documento");
      avancar({ tipo: "empreendimento-escolhido" });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setCarregando(false);
    }
  };

  // ---------------- S6 documento + OCR ----------------
  const lerDocumento = async (arquivo: File) => {
    setLendoDocumento(true);
    setErro("");
    try {
      const base64 = await arquivoParaBase64(arquivo);
      setAnexos((atual) => [
        ...atual.filter((a) => a.categoria !== "identificacao"),
        { categoria: "identificacao", fileBase64: base64, fileName: arquivo.name, mimeType: arquivo.type },
      ]);

      const dados = await chamar<{
        cadastro: Record<string, string> | null;
        erroLeitura?: string;
      }>("ocr", { corpo: { fileBase64: base64, fileName: arquivo.name }, token: sessao });

      if (dados.cadastro) {
        const c = dados.cadastro;
        setFicha((atual) => ({
          endereco: {
            ...atual.endereco,
            bairro: c.bairro || atual.endereco.bairro,
            cep: c.cep || atual.endereco.cep,
            cidade: c.cidade || atual.endereco.cidade,
            logradouro: c.logradouro || atual.endereco.logradouro,
            numero: c.numero || atual.endereco.numero,
            uf: c.uf || atual.endereco.uf,
          },
          identidade: {
            cpf: c.cpf || atual.identidade.cpf,
            dataNascimento: c.dataNascimento || atual.identidade.dataNascimento,
            nome: c.nome || atual.identidade.nome,
            nomeMae: c.nomeMae || atual.identidade.nomeMae,
            orgaoEmissor: c.orgaoEmissor || atual.identidade.orgaoEmissor,
            rg: c.rg || atual.identidade.rg,
          },
          perfil: atual.perfil,
        }));
      } else if (dados.erroLeitura) {
        setErro(dados.erroLeitura);
      }
      setPassoCad("cliente");
    } catch (e) {
      // Falha de leitura não bloqueia: o corretor preenche na mão.
      setErro(`${(e as Error).message} Você pode preencher os dados na mão.`);
      setPassoCad("cliente");
    } finally {
      setLendoDocumento(false);
    }
  };

  // ---------------- S10 enviar ----------------
  const enviar = async () => {
    avancar({ tipo: "cad-pronta" });
    setErro("");
    try {
      const dados = await chamar<{ cadBase64: string; protocolo: string }>("enviar", {
        corpo: { documentos: anexos, ficha },
        token: sessao,
      });
      setProtocolo(dados.protocolo);
      setCadBase64(dados.cadBase64 ?? "");
      avancar({ tipo: "enviada" });
    } catch (e) {
      setErro((e as Error).message);
      setEstado("cad");
      setPassoCad("revisao");
    }
  };

  const outraCad = () => {
    setFicha(FICHA_VAZIA);
    setAnexos([]);
    setProtocolo("");
    setCadBase64("");
    setErro("");
    setPassoCad("documento");
    // Mesma sessão: o corretor não redigita o CPF.
    setEstado(empreendimentos.length === 1 ? "cad" : "empreendimento");
  };

  const passos = useMemo(() => progresso(estado), [estado]);

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  const topo =
    estado === "central" || estado === "sucesso" ? null : (
      <Progresso passo={passos.passo} total={passos.total} />
    );

  const conteudo = () => {
    switch (estado) {
      case "identificar":
        return (
          <>
            <Cabecalho
              subtitulo="Informe o seu CPF para enviar uma CAD. Se ainda não tiver cadastro, a gente faz agora."
              titulo="Vamos começar"
            />
            {/* Trocar o CPF invalida o que foi lido do CPF anterior: sem isto o campo de nome
                continuaria travado exibindo o nome de outra pessoa. */}
            <CampoCpf
              aoMudar={(v) => {
                setCpf(v);
                setNomeLido(false);
                setCreciLido(false);
              }}
              rotulo="Seu CPF"
              valor={cpf}
            />
            <Erro>{erro}</Erro>
          </>
        );

      case "cnpj":
        return (
          <>
            <Cabecalho
              subtitulo="Ainda não temos o seu cadastro por aqui. Vamos fazer agora, leva menos de um minuto: comece informando o CNPJ da sua imobiliária."
              titulo="Cadastro do corretor"
            />
            <CampoCnpj aoMudar={setCnpj} rotulo="CNPJ da imobiliária" valor={cnpj} />
            <Erro>{erro}</Erro>
          </>
        );

      case "dados":
        return (
          <>
            <Cabecalho subtitulo={`Continuar como parceiro da ${imobiliaria}.`} titulo="Seus dados" />
            <div style={{ display: "grid", gap: 16 }}>
              {/* Nome que veio da MOST é DADO DA BASE, não campo de digitação: fica travado.
                  Só abre para digitar quando a busca falha ou não encontra (Lucas, 20/jul:
                  "o nome não pode ser editado, só se a busca da most falhar"). */}
              <CampoTexto
                aoMudar={(v) => setCorretor((a) => ({ ...a, nome: v }))}
                autoComplete="name"
                ajuda={nomeLido ? "Nome encontrado pelo seu CPF." : undefined}
                maiusculaInicial
                placeholder="Nome e sobrenome"
                rotulo="Nome completo"
                somenteLeitura={nomeLido}
                valor={corretor.nome}
              />
              <CampoEmail
                aoMudar={(v) => setCorretor((a) => ({ ...a, email: v }))}
                rotulo="E-mail"
                valor={corretor.email}
              />
              <CampoTelefone
                aoMudar={(v) => setCorretor((a) => ({ ...a, telefone: v }))}
                rotulo="Telefone"
                valor={corretor.telefone}
              />
            </div>
            <Erro>{erro}</Erro>
          </>
        );

      case "creci":
        return (
          <>
            <Cabecalho
              subtitulo={
                buscandoCreci
                  ? "Estamos buscando o seu CRECI pelo CPF."
                  : "Confirme o seu CRECI. Se preferir, pode deixar em branco e informar depois."
              }
              titulo="CRECI"
            />
            <CampoTexto
              ajuda={
                creciLido ? "Buscamos pelo seu CPF. Toque em Corrigir se estiver diferente." : undefined
              }
              aoMudar={(v) => setCorretor((a) => ({ ...a, creci: v }))}
              desabilitado={buscandoCreci}
              rotulo="CRECI"
              somenteLeitura={creciLido}
              placeholder={buscandoCreci ? "Buscando..." : "Ex.: MG 12345"}
              valor={corretor.creci}
            />
            {creciLido ? (
              <div style={{ marginTop: 12 }}>
                <BotaoSecundario onClick={() => setCreciLido(false)}>Corrigir</BotaoSecundario>
              </div>
            ) : null}
            <Erro>{erro}</Erro>
          </>
        );

      case "confirmar":
        return (
          <>
            <Cabecalho subtitulo="Confira antes de concluir." titulo="Tudo certo?" />
            <Revisao
              linhas={[
                { rotulo: "CPF", valor: cpf },
                { rotulo: "Nome", valor: corretor.nome },
                { rotulo: "E-mail", valor: corretor.email },
                { rotulo: "Telefone", valor: corretor.telefone },
                { rotulo: "CRECI", valor: corretor.creci || "Não informado" },
                { rotulo: "Imobiliária", valor: imobiliaria },
              ]}
            />
            <Erro>{erro}</Erro>
          </>
        );

      case "empreendimento":
        return (
          <>
            <Cabecalho
              subtitulo="Aparecem aqui os empreendimentos em que a sua imobiliária está habilitada a trabalhar."
              titulo="Em qual empreendimento você quer enviar esta CAD?"
            />
            <div style={{ display: "grid", gap: 12 }}>
              {empreendimentos.map((emp) => (
                <CardEmpreendimento
                  key={emp.id}
                  desabilitado={carregando}
                  empreendimento={emp}
                  onClick={() => escolherEmpreendimento(emp)}
                />
              ))}
            </div>
            <Erro>{erro}</Erro>
          </>
        );

      case "cad":
        return (
          <PassosCad
            anexos={anexos}
            erro={erro}
            ficha={ficha}
            lendo={lendoDocumento}
            onArquivo={lerDocumento}
            onFicha={setFicha}
            passo={passoCad}
            empreendimento={empreendimento?.name ?? ""}
          />
        );

      case "enviando":
        return (
          <div style={{ paddingTop: 40, textAlign: "center" }}>
            <Cabecalho
              subtitulo="Não feche esta tela. Pode levar alguns segundos no 4G."
              titulo="Enviando a sua CAD"
            />
            <div style={{ color: C.muted, fontSize: 14 }}>
              {anexos.length} {anexos.length === 1 ? "arquivo" : "arquivos"} em envio
            </div>
          </div>
        );

      case "sucesso":
        return (
          <div style={{ paddingTop: 16 }}>
            <Cabecalho
              subtitulo="Ela entrou na nossa validação. A central acompanha o andamento e avisa quando houver movimento."
              titulo="CAD enviada"
            />
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
              <div
                style={{
                  color: C.text,
                  fontSize: 20,
                  fontWeight: 700,
                  marginTop: 6,
                  // Selecionável: o corretor vai copiar e mandar para a central.
                  userSelect: "all",
                }}
              >
                {protocolo}
              </div>
            </div>
            <Erro>{erro}</Erro>
          </div>
        );

      case "central":
        return (
          <div style={{ paddingTop: 16 }}>
            <Cabecalho
              subtitulo={
                motivoCentral === "sem-empreendimento"
                  ? "Sua imobiliária ainda não está habilitada em nenhum empreendimento aberto para envio. Fale com a nossa central para solicitar a habilitação: assim que sair, você já consegue enviar."
                  : "Não localizamos esse CNPJ entre as imobiliárias credenciadas. Isso costuma ser rápido de resolver: fale com a nossa central e a gente verifica o credenciamento da sua imobiliária para você seguir com o envio."
              }
              titulo="Vamos resolver por aqui"
            />
          </div>
        );

      default:
        return null;
    }
  };

  const rodape = () => {
    switch (estado) {
      case "identificar":
        return (
          <BotaoPrimario
            carregando={carregando}
            desabilitado={!cpfValido(cpf)}
            onClick={identificar}
            rotuloCarregando="Consultando..."
          >
            Continuar
          </BotaoPrimario>
        );

      case "cnpj":
        return (
          <BotaoPrimario
            carregando={carregando}
            desabilitado={!cnpjValido(cnpj)}
            onClick={conferirCnpj}
            rotuloCarregando="Conferindo..."
          >
            Continuar
          </BotaoPrimario>
        );

      case "dados":
        return (
          <BotaoPrimario
            desabilitado={
              !nomeCompletoValido(corretor.nome) ||
              !emailValido(corretor.email) ||
              !telefoneCompleto(corretor.telefone)
            }
            onClick={() => avancar({ tipo: "dados-ok" })}
          >
            Continuar
          </BotaoPrimario>
        );

      case "creci":
        return (
          // O botão fica ativo mesmo durante a busca: o corretor impaciente segue.
          <BotaoPrimario onClick={() => avancar({ tipo: "creci-ok" })}>Continuar</BotaoPrimario>
        );

      case "confirmar":
        return (
          <BotaoPrimario carregando={carregando} onClick={cadastrar} rotuloCarregando="Cadastrando...">
            Concluir cadastro
          </BotaoPrimario>
        );

      case "cad":
        return (
          <RodapeCad
            anexos={anexos}
            carregando={lendoDocumento}
            ficha={ficha}
            onEnviar={enviar}
            onProximo={setPassoCad}
            passo={passoCad}
          />
        );

      case "sucesso":
        return (
          <div style={{ display: "grid", gap: 10 }}>
            {cadBase64 ? (
              <BotaoPrimario onClick={() => baixarCad(cadBase64, protocolo)}>
                Baixar a CAD
              </BotaoPrimario>
            ) : null}
            <BotaoSecundario onClick={outraCad}>Enviar outra CAD</BotaoSecundario>
          </div>
        );

      case "central":
        return (
          <a
            href={whatsappCentral}
            rel="noreferrer"
            style={{
              alignItems: "center",
              background: C.text,
              borderRadius: 12,
              color: "#FFFFFF",
              display: "flex",
              fontSize: 16,
              fontWeight: 600,
              justifyContent: "center",
              minHeight: 52,
              textDecoration: "none",
              width: "100%",
            }}
            target="_blank"
          >
            Falar com a central
          </a>
        );

      default:
        return null;
    }
  };

  return (
    <>
      <CascaPublica rodape={rodape()} topo={topo}>
        {conteudo()}
      </CascaPublica>

      {/* Botão flutuante da CACÁ. O chat só é baixado quando o corretor toca. */}
      {estado !== "enviando" ? (
        <button
          aria-label="Falar com a assistente"
          onClick={() => setChatAberto((a) => !a)}
          style={{
            // Preto, não dourado: o destaque do Panteon é o preto (Lucas, 20/jul).
            background: C.text,
            border: "none",
            borderRadius: "50%",
            bottom: "calc(84px + env(safe-area-inset-bottom))",
            boxShadow: "0 6px 20px rgba(0,0,0,.18)",
            color: "#FFFFFF",
            cursor: "pointer",
            fontSize: 22,
            height: 56,
            position: "fixed",
            right: 16,
            width: 56,
            zIndex: 20,
          }}
          type="button"
        >
          {chatAberto ? "×" : "?"}
        </button>
      ) : null}

      {chatAberto ? <AssistenteCaca onFechar={() => setChatAberto(false)} sessao={sessao} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Peças
// ---------------------------------------------------------------------------

function Revisao({ linhas }: { linhas: { rotulo: string; valor: string }[] }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14 }}>
      {linhas.map((linha, i) => (
        <div
          key={linha.rotulo}
          style={{
            borderTop: i === 0 ? "none" : `1px solid ${C.border}`,
            display: "flex",
            gap: 12,
            justifyContent: "space-between",
            minHeight: 48,
            padding: "12px 16px",
          }}
        >
          <span style={{ color: C.sub, fontSize: 14 }}>{linha.rotulo}</span>
          <span style={{ color: C.text, fontSize: 14, fontWeight: 600, textAlign: "right" }}>
            {linha.valor || "-"}
          </span>
        </div>
      ))}
    </div>
  );
}

// Um card POR LINHA. Grade de 2 colunas em 375px deixa a foto ilegível e o alvo pequeno.
function CardEmpreendimento({
  desabilitado,
  empreendimento,
  onClick,
}: {
  desabilitado: boolean;
  empreendimento: EmpreendimentoPublico;
  onClick: () => void;
}) {
  return (
    <button
      disabled={desabilitado}
      onClick={onClick}
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        cursor: desabilitado ? "default" : "pointer",
        display: "block",
        overflow: "hidden",
        padding: 0,
        textAlign: "left",
        width: "100%",
      }}
      type="button"
    >
      <div
        style={{
          alignItems: "center",
          background: C.soft,
          display: "flex",
          height: 108,
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {empreendimento.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt=""
            src={empreendimento.logoUrl}
            style={{ height: "100%", objectFit: "cover", width: "100%" }}
          />
        ) : (
          <span style={{ color: GOLD, fontSize: 28, fontWeight: 700 }}>
            {empreendimento.code || empreendimento.name.slice(0, 3).toUpperCase()}
          </span>
        )}
      </div>
      <div style={{ padding: "14px 16px" }}>
        <div style={{ color: C.text, fontSize: 16, fontWeight: 600 }}>{empreendimento.name}</div>
      </div>
    </button>
  );
}

function PassosCad({
  anexos,
  empreendimento,
  erro,
  ficha,
  lendo,
  onArquivo,
  onFicha,
  passo,
}: {
  anexos: Anexo[];
  empreendimento: string;
  erro: string;
  ficha: Ficha;
  lendo: boolean;
  onArquivo: (arquivo: File) => void;
  onFicha: (ficha: Ficha) => void;
  passo: PassoCad;
}) {
  const [buscandoCep, setBuscandoCep] = useState(false);

  // CEP completo busca o endereço e revela o resto já preenchido.
  const aoCep = async (valor: string) => {
    onFicha({ ...ficha, endereco: { ...ficha.endereco, cep: valor } });
    if (valor.replace(/\D/g, "").length !== 8) return;
    setBuscandoCep(true);
    const encontrado = await buscarEnderecoPorCep(valor);
    setBuscandoCep(false);
    if (!encontrado) return;
    onFicha({
      ...ficha,
      endereco: {
        ...ficha.endereco,
        bairro: encontrado.bairro,
        cep: valor,
        cidade: encontrado.cidade,
        logradouro: encontrado.logradouro,
        uf: encontrado.uf,
      },
    });
  };

  if (passo === "documento") {
    const anexo = anexos.find((a) => a.categoria === "identificacao");
    return (
      <>
        <Cabecalho
          subtitulo={`CAD para ${empreendimento}. Comece pelo documento do cliente: a gente lê os dados da foto para você não digitar tudo.`}
          titulo="Documento do cliente"
        />
        {anexo ? (
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              padding: 16,
            }}
          >
            <div style={{ color: C.ok, fontSize: 15, fontWeight: 600 }}>Foto recebida</div>
            <Ajuda>{anexo.fileName}</Ajuda>
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 12, marginTop: anexo ? 14 : 0 }}>
          {/* `capture="environment"` abre a CÂMERA TRASEIRA direto: o corretor vai fotografar o
              documento na hora, ele não tem arquivo salvo. */}
          <BotaoArquivo
            accept="image/*"
            capture
            desabilitado={lendo}
            onArquivo={onArquivo}
            rotulo={anexo ? "Tirar outra foto" : "Tirar foto do documento"}
          />
          <BotaoArquivo
            accept="image/*,application/pdf"
            desabilitado={lendo}
            onArquivo={onArquivo}
            rotulo="Escolher arquivo"
            secundario
          />
        </div>
        {lendo ? <Ajuda>Lendo o documento, aguarde.</Ajuda> : null}
        <Erro>{erro}</Erro>
      </>
    );
  }

  if (passo === "cliente") {
    return (
      <>
        <Cabecalho subtitulo="Confira o que lemos e complete o que faltar." titulo="Dados do cliente" />
        <div style={{ display: "grid", gap: 16 }}>
          <CampoTexto
            aoMudar={(v) => onFicha({ ...ficha, identidade: { ...ficha.identidade, nome: v } })}
            maiusculaInicial
            rotulo="Nome completo"
            valor={ficha.identidade.nome}
          />
          <CampoCpf
            aoMudar={(v) => onFicha({ ...ficha, identidade: { ...ficha.identidade, cpf: v } })}
            rotulo="CPF"
            valor={ficha.identidade.cpf}
          />
          <CampoTexto
            aoMudar={(v) =>
              onFicha({ ...ficha, identidade: { ...ficha.identidade, dataNascimento: v } })
            }
            inputMode="numeric"
            placeholder="dd/mm/aaaa"
            rotulo="Data de nascimento"
            valor={ficha.identidade.dataNascimento}
          />
          <CampoTexto
            aoMudar={(v) => onFicha({ ...ficha, identidade: { ...ficha.identidade, rg: v } })}
            rotulo="RG"
            valor={ficha.identidade.rg}
          />
          <CampoTexto
            aoMudar={(v) => onFicha({ ...ficha, identidade: { ...ficha.identidade, nomeMae: v } })}
            maiusculaInicial
            rotulo="Nome da mãe"
            valor={ficha.identidade.nomeMae}
          />
          <CampoEmail
            aoMudar={(v) => onFicha({ ...ficha, perfil: { ...ficha.perfil, email: v } })}
            rotulo="E-mail do cliente"
            valor={ficha.perfil.email}
          />
          <CampoTelefone
            aoMudar={(v) => onFicha({ ...ficha, perfil: { ...ficha.perfil, telefone: v } })}
            rotulo="Telefone do cliente"
            valor={ficha.perfil.telefone}
          />
        </div>
        <Erro>{erro}</Erro>
      </>
    );
  }

  if (passo === "endereco") {
    const revelado = ficha.endereco.cep.replace(/\D/g, "").length === 8;
    return (
      <>
        <Cabecalho subtitulo="Comece pelo CEP: o resto vem sozinho." titulo="Endereço do cliente" />
        <div style={{ display: "grid", gap: 16 }}>
          <CampoCep
            ajuda={buscandoCep ? "Buscando o endereço..." : undefined}
            aoMudar={aoCep}
            rotulo="CEP"
            valor={ficha.endereco.cep}
          />
          {revelado ? (
            <>
              <CampoTexto
                aoMudar={(v) => onFicha({ ...ficha, endereco: { ...ficha.endereco, logradouro: v } })}
                rotulo="Logradouro"
                valor={ficha.endereco.logradouro}
              />
              <CampoTexto
                aoMudar={(v) => onFicha({ ...ficha, endereco: { ...ficha.endereco, numero: v } })}
                inputMode="numeric"
                rotulo="Número"
                valor={ficha.endereco.numero}
              />
              <CampoTexto
                aoMudar={(v) =>
                  onFicha({ ...ficha, endereco: { ...ficha.endereco, complemento: v } })
                }
                rotulo="Complemento"
                valor={ficha.endereco.complemento}
              />
              <CampoTexto
                aoMudar={(v) => onFicha({ ...ficha, endereco: { ...ficha.endereco, bairro: v } })}
                rotulo="Bairro"
                valor={ficha.endereco.bairro}
              />
              <CampoTexto
                aoMudar={(v) => onFicha({ ...ficha, endereco: { ...ficha.endereco, cidade: v } })}
                rotulo="Cidade"
                valor={ficha.endereco.cidade}
              />
              <CampoTexto
                aoMudar={(v) => onFicha({ ...ficha, endereco: { ...ficha.endereco, uf: v } })}
                rotulo="UF"
                valor={ficha.endereco.uf}
              />
            </>
          ) : null}
        </div>
        <Erro>{erro}</Erro>
      </>
    );
  }

  return (
    <>
      <Cabecalho subtitulo="Confira antes de enviar." titulo="Revisão" />
      <Revisao
        linhas={[
          { rotulo: "Empreendimento", valor: empreendimento },
          { rotulo: "Nome", valor: ficha.identidade.nome },
          { rotulo: "CPF", valor: ficha.identidade.cpf },
          { rotulo: "Nascimento", valor: ficha.identidade.dataNascimento },
          { rotulo: "E-mail", valor: ficha.perfil.email },
          { rotulo: "Telefone", valor: ficha.perfil.telefone },
          {
            rotulo: "Endereço",
            valor: [ficha.endereco.logradouro, ficha.endereco.numero, ficha.endereco.cidade]
              .filter(Boolean)
              .join(", "),
          },
          { rotulo: "Documentos", valor: `${anexos.length}` },
        ]}
      />
      <Erro>{erro}</Erro>
    </>
  );
}

function RodapeCad({
  anexos,
  carregando,
  ficha,
  onEnviar,
  onProximo,
  passo,
}: {
  anexos: Anexo[];
  carregando: boolean;
  ficha: Ficha;
  onEnviar: () => void;
  onProximo: (passo: PassoCad) => void;
  passo: PassoCad;
}) {
  if (passo === "documento") {
    return (
      <BotaoPrimario
        carregando={carregando}
        desabilitado={!anexos.length}
        onClick={() => onProximo("cliente")}
        rotuloCarregando="Lendo o documento..."
      >
        Continuar
      </BotaoPrimario>
    );
  }
  if (passo === "cliente") {
    return (
      <BotaoPrimario
        desabilitado={
          !nomeCompletoValido(ficha.identidade.nome) || !cpfValido(ficha.identidade.cpf)
        }
        onClick={() => onProximo("endereco")}
      >
        Continuar
      </BotaoPrimario>
    );
  }
  if (passo === "endereco") {
    return <BotaoPrimario onClick={() => onProximo("revisao")}>Continuar</BotaoPrimario>;
  }
  return <BotaoPrimario onClick={onEnviar}>Enviar a CAD</BotaoPrimario>;
}

function BotaoArquivo({
  accept,
  capture,
  desabilitado,
  onArquivo,
  rotulo,
  secundario,
}: {
  accept: string;
  capture?: boolean;
  desabilitado?: boolean;
  onArquivo: (arquivo: File) => void;
  rotulo: string;
  secundario?: boolean;
}) {
  return (
    <label
      style={{
        alignItems: "center",
        background: secundario ? "transparent" : C.text,
        border: secundario ? `1px solid ${C.border}` : "none",
        borderRadius: 12,
        color: secundario ? C.sub : "#FFFFFF",
        cursor: desabilitado ? "default" : "pointer",
        display: "flex",
        fontSize: 16,
        fontWeight: 600,
        justifyContent: "center",
        minHeight: 52,
        opacity: desabilitado ? 0.6 : 1,
        width: "100%",
      }}
    >
      {rotulo}
      <input
        accept={accept}
        // `capture="environment"` = câmera traseira, direto. Sem isto o iOS abre a galeria.
        capture={capture ? "environment" : undefined}
        disabled={desabilitado}
        onChange={(event) => {
          const arquivo = event.target.files?.[0];
          if (arquivo) onArquivo(arquivo);
          event.target.value = "";
        }}
        style={{ display: "none" }}
        type="file"
      />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function arquivoParaBase64(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error("Não conseguimos ler o arquivo."));
    leitor.onload = () => {
      const resultado = String(leitor.result ?? "");
      resolve(resultado.slice(resultado.indexOf(",") + 1));
    };
    leitor.readAsDataURL(arquivo);
  });
}

function baixarCad(base64: string, protocolo: string): void {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.download = `${protocolo || "CAD"}.pdf`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}
