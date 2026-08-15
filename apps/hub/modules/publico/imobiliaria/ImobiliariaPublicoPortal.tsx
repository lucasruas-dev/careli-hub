"use client";

import { useState } from "react";

import type { EmpreendimentoPublico } from "@/lib/publico/cad/regras";
import { CadastroFlow } from "@/modules/apolo/blocks/cadastro/cadastro-flow";
import { PortaoImobiliaria } from "@/modules/publico/imobiliaria/PortaoImobiliaria";
import { BotaoPrimario, Cabecalho, CampoCpf, CampoTexto } from "@/modules/publico/ui/campos";
import { LogoEmpreendimento } from "@/modules/publico/logo-empreendimento";
import { CascaPublica } from "@/modules/publico/ui/casca";
import { C, GOLD } from "@/modules/publico/ui/tokens";

// Orquestra o auto-cadastro PÚBLICO da imobiliária no MESMO fluxo do credenciamento interno
// (CredenciamentoFlow), como o Lucas pediu ("eu quero o mesmo fluxo"):
//
//   1) EMPREENDIMENTOS: "quais empreendimentos você quer trabalhar?" — escolhe os que estão na
//      ativa. É o PRIMEIRO passo (o Lucas: "começa escolhendo o empreendimento a qual ela quer
//      se habilitar").
//   2) CNPJ: a antessala confere o CNPJ e emite a pré-sessão (trava das torneiras pagas).
//   3) WIZARD: o CadastroFlow tipo="imobiliaria" completo, com os empreendimentos JÁ escolhidos
//      (empreendimentosIniciais) — o wizard não repete o seletor ("seleção herdada do portal").
export function ImobiliariaPublicoPortal({
  empreendimentos,
}: {
  // Vitrine de empreendimentos ATIVOS, mastigada no server component (com credencial de serviço).
  empreendimentos: EmpreendimentoPublico[];
}) {
  // `null` = ainda escolhendo. Preenchido = os empreendimentos que a imobiliária quer trabalhar.
  const [escolhidos, setEscolhidos] = useState<string[] | null>(null);
  const [preSessao, setPreSessao] = useState<string | null>(null);
  // Caminho da imobiliária JÁ CREDENCIADA: não passa pelo wizard, só habilita o empreendimento.
  const [habilitacao, setHabilitacao] = useState<
    null | { erro: null | string; nome: null | string; pronto: boolean; salvando: boolean }
  >(null);
  // Antes de habilitar, a imobiliária que JÁ tem cadastro informa quem vai trabalhar o
  // empreendimento (pedido do Lucas). Guarda o token até o passo dos corretores terminar.
  const [tokenHabilitacao, setTokenHabilitacao] = useState<null | {
    nome: null | string;
    token: string;
  }>(null);

  // 1) Escolha de empreendimento — o ponto de partida.
  if (escolhidos === null) {
    return (
      <EscolhaEmpreendimentos empreendimentos={empreendimentos} onConfirmar={setEscolhidos} />
    );
  }

  // 2) CNPJ.
  //
  // ⚠️ `tokenHabilitacao` PRECISA estar nesta guarda. Quem já é credenciada não passa por
  // `preSessao` nem por `habilitacao` — o portão só entrega o token —, então sem ele a tela
  // renderizava o portão de novo e o passo dos corretores logo abaixo era INALCANÇÁVEL. Era
  // exatamente o beco sem saída que este lote veio consertar, só que uma tela adiante.
  if (!preSessao && !habilitacao && !tokenHabilitacao) {
    return (
      <PortaoImobiliaria
        onCnpjConferido={setPreSessao}
        onJaCredenciada={(token, nome) => {
          // Já credenciada: vai para o passo dos CORRETORES e só então habilita. Antes o portal
          // parava numa tela sem saída dizendo "já credenciada".
          setTokenHabilitacao({ nome, token });
        }}
      />
    );
  }

  // 2.5) CORRETORES do empreendimento — só para quem já tem cadastro.
  if (tokenHabilitacao && !habilitacao) {
    return (
      <CorretoresDoEmpreendimento
        nome={tokenHabilitacao.nome}
        onConfirmar={(corretores) => {
          setHabilitacao({
            erro: null,
            nome: tokenHabilitacao.nome,
            pronto: false,
            salvando: true,
          });

          void (async () => {
            try {
              const resposta = await fetch("/api/publico/imobiliaria/credenciar", {
                body: JSON.stringify({ corretores, empreendimentos: escolhidos }),
                headers: {
                  "Content-Type": "application/json",
                  "x-cad-pre-sessao-imob": tokenHabilitacao.token,
                },
                method: "POST",
              });
              const dados = (await resposta.json().catch(() => ({}))) as { error?: string };

              if (!resposta.ok) {
                setHabilitacao({
                  erro: dados.error ?? "Não conseguimos concluir agora.",
                  nome: tokenHabilitacao.nome,
                  pronto: false,
                  salvando: false,
                });
                return;
              }

              setHabilitacao({
                erro: null,
                nome: tokenHabilitacao.nome,
                pronto: true,
                salvando: false,
              });
            } catch {
              setHabilitacao({
                erro: "Não conseguimos concluir agora.",
                nome: tokenHabilitacao.nome,
                pronto: false,
                salvando: false,
              });
            }
          })();
        }}
      />
    );
  }

  if (habilitacao) {
    return (
      <CascaPublica>
        <Cabecalho
          subtitulo={
            habilitacao.salvando
              ? "Estamos liberando o acesso, um instante."
              : habilitacao.erro
                ? habilitacao.erro
                : "Pronto! Seus corretores já podem enviar CADs nos empreendimentos escolhidos. Enviamos a confirmação no WhatsApp do responsável."
          }
          titulo={
            habilitacao.salvando
              ? "Habilitando…"
              : habilitacao.erro
                ? "Não foi possível concluir"
                : `${habilitacao.nome ?? "Imobiliária"} habilitada`
          }
        />
      </CascaPublica>
    );
  }

  // 3) Wizard completo, com os empreendimentos herdados do passo 1.
  // ⚠️ `publico-shell` (exceção do min-width no globals.css) + `height: 100dvh` (altura definida
  // que o `h-full` interno do wizard precisa). O token vai no header `x-cad-pre-sessao-imob`.
  return (
    <div className="publico-shell" style={{ background: C.page, height: "100dvh" }}>
      <CadastroFlow
        empreendimentosIniciais={escolhidos}
        publico={{
          empreendimentos: empreendimentos.map((emp) => ({ id: emp.id, label: emp.name })),
          header: "x-cad-pre-sessao-imob",
          salvarUrl: "/api/publico/imobiliaria/cadastro",
          // Aqui preSessao já existe: os dois returns acima cobrem null (portão) e habilitação.
          sessao: preSessao ?? "",
        }}
        tipo="imobiliaria"
      />
    </div>
  );
}

