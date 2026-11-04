"""Shared helpers for Last Lantern prop modelling (Blender 5.2 as a Python module, headless).

Conventions (see src/render/Assets.ts CONTRACT):
  * Blender Z-up, metres, origin at the prop's feet. Exported to GLB with +Y up.
  * All colour lives in a linear FLOAT_COLOR corner attribute "Col" (exported as COLOR_0); materials are white.
  * Two materials only: "body" (lit PBR) and "glow" (unlit + bloom, the name is what marks it as glow).
    Glow parts are authored near-white so the engine can tint them per biome with instanceColor.

Usage pattern:
    B = Builder()
    part = tube([...], [...]); colorize(part, fn); B.add('body', part)
    B.export('pine')
"""
import math
import os
import random

import bpy
import bmesh
from mathutils import Matrix, Vector, noise

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT_DIR = os.path.join(ROOT, 'public', 'models', 'props')

TAU = math.pi * 2


# ---------------------------------------------------------------- colour utils
def lin1(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hexc(h):
    """sRGB hex -> linear rgb tuple."""
    return (lin1(((h >> 16) & 255) / 255), lin1(((h >> 8) & 255) / 255), lin1((h & 255) / 255))


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def mul(a, s):
    return tuple(x * s for x in a)


def clamp01(x):
    return 0.0 if x < 0 else 1.0 if x > 1 else x


def smooth(e0, e1, x):
    t = clamp01((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)


def n3(co, freq=1.0, seed=0.0):
    """Perlin noise in [-1,1]."""
    return noise.noise(Vector((co.x * freq + seed * 17.13, co.y * freq + seed * 3.7, co.z * freq + seed * 9.1)))


# ---------------------------------------------------------------- scene
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def material(name, glow=False):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:  # Blender 5: always node based
        pass
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (1, 1, 1, 1)
    bsdf.inputs['Roughness'].default_value = 0.8 if not glow else 0.5
    # drive base colour from the vertex colour attribute so previews (and the exporter) see it
    attr = nt.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    return m


# ---------------------------------------------------------------- primitives (each returns a fresh bmesh)
def ico(radius=1.0, subdiv=2):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    return bm


def uvsphere(radius=1.0, segs=12, rings=8):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=radius)
    return bm


def box(sx, sy, sz, bevel=0.0, segments=1):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x *= sx
        v.co.y *= sy
        v.co.z *= sz
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=bevel, segments=segments,
                        profile=0.5, affect='EDGES', clamp_overlap=True)
    return bm


