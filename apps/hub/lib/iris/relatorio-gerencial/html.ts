import { dataNaCasa, horaNaCasa, type JanelaDoRelatorio } from "./janela";
import type {
  HoraDoDia,
  LinhaDaFila,
  LinhaDePessoa,
  ResumoDoDia,
} from "./metricas";

// O E-MAIL — mesmo layout do relatório que o Lucas aprovou em 17/09/2026.
//
// ⚠️ ESTILO EM `style=` E TABELA NO LUGAR DE GRID: é e-mail, não página. Gmail e Outlook cortam
// `<style>` externo e ignoram flex e grid; o que sobrevive é tabela com atributo e cor em linha.
// O gabarito usa `<style>` no topo porque foi feito para abrir no navegador — aqui ele fica, mas
// cada bloco repete o essencial em `style=` para o caso de o cliente de e-mail jogar a folha fora.
//
// ⚠️ O QUE ESTE ARQUIVO NÃO FAZ: contar. Ele recebe os números prontos de `metricas.ts` e escreve.
// Um total somado aqui dentro seria um segundo lugar onde a conta existe.

const TINTA = "#14181C";
const FRACA = "#6C7680";
const LINHA = "#E9ECEF";
const BORDA = "#D8DCE1";
const AZUL = "#1B4F72";

export type ConteudoDoRelatorio = {
  backlog: {
    automatico: number;
    cliente: number;
    fornecedor: number;
    maisAntigoEmDias: number;
    total: number;
  };
  falhas: Array<{ codigo: string; quantidade: number; rotulo: string }>;
  janela: JanelaDoRelatorio;
  movimento: HoraDoDia[];
  pessoas: LinhaDePessoa[];
  porFila: LinhaDaFila[];
  resumo: ResumoDoDia;
  semResposta: Array<{ fila: string; quantidade: number }>;
};

