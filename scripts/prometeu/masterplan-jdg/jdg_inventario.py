"""Inventario do JDG lido do PDF: quadra, lote e area, para conferir contra a carga do C2X.

⚠️ ISTO NAO E ESTIMATIVA. Quadra, numero do lote e area sao TEXTO do PDF, com coordenada. O que
o material nao permite afirmar e a GEOMETRIA (o contorno de cada lote), porque o PDF e raster.
"""
import cv2, numpy as np, json, collections, csv

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
spans = json.load(open(SP+r"\jdg-spans.json", encoding="utf-8"))
lab = np.load(SP+r"\jdg-lab.npy")
quadras = [s for s in spans if s["size"]==36.0 and s["t"].isdigit()]
lotes   = [s for s in spans if s["size"]==30.0]
areas   = [s for s in spans if s["size"]==20.0 and s["t"].replace(".","").isdigit()]

H, W = lab.shape
def ilha(s, r=60):
    x,y = int(s["x"]), int(s["y"])
    viz = lab[max(0,y-r):min(H,y+r), max(0,x-r):min(W,x+r)]
    v = viz[viz>0]
    return int(collections.Counter(v.tolist()).most_common(1)[0][0]) if v.size else 0

# ⚠️ A QUADRA VEM DA ILHA, NAO DA DISTANCIA. O marcador da quadra nao fica no centro do conjunto
# de lotes - as quadras sao alongadas e o circulo cai onde coube no desenho. Associando pelo
# marcador mais proximo, so 8 das 46 quadras fechavam a sequencia 01..N; pela ilha (a mancha
# verde que as ruas isolam), a quadra e a mesma que o lote pisa.
q_ilha = collections.defaultdict(list)
for q in quadras: q_ilha[ilha(q)].append(q["t"])

reg = []
for l in lotes:
    il = ilha(l)
    cand = q_ilha.get(il, [])
    if len(cand) == 1:
        q = cand[0]
    elif len(cand) > 1:
        # Ilha com mais de uma quadra (ruas que se tocam): desempata pelo marcador mais proximo.
        q = min([x for x in quadras if x["t"] in cand],
                key=lambda x:(x["x"]-l["x"])**2+(x["y"]-l["y"])**2)["t"]
    else:
        q = min(quadras, key=lambda x:(x["x"]-l["x"])**2+(x["y"]-l["y"])**2)["t"]
    a = min(areas, key=lambda a:(a["x"]-l["x"])**2+(a["y"]-l["y"])**2) if areas else None
    d = ((a["x"]-l["x"])**2+(a["y"]-l["y"])**2)**.5 if a else 9e9
    reg.append({"quadra":q, "lote":l["t"], "x":l["x"], "y":l["y"],
                "area": a["t"] if d < 140 else "", "ilha": il})

porq = collections.defaultdict(list)
for r in reg: porq[r["quadra"]].append(r)
ok=0; problemas=[]
print("quadra | n | sequencia")
for q in sorted(porq, key=int):
    nums = sorted(int(r["lote"]) for r in porq[q])
    seq = nums == list(range(1, len(nums)+1))
    if seq: ok+=1
    else: problemas.append(q)
    print(f"  {q}: {len(nums):>3} {'01..%02d ok'%len(nums) if seq else 'FURO/DUP -> '+str(nums)}")
print(f"\nquadras com sequencia limpa: {ok}/46  | total lotes: {len(reg)}")
print("a conferir:", problemas)

with open(SP+r"\jdg-inventario.csv","w",newline="",encoding="utf-8-sig") as f:
    w = csv.writer(f, delimiter=";")
    w.writerow(["name","quadra","lote","area_m2"])
    for r in sorted(reg, key=lambda r:(int(r["quadra"]), int(r["lote"]) if r["lote"].isdigit() else 0)):
        w.writerow([f"JDG{int(r['quadra']):02d}{int(r['lote']):02d}" if r["lote"].isdigit() else "",
                    r["quadra"], r["lote"], r["area"]])
json.dump(reg, open(SP+r"\jdg-inventario.json","w"), ensure_ascii=False)
print("\nsalvo jdg-inventario.csv")
