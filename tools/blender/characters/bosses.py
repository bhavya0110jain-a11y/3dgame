"""Boss models (one instance on screen: budget ~12k triangles each). Ornate, memorable silhouettes.
Blender space: Z up, FRONT = -Y, feet on z = 0. Model heights ~1.6-2.8 m; the game scales them x3+.
"""
import math

from mathutils import Vector

import lib
from lib import part, tube, bez, paint, mix, smooth, material, mirror_x, deform_obj, surface_pt  # noqa: F401
from enemies import body_mat, glow, eye, eye_pair, sym, WHITE


def ring_on(objs, center, axis_dir, radius, n=10, lift=0.01):
    """Points of a circle projected onto a surface (for glowing runes on flanks)."""
    c = Vector(center)
    d = Vector(axis_dir).normalized()
    ref = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized()
    v = d.cross(u).normalized()
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / (n - 1)
        o = c + (u * math.cos(a) + v * math.sin(a)) * radius - d * 2.0
        h = surface_pt(objs, o, d)
        if h is not None:
            pts.append(h - d * lift)
    return pts


# ============================================================================================ HOLLOW STAG
def stag():
    """The Hollow Stag: indigo deer with fawn-spot dapples, a shaggy lavender mane, a bone skull mask,
    vast branching antlers tipped with violet crystals and hung with little spirit lanterns,
    glowing spiral runes on the flanks."""
    skin = body_mat('stag_skin')
    mane_m = body_mat('stag_mane')
    bone = material('stag_bone', 0xf1e6cf, rough=0.45)
    hoof = material('stag_hoof', 0x3a2850, rough=0.5)
    objs = []
    barrel = part('stag_barrel', 'sphere', skin, loc=(0, 0.08, 1.06), size=(0.36, 0.7, 0.36), sub=2, args={'seg': 12, 'rings': 8})
    chest = part('stag_chest', 'sphere', skin, loc=(0, -0.4, 1.12), size=(0.38, 0.38, 0.43), sub=2, args={'seg': 12, 'rings': 8})
    rump = part('stag_rump', 'sphere', skin, loc=(0, 0.5, 1.08), size=(0.35, 0.36, 0.37), sub=2, args={'seg': 12, 'rings': 8})
    neck = tube('stag_neck', skin, [(0, -0.48, 1.22), (0, -0.62, 1.55), (0, -0.7, 1.8)], [0.25, 0.19, 0.16], seg=10, sub=2)
    body = [barrel, chest, rump, neck]
    objs += body
    for front, y0, ky in ((1, -0.42, -0.5), (0, 0.52, 0.62)):
        def leg(y0=y0, ky=ky, front=front):
            return tube('stag_leg', skin, [(0.2, y0, 0.95), (0.23, ky, 0.48), (0.21, y0 + (0.02 if front else -0.06), 0.14)],
                        [0.12, 0.07, 0.06], seg=8, sub=1)
        objs += sym(leg)
        objs += sym(lambda y0=y0, front=front: part('stag_hoof', 'sphere', hoof, loc=(0.21, y0 + (0.0 if front else -0.06) - 0.02, 0.07),
                                                      size=(0.075, 0.09, 0.08), sub=1, args={'seg': 8, 'rings': 6}))
    objs.append(tube('stag_tail', mane_m, bez((0, 0.82, 1.2), (0, 0.98, 1.25), (0, 1.0, 1.0), 4), [0.09, 0.1, 0.06, 0.0], seg=7, sub=1))

    def skin_p(p, n):
        c = mix(0x2f2470, 0x5244b0, smooth(0.6, 1.6, p.z))
        bel = smooth(-0.1, -0.7, n.z) + smooth(0.3, 0.8, -n.y) * smooth(1.3, 1.0, p.z) * 0.5
        c = mix(c, 0xb2a2f0, min(1.0, bel) * 0.8)
        # fawn dapples along the back
        s = math.sin(p.x * 23.0) * math.sin(p.y * 19.0 + 0.5) * math.sin(p.z * 21.0 + 1.0)
        c = mix(c, 0xcfc2ff, smooth(0.4, 0.62, s) * smooth(0.3, 0.8, n.z) * smooth(0.9, 1.2, p.z) * 0.9)
        c = mix(c, 0x8a7ae8, smooth(0.6, 1.0, n.z) * 0.3)
        return c

    for o in objs:
        if o.data.materials[0] is skin:
            paint(o, skin_p)
    # mane: ring of spiky tufts around the neck base
    mane = []
    for i in range(11):
        a = -math.pi * 0.9 + (i / 10) * math.pi * 1.8
        bx, by = math.sin(a) * 0.2, -0.62 - math.cos(a) * 0.17
        for zz, ln in ((1.62, 0.36), (1.4, 0.42)):
            base = Vector((bx, by, zz))
            out = Vector((math.sin(a) * 0.35, -math.cos(a) * 0.32 + 0.12, -0.12))
            mane.append(tube('stag_tuft', mane_m, [base, base + out * 0.5 + Vector((0, 0, -0.06)), base + out * ln / 0.4 * 0.9 + Vector((0, 0, -0.22))],
                             [0.09, 0.06, 0.0], seg=6, sub=1))
    objs += mane
    for o in mane + [objs[-len(mane) - 1]]:
        paint(o, lambda p, n: mix(0x8e7ae0, 0xe0d4ff, smooth(-0.2, 0.9, n.z)))
    # skull mask
    skull = tube('stag_skull', bone, [(0, -0.64, 1.9), (0, -0.82, 1.88), (0, -1.0, 1.78), (0, -1.12, 1.66)], [0.18, 0.16, 0.11, 0.06],
                 seg=10, sub=2, flat=(1.0, 0.82))
    sk_dark = (0.16, 0.08, 0.26)

    def skull_p(p, n):
        c = mix(0xb8aa98, 0xf6ecd8, smooth(-0.3, 0.8, n.z))
        for sx in (-1, 1):
            d = math.hypot((p.x - sx * 0.1) / 0.075, (p.z - 1.92) / 0.06)
            c = mix(c, sk_dark, (1.0 - smooth(0.7, 1.1, d)) * smooth(-0.1, -0.5, n.y + abs(n.x) * -0.5))
        # nostril slits
        d2 = min(math.hypot((p.x - 0.035) / 0.02, (p.z - 1.7) / 0.03), math.hypot((p.x + 0.035) / 0.02, (p.z - 1.7) / 0.03))
        return mix(c, sk_dark, (1.0 - smooth(0.8, 1.2, d2)) * smooth(-0.6, -0.9, n.y))

    paint(skull, skull_p)
    objs.append(skull)
    objs += sym(lambda: tube('stag_ear', mane_m, [(0.15, -0.66, 1.98), (0.32, -0.6, 2.02), (0.42, -0.56, 1.98)], [0.07, 0.06, 0.0], seg=6, sub=1, flat=(1.0, 0.45)))
    # antlers with crystal tips and hanging spirit lanterns
    crystal = glow('stag_crystal', 0xd77cff)
    orb = glow('stag_orb', 0xf0b0ff)
    chain = material('stag_chain', 0x9a8ac0)

    def antler(sx):
        out = []
        beam = bez((sx * 0.1, -0.74, 2.0), (sx * 0.62, -0.64, 2.12), (sx * 0.86, -0.42, 2.78), 8)
        out.append(tube('stag_antler', bone, beam, [0.075, 0.068, 0.06, 0.052, 0.045, 0.038, 0.03, 0.0], seg=7, sub=1))
        tips = [beam[-1]]
        for k, (dx, dy, dz, ln) in ((2, (0.05, -0.28, 0.5, 0.42)), (4, (0.25, -0.12, 0.45, 0.36)), (5, (-0.12, 0.05, 0.5, 0.38))):
            b0 = beam[k]
            d = Vector((sx * dx, dy, dz)).normalized()
            p1 = b0 + d * ln * 0.55 + Vector((0, 0, 0.03))
            p2 = b0 + d * ln
            out.append(tube('stag_tine', bone, [b0, p1, p2], [0.04, 0.032, 0.0], seg=6, sub=1))
            tips.append(p2)
        for t in tips:
            out.append(part('stag_crystal', 'ico', crystal, loc=t + Vector((0, 0, 0.04)), size=(0.05, 0.05, 0.09), sub=0, args={'sub': 1}))
        # hanging lantern
        h = beam[3]
        out.append(tube('stag_chain', chain, [h, h + Vector((0, 0, -0.22))], [0.012, 0.012], seg=4, sub=0))
        out.append(part('stag_orb', 'sphere', orb, loc=h + Vector((0, 0, -0.29)), size=0.07, sub=0, args={'seg': 10, 'rings': 7}))
        out.append(part('stag_cap', 'cyl', chain, loc=h + Vector((0, 0, -0.225)), size=1, sub=0, args={'seg': 8, 'r1': 0.05, 'r2': 0.03, 'depth': 0.03}))
        return out

    objs += antler(1) + antler(-1)
    em = eye('stag', 0xf2a0ff)
    objs += eye_pair(em, 0.1, -0.9, 1.92, (0.05, 0.03, 0.04), tilt=18, on=[skull], sink=0.5)
    rune = glow('stag_rune', 0xc070ff)
    for sx in (1, -1):
        pts = ring_on(body, (sx * 0.5, 0.15, 1.08), (-sx, 0, 0), 0.2, n=12)
        if len(pts) > 4:
            objs.append(tube('stag_rune', rune, pts, [0.018] * len(pts), seg=4, sub=0, cap=False))
        pts = ring_on(body, (sx * 0.5, 0.15, 1.08), (-sx, 0, 0), 0.09, n=8)
        if len(pts) > 4:
            objs.append(tube('stag_rune', rune, pts, [0.016] * len(pts), seg=4, sub=0, cap=False))
    return objs


