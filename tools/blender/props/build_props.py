"""Builds every environment prop GLB for Last Lantern ("moonlit storybook" style).

Run:  /home/user/blender-venv/bin/python tools/blender/props/build_props.py [name ...]
Out:  public/models/props/<name>.glb   (names = MODEL_LIST.props in src/render/Assets.ts)

Style rules: chunky rounded silhouettes, smooth shading (chamfered + sharp-edged only for cut stone and
crystals), colour baked into vertex colours with a fake-AO darkening toward the ground and a cool moonlit
highlight toward the top. Glow parts ("glow" material) are authored near-white so the engine tints them
per biome. Budgets: instanced props < 1.5k tris, trees < 3k.
"""
import math
import os
import random
import sys

import bpy  # noqa: F401  (must be imported before bmesh)
import bmesh
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import (TAU, Builder, box, chisel, colorize, disc, displace, flatten_bottom, gradient_z, hexc,  # noqa: E402
                 ico, lathe, mark_sharp, mix, moss_fn, mul, n3, smooth, solid, tube, xform)

# ---------------------------------------------------------------- palette (sRGB hex -> linear)
BARK_D, BARK_L = hexc(0x2e1d2a), hexc(0x7b5444)
DEAD_D, DEAD_L = hexc(0x3a3048), hexc(0x8a7a9a)
PINE_D, PINE_M, PINE_L = hexc(0x0f3438), hexc(0x1d6b58), hexc(0x6fd39a)
OAK_D, OAK_M, OAK_L = hexc(0x15404a), hexc(0x2f8a62), hexc(0x9be08a)
MOSS = hexc(0x5aa85a)
MOSS_RUIN = hexc(0x6f9a86)  # muted sage-teal moss for cut stone (ruins read as old, not slimy)
STONE_D, STONE, STONE_L = hexc(0x3c3f58), hexc(0x6f7896), hexc(0x9aa4c0)
RUIN_D, RUIN, RUIN_L = hexc(0x4a4458), hexc(0x9a90a8), hexc(0xc8bccc)
CREAM = hexc(0xf0e2cc)
GREEN_D, GREEN_L = hexc(0x1f5a3c), hexc(0x7cc870)
WHITE = (1.0, 1.0, 1.0)


def foliage_fn(z0, z1, dark, mid, light, under=0.75, seed=0.0):
    """Puffy foliage: light from above, dark underside, noisy colour breakup, brighter at the top."""
    def fn(co, n):
        t = smooth(z0, z1, co.z)
        up = max(0.0, n.z)
        k = 0.15 + t * 0.55 + up * 0.35 + n3(co, 1.6, seed) * 0.12
        c = mix(mid, light, max(0.0, min(1.0, k - 0.25)))
        if n.z < 0:
            c = mix(c, dark, min(1.0, -n.z * 1.4) * under)
        c = mix(dark, c, 0.35 + 0.65 * smooth(z0 - 0.6, z0 + 0.6, co.z))
        return c
    return fn


def blob_ao(fn, blobs, idx, strength=0.55):
    """Darkens foliage where a blob dips into its neighbours (contact AO between canopy clumps)."""
    others = [(Vector(c), r) for j, (c, r) in enumerate(blobs) if j != idx]

    def wrapped(co, n):
        occ = 0.0
        for c, r in others:
            d = (co - c).length - r
            occ += 1.0 - smooth(-0.05 * r, 0.45 * r, d)
        k = 1.0 - strength * min(1.0, occ)
        return mul(fn(co, n), k)
    return wrapped


def bark_fn(z0, z1, dark=BARK_D, light=BARK_L, seed=0.0):
    def fn(co, n):
        c = mix(dark, light, smooth(z0, z1, co.z) * 0.8 + 0.2 * (0.5 + 0.5 * n3(co, 4.0, seed)))
        return mul(c, 0.55 + 0.45 * smooth(0.0, 0.6, co.z))
    return fn


