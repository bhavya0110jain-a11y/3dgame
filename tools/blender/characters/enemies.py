"""Regular enemy models (instanced by the hundreds: keep each < ~2.5k triangles).

Blender space: Z up, FRONT = -Y, feet on z = 0. Palette rules ("moonlit storybook"):
saturated mid-value hues that pop against the blue moonlit ground, lighter bellies / rims,
big glowing eyes, never near-black bodies.
"""
import math

from mathutils import Vector

import lib
from lib import part, tube, bez, paint, mix, smooth, material, mirror_x, deform_obj  # noqa: F401

WHITE = 0xffffff


def body_mat(name):
    return material(name, WHITE, rough=0.6)


def glow(name, color, strength=1.0):
    return material(name + '_glow', color, glow=True, strength=strength)


def eye(name, color):
    return material(name + '_eye', color, glow=True)


def eye_pair(mat, x, y, z, size, tilt=15.0, seg=10, rings=6, yaw=0.0, on=None, sink=0.3):
    """Two glowing oval eyes, mirrored on X. tilt>0 = angry (inner corner down).
    on: snap Y onto the front surface of these objects (eye pokes out by (1-sink) of its depth)."""
    if on:
        sy = lib.surface_y(on, x, z)
        if sy is not None:
            y = sy + size[1] * sink
    a = part('eyeL', 'sphere', mat, loc=(x, y, z), size=size, rot=(0, tilt, yaw), sub=0, args={'seg': seg, 'rings': rings})
    b = part('eyeR', 'sphere', mat, loc=(-x, y, z), size=size, rot=(0, -tilt, -yaw), sub=0, args={'seg': seg, 'rings': rings})
    return [a, b]


def sym(fn):
    """Build a part for +X and mirror it to -X."""
    a = fn()
    return [a, mirror_x(a)]


def top_light(c, light, k=0.35):
    return lambda p, n, _c=c: mix(_c(p, n) if callable(_c) else _c, light, smooth(0.35, 1.0, n.z) * k)


# ============================================================================================ SHADE
def shade():
    """Hooded ghost: violet bell body with a scalloped hem, dark face hollow, big slanted eyes,
    reaching sleeve-arms and a floppy hood tip."""
    skin = body_mat('shade_skin')
    objs = []
    prof = [(0.34, 0.0), (0.2, 0.28), (0.16, 0.44), (0.32, 0.47), (0.55, 0.43), (0.78, 0.37),
            (0.98, 0.34), (1.15, 0.33), (1.30, 0.25), (1.40, 0.0)]
    b = tube('shade_body', skin, [(0, 0, z) for z, r in prof], [r for z, r in prof], seg=12, sub=1)

    def hem(p):
        th = math.atan2(p.y, p.x)
        w = 1.0 - smooth(0.12, 0.55, p.z)
        r = math.hypot(p.x, p.y)
        z = p.z - 0.09 * (0.5 + 0.5 * math.cos(6 * th)) * w
        # slight forward lean of the head
        lean = smooth(0.6, 1.4, p.z) * 0.08
        return Vector((p.x, p.y - lean, z)) if r > 0 else p

    deform_obj(b, hem)
    objs.append(b)
    hood = tube('shade_hood', skin, bez((0, -0.02, 1.3), (0, 0.22, 1.55), (0, 0.5, 1.36), 6),
                [0.2, 0.17, 0.13, 0.09, 0.05, 0.0], seg=8, sub=1)
    objs.append(hood)

    def arm():
        return tube('shade_arm', skin, bez((0.28, -0.02, 0.92), (0.55, -0.1, 0.9), (0.62, -0.42, 0.66), 5),
                    [0.12, 0.12, 0.1, 0.07, 0.0], seg=7, sub=1)

    objs += sym(arm)
    face_dark = (0.10, 0.05, 0.20)

    def painter(p, n):
        c = mix(0x8a3ee0, 0xf0a8ff, 1.0 - smooth(0.12, 0.85, p.z))  # violet -> lavender-pink hem
        c = mix(c, 0xb890ff, smooth(0.4, 1.0, n.z) * 0.45)  # moonlit top
        # face hollow (front of head)
        fx = (p.x / 0.25) ** 2 + ((p.z - 1.05) / 0.2) ** 2
        f = (1.0 - smooth(0.55, 1.0, fx)) * smooth(-0.1, -0.55, n.y)
        return mix(c, face_dark, f)

    for o in objs:
        paint(o, painter)
    em = eye('shade', 0xf6b0ff)
    objs += eye_pair(em, 0.1, -0.31, 1.06, (0.075, 0.04, 0.1), tilt=24, on=[b], sink=0.45)
    return objs


