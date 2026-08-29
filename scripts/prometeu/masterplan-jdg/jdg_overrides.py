"""Dois lotes cravados a olho, com regua, depois que o watershed entregou celulas deslocadas
neles (o furo do numero caia fora do poligono - denuncia infalivel):
  JDG4407 - regua na arte 4K;  JDG3605 - regua na imagem-mestre, convertido pelo registro."""
import json

SP = r"C:\Users\lucas\AppData\Local\Temp\claude\C--Users-lucas-Documents-Careli-C2x-Sistemas\aa75c3b5-c653-4fdf-b653-625694ef9095\scratchpad"
lotes = json.load(open(SP+r"\jdg-lotes-telao.json"))

def path(pontos, furo):
    d = "M " + " L ".join(f"{x},{y}" for x, y in pontos) + " Z"
    cx, cy, r = furo
    return f"{d} M {cx-r},{cy} A {r},{r} 0 1 0 {cx+r},{cy} A {r},{r} 0 1 0 {cx-r},{cy} Z"

# A quadra 44 sobe num PICO triangular; a divisa vertical que desce do pico separa 06 e 07.
# O primeiro cravamento usou topo reto e engoliu mata e o 4406 junto.
lotes["JDG4406"] = path([(1663,153),(1607,193),(1592,247),(1653,243)], (1652,242,14))
lotes["JDG4407"] = path([(1663,153),(1689,178),(1645,246),(1653,243)], (1666,207,14))
# QUADRAS 35 E 36 INTEIRAS cravadas com regua na imagem-mestre (29/08): o bosque desenhado por
# cima comeu as divisas e o watershed + reparos embolaram os 10 lotes deste canto. Estrutura
# lida da arte: q36 em quatro faixas (01 | 02-03 | 04-05 | 06-07, divisa vertical curta no
# meio); q35 triangular (01-02 em cima, 03 na faixa de baixo). Coordenadas no espaco-mestre
# (10000x5626), convertidas pelo registro (0.4240, -107, -316.4).
def m(x, y): return (round(x*0.4240-107.0,1), round(y*0.4240-316.4,1))
def pm(pontos, furo_m):
    fx, fy = m(furo_m[0], furo_m[1])
    return path([m(x,y) for x,y in pontos], (fx, fy, 14))
lotes["JDG3601"] = pm([(5645,3398),(5815,3390),(5835,3437),(5575,3477)], (5745,3418))
lotes["JDG3602"] = pm([(5575,3480),(5765,3452),(5778,3548),(5598,3585)], (5697,3512))
lotes["JDG3603"] = pm([(5765,3452),(5828,3442),(5872,3540),(5778,3548)], (5822,3520))
lotes["JDG3604"] = pm([(5598,3588),(5812,3552),(5828,3648),(5622,3688)], (5742,3622))
lotes["JDG3605"] = pm([(5812,3552),(5878,3542),(5920,3640),(5828,3648)], (5872,3632))
lotes["JDG3606"] = pm([(5622,3690),(5852,3652),(5872,3748),(5682,3798)], (5777,3732))
lotes["JDG3607"] = pm([(5852,3652),(5922,3642),(5962,3742),(5872,3748)], (5912,3737))
lotes["JDG3501"] = pm([(6150,3555),(6285,3535),(6295,3655),(6155,3665)], (6187,3620))
lotes["JDG3502"] = pm([(6018,3577),(6150,3555),(6155,3665),(6035,3672)], (6092,3632))
lotes["JDG3503"] = pm([(6005,3675),(6245,3655),(6265,3748),(6040,3762)], (6042,3702))
json.dump(lotes, open(SP+r"\jdg-lotes-telao.json","w"), separators=(",",":"))
print("overrides aplicados")
