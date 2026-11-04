"""Player character "the Bearer": hooded pilgrim with a crooked staff and a hanging lantern.

Exported as SEPARATE nodes with origins at their animation pivots so src/entities/Player.ts can
animate them procedurally:
  Body (0,0,0)          robe, sleeves, hands, belt, satchel, scarf
  Head (neck)           hood + dark face + glowing eyes
  Cape (shoulders)      capelet + trailing scarf tail
  Staff (hand grip)     staff with crook
  LanternCage (hook)    hanging lantern (swings); child EMPTY "lantern" = light position
  FootL / FootR (ankle) boots
Material names: robe* are tinted per bearer at runtime (vertex colours carry grayscale shading);
*glow* / *eye* are unlit glow parts.
"""
import math

from mathutils import Vector

import lib
from lib import part, tube, bez, paint, mix, smooth, material, deform_obj, set_origin, join, empty, parent_keep  # noqa: F401


def bearer():
    robe = material('robe', 0x6a5aa0, rough=0.8)
    cape_m = material('robe_cape', 0x6a5aa0, rough=0.85)
    trim = material('trim', 0xf0d49a, rough=0.5)
    scarf = material('scarf', 0xffffff, rough=0.75)
    leather = material('leather', 0x7a4a30, rough=0.7)
    boot = material('boot', 0x5a3626, rough=0.7)
    wood = material('wood', 0xffffff, rough=0.75)
    brass = material('brass', 0xe0a850, rough=0.35, metal=0.3)
    face = material('face', 0x241a36, rough=1.0)
    eye = material('bearer_eye', 0xffd890, glow=True)
    glass = material('lantern_glass_glow', 0xffb44a, glow=True)

    def robe_p(p, n):
        th = math.atan2(p.y, p.x)
        g = 0.62 + 0.38 * smooth(0.05, 1.35, p.z)
        g *= 1.0 - 0.12 * (0.5 + 0.5 * math.cos(7 * th)) * (1.0 - smooth(0.2, 1.0, p.z))
        g = g + (1.0 - g) * smooth(0.5, 1.0, n.z) * 0.4
        return (g, g * 0.98, g * 0.96)

    def scarf_p(p, n):
        c = mix(0xd88a2a, 0xffc85a, smooth(-0.4, 0.9, n.z))
        st = 0.5 + 0.5 * math.sin((p.z + p.x) * 40.0)
        return mix(c, 0xb0402a, smooth(0.75, 0.9, st) * 0.6)

    # ---------------------------------------------------------------- Body
    prof = [(0.07, 0.0), (0.08, 0.36), (0.3, 0.35), (0.6, 0.3), (0.9, 0.26), (1.1, 0.27), (1.22, 0.265), (1.32, 0.17), (1.38, 0.0)]
    gown = tube('b_gown', robe, [(0, 0, z) for z, r in prof], [r for z, r in prof], seg=14, sub=1)

    def folds(p):
        r = math.hypot(p.x, p.y)
        if r < 1e-4:
            return p
        th = math.atan2(p.y, p.x)
        w = 1.0 - smooth(0.15, 0.9, p.z)
        k = 1.0 + 0.055 * math.cos(7 * th) * w
        return Vector((p.x * k, p.y * k, p.z))

    deform_obj(gown, folds)
    body = [gown]
    body.append(tube('b_sleeveL', robe, [(0.22, 0.0, 1.2), (0.35, -0.05, 1.06), (0.37, -0.15, 0.98)], [0.09, 0.1, 0.11], seg=8, sub=1))
    body.append(tube('b_sleeveR', robe, [(-0.22, 0.0, 1.2), (-0.33, -0.03, 0.98), (-0.31, -0.09, 0.8)], [0.09, 0.1, 0.11], seg=8, sub=1))
    for o in body:
        paint(o, robe_p)
    body.append(part('b_handL', 'sphere', leather, loc=(0.37, -0.2, 0.98), size=(0.07, 0.07, 0.075), sub=1, args={'seg': 8, 'rings': 6}))
    body.append(part('b_handR', 'sphere', leather, loc=(-0.31, -0.12, 0.75), size=(0.065, 0.065, 0.07), sub=1, args={'seg': 8, 'rings': 6}))
    body.append(part('b_belt', 'torus', leather, loc=(0, 0, 0.8), size=1, sub=0, args={'major': 0.285, 'minor': 0.035, 'seg': 16, 'mseg': 5}))
    body.append(part('b_buckle', 'cube', brass, loc=(0, -0.31, 0.8), size=(0.045, 0.02, 0.04), sub=1))
    body.append(part('b_satchel', 'cube', leather, loc=(-0.3, 0.06, 0.66), size=(0.06, 0.12, 0.1), sub=2))
    body.append(part('b_hemtrim', 'torus', trim, loc=(0, 0, 0.11), size=1, sub=0, args={'major': 0.325, 'minor': 0.032, 'seg': 18, 'mseg': 5}))
    sc = part('b_scarf', 'torus', scarf, loc=(0, 0.0, 1.24), size=(1, 1, 1.1), sub=1, args={'major': 0.19, 'minor': 0.075, 'seg': 12, 'mseg': 6})
    paint(sc, scarf_p)
    body.append(sc)
    Body = join(body, 'Body')

    # ---------------------------------------------------------------- Head
    hood = part('h_hood', 'sphere', robe, loc=(0, 0.03, 1.56), size=(0.3, 0.3, 0.29), sub=1, args={'seg': 12, 'rings': 8})
    tip = tube('h_tip', robe, bez((0, 0.1, 1.78), (0, 0.4, 1.86), (0.05, 0.56, 1.6), 6), [0.15, 0.12, 0.09, 0.06, 0.03, 0.0], seg=8, sub=1)
    rim = part('h_rim', 'torus', robe, loc=(0, -0.255, 1.52), size=(1, 1, 1.12), rot=(90, 0, 0), sub=1, args={'major': 0.18, 'minor': 0.05, 'seg': 14, 'mseg': 6})
    for o in (hood, tip, rim):
        paint(o, robe_p)
    fc = part('h_face', 'sphere', face, loc=(0, -0.2, 1.51), size=(0.19, 0.1, 0.19), sub=1, args={'seg': 10, 'rings': 6})
    head = [hood, tip, rim, fc]
    eyes = []
    for sx in (1, -1):
        y = (lib.surface_y([fc], sx * 0.065, 1.52) or -0.29) + 0.008
        eyes.append(part('h_eye', 'sphere', eye, loc=(sx * 0.065, y, 1.52), size=(0.04, 0.02, 0.05), sub=0, args={'seg': 10, 'rings': 6}))
    Head = join(head, 'Head')
    Eyes = join(eyes, 'HeadEyes')

    # ---------------------------------------------------------------- Cape
    cap = tube('c_cape', cape_m, [(0, 0.02, 1.36), (0, 0.03, 1.12), (0, 0.05, 0.9)], [0.22, 0.34, 0.4], seg=14, sub=1, cap=False)
    deform_obj(cap, lambda p: Vector((p.x, p.y + 0.06 * smooth(0.0, 0.4, p.y) * (1.0 - smooth(0.9, 1.3, p.z)), p.z - 0.05 * smooth(-0.1, 0.4, -p.y) * (1.0 - smooth(0.9, 1.2, p.z)))))
    paint(cap, lambda p, n: (lambda g: (g * 0.85, g * 0.83, g * 0.82))(0.7 + 0.3 * smooth(0.85, 1.35, p.z)))
    ctrim = part('c_trim', 'torus', trim, loc=(0, 0.05, 0.91), size=1, sub=0, args={'major': 0.355, 'minor': 0.025, 'seg': 18, 'mseg': 4})
    deform_obj(ctrim, lambda p: Vector((p.x, p.y + 0.06 * smooth(0.0, 0.45, p.y), p.z - 0.05 * smooth(-0.1, 0.45, -p.y))))
    tail = tube('c_scarftail', scarf, bez((0.1, 0.16, 1.22), (0.16, 0.42, 1.1), (0.12, 0.5, 0.72), 6), [0.065, 0.065, 0.06, 0.055, 0.05, 0.045], seg=6, sub=1, flat=(1.0, 0.35))
    paint(tail, scarf_p)
    Cape = join([cap, ctrim, tail], 'Cape')

    # ---------------------------------------------------------------- Staff
    shaft = tube('s_shaft', wood, [(0.355, -0.19, 0.03), (0.37, -0.2, 1.0), (0.38, -0.21, 1.95)], [0.03, 0.038, 0.034], seg=7, sub=1)
    crook = tube('s_crook', wood, bez((0.38, -0.21, 1.9), (0.4, -0.26, 2.3), (0.6, -0.42, 2.14), 7) + [Vector((0.61, -0.43, 2.08))],
                 [0.034, 0.034, 0.032, 0.03, 0.028, 0.026, 0.025, 0.022], seg=7, sub=1)
    wood_p = lambda p, n: mix(0x5a341e, 0x9a6a3e, smooth(-0.6, 0.8, n.z * 0.4 + n.x * 0.6))  # noqa: E731
    paint(shaft, wood_p)
    paint(crook, wood_p)
    wrap = part('s_wrap', 'cyl', scarf, loc=(0.373, -0.203, 1.22), size=1, sub=0, args={'seg': 8, 'r1': 0.048, 'r2': 0.046, 'depth': 0.12})
    paint(wrap, scarf_p)
    knot = part('s_knot', 'sphere', brass, loc=(0.385, -0.215, 1.95), size=0.045, sub=1, args={'seg': 8, 'rings': 5})
    Staff = join([shaft, crook, wrap, knot], 'Staff')

    # ---------------------------------------------------------------- Lantern
    hx, hy, hz = 0.61, -0.43, 2.06
    lt = []
    lt.append(part('l_handle', 'torus', brass, loc=(hx, hy, hz - 0.04), size=1, rot=(90, 0, 0), sub=0, args={'major': 0.045, 'minor': 0.012, 'seg': 10, 'mseg': 4}))
    lt.append(part('l_top', 'cyl', brass, loc=(hx, hy, hz - 0.12), size=1, sub=1, args={'seg': 8, 'r1': 0.115, 'r2': 0.05, 'depth': 0.07}))
    lt.append(part('l_bot', 'cyl', brass, loc=(hx, hy, hz - 0.37), size=1, sub=1, args={'seg': 8, 'r1': 0.08, 'r2': 0.105, 'depth': 0.05}))
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        bx, by = hx + math.cos(a) * 0.09, hy + math.sin(a) * 0.09
        lt.append(tube('l_bar', brass, [(bx, by, hz - 0.36), (bx * 1.0, by, hz - 0.15)], [0.012, 0.012], seg=4, sub=0))
    cage = join(lt, 'LanternCage')
    gl = part('l_glass', 'cyl', glass, loc=(hx, hy, hz - 0.255), size=1, sub=1, args={'seg': 8, 'r1': 0.082, 'r2': 0.082, 'depth': 0.2})
    gl.name = 'LanternGlass'

    feet = []
    for sx, nm in ((1, 'FootL'), (-1, 'FootR')):
        f = part(nm, 'sphere', boot, loc=(sx * 0.13, -0.17, 0.065), size=(0.09, 0.14, 0.07), sub=1, args={'seg': 10, 'rings': 6},
                 deform=lambda v: Vector((v.x, v.y, max(v.z, -0.06))))
        f.name = nm
        feet.append(f)

    # pivots
    set_origin(Head, (0, 0, 1.3))
    set_origin(Eyes, (0, 0, 1.3))
    set_origin(Cape, (0, 0.04, 1.3))
    set_origin(Staff, (0.37, -0.2, 0.98))
    set_origin(cage, (hx, hy, hz))
    set_origin(gl, (hx, hy, hz))
    set_origin(feet[0], (0.13, -0.1, 0.1))
    set_origin(feet[1], (-0.13, -0.1, 0.1))
    parent_keep(Eyes, Head)
    parent_keep(gl, cage)
    anchor = empty('lantern', (hx, hy, hz - 0.255))
    parent_keep(anchor, cage)
    return [Body, Head, Eyes, Cape, Staff, cage, gl, anchor] + feet


bearer.finish = {'ao_strength': 0.5, 'distance': 0.4}
