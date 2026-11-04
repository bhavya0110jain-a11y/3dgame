"""Shared modelling helpers for Last Lantern characters & enemies ("moonlit storybook" style).

Coordinates are Blender world space: Z up, model FRONT = -Y (exports as +Z in three.js), feet at z = 0,
units in meters. Every part is built from a low-res primitive -> shaped in Python -> subdivided
(+ optional bevel) -> smooth shaded, then vertex-painted (colour blocking + gradients) and multiplied
with a Cycles-baked ambient-occlusion pass so creases (eye sockets, under hoods, between legs) read
even with the cheap real-time lighting.

Material contract (src/render/Assets.ts): material names containing glow/eye/emit become unlit glow
parts; everything else is a lit body whose colour = material colour x COLOR_0. Painted parts use a white
material so the vertex colours carry the full colour.
"""
import math
import os
import bpy  # noqa: F401  (must be imported before bmesh)
import bmesh
import addon_utils
from mathutils import Vector, Matrix, Euler

# --------------------------------------------------------------------------------------------- colour

def hexrgb(h):
    if isinstance(h, (tuple, list)):
        return tuple(h[:3])
    return (((h >> 16) & 255) / 255.0, ((h >> 8) & 255) / 255.0, (h & 255) / 255.0)


def s2l(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin(h):
    r, g, b = hexrgb(h)
    return (s2l(r), s2l(g), s2l(b))


def mix(a, b, t):
    a = hexrgb(a)
    b = hexrgb(b)
    t = max(0.0, min(1.0, t))
    return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t)


def smooth(e0, e1, x):
    if e1 == e0:
        return 1.0 if x >= e1 else 0.0
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


# --------------------------------------------------------------------------------------------- scene

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    addon_utils.enable('cycles', default_set=True, persistent=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 48
    w = bpy.data.worlds.new('world')
    w.light_settings.distance = 0.6
    sc.world = w
    _MATS.clear()


_MATS = {}


def material(name, color=0xffffff, rough=0.62, metal=0.0, glow=False, strength=1.0):
    """Get/create a material. glow=True -> emissive (name should contain 'glow' / 'eye')."""
    key = name
    if key in _MATS:
        return _MATS[key]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get('Principled BSDF')
    c = lin(color)
    b.inputs['Base Color'].default_value = (*c, 1.0)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if glow:
        b.inputs['Emission Color'].default_value = (*c, 1.0)
        b.inputs['Emission Strength'].default_value = strength
    m['glow'] = bool(glow)
    m.use_backface_culling = True
    _MATS[key] = m
    return m


# --------------------------------------------------------------------------------------------- mesh primitives

def _bm_sphere(seg=12, rings=8):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    return bm


def _bm_ico(sub=1):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    return bm


def _bm_cube():
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    return bm


def _bm_cyl(seg=10, r1=1.0, r2=1.0, depth=2.0, caps=True, rings=1):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=depth)
    if rings > 1:
        edges = [e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 1e-6]
        bmesh.ops.subdivide_edges(bm, edges=edges, cuts=rings - 1, use_grid_fill=True)
    return bm


def _bm_torus(major=1.0, minor=0.25, seg=16, mseg=6):
    bm = bmesh.new()
    verts = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        row = []
        for j in range(mseg):
            b = 2 * math.pi * j / mseg
            r = major + minor * math.cos(b)
            row.append(bm.verts.new((r * math.cos(a), r * math.sin(a), minor * math.sin(b))))
        verts.append(row)
    for i in range(seg):
        for j in range(mseg):
            a = verts[i][j]
            b = verts[(i + 1) % seg][j]
            c = verts[(i + 1) % seg][(j + 1) % mseg]
            d = verts[i][(j + 1) % mseg]
            bm.faces.new((a, b, c, d))
    return bm


PRIMS = {
    'sphere': _bm_sphere,
    'ico': _bm_ico,
    'cube': _bm_cube,
    'cyl': _bm_cyl,
    'torus': _bm_torus,
}