shade.finish = {'ao_strength': 0.55}


# ============================================================================================ CRAWLER
def crawler():
    """Ember beetle-spider: crimson striped carapace, plum legs, bone mandibles, 4 amber eyes."""
    shell = body_mat('crawler_shell')
    leg = material('crawler_leg', 0x5a2450, rough=0.5)
    bone = material('crawler_bone', 0xf3dcb0, rough=0.45)
    objs = []
    cara = part('crawler_cara', 'sphere', shell, loc=(0, 0.12, 0.42), size=(0.5, 0.6, 0.32), sub=1,
                args={'seg': 12, 'rings': 8}, deform=lambda v: Vector((v.x, v.y, max(v.z, -0.12) + 0.04 * math.cos(v.y * 6))))
    head = part('crawler_head', 'sphere', shell, loc=(0, -0.46, 0.37), size=(0.27, 0.24, 0.21), sub=1, args={'seg': 10, 'rings': 6})
    objs += [cara, head]

    def painter(p, n):
        top = smooth(-0.1, 0.5, n.z)
        c = mix(0x3d1838, 0xd4363f, top)  # plum belly -> crimson back
        band = 0.0
        for cy in (-0.12, 0.2, 0.5):
            band = max(band, 1.0 - smooth(0.03, 0.07, abs(p.y - cy)))
        c = mix(c, 0xff9a4a, band * top * 0.9)  # glowing-orange stripes
        c = mix(c, 0xff7d6a, smooth(0.75, 1.0, n.z) * 0.35)  # specular-ish top
        if p.y < -0.3:  # head darker
            c = mix(c, 0x7a2048, 0.55)
        return c

    paint(cara, painter)
    paint(head, painter)
    for y0, dy in ((-0.25, -0.32), (0.08, 0.0), (0.4, 0.3)):
        def mk(y0=y0, dy=dy):
            return tube('crawler_leg', leg, bez((0.3, y0, 0.4), (0.82, y0 + dy * 0.5, 0.95), (0.95, y0 + dy, 0.0), 5),
                        [0.075, 0.065, 0.05, 0.035, 0.0], seg=5, sub=1)
        objs += sym(mk)
    objs += sym(lambda: tube('crawler_mand', bone, bez((0.1, -0.62, 0.3), (0.16, -0.8, 0.3), (0.0, -0.86, 0.26), 4),
                             [0.045, 0.04, 0.025, 0.0], seg=5, sub=1))
    em = eye('crawler', 0xffc444)
    objs += eye_pair(em, 0.09, -0.66, 0.43, (0.07, 0.045, 0.065), tilt=18, on=[head])
    objs += eye_pair(em, 0.17, -0.58, 0.5, (0.045, 0.035, 0.045), tilt=10, seg=8, rings=5, on=[head])
    sp = glow('crawler_spot', 0xff8a3a)
    objs.append(part('spot', 'sphere', sp, loc=(0.14, 0.2, 0.73), size=(0.05, 0.05, 0.03), sub=0, args={'seg': 8, 'rings': 5}))
    objs.append(part('spot', 'sphere', sp, loc=(-0.14, 0.2, 0.73), size=(0.05, 0.05, 0.03), sub=0, args={'seg': 8, 'rings': 5}))
    return objs


crawler.finish = {'ao_strength': 0.6}


