from lib import *
import math, os, re, sys

OUT = os.path.join(os.path.dirname(__file__), 'sortie')
os.makedirs(OUT, exist_ok=True)
DEPOT = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'src', 'data', 'stickers')

def save(name, w, h, body):
    open(os.path.join(OUT, name + '.svg'), 'w').write(svg(w, h, body))

def path_t(cmds, cx, cy, k, rot=0, flipy=False):
    """cmds : liste de (lettre, points…) dans un repère centré ; renvoie un d= mis à l'échelle."""
    a = math.radians(rot)
    c, s = math.cos(a), math.sin(a)
    def tf(p):
        x, y = p
        if flipy: y = -y
        x, y = x * k, y * k
        return (cx + x * c - y * s, cy + x * s + y * c)
    out = []
    for cmd in cmds:
        L = cmd[0]
        if L == 'Z': out.append('Z'); continue
        out.append(L + ' '.join(f"{n(px)},{n(py)}" for px, py in map(tf, cmd[1:])))
    return ''.join(out)

SPADE = [('M', (0, -52)), ('C', (22, -30), (52, -8), (52, 16)), ('C', (52, 36), (33, 46), (16, 38)), ('C', (20, 48), (24, 56), (30, 62)),
         ('L', (-30, 62)), ('C', (-24, 56), (-20, 48), (-16, 38)), ('C', (-33, 46), (-52, 36), (-52, 16)), ('C', (-52, -8), (-22, -30), (0, -52)), ('Z',)]
HEART = [('M', (0, 52)), ('C', (-22, 32), (-52, 10), (-52, -16)), ('C', (-52, -40), (-22, -50), (0, -26)), ('C', (22, -50), (52, -40), (52, -16)), ('C', (52, 10), (22, 32), (0, 52)), ('Z',)]
DIAMOND = [('M', (0, -58)), ('L', (40, 0)), ('L', (0, 58)), ('L', (-40, 0)), ('Z',)]
def club_d(cx, cy, k):
    d = circle(cx, cy - 26 * k, 27 * k) + circle(cx - 29 * k, cy + 16 * k, 27 * k) + circle(cx + 29 * k, cy + 16 * k, 27 * k)
    d += pts([(cx - 7 * k, cy), (cx + 7 * k, cy), (cx + 14 * k, cy + 62 * k), (cx - 14 * k, cy + 62 * k)], True)
    return d