def part(name, prim, mat, loc=(0, 0, 0), size=(1, 1, 1), rot=(0, 0, 0), sub=1, bevel=0.0, deform=None,
         sharp=None, args=None, collection=None):
    """Create a finished mesh object.

    prim: primitive key; args: extra kwargs for the primitive; size: half-extents/radii scale;
    rot: XYZ euler degrees; deform: fn(Vector local-scaled co) -> Vector applied BEFORE rotation/loc;
    sub: subdivision levels (Catmull-Clark); bevel: bevel width (applied before subsurf);
    sharp: angle in degrees -> mark sharp edges (hard-surface) instead of fully smooth.
    """
    bm = PRIMS[prim](**(args or {}))
    sx, sy, sz = size if isinstance(size, (tuple, list)) else (size, size, size)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
        if deform:
            v.co = Vector(deform(v.co.copy()))
    rm = Euler([math.radians(a) for a in rot], 'XYZ').to_matrix().to_4x4()
    bm.transform(Matrix.Translation(Vector(loc)) @ rm)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    me.materials.append(mat)
    if bevel > 0:
        md = ob.modifiers.new('bevel', 'BEVEL')
        md.width = bevel
        md.segments = 2
        md.limit_method = 'ANGLE'
        md.angle_limit = math.radians(35)
    if sub > 0:
        md = ob.modifiers.new('sub', 'SUBSURF')
        md.levels = sub
        md.render_levels = sub
    apply_mods(ob)
    if sharp is not None:
        ob.data.set_sharp_from_angle(angle=math.radians(sharp))
    ob.data.shade_smooth() if sharp is None else None
    if sharp is not None:
        for p in ob.data.polygons:
            p.use_smooth = True
    return ob


def tube(name, mat, pts, radii, seg=6, sub=1, cap=True, flat=None, collection=None):
    """Smooth tube along a polyline (horns, limbs, antlers, tails, staff).
    pts: list of world points; radii: per-point radius (0 for a pointed tip);
    flat: optional (sx, sy) cross-section squash in the ring's local frame."""
    pts = [Vector(p) for p in pts]
    bm = bmesh.new()
    rings = []
    up = Vector((0, 0, 1))
    prev_side = None
    for i, p in enumerate(pts):
        if i == 0:
            d = pts[1] - pts[0]
        elif i == len(pts) - 1:
            d = pts[-1] - pts[-2]
        else:
            d = (pts[i + 1] - pts[i - 1])
        d.normalize()
        ref = up if abs(d.dot(up)) < 0.95 else Vector((1, 0, 0))
        side = d.cross(ref).normalized()
        if prev_side is not None and side.dot(prev_side) < 0:
            side = -side
        prev_side = side
        other = d.cross(side).normalized()
        r = radii[i]
        if r <= 1e-5:
            rings.append([bm.verts.new(p)])
            continue
        ring = []
        for k in range(seg):
            a = 2 * math.pi * k / seg
            cx, cy = math.cos(a) * r, math.sin(a) * r
            if flat:
                cx *= flat[0]
                cy *= flat[1]
            ring.append(bm.verts.new(p + side * cx + other * cy))
        rings.append(ring)
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1:
            for k in range(seg):
                bm.faces.new((a[0], b[(k + 1) % seg], b[k]))
        elif len(b) == 1:
            for k in range(seg):
                bm.faces.new((a[k], a[(k + 1) % seg], b[0]))
        else:
            for k in range(seg):
                bm.faces.new((a[k], a[(k + 1) % seg], b[(k + 1) % seg], b[k]))
    if cap:
        if len(rings[0]) > 1:
            bm.faces.new(list(reversed(rings[0])))
        if len(rings[-1]) > 1:
            bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    me.materials.append(mat)
    if sub > 0:
        md = ob.modifiers.new('sub', 'SUBSURF')
        md.levels = sub
        apply_mods(ob)
    me = ob.data
    me.shade_smooth()
    return ob


def bez(p0, p1, p2, n):
    """Quadratic bezier points p0->p2 with control p1 (n samples)."""
    p0, p1, p2 = Vector(p0), Vector(p1), Vector(p2)
    out = []
    for i in range(n):
        t = i / (n - 1)
        out.append(p0 * (1 - t) ** 2 + p1 * 2 * (1 - t) * t + p2 * t * t)
    return out


def surface_y(objs, x, z, front=True):
    """World Y of the front-most (or back-most) surface point of objs at (x, z), casting along +Y."""
    best = None
    for ob in objs:
        inv = ob.matrix_world.inverted()
        o = inv @ Vector((x, -10.0 if front else 10.0, z))
        d = (inv.to_3x3() @ Vector((0, 1 if front else -1, 0))).normalized()
        hit, loc, nrm, idx = ob.ray_cast(o, d)
        if hit:
            y = (ob.matrix_world @ loc).y
            if best is None or (front and y < best) or (not front and y > best):
                best = y
    return best


def surface_pt(objs, origin, direction):
    """Nearest world hit point of a ray against objs (or None)."""
    best, bd = None, 1e9
    o0, d0 = Vector(origin), Vector(direction).normalized()
    for ob in objs:
        inv = ob.matrix_world.inverted()
        hit, loc, nrm, idx = ob.ray_cast(inv @ o0, (inv.to_3x3() @ d0).normalized())
        if hit:
            w = ob.matrix_world @ loc
            d = (w - o0).length
            if d < bd:
                best, bd = w, d
    return best