# ============================================================================================ WISP
def wisp():
    """Hollow Wisp: round teal imp head with little horns, huge white-cyan eyes, a cyan flame crest and
    a curling flame tail (glow)."""
    skin = body_mat('wisp_skin')
    objs = []
    head = part('wisp_head', 'sphere', skin, loc=(0, 0, 0.78), size=(0.32, 0.3, 0.29), sub=1, args={'seg': 12, 'rings': 8})
    objs.append(head)
    objs += sym(lambda: tube('wisp_horn', skin, bez((0.2, 0.02, 0.98), (0.3, 0.0, 1.08), (0.36, 0.08, 1.2), 4),
                             [0.08, 0.06, 0.03, 0.0], seg=6, sub=1))
    objs += sym(lambda: part('wisp_hand', 'sphere', skin, loc=(0.33, -0.12, 0.6), size=(0.08, 0.08, 0.1), sub=1, args={'seg': 8, 'rings': 5}))

    def painter(p, n):
        c = mix(0x16708e, 0x33b8c8, smooth(0.5, 0.95, p.z))
        c = mix(c, 0x9ef3f0, smooth(0.45, 1.0, n.z) * 0.55)
        # cheeks
        ch = 1.0 - smooth(0.0, 0.07, (p.x ** 2 + (p.z - 0.68) ** 2) ** 0.5 - 0.13)
        c = mix(c, 0x58d8e0, ch * smooth(-0.2, -0.6, n.y) * 0.4)
        return c

    for o in objs:
        paint(o, painter)
    fl = glow('wisp_flame', 0x46e6ff)
    core = glow('wisp_core', 0xbaffff)
    objs.append(tube('wisp_tail', fl, bez((0, 0.05, 0.62), (0.0, 0.2, 0.15), (0.0, 0.55, 0.32), 7),
                     [0.2, 0.18, 0.14, 0.1, 0.07, 0.04, 0.0], seg=8, sub=1))
    objs.append(tube('wisp_crest', fl, bez((0, 0.05, 0.98), (0, 0.15, 1.25), (0, 0.38, 1.32), 5),
                     [0.13, 0.1, 0.07, 0.035, 0.0], seg=7, sub=1))
    objs.append(tube('wisp_crest2', fl, bez((0.08, -0.06, 0.99), (0.15, 0.0, 1.15), (0.14, 0.18, 1.2), 4),
                     [0.07, 0.05, 0.025, 0.0], seg=6, sub=1))
    objs.append(tube('wisp_crest3', fl, bez((-0.08, -0.06, 0.99), (-0.15, 0.0, 1.15), (-0.14, 0.18, 1.2), 4),
                     [0.07, 0.05, 0.025, 0.0], seg=6, sub=1))
    em = eye('wisp', 0xe6ffff)
    objs += eye_pair(em, 0.11, -0.25, 0.8, (0.075, 0.045, 0.105), tilt=-8, on=[head], sink=0.45)
    objs.append(part('wisp_mouth', 'sphere', core, loc=(0, -0.29, 0.66), size=(0.05, 0.02, 0.025), sub=0, args={'seg': 8, 'rings': 4}))
    return objs


wisp.finish = {'ao_strength': 0.5}


