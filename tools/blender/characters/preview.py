"""Render a preview contact sheet of exported character / enemy GLBs (re-imported, so this also
verifies the export round-trip).

Usage: python preview.py OUT.png [--elev 30] [--size 420] [--scale] model1.glb model2.glb ...
  --scale  : apply in-game scale (enemy def scale) so relative sizes match gameplay
"""
import math
import os
import sys

import bpy
import addon_utils
from mathutils import Vector

GAME_SCALE = {'shade': 1, 'crawler': 1, 'wisp': 0.9, 'brute': 1.7, 'stalker': 1.1, 'spitter': 1.1, 'bog': 1.3,
              'knight': 1.4, 'stag': 3.2, 'mire': 3.4, 'king': 3.0, 'bearer': 1}


def main():
    argv = sys.argv[1:]
    out = argv.pop(0)
    elev = 28.0
    size = 420
    use_scale = False
    files = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--elev':
            elev = float(argv[i + 1]); i += 2; continue
        if a == '--size':
            size = int(argv[i + 1]); i += 2; continue
        if a == '--scale':
            use_scale = True; i += 1; continue
        files.append(a); i += 1

    bpy.ops.wm.read_factory_settings(use_empty=True)
    addon_utils.enable('cycles', default_set=True, persistent=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 24
    try:
        sc.cycles.use_denoising = True
    except Exception:
        pass
    sc.view_settings.view_transform = 'AgX' if 'AgX' in [v.identifier for v in sc.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.05, 0.07, 0.16, 1)
    bg.inputs['Strength'].default_value = 1.0
    sc.world = w

    # ground + lights (shared by all tiles)
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
    g = bpy.context.active_object
    gm = bpy.data.materials.new('ground')
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.05, 0.09, 0.22, 1)
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.9
    g.data.materials.append(gm)
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(45), 0, math.radians(-35)))
    sun = bpy.context.active_object
    sun.data.energy = 2.4
    sun.data.color = (0.72, 0.8, 1.0)
    sun.data.angle = math.radians(10)
    bpy.ops.object.light_add(type='POINT', location=(1.5, -2.5, 2.5))
    fill = bpy.context.active_object
    fill.data.energy = 120
    fill.data.color = (1.0, 0.72, 0.42)
    fill.data.shadow_soft_size = 0.5
    bpy.ops.object.light_add(type='AREA', location=(0, 6, 4))
    rim = bpy.context.active_object
    rim.data.energy = 500
    rim.data.size = 6
    rim.data.color = (0.6, 0.5, 1.0)
    rim.rotation_euler = (math.radians(-55), 0, 0)
    bpy.ops.object.camera_add()
    cam = bpy.context.active_object
    sc.camera = cam
    cam.data.type = 'ORTHO'
    sc.render.resolution_x = size
    sc.render.resolution_y = size
    tiles = []
    outdir = os.path.splitext(out)[0] + '_tiles'
    os.makedirs(outdir, exist_ok=True)
    for f in files:
        name = os.path.splitext(os.path.basename(f))[0]
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=f)
        objs = [o for o in bpy.data.objects if o not in before]
        s = GAME_SCALE.get(name, 1) if use_scale else 1
        for r in [o for o in objs if o.parent is None]:
            r.scale = (s, s, s)
        bpy.context.view_layer.update()
        pts = [o.matrix_world @ Vector(c) for o in objs if o.type == 'MESH' for c in o.bound_box]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        ctr = (lo + hi) / 2
        ext = max((hi - lo).length, 0.5)
        for o in objs:
            if o.type != 'MESH':
                continue
            for m in o.data.materials:
                if not m or m.get('_pv'):
                    continue
                m['_pv'] = 1
                nt = m.node_tree
                b = nt.nodes.get('Principled BSDF')
                if not b:
                    continue
                # importer already wires COLOR_0 x baseColorFactor; just boost glow parts
                if any(k in m.name.lower() for k in ('glow', 'eye', 'emit')):
                    b.inputs['Emission Strength'].default_value = 3.0
        e = math.radians(elev)
        yaw = math.radians(-28)
        dist = 20
        cam.location = ctr + Vector((dist * math.cos(e) * math.sin(yaw), -dist * math.cos(e) * math.cos(yaw), dist * math.sin(e)))
        cam.rotation_euler = (ctr - cam.location).to_track_quat('-Z', 'Y').to_euler()
        cam.data.ortho_scale = ext * 0.95
        tile = os.path.join(outdir, name + '.png')
        sc.render.filepath = tile
        bpy.ops.render.render(write_still=True)
        tiles.append(tile)
        for o in objs:
            bpy.data.objects.remove(o, do_unlink=True)
    with open(os.path.splitext(out)[0] + '_tiles.txt', 'w') as fh:
        fh.write('\n'.join(tiles))
    print('rendered', out, tiles)


main()
