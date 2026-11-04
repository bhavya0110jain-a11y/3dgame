"""Build & export Last Lantern character / enemy GLBs.

Usage (from repo root):
  /home/user/blender-venv/bin/python tools/blender/characters/build.py            # all models
  /home/user/blender-venv/bin/python tools/blender/characters/build.py shade wisp # some
Outputs public/models/enemies/<name>.glb and public/models/characters/bearer.glb.
Afterwards run: node tools/gen-model-manifest.mjs
"""
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import lib  # noqa: E402
import enemies  # noqa: E402
import bosses  # noqa: E402
import bearer  # noqa: E402

ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))

# name -> (builder, category, triangle budget)
MODELS = {
    'shade': (enemies.shade, 'enemies', 2500),
    'crawler': (enemies.crawler, 'enemies', 2500),
    'wisp': (enemies.wisp, 'enemies', 2500),
    'brute': (enemies.brute, 'enemies', 2500),
    'stalker': (enemies.stalker, 'enemies', 2500),
    'spitter': (enemies.spitter, 'enemies', 2500),
    'bog': (enemies.bog, 'enemies', 2500),
    'knight': (enemies.knight, 'enemies', 2500),
    'stag': (bosses.stag, 'enemies', 12000),
    'mire': (bosses.mire, 'enemies', 12000),
    'king': (bosses.king, 'enemies', 12000),
    'bearer': (bearer.bearer, 'characters', 12000),
}


def build(name):
    fn, cat, budget = MODELS[name]
    t = time.time()
    lib.reset()
    objs = fn()
    meshes = [o for o in objs if o.type == 'MESH']
    glow = [o for o in meshes if any(m and m.get('glow') for m in o.data.materials)]
    body = [o for o in meshes if o not in glow]
    n = lib.tri_count(meshes)
    if n > budget:
        lib.decimate_to(body, budget - lib.tri_count(glow))
        n = lib.tri_count(meshes)
    lib.finish(objs, **getattr(fn, 'finish', {}))
    path = os.path.join(ROOT, 'public', 'models', cat, name + '.glb')
    lib.export_glb(lib.all_objects(), path)
    print(f'[build] {name:8s} tris={n:6d} budget={budget} -> {os.path.relpath(path, ROOT)} ({time.time() - t:.1f}s)')


def main():
    names = [a for a in sys.argv[1:] if not a.startswith('-')] or list(MODELS)
    for n in names:
        build(n)


if __name__ == '__main__':
    main()