# ============================================================================================ BRUTE
def brute():
    """Gloom Brute: hunched plum-magenta ogre, huge forearms and fists, bone horns + tusks,
    small angry orange eyes, glowing ember crack across the chest."""
    skin = body_mat('brute_skin')
    bone = material('brute_bone', 0xf1e3c2, rough=0.45)
    objs = []
    torso = part('brute_torso', 'sphere', skin, loc=(0, 0.06, 1.0), size=(0.62, 0.5, 0.56), rot=(18, 0, 0), sub=1,
                 args={'seg': 12, 'rings': 8})
    belly = part('brute_belly', 'sphere', skin, loc=(0, -0.2, 0.78), size=(0.46, 0.36, 0.38), sub=1, args={'seg': 10, 'rings': 6})
    head = part('brute_head', 'sphere', skin, loc=(0, -0.4, 1.33), size=(0.25, 0.25, 0.22), sub=1, args={'seg': 10, 'rings': 6})
    jaw = part('brute_jaw', 'sphere', skin, loc=(0, -0.47, 1.2), size=(0.23, 0.2, 0.12), sub=1, args={'seg': 10, 'rings': 6})
    brow = part('brute_brow', 'sphere', skin, loc=(0, -0.58, 1.415), size=(0.21, 0.08, 0.055), rot=(-10, 0, 0), sub=1, args={'seg': 8, 'rings': 5})
    objs += [torso, belly, head, jaw, brow]
    objs += sym(lambda: part('brute_shoulder', 'sphere', skin, loc=(0.47, 0.02, 1.32), size=(0.3, 0.3, 0.27), sub=1, args={'seg': 10, 'rings': 6}))
    objs += sym(lambda: tube('brute_uarm', skin, [(0.55, -0.02, 1.28), (0.72, -0.1, 1.02), (0.76, -0.18, 0.8)], [0.18, 0.15, 0.14], seg=8, sub=1))
    objs += sym(lambda: tube('brute_farm', skin, [(0.76, -0.18, 0.82), (0.8, -0.24, 0.6), (0.74, -0.28, 0.4)], [0.16, 0.21, 0.17], seg=8, sub=1))
    fist = material('brute_fist', WHITE)
    objs += sym(lambda: part('brute_fist', 'sphere', fist, loc=(0.74, -0.3, 0.27), size=(0.22, 0.22, 0.2), sub=1, args={'seg': 10, 'rings': 6}))
    objs += sym(lambda: tube('brute_leg', skin, [(0.26, 0.12, 0.72), (0.3, 0.1, 0.35), (0.3, 0.06, 0.12)], [0.21, 0.19, 0.16], seg=8, sub=1))
    objs += sym(lambda: part('brute_foot', 'sphere', fist, loc=(0.3, -0.04, 0.08), size=(0.17, 0.24, 0.1), sub=1, args={'seg': 8, 'rings': 5}))

    def painter(p, n):
        c = mix(0x7c2f6c, 0xa94a90, smooth(0.3, 1.4, p.z))
        bel = smooth(0.15, 0.6, -n.y) * (1.0 - smooth(1.05, 1.2, p.z)) * smooth(0.45, 0.6, p.z) * (1.0 - smooth(0.3, 0.45, abs(p.x)))
        c = mix(c, 0xf29ac0, bel)
        c = mix(c, 0xd06cb4, smooth(0.5, 1.0, n.z) * 0.4)
        return c

    for o in objs:
        if o.data.materials[0] is skin:
            paint(o, painter)
        elif o.data.materials[0] is fist:
            paint(o, lambda p, n: mix(0x4e1c4c, 0x8a3a7c, smooth(0.2, 1.0, n.z)))
    objs += sym(lambda: tube('brute_horn', bone, bez((0.15, -0.36, 1.48), (0.46, -0.3, 1.52), (0.42, -0.5, 1.8), 6),
                             [0.08, 0.07, 0.055, 0.04, 0.02, 0.0], seg=7, sub=1))
    objs += sym(lambda: tube('brute_tusk', bone, bez((0.11, -0.6, 1.2), (0.14, -0.66, 1.3), (0.1, -0.63, 1.38), 4),
                             [0.035, 0.03, 0.018, 0.0], seg=5, sub=1))
    for x, y, z in ((0.0, 0.42, 1.38), (0.2, 0.38, 1.2), (-0.2, 0.38, 1.2)):
        objs.append(tube('brute_spike', bone, [(x, y - 0.1, z - 0.05), (x, y + 0.05, z + 0.12), (x, y + 0.18, z + 0.18)], [0.08, 0.04, 0.0], seg=6, sub=1))
    em = eye('brute', 0xffa83a)
    objs += eye_pair(em, 0.1, -0.6, 1.35, (0.065, 0.04, 0.05), tilt=20, on=[head, jaw], sink=0.45)
    gl = glow('brute_ember', 0xff7a22)
    objs.append(tube('brute_rune', gl, [(-0.2, -0.5, 1.0), (-0.1, -0.555, 0.95), (-0.04, -0.565, 1.0), (0.04, -0.565, 0.9), (0.1, -0.555, 0.94), (0.17, -0.52, 0.84)],
                     [0.0, 0.03, 0.035, 0.035, 0.03, 0.0], seg=5, sub=0))
    return objs


brute.finish = {'ao_strength': 0.6}