stag.finish = {'ao_strength': 0.55, 'distance': 0.5}


# ============================================================================================ MIRE MOTHER
def mire():
    """The Mire Mother: colossal teal toad-matriarch with a cream belly, a crown of cattails and pink
    lotus blossoms, lily pads and a clutch of glowing eggs on her back, a three-eyed stare and moss beard."""
    skin = body_mat('mire_skin')
    pad_m = body_mat('mire_pad')
    petal = body_mat('mire_petal')
    reed = material('mire_reed', 0x6f9a3a)
    cat = material('mire_cattail', 0x7a4a2a)
    moss = material('mire_moss', 0x2c6a44)
    objs = []
    body = part('mire_body', 'sphere', skin, loc=(0, 0.12, 0.62), size=(0.86, 0.9, 0.62), sub=2, args={'seg': 14, 'rings': 9},
                deform=lambda v: Vector((v.x, v.y, max(v.z, -0.56))))
    head = part('mire_head', 'sphere', skin, loc=(0, -0.55, 0.98), size=(0.62, 0.46, 0.38), sub=2, args={'seg': 14, 'rings': 8})
    objs += [body, head]
    objs += sym(lambda: part('mire_bulb', 'sphere', skin, loc=(0.36, -0.6, 1.3), size=(0.2, 0.19, 0.19), sub=1, args={'seg': 12, 'rings': 8}))
    objs += sym(lambda: tube('mire_arm', skin, [(0.66, -0.4, 0.75), (0.86, -0.62, 0.42), (0.82, -0.8, 0.1)], [0.22, 0.18, 0.15], seg=9, sub=1))
    objs += sym(lambda: part('mire_hand', 'sphere', skin, loc=(0.84, -0.86, 0.06), size=(0.2, 0.22, 0.07), sub=1, args={'seg': 10, 'rings': 6}))
    objs += sym(lambda: part('mire_thigh', 'sphere', skin, loc=(0.72, 0.42, 0.34), size=(0.3, 0.42, 0.3), sub=1, args={'seg': 12, 'rings': 7}))
    objs += sym(lambda: part('mire_foot', 'sphere', skin, loc=(0.82, 0.05, 0.05), size=(0.2, 0.28, 0.06), sub=1, args={'seg': 10, 'rings': 6}))

    def skin_p(p, n):
        c = mix(0x1d5a58, 0x33a08a, smooth(0.2, 1.3, p.z))
        bel = smooth(0.2, 0.7, -n.y) * (1.0 - smooth(0.82, 0.92, p.z + 0.3 * p.x * p.x))
        c = mix(c, 0xeee6aa, bel * 0.85)
        # wide grin
        mz = 0.88 + 0.35 * p.x * p.x
        m = (1.0 - smooth(0.02, 0.045, abs(p.z - mz))) * smooth(-0.2, -0.6, n.y) * (1.0 - smooth(0.5, 0.58, abs(p.x)))
        c = mix(c, 0x10241e, m)
        w = math.sin(p.x * 16.0) * math.sin(p.y * 14.0 + 1.1) * math.sin(p.z * 12.0 + 0.4)
        c = mix(c, 0x1a4a44, smooth(0.35, 0.6, w) * smooth(0.0, 0.6, n.z) * 0.8)
        c = mix(c, 0x7fd8b8, smooth(0.65, 1.0, n.z) * 0.3)
        return c

    for o in objs:
        paint(o, skin_p)
    # moss beard hanging from the chin
    for i in range(7):
        x = -0.36 + i * 0.12
        z = 0.86 + 0.35 * x * x
        y = (lib.surface_y([head], x, z) or -0.95) + 0.02
        ln = 0.18 + 0.12 * ((i * 37) % 5) / 4
        objs.append(tube('mire_moss', moss, [(x, y, z), (x * 1.05, y - 0.04, z - ln * 0.5), (x * 1.1, y - 0.02, z - ln)], [0.035, 0.03, 0.0], seg=5, sub=1))
    # lily pads + lotus flowers on the back
    lot_c = glow('mire_lotusheart', 0xffe27a)
    for (x, y, r, rot) in ((0.42, 0.3, 0.3, 20), (-0.45, 0.45, 0.26, -30), (0.05, 0.7, 0.24, 60)):
        top = surface_pt([body], (x, y, 3), (0, 0, -1))
        z = top.z if top else 1.1
        pad = part('mire_lilypad', 'cyl', pad_m, loc=(x, y, z + 0.01), size=1, rot=(0, 0, rot), sub=1, args={'seg': 14, 'r1': r, 'r2': r, 'depth': 0.03},
                   deform=lambda v: Vector((v.x, v.y, v.z - 0.0 if math.atan2(v.y, v.x) > 0.35 or math.atan2(v.y, v.x) < 0 else v.z)))
        paint(pad, lambda p, n: mix(0x3c8a3a, 0x8ad25a, smooth(0.0, 1.0, n.z)))
        objs.append(pad)
        for k in range(7):
            a = 2 * math.pi * k / 7
            pt = part('mire_petal', 'sphere', petal, loc=(x + math.cos(a) * 0.09, y + math.sin(a) * 0.09, z + 0.08), size=(0.1, 0.045, 0.035),
                      rot=(0, -40, math.degrees(a)), sub=1, args={'seg': 8, 'rings': 5})
            paint(pt, lambda p, n: mix(0xd04a8a, 0xffb0d8, smooth(-0.2, 0.9, n.z)))
            objs.append(pt)
        objs.append(part('mire_lotusheart', 'sphere', lot_c, loc=(x, y, z + 0.1), size=0.045, sub=0, args={'seg': 8, 'rings': 5}))
    # cattail crown
    for i, (x, y, h) in enumerate(((0.28, -0.32, 0.7), (-0.3, -0.3, 0.62), (0.12, -0.18, 0.85), (-0.12, -0.2, 0.78), (0.42, -0.2, 0.5), (-0.44, -0.18, 0.55))):
        top = surface_pt([head, body], (x, y, 3), (0, 0, -1))
        z = (top.z if top else 1.2) - 0.03
        lean = 0.12 * (1 if x > 0 else -1)
        objs.append(tube('mire_reed', reed, [(x, y, z), (x + lean * 0.5, y + 0.05, z + h * 0.6), (x + lean, y + 0.1, z + h)], [0.025, 0.02, 0.012], seg=5, sub=0))
        objs.append(tube('mire_cattail', cat, [(x + lean * 0.83, y + 0.083, z + h * 0.83 - 0.02), (x + lean, y + 0.1, z + h), (x + lean * 1.1, y + 0.11, z + h + 0.14)],
                         [0.045, 0.05, 0.0], seg=6, sub=1))
    # egg clutch
    egg = glow('mire_egg', 0x2fb08e)
    for i in range(9):
        a = i * 2.4
        rr = 0.08 + 0.05 * (i % 3)
        x, y = math.cos(a) * 0.2 * (i / 9 + 0.3), 0.1 + math.sin(a) * 0.2 * (i / 9 + 0.3)
        top = surface_pt([body], (x, y, 3), (0, 0, -1))
        z = top.z if top else 1.2
        objs.append(part('mire_egg', 'sphere', egg, loc=(x, y, z + rr * 0.5), size=rr * 0.75, sub=0, args={'seg': 10, 'rings': 7}))
    em = eye('mire', 0x5ae8c0)
    bulbs = [o for o in objs if o.name.startswith('mire_bulb')]
    objs += eye_pair(em, 0.36, -0.8, 1.31, (0.11, 0.05, 0.11), tilt=-10, on=bulbs, sink=0.4)
    objs.append(part('mire_eye3', 'sphere', em, loc=(0, (lib.surface_y([head], 0, 1.16) or -1.0) + 0.02, 1.16), size=(0.085, 0.04, 0.1), sub=0,
                     args={'seg': 10, 'rings': 7}))
    return objs


