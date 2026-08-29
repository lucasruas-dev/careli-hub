"""Absorve o SVG editado pelo Lucas.

⚠️ O LABEL MANDA QUANDO E UNICO. A primeira tentativa renomeava TODO path pelo numero que o
poligono contem — e isso PERDEU 6 lotes da carga: como os numeros nao ficam no centro do lote,
um poligono as vezes cobre tambem o numero do vizinho, e a regra escolhia o nome errado.

A geometria entra so onde ha ambiguidade de verdade: os labels REPETIDOS. Ao duplicar um objeto
o Inkscape copia o label junto, entao o lote novo nasce com o nome de quem foi copiado — foi o
que aconteceu em 29/08 (tres paths "JDG0210", sendo um o 0209 e outro o 0208; dois "JDG0906",
sendo um o 0905). Onde o label e unico, ele e a intencao do desenhista e vale.
"""
import json
import os
import re
from collections import Counter

import cv2
import numpy as np

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
REPO = r"C:\Users\lucas\Documents\Careli_C2x\Sistemas\careli-hub\apps\hub\public\masterplans-telao"
SVG = r"C:\Users\lucas\Downloads\masterplan-jdg-v3.svg"
E, OX, OY = 0.4240, -107.0, -316.4


def pontos(d):
    toks = re.findall(r"[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?", d)
    pts, i, cmd, x, y = [], 0, "", 0.0, 0.0
    while i < len(toks):
        t = toks[i]
        if re.match(r"[a-zA-Z]", t):
            cmd = t
            i += 1
            if cmd in "zZ":
                break
            continue
        if cmd == "M":
            x, y = float(toks[i]), float(toks[i + 1]); i += 2; pts.append((x, y)); cmd = "L"
        elif cmd == "m":
            x += float(toks[i]); y += float(toks[i + 1]); i += 2; pts.append((x, y)); cmd = "l"
        elif cmd == "L":
            x, y = float(toks[i]), float(toks[i + 1]); i += 2; pts.append((x, y))
        elif cmd == "l":
            x += float(toks[i]); y += float(toks[i + 1]); i += 2; pts.append((x, y))
        elif cmd == "H":
            x = float(toks[i]); i += 1; pts.append((x, y))
        elif cmd == "h":
            x += float(toks[i]); i += 1; pts.append((x, y))
        elif cmd == "V":
            y = float(toks[i]); i += 1; pts.append((x, y))
        elif cmd == "v":
            y += float(toks[i]); i += 1; pts.append((x, y))
        elif cmd == "C":
            x, y = float(toks[i + 4]), float(toks[i + 5]); i += 6; pts.append((x, y))
        elif cmd == "c":
            x += float(toks[i + 4]); y += float(toks[i + 5]); i += 6; pts.append((x, y))
        else:
            i += 1
    return pts


svg = open(SVG, encoding="utf-8").read()
inv = json.load(open(os.path.join(SP, "jdg-inventario.json"), encoding="utf-8"))
antigo = json.load(open(os.path.join(REPO, "jardim-das-gerais-lotes.json")))
carga_rows = json.load(open(os.path.join(SP, "jdg-c2x.json")))
carga = {r["name"] for r in carga_rows}
area_carga = {r["name"]: float(r["area"]) for r in carga_rows if r["area"]}

centros = {}
for r in inv:
    if r["lote"].isdigit() and r["quadra"].isdigit():
        centros[f"JDG{int(r['quadra']):02d}{int(r['lote']):02d}"] = (
            r["x"] * E + OX,
            r["y"] * E + OY,
        )

lidos = []
for bloco in re.findall(r"<path\b(.*?)</path>", svg, re.S):
    md = re.search(r'\bd="([^"]+)"', bloco)
    if not md:
        continue
    label = None
    for pat in (
        r"<title[^>]*>\s*(JDG\d{4})",
        r'inkscape:label="(JDG\d{4})"',
        r'\bid="(JDG\d{4})"',
    ):
        m = re.search(pat, bloco)
        if m:
            label = m.group(1)
            break
    p = np.array(pontos(md.group(1)), np.float64)
    if len(p) >= 3 and label:
        lidos.append((label, p))

quantos = Counter(l for l, _ in lidos)
resultado, renomeados = {}, []
# Os unicos entram primeiro: eles fixam os nomes que os duplicados nao podem roubar.
for label, p in lidos:
    if quantos[label] == 1 and label not in resultado:
        resultado[label] = p
for label, p in lidos:
    if quantos[label] == 1:
        continue
    cnt = p.astype(np.float32).reshape(-1, 1, 2)
    dentro = [
        n for n, (x, y) in centros.items()
        if cv2.pointPolygonTest(cnt, (float(x), float(y)), False) >= 0
    ]
    livres = [n for n in dentro if n not in resultado]
    nome = label if label not in resultado else (livres[0] if livres else None)
    if not nome or nome in resultado:
        continue
    resultado[nome] = p
    if nome != label:
        renomeados.append((label, nome))

print(f"paths no svg: {len(lidos)} | absorvidos: {len(resultado)}")
if renomeados:
    print("duplicados resolvidos pelo numero contido:")
    for de, para in renomeados:
        print(f"   label {de}  ->  {para}")


def furos_de(dp):
    out = []
    for parte in dp.split("M "):
        if " A " in parte:
            m = re.findall(r"[-\d.]+", parte)
            out.append((float(m[0]) + float(m[2]), float(m[1]), float(m[2])))
    return out


def montar(nome, p):
    d = "M " + " L ".join(f"{round(x,1)},{round(y,1)}" for x, y in p) + " Z"
    fs = furos_de(antigo.get(nome, ""))
    if not fs and nome in centros:
        fs = [(centros[nome][0], centros[nome][1], 16.0)]
    cnt = p.astype(np.float32).reshape(-1, 1, 2)
    for cx, cy, r in fs:
        if cv2.pointPolygonTest(cnt, (float(cx), float(cy)), False) < 0:
            continue
        cx, cy, r = round(cx, 1), round(cy, 1), round(r, 1)
        d += f" M {cx-r},{cy} A {r},{r} 0 1 0 {cx+r},{cy} A {r},{r} 0 1 0 {cx-r},{cy} Z"
    return d


saida = {n: montar(n, p) for n, p in resultado.items()}
json.dump(saida, open(os.path.join(SP, "jdg-lotes-v4.json"), "w"), separators=(",", ":"))

pares = [
    (cv2.contourArea(resultado[n].astype(np.float32).reshape(-1, 1, 2)), area_carga[n])
    for n in resultado
    if n in area_carga and area_carga[n] > 0
]
a = np.array(pares, float)
esc = np.median(a[:, 0] / a[:, 1])
dv = np.abs(a[:, 0] / esc - a[:, 1]) / a[:, 1]
print(
    f"\nQA area: corr={np.corrcoef(a[:,0], a[:,1])[0,1]:.3f}"
    f" | >20%: {int((dv > 0.2).sum())} | >35%: {int((dv > 0.35).sum())}"
)
print(f"cobertura da carga: {len(carga & set(saida))}/{len(carga)}")
faltam = sorted(carga - set(saida))
if faltam:
    print("DA CARGA SEM CONTORNO:", faltam)
print("NOVOS:", sorted(set(saida) - set(antigo)))
print("SUMIDOS:", sorted(set(antigo) - set(saida)))
