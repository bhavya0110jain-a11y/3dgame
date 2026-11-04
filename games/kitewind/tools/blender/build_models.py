"""KITEWIND model builder (Blender 5.2 as a Python module).

    /home/user/blender-venv/bin/python tools/blender/build_models.py [id ...]

Writes GLBs + manifest.json into public/models/. All geometry is authored in three.js space (x, y up, z = flight
direction) and converted to Blender space (x, -z, y) on mesh creation; the glTF exporter converts back (+Y up).

Material contract (src/render/Models.ts):
  PAL        palette-driven prop surface. COLOR_0.r = shade * 0.8 (decoded x1.25), COLOR_0.g = palette slot / 7. The game swaps in
             the shared palette material, so islands/spires/arches recolour per biome and get the warm rim light.
  WATERFALL  animated water. COLOR_0 = (u across 0..1, v along 0..1, fall flag 0 river / 1 falling).
  KPAPER     kite paper/bamboo, COLOR_0 = linear albedo (painted pattern), lit + rim light, translucent glow.
  KGLOW      unlit glow (kite eyes), COLOR_0 = linear colour / 2 (decoded x2), HDR boosted.
  LGLOW      unlit glowing paper (lanterns), COLOR_0 = linear colour / 2 (decoded x2), HDR boosted.
Sizes follow the conventions in src/render/Models.ts and the collision ratios in src/world/islandShapes.ts.
"""
import math
import os
import random
import sys
import json

import bpy  # noqa: F401
from mathutils import Vector, noise

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', '..', 'public', 'models'))

# Must match src/world/islandShapes.ts
ISLAND_SHAPES = [
    dict(depth=1.5, clutter=0.3, trees=5, houses=0, lanterns=0, falls=1),
    dict(depth=1.9, clutter=0.34, trees=8, houses=0, lanterns=0, falls=2),
    dict(depth=1.2, clutter=0.12, trees=1, houses=0, lanterns=0, falls=0),
    dict(depth=1.6, clutter=0.3, trees=3, houses=1, lanterns=2, falls=1),
    dict(depth=1.8, clutter=0.34, trees=4, houses=3, lanterns=3, falls=1),
    dict(depth=2.2, clutter=0.5, trees=2, houses=1, lanterns=4, falls=0),
]
ROCK, ROCKD, GRASS, TRUNK, LEAVES, ROOF, WALL, GLOW = range(8)


