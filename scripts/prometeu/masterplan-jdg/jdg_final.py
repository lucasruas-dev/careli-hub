"""Masterplan JDG - geometria final.

Sementes: os 267 circulos pretos LIDOS da arte (numero por cluster de digitos, quadra pelo
marcador vermelho), mais dois cravados a mao e uma reatribuicao - documentados abaixo. O corte
e o watershed global validado nas rodadas anteriores (elevacao continua: linha branca + escuro;
borda de ilha = muralha absoluta; circulo do numero furado).
"""
import cv2, numpy as np, json, collections

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
img = cv2.imdecode(np.fromfile(r"C:\Users\lucas\Downloads\GBR_JARDIM_V02-Recuperado-Recuperado.png", np.uint8), cv2.IMREAD_COLOR)
lab = np.load(SP+r"\jdg-lab.npy")
d = json.load(open(SP+r"\jdg-digitos.json")); circ = d["circulos"]
nm = json.load(open(SP+r"\jdg-nomes.json")); numeros, atrib = nm["numeros"], nm["atrib"]
carga = json.load(open(SP+r"\jdg-c2x.json"))
H, W = img.shape[:2]

# SEMENTES NOMEADAS ---------------------------------------------------------
sementes = []
for k, num in numeros.items():
    q = atrib[str(k)]
    cx, cy = circ[int(k)][0], circ[int(k)][1]
    nome = f"JDG{q}{num.zfill(2)}"
    sementes.append({"nome": nome, "x": cx, "y": cy})

# ⚠️ TRES CORRECOES CRAVADAS A OLHO na ponta direita da quadra 09 (conferidas em recorte
# full-res com regua, 29/08):
#   - os circulos 19 e 20 da q09 nao passaram nos criterios de deteccao (encostam na moldura
#     da mata) - posicoes cravadas;
#   - o 18 da fila de cima e da q09, mas o marcador vermelho mais proximo dele e o da q10, e a
#     reatribuicao automatica o mandou para la (duplicando o 18 da q10).
for s in sementes:
    if s["nome"] == "JDG1018" and abs(s["x"] - 4595) < 60 and abs(s["y"] - 2275) < 60:
        s["nome"] = "JDG0918"
sementes.append({"nome": "JDG0920", "x": 4650, "y": 2150})
sementes.append({"nome": "JDG0919", "x": 4665, "y": 2295})

vistos = collections.Counter(s["nome"] for s in sementes)
dups = {n: c for n, c in vistos.items() if c > 1}
print("sementes:", len(sementes), "| nomes duplicados:", dups)

# ELEVACAO (pipeline v3, validado) ------------------------------------------
B,G,R = img[:,:,0].astype(np.int16), img[:,:,1].astype(np.int16), img[:,:,2].astype(np.int16)
mx = np.maximum(np.maximum(B,G),R)
cinza = ((R+G+B)//3).astype(np.uint8)
th = cv2.morphologyEx(cinza, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(17,17)))
# corte do escuro em 120 (era 150): com 150, a vegetacao rasteira do gramado virava muralha
# DENTRO do lote e prendia a agua ao redor do furo do numero - celulas minusculas em 4520,
# 3008, 0906. Copa de arvore de verdade fica abaixo de 120.
escuro = np.clip(120 - mx, 0, 120).astype(np.float32) * (255.0/120.0)
elev = np.clip(np.maximum(th.astype(np.float32)*4.0, escuro), 0, 255).astype(np.uint8)
preto_puro = ((mx < 80) & ~((G > R + 8) & (G > B + 8))).astype(np.uint8)
ncp, lcp, stats, _ = cv2.connectedComponentsWithStats(preto_puro, connectivity=8)
furo = np.zeros((H,W), np.uint8)
for i in range(1, ncp):
    a = stats[i, cv2.CC_STAT_AREA]
    w_, h_ = stats[i, cv2.CC_STAT_WIDTH], stats[i, cv2.CC_STAT_HEIGHT]
    if 500 < a < 9000 and w_ < 110 and h_ < 110 and a > 0.5 * (3.14159/4) * w_ * h_:
        furo[lcp == i] = 1
furo = cv2.dilate(furo, cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(5,5)))
elev[furo > 0] = 0
# ⚠️ O CIRCULO VERMELHO DE QUADRA E MURALHA. Ele nao e escuro nem linha, entao tinha elevacao
# de grama - e quando o designer o pos EM CIMA de uma divisa, virava ponte entre dois lotes
# (JDG4209 engoliu o vizinho por baixo do "42"). Sobre um lote ele vira buraco interno, que o
# RETR_EXTERNAL ignora no poligono final.
vermelho = ((R > 150) & (G < 90) & (B < 90))
elev[vermelho] = 255
# ⚠️ AS MURALHAS EXTERNAS VEM DA ARTE NOVA, NAO DA ILHA ANTIGA. A mascara de quadras da arte
# velha cortava os lotes que a arte nova ESTENDEU sobre o que era area verde (o JDG3501 saia
# espremido na beirada da ilha antiga). Muralha externa real: RUA (claro dessaturado LARGO -
# erosao tira as linhas finas de divisa) e MATA (escuro ja esta na elevacao). O resto do
# confinamento fica por conta das fantasmas.
# ⚠️ A ILHA ANTIGA (sem folga) e a melhor muralha externa que este material permite. Foram
# testadas: (a) muralhas so da arte nova (rua+linha) - as linhas nao seguram o mundo, 96 lotes
# estouraram; (b) ilha dilatada 40px + rua - a folga derrama os lotes da beirada na area verde
# (0704 com 14x a area). A ilha crua corta uns poucos lotes ESTENDIDOS na arte nova (3501),
# que sao tratados no ajuste final por area da carga.
elev[lab == 0] = 255

