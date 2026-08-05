import type { PrometeuEvento } from "./types";

// Como o LANCAMENTO se apresenta nas telas do Prometeu.
//
// O evento nasceu com nome generico ("Lançamento") e ninguem, olhando a fila, sabia de qual
// empreendimento ela era. O vinculo existe (enterprise_id/enterprise_code + config.enterpriseNome,
// gravados pelo Setup), entao aqui so decidimos COMO mostrar, com um degrade honesto: nome por
// extenso -> sigla -> nome do evento. Nunca inventa "Vale do Ouro" quando o evento nao foi
// configurado; nesse caso a tela mostra o nome cru e o time percebe que falta configurar.

export function nomeDoLancamento(
  evento: Pick<PrometeuEvento, "config" | "enterpriseCode" | "nome"> | null | undefined,
): string {
  if (!evento) {
    return "";
  }

  const porExtenso = evento.config?.enterpriseNome?.trim();
  if (porExtenso) {
    return porExtenso;
  }

  const sigla = evento.enterpriseCode?.trim();
  if (sigla) {
    return sigla;
  }

  return evento.nome?.trim() ?? "";
}

// True quando o evento ainda nao foi amarrado a um empreendimento: a tela usa isso para pedir a
// configuracao em vez de exibir um rotulo que nao quer dizer nada.
export function lancamentoSemEmpreendimento(
  evento: Pick<PrometeuEvento, "config" | "enterpriseCode" | "enterpriseId"> | null | undefined,
): boolean {
  if (!evento) {
    return false;
  }

  return (
    !evento.enterpriseId?.trim() &&
    !evento.enterpriseCode?.trim() &&
    !evento.config?.enterpriseNome?.trim()
  );
}

// ARMADILHA DE FUSO: data_evento e' timestamptz e o Setup grava so o dia ("2026-08-01"), que o
// Postgres guarda como meia-noite UTC. Formatar isso via Date no fuso de Brasilia devolve o dia
// ANTERIOR (31/07) — o evento apareceria com a data errada em todas as telas. Por isso lemos os
// 10 primeiros caracteres como data pura, sem passar por Date.
export function dataDoLancamento(dataEvento: string | null | undefined): string {
  const iso = dataEvento?.trim();
  if (!iso) {
    return "";
  }

  const casado = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!casado) {
    return "";
  }

  const [, ano, mes, dia] = casado;
  return `${dia}/${mes}/${ano}`;
}

// Rotulo completo para cabecalho: "Vale do Ouro · 01/08/2026".
export function rotuloDoLancamento(
  evento:
    | Pick<PrometeuEvento, "config" | "dataEvento" | "enterpriseCode" | "nome">
    | null
    | undefined,
): string {
  const nome = nomeDoLancamento(evento);
  const data = dataDoLancamento(evento?.dataEvento);

  if (nome && data) {
    return `${nome} · ${data}`;
  }

  return nome || data;
}
