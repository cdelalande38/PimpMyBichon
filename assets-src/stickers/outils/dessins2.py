from lib import *
import math, os
OUT = os.path.join(os.path.dirname(__file__), 'sortie')
def save(name, w, h, body):
    open(os.path.join(OUT, name + '.svg'), 'w').write(svg(w, h, body))

def ring(outer, inner):
    return fillp(outer + inner)

def spiral(cx, cy, r0, r1, turns, steps=60):
    p = []
    for i in range(steps + 1):
        t = i / steps
        a = 2 * math.pi * turns * t
        r = r0 + (r1 - r0) * t
        p.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts(p)

# --- Joint Claqué ---
body = ring(chamf(40, 50, 944, 412, 70), chamf(66, 76, 892, 360, 52))
body += texte('JOINT', 360, 118, 112, left=118)
body += texte('CLAQUÉ', 512, 288, 112)
body += strokep(pts([(640, 190), (690, 138), (736, 214), (790, 138), (836, 202), (880, 164)]), 19)
save('sponsor-joint-claque', 1024, 512, body)

# --- Courroie Cassée ---
body = ring(rrect(40, 40, 944, 432, 216), rrect(66, 66, 892, 380, 190))
body += texte('COURROIE', 512, 98, 96)
body += texte('CASSÉE', 512, 252, 96)
body += strokep('M220,398H470', 15) + strokep('M550,398H804', 15)
body += strokep('M470,398l14,-14M470,398l14,14', 11) + strokep('M550,398l-14,-14M550,398l-14,14', 11)
save('sponsor-courroie-cassee', 1024, 512, body)

# --- Écrou Fou ---
hexo = regpoly(262, 262, 122, 6, 0) + regpoly(262, 262, 86, 6, 0)
body = ring(f"M{n(512 - 470)},256a470,214 0 1 0 940,0a470,214 0 1 0 -940,0Z", f"M{n(512 - 440)},256a440,184 0 1 0 880,0a440,184 0 1 0 -880,0Z")
body += fillp(hexo) + strokep(spiral(262, 262, 4, 60, 2.6), 15)
body += texte('ÉCROU', 650, 162, 80)
body += texte('FOU', 650, 292, 80)
save('sponsor-ecrou-fou', 1024, 512, body)

# --- Moteur Mou ---
body = ring(rrect(40, 40, 944, 432, 130), rrect(66, 66, 892, 380, 106))
body += texte('MOTEUR', 0, 108, 108, left=140)
body += texte('MOU', 0, 268, 108, left=140)
body += texte('Z', 0, 350, 40, left=660) + texte('Z', 0, 316, 58, left=722) + texte('Z', 0, 266, 82, left=800)
save('sponsor-moteur-mou', 1024, 512, body)

# --- Clé Perdue ---
body = ring(rrect(40, 60, 944, 392, 44), rrect(66, 86, 892, 340, 24))
body += ring(circle(250, 256, 152), circle(250, 256, 126))
body += texte('?', 250, 168, 176, 32)
body += texte('CLÉ', 690, 150, 110)
body += texte('PERDUE', 690, 292, 80)
save('sponsor-cle-perdue', 1024, 512, body)
print('ok2')

# --- Tournevis croisés ---
def tournevis(cx, cy, rot, plat):
    # repère local : pointe vers le haut ; manche en bas
    grip = rrect(-40, 40, 80, 200, 34)
    collar = rrect(-26, 20, 52, 28, 6)
    shaft = pts([(-15, -150), (15, -150), (15, 24), (-15, 24)], True)
    if plat:
        tip = pts([(-15, -150), (15, -150), (26, -206), (-26, -206)], True)
    else:
        tip = pts([(-15, -150), (15, -150), (0, -214)], True)
    # rainures du manche (creux) : petits traits évidés
    rid = ''
    for y in (90, 140, 190):
        rid += rrect(-26, y - 7, 52, 14, 7)
    d = f'<g transform="translate({cx} {cy}) rotate({rot})">' + fillp(grip + rid) + fillp(collar, 'nonzero') + fillp(shaft, 'nonzero') + fillp(tip, 'nonzero') + '</g>'
    return d
save('tournevis-croises', 512, 512, tournevis(256, 262, 38, True) + tournevis(256, 262, -38, False))
