"""Renderiza o desenho de uma quadra sobre a imagem-mestre, para o verificador OLHAR.
Uso: python render_quadra.py 45   (le quadras/q45.json e quadras/out-q45.json)"""
import cv2, numpy as np, json, os, sys

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
q = sys.argv[1].zfill(2)
QD = os.path.join(SP, "quadras")
dados = json.load(open(os.path.join(QD, f"q{q}.json")))
out = json.load(open(os.path.join(QD, f"out-q{q}.json")))
img = cv2.imdecode(np.fromfile(r"C:\Users\lucas\Downloads\GBR_JARDIM_V02-Recuperado-Recuperado.png", np.uint8), cv2.IMREAD_COLOR)
r = dados["recorte"]
X0, Y0, X1, Y1 = r["X0"], r["Y0"], r["X1"], r["Y1"]
sub = img[Y0:Y1, X0:X1].copy()
over = sub.copy()
for lote in out["lotes"]:
    a = np.array(lote["pontos"], np.float64) - [X0, Y0]
    cv2.fillPoly(over, [np.round(a).astype(np.int32)], (94, 197, 34))
vis = cv2.addWeighted(sub, 0.55, over, 0.45, 0)
for lote in out["lotes"]:
    a = np.round(np.array(lote["pontos"], np.float64) - [X0, Y0]).astype(np.int32)
    cv2.polylines(vis, [a], True, (0, 0, 255), 2)
    for v in a: cv2.circle(vis, tuple(v), 3, (255, 0, 255), -1)
    cx, cy = a[:,0].mean(), a[:,1].mean()
    cv2.putText(vis, lote["nome"][3:], (int(cx)-22, int(cy)), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (0,255,255), 2)
# os ja-prontos do Lucas, em AZUL, para conferir o encaixe
for nome, p in dados.get("ja_prontos_do_lucas", {}).items():
    a = np.round(np.array(p, np.float64) - [X0, Y0]).astype(np.int32)
    cv2.polylines(vis, [a], True, (255, 140, 0), 2)
esc = min(2.0, 1500/max(1, vis.shape[1]))
if esc > 1:
    vis = cv2.resize(vis, (int(vis.shape[1]*esc), int(vis.shape[0]*esc)), interpolation=cv2.INTER_CUBIC)
cv2.imwrite(os.path.join(QD, f"render-q{q}.png"), vis)
print(f"render-q{q}.png salvo | lotes desenhados: {len(out['lotes'])}")