def apply_mods(ob):
    if not ob.modifiers:
        return
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    me.name = old.name
    bpy.data.meshes.remove(old)


def deform_obj(ob, fn):
    """fn(world Vector) -> world Vector, applied to final vertices (after subdivision)."""
    mw = ob.matrix_world
    inv = mw.inverted()
    for v in ob.data.vertices:
        v.co = inv @ Vector(fn(mw @ v.co))
    ob.data.update()


def mirror_x(ob, name=None):
    """Duplicate an object mirrored across X (Blender left/right)."""
    me = ob.data.copy()
    for v in me.vertices:
        v.co.x = -v.co.x
    # flip winding
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.shade_smooth()
    o2 = bpy.data.objects.new(name or (ob.name + '_R'), me)
    for c in ob.users_collection:
        c.objects.link(o2)
    o2.matrix_world = ob.matrix_world.copy()
    return o2


def join(objs, name):
    """Join objects into one (keeps material slots)."""
    objs = [o for o in objs if o]
    if any(o.data.color_attributes.get('Base') for o in objs):
        for o in objs:
            _ensure_base(o)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    return o


def set_origin(ob, pivot):
    """Move object origin to world point `pivot` without moving geometry."""
    pv = Vector(pivot)
    mw = ob.matrix_world.copy()
    local = mw.inverted() @ pv
    for v in ob.data.vertices:
        v.co -= local
    ob.matrix_world = Matrix.Translation(pv) @ Matrix.Translation(-(mw @ Vector((0, 0, 0)))) @ mw
    ob.data.update()


