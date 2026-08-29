"""Gera o JSON de contornos do JDG no formato do telao: { "JDG0201": "M ... Z" }."""
import cv2, numpy as np, json, collections

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
spans = json.load(open(SP+r"\jdg-spans.json", encoding="utf-8"))
vor   = np.load(SP+r"\jdg-vor.npy")
geo   = json.load(open(SP+r"\jdg-telao-geo.json"))
inv   = json.load(open(SP+r"\jdg-inventario.json"))
lotes = [s for s in spans if s["size"]==30.0]

cx0, cy0 = geo["crop"][0], geo["crop"][1]
esc = geo["escala"]; ox, oy = geo["offset"]
# Do espaco do PDF (10000x5626) para o do fundo do telao (3840x2160).
def para_telao(p):
    return (round((p[0]-cx0)*esc + ox, 1), round((p[1]-cy0)*esc + oy, 1))

# ⚠️ O NOME TEM QUE SER O `name` DA UNIDADE NO C2X, senao o lote nunca pinta e ninguem percebe
# ate o telao estar projetado no salao. Padrao do JDG (Lucas, 29/08): JDG + quadra + lote, dois
# digitos cada - JDG0109 e a quadra 01, lote 09. Mesmo desenho do RVPA23 do Villa Paris.
nome_de = {}
for r in inv:
    if r["lote"].isdigit() and r["quadra"].isdigit():
        nome_de[(round(r["x"],1), round(r["y"],1))] = f"JDG{int(r['quadra']):02d}{int(r['lote']):02d}"

H, W = vor.shape
contornos, sem_nome, dup = {}, 0, collections.Counter()
for i, l in enumerate(lotes, start=2):
    nome = nome_de.get((round(l["x"],1), round(l["y"],1)))
    if not nome: sem_nome += 1; continue
    dup[nome] += 1
    cx, cy = int(l["x"]), int(l["y"])
    r = 700
    x0,y0 = max(0,cx-r), max(0,cy-r); x1,y1 = min(W,cx+r), min(H,cy+r)
    jan = (vor[y0:y1, x0:x1] == i).astype(np.uint8)
    if jan.sum() == 0: continue
    cs,_ = cv2.findContours(jan, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    c = max(cs, key=cv2.contourArea) + np.array([[[x0,y0]]])
    # Poucos vertices: o lote e figura de lados retos, e o contorno pixel a pixel so carrega
    # serrilhado. 0,8% do perimetro segura os cantos e joga fora o degrau de pixel.
    ap = cv2.approxPolyDP(c, 0.008*cv2.arcLength(c, True), True).reshape(-1,2)
    if len(ap) < 3: continue
    pts = [para_telao(p) for p in ap]
    d = "M " + " L ".join(f"{x},{y}" for x,y in pts) + " Z"
    contornos[nome] = d

print("contornos:", len(contornos), "| lotes sem nome:", sem_nome)
rep = {k:v for k,v in dup.items() if v>1}
print("nomes repetidos:", len(rep), list(rep.items())[:6])
json.dump(contornos, open(SP+r"\jdg-lotes.json","w"), separators=(",",":"))
print("salvo jdg-lotes.json")
