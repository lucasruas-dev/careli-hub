// Demo de voz da CACÁ (ElevenLabs, voz Geni) pra o Lucas OUVIR e AFINAR a naturalidade sem
// redeploy. Sem ?audio=1 -> serve uma PÁGINA com presets + sliders + botão Ouvir. Com
// ?audio=1 -> devolve o mp3 (usado pela página e por links diretos). Rota efêmera de
// validação, protegida por IRIS_TTS_DEMO_KEY. Ver [[project-caca-voice-tts]].
import type { NextRequest } from "next/server";

import {
  CACA_DEFAULT_TTS_MODEL,
  CACA_DEFAULT_VOICE_ID,
  CACA_NATURAL_VOICE_SETTINGS,
  synthesizeCacaSpeech,
} from "@/lib/iris/tts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEMO_PHRASE =
  "Oi! Aqui é a Cacá, da Careli. Recebi sua mensagem e já vou te ajudar com o seu boleto, tá bom? Um instante que eu confiro tudo pra você.";

// Lê um número da query com clamp; usa o fallback quando ausente/inválido.
function numParam(
  url: URL,
  name: string,
  fallback: number,
  lo: number,
  hi: number,
): number {
  const raw = url.searchParams.get(name);

  if (raw == null || raw.trim() === "") {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(hi, Math.max(lo, value));
}

function renderPage(demoKey: string): string {
  const keyJson = JSON.stringify(demoKey);
  const phraseJson = JSON.stringify(DEMO_PHRASE);

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Voz da CACÁ — teste</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, Segoe UI, Roboto, sans-serif; background: #f1f5f9; color: #0f172a; padding: 24px; }
  .card { max-width: 560px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; box-shadow: 0 8px 30px rgba(2,6,23,0.06); }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #64748b; margin: 0 0 16px; font-size: 14px; }
  textarea { width: 100%; min-height: 84px; padding: 12px; border: 1px solid #cbd5e1; border-radius: 10px; font-size: 15px; resize: vertical; }
  .presets { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }
  .presets button { flex: 1 1 auto; padding: 10px 12px; border: 1px solid #cbd5e1; background: #f8fafc; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer; }
  .presets button:hover { background: #eef2f7; }
  label { display: block; font-size: 13px; color: #334155; margin: 12px 0 4px; font-weight: 600; }
  label .val { color: #7c3aed; font-variant-numeric: tabular-nums; }
  label .hint { color: #94a3b8; font-weight: 400; }
  input[type=range] { width: 100%; }
  select { width: 100%; padding: 8px; border: 1px solid #cbd5e1; border-radius: 8px; font-size: 14px; }
  .play { width: 100%; margin-top: 18px; padding: 14px; border: 0; border-radius: 12px; background: #7c3aed; color: #fff; font-size: 16px; font-weight: 700; cursor: pointer; }
  .play:hover { background: #6d28d9; }
  .status { display: block; text-align: center; color: #64748b; font-size: 13px; margin-top: 10px; min-height: 18px; }
  audio { width: 100%; margin-top: 12px; }
</style>
</head>
<body>
<div class="card">
  <h1>🎙️ Voz da CACÁ (Geni)</h1>
  <p class="sub">Digite a frase, escolha um preset ou ajuste os controles, e clique em Ouvir.</p>
  <textarea id="txt"></textarea>
  <div class="presets">
    <button data-s="0.4" data-st="0.45" data-sp="1">Natural</button>
    <button data-s="0.3" data-st="0.55" data-sp="1">Expressiva</button>
    <button data-s="0.22" data-st="0.6" data-sp="1">Solta</button>
    <button data-s="0.35" data-st="0.45" data-sp="0.95">Calma</button>
  </div>
  <label>Stability <span class="val" id="sv"></span> <span class="hint">(&#8595; = mais humana)</span>
    <input type="range" id="stability" min="0" max="1" step="0.01" value="0.4" /></label>
  <label>Style <span class="val" id="stv"></span> <span class="hint">(&#8593; = mais emoção)</span>
    <input type="range" id="style" min="0" max="1" step="0.01" value="0.45" /></label>
  <label>Speed <span class="val" id="spv"></span> <span class="hint">(&lt;1 = mais devagar)</span>
    <input type="range" id="speed" min="0.7" max="1.2" step="0.01" value="1" /></label>
  <label>Modelo
    <select id="model">
      <option value="eleven_multilingual_v2">Multilingual v2 (padrão)</option>
      <option value="eleven_v3">v3 (experimental, mais expressivo)</option>
    </select></label>
  <button class="play" id="play">&#9654; Ouvir</button>
  <span class="status" id="status"></span>
  <audio id="player" controls></audio>
</div>
<script>
  var KEY = ${keyJson};
  var PHRASE = ${phraseJson};
  function $(id){ return document.getElementById(id); }
  $("txt").value = PHRASE;
  function sync(){
    $("sv").textContent = (+$("stability").value).toFixed(2);
    $("stv").textContent = (+$("style").value).toFixed(2);
    $("spv").textContent = (+$("speed").value).toFixed(2);
  }
  ["stability","style","speed"].forEach(function(id){ $(id).addEventListener("input", sync); });
  function play(){
    var status = $("status");
    status.textContent = "gerando áudio...";
    var p = new URLSearchParams({
      key: KEY, audio: "1", text: $("txt").value,
      stability: $("stability").value, style: $("style").value,
      speed: $("speed").value, model: $("model").value
    });
    fetch("/api/iris/tts/demo?" + p.toString()).then(function(r){
      if(!r.ok){ return r.text().then(function(t){ throw new Error(t); }); }
      return r.blob();
    }).then(function(b){
      var pl = $("player");
      pl.src = URL.createObjectURL(b);
      pl.play();
      status.textContent = "tocando · stability " + $("stability").value + " · style " + $("style").value + " · speed " + $("speed").value;
    }).catch(function(e){ status.textContent = "erro: " + e.message; });
  }
  Array.prototype.forEach.call(document.querySelectorAll(".presets button"), function(b){
    b.addEventListener("click", function(){
      $("stability").value = b.dataset.s; $("style").value = b.dataset.st; $("speed").value = b.dataset.sp;
      sync(); play();
    });
  });
  $("play").addEventListener("click", play);
  sync();
</script>
</body>
</html>`;
}

export async function GET(request: NextRequest) {
  const demoKey = process.env.IRIS_TTS_DEMO_KEY?.trim();
  const url = new URL(request.url);
  const providedKey = url.searchParams.get("key")?.trim() ?? "";

  if (!demoKey || providedKey !== demoKey) {
    return new Response("Nao autorizado.", { status: 401 });
  }

  // Sem ?audio=1 -> página de teste (botões + sliders).
  if (url.searchParams.get("audio") !== "1") {
    return new Response(renderPage(providedKey), {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  }

  const text = (url.searchParams.get("text")?.trim() || DEMO_PHRASE).slice(0, 800);
  const voiceId = url.searchParams.get("voice")?.trim() || CACA_DEFAULT_VOICE_ID;
  const modelId = url.searchParams.get("model")?.trim() || CACA_DEFAULT_TTS_MODEL;

  const voiceSettings = {
    stability: numParam(url, "stability", CACA_NATURAL_VOICE_SETTINGS.stability, 0, 1),
    similarity_boost: numParam(
      url,
      "similarity",
      CACA_NATURAL_VOICE_SETTINGS.similarity_boost,
      0,
      1,
    ),
    style: numParam(url, "style", CACA_NATURAL_VOICE_SETTINGS.style, 0, 1),
    use_speaker_boost: (url.searchParams.get("boost") ?? "1").trim() !== "0",
    speed: numParam(url, "speed", 1, 0.7, 1.2),
  };

  try {
    const { audio, contentType } = await synthesizeCacaSpeech({
      text,
      voiceId,
      modelId,
      voiceSettings,
      outputFormat: "mp3_44100_128",
    });

    return new Response(audio, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-disposition": 'inline; filename="caca-voz.mp3"',
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no TTS.";

    return new Response(`Erro: ${message}`, { status: 502 });
  }
}
