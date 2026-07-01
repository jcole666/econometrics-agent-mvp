# -*- mode: python ; coding: utf-8 -*-

from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules


ROOT = Path(SPECPATH).parent

PACKAGES = [
    "fastapi",
    "linearmodels",
    "numpy",
    "openpyxl",
    "pandas",
    "patsy",
    "pydantic",
    "python_multipart",
    "scipy",
    "statsmodels",
    "uvicorn",
]

hiddenimports = []
for package in PACKAGES:
    hiddenimports += collect_submodules(package)

datas = [
    (str(ROOT / "examples" / "sample_city_panel.csv"), "examples"),
]
datas += collect_data_files("pandas")
datas += collect_data_files("statsmodels")

a = Analysis(
    [str(ROOT / "sidecar" / "serve.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="econometrics-sidecar",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="econometrics-sidecar",
)
