project = "イベント紹介ページ生成・出欠管理"
author = "event-platform"
copyright = "2026, event-platform"
language = "ja"

extensions = ["myst_parser"]
source_suffix = {
    ".rst": "restructuredtext",
    ".md": "markdown",
}
exclude_patterns = ["_build", "requirements.txt"]
root_doc = "index"

html_theme = "alabaster"
html_title = project
myst_heading_anchors = 3
