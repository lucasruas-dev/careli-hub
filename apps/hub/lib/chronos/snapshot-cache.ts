"use client";

import type { ChronosSnapshot } from "./types";

// Cache em memoria do snapshot do Chronos (pedido Lucas 7/jul: "toda hora que
// clico na aba do Chronos ele carrega do zero e demora"). A navegacao entre
// abas do hub desmonta o modulo — sem cache, cada clique refazia a carga
// completa com esqueleto de loading. Com o cache: a aba abre INSTANTANEA com o
// ultimo snapshot e atualiza em silencio por tras; se a ultima carga foi ha
// poucos segundos, nem vai a rede (custo). Escopo de modulo = sobrevive a
// navegacao client-side; some no F5 (ai a carga fresca e desejavel).

// Janela em que o snapshot e considerado fresco o bastante para PULAR o
// refetch ao remontar (ping-pong rapido entre abas nao gera rede).
const FRESH_WINDOW_MS = 45_000;

let cachedSnapshot: ChronosSnapshot | null = null;
let cachedAt = 0;

export function readChronosSnapshotCache(): ChronosSnapshot | null {
  return cachedSnapshot;
}

export function isChronosSnapshotCacheFresh(): boolean {
  return cachedSnapshot !== null && Date.now() - cachedAt < FRESH_WINDOW_MS;
}

export function writeChronosSnapshotCache(snapshot: ChronosSnapshot) {
  cachedSnapshot = snapshot;
  cachedAt = Date.now();
}

// Espelha o estado local (mutacoes, hidratacoes) SEM renovar o carimbo de
// frescor — a proxima montagem nasce com o estado mais novo, mas o refetch
// de fundo continua acontecendo quando o snapshot do servidor envelhece.
export function mirrorChronosSnapshotCache(snapshot: ChronosSnapshot) {
  cachedSnapshot = snapshot;
}