def empty(name, loc, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.1
    bpy.context.scene.collection.objects.link(e)
    e.location = Vector(loc)
    if parent is not None:
        parent_keep(e, parent)
    return e


def parent_keep(child, parent):
    """Parent keeping world position (translation-only rigs: no rotations/scales used)."""
    bpy.context.view_layer.update()
    cw = child.matrix_world.translation.copy()
    pw = parent.matrix_world.translation.copy()
    child.parent = parent
    child.matrix_parent_inverse.identity()
    child.location = cw - pw
    bpy.context.view_layer.update()


# --------------------------------------------------------------------------------------------- painting

def paint(ob, fn):
    """Vertex-paint base colours now: fn(p: world Vector, n: world normal) -> sRGB tuple/hex.
    Stored in a 'Base' attribute (survives join / mirror / decimate); finish() multiplies AO in."""
    me = ob.data
    attr = me.color_attributes.get('Base') or me.color_attributes.new('Base', 'FLOAT_COLOR', 'POINT')
    mw = ob.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    for i, v in enumerate(me.vertices):
        c = hexrgb(fn(mw @ v.co, (nm @ v.normal).normalized()))
        attr.data[i].color = (c[0], c[1], c[2], 1.0)


def _ensure_base(ob):
    me = ob.data
    if me.color_attributes.get('Base') is None:
        a = me.color_attributes.new('Base', 'FLOAT_COLOR', 'POINT')
        for d in a.data:
            d.color = (1.0, 1.0, 1.0, 1.0)


def solid(c):
    return lambda p, n: c


def grad_z(c0, c1, z0, z1):
    return lambda p, n: mix(c0, c1, smooth(z0, z1, p.z))


def belly(base, light, front=-1.0, thresh=0.25, soft=0.35, zmax=None, top=None, top_k=0.0):
    """Base colour with a lighter belly on the side facing `front` (-Y = model front)."""

    def f(p, n):
        d = n.y * front
        t = smooth(thresh, thresh + soft, d)
        if zmax is not None:
            t *= 1.0 - smooth(zmax - 0.1, zmax + 0.1, p.z)
        c = mix(base, light, t)
        if top is not None:
            c = mix(c, top, smooth(0.3, 1.0, n.z) * top_k)
        return c

    return f


def _apply_paint(ob, ao=None, ao_strength=0.6, ao_tint=(0.55, 0.5, 0.85), height_shade=None):
    me = ob.data
    base = me.color_attributes.get('Base')
    is_glow = any(m and m.get('glow') for m in me.materials)
    attr = me.color_attributes.get('Color') or me.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    mw = ob.matrix_world
    nm = mw.to_3x3().inverted().transposed()
    for i, v in enumerate(me.vertices):
        if is_glow:
            col = (1.0, 1.0, 1.0)
        else:
            p = mw @ v.co
            n = (nm @ v.normal).normalized()
            col = tuple(base.data[i].color[:3]) if base else (1.0, 1.0, 1.0)
            k = 1.0
            if ao is not None:
                a = ao[i]
                # tinted AO: occluded areas shift toward a cool violet (moonlit shadow) rather than grey
                k = 1.0 - ao_strength * (1.0 - a)
                col = (col[0] * (k + (1 - k) * ao_tint[0]) * k ** 0.25,
                       col[1] * (k + (1 - k) * ao_tint[1]) * k ** 0.25,
                       col[2] * (k + (1 - k) * ao_tint[2]) * k ** 0.25)
            if height_shade:
                z0, z1, lo = height_shade
                h = lo + (1 - lo) * smooth(z0, z1, p.z)
                col = (col[0] * h, col[1] * h, col[2] * h)
        attr.data[i].color = (s2l(min(1, col[0])), s2l(min(1, col[1])), s2l(min(1, col[2])), 1.0)
    if base is not None:
        me.color_attributes.remove(base)
        attr = me.color_attributes.get('Color')
    me.color_attributes.active_color = attr
    try:
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
    except Exception:
        pass


def bake_ao(objs, ground=True, distance=0.6, samples=48):
    """Bake AO into a temp colour attribute per object. Returns {name: [ao per vertex]}."""
    sc = bpy.context.scene
    sc.world.light_settings.distance = distance
    sc.cycles.samples = samples
    gp = None
    if ground:
        bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
        gp = bpy.context.active_object
    body = [o for o in objs if o.type == 'MESH' and not any(m and m.get('glow') for m in o.data.materials)]
    for o in body:
        a = o.data.color_attributes.new('AO', 'FLOAT_COLOR', 'POINT')
        o.data.color_attributes.active_color = a
    bpy.ops.object.select_all(action='DESELECT')
    for o in body:
        o.select_set(True)
    out = {}
    if body:
        bpy.context.view_layer.objects.active = body[0]
        bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
        for o in body:
            a = o.data.color_attributes['AO']
            out[o.name] = [a.data[i].color[0] for i in range(len(o.data.vertices))]
            o.data.color_attributes.remove(a)
    if gp:
        bpy.data.objects.remove(gp, do_unlink=True)
    return out


def finish(objs, ao=True, ao_strength=0.6, distance=0.6, height_shade=None):
    """Bake AO + vertex paint every mesh in objs."""
    meshes = [o for o in objs if o.type == 'MESH']
    aos = bake_ao(meshes, distance=distance) if ao else {}
    for o in meshes:
        _apply_paint(o, aos.get(o.name), ao_strength=ao_strength, height_shade=height_shade)


def tri_count(objs):
    n = 0
    for o in objs:
        if o.type != 'MESH':
            continue
        for p in o.data.polygons:
            n += len(p.vertices) - 2
    return n


def decimate_to(objs, budget):
    """Uniformly collapse-decimate body meshes if over the triangle budget."""
    n = tri_count(objs)
    if n <= budget:
        return n
    ratio = budget / n
    for o in objs:
        if o.type != 'MESH' or len(o.data.polygons) < 60:
            continue
        md = o.modifiers.new('dec', 'DECIMATE')
        md.ratio = ratio
        md.use_collapse_triangulate = True
        apply_mods(o)
        o.data.shade_smooth()
    return tri_count(objs)


def decimate_each(objs, ratio, min_tris=12, skip_below=20):
    """Collapse-decimate every mesh by `ratio`, but never below `min_tris` per object; objects with fewer than
    `skip_below` triangles are left alone. Vertex colour attributes are interpolated by the collapse, so this is
    safe after finish() (AO already baked into COLOR_0) - used for the horde LOD and the cheap glow parts."""
    for o in objs:
        if o.type != 'MESH':
            continue
        n = tri_count([o])
        if n < skip_below:
            continue
        target = max(min_tris, int(n * ratio))
        if target >= n:
            continue
        active = o.data.color_attributes.active_color_name if o.data.color_attributes.active_color else None
        md = o.modifiers.new('dec', 'DECIMATE')
        md.ratio = target / n
        md.use_collapse_triangulate = True
        apply_mods(o)
        o.data.shade_smooth()
        if active and o.data.color_attributes.get(active):
            o.data.color_attributes.active_color = o.data.color_attributes[active]
            try:
                o.data.color_attributes.render_color_index = o.data.color_attributes.active_color_index
            except Exception:
                pass
    return tri_count(objs)


def decimate_group_to(objs, budget, min_tris=12, skip_below=20):
    """Decimate a group of meshes to roughly `budget` triangles in total (iterates because of per-object floors)."""
    for _ in range(3):
        n = tri_count(objs)
        if n <= budget * 1.04:
            break
        decimate_each(objs, budget / n, min_tris=min_tris, skip_below=skip_below)
    return tri_count(objs)


def export_glb(objs, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_vertex_color='ACTIVE',
        export_all_vertex_colors=False,
        export_animations=False,
        export_extras=False,
        export_texcoords=False,
    )


def all_objects():
    return list(bpy.context.scene.collection.all_objects)
