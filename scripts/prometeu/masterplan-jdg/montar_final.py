"""Monta o masterplan final: quadras desenhadas pelo exercito (out-qXX.json, espaco-mestre) +
lotes editados pelo Lucas (4K, intocados) -> JSON do telao com furos + QA + SVG de conferencia."""
import cv2, numpy as np, json, os, re, base64, collections

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
QD = os.path.join(SP, "quadras")
E, OX, OY = 0.4240, -107.0, -316.4
carga = json.load(open(SP+r"\jdg-c2x.json"))
nomes_carga = {r["name"] for r in carga}
area_carga = {r["name"]: float(r["area"] or 0) for r in carga}
ed4k = json.load(open(SP+r"\jdg-editados-lucas.json"))         # 4K, do Lucas
d = json.load(open(SP+r"\jdg-digitos.json")); circ = d["circulos"]
nm = json.load(open(SP+r"\jdg-nomes.json")); numeros, atrib = nm["numeros"], nm["atrib"]; qmarks = nm["qmarks"]

# furos: centros dos circulos em 4K
furo_de = {}
for k, num in numeros.items():
    nome = f"JDG{atrib[str(k)]}{num.zfill(2)}"
    cx, cy = circ[int(k)][0], circ[int(k)][1]
    if nome == "JDG1018" and abs(cx-4595) < 60 and abs(cy-2275) < 60: nome = "JDG0918"
    furo_de[nome] = (cx*E+OX, cy*E+OY)
furo_de["JDG0920"] = (4650*E+OX, 2150*E+OY)
furo_de["JDG0919"] = (4665*E+OX, 2295*E+OY)

poly4k = {}
# 1. do Lucas (ja em 4K) — prioridade absoluta
for n, p in ed4k.items():
    poly4k[n] = np.array(p, np.float64)
# 2. do exercito (mestre -> 4K)
faltando_out = []
for f in sorted(os.listdir(QD)):
    m = re.match(r"out-q(\d\d)\.json$", f)
    if not m: continue
    out = json.load(open(os.path.join(QD, f)))
    for lote in out.get("lotes", []):
        n = lote["nome"]
        if n in poly4k: continue                    # o do Lucas manda
        a = np.array(lote["pontos"], np.float64)
        poly4k[n] = a * E + [OX, OY]
# 3. FALLBACK: quadras que o exercito nao alcancou (limite de sessao) ficam com a geometria
# anterior (v2), que ja estava no ar. Melhor um mapa completo com parte antiga do que buraco no
# telao — as que faltam serao substituidas na proxima rodada.
import re as _re
v2 = json.load(open(SP+r"\jdg-v2-repo.json"))
def contorno_do_path(dp):
    s2 = [x for x in dp.split("M ") if x.strip() and " A " not in x][0]
    return np.array([[float(a) for a in par.split(",")] for par in _re.findall(r"[-\d.]+,[-\d.]+", s2)], np.float64)
herdados = []
for n, dp in v2.items():
    if n not in poly4k:
        poly4k[n] = contorno_do_path(dp)
        herdados.append(n)
qs_herdadas = sorted({n[3:5] for n in herdados})
print(f"herdados da v2: {len(herdados)} lotes | quadras: {qs_herdadas}")

tem = nomes_carga & set(poly4k)
falta = sorted(nomes_carga - set(poly4k))
print(f"carga coberta: {len(tem)}/{len(nomes_carga)} | faltam: {falta[:12]}{'...' if len(falta)>12 else ''}")

# QA area
pares = [(cv2.contourArea(poly4k[n].astype(np.float32).reshape(-1,1,2)), area_carga[n])
         for n in tem if area_carga.get(n, 0) > 0]
a2 = np.array(pares, float)
if len(a2):
    esc = np.median(a2[:,0]/a2[:,1]); dv = np.abs(a2[:,0]/esc - a2[:,1])/a2[:,1]
    print(f"QA area: corr={np.corrcoef(a2[:,0],a2[:,1])[0,1]:.3f} esc={esc:.2f} | >20%: {int((dv>0.2).sum())} | >35%: {int((dv>0.35).sum())}")

# monta paths com furos (evenodd)
def path_com_furos(n, a):
    dpath = "M " + " L ".join(f"{round(x,1)},{round(y,1)}" for x, y in a) + " Z"
    f = furo_de.get(n)
    if f and cv2.pointPolygonTest(a.astype(np.float32).reshape(-1,1,2), (f[0], f[1]), False) >= 0:
        cx, cy, r = round(f[0],1), round(f[1],1), 16.0
        dpath += f" M {cx-r},{cy} A {r},{r} 0 1 0 {cx+r},{cy} A {r},{r} 0 1 0 {cx-r},{cy} Z"
    for q in qmarks:
        px, py = q["x"]*E+OX, q["y"]*E+OY
        if cv2.pointPolygonTest(a.astype(np.float32).reshape(-1,1,2), (px, py), False) >= 0:
            px, py, r = round(px,1), round(py,1), 26.0
            dpath += f" M {px-r},{py} A {r},{r} 0 1 0 {px+r},{py} A {r},{r} 0 1 0 {px-r},{py} Z"
    return dpath

lotes_json = {n: path_com_furos(n, a) for n, a in poly4k.items()}
json.dump(lotes_json, open(SP+r"\jdg-lotes-telao.json","w"), separators=(",",":"))
print("jdg-lotes-telao.json:", len(lotes_json), "lotes")

# SVG de conferencia + raster de revisao
img64 = base64.b64encode(open(r"C:\Users\lucas\Downloads\Masterplan Jardim das Gerais (4).png","rb").read()).decode()
paths = [f'<path d="{dp}" fill="#22c55e" fill-opacity="0.5" fill-rule="evenodd" stroke="#ffffff" stroke-width="1.4"><title>{n}</title></path>'
         for n, dp in sorted(lotes_json.items()) if n in nomes_carga]
svg = f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 3840 2160" width="3840" height="2160">\n<image href="data:image/png;base64,{img64}" xlink:href="data:image/png;base64,{img64}" x="0" y="0" width="3840" height="2160"/>\n' + "\n".join(paths) + "\n</svg>"
open(SP+r"\masterplan-jdg-v3.svg","w",encoding="utf-8").write(svg)

art = cv2.imdecode(np.fromfile(r"C:\Users\lucas\Downloads\Masterplan Jardim das Gerais (4).png", np.uint8), cv2.IMREAD_COLOR)
over = art.copy()
for n in tem:
    cv2.fillPoly(over, [np.round(poly4k[n]).astype(np.int32)], (94,197,34))
vis = cv2.addWeighted(art, 0.5, over, 0.5, 0)
for n in tem:
    cv2.polylines(vis, [np.round(poly4k[n]).astype(np.int32)], True, (255,255,255), 1)
for j,(Y0,Y1,X0,X1) in enumerate([(0,720,0,1280),(0,720,1280,2560),(0,720,2560,3840),
      (720,1440,0,1280),(720,1440,1280,2560),(720,1440,2560,3840),
      (1440,2160,0,1280),(1440,2160,1280,2560),(1440,2160,2560,3840)]):
    cv2.imwrite(os.path.join(SP, f"tile{j}.png"), vis[Y0:Y1, X0:X1])
print("svg v3 + tiles prontos")