def lathe(profile, segs=16, rim=None):
    """Surface of revolution around Z. profile: [(r, z)] ordered top -> bottom; r==0 makes a pole.
    rim(theta, j) -> radial multiplier (for scallops / wobble)."""
    bm = bmesh.new()
    rows = []
    for j, (r, z) in enumerate(profile):
        if r <= 1e-6:
            rows.append([bm.verts.new((0, 0, z))])
            continue
        row = []
        for s in range(segs):
            a = TAU * s / segs
            k = rim(a, j) if rim else 1.0
            row.append(bm.verts.new((math.cos(a) * r * k, math.sin(a) * r * k, z)))
        rows.append(row)
    for j in range(len(rows) - 1):
        A, Bv = rows[j], rows[j + 1]
        if len(A) == 1 and len(Bv) == 1:
            continue
        if len(A) == 1:
            for s in range(segs):
                bm.faces.new((A[0], Bv[s], Bv[(s + 1) % segs]))
        elif len(Bv) == 1:
            for s in range(segs):
                bm.faces.new((A[s], Bv[0], A[(s + 1) % segs]))
        else:
            for s in range(segs):
                bm.faces.new((A[s], Bv[s], Bv[(s + 1) % segs], A[(s + 1) % segs]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def tube(pts, radii, segs=8, cap_top=True, cap_bottom=False, top_round=0.6):
    """Generalised cylinder along a polyline with per-point radius (parallel-transport frames)."""
    pts = [Vector(p) for p in pts]
    bm = bmesh.new()
    rings = []
    prev_n = None
    for i, p in enumerate(pts):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == len(pts) - 1:
            t = pts[-1] - pts[-2]
        else:
            t = pts[i + 1] - pts[i - 1]
        t.normalize()
        if prev_n is None:
            ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
            n = t.cross(ref).normalized()
        else:
            n = (prev_n - t * prev_n.dot(t)).normalized()
        prev_n = n
        b = t.cross(n)
        ring = []
        for s in range(segs):
            a = TAU * s / segs
            ring.append(bm.verts.new(p + (n * math.cos(a) + b * math.sin(a)) * radii[i]))
        rings.append((ring, t))
    for i in range(len(rings) - 1):
        r0, r1 = rings[i][0], rings[i + 1][0]
        for s in range(segs):
            bm.faces.new((r0[s], r0[(s + 1) % segs], r1[(s + 1) % segs], r1[s]))
    if cap_top:
        ring, t = rings[-1]
        c = bm.verts.new(pts[-1] + t * radii[-1] * top_round)
        for s in range(segs):
            bm.faces.new((ring[s], ring[(s + 1) % segs], c))
    if cap_bottom:
        ring, t = rings[0]
        c = bm.verts.new(pts[0] - t * radii[0] * 0.3)
        for s in range(segs):
            bm.faces.new((ring[(s + 1) % segs], ring[s], c))
    return bm


def disc(radius, segs=12, notch=0.0, thickness=0.03):
    """Flat lily-pad style disc (closed thin slab), optional wedge notch in radians."""
    prof = []
    bm = bmesh.new()
    top, bot = [], []
    a0 = notch * 0.5
    n = segs
    tc = bm.verts.new((0, 0, thickness))
    bc = bm.verts.new((0, 0, 0))
    for s in range(n + 1):
        a = a0 + (TAU - notch) * s / n
        r = radius * (1 + 0.04 * math.sin(a * 5))
        top.append(bm.verts.new((math.cos(a) * r, math.sin(a) * r, thickness * 0.6)))
        bot.append(bm.verts.new((math.cos(a) * r * 0.98, math.sin(a) * r * 0.98, 0)))
    for s in range(n):
        bm.faces.new((tc, top[s], top[s + 1]))
        bm.faces.new((bc, bot[s + 1], bot[s]))
        bm.faces.new((top[s], bot[s], bot[s + 1], top[s + 1]))
    if notch > 0:
        bm.faces.new((tc, bc, bot[0], top[0]))
        bm.faces.new((tc, top[n], bot[n], bc))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


# ---------------------------------------------------------------- operations
def xform(bm, loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    from mathutils import Euler
    m = Matrix.Translation(Vector(loc)) @ Euler(rot, 'XYZ').to_matrix().to_4x4() @ Matrix.Diagonal(
        (scale[0], scale[1], scale[2], 1))
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return bm


def displace(bm, amp=0.1, freq=1.5, seed=0.0, along_normal=True):
    bm.normal_update()
    for v in bm.verts:
        d = n3(v.co, freq, seed) * amp
        if along_normal:
            v.co += v.normal * d
        else:
            v.co += Vector((d, n3(v.co, freq, seed + 1) * amp, n3(v.co, freq, seed + 2) * amp))
    return bm


def flatten_bottom(bm, z=0.0):
    for v in bm.verts:
        if v.co.z < z:
            v.co.z = z
    return bm


def chisel(bm, cuts=5, depth=0.85, seed=1):
    """Stylised rock facets: clamp vertices onto random planes."""
    rnd = random.Random(seed)
    planes = []
    for _ in range(cuts):
        th = rnd.uniform(0, TAU)
        ph = rnd.uniform(-0.2, 1.2)
        nrm = Vector((math.cos(th) * math.cos(ph), math.sin(th) * math.cos(ph), math.sin(ph))).normalized()
        planes.append((nrm, depth * rnd.uniform(0.85, 1.05)))
    for v in bm.verts:
        for nrm, d in planes:
            k = v.co.dot(nrm)
            if k > d:
                v.co -= nrm * (k - d)
    return bm


def mark_sharp(bm, angle_deg):
    lim = math.radians(angle_deg)
    bm.normal_update()
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.link_faces[0].normal.angle(e.link_faces[1].normal, 0) < lim
    return bm


def colorize(bm, fn, smooth_shade=True):
    """fn(co: Vector, normal: Vector) -> linear rgb tuple. Per-vertex colours."""
    lay = bm.loops.layers.float_color.get('Col') or bm.loops.layers.float_color.new('Col')
    bm.normal_update()
    cache = {}
    for f in bm.faces:
        f.smooth = smooth_shade
        for l in f.loops:
            v = l.vert
            c = cache.get(v)
            if c is None:
                c = fn(v.co, v.normal)
                cache[v] = c
            l[lay] = (c[0], c[1], c[2], 1.0)
    return bm


def solid(color):
    return lambda co, n: color


def gradient_z(bottom, top, z0, z1, ao=0.0):
    """Vertical gradient with optional extra darkening near the ground (fake AO)."""
    def fn(co, n):
        c = mix(bottom, top, smooth(z0, z1, co.z))
        if ao > 0:
            c = mul(c, 1 - ao * (1 - smooth(0.0, 0.35, co.z)))
        return c
    return fn


def moss_fn(base, moss, thresh=0.55, seed=0.0, dark=None, z0=None, z1=None):
    """Rock / stone colouring: moss on upward faces with a noisy edge; optional vertical darkening."""
    def fn(co, n):
        c = base
        if dark is not None and z0 is not None:
            c = mix(dark, base, smooth(z0, z1, co.z))
        k = n.z + n3(co, 3.0, seed) * 0.25
        return mix(c, moss, smooth(thresh, thresh + 0.15, k))
    return fn


# ---------------------------------------------------------------- builder
class Builder:
    def __init__(self):
        self.parts = {}

    def add(self, mat, bm):
        dst = self.parts.get(mat)
        if dst is None:
            dst = bmesh.new()
            self.parts[mat] = dst
        dl = dst.loops.layers.float_color.get('Col') or dst.loops.layers.float_color.new('Col')
        sl = bm.loops.layers.float_color.get('Col')
        vm = {v: dst.verts.new(v.co) for v in bm.verts}
        for f in bm.faces:
            try:
                nf = dst.faces.new([vm[v] for v in f.verts])
            except ValueError:
                continue
            nf.smooth = f.smooth
            if sl is not None:
                for nl, ol in zip(nf.loops, f.loops):
                    nl[dl] = ol[sl]
            else:
                for nl in nf.loops:
                    nl[dl] = (1, 1, 1, 1)
        for e in bm.edges:
            if not e.smooth:
                ne = dst.edges.get((vm[e.verts[0]], vm[e.verts[1]]))
                if ne:
                    ne.smooth = False
        bm.free()

    def tris(self):
        return sum(sum(len(f.verts) - 2 for f in bm.faces) for bm in self.parts.values())

    def build_objects(self, name):
        objs = []
        for mat_name, bm in self.parts.items():
            me = bpy.data.meshes.new(f'{name}_{mat_name}')
            bm.to_mesh(me)
            me.color_attributes.active_color_name = 'Col'
            try:
                me.color_attributes.render_color_index = me.color_attributes.active_color_index
            except Exception:
                pass
            me.materials.append(material(mat_name, glow=('glow' in mat_name)))
            ob = bpy.data.objects.new(f'{name}_{mat_name}', me)
            bpy.context.scene.collection.objects.link(ob)
            objs.append(ob)
        return objs

    def export(self, name, out_dir=OUT_DIR):
        reset_objects()
        objs = self.build_objects(name)
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, f'{name}.glb')
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.export_scene.gltf(
            filepath=path, export_format='GLB', use_selection=True, export_apply=True,
            export_vertex_color='ACTIVE', export_normals=True, export_texcoords=False,
            export_materials='EXPORT', export_yup=True, export_animations=False,
        )
        print(f'  {name:14s} {self.tris():6d} tris -> {os.path.relpath(path, ROOT)}')
        return objs


def reset_objects():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)
