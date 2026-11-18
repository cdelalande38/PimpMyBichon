# Aides de dessin des stickers : tout est tracé à la main (aucune police, aucun fichier tiers).
import math

def n(x):
    s = f"{x:.1f}".rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s

def pts(points, close=False):
    d = 'M' + ' L'.join(f"{n(x)},{n(y)}" for x, y in points)
    return d + ('Z' if close else '')

def circle(cx, cy, r):
    return f"M{n(cx - r)},{n(cy)}a{n(r)},{n(r)} 0 1 0 {n(2 * r)},0a{n(r)},{n(r)} 0 1 0 {n(-2 * r)},0Z"

def rrect(x, y, w, h, r):
    return (f"M{n(x + r)},{n(y)}H{n(x + w - r)}a{n(r)},{n(r)} 0 0 1 {n(r)},{n(r)}V{n(y + h - r)}"
            f"a{n(r)},{n(r)} 0 0 1 {n(-r)},{n(r)}H{n(x + r)}a{n(r)},{n(r)} 0 0 1 {n(-r)},{n(-r)}V{n(y + r)}"
            f"a{n(r)},{n(r)} 0 0 1 {n(r)},{n(-r)}Z")

def chamf(x, y, w, h, c):
    return pts([(x + c, y), (x + w - c, y), (x + w, y + c), (x + w, y + h - c), (x + w - c, y + h), (x + c, y + h), (x, y + h - c), (x, y + c)], True)

def regpoly(cx, cy, r, k, rot=-90):
    return pts([(cx + r * math.cos(math.radians(rot + 360 * i / k)), cy + r * math.sin(math.radians(rot + 360 * i / k))) for i in range(k)], True)

def star(cx, cy, ro, ri, k, rot=-90):
    out = []
    for i in range(2 * k):
        r = ro if i % 2 == 0 else ri
        a = math.radians(rot + 180 * i / k)
        out.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts(out, True)

def rot_pts(points, cx, cy, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return [(cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c) for x, y in points]

def fillp(d, rule='evenodd', op=None):
    o = f' fill-opacity="{op}"' if op is not None else ''
    r = f' fill-rule="{rule}"' if rule else ''
    return f'<path fill="currentColor"{r}{o} d="{d}"/>'

def strokep(d, w, op=None, cap='round'):
    o = f' stroke-opacity="{op}"' if op is not None else ''
    return f'<path fill="none" stroke="currentColor" stroke-width="{n(w)}" stroke-linecap="{cap}" stroke-linejoin="round"{o} d="{d}"/>'

def svg(w, h, body):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}">{body}</svg>\n'

