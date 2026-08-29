"""Acabamento final dos furos: (1) todo marcador VERMELHO de quadra que caia dentro de um lote
vira furo nele (senao o numero da quadra some sob a pintura); (2) furos pretos com folga r=16;
(3) o 3503 para na rua."""
import json, re, numpy as np

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
lotes = json.load(open(SP+r"\jdg-lotes-telao.json"))
nm = json.load(open(SP+r"\jdg-nomes.json")); qmarks = nm["qmarks"]
E, OX, OY = 0.4240, -107.0, -316.4

def desmontar(dpath):
    cont, furos = None, []
    for s in [x for x in dpath.split("M ") if x.strip()]:
        if " A " in s:
            m = re.findall(r"[-\d.]+", s)
            furos.append((float(m[0])+float(m[2]), float(m[1]), float(m[2])))
        else:
            cont = np.array([[float(a) for a in par.split(",")] for par in re.findall(r"[-\d.]+,[-\d.]+", s)])
    return cont, furos

def montar(cont, furos):
    d = "M " + " L ".join(f"{round(x,1)},{round(y,1)}" for x,y in cont) + " Z"
    for cx, cy, r in furos:
        cx, cy, r = round(cx,1), round(cy,1), round(r,1)
        d += f" M {cx-r},{cy} A {r},{r} 0 1 0 {cx+r},{cy} A {r},{r} 0 1 0 {cx-r},{cy} Z"
    return d

import cv2
todos = {n: desmontar(d) for n, d in lotes.items()}

# furos pretos com folga
for n, (cont, furos) in todos.items():
    todos[n] = (cont, [(cx, cy, max(r, 16.0)) for cx, cy, r in furos])

# vermelhos: furo no lote que os contem (r maior: a bola de quadra e maior)
for q in qmarks:
    px, py = q["x"]*E+OX, q["y"]*E+OY
    for n, (cont, furos) in todos.items():
        if cv2.pointPolygonTest(cont.astype(np.float32).reshape(-1,1,2), (px, py), False) >= 0:
            furos.append((px, py, 21.0))
            break

# 3503: recua o lado direito para nao pintar a rua
cont, furos = todos["JDG3503"]
for v in cont:
    if v[0] > 2470: v[0] = min(v[0], 2492.0)
todos["JDG3503"] = (cont, furos)

lotes = {n: montar(c, f) for n, (c, f) in todos.items()}
json.dump(lotes, open(SP+r"\jdg-lotes-telao.json","w"), separators=(",",":"))
verm = sum(1 for _, (c, f) in todos.items() if any(r > 20 for _,_,r in f))
print(f"lotes com furo de quadra vermelho: {verm} | total: {len(lotes)}")
