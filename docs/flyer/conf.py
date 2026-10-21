"""Sphinx configuration for the flyer generator."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

project = "AIチラシ自動生成"
author = "博文"
copyright = "2026, 博文"
version = "0.1"
release = "0.1.0"
language = "ja"

extensions = [
    "sphinx.ext.autodoc",
    "sphinx.ext.napoleon",
    "sphinx.ext.viewcode",
    "myst_parser",
]

autodoc_default_options = {
    "members": True,
    "show-inheritance": True,
    "member-order": "bysource",
}
autodoc_typehints = "description"
autoclass_content = "class"
napoleon_google_docstring = True
napoleon_numpy_docstring = True

templates_path: list[str] = []
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store"]

html_theme = "sphinx_rtd_theme"
# 既定の collapse_navigation は True。index.rst の toctree が複数あると、
# 今開いている章以外（たとえばガイド閲覧中の「ガイドの前に」）がサイドバーから消える。
html_theme_options = {
    "collapse_navigation": False,
}
html_static_path: list[str] = []
html_title = "AIチラシ自動生成"
pygments_style = "sphinx"
