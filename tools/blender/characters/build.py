"""Build & export Last Lantern character / enemy GLBs.

Usage (from repo root):
  /home/user/blender-venv/bin/python tools/blender/characters/build.py            # all models
  /home/user/blender-venv/bin/python tools/blender/characters/build.py shade wisp # some
Outputs public/models/enemies/<name>.glb (+ <name>_lo.glb horde LOD for regular enemies) and
public/models/characters/bearer.glb.

Triangle budgets (production/qa/perf-report.md): regular enemies are drawn by the hundreds, so
  - glow parts (eyes, flames, runes: unlit InstancedMesh) are decimated to GLOW_HI / GLOW_LO triangles;
  - the _lo variant (body ~LO_BODY tris) is what the game draws on low/medium tiers and in big hordes on high.
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
    'blob': (enemies.blob, 'enemies', 2500),
    'bloater': (enemies.bloater, 'enemies', 2500),
    'warden': (enemies.warden, 'enemies', 2500),
    'stag': (bosses.stag, 'enemies', 12000),
    'mire': (bosses.mire, 'enemies', 12000),
    'king': (bosses.king, 'enemies', 12000),
    'bearer': (bearer.bearer, 'characters', 12000),
}


# regular-enemy LOD budgets (triangles). Per-model glow overrides where the glow IS the silhouette (wisp flames).
GLOW_HI = 150
GLOW_LO = 56
LO_BODY = 760
GLOW_OVERRIDE = {'wisp': (260, 120), 'spitter': (170, 70), 'blob': (150, 64)}
BOSSES = {'stag', 'mire', 'king'}


def build(name):
    fn, cat, budget = MODELS[name]
    t = time.time()
    lib.reset()
    objs = fn()
    meshes = [o for o in objs if o.type == 'MESH']
    glow = [o for o in meshes if any(m and m.get('glow') for m in o.data.materials)]
    body = [o for o in meshes if o not in glow]
    regular = cat == 'enemies' and name not in BOSSES
    ghi, glo = GLOW_OVERRIDE.get(name, (GLOW_HI, GLOW_LO))
    if regular:
        lib.decimate_group_to(glow, ghi, min_tris=10, skip_below=14)
    n = lib.tri_count(meshes)
    if n > budget:
        lib.decimate_to(body, budget - lib.tri_count(glow))
        n = lib.tri_count(meshes)
    nb, ng = lib.tri_count(body), lib.tri_count(glow)
    lib.finish(objs, **getattr(fn, 'finish', {}))
    path = os.path.join(ROOT, 'public', 'models', cat, name + '.glb')
    lib.export_glb(lib.all_objects(), path)
    print(f'[build] {name:8s} tris={n:6d} (body {nb}, glow {ng}) budget={budget} -> {os.path.relpath(path, ROOT)} ({time.time() - t:.1f}s)')
    if regular:
        # horde LOD: decimate the finished (AO-painted) meshes; colours are interpolated by the collapse
        lib.decimate_group_to(body, LO_BODY, min_tris=12, skip_below=24)
        lib.decimate_group_to(glow, glo, min_tris=8, skip_below=12)
        nb, ng = lib.tri_count(body), lib.tri_count(glow)
        path = os.path.join(ROOT, 'public', 'models', cat, name + '_lo.glb')
        lib.export_glb(lib.all_objects(), path)
        print(f'[build] {name + "_lo":8s} tris={nb + ng:6d} (body {nb}, glow {ng}) -> {os.path.relpath(path, ROOT)}')


def main():
    names = [a for a in sys.argv[1:] if not a.startswith('-')] or list(MODELS)
    for n in names:
        build(n)


if __name__ == '__main__':
    main()
