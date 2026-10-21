# Configuration file for the Sphinx documentation builder.

import sys
from pathlib import Path

# チラシ文書の autodoc は services/flyer をパッケージルートとして import する。
FLYER_ROOT = Path(__file__).resolve().parents[1] / "services" / "flyer"
if FLYER_ROOT.is_dir():
    sys.path.insert(0, str(FLYER_ROOT))

project = "利用枠管理・課金決済基盤"
copyright = "2026, event-platform-billing"
author = "event-platform-billing"
release = "1.0.0"

language = "ja"

extensions = [
    "myst_parser",
    "sphinxcontrib.mermaid",
    "sphinx.ext.autodoc",
    "sphinx.ext.napoleon",
    "sphinx.ext.viewcode",
]

# ```mermaid のコードブロックを図として描画する。
myst_fence_as_directive = ["mermaid"]
# 拡張は mermaid_init_js を既定文のままにしないと import を足さないので、読み込みから指定する。
_MERMAID_VERSION = "11.12.1"
_ELK_VERSION = "0.2.0"
mermaid_version = _MERMAID_VERSION
mermaid_include_elk = _ELK_VERSION
# ページ上と全画面モーダルの両方で、ホイール拡大とドラッグ移動を有効にする。
mermaid_d3_zoom = True
mermaid_init_js = (
    f'import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@{_MERMAID_VERSION}/dist/mermaid.esm.min.mjs";'
    f'import elkLayouts from "https://cdn.jsdelivr.net/npm/@mermaid-js/layout-elk@{_ELK_VERSION}/dist/mermaid-layout-elk.esm.min.mjs";'
    "mermaid.registerLayoutLoaders(elkLayouts);"
    "mermaid.initialize({startOnLoad:false,layout:'elk'});"
)

autodoc_default_options = {
    "members": True,
    "show-inheritance": True,
    "member-order": "bysource",
}
autodoc_typehints = "description"
autoclass_content = "class"
napoleon_google_docstring = True
napoleon_numpy_docstring = True

source_suffix = {
    ".rst": "restructuredtext",
    ".md": "markdown",
}

templates_path = ["_templates"]
exclude_patterns = [
    "_build",
    "**/_build",
    "**/_build/**",
    "Thumbs.db",
    ".DS_Store",
    "**/requirements.txt",
    "flyer/Makefile",
    "flyer/make.bat",
]

html_theme = "sphinx_rtd_theme"
html_static_path = ["_static"]
html_title = "利用枠管理・課金決済基盤"
html_show_sourcelink = False
