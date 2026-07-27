# -*- mode: python ; coding: utf-8 -*-
import os
import sys

# Workaround for PyInstaller path/zipfile creation bugs on Python 3.14
os.makedirs("build/narrato", exist_ok=True)
os.makedirs("build/main", exist_ok=True)

from PyInstaller.utils.hooks import collect_data_files, copy_metadata

block_cipher = None

# Collect web assets and auxiliary packages
datas = [
    ('frontend/dist', 'frontend/dist'),
    ('frontend/dist-remotion', 'frontend/dist-remotion'),
    ('frontend/dist-render', 'frontend/dist-render'),
    ('frontend/dist-render/node_modules', 'frontend/dist-render/node_modules'),
]

# Collect Kokoro's and other internal assets
datas += collect_data_files('kokoro_onnx')
datas += collect_data_files('language_tags')
datas += collect_data_files('phonemizer')
datas += collect_data_files('espeakng_loader')
datas += collect_data_files('piper')
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
        'kokoro_onnx',
        'soundfile',
        'numpy',
        'onnxruntime',
        'torch',
        'requests',
        'PIL',
        'piper',
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