// Vitrine MULTI-SELECT dos empreendimentos ativos. Espelha a etapa 1 do CredenciamentoFlow
// ("Quais empreendimentos você quer trabalhar? Selecione um ou mais"), com o visual público.
function EscolhaEmpreendimentos({
  empreendimentos,
  onConfirmar,
}: {
  empreendimentos: EmpreendimentoPublico[];
  onConfirmar: (ids: string[]) => void;
}) {
  const [selecionados, setSelecionados] = useState<string[]>([]);

  const alternar = (id: string) =>
    setSelecionados((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    );

  return (
    <CascaPublica
      rodape={
        <BotaoPrimario desabilitado={selecionados.length === 0} onClick={() => onConfirmar(selecionados)}>
          Continuar
        </BotaoPrimario>
      }
    >
      <Cabecalho
        subtitulo="Selecione um ou mais. Depois você informa o CNPJ e completa o cadastro."
        titulo="Quais empreendimentos você quer trabalhar?"
      />
      {empreendimentos.length === 0 ? (
        <p style={{ color: C.sub, fontSize: 14 }}>
          Nenhum empreendimento aberto para credenciamento no momento. Fale com a nossa central.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {empreendimentos.map((emp) => {
            const ativo = selecionados.includes(emp.id);
            return (
              <button
                key={emp.id}
                onClick={() => alternar(emp.id)}
                style={{
                  alignItems: "center",
                  background: C.card,
                  // Borda dourada e mais grossa quando escolhido: o estado tem que ser óbvio no sol.
                  border: ativo ? `2px solid ${GOLD}` : `1px solid ${C.border}`,
                  borderRadius: 14,
                  cursor: "pointer",
                  display: "flex",
                  gap: 12,
                  minHeight: 64,
                  padding: 12,
                  textAlign: "left",
                  width: "100%",
                }}
                type="button"
              >
                <LogoEmpreendimento
                  code={emp.code}
                  logoUrl={emp.logoUrl}
                  name={emp.name}
                />
                <span style={{ color: C.text, flex: 1, fontSize: 16, fontWeight: 600 }}>
                  {emp.name}
                </span>
                {/* Marca de seleção. */}
                <span
                  aria-hidden
                  style={{
                    alignItems: "center",
                    background: ativo ? GOLD : "transparent",
                    border: ativo ? `1px solid ${GOLD}` : `1px solid ${C.border}`,
                    borderRadius: 999,
                    color: "#fff",
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
              </button>
            );
          })}
        </div>
      )}
    </CascaPublica>
  );
}

// CORRETORES DO EMPREENDIMENTO — passo exclusivo de quem JÁ tem cadastro.
//
// Pedido do Lucas (15/08): *"temos que dar opção para as imobiliárias que já têm cadastro
// informar os corretores daquele empreendimento"*. A imobiliária nova informa os corretores
// dentro do wizard; a que já é credenciada pulava o wizard inteiro e, sem esta tela, entraria no
// empreendimento sem dizer QUEM vai vender.
//
// Nome e CPF bastam: é o mesmo mínimo do cadastro de corretor no wizard. Pode seguir sem nenhum
// (a imobiliária às vezes ainda está montando a equipe), e o servidor barra o corretor que já
// trabalha aquele empreendimento por outra imobiliária.
function CorretoresDoEmpreendimento({
  nome,
  onConfirmar,
}: {
  nome: null | string;
  onConfirmar: (corretores: { cpf: string; nome: string }[]) => void;
}) {
  const [linhas, setLinhas] = useState<{ cpf: string; nome: string }[]>([
    { cpf: "", nome: "" },
  ]);

  const preenchidos = linhas.filter((linha) => linha.nome.trim());

  return (
    <CascaPublica
      rodape={
        <BotaoPrimario onClick={() => onConfirmar(preenchidos)}>
          {preenchidos.length === 0 ? "Seguir sem corretores" : "Concluir habilitação"}
        </BotaoPrimario>
      }
    >
      <Cabecalho
        subtitulo={`Quem vai trabalhar este empreendimento pela ${nome ?? "sua imobiliária"}? Você pode incluir depois, pela nossa central.`}
        titulo="Corretores"
      />

      <div style={{ display: "grid", gap: 12 }}>
        {linhas.map((linha, indice) => (
          <div key={indice} style={{ display: "grid", gap: 8 }}>
            <CampoTexto
              aoMudar={(valor) =>
                setLinhas((atual) =>
                  atual.map((item, i) => (i === indice ? { ...item, nome: valor } : item)),
                )
              }
              rotulo={`Corretor ${indice + 1}`}
              valor={linha.nome}
            />
            <CampoCpf
              aoMudar={(valor) =>
                setLinhas((atual) =>
                  atual.map((item, i) => (i === indice ? { ...item, cpf: valor } : item)),
                )
              }
              rotulo="CPF"
              valor={linha.cpf}
            />
          </div>
        ))}
      </div>

      <button
        onClick={() => setLinhas((atual) => [...atual, { cpf: "", nome: "" }])}
        style={{
          background: "transparent",
          border: "none",
          color: GOLD,
          cursor: "pointer",
          fontSize: 14,
          fontWeight: 600,
          marginTop: 12,
          padding: 0,
        }}
        type="button"
      >
        + Adicionar outro corretor
      </button>
    </CascaPublica>
  );
}
