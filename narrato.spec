# -*- mode: python ; coding: utf-8 -*-
import os
import sys

# Workaround for PyInstaller path/zipfile creation bugs on Python 3.14
os.makedirs("build/narrato", exist_ok=True)
os.makedirs("build/main", exist_ok=True)

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, copy_metadata, collect_submodules, collect_all

block_cipher = None

# Collect web assets and auxiliary packages
datas = [
    ('frontend/dist', 'frontend/dist'),
    ('frontend/dist-remotion', 'frontend/dist-remotion'),
    ('frontend/dist-render', 'frontend/dist-render'),
    ('frontend/dist-render/node_modules', 'frontend/dist-render/node_modules'),
    # Agent skills: SKILL.md files are read from disk by the skill loader
    # (bundled read-only under BUNDLE_DIR in frozen builds). The agent code
    # itself is collected as Python modules by the Analysis pass.
    ('backend/skills', 'backend/skills'),
]

# Internal assets bundled as real files (PyInstaller data).
# NOTE: Coqui-TTS (XTTS v2) was removed in the OmniVoice migration —
# no TTS / coqui-tts / ko_speech_tools / inflect collection here.
# (inflect was only required by coqui-tts text cleaners.)
# torchcodec needs its FFmpeg shared DLLs at load time; bundle the whole package
# (data files + .pyd/.dll binaries) so the frozen app can load them.
datas += collect_data_files('torchcodec')
datas += collect_dynamic_libs('torchcodec')
# transformers/audio_utils.py does importlib.metadata.version("torchcodec")
# unguarded at import time (inside is_torchcodec_available()); without the
# dist-info the frozen app raises "No package metadata was found for torchcodec"
# wrapped as "Could not import module 'GPT2PreTrainedModel'..." — bundle it.
datas += copy_metadata('torchcodec')
datas += copy_metadata('pillow')
datas += copy_metadata('huggingface_hub')
datas += copy_metadata('transformers')
datas += collect_data_files('transformers', include_py_files=True)
# torch: shipped as REAL FILES and excluded from the PYZ below so an external
# GPU runtime on sys.path[0] (downloaded in-app, backend/core/gpu_runtime.py)
# can shadow the bundled CPU torch. With torch in the PYZ, the frozen importer
# wins over sys.path and the external runtime could never take effect.
datas += collect_data_files('torch', include_py_files=True)

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=[],
    datas=datas,
    hiddenimports=[
        'webview.platforms.winforms',
        'webview.platforms.win32',
        'clr',
        'faster_whisper',
        'edge_tts',
        'omnivoice',
        'soundfile',
        'numpy',
        'torch',
        'requests',
        'PIL',
        # Narrato MCP server (auto-started localhost endpoint, backend/mcp).
        # backend.mcp.* is imported lazily at runtime (never from main.py),
        # so static analysis misses it — collect explicitly.
        'mcp',
        'uvicorn',
        'starlette',
        'sse_starlette',
        'anyio',
        'huggingface_hub',
        'scipy._external.array_api_compat.numpy.fft',
    ] + collect_submodules('transformers') + collect_submodules('omnivoice') + collect_submodules('backend.mcp'),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # NOTE: matplotlib is intentionally not excluded — it is harmless to
    # bundle and may be pulled in by transitive deps.
    excludes=['ipython', 'notebook', 'tkinter', 'PyQt5', 'tensorboard'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

# Load torch from REAL FILES on disk (copied to _internal by the
# include_py_files collection above) instead of the compiled PYZ:
# torch is excluded from the PYZ for SHADOWING: the downloaded GPU runtime is
# inserted at sys.path[0] at startup (main.py -> gpu_runtime.apply_runtime);
# with torch importable from real files it wins over the bundled CPU torch.
a.pure = [
    x for x in a.pure
    if x[0] != 'torch' and not x[0].startswith('torch.')
]

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='Narrato',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='frontend/public/logo.ico',
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='Narrato',
)