# ---------------------------------------------------------------- trees
def pine():
    B = Builder()
    rnd = random.Random(7)
    t = tube([(0, 0, -0.1), (0, 0, 0.9), (0.02, 0, 1.9), (0, 0, 3.4)], [0.34, 0.25, 0.2, 0.12], segs=9,
             cap_top=False)
    colorize(t, bark_fn(0, 1.6))
    B.add('body', t)
    for a in range(4):  # root flares
        ang = a * TAU / 4 + 0.4
        d = Vector((math.cos(ang), math.sin(ang), 0))
        r = tube([d * 0.05 + Vector((0, 0, 0.5)), d * 0.35 + Vector((0, 0, 0.12)), d * 0.62 + Vector((0, 0, -0.05))],
                 [0.14, 0.1, 0.05], segs=6)
        colorize(r, bark_fn(0, 1.6))
        B.add('body', r)
    tiers = [(1.85, 1.05, 1.75), (1.5, 1.95, 1.55), (1.15, 2.8, 1.35), (0.78, 3.6, 1.15), (0.42, 4.35, 0.85)]
    for i, (R, z, h) in enumerate(tiers):
        prof = [(0, h), (R * 0.3, h * 0.78), (R * 0.68, h * 0.38), (R * 0.95, h * 0.06), (R, -0.05),
                (R * 0.9, -0.2), (R * 0.55, -0.14), (0, 0.04)]
        k = 6 + i
        ph = rnd.uniform(0, TAU)
        bm = lathe(prof, segs=22 if i < 3 else 16, rim=lambda a, j, k=k, ph=ph: 1 + (0.1 if j >= 3 else 0.03) * math.sin(a * k + ph))
        # scalloped droop: rim peaks hang lower
        for v in bm.verts:
            rr = math.hypot(v.co.x, v.co.y)
            if rr > R * 0.6:
                a = math.atan2(v.co.y, v.co.x)
                v.co.z -= 0.16 * (rr / R) * (0.5 + 0.5 * math.sin(a * k + ph))
        xform(bm, loc=(rnd.uniform(-0.04, 0.04), rnd.uniform(-0.04, 0.04), z),
              rot=(rnd.uniform(-0.06, 0.06), rnd.uniform(-0.06, 0.06), 0))
        colorize(bm, foliage_fn(1.0, 5.2, PINE_D, PINE_M, PINE_L, seed=i))
        B.add('body', bm)
    B.export('pine')


def oak():
    B = Builder()
    trunk = tube([(0, 0, -0.1), (0.05, 0, 1.0), (0.18, 0.06, 2.0), (0.2, 0.05, 2.9)], [0.4, 0.28, 0.24, 0.18],
                 segs=9, cap_top=False)
    colorize(trunk, bark_fn(0, 2.2, seed=1))
    B.add('body', trunk)
    for a, ln in ((0.3, 1.0), (2.4, 0.9), (4.3, 0.85)):
        d = Vector((math.cos(a), math.sin(a), 0))
        br = tube([Vector((0.15, 0.05, 1.8)), Vector((0.15, 0.05, 2.2)) + d * ln * 0.5, Vector((0.15, 0.05, 2.7)) + d * ln],
                  [0.13, 0.09, 0.05], segs=6)
        colorize(br, bark_fn(0, 2.2, seed=2))
        B.add('body', br)
    for a in range(5):
        ang = a * TAU / 5 + 0.2
        d = Vector((math.cos(ang), math.sin(ang), 0))
        r = tube([d * 0.1 + Vector((0, 0, 0.55)), d * 0.45 + Vector((0, 0, 0.12)), d * 0.8 + Vector((0, 0, -0.06))],
                 [0.17, 0.11, 0.05], segs=6)
        colorize(r, bark_fn(0, 2.2))
        B.add('body', r)
    blobs = [((0.15, 0.0, 3.5), 1.55, 3), ((-1.0, 0.35, 3.05), 1.08, 3), ((1.1, -0.25, 3.1), 1.1, 3),
             ((0.25, 1.05, 3.0), 1.0, 3), ((0.0, -1.0, 3.05), 1.02, 3), ((0.35, 0.15, 4.45), 1.0, 2),
             ((-0.6, -0.45, 4.1), 0.85, 2), ((0.9, 0.7, 3.9), 0.78, 2)]
    simple = [(c, r) for c, r, _ in blobs]
    for i, (c, r, sd) in enumerate(blobs):
        bm = ico(r, sd + 0)
        displace(bm, amp=0.13 * r, freq=1.4 / r, seed=i)
        xform(bm, loc=c, scale=(1, 1, 0.88))
        colorize(bm, blob_ao(foliage_fn(2.2, 5.3, OAK_D, OAK_M, OAK_L, seed=i * 0.7), simple, i))
        B.add('body', bm)
    B.export('oak')