# ============================================================================================ STALKER
def stalker():
    """Stalker: hunched royal-blue mantis-hunter with big raised bone scythes, swept head crest,
    yellow slit eyes, digitigrade legs and a whip tail."""
    skin = body_mat('stalker_skin')
    bone = material('stalker_bone', 0xf2e4c4, rough=0.4)
    objs = []
    torso = tube('stalker_torso', skin, [(0, 0.3, 0.8), (0, 0.08, 1.02), (0, -0.16, 1.18), (0, -0.3, 1.3)],
                 [0.2, 0.3, 0.27, 0.16], seg=9, sub=1)
    head = tube('stalker_head', skin, [(0, -0.22, 1.36), (0, -0.46, 1.46), (0, -0.7, 1.4), (0, -0.88, 1.28)],
                [0.17, 0.2, 0.13, 0.0], seg=8, sub=1, flat=(1.0, 0.82))
    objs += [torso, head]
    objs.append(tube('stalker_tail', skin, bez((0, 0.34, 0.8), (0, 0.9, 0.5), (0, 1.05, 0.98), 6),
                     [0.15, 0.12, 0.09, 0.06, 0.035, 0.0], seg=6, sub=1))
    objs += sym(lambda: tube('stalker_leg', skin, [(0.19, 0.26, 0.85), (0.3, -0.02, 0.52), (0.3, 0.32, 0.24), (0.3, 0.16, 0.03)],
                             [0.15, 0.1, 0.075, 0.06], seg=6, sub=1))
    objs += sym(lambda: tube('stalker_uarm', skin, [(0.2, -0.18, 1.22), (0.4, -0.28, 1.42), (0.46, -0.36, 1.5)], [0.1, 0.085, 0.08], seg=6, sub=1))

    def painter(p, n):
        c = mix(0x2b3fb8, 0x4d68ec, smooth(0.4, 1.4, p.z))
        bel = smooth(0.0, 0.6, -n.y) * smooth(0.2, -0.2, n.z)
        c = mix(c, 0xb4c4ff, bel * 0.85)
        st = 0.5 + 0.5 * math.sin(p.y * 20.0)
        c = mix(c, 0x1c2478, smooth(0.6, 0.9, st) * smooth(0.2, 0.7, n.z) * 0.75)
        c = mix(c, 0x9ab0ff, smooth(0.75, 1.0, n.z) * 0.3)
        return c

    for o in objs:
        paint(o, painter)
    objs += sym(lambda: tube('stalker_blade', bone, bez((0.46, -0.36, 1.5), (0.56, -1.0, 1.68), (0.4, -1.0, 0.9), 7),
                             [0.09, 0.1, 0.095, 0.08, 0.06, 0.035, 0.0], seg=6, sub=1, flat=(1.0, 0.3)))
    objs.append(tube('stalker_crest', bone, bez((0, -0.42, 1.6), (0, -0.12, 1.85), (0, 0.22, 1.8), 5),
                     [0.09, 0.08, 0.055, 0.025, 0.0], seg=6, sub=1, flat=(0.45, 1.0)))
    for y in (0.02, 0.22):
        objs.append(tube('stalker_spine', bone, [(0, y, 1.2 - y * 0.6), (0, y + 0.1, 1.38 - y * 0.6)], [0.06, 0.0], seg=5, sub=1))
    em = eye('stalker', 0xffe44a)
    objs += eye_pair(em, 0.11, -0.58, 1.49, (0.08, 0.035, 0.03), tilt=25, yaw=-25, on=[head], sink=0.4)
    return objs


stalker.finish = {'ao_strength': 0.55}


# ============================================================================================ SPITTER
def spitter():
    """Bile Spitter: mustard-orange sac with a cream belly, a spitting snout with a glowing green maw,
    two eyes on stalks and glowing green pustules."""
    skin = body_mat('spitter_skin')
    objs = []
    sac = part('spitter_sac', 'sphere', skin, loc=(0, 0.06, 0.56), size=(0.52, 0.52, 0.46), sub=1, args={'seg': 12, 'rings': 8},
               deform=lambda v: Vector((v.x * (1.0 + 0.12 * max(0, -v.z) / 0.46), v.y * (1.0 + 0.12 * max(0, -v.z) / 0.46), v.z)))
    snout = tube('spitter_snout', skin, [(0, -0.32, 0.6), (0, -0.52, 0.66), (0, -0.66, 0.72)], [0.2, 0.15, 0.14], seg=10, sub=1)
    objs += [sac, snout]
    objs += sym(lambda: tube('spitter_stalk', skin, bez((0.13, -0.18, 0.92), (0.2, -0.22, 1.1), (0.27, -0.24, 1.18), 4), [0.06, 0.05, 0.045, 0.045], seg=6, sub=1))
    objs += sym(lambda: part('spitter_lid', 'sphere', skin, loc=(0.28, -0.22, 1.22), size=(0.1, 0.1, 0.1), sub=1, args={'seg': 8, 'rings': 6}))
    for x, y in ((0.36, -0.2), (0.36, 0.3)):
        objs += sym(lambda x=x, y=y: part('spitter_leg', 'sphere', skin, loc=(x, y, 0.1), size=(0.13, 0.18, 0.11), sub=1, args={'seg': 8, 'rings': 5}))

    def painter(p, n):
        c = mix(0xc0480e, 0xff8a1a, smooth(0.1, 0.9, p.z))
        bel = smooth(0.35, 0.75, -n.y) * smooth(0.3, 0.42, p.z) * (1.0 - smooth(0.8, 0.9, p.z))
        c = mix(c, 0xffd070, bel * 0.85)
        # darker ochre spots
        s = math.sin(p.x * 17.0) * math.sin(p.y * 15.0 + 1.3) * math.sin(p.z * 13.0)
        c = mix(c, 0x8a2a10, smooth(0.35, 0.6, s) * smooth(0.0, 0.5, n.z) * 0.7)
        c = mix(c, 0xffb040, smooth(0.6, 1.0, n.z) * 0.3)
        return c

    for o in objs:
        paint(o, painter)
    g = glow('spitter_bile', 0x9cff3a)
    objs.append(part('spitter_maw', 'torus', g, loc=(0, -0.665, 0.72), size=1, rot=(90, 0, 0), sub=0,
                     args={'major': 0.1, 'minor': 0.04, 'seg': 12, 'mseg': 5}))
    objs.append(part('spitter_throat', 'sphere', g, loc=(0, -0.64, 0.72), size=(0.09, 0.03, 0.09), sub=0, args={'seg': 10, 'rings': 4}))
    for x, y, z, r in ((0.22, 0.3, 0.86, 0.1), (-0.27, 0.24, 0.78, 0.085), (0.0, 0.42, 0.6, 0.095), (-0.06, 0.16, 1.0, 0.075), (0.36, 0.05, 0.55, 0.07)):
        objs.append(part('spitter_pus', 'sphere', g, loc=(x, y, z), size=r, sub=0, args={'seg': 10, 'rings': 6}))
    em = eye('spitter', 0xe0ff6a)
    objs += eye_pair(em, 0.28, -0.3, 1.22, (0.065, 0.045, 0.065), tilt=0, on=[o for o in objs if o.name.startswith('spitter_lid')], sink=0.4)
    return objs


