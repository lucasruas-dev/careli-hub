"""Prepara o material POR QUADRA para os desenhistas: recorte da imagem-mestre com regua fina
+ dados (lotes da carga com area, centros dos circulos, poligonos ja prontos do Lucas)."""
import cv2, numpy as np, json, os, collections

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
QD = os.path.join(SP, "quadras")
img = cv2.imdecode(np.fromfile(r"C:\Users\lucas\Downloads\GBR_JARDIM_V02-Recuperado-Recuperado.png", np.uint8), cv2.IMREAD_COLOR)
H, W = img.shape[:2]
carga = json.load(open(SP+r"\jdg-c2x.json"))
d = json.load(open(SP+r"\jdg-digitos.json")); circ = d["circulos"]
nm = json.load(open(SP+r"\jdg-nomes.json")); numeros, atrib = nm["numeros"], nm["atrib"]
ed4k = json.load(open(SP+r"\jdg-editados-lucas.json"))
E, OX, OY = 0.4240, -107.0, -316.4
def para_mestre(x, y): return ((x - OX)/E, (y - OY)/E)

centro = collections.defaultdict(dict)   # quadra -> nome -> (x,y) mestre
for k, num in numeros.items():
    nome = f"JDG{atrib[str(k)]}{num.zfill(2)}"
    if nome == "JDG1018" and abs(circ[int(k)][0]-4595) < 60 and abs(circ[int(k)][1]-2275) < 60:
        nome = "JDG0918"
    centro[nome[3:5]][nome] = (round(circ[int(k)][0],1), round(circ[int(k)][1],1))
centro["09"]["JDG0920"] = (4650.0, 2150.0)
centro["09"]["JDG0919"] = (4665.0, 2295.0)

lucas_m = {n: [list(para_mestre(x,y)) for x,y in p] for n, p in ed4k.items()}
q_lucas_inteiras = {"02","06","08"}
carga_por_q = collections.defaultdict(list)
for r in carga: carga_por_q[r["name"][3:5]].append({"nome": r["name"], "area_m2": float(r["area"] or 0)})

quadras_alvo = sorted(q for q in carga_por_q if q not in q_lucas_inteiras)
print("quadras alvo:", quadras_alvo)
manifesto = []
for q in quadras_alvo:
    pts = list(centro.get(q, {}).values())
    if not pts: print("SEM CIRCULOS:", q); continue
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    X0, Y0 = int(min(xs))-260, int(min(ys))-260
    X1, Y1 = int(max(xs))+260, int(max(ys))+260
    X0, Y0 = max(0,X0), max(0,Y0); X1, Y1 = min(W,X1), min(H,Y1)
    sub = img[Y0:Y1, X0:X1].copy()
    # regua: linha fina a cada 25, rotulo a cada 100
    for gx in range(X0 - X0%25, X1, 25):
        cor = (0,220,255) if gx % 100 == 0 else (120,200,220)
        cv2.line(sub, (gx-X0, 0), (gx-X0, Y1-Y0), cor, 1 if gx%100==0 else 1)
        if gx % 100 == 0:
            cv2.putText(sub, str(gx), (gx-X0+2, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0,0,255), 1)
    for gy in range(Y0 - Y0%25, Y1, 25):
        cor = (0,220,255) if gy % 100 == 0 else (120,200,220)
        cv2.line(sub, (0, gy-Y0), (X1-X0, gy-Y0), cor, 1)
        if gy % 100 == 0:
            cv2.putText(sub, str(gy), (2, gy-Y0+14), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0,0,255), 1)
    esc = min(2.2, 1500/max(1,sub.shape[1]))
    if esc > 1:
        sub = cv2.resize(sub, (int(sub.shape[1]*esc), int(sub.shape[0]*esc)), interpolation=cv2.INTER_CUBIC)
    cv2.imwrite(os.path.join(QD, f"q{q}.png"), sub)
    vizinhos_lucas = {n: p for n, p in lucas_m.items() if n[3:5] == q}
    dados = {
        "quadra": q,
        "lotes_da_carga": sorted(carga_por_q[q], key=lambda r: r["nome"]),
        "circulos_mestre": centro.get(q, {}),
        "ja_prontos_do_lucas": vizinhos_lucas,
        "recorte": {"X0": X0, "Y0": Y0, "X1": X1, "Y1": Y1, "escala_png": esc},
    }
    json.dump(dados, open(os.path.join(QD, f"q{q}.json"), "w"))
    manifesto.append({"q": q, "png": f"q{q}.png", "json": f"q{q}.json",
                      "n_lotes": len(carga_por_q[q]), "n_prontos": len(vizinhos_lucas)})
json.dump(manifesto, open(os.path.join(QD, "manifesto.json"), "w"))
print("preparadas:", len(manifesto), "quadras")