def deadtree():
    B = Builder()
    rnd = random.Random(11)

    def branch(p0, d, length, r0, depth):
        pts, rad = [], []
        p = Vector(p0)
        n = 4
        for i in range(n + 1):
            pts.append(p.copy())
            rad.append(r0 * (1 - i / (n + 0.6)))
            d = (d + Vector((rnd.uniform(-0.35, 0.35), rnd.uniform(-0.35, 0.35), rnd.uniform(-0.1, 0.25)))).normalized()
            p += d * (length / n)
        bm = tube(pts, rad, segs=6 if depth else 8)
        colorize(bm, bark_fn(0, 3.0, DEAD_D, DEAD_L, seed=depth))
        B.add('body', bm)
        if depth < 2:
            for k in range(2 if depth == 0 else 1):
                t = rnd.uniform(0.45, 0.8)
                idx = int(t * n)
                ang = rnd.uniform(0, TAU)
                nd = (d * 0.5 + Vector((math.cos(ang), math.sin(ang), 0.55))).normalized()
                branch(pts[idx], nd, length * 0.55, rad[idx] * 0.75, depth + 1)

    trunk_pts = [Vector((0, 0, -0.1)), Vector((0.1, 0.05, 0.9)), Vector((-0.05, 0.1, 1.8)), Vector((0.15, -0.05, 2.6))]
    bm = tube(trunk_pts, [0.36, 0.26, 0.2, 0.13], segs=8, cap_top=False)
    colorize(bm, bark_fn(0, 3.0, DEAD_D, DEAD_L))
    B.add('body', bm)
    for ang, ln in ((0.3, 1.5), (2.3, 1.3), (4.2, 1.2)):
        d = Vector((math.cos(ang), math.sin(ang), 0.9)).normalized()
        branch(trunk_pts[-1] - Vector((0, 0, 0.2 + rnd.random() * 0.5)), d, ln, 0.13, 1)
    branch(trunk_pts[-1], Vector((0, 0.1, 1)).normalized(), 1.1, 0.12, 1)
    for a in range(4):
        ang = a * TAU / 4 + 0.7
        d = Vector((math.cos(ang), math.sin(ang), 0))
        r = tube([d * 0.1 + Vector((0, 0, 0.45)), d * 0.5 + Vector((0, 0, 0.1)), d * 0.9 + Vector((0, 0, -0.05))],
                 [0.15, 0.09, 0.04], segs=6)
        colorize(r, bark_fn(0, 3.0, DEAD_D, DEAD_L))
        B.add('body', r)
    B.export('deadtree')


def bush():
    B = Builder()
    rnd = random.Random(5)
    blobs = [((0, 0, 0.45), 0.62), ((0.5, 0.2, 0.35), 0.45), ((-0.45, 0.25, 0.33), 0.43), ((0.1, -0.45, 0.33), 0.42),
             ((-0.1, 0.1, 0.8), 0.42)]
    for i, (c, r) in enumerate(blobs):
        bm = ico(r, 3 if i == 0 else 2)
        displace(bm, amp=0.08, freq=3.0, seed=i + 3)
        xform(bm, loc=c, scale=(1, 1, 0.85))
        colorize(bm, blob_ao(foliage_fn(0.0, 1.1, OAK_D, OAK_M, OAK_L, seed=i), blobs, i))
        B.add('body', bm)
    for i in range(7):  # glowing berries
        a = rnd.uniform(0, TAU)
        z = rnd.uniform(0.35, 0.95)
        rr = 0.62 * math.sqrt(max(0.05, 1 - ((z - 0.45) / 0.65) ** 2)) + 0.02
        b = ico(0.07, 2)
        xform(b, loc=(math.cos(a) * rr, math.sin(a) * rr, z))
        colorize(b, solid(WHITE))
        B.add('glow', b)
    B.export('bush')


def stump():
    B = Builder()
    t = tube([(0, 0, -0.05), (0, 0, 0.35), (0.02, 0, 0.62)], [0.5, 0.44, 0.42], segs=12, cap_top=False)
    colorize(t, bark_fn(0, 0.7))
    B.add('body', t)
    # top with growth rings + a jagged broken lip
    prof = [(0, 0.66), (0.12, 0.66), (0.24, 0.66), (0.33, 0.655), (0.4, 0.64), (0.43, 0.62)]
    top = lathe(prof + [(0.42, 0.6), (0, 0.6)], segs=12)
    rings = hexc(0xd8b080)
    rings_d = hexc(0x9a6a48)

    def ring_fn(co, n):
        rr = math.hypot(co.x, co.y)
        if rr > 0.41:
            return BARK_L
        return mix(rings_d, rings, 0.5 + 0.5 * math.cos(rr * 55))
    colorize(top, ring_fn)
    B.add('body', top)
    for a in range(5):
        ang = a * TAU / 5
        d = Vector((math.cos(ang), math.sin(ang), 0))
        r = tube([d * 0.25 + Vector((0, 0, 0.3)), d * 0.6 + Vector((0, 0, 0.08)), d * 0.85 + Vector((0, 0, -0.05))],
                 [0.17, 0.1, 0.04], segs=6)
        colorize(r, bark_fn(0, 0.7))
        B.add('body', r)
    _mushroom(B, (0.45, 0.12, 0.28), 0.1, lean=(0.4, 0.1), stem_h=0.12)
    _mushroom(B, (0.47, -0.08, 0.2), 0.07, lean=(0.5, -0.1), stem_h=0.08)
    B.export('stump')