mire.finish = {'ao_strength': 0.6, 'distance': 0.5}


# ============================================================================================ ASHEN KING
def king():
    """The Ashen King: towering crimson robe with gold bands, a huge cream fur mantle with dark ermine
    tails, ash-pale mask face with ember eyes and a long pointed beard, a gem-studded gold crown,
    a sceptre crowned with a blazing orb and a living flame hovering over his open hand."""
    robe = body_mat('king_robe')
    fur = body_mat('king_fur')
    face = body_mat('king_face')
    gold = material('king_gold', 0xf0be52, rough=0.3)
    objs = []
    prof = [(0.0, 0.0), (0.02, 0.72), (0.3, 0.64), (0.8, 0.5), (1.3, 0.42), (1.62, 0.45), (1.82, 0.3), (1.9, 0.0)]
    gown = tube('king_gown', robe, [(0, 0, z) for z, r in prof], [r for z, r in prof], seg=16, sub=2)

    def folds(p):
        th = math.atan2(p.y, p.x)
        w = 1.0 - smooth(0.1, 1.2, p.z)
        r = math.hypot(p.x, p.y)
        if r < 1e-4:
            return p
        k = 1.0 + 0.06 * math.cos(9 * th) * w
        return Vector((p.x * k, p.y * k, p.z))

    deform_obj(gown, folds)
    cape = tube('king_cape', robe, [(0, 0.22, 1.75), (0, 0.42, 1.0), (0, 0.6, 0.02)], [0.36, 0.55, 0.7], seg=12, sub=1, flat=(1.0, 0.25))
    objs += [gown, cape]
    objs += sym(lambda: tube('king_sleeve', robe, [(0.38, -0.02, 1.68), (0.58, -0.18, 1.3), (0.64, -0.36, 1.08)], [0.15, 0.18, 0.22], seg=10, sub=1))

    def robe_p(p, n):
        c = mix(0x5e0f22, 0xb8283c, smooth(0.0, 1.6, p.z) * 0.6 + smooth(-0.2, 1.0, n.z) * 0.4)
        # gold bands: hem and waist, plus a vertical front panel border
        band = (1.0 - smooth(0.06, 0.1, p.z)) + (1.0 - smooth(0.025, 0.04, abs(p.z - 0.18)))
        band += (1.0 - smooth(0.025, 0.04, abs(p.z - 1.05))) * (1.0 if p.y < 0.2 else 0.0)
        band += (1.0 - smooth(0.02, 0.035, abs(abs(p.x) - 0.16 - (1.3 - min(p.z, 1.3)) * 0.12))) * smooth(-0.3, -0.6, n.y) * (1.0 - smooth(1.0, 1.1, p.z))
        c = mix(c, 0xf2c45a, min(1.0, band))
        # sleeve cuffs
        if abs(p.x) > 0.5 and p.z < 1.2:
            c = mix(c, 0xf2c45a, 1.0 - smooth(0.04, 0.07, abs(p.z - 1.13 + (abs(p.x) - 0.6) * 0.6)))
        return c

    for o in objs:
        paint(o, robe_p)
    mantle = part('king_mantle', 'torus', fur, loc=(0, 0.02, 1.74), size=(1.0, 0.9, 1.25), sub=1, args={'major': 0.4, 'minor': 0.17, 'seg': 16, 'mseg': 8})

    def fur_p(p, n):
        c = mix(0xcfc6d8, 0xfff8ec, smooth(-0.3, 0.9, n.z))
        th = math.atan2(p.y, p.x)
        t = abs(math.sin(th * 7.0))
        c = mix(c, 0x2a2238, (1.0 - smooth(0.08, 0.16, t)) * smooth(1.66, 1.6, p.z) * 0.9)
        return c

    paint(mantle, fur_p)
    objs.append(mantle)
    head = part('king_head', 'sphere', face, loc=(0, -0.04, 2.02), size=(0.21, 0.21, 0.25), sub=2, args={'seg': 10, 'rings': 7})

    def face_p(p, n):
        c = mix(0x7a7090, 0xd8d0e6, smooth(-0.4, 0.8, n.z * 0.6 - n.y * 0.4))
        for sx in (-1, 1):
            d = math.hypot((p.x - sx * 0.075) / 0.06, (p.z - 2.04) / 0.05)
            c = mix(c, (0.14, 0.06, 0.12), (1.0 - smooth(0.6, 1.1, d)) * smooth(-0.2, -0.6, n.y))
        return c

    paint(head, face_p)
    beard = tube('king_beard', face, [(0, -0.12, 1.94), (0, -0.25, 1.78), (0, -0.28, 1.52), (0, -0.22, 1.28)], [0.17, 0.15, 0.09, 0.0], seg=8, sub=1, flat=(1.0, 0.55))
    paint(beard, lambda p, n: mix(0x8a849c, 0xd6d0e2, smooth(-0.5, 0.8, n.z - n.y * 0.3)))
    objs += [head, beard]
    objs += sym(lambda: tube('king_moustache', face, bez((0.0, -0.21, 1.97), (0.14, -0.23, 1.96), (0.2, -0.16, 1.86), 4), [0.04, 0.035, 0.02, 0.0], seg=6, sub=1))
    for o in objs[-2:]:
        paint(o, lambda p, n: mix(0x8a849c, 0xd6d0e2, smooth(-0.5, 0.8, n.z)))
    # crown
    objs.append(part('king_crownband', 'cyl', gold, loc=(0, -0.03, 2.22), size=1, sub=1, args={'seg': 14, 'r1': 0.2, 'r2': 0.22, 'depth': 0.12, 'caps': False}))
    gem = glow('king_gem', 0xff4a2a)
    for i in range(7):
        a = 2 * math.pi * i / 7 - math.pi / 2
        x, y = math.cos(a) * 0.2, -0.03 + math.sin(a) * 0.2
        h = 0.2 if i == 0 else 0.15
        objs.append(tube('king_spike', gold, [(x, y, 2.24), (x * 1.06, y * 1.06, 2.24 + h * 0.6), (x * 1.12, y * 1.12, 2.24 + h)], [0.065, 0.04, 0.0], seg=6, sub=1))
        objs.append(part('king_gem', 'ico', gem, loc=(x * 1.11, y * 1.11, 2.2 + h), size=0.035, sub=0, args={'sub': 1}))
    objs.append(part('king_frontgem', 'ico', gem, loc=(0, -0.25, 2.22), size=(0.05, 0.03, 0.06), sub=0, args={'sub': 1}))
    hand = material('king_hand', 0xc9c0da)
    objs += sym(lambda: part('king_hand', 'sphere', hand, loc=(0.64, -0.46, 1.04), size=(0.09, 0.1, 0.1), sub=1, args={'seg': 8, 'rings': 6}))
    # sceptre (right hand, -X) and hovering flame (left hand, +X)
    objs.append(tube('king_sceptre', gold, [(-0.64, -0.5, 0.25), (-0.64, -0.5, 1.2), (-0.64, -0.52, 2.15)], [0.03, 0.035, 0.035], seg=7, sub=0))
    objs.append(part('king_sring', 'torus', gold, loc=(-0.64, -0.52, 2.3), size=1, rot=(90, 0, 0), sub=0, args={'major': 0.15, 'minor': 0.025, 'seg': 16, 'mseg': 5}))
    objs.append(part('king_scap', 'sphere', gold, loc=(-0.64, -0.52, 2.15), size=(0.07, 0.07, 0.05), sub=1, args={'seg': 8, 'rings': 5}))
    orb = glow('king_orb', 0xff7a2a)
    core = glow('king_core', 0xffd27a)
    objs.append(part('king_orb', 'sphere', orb, loc=(-0.64, -0.52, 2.3), size=0.11, sub=0, args={'seg': 12, 'rings': 8}))
    objs.append(tube('king_flame', orb, bez((0.64, -0.48, 1.18), (0.7, -0.5, 1.36), (0.6, -0.48, 1.55), 6), [0.1, 0.11, 0.08, 0.05, 0.025, 0.0], seg=8, sub=1))
    objs.append(tube('king_flamecore', core, bez((0.64, -0.5, 1.18), (0.67, -0.52, 1.3), (0.63, -0.52, 1.4), 4), [0.055, 0.05, 0.025, 0.0], seg=6, sub=1))
    em = eye('king', 0xff7a2a)
    objs += eye_pair(em, 0.075, -0.2, 2.04, (0.045, 0.03, 0.03), tilt=15, on=[head], sink=0.55)
    return objs


king.finish = {'ao_strength': 0.55, 'distance': 0.5}
