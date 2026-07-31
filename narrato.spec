# -*- mode: python ; coding: utf-8 -*-
import os
import sys

# Workaround for PyInstaller path/zipfile creation bugs on Python 3.14
os.makedirs("build/narrato", exist_ok=True)
os.makedirs("build/main", exist_ok=True)

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, copy_metadata

block_cipher = None

# Collect web assets and auxiliary packages
datas = [
    ('frontend/dist', 'frontend/dist'),
    ('frontend/dist-remotion', 'frontend/dist-remotion'),
    ('frontend/dist-render', 'frontend/dist-render'),
    ('frontend/dist-render/node_modules', 'frontend/dist-render/node_modules'),
]

# Collect Coqui-TTS (XTTS v2) and other internal assets
datas += collect_data_files('TTS')
datas += copy_metadata('TTS')
# torchcodec needs its FFmpeg shared DLLs at load time; bundle the whole package
# (data files + .pyd/.dll binaries) so the frozen app can load them.
datas += collect_data_files('torchcodec')
datas += collect_dynamic_libs('torchcodec')
datas += copy_metadata('pillow')
datas += copy_metadata('huggingface_hub')

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
        'TTS',
        'soundfile',
        'numpy',
        'torch',
        'requests',
        'PIL',
        'huggingface_hub',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['matplotlib', 'ipython', 'notebook'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

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
    upx=True,
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
    upx=True,
    upx_exclude=[],
    name='Narrato',
)