def s2l(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexlin(h):
    return (s2l(((h >> 16) & 255) / 255), s2l(((h >> 8) & 255) / 255), s2l((h & 255) / 255))


def lerp3(a, b, t):
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def V(x, y, z):
    return Vector((x, y, z))


class MB:
    """Mesh builder in three.js space. Faces carry a material name and per-corner RGB colours."""

    def __init__(self):
        self.verts = []
        self.faces = []
        self.cols = []
        self.mats = []

    def face(self, pts, mat, col):
        """pts: list of Vectors (3 or 4); col: one rgb tuple or one per corner."""
        base = len(self.verts)
        self.verts.extend(pts)
        self.faces.append(tuple(range(base, base + len(pts))))
        if isinstance(col[0], (int, float)):
            col = [col] * len(pts)
        if mat in ('KGLOW', 'LGLOW'):  # glow colours are stored at half (normalized export), decoded x2
            col = [tuple(min(1.0, c * 0.5) for c in cc) for cc in col]
        self.cols.append(list(col))
        self.mats.append(mat)

    def pal(self, pts, part, shade):
        self.face(pts, 'PAL', (min(1.0, max(0.0, shade * 0.8)), part / 7.0, 0.0))  # decoded x1.25

    def add_prim(self, prim, xf, part, shade, rng=None, jitter=0.1):
        """prim: (verts, faces) unit primitive; xf: function Vector -> Vector."""
        vs, fs = prim
        tv = [xf(v.copy()) for v in vs]
        for f in fs:
            s = shade * (1 + (rng.uniform(-jitter, jitter) if rng else 0))
            self.pal([tv[i] for i in f], part, s)

    def to_object(self, name):
        me = bpy.data.meshes.new(name)
        bverts = [(v.x, -v.z, v.y) for v in self.verts]
        me.from_pydata(bverts, [], self.faces)
        names = []
        for m in self.mats:
            if m not in names:
                names.append(m)
        for n in names:
            mat = bpy.data.materials.get(n) or bpy.data.materials.new(n)
            me.materials.append(mat)
        attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        li = 0
        for pi, poly in enumerate(me.polygons):
            poly.material_index = names.index(self.mats[pi])
            poly.use_smooth = False
            for k in range(poly.loop_total):
                c = self.cols[pi][k]
                attr.data[poly.loop_start + k].color = (c[0], c[1], c[2], 1.0)
                li += 1
        me.color_attributes.active_color = attr
        try:
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
        except Exception:
            pass
        me.update()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


# ------------------------------------------------------------------------------------------- primitives (unit)

def prim_cyl(n, r0=1.0, r1=1.0, y0=0.0, y1=1.0, caps=True, phase=0.0):
    vs, fs = [], []
    for i in range(n):
        a = phase + i / n * math.tau
        vs.append(V(math.cos(a) * r0, y0, math.sin(a) * r0))
        vs.append(V(math.cos(a) * r1, y1, math.sin(a) * r1))
    for i in range(n):
        j = (i + 1) % n
        fs.append((i * 2, j * 2, j * 2 + 1, i * 2 + 1))
    if caps:
        if r1 > 1e-4:
            fs.append(tuple(i * 2 + 1 for i in range(n))[::-1])
        fs.append(tuple(i * 2 for i in range(n)))
    return vs, fs


def prim_cone(n, phase=0.0):
    vs = [V(math.cos(phase + i / n * math.tau), 0, math.sin(phase + i / n * math.tau)) for i in range(n)] + [V(0, 1, 0)]
    fs = [(i, n, (i + 1) % n) for i in range(n)] + [tuple(range(n))]
    return vs, fs


def prim_box():
    vs = [V(x, y, z) for x in (-0.5, 0.5) for y in (-0.5, 0.5) for z in (-0.5, 0.5)]
    fs = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return vs, fs


def prim_ico(sub=1):
    t = (1 + 5 ** 0.5) / 2
    vs = [V(-1, t, 0), V(1, t, 0), V(-1, -t, 0), V(1, -t, 0), V(0, -1, t), V(0, 1, t), V(0, -1, -t), V(0, 1, -t),
          V(t, 0, -1), V(t, 0, 1), V(-t, 0, -1), V(-t, 0, 1)]
    vs = [v.normalized() for v in vs]
    fs = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6),
          (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    for _ in range(sub):
        cache = {}
        nf = []

        def mid(a, b):
            k = (min(a, b), max(a, b))
            if k not in cache:
                cache[k] = len(vs)
                vs.append(((vs[a] + vs[b]) / 2).normalized())
            return cache[k]
        for a, b, c in fs:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            nf += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        fs = nf
    return vs, fs


def xf_trs(tx, ty, tz, sx, sy, sz, ry=0.0, rx=0.0, rz=0.0):
    cy, sy_ = math.cos(ry), math.sin(ry)
    cx, sx_ = math.cos(rx), math.sin(rx)
    cz, sz_ = math.cos(rz), math.sin(rz)

    def f(v):
        x, y, z = v.x * sx, v.y * sy, v.z * sz
        x, y = x * cz - y * sz_, x * sz_ + y * cz
        y, z = y * cx - z * sx_, y * sx_ + z * cx
        x, z = x * cy + z * sy_, -x * sy_ + z * cy
        return V(x + tx, y + ty, z + tz)
    return f


# ------------------------------------------------------------------------------------------------ islands

def build_island(variant):
    sh = ISLAND_SHAPES[variant]
    rng = random.Random(7100 + variant * 31)
    seed = V(variant * 13.1, 3.7, variant * 5.3)
    mb = MB()
    depth = sh['depth']
    C = sh['clutter']
    N = 22 + (variant % 3) * 2
    # rock body: terraced strata rings, radius profile tapering to a tip
    levels = [0.0, 0.035, 0.08, 0.14, 0.2, 0.27, 0.35, 0.43, 0.52, 0.61, 0.7, 0.79, 0.87, 0.94]
    wob = (rng.uniform(-0.18, 0.18), rng.uniform(-0.18, 0.18))
    rings = []
    for li, t in enumerate(levels):
        ring = []
        prof = 1.0 if li == 0 else (1 - t) ** 0.9 * 0.98
        ledge = 0.06 if li % 3 == 1 else (-0.03 if li % 3 == 2 else 0.0)
        for s in range(N):
            a = s / N * math.tau
            nz = noise.noise(V(math.cos(a) * 1.6, t * 3.0, math.sin(a) * 1.6) + seed)
            nz2 = noise.noise(V(math.cos(a) * 4.0, t * 7.0, math.sin(a) * 4.0) + seed * 2)
            r = prof * (1 + (nz * 0.22 + nz2 * 0.07 + ledge) * (0.3 if li == 0 else 1.0))
            r = max(r, 0.04)
            y = -t * depth + (rng.uniform(-0.015, 0.015) * depth if li > 0 else -0.015)
            ring.append(V(math.cos(a) * r + wob[0] * t, y, math.sin(a) * r + wob[1] * t))
        rings.append(ring)
    tip = V(wob[0] * 1.15, -depth, wob[1] * 1.15)
    for li in range(len(rings) - 1):
        A, B = rings[li], rings[li + 1]
        t0 = levels[li]
        part = ROCKD if (li % 4 == 2 or t0 > 0.74 or li == 0) else ROCK
        for s in range(N):
            s2 = (s + 1) % N
            t = levels[li]
            sun = 0.5 + 0.5 * math.cos(s / N * math.tau - 2.3)  # baked soft key from one side
            mott = noise.noise(V(math.cos(s / N * math.tau) * 3, t * 9, math.sin(s / N * math.tau) * 3) + seed * 4)
            shade = (1.1 - t * 0.5) * (0.86 + 0.18 * sun) * (1 + mott * 0.12) * rng.uniform(0.94, 1.04)
            if li % 3 == 1:
                shade *= 1.08  # ledge lips catch light
            mb.pal([A[s], A[s2], B[s2], B[s]], part, shade)
    last = rings[-1]
    for s in range(N):
        mb.pal([last[s], last[(s + 1) % N], tip], ROCKD, 0.42 * rng.uniform(0.9, 1.1))
    # hanging stalactites under the body
    for k in range(5 + variant % 3):
        a = rng.uniform(0, math.tau)
        rr = rng.uniform(0.25, 0.6)
        t = (1 - rr) ** 1.1 * 0.75
        y0 = -t * depth * rng.uniform(0.75, 0.95)
        ln = rng.uniform(0.25, 0.55) * depth
        w = rng.uniform(0.07, 0.13)
        mb.add_prim(prim_cone(5, rng.uniform(0, 2)), xf_trs(math.cos(a) * rr * 0.9, y0, math.sin(a) * rr * 0.9, w, -ln, w), ROCKD, 0.5, rng)

    # grass cap: dome + overhanging lip with drips
    top = rings[0]
    radii = [0.0, 0.3, 0.6, 0.85]
    caps = []
    for ri, rr in enumerate(radii):
        ring = []
        for s in range(N):
            a = s / N * math.tau
            p = top[s]
            bump = noise.noise(V(math.cos(a) * rr * 3, 0, math.sin(a) * rr * 3) + seed * 3) * 0.025
            ring.append(V(p.x * rr * 1.02, 0.045 * (1 - rr * rr) + bump * (1 if ri else 0) + 0.004, p.z * rr * 1.02))
        caps.append(ring)
    lip = [V(p.x * 1.045, 0.008, p.z * 1.045) for p in top]
    drip = []
    for s, p in enumerate(top):
        dd = rng.uniform(0.05, 0.16) if s % 2 == 0 else rng.uniform(0.02, 0.05)
        drip.append(V(p.x * 1.03, -dd, p.z * 1.03))
    caps.append(lip)
    gshade = lambda: rng.uniform(0.93, 1.08)
    for s in range(N):
        s2 = (s + 1) % N
        mb.pal([caps[0][s], caps[1][s2], caps[1][s]], GRASS, 1.1 * gshade())
        for ri in range(1, len(caps) - 1):
            mb.pal([caps[ri][s], caps[ri][s2], caps[ri + 1][s2], caps[ri + 1][s]], GRASS, (1.08 - ri * 0.04) * gshade())
        mb.pal([lip[s], lip[s2], drip[s2], drip[s]], GRASS, 0.82 * gshade())
        mb.pal([drip[s], drip[s2], top[s2], top[s]], GRASS, 0.62 * gshade())

    # ---- decoration placement
    spots = []

    def place(minr, maxr, clear, avoid=None):
        for _ in range(60):
            a = rng.uniform(0, math.tau)
            r = math.sqrt(rng.uniform(minr * minr, maxr * maxr))
            x, z = math.cos(a) * r, math.sin(a) * r
            if avoid and avoid(x, z):
                continue
            if all(math.hypot(sx - x, sz - z) > clear + sr for sx, sz, sr in spots):
                return x, z
        return None

    def ground_y(x, z):
        r = math.hypot(x, z)
        return 0.045 * (1 - min(1, r) ** 2) + 0.004

    # waterfalls: a stream from a spring to the rim, then a long fall past the rock
    falls = []
    for fi in range(sh['falls']):
        a = rng.uniform(0, math.tau) if fi == 0 else falls[0] + math.pi * rng.uniform(0.6, 1.4)
        falls.append(a)
    stream_pts = []
    for a in falls:
        ca, sa = math.cos(a), math.sin(a)
        px, pz = -sa, ca  # perpendicular
        # river on the top (v 0..0.2)
        r0 = 0.25
        segs = 6
        prev = None
        for i in range(segs + 1):
            t = i / segs
            r = r0 + (1.03 - r0) * t
            wig = math.sin(t * 5 + a) * 0.05
            cx, cz = ca * r + px * wig, sa * r + pz * wig
            w = 0.035 + 0.025 * t
            y = ground_y(cx, cz) + 0.006 if t < 1 else 0.012
            L = V(cx + px * w, y, cz + pz * w)
            R = V(cx - px * w, y, cz - pz * w)
            stream_pts.append((cx, cz))
            if prev:
                v0, v1 = prev[2], t * 0.2
                mb.face([prev[0], prev[1], R, L], 'WATERFALL', [(0, v0, 0), (1, v0, 0), (1, v1, 0), (0, v1, 0)])
            prev = (L, R, t * 0.2)
        # spring pool
        pr = 0.08
        for k in range(8):
            a0, a1 = k / 8 * math.tau, (k + 1) / 8 * math.tau
            cx, cz = ca * r0, sa * r0
            y = ground_y(cx, cz) + 0.007
            mb.face([V(cx, y, cz), V(cx + math.cos(a1) * pr, y, cz + math.sin(a1) * pr), V(cx + math.cos(a0) * pr, y, cz + math.sin(a0) * pr)],
                    'WATERFALL', [(0.5, 0.0, 0), (0.5, 0.0, 0), (0.5, 0.0, 0)])
        # the fall (v 0.2..1): arcs out over the lip then drops well below the tip, widening into mist
        fsegs = 14
        prev = None
        for i in range(fsegs + 1):
            t = i / fsegs
            out = 1.05 + 0.08 * math.sqrt(t * 4) if t < 0.25 else 1.05 + 0.16 + 0.12 * (t - 0.25)
            y = 0.012 - (t ** 1.15) * depth * 1.45
            w = 0.06 + 0.16 * t * t
            cx, cz = ca * out, sa * out
            L = V(cx + px * w, y, cz + pz * w)
            R = V(cx - px * w, y, cz - pz * w)
            if prev:
                v0, v1 = prev[2], 0.2 + 0.8 * t
                mb.face([prev[0], prev[1], R, L], 'WATERFALL', [(0, v0, 1), (1, v0, 1), (1, v1, 1), (0, v1, 1)])
            prev = (L, R, 0.2 + 0.8 * t)

    def near_stream(x, z):
        return any(math.hypot(x - sx, z - sz) < 0.11 for sx, sz in stream_pts)

    for (sx, sz) in stream_pts[::2]:
        spots.append((sx, sz, 0.04))

    box = prim_box()
    # houses (gabled cottages with glowing windows) or, on the tall variant, a pagoda
    for h in range(sh['houses']):
        if variant == 5:
            p = (0.0 + rng.uniform(-0.1, 0.1), 0.0 + rng.uniform(-0.1, 0.1))
        else:
            p = place(0.0, 0.55, 0.16, near_stream)
        if not p:
            continue
        x, z = p
        y0 = ground_y(x, z) - 0.01
        ry = rng.uniform(0, math.pi)
        if variant == 5:
            spots.append((x, z, 0.2))
            tiers = 3
            hh = C * 0.92 / tiers
            for t in range(tiers):
                w = 0.2 - t * 0.045
                yb = y0 + t * hh
                mb.add_prim(box, xf_trs(x, yb + hh * 0.35, z, w, hh * 0.7, w, ry), WALL, 1.0, rng, 0.04)
                for side in range(4):
                    a = ry + side * math.pi / 2
                    wx, wz = x + math.sin(a) * (w / 2 + 0.003), z + math.cos(a) * (w / 2 + 0.003)
                    mb.add_prim(box, xf_trs(wx, yb + hh * 0.38, wz, w * 0.35, hh * 0.32, 0.006, a), GLOW, 1.0)
                # flared roof
                rw = w * 0.85 + 0.06
                mb.add_prim(prim_cyl(4, 1.0, 0.25, 0, 1, True, math.pi / 4), xf_trs(x, yb + hh * 0.68, z, rw, hh * 0.38, rw, ry), ROOF, 0.95, rng, 0.05)
                # hanging lanterns at the eave corners
                for cidx in range(4):
                    a = ry + math.pi / 4 + cidx * math.pi / 2
                    lx, lz = x + math.sin(a) * rw * 0.95, z + math.cos(a) * rw * 0.95
                    mb.add_prim(box, xf_trs(lx, yb + hh * 0.6, lz, 0.025, 0.035, 0.025, a), GLOW, 1.0)
            mb.add_prim(prim_cone(6), xf_trs(x, y0 + tiers * hh, z, 0.015, C * 0.12, 0.015), TRUNK, 0.8)
            continue
        spots.append((x, z, 0.12))
        w, d = rng.uniform(0.11, 0.15), rng.uniform(0.09, 0.12)
        hh = min(C * 0.42, 0.11)
        mb.add_prim(box, xf_trs(x, y0 + hh / 2, z, w, hh, d, ry), WALL, 1.0, rng, 0.05)
        # gable roof: triangular prism with overhang
        rh = hh * 0.75
        ow, od = w * 1.18, d * 1.25
        cy_, sy_ = math.cos(ry), math.sin(ry)

        def L(lx, ly, lz):
            return V(x + lx * cy_ + lz * sy_, y0 + hh + ly, z - lx * sy_ + lz * cy_)
        a1, b1, c1 = L(-ow / 2, 0, -od / 2), L(ow / 2, 0, -od / 2), L(0, rh, -od / 2)
        a2, b2, c2 = L(-ow / 2, 0, od / 2), L(ow / 2, 0, od / 2), L(0, rh, od / 2)
        rs = rng.uniform(0.9, 1.05)
        mb.pal([a1, c1, c2, a2], ROOF, 1.05 * rs)
        mb.pal([b1, b2, c2, c1], ROOF, 0.8 * rs)
        mb.pal([a1, b1, c1], WALL, 0.9)
        mb.pal([a2, c2, b2], WALL, 0.9)
        mb.pal([a1, a2, b2, b1], ROOF, 0.5)
        # chimney
        mb.add_prim(box, xf_trs(x + sy_ * 0.0 + cy_ * w * 0.25, y0 + hh + rh * 0.8, z - sy_ * w * 0.25, 0.022, rh * 0.8, 0.022, ry), ROCKD, 0.8)
        # windows + door
        for side in (1, -1):
            wx, wz = x + sy_ * (d / 2 + 0.003) * side, z + cy_ * (d / 2 + 0.003) * side
            for o in (-0.28, 0.28):
                ox, oz = cy_ * w * o, -sy_ * w * o
                mb.add_prim(box, xf_trs(wx + ox, y0 + hh * 0.58, wz + oz, w * 0.18, hh * 0.28, 0.005, ry), GLOW, 1.0)
        mb.add_prim(box, xf_trs(x + cy_ * (w / 2 + 0.003), y0 + hh * 0.32, z - sy_ * (w / 2 + 0.003), 0.005, hh * 0.6, d * 0.3, ry), TRUNK, 0.7)

    # lantern posts
    for l in range(sh['lanterns']):
        p = place(0.35, 0.92, 0.07, near_stream)
        if not p:
            continue
        x, z = p
        spots.append((x, z, 0.05))
        y0 = ground_y(x, z)
        ph = min(C * 0.55, 0.15)
        mb.add_prim(prim_cyl(5, 1, 0.8, 0, 1, False), xf_trs(x, y0 - 0.01, z, 0.009, ph, 0.009), TRUNK, 0.7)
        mb.add_prim(box, xf_trs(x, y0 + ph + 0.012, z, 0.036, 0.048, 0.036, rng.uniform(0, 1)), GLOW, 1.0)
        mb.add_prim(prim_cone(4, math.pi / 4), xf_trs(x, y0 + ph + 0.034, z, 0.034, 0.025, 0.034), ROOF, 0.8)

    # trees: pines (stacked cones) and round broadleaf clusters
    ico = prim_ico(1)
    for t in range(sh['trees']):
        p = place(0.0, 0.84, 0.09, near_stream)
        if not p:
            continue
        x, z = p
        th = C * rng.uniform(0.62, 0.98)
        spots.append((x, z, th * 0.22))
        y0 = ground_y(x, z) - 0.01
        mb.add_prim(prim_cyl(5, 1, 0.7, 0, 1, False), xf_trs(x, y0, z, 0.016 + th * 0.03, th * 0.45, 0.016 + th * 0.03), TRUNK, 0.75, rng)
        if rng.random() < 0.55 or variant == 1:
            tiers = 3
            for k in range(tiers):
                f = k / tiers
                w = th * (0.33 - f * 0.08)
                mb.add_prim(prim_cone(7, rng.uniform(0, 3)), xf_trs(x, y0 + th * (0.22 + f * 0.27), z, w, th * 0.42, w), LEAVES, 0.85 + f * 0.17, rng, 0.06)
        else:
            for k in range(3):
                ox, oz = rng.uniform(-0.3, 0.3) * th, rng.uniform(-0.3, 0.3) * th
                r = th * rng.uniform(0.2, 0.3)
                mb.add_prim(ico, xf_trs(x + ox, y0 + th * rng.uniform(0.55, 0.72), z + oz, r, r * 0.85, r, rng.uniform(0, 3)), LEAVES, 0.95 + k * 0.06, rng, 0.08)
    # bushes, flowers and boulders
    for k in range(4 + variant % 4):
        p = place(0.3, 0.95, 0.04, near_stream)
        if not p:
            continue
        x, z = p
        spots.append((x, z, 0.03))
        r = rng.uniform(0.025, 0.05)
        if rng.random() < 0.5:
            mb.add_prim(prim_ico(0), xf_trs(x, ground_y(x, z), z, r, r * 0.7, r, rng.uniform(0, 3)), ROCK, 0.95, rng)
        else:
            mb.add_prim(prim_ico(0), xf_trs(x, ground_y(x, z), z, r * 1.2, r, r * 1.2, rng.uniform(0, 3)), LEAVES, 1.1, rng)
    for k in range(10 if variant != 2 else 16):
        p = place(0.2, 0.97, 0.015, near_stream)
        if not p:
            continue
        x, z = p
        mb.add_prim(prim_ico(0), xf_trs(x, ground_y(x, z) + 0.01, z, 0.012, 0.012, 0.012), GLOW if k % 3 == 0 else ROOF, 1.0)
    # hanging roots / vines under the lip
    for k in range(10):
        a = rng.uniform(0, math.tau)
        r = 0.97
        ln = rng.uniform(0.15, 0.45) * depth * 0.5
        mb.add_prim(prim_cyl(3, 1, 0.2, 0, 1, False), xf_trs(math.cos(a) * r, -ln - 0.02, math.sin(a) * r, 0.008, ln, 0.008), LEAVES, 0.6, rng)
    return mb


# ------------------------------------------------------------------------------------------- spire / arch

def build_spire():
    rng = random.Random(4243)
    mb = MB()
    N = 9
    lv = [-0.15, 0.0, 0.08, 0.16, 0.25, 0.34, 0.44, 0.54, 0.63, 0.72, 0.8, 0.87, 0.93]
    rings = []
    for li, y in enumerate(lv):
        base = max(0.13, 1 - 0.85 * max(0.0, y) ** 0.85)
        ledge = 0.1 if li % 2 == 1 else -0.04
        ring = []
        for s in range(N):
            a = s / N * math.tau + li * 0.33
            nz = noise.noise(V(math.cos(a) * 2, y * 6, math.sin(a) * 2))
            r = base * (1 + ledge + nz * 0.25)
            ring.append(V(math.cos(a) * r, y + rng.uniform(-0.01, 0.01), math.sin(a) * r))
        rings.append(ring)
    for li in range(len(rings) - 1):
        for s in range(N):
            s2 = (s + 1) % N
            part = ROCK if (li // 2) % 2 == 0 else ROCKD
            mb.pal([rings[li][s], rings[li][s2], rings[li + 1][s2], rings[li + 1][s]], part, 0.5 + li * 0.045 + rng.uniform(-0.05, 0.05))
    tip = V(0.04, 1.0, 0.0)
    for s in range(N):
        mb.pal([rings[-1][s], rings[-1][(s + 1) % N], tip], ROCKD, 0.95)
    # jagged shards around the crown
    for k in range(5):
        a = k / 5 * math.tau + 0.3
        y = 0.62 + rng.uniform(0, 0.15)
        r = max(0.13, 1 - 0.85 * y ** 0.85) * 0.9
        mb.add_prim(prim_cone(4), xf_trs(math.cos(a) * r, y, math.sin(a) * r, 0.08, 0.22, 0.08, a, 0, -0.5), ROCKD, 0.75, rng)
    return mb


def build_arch():
    rng = random.Random(778)
    mb = MB()
    T, R_, tube = 22, 8, 0.14
    pts = []
    for i in range(T + 1):
        u = i / T * math.pi
        end = i <= 1 or i >= T - 1
        tj = tube * rng.uniform(0.92, 1.12) * (1.35 if end else 1)
        row = []
        for j in range(R_):
            w = j / R_ * math.tau
            r = 1 + math.cos(w) * tj
            row.append(V(math.cos(u) * r, math.sin(u) * r - (0.14 if i in (0, T) else 0), math.sin(w) * tj * 1.15))
        pts.append(row)
    for i in range(T):
        block = 0.85 + 0.25 * ((i * 7) % 3) / 2
        for j in range(R_):
            j2 = (j + 1) % R_
            a, b, c, d = pts[i][j], pts[i + 1][j], pts[i + 1][j2], pts[i][j2]
            n = (b - a).cross(d - a)
            mid = (a + b + c + d) / 4
            outward = V(mid.x, mid.y, 0).normalized()
            # moss on the upper outer face (normal test independent of winding)
            up_face = abs(n.normalized().dot(outward)) > 0.4 and outward.y > 0.25 and (mid - V(0, 0, 0)).length > 1.0 and abs(mid.z) < tube * 0.9
            part = GRASS if up_face else (ROCK if i % 2 else ROCKD)
            mb.pal([a, b, c, d], part, block * rng.uniform(0.9, 1.05) * (1.05 if up_face else 1))
    # hanging moss strands from the crown
    for k in range(9):
        u = rng.uniform(0.25, 0.75) * math.pi
        x, y = math.cos(u) * (1 - tube), math.sin(u) * (1 - tube)
        ln = rng.uniform(0.08, 0.22)
        mb.add_prim(prim_cyl(3, 1, 0.15, 0, 1, False), xf_trs(x, y - ln, rng.uniform(-0.08, 0.08), 0.012, ln, 0.012), LEAVES, 0.7)
    # boulder feet
    for sx in (-1, 1):
        mb.add_prim(prim_ico(1), xf_trs(sx * 1.0, -0.12, 0, 0.26, 0.2, 0.26, sx), ROCKD, 0.65, rng)
    return mb


# ------------------------------------------------------------------------------------------------ lantern

def build_lantern():
    mb = MB()
    N = 8
    prof = [(0.0, 0.2), (0.05, 0.26), (0.3, 0.3), (0.5, 0.28), (0.6, 0.2)]
    rings = [[V(math.cos(s / N * math.tau) * r, y, math.sin(s / N * math.tau) * r) for s in range(N)] for y, r in prof]
    warmB, warmT = (1.0, 0.62, 0.22), (0.9, 0.3, 0.12)
    for li in range(len(rings) - 1):
        for s in range(N):
            s2 = (s + 1) % N
            ca = lerp3(warmB, warmT, prof[li][0] / 0.6)
            cb = lerp3(warmB, warmT, prof[li + 1][0] / 0.6)
            k = 0.85 if s % 2 else 1.0  # paper panels
            ca = tuple(c * k for c in ca)
            cb = tuple(c * k for c in cb)
            mb.face([rings[li][s], rings[li][s2], rings[li + 1][s2], rings[li + 1][s]], 'LGLOW', [ca, ca, cb, cb])
    topc = (0.55, 0.16, 0.08)
    mb.face(list(reversed(rings[-1])), 'LGLOW', topc)
    # open base with a bright flame
    flame = (1.6, 1.1, 0.5)
    for s in range(N):
        mb.face([rings[0][s], V(0, 0.04, 0), rings[0][(s + 1) % N]], 'LGLOW', [(1.0, 0.7, 0.3), flame, (1.0, 0.7, 0.3)])
    return mb


# --------------------------------------------------------------------------------------------------- kites

OUTLINES = {
    'diamond': [(0, 1), (-0.85, 0.15), (-0.25, -0.55), (0, -0.75), (0.25, -0.55), (0.85, 0.15)],
    'fish': [(0, 1), (-0.55, 0.45), (-0.7, -0.1), (-0.3, -0.6), (-0.55, -0.95), (0, -0.7), (0.55, -0.95), (0.3, -0.6), (0.7, -0.1), (0.55, 0.45)],
    'moth': [(0, 0.75), (-0.4, 0.75), (-1.05, 0.55), (-0.95, 0), (-0.55, -0.35), (-0.6, -0.75), (0, -0.45), (0.6, -0.75), (0.55, -0.35), (0.95, 0), (1.05, 0.55), (0.4, 0.75)],
    'dragon': [(0, 1.05), (-0.35, 0.55), (-1.0, 0.3), (-0.45, -0.05), (-0.18, -0.85), (0, -0.6), (0.18, -0.85), (0.45, -0.05), (1.0, 0.3), (0.35, 0.55)],
    'crane': [(0, 0.95), (-0.25, 0.35), (-1.25, 0.25), (-1.0, -0.05), (-0.3, -0.25), (-0.15, -0.8), (0, -0.6), (0.15, -0.8), (0.3, -0.25), (1.0, -0.05), (1.25, 0.25), (0.25, 0.35)],
}


def seg_dist(px, pz, a, b):
    ax, az = a
    bx, bz = b
    dx, dz = bx - ax, bz - az
    L = dx * dx + dz * dz
    t = 0 if L == 0 else max(0, min(1, ((px - ax) * dx + (pz - az) * dz) / L))
    return math.hypot(px - ax - dx * t, pz - az - dz * t)


def edge_dist(o, x, z):
    return min(seg_dist(x, z, o[i], o[(i + 1) % len(o)]) for i in range(len(o)))


def kite_patterns():
    L = hexlin

    def swallow(x, z, e):
        cream, red, navy, gold = L(0xf6efe0), L(0xe0473c), L(0x24345e), L(0xf2b84a)
        if e < 0.045:
            return navy
        if e < 0.07:
            return gold
        r = math.hypot(x, z - 0.05)
        if r < 0.13:
            return navy if r > 0.09 else gold
        ang = math.atan2(x, -(z - 0.95))
        ray = math.sin(ang * 14)
        return red if ray > 0.25 and z < 0.85 else cream

    def koi(x, z, e):
        white, orange, red, ink = L(0xfbf7ee), L(0xff8a3d), L(0xd9342b), L(0x1e1a24)
        if e < 0.035:
            return red
        # eyes near the nose
        for sx in (-0.2, 0.2):
            d = math.hypot(x - sx, z - 0.62)
            if d < 0.07:
                return L(0xfff6d8) if math.hypot(x - sx - 0.02, z - 0.64) < 0.022 else ink
        n = noise.noise(V(x * 2.6, 0.5, z * 2.6)) + 0.35 * noise.noise(V(x * 6, 1.5, z * 6))
        # scale arcs
        sx_, sz_ = x * 9, z * 9
        row = math.floor(sz_)
        fx = sx_ + (0.5 if row % 2 else 0)
        arc = math.hypot(fx - math.floor(fx) - 0.5, sz_ - row)
        base = red if n > 0.18 else (orange if n > -0.05 else white)
        if 0.42 < arc < 0.5 and z < 0.45:
            base = tuple(c * 0.78 for c in base)
        if z < -0.55:
            return orange if (int((x + 2) * 10) % 2) else red
        return base

    def moth(x, z, e):
        cream, plum, ink, amber, rose = L(0xeadcbf), L(0x7e5fb0), L(0x2d2340), L(0xffc56a), L(0xd88aa8)
        if e < 0.04:
            return ink
        ax = abs(x)
        for cx, cz, R in ((0.6, 0.32, 0.2), (0.38, -0.38, 0.12)):
            d = math.hypot(ax - cx, z - cz)
            if d < R:
                f = d / R
                return ink if f > 0.82 else (amber if f > 0.5 else (ink if f > 0.3 else L(0xfff3d0)))
        t = max(0, min(1, (ax - 0.1) / 0.9))
        c = lerp3(cream, plum, t ** 1.3)
        if 0.02 < ax < 0.09:
            c = rose
        vein = abs(math.sin(math.atan2(z, ax + 0.05) * 9))
        if vein < 0.08 and ax > 0.15:
            c = tuple(k * 0.72 for k in c)
        return c

    def dragon(x, z, e):
        jade, gold, red, dark = L(0x2a9b74), L(0xffc94a), L(0xc8261c), L(0x14402f)
        if e < 0.04:
            return gold
        ax = abs(x)
        if ax < 0.06:
            return red
        # flame tongues rising from the trailing edge
        fl = math.sin(ax * 13 + 1.3) * 0.18 + 0.05 - (0.3 if ax > 0.5 else 0)
        if z < fl - 0.15:
            return gold if z > fl - 0.42 else red
        sc = math.sin(x * 22) * math.sin(z * 22)
        return dark if sc > 0.72 else jade

    def crane(x, z, e):
        white, ink, red, grey = L(0xfbfbf6), L(0x1d1d26), L(0xd8322a), L(0xc9ccd6)
        ax = abs(x)
        if math.hypot(x, z - 0.62) < 0.12:
            return red
        if e < 0.03:
            return ink
        if ax > 0.82:
            return ink
        if ax > 0.62:
            feather = math.sin(z * 30 + ax * 8)
            return ink if feather > -0.2 else grey
        if z < -0.25 and ax < 0.2:
            return ink
        f = abs(math.sin(math.atan2(z + 0.1, ax) * 11))
        return grey if f < 0.12 and ax > 0.2 else white
    return dict(swallow=swallow, koi=koi, moth=moth, dragon=dragon, crane=crane)


KITE_SHAPES = dict(swallow='diamond', koi='fish', moth='moth', dragon='dragon', crane='crane')
SPAR = hexlin(0x4a3424)


def sail_y(x, z):
    """Dihedral + billow between the spars."""
    ax = abs(x)
    return ax * 0.22 + 0.035 * math.sin(min(1, ax / 0.9) * math.pi) * (1 - min(1, abs(z) * 0.8)) + 0.05 * max(0, 1 - ax * 4)


def tube(mb, a, b, r, col, n=5, mat='KPAPER'):
    d = (b - a)
    L_ = d.length
    if L_ < 1e-6:
        return
    d.normalize()
    up = V(0, 1, 0) if abs(d.y) < 0.9 else V(1, 0, 0)
    u = d.cross(up).normalized()
    w = d.cross(u).normalized()
    ra = [a + (u * math.cos(k / n * math.tau) + w * math.sin(k / n * math.tau)) * r for k in range(n)]
    rb = [b + (u * math.cos(k / n * math.tau) + w * math.sin(k / n * math.tau)) * r for k in range(n)]
    for k in range(n):
        k2 = (k + 1) % n
        s = 0.8 + 0.25 * math.cos(k / n * math.tau)
        mb.face([ra[k], ra[k2], rb[k2], rb[k]], mat, tuple(c * s for c in col))


def build_kite(kid):
    shape = KITE_SHAPES[kid]
    o = OUTLINES[shape]
    pat = kite_patterns()[kid]
    rng = random.Random(hash(kid) & 0xffff)
    mb = MB()
    centre = (0.0, 0.0)
    LEV = 4

    def sub(tri, lvl):
        if lvl == 0:
            return [tri]
        a, b, c = tri
        ab = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        bc = ((b[0] + c[0]) / 2, (b[1] + c[1]) / 2)
        ca = ((c[0] + a[0]) / 2, (c[1] + a[1]) / 2)
        out = []
        for t in ((a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca)):
            out += sub(t, lvl - 1)
        return out
    tris = []
    for i in range(len(o)):
        tris += sub((centre, o[i], o[(i + 1) % len(o)]), LEV)
    for tri in tris:
        cx = sum(p[0] for p in tri) / 3
        cz = sum(p[1] for p in tri) / 3
        e = edge_dist(o, cx, cz)
        col = pat(cx, cz, e)
        # paper fibre + crease shading along the spars
        k = 1 + rng.uniform(-0.035, 0.035)
        if abs(cx) < 0.025:
            k *= 0.85
        col = tuple(c * k for c in col)
        pts = [V(p[0], sail_y(p[0], p[1]), p[1]) for p in tri]
        mb.face(pts, 'KPAPER', col)
    # bamboo spars (spine + bowed cross spar), node rings
    zs = max(p[1] for p in o)
    zmin = min(p[1] for p in o)
    xs = max(abs(p[0]) for p in o)
    spine = [V(0, sail_y(0, z) + 0.02, z) for z in (zmin + 0.02, 0, zs - 0.02)]
    tube(mb, spine[0], spine[1], 0.016, SPAR)
    tube(mb, spine[1], spine[2], 0.016, SPAR)
    zc = {'diamond': 0.15, 'fish': 0.3, 'moth': 0.5, 'dragon': 0.32, 'crane': 0.25}[shape]
    prev = None
    for k in range(9):
        x = -xs * 0.97 + k / 8 * xs * 1.94
        p = V(x, sail_y(x, zc) + 0.025, zc)
        if prev:
            tube(mb, prev, p, 0.012, SPAR)
        prev = p
    # tassels at the wing tips (paper fringes)
    tip_idx = [max(range(len(o)), key=lambda i: o[i][0]), min(range(len(o)), key=lambda i: o[i][0])]
    pal = {'swallow': 0xe0473c, 'koi': 0xd9342b, 'moth': 0xffc56a, 'dragon': 0xffc94a, 'crane': 0xd8322a}[kid]
    for ti in tip_idx:
        x, z = o[ti]
        base = V(x, sail_y(x, z), z)
        for k in range(3):
            off = V(rng.uniform(-0.03, 0.03), 0, rng.uniform(-0.03, 0.03))
            tube(mb, base + off, base + off + V(0, -0.02, -0.22 - k * 0.05), 0.012, hexlin(pal), 4)
    # character pieces
    if kid == 'dragon':
        head = V(0, sail_y(0, 1.0) + 0.05, 1.0)
        jade, gold, red = hexlin(0x2a9b74), hexlin(0xffc94a), hexlin(0xc8261c)
        for f in prim_box()[1]:
            pass
        hv, hf = prim_box()
        xf = xf_trs(head.x, head.y, head.z + 0.06, 0.2, 0.12, 0.22, 0, 0.15)
        tv = [xf(v.copy()) for v in hv]
        for fi, f in enumerate(hf):
            mb.face([tv[i] for i in f], 'KPAPER', red if fi in (2, 3) else jade)
        for sx in (-1, 1):  # horns + whiskers
            tube(mb, head + V(sx * 0.06, 0.06, 0), head + V(sx * 0.16, 0.2, -0.12), 0.014, gold, 4)
            tube(mb, head + V(sx * 0.09, -0.02, 0.15), head + V(sx * 0.35, -0.06, 0.05), 0.006, gold, 3)
            ev, ef = prim_ico(0)
            exf = xf_trs(head.x + sx * 0.07, head.y + 0.05, head.z + 0.15, 0.03, 0.03, 0.03)
            for f in ef:
                mb.face([exf(ev[i].copy()) for i in f], 'KGLOW', (1.6, 1.0, 0.25))
    if kid == 'crane':
        ink, red, white = hexlin(0x1d1d26), hexlin(0xd8322a), hexlin(0xfbfbf6)
        n0 = V(0, sail_y(0, 0.9) + 0.02, 0.9)
        n1 = n0 + V(0, 0.08, 0.28)
        tube(mb, n0, n1, 0.025, white, 6)
        tube(mb, n1, n1 + V(0, 0.0, 0.12), 0.035, white, 6)
        tube(mb, n1 + V(0, 0.0, 0.12), n1 + V(0, -0.03, 0.26), 0.012, hexlin(0xd9b23a), 4)
        tube(mb, n1 + V(0, 0.035, 0.08), n1 + V(0, 0.04, 0.12), 0.02, red, 4)
    if kid == 'moth':
        for sx in (-1, 1):
            a = V(sx * 0.08, sail_y(0, 0.72) + 0.03, 0.72)
            b = a + V(sx * 0.18, 0.12, 0.3)
            tube(mb, a, b, 0.008, SPAR, 4)
            ev, ef = prim_ico(0)
            exf = xf_trs(b.x, b.y, b.z, 0.03, 0.03, 0.03)
            for f in ef:
                mb.face([exf(ev[i].copy()) for i in f], 'KGLOW', (1.4, 0.9, 0.4))
    if kid == 'koi':
        orange = hexlin(0xff8a3d)
        for sx in (-1, 1):  # pectoral fins
            a = V(sx * 0.62, sail_y(0.62, 0.1), 0.15)
            mb.face([a, a + V(sx * 0.3, -0.06, -0.15), a + V(sx * 0.05, 0, -0.35)], 'KPAPER', orange)
    # bridle anchor ring under the spar cross (tail ribbon anchors behind at z ≈ -0.75)
    tube(mb, V(0, sail_y(0, zmin) - 0.01, zmin + 0.04), V(0, sail_y(0, zmin) - 0.04, zmin - 0.02), 0.02, hexlin(pal), 5)
    return mb


# --------------------------------------------------------------------------------------------------- export

def export(obj, path):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
        export_normals=True, export_tangents=False, export_materials='EXPORT', export_vertex_color='ACTIVE',
        export_all_vertex_colors=False, export_animations=False, export_extras=False, export_texcoords=False,
    )


def main():
    want = set(a for a in sys.argv[1:] if not a.startswith('-'))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    jobs = {}
    for v in range(len(ISLAND_SHAPES)):
        jobs[f'island_{v}'] = (lambda v=v: build_island(v))
    jobs['spire'] = build_spire
    jobs['arch'] = build_arch
    jobs['lantern'] = build_lantern
    for k in KITE_SHAPES:
        jobs[f'kite_{k}'] = (lambda k=k: build_kite(k))
    man_path = os.path.join(OUT, 'manifest.json')
    try:
        manifest = json.load(open(man_path))
    except Exception:
        manifest = {}
    manifest.setdefault('models', {})
    manifest['_doc'] = ('GLB overrides built by tools/blender/build_models.py. Map a model id to a file in public/models/. '
                        'Missing ids/files fall back to procedural geometry. See src/render/Models.ts for ids, conventions and the material contract.')
    for mid, fn in jobs.items():
        if want and mid not in want:
            continue
        for ob in list(bpy.data.objects):
            bpy.data.objects.remove(ob)
        mb = fn()
        ob = mb.to_object(mid)
        path = os.path.join(OUT, f'{mid}.glb')
        export(ob, path)
        manifest['models'][mid] = f'{mid}.glb'
        print(f'[models] {mid}: {len(mb.faces)} faces -> {os.path.getsize(path) // 1024} KB')
    with open(man_path, 'w') as f:
        json.dump(manifest, f, indent=2)


if __name__ == '__main__':
    main()
