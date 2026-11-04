"""Renders a moonlit contact sheet of the exported prop GLBs (for art review).

Run:  /home/user/blender-venv/bin/python tools/blender/props/preview.py <out.png> [name ...]
"""
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lib import OUT_DIR, hexc  # noqa: E402

ORDER = ['pine', 'oak', 'deadtree', 'bush', 'stump', 'log', 'rock', 'grave', 'pillar', 'ruin_wall', 'crystal',
         'mushroom', 'reed', 'flower', 'lily', 'lantern_post']


def main():
    out = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '/tmp/props_preview.png')
    names = [a for a in sys.argv[2:] if a in ORDER] or ORDER
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    cols = 6 if len(names) > 6 else len(names)
    spacing = 5.0
    for i, n in enumerate(names):
        path = os.path.join(OUT_DIR, n + '.glb')
        if not os.path.exists(path):
            continue
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=path)
        new = [o for o in bpy.data.objects if o not in before]
        x = (i % cols - (cols - 1) / 2) * spacing
        y = (i // cols) * spacing
        for o in new:
            if o.parent is None:
                o.location.x += x
                o.location.y += y
    # glow materials -> emission driven by the vertex colour
    for m in bpy.data.materials:
        if 'glow' in m.name.lower() and m.node_tree:
            nt = m.node_tree
            bsdf = next((nd for nd in nt.nodes if nd.type == 'BSDF_PRINCIPLED'), None)
            vc = next((nd for nd in nt.nodes if nd.type in ('VERTEX_COLOR', 'ATTRIBUTE')), None)
            if bsdf is None:
                continue
            if vc is None:
                vc = nt.nodes.new('ShaderNodeVertexColor')
                vc.layer_name = 'Col'
            nt.links.new(vc.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = 3.0
    # ground
    bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 8, 0))
    g = bpy.context.active_object
    gm = bpy.data.materials.new('ground')
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*hexc(0x1d3b3a), 1)
    g.data.materials.append(gm)
    # moonlight + warm lantern
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(50), 0, math.radians(30)))
    sun = bpy.context.active_object
    sun.data.energy = 2.2
    sun.data.color = (0.6, 0.72, 1.0)
    bpy.ops.object.light_add(type='POINT', location=(-6, -8, 4))
    pt = bpy.context.active_object
    pt.data.energy = 3000
    pt.data.color = (1.0, 0.65, 0.3)
    world = bpy.data.worlds.new('w')
    sc.world = world
    world.color = (0.05, 0.07, 0.16)
    try:
        bg = world.node_tree.nodes['Background']
        bg.inputs['Color'].default_value = (0.05, 0.08, 0.2, 1)
        bg.inputs['Strength'].default_value = 1.4
    except Exception:
        pass
    rows = (len(names) + cols - 1) // cols
    cam_target = Vector((0, (rows - 1) * spacing / 2, 1.2))
    bpy.ops.object.camera_add(location=cam_target + Vector((0, -15 - rows * 4, 9 + rows * 2)))
    cam = bpy.context.active_object
    d = cam_target - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = 30
    sc.camera = cam
    # EEVEE needs EGL (not available headless here) -> Cycles CPU
    import addon_utils
    addon_utils.enable('cycles', default_set=True)
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = int(os.environ.get('SAMPLES', '24'))
    try:
        sc.cycles.use_denoising = True
    except Exception:
        pass
    sc.render.resolution_x = 1600
    sc.render.resolution_y = 900
    sc.render.filepath = out
    try:
        sc.view_settings.view_transform = 'AgX'
    except Exception:
        pass
    bpy.ops.render.render(write_still=True)
    print('wrote', out)


main()