# ---------- Dés ----------
def pips(n_):
    P = {1: [(0, 0)], 2: [(-1, -1), (1, 1)], 3: [(-1, -1), (0, 0), (1, 1)], 4: [(-1, -1), (1, -1), (-1, 1), (1, 1)],
         5: [(-1, -1), (1, -1), (0, 0), (-1, 1), (1, 1)], 6: [(-1, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (1, 1)]}
    return P[n_]

def de(cx, cy, size, val, rot):
    r = size * 0.2
    x0, y0 = cx - size / 2, cy - size / 2
    pts_ = pips(val)
    step = size * 0.26
    holes = ''
    for px, py in pts_:
        holes += circle(cx + px * step, cy + py * step, size * 0.085)
    body = rrect(x0, y0, size, size, r)
    # liseré intérieur creusé : un anneau fin laissé vide
    gap = rrect(x0 + size * 0.07, y0 + size * 0.07, size * 0.86, size * 0.86, r * 0.75)
    inner = rrect(x0 + size * 0.11, y0 + size * 0.11, size * 0.78, size * 0.78, r * 0.62)
    return f'<g transform="rotate({rot} {n(cx)} {n(cy)})">' + fillp(body + gap + inner + holes) + '</g>'

save('de-cinq', 512, 512, de(256, 256, 400, 5, -12))
save('des-paire', 1024, 512, de(300, 270, 330, 6, -14) + de(716, 250, 330, 4, 16))

# ---------- Cartes ----------
def carte(cx, cy, w, h, suit_cmds, big, small, rot, club=False):
    x0, y0 = cx - w / 2, cy - h / 2
    body = rrect(x0, y0, w, h, 34) + rrect(x0 + 26, y0 + 26, w - 52, h - 52, 14)
    if club:
        big_d = club_d(cx, cy, big)
        s1 = club_d(x0 + 58, y0 + 76, small)
        s2 = club_d(x0 + w - 58, y0 + h - 76 - 0, small)
    else:
        big_d = path_t(suit_cmds, cx, cy, big)
        s1 = path_t(suit_cmds, x0 + 62, y0 + 82, small)
        s2 = path_t(suit_cmds, x0 + w - 62, y0 + h - 82, small, 180)
    return f'<g transform="rotate({rot} {n(cx)} {n(cy)})">' + fillp(body) + fillp(big_d, 'nonzero') + fillp(s1, 'nonzero') + fillp(s2, 'nonzero') + '</g>'

save('carte-as-pique', 512, 512, carte(256, 256, 320, 440, SPADE, 2.0, 0.42, 10))
save('carte-as-coeur', 512, 512, carte(256, 256, 320, 440, HEART, 2.0, 0.42, -10))

# Les quatre enseignes en bandeau
def band_suits():
    k = 2.0
    xs = [140, 396, 652, 908]
    d = path_t(SPADE, xs[0], 128, k) + path_t(HEART, xs[1], 128, k) + path_t(DIAMOND, xs[2], 128, k * 0.98)
    return fillp(d, 'nonzero') + fillp(club_d(xs[3], 116, 1.95), 'nonzero')
save('cartes-enseignes', 1024, 256, band_suits())

# ---------- Vagues ----------
def vague(y, amp, w0=60, w1=964, wl=180):
    d = f"M{w0},{y}"
    x = w0
    up = True
    d += f"Q{x + wl / 2},{y - 2 * amp} {x + wl},{y}"
    x += wl
    while x + wl <= w1 + 1:
        d += f" T{x + wl},{y}" if False else ''
        x += wl
    return d

def sine(y, amp, x0, x1, half):
    """Suite d'arcs quadratiques alternés (houle) : demi-période `half`."""
    d = f"M{n(x0)},{n(y)}"
    x = x0
    sign = -1
    while x + half <= x1 + 0.5:
        d += f"Q{n(x + half / 2)},{n(y + sign * 2 * amp)} {n(x + half)},{n(y)}"
        x += half
        sign = -sign
    return d

body = ''
for i, y in enumerate((60, 128, 196)):
    body += strokep(sine(y, 22, 56, 968, 114), 34)
save('vagues-bandeau', 1024, 256, body)

# ---------- Soleils ----------
def soleil_retro():
    cx, cy, r = 256, 236, 205
    def seg(ya, yb):
        xa = math.sqrt(max(r * r - (ya - cy) ** 2, 0)); xb = math.sqrt(max(r * r - (yb - cy) ** 2, 0))
        return (f"M{n(cx - xa)},{n(ya)}L{n(cx + xa)},{n(ya)}A{r},{r} 0 0 1 {n(cx + xb)},{n(yb)}"
                f"L{n(cx - xb)},{n(yb)}A{r},{r} 0 0 1 {n(cx - xa)},{n(ya)}Z")
    bands = [(cy - r, cy + 8), (cy + 30, cy + 62), (cy + 84, cy + 108), (cy + 128, cy + 146), (cy + 164, cy + 178), (cy + 192, cy + 202)]
    d = ''.join(seg(a, b) for a, b in bands)
    return fillp(d, 'nonzero')
save('soleil-retro', 512, 512, soleil_retro())

def soleil_rayons():
    cx = cy = 256
    d = circle(cx, cy, 92) + circle(cx, cy, 124)  # disque + anneau (evenodd : creux entre 92 et 124 ? non : anneau seul)
    ring = circle(cx, cy, 128) + circle(cx, cy, 108)
    disc = circle(cx, cy, 84)
    rays = ''
    for i in range(16):
        a = 360 * i / 16 - 90
        ro = 236 if i % 2 == 0 else 196
        hw = 8.5 if i % 2 == 0 else 7.5
        base = 150
        p = [(base, -hw * 2.2), (ro, 0), (base, hw * 2.2)]
        p = [(cx + x * math.cos(math.radians(a)) - y * math.sin(math.radians(a)), cy + x * math.sin(math.radians(a)) + y * math.cos(math.radians(a))) for x, y in p]
        rays += pts(p, True)
    return fillp(disc + rays, 'nonzero') + fillp(ring)
save('soleil-rayons', 512, 512, soleil_rayons())

# ---------- Bandes de course ----------
def bande_fleche():
    c = 128
    main = pts([(48, 78), (880, 78), (976, c), (880, 178), (48, 178), (122, c)], True)
    hi = pts([(100, 38), (846, 38), (886, 56), (130, 56)], True)  # filets fins (parallélogrammes)
    lo = pts([(130, 200), (886, 200), (846, 218), (100, 218)], True)
    return fillp(main, 'nonzero') + fillp(hi, 'nonzero') + fillp(lo, 'nonzero')
save('bande-fleche-rallye', 1024, 256, bande_fleche())

def bande_fusee():
    top = pts([(40, 128), (260, 74), (984, 74), (930, 136), (260, 136)], True)
    mid = pts([(250, 158), (880, 158), (860, 186), (280, 186)], True)
    low = pts([(420, 208), (800, 208), (788, 232), (440, 232)], True)
    tip = pts([(40, 128), (260, 74), (260, 136)], True)
    return fillp(top, 'nonzero') + fillp(mid, 'nonzero') + fillp(low, 'nonzero')
save('bande-fusee', 1024, 256, bande_fusee())

def bande_diagonales():
    bars = [(70, 74), (190, 96), (330, 122), (500, 152), (700, 188)]
    d = ''
    for x, wd in bars:
        sk = 120
        d += pts([(x + sk, 56), (x + sk + wd, 56), (x + wd, 456), (x, 456)], True)
    return fillp(d, 'nonzero')
# les barres s'élargissent vers la droite : 5 lames inclinées, 2:1
body = ''
x = 60
widths = [46, 66, 90, 118, 150]
gap = 34
sk = 130
d = ''
for wd in widths:
    d += pts([(x + sk, 70), (x + sk + wd, 70), (x + wd, 442), (x, 442)], True)
    x += wd + gap
save('bande-diagonales', 1024, 512, fillp(d, 'nonzero'))

# ---------- Damier en vague ----------
def damier_onde():
    cols, rows, c = 12, 3, 76
    x0 = (1024 - cols * c) / 2
    d = ''
    for i in range(cols):
        off = 22 * math.sin(2 * math.pi * (i + 0.5) / 12.0 + 0.6)
        for j in range(rows):
            if (i + j) % 2 == 0:
                d += rrect(x0 + i * c, 14 + j * c + off + 14, c, c, 0)
    return fillp(d, 'nonzero')
save('damier-onde', 1024, 256, damier_onde())

# ---------- Drapeaux croisés ----------
def drapeau(px, py, rot, flip):
    cell = 36
    cols, rows = 4, 3
    fx, fy = 8, -310  # coin haut-gauche du drapeau (repère : pied du mât en 0,0, mât vers le haut)
    d = ''
    for i in range(cols):
        for j in range(rows):
            if (i + j) % 2 == 0:
                d += rrect(fx + i * cell, fy + j * cell, cell, cell, 0)
    pole = strokep('M0,0L0,' + n(fy - 12), 15)
    frame = strokep(f"M{fx},{fy}H{fx + cols * cell}V{fy + rows * cell}H{fx}Z", 10, cap='butt')
    sx = -1 if flip else 1
    return f'<g transform="translate({px} {py}) rotate({rot}) scale({sx} 1)">' + pole + fillp(d, 'nonzero') + frame + '</g>'
save('drapeaux-croises', 512, 512, drapeau(180, 478, 22, False) + drapeau(332, 478, -22, True))

# ---------- Numéros ----------
def chiffres(txt, cx, ytop, h, sw):
    return texte(txt, cx, ytop, h, sw)

def hexa_36():
    ring = regpoly(256, 256, 232, 6, 0) + regpoly(256, 256, 204, 6, 0)
    return fillp(ring) + chiffres('36', 256, 184, 144, 30)
save('numero-hexagone-36', 512, 512, hexa_36())

def carre_5():
    ring = rrect(40, 40, 432, 432, 96) + rrect(70, 70, 372, 372, 70)
    inner = rrect(100, 100, 312, 312, 50)
    return fillp(ring) + texte('5', 256, 130, 252, 56)
save('numero-carre-5', 512, 512, carre_5())

# ---------- Étincelles ----------
def sparkle(cx, cy, r, pinch=0.0):
    k = r
    return (f"M{n(cx)},{n(cy - k)}Q{n(cx + pinch * k)},{n(cy - pinch * k)} {n(cx + k)},{n(cy)}Q{n(cx + pinch * k)},{n(cy + pinch * k)} {n(cx)},{n(cy + k)}"
            f"Q{n(cx - pinch * k)},{n(cy + pinch * k)} {n(cx - k)},{n(cy)}Q{n(cx - pinch * k)},{n(cy - pinch * k)} {n(cx)},{n(cy - k)}Z")
save('etincelles', 512, 512, fillp(sparkle(214, 290, 190, 0.1), 'nonzero') + fillp(sparkle(404, 120, 84, 0.1), 'nonzero') + fillp(sparkle(398, 400, 48, 0.1), 'nonzero'))

# ---------- Engrenage ----------
def engrenage(cx, cy, ro, ri, k, hole):
    p = []
    for i in range(k):
        a0 = 360 * i / k
        step = 360 / k
        for da, r in ((-0.30, ri), (-0.19, ro), (0.19, ro), (0.30, ri)):
            a = math.radians(a0 + da * step)
            p.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts(p, True) + circle(cx, cy, hole)
body = fillp(engrenage(256, 256, 226, 178, 12, 128))
hub = circle(256, 256, 58)
spokes = fillp(hub, 'nonzero')
for a in (0, 120, 240):
    p = [(-24, 0), (24, 0), (28, 150), (-28, 150)]
    spokes += fillp(pts(rot_pts([(256 + x, 256 + y) for x, y in p], 256, 256, a), True), 'nonzero')
save('engrenage', 512, 512, body + spokes)

# ---------- Volant ----------
def volant():
    ring = circle(256, 256, 228) + circle(256, 256, 186)
    hub = circle(256, 288, 62)
    barre = pts([(48, 250), (172, 232), (340, 232), (464, 250), (452, 304), (350, 292), (162, 292), (60, 304)], True)
    bas = pts([(228, 330), (284, 330), (296, 468), (216, 468)], True)
    # le bas du volant est un peu moins haut : la tige rejoint l'anneau
    return fillp(ring) + fillp(barre, 'nonzero') + fillp(bas, 'nonzero') + fillp(hub, 'nonzero') + fillp(rrect(236, 36, 40, 36, 8), 'nonzero')
save('volant', 512, 512, volant())

# ---------- Flocon ----------
def flocon():
    cx = cy = 256
    arm = [('M', 0, 0), ('L', 0, -214)]
    d = ''
    for i in range(6):
        a = math.radians(60 * i - 90)
        ux, uy = math.cos(a), math.sin(a)
        px, py = -uy, ux
        def P(t, s):  # t le long du bras, s en travers
            return (cx + ux * t + px * s, cy + uy * t + py * s)
        d += pts([P(26, 0), P(214, 0)])
        for t, ln in ((92, 56), (150, 44)):
            for sgn in (-1, 1):
                d += pts([P(t, 0), P(t + ln * 0.8, sgn * ln * 0.8)])
        # petite pointe au bout
        d += pts([P(214, 0), P(236, 0)])
    hexa = regpoly(256, 256, 42, 6, -90)
    return strokep(d, 26) + fillp(hexa, 'nonzero')
save('trophee-neige', 512, 512, flocon())

# ---------- Flammes reprises : liseré et fantômes d'après la silhouette classique ----------
def silhouette(name):
    s = open(os.path.join(DEPOT, f'flammes-classiques-{name}.svg')).read()
    return re.search(r' d="([^"]*)"', s).group(1)

def lisere(size, band):
    S = silhouette(size)
    w, h = (1024, 512) if size == 'long' else (512, 512)
    cid = f'flammes-lisere-{size}-c'
    defs = f'<defs><clipPath id="{cid}"><path clip-rule="evenodd" d="{S}"/></clipPath></defs>'
    return w, h, (defs + fillp(S, 'evenodd', 0.2) +
                  f'<path fill="none" stroke="currentColor" stroke-width="{band * 2}" clip-path="url(#{cid})" d="{S}"/>')

for size in ('long', 'court'):
    w, h, b = lisere(size, 20)
    save(f'flammes-lisere-{size}', w, h, b)

def fantomes(size):
    S = silhouette(size)
    w, h = (1024, 512) if size == 'long' else (512, 512)
    ox, oy = (70, 250) if size == 'long' else (60, 256)
    out = ''
    for k, op in ((1.0, 0.34), (0.72, 0.38), (0.46, 0.5)):
        out += f'<g transform="translate({ox} {oy}) scale({k}) translate({-ox} {-oy})">' + fillp(S, 'evenodd', op) + '</g>'
    return w, h, out
for size in ('long', 'court'):
    w, h, b = fantomes(size)
    save(f'flammes-fantomes-{size}', w, h, b)
print('ok')
