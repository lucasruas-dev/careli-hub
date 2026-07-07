// Medidor de memoria por fase — instrumentacao da caca aos OOMs de 7/jul
// ("instance was killed because it ran out of available memory" derrubando o
// /api/chronos/meetings). Cada chamada imprime UMA linha estruturada; no
// proximo estouro, o ultimo [panteon:mem] de cada request diz quem segurava
// os gigabytes. Buscar nos logs da Vercel por "panteon:mem".
export function logMemory(tag: string, extra?: Record<string, unknown>) {
  try {
    const usage = process.memoryUsage();

    console.info("[panteon:mem]", {
      tag,
      rssMB: Math.round(usage.rss / 1024 / 1024),
      heapMB: Math.round(usage.heapUsed / 1024 / 1024),
      externalMB: Math.round(usage.external / 1024 / 1024),
      arrayBuffersMB: Math.round((usage.arrayBuffers ?? 0) / 1024 / 1024),
      ...extra,
    });
  } catch {
    // Nunca derrubar o caller por causa de telemetria.
  }
}