# --- Alphabet tracé : polylignes sur une grille de 4 de large (ou 5) sur 6 de haut ---
G = {
 'A': (4, [[(0,6),(0,2),(1,0),(3,0),(4,2),(4,6)], [(0,3.6),(4,3.6)]]),
 'B': (4, [[(0,0),(0,6)], [(0,0),(3,0),(4,1),(4,2),(3,3),(0,3)], [(3,3),(4,4),(4,5),(3,6),(0,6)]]),
 'C': (4, [[(4,1),(3,0),(1,0),(0,1),(0,5),(1,6),(3,6),(4,5)]]),
 'D': (4, [[(0,0),(0,6),(2.5,6),(4,4.5),(4,1.5),(2.5,0),(0,0)]]),
 'E': (4, [[(4,0),(0,0),(0,6),(4,6)], [(0,3),(3,3)]]),
 'F': (4, [[(4,0),(0,0),(0,6)], [(0,3),(3,3)]]),
 'G': (4, [[(4,1),(3,0),(1,0),(0,1),(0,5),(1,6),(3,6),(4,5),(4,3.2),(2.2,3.2)]]),
 'H': (4, [[(0,0),(0,6)], [(4,0),(4,6)], [(0,3),(4,3)]]),
 'I': (0, [[(0,0),(0,6)]]),
 'J': (4, [[(4,0),(4,5),(3,6),(1,6),(0,5)]]),
 'K': (4, [[(0,0),(0,6)], [(4,0),(0,3.3),(4,6)]]),
 'L': (4, [[(0,0),(0,6),(4,6)]]),
 'M': (5, [[(0,6),(0,0),(2.5,3.6),(5,0),(5,6)]]),
 'N': (4, [[(0,6),(0,0),(4,6),(4,0)]]),
 'O': (4, [[(1,0),(3,0),(4,1),(4,5),(3,6),(1,6),(0,5),(0,1),(1,0)]]),
 'P': (4, [[(0,6),(0,0),(3,0),(4,1),(4,2),(3,3),(0,3)]]),
 'Q': (4, [[(1,0),(3,0),(4,1),(4,5),(3,6),(1,6),(0,5),(0,1),(1,0)], [(2.6,4.4),(4.2,6.3)]]),
 'R': (4, [[(0,6),(0,0),(3,0),(4,1),(4,2),(3,3),(0,3)], [(2,3),(4,6)]]),
 'S': (4, [[(4,1),(3,0),(1,0),(0,1),(0,2),(1,3),(3,3),(4,4),(4,5),(3,6),(1,6),(0,5)]]),
 'T': (4, [[(0,0),(4,0)], [(2,0),(2,6)]]),
 'U': (4, [[(0,0),(0,5),(1,6),(3,6),(4,5),(4,0)]]),
 'V': (4, [[(0,0),(2,6),(4,0)]]),
 'W': (5, [[(0,0),(1.3,6),(2.5,2.4),(3.7,6),(5,0)]]),
 'X': (4, [[(0,0),(4,6)], [(4,0),(0,6)]]),
 'Y': (4, [[(0,0),(2,3),(4,0)], [(2,3),(2,6)]]),
 'Z': (4, [[(0,0),(4,0),(0,6),(4,6)]]),
 '0': (4, [[(1,0),(3,0),(4,1),(4,5),(3,6),(1,6),(0,5),(0,1),(1,0)]]),
 '1': (3, [[(0,1.2),(2,0),(2,6)]]),
 '2': (4, [[(0,1),(1,0),(3,0),(4,1),(4,2),(0,6),(4,6)]]),
 '3': (4, [[(0,0),(4,0),(2,2.6),(3,3),(4,4),(4,5),(3,6),(1,6),(0,5)]]),
 '4': (4, [[(3,6),(3,0),(0,4),(4,4)]]),
 '5': (4, [[(4,0),(0,0),(0,3),(3,3),(4,4),(4,5),(3,6),(1,6),(0,5)]]),
 '6': (4, [[(4,1),(3,0),(1,0),(0,1),(0,5),(1,6),(3,6),(4,5),(4,4),(3,3),(0,3)]]),
 '7': (4, [[(0,0),(4,0),(1.5,6)]]),
 '8': (4, [[(1,0),(3,0),(4,1),(4,2),(3,3),(1,3),(0,2),(0,1),(1,0)], [(1,3),(0,4),(0,5),(1,6),(3,6),(4,5),(4,4),(3,3)]]),
 '9': (4, [[(0,5),(1,6),(3,6),(4,5),(4,1),(3,0),(1,0),(0,1),(0,2),(1,3),(4,3)]]),
 '?': (4, [[(0,1),(1,0),(3,0),(4,1),(4,2),(2,3.3),(2,4.2)], [(2,5.9),(2,6)]]),
 '!': (0, [[(0,0),(0,3.8)], [(0,5.9),(0,6)]]),
 ' ': (2, []),
}
ACCENT = [(1.5, -1.3), (3.0, -2.3)]
GAP = 1.9

def largeur(txt, s):
    total = 0
    for ch in txt:
        base = ch.replace('É', 'E')
        total += (G[base][0] + GAP) * s
    return total - GAP * s

def lettrer(txt, cx, ytop, h, left=None):
    """Chemin (M/L) d'un lettrage centré sur cx (ou calé à gauche en `left`), haut des capitales à ytop."""
    s = h / 6
    x = left if left is not None else cx - largeur(txt, s) / 2
    d = []
    for ch in txt:
        base = ch.replace('É', 'E')
        w, strokes = G[base]
        for line in strokes:
            d.append('M' + ' L'.join(f"{n(x + px * s)},{n(ytop + py * s)}" for px, py in line))
        if ch == 'É':
            d.append('M' + ' L'.join(f"{n(x + px * s)},{n(ytop + py * s)}" for px, py in ACCENT))
        x += (w + GAP) * s
    return ''.join(d)

def texte(txt, cx, ytop, h, sw=None, left=None, op=None):
    s = h / 6
    return strokep(lettrer(txt, cx, ytop, h, left), sw if sw else 1.05 * s, op)