spitter.finish = {'ao_strength': 0.55}


# ============================================================================================ BOG
def bog():
    """Bog Lurker: wide mossy toad-mound with a big dark grin, bulging mint eyes, moss clumps,
    bioluminescent mushrooms and reeds growing from its back."""
    skin = body_mat('bog_skin')
    moss = material('bog_moss', WHITE)
    stem = material('bog_stem', 0xe8e0c0)
    reed = material('bog_reed', 0x8fb84a)
    bone = material('bog_tooth', 0xf2ead0)
    objs = []
    body = part('bog_body', 'sphere', skin, loc=(0, 0.05, 0.4), size=(0.64, 0.7, 0.44), sub=1, args={'seg': 14, 'rings': 8},
                deform=lambda v: Vector((v.x, v.y, max(v.z, -0.36))))
    objs.append(body)
    objs += sym(lambda: part('bog_bulb', 'sphere', skin, loc=(0.25, -0.36, 0.76), size=(0.16, 0.15, 0.15), sub=1, args={'seg': 10, 'rings': 6}))
    objs += sym(lambda: tube('bog_arm', skin, [(0.46, -0.3, 0.32), (0.58, -0.42, 0.14), (0.6, -0.5, 0.05)], [0.13, 0.11, 0.1], seg=7, sub=1))

    def painter(p, n):
        c = mix(0x2f6e3a, 0x5aae4c, smooth(0.0, 0.8, p.z))
        bel = smooth(0.1, 0.6, -n.y) * (1.0 - smooth(0.42, 0.52, p.z + 0.25 * p.x * p.x))
        c = mix(c, 0xe4de92, bel * 0.85)
        # grin: dark band across the front, curving up at the corners
        mz = 0.44 + 0.55 * p.x * p.x
        m = (1.0 - smooth(0.018, 0.04, abs(p.z - mz))) * smooth(-0.2, -0.55, n.y) * (1.0 - smooth(0.42, 0.5, abs(p.x)))
        c = mix(c, 0x13261b, m)
        s = math.sin(p.x * 13.0 + 0.7) * math.sin(p.y * 11.0) * math.sin(p.z * 9.0 + 2.0)
        c = mix(c, 0x2b5e33, smooth(0.3, 0.55, s) * smooth(0.1, 0.6, n.z) * 0.7)
        c = mix(c, 0x9ad466, smooth(0.6, 1.0, n.z) * 0.3)
        return c

    for o in objs:
        paint(o, painter)
    for x, y, z, r in ((0.3, 0.25, 0.72, 0.17), (-0.32, 0.18, 0.7, 0.15), (0.05, 0.5, 0.58, 0.16), (-0.12, 0.05, 0.82, 0.13)):
        m = part('bog_mossclump', 'sphere', moss, loc=(x, y, z), size=(r, r, r * 0.6), sub=1, args={'seg': 8, 'rings': 5})
        paint(m, lambda p, n: mix(0x23562e, 0x4c9a3e, smooth(0.0, 1.0, n.z)))
        objs.append(m)
    cap = glow('bog_shroom', 0x5cf6d2)
    for x, y, z, h, r in ((0.22, 0.32, 0.78, 0.2, 0.11), (-0.3, 0.26, 0.76, 0.14, 0.08), (0.02, 0.5, 0.66, 0.17, 0.09)):
        objs.append(tube('bog_stem', stem, [(x, y, z), (x, y + 0.02, z + h)], [0.035, 0.03], seg=6, sub=0))
        objs.append(part('bog_cap', 'sphere', cap, loc=(x, y + 0.02, z + h), size=(r, r, r * 0.55), sub=0, args={'seg': 10, 'rings': 5},
                         deform=lambda v: Vector((v.x, v.y, max(v.z, -0.15 * abs(v.z) - 0.005)))))
    for x, y, a in ((0.38, 0.4, 0.2), (0.44, 0.32, -0.1), (-0.42, 0.42, 0.15)):
        objs.append(tube('bog_reed', reed, [(x, y, 0.5), (x + a * 0.3, y + 0.05, 0.95), (x + a * 0.6, y + 0.12, 1.3)], [0.025, 0.02, 0.0], seg=5, sub=0))
    for x in (-0.2, -0.07, 0.07, 0.2):
        z = 0.44 + 0.55 * x * x
        objs.append(tube('bog_tooth', bone, [(x, -0.68 + abs(x) * 0.25, z + 0.01), (x, -0.7 + abs(x) * 0.25, z - 0.07)], [0.03, 0.0], seg=5, sub=0))
    em = eye('bog', 0x6affd2)
    objs += eye_pair(em, 0.25, -0.5, 0.78, (0.08, 0.04, 0.09), tilt=-10, on=[o for o in objs if o.name.startswith('bog_bulb')], sink=0.4)
    return objs


