// O SINAL DE GRAVACAO DO CHRONOS — lido pelo gravador externo, que escuta o console.
//
// ⚠️ ARQUIVO ESTATICO, E NAO SCRIPT INLINE NO LAYOUT. Ele morava num <script
// dangerouslySetInnerHTML> em app/layout.tsx, e o React 19 passou a acusar no console:
// "Encountered a script tag while rendering React component. Scripts inside React components are
// never executed when rendering on the client". Trocar por <Script> do next/script NAO resolveu:
// com conteudo inline, o proprio next/script renderiza a tag e o aviso continua. Com `src`, nao ha
// tag inline nenhuma para o React reclamar — e o navegador executa antes da hidratacao, que e o
// que este script precisa.
//
// ⚠️ NAO GUARDA SEGREDO NENHUM, de proposito: e' servido de public/, sem gate. O que ele faz e'
// console.log("START_RECORDING") / ("END_RECORDING") na rota /chronos/recording-view, para o
// gravador saber quando comecar e parar. Qualquer dado aqui dentro seria publico.

(() => {
  if (!window.location.pathname.startsWith("/chronos/recording-view")) {
    return;
  }

  if (window.__chronosRecordingStartSignalBooted) {
    return;
  }

  window.__chronosRecordingStartSignalBooted = true;

  const emitStartSignal = () => {
    window.__chronosRecordingStartLogged = true;
    console.log("START_RECORDING");
  };

  window.__chronosRecordingEmitStartSignal = emitStartSignal;

  const scheduleStartSignals = () => {
    [
      0,
      250,
      750,
      1500,
      3000,
      5000,
      8000,
      12000,
      20000,
      30000,
      45000,
      60000,
      90000,
      110000,
    ].forEach((delay) => {
      window.setTimeout(emitStartSignal, delay);
    });
  };

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", scheduleStartSignals, {
      once: true,
    });
  } else {
    scheduleStartSignals();
  }

  window.addEventListener("load", emitStartSignal, { once: true });
  window.addEventListener("pageshow", emitStartSignal, { once: true });

  window.addEventListener(
    "pagehide",
    () => {
      if (window.__chronosRecordingEndLogged) {
        return;
      }

      window.__chronosRecordingEndLogged = true;
      console.log("END_RECORDING");
    },
    { once: true },
  );
})();
