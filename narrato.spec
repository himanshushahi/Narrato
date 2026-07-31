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
]

# Collect Coqui-TTS (XTTS v2) and other internal assets, filtering out unused models to reduce bundle size
# include_py_files=True: TTS/vocoder/configs/__init__.py and TTS/vocoder/models/__init__.py do
# os.listdir(os.path.dirname(__file__)) at import time to discover their modules. PYZ-only
# packages have NO on-disk directory, so without the .py files the frozen app dies with
# "FileNotFoundError: [WinError 3] ... TTS\vocoder\configs". Copying the whole tree fixes it.
tts_datas = collect_data_files('TTS', include_py_files=True)
datas += tts_datas
# NOTE: previously filtered out 'piper'/'espeak' paths here — that filter
# deleted TTS/tts/utils/text/phonemizers/espeak_wrapper.py, which
# phonemizers/__init__.py imports UNGUARDED (ModuleNotFoundError in frozen
# app). This TTS install ships NO espeak/piper data (espeak-ng is a system
# binary, checked via shutil.which at import), so no filtering is needed.
datas += copy_metadata('coqui-tts')
# ko_speech_tools (coqui-tts Korean g2p dep) reads JSON/dict data via
# importlib.resources.files("ko_speech_tools.data.<sub>") at import time
# (jamo.py, g2p/*.py). Those dotted lookups are dynamic namespace packages
# invisible to PyInstaller's static analysis; collect the whole tree so the
# data dirs exist under _internal and resources.files() can resolve them.
datas += collect_data_files('ko_speech_tools', include_py_files=True)
# inflect (imported by TTS text cleaners) decorates its methods with
# typeguard's @typechecked, which calls inspect.getsource() at decoration time;
# that fails for PYZ-compiled bytecode ("OSError: could not get source code").
# Copy its source to disk (it is also excluded from the PYZ below).
datas += collect_data_files('inflect', include_py_files=True)
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
        'scipy._external.array_api_compat.numpy.fft',
    ] + collect_submodules('transformers') + collect_submodules('TTS'),
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    # NOTE: matplotlib must NOT be excluded — TTS/vocoder/utils/generic_utils.py and
    # TTS/tts/utils/visual.py import it at module top-level, and the vocoder configs
    # enumeration (os.listdir import loop) reaches it via wavegrad/wavernn configs.
    excludes=['ipython', 'notebook', 'tkinter', 'PyQt5', 'tensorboard'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

# Load TTS and inflect from REAL FILES on disk (copied to _internal by the
# include_py_files collections above) instead of the compiled PYZ:
#  - TTS has a circular import chain (TTS/__init__ -> xtts_config -> xtts ->
#    tokenizer -> text -> back into TTS/__init__) that breaks under the frozen
#    PYZ importer with "cannot import name 'XttsConfig' from partially
#    initialized module ... (most likely due to a circular import)".
#  - inflect uses typeguard's @typechecked; typeguard calls inspect.getsource()
#    at decoration time, which fails for PYZ bytecode with
#    "OSError: could not get source code".
# On-disk modules import exactly like dev, fixing both.
a.pure = [
    x for x in a.pure
    if x[0] != 'TTS' and not x[0].startswith('TTS.')
    and x[0] != 'inflect' and not x[0].startswith('inflect.')
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