def log():
    B = Builder()
    L = 2.6
    pts = [(-L / 2, 0, 0.32), (-L / 6, 0.03, 0.33), (L / 6, -0.02, 0.32), (L / 2, 0, 0.3)]
    t = tube(pts, [0.34, 0.33, 0.32, 0.3], segs=12, cap_top=False)

    def log_fn(co, n):
        c = mix(BARK_D, BARK_L, 0.45 + 0.35 * n.z + 0.15 * n3(co, 3.0))
        c = mix(c, MOSS, smooth(0.55, 0.8, n.z + n3(co, 2.0, 4) * 0.3))
        return mul(c, 0.6 + 0.4 * smooth(0.0, 0.4, co.z))
    colorize(t, log_fn)
    B.add('body', t)
    ring_c, ring_d = hexc(0xd8b080), hexc(0x9a6a48)
    for sx, r in ((-1, 0.34), (1, 0.3)):
        prof = [(0, 0.0), (r * 0.3, 0), (r * 0.6, 0), (r * 0.85, 0), (r * 1.0, -0.02)]
        cap = lathe(prof + [(0, -0.05)], segs=12)
        xform(cap, loc=(sx * L / 2, 0, 0.32 if sx < 0 else 0.3), rot=(0, sx * math.pi / 2, 0))
        colorize(cap, lambda co, n: mix(ring_d, ring_c, 0.5 + 0.5 * math.cos(math.hypot(co.y, co.z - 0.31) * 50)))
        B.add('body', cap)
    st = tube([(0.3, 0.2, 0.5), (0.45, 0.45, 0.75)], [0.09, 0.06], segs=6)
    colorize(st, bark_fn(0, 1.0))
    B.add('body', st)
    B.export('log')


# ---------------------------------------------------------------- stone
def rock():
    B = Builder()
    for i, (loc, s, sc) in enumerate((((0, 0, 0), 0.75, (1.2, 1.0, 0.75)), ((0.85, 0.35, 0), 0.38, (1, 1, 0.8)),
                                       ((-0.55, -0.6, 0), 0.28, (1, 1, 0.75)))):
        bm = ico(1.0, 3)
        chisel(bm, cuts=7, depth=0.82, seed=i + 2)
        displace(bm, amp=0.05, freq=2.0, seed=i)
        xform(bm, scale=(s * sc[0], s * sc[1], s * sc[2]))
        xform(bm, loc=(loc[0], loc[1], s * sc[2] * 0.55))
        flatten_bottom(bm, -0.05)
        mark_sharp(bm, 38)
        colorize(bm, moss_fn(STONE, MOSS, thresh=0.5, seed=i, dark=STONE_D, z0=0.0, z1=0.7))
        B.add('body', bm)
    B.export('rock')


def grave():
    B = Builder()
    outline = []
    w, h = 0.36, 0.72
    outline.append((-w, 0.0))
    outline.append((w, 0.0))
    for i in range(9):
        a = math.pi * i / 8
        outline.append((math.cos(a) * w, h + math.sin(a) * w * 0.85))
    bm = extrude(outline, 0.18)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.035, segments=2, profile=0.5, affect='EDGES', clamp_overlap=True)
    xform(bm, loc=(0, 0, 0.08), rot=(0.06, 0.05, 0))
    mark_sharp(bm, 35)
    colorize(bm, moss_fn(RUIN, MOSS_RUIN, thresh=0.6, seed=2, dark=RUIN_D, z0=0.0, z1=0.9), smooth_shade=True)
    B.add('body', bm)
    # carved cross relief
    for sx, sz, z in ((0.07, 0.36, 0.72), (0.26, 0.07, 0.8)):
        c = box(sx, 0.05, sz, bevel=0.012)
        xform(c, loc=(0, -0.105, z), rot=(0.06, 0.05, 0))
        mark_sharp(c, 35)
        colorize(c, solid(RUIN_L))
        B.add('body', c)
    base = box(0.95, 0.5, 0.14, bevel=0.03)
    xform(base, loc=(0, 0, 0.05))
    mark_sharp(base, 35)
    colorize(base, moss_fn(RUIN, MOSS_RUIN, thresh=0.7, seed=5, dark=RUIN_D, z0=0, z1=0.15))
    B.add('body', base)
    B.export('grave')