marc = np.zeros((H,W), np.int32)
marc[lab == 0] = 1
# ⚠️ SEMENTES FANTASMA nas areas abertas. As ilhas (do verde da arte antiga) incluem sobras sem
# divisa - area institucional, canteiro, fundo de quadra - e sem competidor ali a agua de um
# lote real as engolia inteiras (JDG0402 saiu com 204k px2). Uma grade de sementes de FUNDO,
# so onde nao ha circulo de lote num raio de 170px, ocupa essas areas e depois e descartada.
# 170px e seguro: o maior lote da carga (2.246m2 ~ 21.5k px2) poe qualquer ponto interno a
# menos de ~105px do proprio numero.
sx = np.array([s_["x"] for s_ in sementes]); sy = np.array([s_["y"] for s_ in sementes])
for gy in range(80, H, 160):
        for gx in range(80, W, 160):
            if lab[gy, gx] == 0: continue
            if ((sx-gx)**2 + (sy-gy)**2).min() < 150**2: continue
            cv2.circle(elev, (gx,gy), 8, 0, -1)
            cv2.circle(marc, (gx,gy), 6, 1, -1)   # rotulo 1 = fundo: descartado junto
for n, s in enumerate(sementes, start=2):
    x, y = int(s["x"]), int(s["y"])
    cv2.circle(elev, (x,y), 8, 0, -1)
    cv2.circle(marc, (x,y), 6, n, -1)
cv2.watershed(cv2.cvtColor(elev, cv2.COLOR_GRAY2BGR), marc)
print("watershed ok")

def poligono(m, off):
    cs,_ = cv2.findContours(m.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cs: return None
    c = max(cs, key=cv2.contourArea)
    ap = cv2.approxPolyDP(c, 0.006*cv2.arcLength(c, True), True).reshape(-1,2) + off
    return ap if len(ap) >= 3 else None

resultado, area_px = {}, {}
for n, s in enumerate(sementes, start=2):
    x, y = int(s["x"]), int(s["y"])
    rr = 700
    for _ in range(3):
        x0,y0 = max(0,x-rr), max(0,y-rr); x1,y1 = min(W,x+rr), min(H,y+rr)
        m = (marc[y0:y1, x0:x1] == n)
        if not m.any(): break
        if not (m[0,:].any() or m[-1,:].any() or m[:,0].any() or m[:,-1].any()) or rr >= 2800: break
        rr *= 2
    if not m.any(): continue
    p = poligono(m, np.array([x0,y0]))
    if p is None: continue
    resultado[s["nome"]] = p
    area_px[s["nome"]] = cv2.contourArea(p.reshape(-1,1,2).astype(np.int32))
print("poligonos:", len(resultado))

# QA 1: cobertura da carga - tem que ser 250/250
nomes_carga = {r_["name"] for r_ in carga}
falta = nomes_carga - set(resultado)
print(f"QA carga: {len(nomes_carga & set(resultado))}/{len(nomes_carga)} | faltam: {sorted(falta)}")

# QA 2: area do poligono vs m2 DA CARGA (a fonte que vale)
area_carga = {r_["name"]: float(r_["area"]) for r_ in carga if r_["area"]}
pares = [(area_px[n], area_carga[n]) for n in resultado if n in area_carga and area_carga[n] > 0]
a = np.array(pares, float)
corr = np.corrcoef(a[:,0], a[:,1])[0,1]
escala = np.median(a[:,0]/a[:,1])
desvio = np.abs(a[:,0]/escala - a[:,1]) / a[:,1]
print(f"QA area: {len(pares)} lotes | correlacao = {corr:.4f} | escala = {escala:.2f} px2/m2")
for lim in (0.1, 0.2, 0.35):
    print(f"    desvio > {int(lim*100)}%: {int((desvio>lim).sum())}")
nomes_sel = [n for n in resultado if n in area_carga and area_carga[n] > 0]
piores = sorted(zip(desvio, nomes_sel), reverse=True)[:8]
for dv, n in piores:
    print(f"    {n}: {dv*100:.0f}% ({area_px[n]:.0f}px2 ~ {area_px[n]/escala:.0f}m2 vs {area_carga[n]:.0f}m2)")
np.save(SP+r"\jdg-marc.npy", marc)
json.dump(sementes, open(SP+r"\jdg-sementes-final.json","w"))
json.dump({k: v.tolist() for k,v in resultado.items()}, open(SP+r"\jdg-poly-final.json","w"))
print("salvo jdg-poly-final.json")