bog.finish = {'ao_strength': 0.6}


# ============================================================================================ KNIGHT
def knight():
    """Ashen Knight: chunky cool-steel armour with gold trim, crimson tabard/plume/shield,
    glowing ember visor and a greatsword with a molten rune."""
    steel = material('knight_steel', WHITE, rough=0.35, metal=0.0)
    gold = material('knight_gold', 0xe2b450, rough=0.35)
    red = material('knight_cloth', WHITE, rough=0.7)
    dark = material('knight_leather', 0x4a3040, rough=0.8)
    objs = []
    objs += sym(lambda: tube('k_leg', steel, [(0.18, 0.02, 0.78), (0.2, 0.0, 0.42), (0.2, 0.02, 0.14)], [0.13, 0.12, 0.11], seg=8, sub=1))
    objs += sym(lambda: part('k_knee', 'sphere', steel, loc=(0.2, -0.08, 0.44), size=(0.1, 0.08, 0.09), sub=1, args={'seg': 8, 'rings': 5}))
    objs += sym(lambda: part('k_foot', 'sphere', steel, loc=(0.2, -0.08, 0.08), size=(0.13, 0.22, 0.09), sub=1, args={'seg': 8, 'rings': 5}))
    skirt = tube('k_skirt', steel, [(0, 0, 0.62), (0, 0, 0.8), (0, 0, 0.96)], [0.4, 0.36, 0.33], seg=10, sub=1, cap=False)
    chest = part('k_chest', 'sphere', steel, loc=(0, 0.02, 1.18), size=(0.43, 0.33, 0.42), sub=1, args={'seg': 12, 'rings': 8},
                 deform=lambda v: Vector((v.x, v.y if v.y < 0 else v.y * 0.7, v.z)))
    objs += [skirt, chest]
    objs += sym(lambda: part('k_pauldron', 'sphere', steel, loc=(0.45, 0.02, 1.42), size=(0.28, 0.28, 0.22), sub=1, args={'seg': 10, 'rings': 6},
                             deform=lambda v: Vector((v.x, v.y, max(v.z, -0.06)))))
    objs += sym(lambda: tube('k_arm', steel, [(0.47, 0.0, 1.3), (0.56, -0.08, 0.98), (0.5, -0.28, 0.86)], [0.11, 0.1, 0.09], seg=7, sub=1))
    objs += sym(lambda: part('k_gauntlet', 'sphere', steel, loc=(0.5, -0.32, 0.86), size=(0.11, 0.11, 0.11), sub=1, args={'seg': 8, 'rings': 5}))
    helm = tube('k_helm', steel, [(0, 0, 1.46), (0, 0, 1.6), (0, 0, 1.8), (0, 0, 1.94), (0, 0, 2.0)], [0.2, 0.23, 0.23, 0.19, 0.0], seg=10, sub=1)
    objs.append(helm)

    def steel_p(p, n):
        c = mix(0x5d6482, 0xaab4d4, smooth(0.0, 1.0, n.z * 0.6 + 0.4 + (p.z - 1.0) * 0.3))
        c = mix(c, 0xdde6ff, smooth(0.8, 1.0, n.z) * 0.5)
        if abs(p.x) > 0.3 and 1.3 < p.z < 1.42:  # gold pauldron trim band
            c = mix(c, 0xe8b850, 1.0 - smooth(0.02, 0.035, abs(p.z - 1.36)))
        return c

    for o in objs:
        paint(o, steel_p)
    tab = part('k_tabard', 'cube', red, loc=(0, -0.37, 0.72), size=(0.2, 0.03, 0.3), sub=1, args={},
               deform=lambda v: Vector((v.x * (1.0 - 0.25 * (v.z + 0.3) / 0.6), v.y - 0.04 * (v.z + 0.3), v.z)))
    plume = tube('k_plume', red, bez((0, 0.02, 1.96), (0, 0.4, 2.3), (0, 0.62, 1.82), 6), [0.07, 0.11, 0.12, 0.1, 0.07, 0.0], seg=7, sub=1, flat=(0.55, 1.0))
    shield = part('k_shield', 'cyl', red, loc=(0.68, -0.32, 1.0), size=1, rot=(80, 0, -30), sub=1,
                  args={'seg': 12, 'r1': 0.36, 'r2': 0.33, 'depth': 0.07})
    red_p = lambda p, n: mix(0x8e1f32, 0xd8424c, smooth(-0.3, 1.0, n.z * 0.5 + 0.5 - n.y * 0.3))
    for o in (tab, plume, shield):
        paint(o, red_p)
    objs += [tab, plume, shield]
    objs.append(part('k_boss', 'sphere', gold, loc=(0.74, -0.42, 1.03), size=0.09, sub=1, args={'seg': 8, 'rings': 5}))
    objs.append(part('k_rim', 'torus', gold, loc=(0.68, -0.32, 1.0), size=1, rot=(80, 0, -30), sub=0, args={'major': 0.345, 'minor': 0.04, 'seg': 16, 'mseg': 5}))
    objs.append(part('k_belt', 'torus', dark, loc=(0, 0, 0.94), size=(1, 0.85, 1), sub=0, args={'major': 0.36, 'minor': 0.045, 'seg': 14, 'mseg': 5}))
    objs.append(part('k_buckle', 'cube', gold, loc=(0, -0.34, 0.94), size=(0.07, 0.03, 0.055), sub=1))
    objs.append(part('k_crest', 'cube', gold, loc=(0, -0.2, 1.84), size=(0.025, 0.04, 0.1), sub=0))
    # greatsword in the right hand (-X)
    objs.append(tube('k_grip', dark, [(-0.5, -0.3, 0.72), (-0.5, -0.36, 0.98)], [0.03, 0.03], seg=6, sub=0))
    objs.append(part('k_guard', 'cube', gold, loc=(-0.5, -0.37, 0.99), size=(0.2, 0.04, 0.035), rot=(-12, 0, 0), sub=1))
    blade = tube('k_blade', steel, [(-0.5, -0.38, 1.0), (-0.5, -0.45, 1.4), (-0.5, -0.52, 1.75), (-0.5, -0.56, 1.95)],
                 [0.085, 0.08, 0.075, 0.0], seg=6, sub=1, flat=(1.0, 0.22))
    paint(blade, lambda p, n: mix(0x9aa6c8, 0xf0f4ff, smooth(-0.2, 0.9, n.z * 0.5 - n.y * 0.6)))
    objs.append(blade)
    ember = glow('knight_ember', 0xff5a22)
    objs.append(tube('k_rune', ember, [(-0.5, -0.405, 1.06), (-0.5, -0.455, 1.38), (-0.5, -0.505, 1.66)], [0.018, 0.016, 0.0], seg=4, sub=0))
    objs.append(part('k_gorget', 'torus', ember, loc=(0, 0, 1.47), size=1, sub=0, args={'major': 0.2, 'minor': 0.03, 'seg': 12, 'mseg': 4}))
    visor = material('knight_eye', 0xff6a2a, glow=True)
    objs.append(part('k_visor', 'cube', visor, loc=(0, -0.205, 1.74), size=(0.15, 0.03, 0.024), sub=0))
    objs.append(part('k_visor2', 'cube', visor, loc=(0, -0.215, 1.66), size=(0.022, 0.03, 0.07), sub=0))
    return objs


knight.finish = {'ao_strength': 0.55}