def extrude(outline, depth):
    bm = bmesh.new()
    f, b = [], []
    for x, z in outline:
        f.append(bm.verts.new((x, -depth / 2, z)))
        b.append(bm.verts.new((x, depth / 2, z)))
    n = len(outline)
    bm.faces.new(f)
    bm.faces.new(list(reversed(b)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((f[i], f[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def pillar():
    B = Builder()
    rnd = random.Random(3)
    base = box(1.15, 1.15, 0.32, bevel=0.05)
    xform(base, loc=(0, 0, 0.16))
    mark_sharp(base, 35)
    colorize(base, moss_fn(RUIN, MOSS_RUIN, thresh=0.7, seed=1, dark=RUIN_D, z0=0, z1=0.35))
    B.add('body', base)
    plinth = lathe([(0, 0.52), (0.44, 0.52), (0.5, 0.46), (0.5, 0.36), (0.46, 0.32), (0, 0.32)], segs=20)
    colorize(plinth, solid(RUIN))
    B.add('body', plinth)
    top = 2.7
    prof = [(0, top), (0.3, top), (0.36, top - 0.05), (0.37, 2.0), (0.4, 1.0), (0.42, 0.52), (0, 0.52)]
    col = lathe(prof, segs=24, rim=lambda a, j: 1 - 0.07 * max(0.0, math.cos(a * 10)) if 2 <= j <= 5 else 1.0)
    for v in col.verts:  # broken jagged top
        if v.co.z > top - 0.1:
            a = math.atan2(v.co.y, v.co.x)
            v.co.z -= 0.45 * (0.5 + 0.5 * math.sin(a * 3 + 1)) + 0.15 * abs(math.sin(a * 7))
    mark_sharp(col, 50)

    def col_fn(co, n):
        c = mix(RUIN_D, RUIN, smooth(0.4, 1.4, co.z))
        c = mix(c, RUIN_L, max(0.0, n3(co, 2.5, 3)) * 0.5)
        return mix(c, MOSS_RUIN, smooth(0.55, 0.75, n.z + n3(co, 3, 1) * 0.3) * smooth(1.6, 2.3, co.z))
    colorize(col, col_fn)
    B.add('body', col)
    chunk = lathe([(0, 0.3), (0.33, 0.3), (0.36, 0.0), (0, 0.0)], segs=14,
                  rim=lambda a, j: 1 - 0.07 * max(0.0, math.cos(a * 10)))
    for v in chunk.verts:
        if v.co.z > 0.2:
            v.co.z += 0.12 * math.sin(math.atan2(v.co.y, v.co.x) * 2)
    xform(chunk, loc=(0.95, 0.35, 0.33), rot=(math.pi / 2 - 0.1, 0.2, 0.7))
    mark_sharp(chunk, 50)
    colorize(chunk, moss_fn(RUIN, MOSS_RUIN, thresh=0.6, seed=4, dark=RUIN_D, z0=0, z1=0.6))
    B.add('body', chunk)
    B.export('pillar')


def ruin_wall():
    B = Builder()
    rnd = random.Random(21)
    L, rows, rh = 3.4, 6, 0.38
    for r in range(rows):
        z = r * rh
        # broken profile: wall height falls off toward one end
        x = -L / 2 + (0.0 if r % 2 == 0 else -0.25)
        while x < L / 2:
            bl = rnd.uniform(0.5, 0.85)
            x1 = min(L / 2, x + bl)
            cx = (x + x1) / 2
            u = (cx + L / 2) / L
            limit = rows * (0.35 + 0.65 * (1 - u) ** 0.7) + rnd.uniform(-0.8, 0.6)
            if r < limit and x1 - x > 0.15:
                b = box(x1 - x - 0.04, 0.5 + rnd.uniform(-0.03, 0.03), rh - 0.04, bevel=0.05)
                xform(b, loc=(cx, rnd.uniform(-0.03, 0.03), z + rh / 2), rot=(0, 0, rnd.uniform(-0.03, 0.03)))
                mark_sharp(b, 35)
                tone = rnd.uniform(0.0, 1.0)
                base = mix(RUIN, RUIN_L, tone * 0.5)
                colorize(b, moss_fn(base, MOSS_RUIN, thresh=0.62, seed=rnd.random() * 10, dark=RUIN_D, z0=0, z1=1.2))
                B.add('body', b)
            x = x1
    for i in range(4):  # fallen blocks
        b = box(rnd.uniform(0.4, 0.6), 0.45, 0.32, bevel=0.05)
        xform(b, loc=(rnd.uniform(0.3, 1.6), rnd.uniform(0.5, 0.9) * (1 if i % 2 else -1), 0.14),
              rot=(rnd.uniform(-0.2, 0.2), rnd.uniform(-0.15, 0.15), rnd.uniform(0, 3)))
        mark_sharp(b, 35)
        colorize(b, moss_fn(RUIN, MOSS_RUIN, thresh=0.6, seed=i, dark=RUIN_D, z0=0, z1=0.4))
        B.add('body', b)
    B.export('ruin_wall')


def crystal():
    B = Builder()
    rnd = random.Random(9)
    base = ico(0.55, 2)
    chisel(base, cuts=6, depth=0.8, seed=3)
    xform(base, loc=(0, 0, 0.12), scale=(1.1, 1.0, 0.55))
    flatten_bottom(base, 0)
    mark_sharp(base, 38)
    colorize(base, moss_fn(STONE, MOSS, thresh=0.75, seed=1, dark=STONE_D, z0=0, z1=0.4))
    B.add('body', base)
    specs = [(0, 0, 1.25, 0.2, 0.0, 0.0), (0.28, 0.1, 0.8, 0.14, 0.5, 0.1), (-0.25, 0.15, 0.7, 0.13, -0.45, 1.0),
             (0.05, -0.28, 0.6, 0.12, 0.2, -0.5), (-0.1, 0.3, 0.45, 0.09, -0.2, 0.6)]
    for x, y, h, r, lx, ly in specs:
        d = Vector((lx * 0.6, ly * 0.6, 1)).normalized()
        p0 = Vector((x, y, 0.05))
        bm = tube([p0, p0 + d * h * 0.75], [r, r * 0.92], segs=6, cap_top=True, top_round=2.2)
        mark_sharp(bm, 25)

        def cfn(co, n, p0=p0, h=h):
            t = smooth(0.0, h * 1.1, (co - p0).length)
            return mix((0.35, 0.35, 0.4), (1.0, 1.0, 1.0), t * 0.85 + 0.15 * max(0.0, n.z))
        colorize(bm, cfn)
        B.add('glow', bm)
    B.export('crystal')


# ---------------------------------------------------------------- small flora
def _mushroom(B, pos, r, lean=(0.0, 0.0), stem_h=None):
    pos = Vector(pos)
    sh = stem_h if stem_h is not None else r * 1.6
    top = pos + Vector((lean[0] * sh, lean[1] * sh, sh))
    st = tube([pos - Vector((0, 0, 0.05)), pos + Vector((lean[0] * sh * 0.3, lean[1] * sh * 0.3, sh * 0.5)), top],
              [r * 0.32, r * 0.26, r * 0.24], segs=7, cap_top=False)
    colorize(st, lambda co, n: mul(CREAM, 0.65 + 0.35 * smooth(pos.z, top.z, co.z)))
    B.add('body', st)
    prof = [(0, r * 0.75), (r * 0.5, r * 0.66), (r * 0.85, r * 0.42), (r * 1.02, r * 0.12), (r * 0.98, 0.0),
            (r * 0.55, r * 0.05), (0, r * 0.12)]
    cap = lathe(prof, segs=14, rim=lambda a, j: 1 + (0.05 * math.sin(a * 5) if j >= 3 else 0))
    xform(cap, loc=top - Vector((0, 0, r * 0.05)), rot=(-lean[1] * 0.6, lean[0] * 0.6, 0))
    colorize(cap, lambda co, n: mix((0.3, 0.3, 0.3), (0.72, 0.72, 0.72), smooth(-0.3, 0.9, n.z)))
    B.add('glow', cap)
    # cream spots
    rnd = random.Random(int(r * 1000))
    for i in range(4):
        a = rnd.uniform(0, TAU)
        e = rnd.uniform(0.35, 0.8)
        sp = ico(r * 0.13, 1)
        p = top + Vector((math.cos(a) * math.sin(e) * r * 0.82, math.sin(a) * math.sin(e) * r * 0.82,
                          math.cos(e) * r * 0.62))
        xform(sp, loc=p, scale=(1, 1, 0.45))
        colorize(sp, solid(CREAM))
        B.add('body', sp)


def mushroom():
    B = Builder()
    _mushroom(B, (0, 0, 0), 0.3, lean=(0.05, 0.0))
    _mushroom(B, (0.32, 0.18, 0), 0.2, lean=(0.35, 0.15))
    _mushroom(B, (-0.22, 0.25, 0), 0.15, lean=(-0.3, 0.3))
    _mushroom(B, (0.1, -0.3, 0), 0.11, lean=(0.1, -0.4))
    B.export('mushroom')


def reed():
    B = Builder()
    rnd = random.Random(4)
    for i in range(11):
        a = rnd.uniform(0, TAU)
        rr = rnd.uniform(0.0, 0.3)
        p0 = Vector((math.cos(a) * rr, math.sin(a) * rr, -0.02))
        h = rnd.uniform(0.8, 1.45)
        lean = Vector((math.cos(a), math.sin(a), 0)) * rnd.uniform(0.15, 0.45)
        pts = [p0 + lean * (t * t) + Vector((0, 0, h * t)) for t in (0, 0.35, 0.7, 1.0)]
        bm = tube(pts, [0.035, 0.03, 0.02, 0.004], segs=4, cap_top=False)
        xform(bm, scale=(1, 1, 1))
        colorize(bm, gradient_z(GREEN_D, GREEN_L, 0.0, 1.3, ao=0.4))
        B.add('body', bm)
    for i in range(3):
        a = i * 2.1 + 0.3
        p0 = Vector((math.cos(a) * 0.12, math.sin(a) * 0.12, -0.02))
        h = 1.25 + i * 0.12
        lean = Vector((math.cos(a), math.sin(a), 0)) * 0.12
        stem = tube([p0, p0 + lean * 0.5 + Vector((0, 0, h * 0.6)), p0 + lean + Vector((0, 0, h + 0.25))],
                    [0.022, 0.018, 0.01], segs=5)
        colorize(stem, gradient_z(GREEN_D, GREEN_L, 0.0, 1.3, ao=0.4))
        B.add('body', stem)
        head = tube([p0 + lean * 0.85 + Vector((0, 0, h * 0.82)), p0 + lean * 0.95 + Vector((0, 0, h))],
                    [0.06, 0.055], segs=8, cap_bottom=True, top_round=0.8)
        colorize(head, lambda co, n: mix(hexc(0x4a2a24), hexc(0x9a6448), 0.4 + 0.6 * max(0.0, n.z)))
        B.add('body', head)
    B.export('reed')


def _petal_flower(B, pos, size, petals=5, tilt=0.0, layers=1, glow_petals=True, bright=1.0):
    """Petals are glow (bioluminescent, e.g. lilies) or lit body with a small glowing heart (field flowers)."""
    pos = Vector(pos)
    for L in range(layers):
        for i in range(petals):
            a = TAU * i / petals + L * (math.pi / petals)
            p = ico(1.0, 1)
            xform(p, scale=(size * 0.62, size * 0.32, size * 0.09))
            xform(p, loc=(size * 0.55 * (1 - 0.25 * L), 0, size * 0.1 * (L + 1)), rot=(0, -0.35 - 0.35 * L, 0))
            xform(p, rot=(tilt, 0, a))
            xform(p, loc=pos)
            colorize(p, lambda co, n: mul(mix((0.5, 0.5, 0.55), WHITE, smooth(0.0, size * 0.9, (co - pos).length)), bright))
            B.add('glow' if glow_petals else 'body', p)
    c = ico(size * 0.22, 1)
    xform(c, loc=pos + Vector((0, 0, size * 0.12)))
    if glow_petals:
        colorize(c, solid(hexc(0xffd36a)))
        B.add('body', c)
    else:
        colorize(c, solid((0.9, 0.9, 0.9)))
        B.add('glow', c)


def flower():
    B = Builder()
    rnd = random.Random(8)
    for i in range(5):
        a = i * TAU / 5 + rnd.uniform(-0.3, 0.3)
        rr = 0.05 if i == 0 else rnd.uniform(0.15, 0.3)
        p0 = Vector((math.cos(a) * rr, math.sin(a) * rr, 0))
        h = rnd.uniform(0.28, 0.5)
        lean = Vector((math.cos(a), math.sin(a), 0)) * 0.1
        top = p0 + lean + Vector((0, 0, h))
        st = tube([p0, p0 + lean * 0.3 + Vector((0, 0, h * 0.5)), top], [0.018, 0.014, 0.012], segs=4, cap_top=False)
        colorize(st, gradient_z(GREEN_D, GREEN_L, 0, 0.5))
        B.add('body', st)
        _petal_flower(B, top, rnd.uniform(0.11, 0.15), petals=5, tilt=0.15, glow_petals=False)
    for i in range(4):  # leaves
        a = i * TAU / 4 + 0.4
        lf = ico(1.0, 1)
        xform(lf, scale=(0.16, 0.06, 0.02))
        xform(lf, loc=(0.14, 0, 0.04), rot=(0, -0.4, a))
        colorize(lf, solid(mix(GREEN_D, GREEN_L, 0.55)))
        B.add('body', lf)
    B.export('flower')


def lily():
    B = Builder()
    rnd = random.Random(12)
    pads = [(0, 0, 0.5), (0.75, 0.3, 0.38), (-0.6, 0.45, 0.33), (0.15, -0.7, 0.42), (-0.55, -0.45, 0.26)]
    pad_d, pad_l = hexc(0x1d5a48), hexc(0x6cc488)
    for i, (x, y, r) in enumerate(pads):
        d = disc(r, segs=14, notch=0.45, thickness=0.035)
        xform(d, loc=(x, y, 0.02), rot=(rnd.uniform(-0.04, 0.04), rnd.uniform(-0.04, 0.04), rnd.uniform(0, TAU)))
        colorize(d, lambda co, n, x=x, y=y, r=r: mix(pad_d, pad_l, 0.35 + 0.5 * smooth(0, r, math.hypot(co.x - x, co.y - y))
                                                   + 0.15 * n3(co, 6.0)))
        B.add('body', d)
    _petal_flower(B, (0.05, 0.02, 0.07), 0.22, petals=6, layers=2, bright=0.6)
    _petal_flower(B, (-0.58, 0.45, 0.05), 0.13, petals=5, layers=1, bright=0.6)
    B.export('lily')


def lantern_post():
    B = Builder()
    wood_d, wood_l = hexc(0x3a2620), hexc(0x8a5a3e)
    iron = hexc(0x2c2a3a)
    post = box(0.18, 0.18, 2.5, bevel=0.03)
    xform(post, loc=(0, 0, 1.2), rot=(0.02, -0.02, 0))
    mark_sharp(post, 35)
    colorize(post, lambda co, n: mul(mix(wood_d, wood_l, 0.5 + 0.3 * n3(co, 5.0) + 0.2 * smooth(0, 2.4, co.z)),
                                     0.6 + 0.4 * smooth(0, 0.6, co.z)))
    B.add('body', post)
    arm = box(0.75, 0.12, 0.12, bevel=0.025)
    xform(arm, loc=(0.3, 0, 2.25))
    mark_sharp(arm, 35)
    colorize(arm, solid(mix(wood_d, wood_l, 0.6)))
    B.add('body', arm)
    brace = box(0.5, 0.08, 0.08, bevel=0.02)
    xform(brace, loc=(0.16, 0, 2.05), rot=(0, 0.75, 0))
    colorize(brace, solid(mix(wood_d, wood_l, 0.5)))
    B.add('body', brace)
    for z, r in ((0.02, 0.4), (0.12, 0.28)):
        s = ico(1.0, 2)
        chisel(s, cuts=5, depth=0.8, seed=int(z * 100))
        xform(s, loc=(0.0, 0.0, z), scale=(r, r * 0.9, r * 0.35))
        mark_sharp(s, 38)
        colorize(s, moss_fn(STONE, MOSS, thresh=0.6, seed=2, dark=STONE_D, z0=-0.1, z1=0.2))
        B.add('body', s)
    lx, lz = 0.58, 1.72
    chain = tube([(lx, 0, 2.2), (lx, 0, 2.02)], [0.015, 0.015], segs=4)
    colorize(chain, solid(iron))
    B.add('body', chain)
    roof = lathe([(0, 0.24), (0.06, 0.2), (0.2, 0.06), (0.21, 0.0), (0, 0.0)], segs=8)
    xform(roof, loc=(lx, 0, lz + 0.26), rot=(0, 0, math.pi / 8))
    colorize(roof, solid(iron))
    B.add('body', roof)
    base = box(0.3, 0.3, 0.05, bevel=0.012)
    xform(base, loc=(lx, 0, lz - 0.02))
    colorize(base, solid(iron))
    B.add('body', base)
    for sx, sy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        bar = box(0.03, 0.03, 0.28)
        xform(bar, loc=(lx + sx * 0.12, sy * 0.12, lz + 0.13))
        colorize(bar, solid(iron))
        B.add('body', bar)
    glass = ico(1.0, 2)
    xform(glass, loc=(lx, 0, lz + 0.13), scale=(0.11, 0.11, 0.15))
    colorize(glass, lambda co, n: mix(hexc(0xffb050), hexc(0xfff0c0), smooth(lz, lz + 0.25, co.z)))
    B.add('glow', glass)
    B.export('lantern_post')


ALL = {
    'pine': pine, 'oak': oak, 'deadtree': deadtree, 'bush': bush, 'stump': stump, 'log': log,
    'rock': rock, 'grave': grave, 'pillar': pillar, 'ruin_wall': ruin_wall, 'crystal': crystal,
    'mushroom': mushroom, 'reed': reed, 'flower': flower, 'lily': lily, 'lantern_post': lantern_post,
}

if __name__ == '__main__':
    names = [a for a in sys.argv[1:] if a in ALL] or list(ALL)
    print(f'building {len(names)} props')
    for n in names:
        ALL[n]()