function escapar(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function inteiro(valor: number): string {
  return valor.toLocaleString("pt-BR");
}

/** 6,3 min · 1h14 · 24 seg — a mesma escala do relatório aprovado. */
export function duracao(minutos: null | number): string {
  if (minutos === null) return "—";
  if (minutos < 1) return `${Math.round(minutos * 60)} seg`;
  if (minutos < 60) return `${minutos.toFixed(1).replace(".", ",")} min`;
  const horas = Math.floor(minutos / 60);
  const resto = Math.round(minutos % 60);
  return `${horas}h${String(resto).padStart(2, "0")}`;
}

function percentual(valor: null | number): string {
  return valor === null ? "—" : `${Math.round(valor)}%`;
}

/**
 * A frase de abertura, construída dos números — não é opinião, é leitura.
 *
 * ⚠️ SEM ADJETIVO QUE O NÚMERO NÃO SUSTENTA. "Dia recorde" exige a série; aqui só entra o que esta
 * apuração mediu.
 */
export function leituraDoDia(c: ConteudoDoRelatorio): string {
  const { resumo } = c;
  const saldo = resumo.fechados - resumo.abertos;
  const respondidos =
    resumo.recadosRecebidos > 0
      ? Math.round((resumo.recadosRespondidos / resumo.recadosRecebidos) * 1000) / 10
      : null;

  const partes = [
    `Entre 08h e 18h30 entraram ${inteiro(resumo.mensagensEntrada)} mensagens de clientes e saíram ${inteiro(resumo.mensagensSaida)}.`,
    `Foram ${inteiro(resumo.abertos)} atendimentos abertos e ${inteiro(resumo.fechados)} encerrados, ${
      saldo >= 0 ? `saldo de +${inteiro(saldo)}` : `saldo de ${inteiro(saldo)}`
    }.`,
  ];

  if (respondidos !== null) {
    partes.push(
      `Dos ${inteiro(resumo.recadosRecebidos)} recados recebidos, ${String(respondidos).replace(".", ",")}% foram respondidos, com mediana de ${duracao(resumo.medianaMinutos)}.`,
    );
  }

  if (c.backlog.cliente > 0) {
    partes.push(
      `Na fila de Atendimento, ${inteiro(c.backlog.cliente)} cliente(s) seguem sem resposta${
        c.backlog.maisAntigoEmDias > 0 ? `, o mais antigo há ${c.backlog.maisAntigoEmDias} dias` : ""
      }.`,
    );
  }

  return partes.join(" ");
}

function bloco(titulo: string, subtitulo: null | string, corpo: string): string {
  return `<div class="bloco" style="background:#FFFFFF;border:1px solid ${BORDA};border-radius:6px;padding:20px 22px;margin-bottom:16px">
  <h2 style="font-size:17px;margin:0 0 3px">${escapar(titulo)}</h2>
  ${subtitulo ? `<p class="sub" style="font-size:13px;color:${FRACA};margin:0 0 14px">${escapar(subtitulo)}</p>` : ""}
  ${corpo}
</div>`;
}

function tabela(cabecalhos: string[], linhas: string[][], alinharADireita: number[]): string {
  const th = cabecalhos
    .map(
      (c, i) =>
        `<th style="padding:8px 9px;text-align:${alinharADireita.includes(i) ? "right" : "left"};border-bottom:1px solid ${BORDA};font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:${FRACA}">${escapar(c)}</th>`,
    )
    .join("");

  const tr = linhas
    .map(
      (linha) =>
        `<tr>${linha
          .map(
            (celula, i) =>
              `<td style="padding:8px 9px;text-align:${alinharADireita.includes(i) ? "right" : "left"};border-bottom:1px solid ${LINHA};white-space:${alinharADireita.includes(i) ? "nowrap" : "normal"}">${celula}</td>`,
          )
          .join("")}</tr>`,
    )
    .join("");

  return `<table style="border-collapse:collapse;width:100%;font-size:13.5px;margin:4px 0"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

function tile(rotulo: string, valor: string, nota: string): string {
  return `<td style="border:1px solid ${BORDA};border-radius:5px;padding:11px 13px;vertical-align:top;width:25%">
  <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${FRACA}">${escapar(rotulo)}</div>
  <div style="font-size:24px;font-weight:700;line-height:1.2">${escapar(valor)}</div>
  <div style="font-size:12px;color:${FRACA}">${escapar(nota)}</div>
</td>`;
}

function itemDeAtencao(titulo: string, corpo: string, tom: "atencao" | "critico" | "neutro"): string {
  const cor = tom === "critico" ? "#9B2C20" : tom === "atencao" ? "#8A5A0B" : FRACA;
  const fundo = tom === "critico" ? "#F6E1DE" : tom === "atencao" ? "#F5E9D2" : "#F7F8F9";
  return `<div style="border-left:3px solid ${cor};padding:11px 13px;border-radius:0 4px 4px 0;margin-bottom:10px;background:${fundo}">
  <div style="font-weight:700;font-size:14px;margin-bottom:2px">${escapar(titulo)}</div>
  <p style="font-size:13.5px;color:#3A434B;margin:0">${corpo}</p>
</div>`;
}

export function montarHtml(c: ConteudoDoRelatorio): string {
  const { janela, resumo } = c;
  const saldo = resumo.fechados - resumo.abertos;

  const capa = `<div style="background:${AZUL};color:#fff;border-radius:6px;padding:20px 22px;margin-bottom:16px">
  <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.8;margin-bottom:8px">Relatório gerencial de atendimento</div>
  <h1 style="font-size:26px;margin:0 0 6px;line-height:1.15">${escapar(janela.rotuloDoDia)}</h1>
  <p style="margin:0;opacity:.92;font-size:14.5px">Filas de Atendimento, Cobrança e Central de Relacionamento, mais os atendimentos conduzidos pela CACÁ. Apuração das 08h00 às 18h30.</p>
</div>`;

  const numeros = bloco(
    "O dia em números",
    "Apuração do expediente, das 08h00 às 18h30.",
    `<table style="width:100%;border-collapse:separate;border-spacing:8px 0;margin:0 -8px"><tr>
  ${tile("Abertos", inteiro(resumo.abertos), "atendimentos")}
  ${tile("Encerrados", inteiro(resumo.fechados), `saldo de ${saldo >= 0 ? "+" : ""}${inteiro(saldo)}`)}
  ${tile("Mensagens", inteiro(resumo.mensagensEntrada + resumo.mensagensSaida), `${inteiro(resumo.mensagensEntrada)} entraram · ${inteiro(resumo.mensagensSaida)} saíram`)}
  ${tile("Resposta mediana", duracao(resumo.medianaMinutos), `${inteiro(resumo.recadosRespondidos)} de ${inteiro(resumo.recadosRecebidos)} respondidos`)}
</tr></table>
<p style="font-size:14px;margin:16px 0 0">${escapar(leituraDoDia(c))}</p>`,
  );

  const filas = bloco(
    "Desempenho por fila",
    "O tempo é medido da mensagem do cliente até a resposta da equipe, mensagem a mensagem.",
    tabela(
      ["Fila", "Abertos", "Encerrados", "Resposta mediana", "Pior caso", "Respostas em áudio"],
      c.porFila.map((l) => [
        `<strong>${escapar(l.fila)}</strong>`,
        inteiro(l.abertos),
        inteiro(l.fechados),
        duracao(l.medianaMinutos),
        duracao(l.piorCasoMinutos),
        percentual(l.audioPercentual),
      ]),
      [1, 2, 3, 4, 5],
    ) +
      `<p style="font-size:12.5px;color:${FRACA};margin:10px 0 0">A linha da CACÁ é um recorte do Atendimento, não uma fila à parte: os atendimentos dela também estão contados na linha de cima.</p>`,
  );

  const pessoas =
    c.pessoas.length === 0
      ? ""
      : bloco(
          "Quem atendeu",
          "Pela mensagem enviada, não pela atribuição do protocolo.",
          tabela(
            ["Pessoa", "Atendimentos", "Mensagens", "Jornada", "Frente principal"],
            c.pessoas.map((p) => [
              escapar(p.pessoa),
              inteiro(p.atendimentos),
              inteiro(p.mensagens),
              p.inicio && p.fim ? `${horaNaCasa(p.inicio)} às ${horaNaCasa(p.fim)}` : "—",
              escapar(p.frente),
            ]),
            [1, 2],
          ),
        );

  const atencoes: string[] = [];

  if (c.backlog.cliente > 0) {
    atencoes.push(
      itemDeAtencao(
        `${c.backlog.cliente} cliente(s) esperando resposta na fila de Atendimento`,
        `A fila mostra ${inteiro(c.backlog.total)} pendências, mas ${inteiro(c.backlog.fornecedor)} são de fornecedor e ${inteiro(c.backlog.automatico)} são aviso automático do próprio domínio. Cliente de verdade são <strong>${inteiro(c.backlog.cliente)}</strong>${c.backlog.maisAntigoEmDias > 0 ? `, e o mais antigo espera há ${c.backlog.maisAntigoEmDias} dias` : ""}.`,
        c.backlog.cliente > 10 ? "critico" : "atencao",
      ),
    );
  }

  const totalDeFalhas = c.falhas.reduce((soma, f) => soma + f.quantidade, 0);
  if (totalDeFalhas > 0) {
    atencoes.push(
      itemDeAtencao(
        `${totalDeFalhas} mensagem(ns) não chegaram ao cliente`,
        c.falhas
          .map((f) => `<strong>${inteiro(f.quantidade)}</strong> com o erro ${escapar(f.codigo)} (${escapar(f.rotulo)})`)
          .join("; ") + ".",
        totalDeFalhas > 10 ? "critico" : "atencao",
      ),
    );
  }

  const totalSemResposta = c.semResposta.reduce((soma, s) => soma + s.quantidade, 0);
  if (totalSemResposta > 0) {
    atencoes.push(
      itemDeAtencao(
        `${totalSemResposta} recado(s) terminaram o expediente sem resposta`,
        c.semResposta
          .map((s) => `${escapar(s.fila)}: ${inteiro(s.quantidade)}`)
          .join(" · ") +
          ". Parte é despedida (um “ok”, um “obrigado”), parte é pergunta em aberto que amanhece esperando.",
        "atencao",
      ),
    );
  }

  const atencao = atencoes.length > 0 ? bloco("Pontos de atenção", null, atencoes.join("\n")) : "";

  const maiorDoMovimento = Math.max(1, ...c.movimento.map((h) => Math.max(h.entraram, h.sairam)));
  const movimento =
    c.movimento.length === 0
      ? ""
      : bloco(
          "Movimento ao longo do dia",
          "Mensagens recebidas (azul escuro) e enviadas (azul claro), por hora.",
          `<table style="border-collapse:collapse;width:100%;font-size:13.5px">${c.movimento
            .map(
              (h) =>
                `<tr><td style="width:44px;padding:6px 9px;border-bottom:1px solid ${LINHA}">${String(h.hora).padStart(2, "0")}h</td>
    <td style="padding:6px 9px;border-bottom:1px solid ${LINHA}">
      <span style="background:${AZUL};height:9px;display:inline-block;border-radius:2px;vertical-align:middle;width:${Math.round((h.entraram / maiorDoMovimento) * 100)}px"></span> ${inteiro(h.entraram)}
      &nbsp; <span style="background:#9FB8C9;height:9px;display:inline-block;border-radius:2px;vertical-align:middle;width:${Math.round((h.sairam / maiorDoMovimento) * 100)}px"></span> ${inteiro(h.sairam)}
    </td></tr>`,
            )
            .join("")}</table>`,
        );

  const rodape = `<p style="font-size:12px;color:${FRACA};text-align:center;line-height:1.7;margin-top:18px">
  Relatório gerado pelo Panteon a partir da base de atendimento da Íris.<br>
  Apuração de ${escapar(dataNaCasa(janela.dia))}, das 08h00 às 18h30, horário de Brasília.
</p>`;

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Atendimento do dia · ${escapar(dataNaCasa(janela.dia))} · Careli</title></head>
<body style="background:#F2F3F5;color:${TINTA};margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:15px;line-height:1.55">
<div style="max-width:820px;margin:0 auto;padding:24px 16px 56px">
${capa}
${numeros}
${filas}
${pessoas}
${atencao}
${movimento}
${rodape}
</div>
</body></html>`;
}

/** A versão em texto puro, para quem bloqueia HTML — e para o registro da execução. */
export function montarTexto(c: ConteudoDoRelatorio): string {
  const linhas = [
    `Relatório gerencial de atendimento · ${c.janela.rotuloDoDia}`,
    `Apuração das 08h00 às 18h30.`,
    "",
    leituraDoDia(c),
    "",
    "Por fila:",
    ...c.porFila.map(
      (l) =>
        `  ${l.fila}: ${l.abertos} abertos, ${l.fechados} encerrados, resposta mediana ${duracao(l.medianaMinutos)}, pior caso ${duracao(l.piorCasoMinutos)}.`,
    ),
  ];

  if (c.backlog.cliente > 0) {
    linhas.push(
      "",
      `Fila de Atendimento: ${c.backlog.total} pendências, ${c.backlog.cliente} de cliente.`,
    );
  }

  linhas.push("", "Relatório gerado pelo Panteon a partir da base de atendimento da Íris.");
  return linhas.join("\n");
}

export function assuntoDoEmail(janela: JanelaDoRelatorio): string {
  return `Atendimento do dia · ${dataNaCasa(janela.dia)}`;
}
