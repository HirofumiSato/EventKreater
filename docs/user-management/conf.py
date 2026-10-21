# Configuration file for the Sphinx documentation builder.
#
# For the full list of built-in configuration values, see the documentation:
# https://www.sphinx-doc.org/en/master/usage/configuration.html

# -- Project information -----------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#project-information

project = "イベントユーザー登録管理"
copyright = "2026, 博文"
author = "博文"

# -- General configuration ---------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#general-configuration

extensions = [
    "myst_parser",
]

templates_path = ["_templates"]
exclude_patterns = ["_build", "Thumbs.db", ".DS_Store"]

language = "ja"

source_suffix = {
    ".rst": "restructuredtext",
    ".md": "markdown",
}

# -- Options for HTML output -------------------------------------------------
# https://www.sphinx-doc.org/en/master/usage/configuration.html#options-for-html-output

html_theme = "alabaster"
html_static_path = ["_static"]
html_title = project
html_show_sourcelink = False
html_css_files = [
    "https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@400;500;700&display=swap",
    "custom.css",
]
html_theme_options = {
    "page_width": "1080px",
    "sidebar_width": "300px",
    "font_family": '"Zen Kaku Gothic New", "Yu Gothic", YuGothic, sans-serif',
    "head_font_family": '"Zen Kaku Gothic New", "Yu Gothic", YuGothic, sans-serif',
    "caption_font_family": '"Zen Kaku Gothic New", "Yu Gothic", YuGothic, sans-serif',
    "font_size": "16px",
    "code_font_family": 'ui-monospace, "Cascadia Mono", Consolas, monospace',
    "code_font_size": "0.8125rem",
    "logo_text_align": "left",
    "base_bg": "#f4f3ef",
    "base_text": "#1a1916",
    "body_text": "#1a1916",
    "body_bg": "#ffffff",
    "footer_text": "#5c574e",
    "link": "#8f241d",
    "link_hover": "#b4332a",
    "sidebar_text": "#3f3c36",
    "sidebar_link": "#1a1916",
    "sidebar_link_underscore": "transparent",
    "sidebar_header": "#1a1916",
    "sidebar_search_button": "#b7b1a6",
    "sidebar_list": "#1a1916",
    "gray_1": "#1a1916",
    "gray_2": "#f4f3ef",
    "gray_3": "#b7b1a6",
    "hr_border": "#d5d0c6",
    "anchor": "#b7b1a6",
    "anchor_hover_fg": "#b4332a",
    "anchor_hover_bg": "#f4f3ef",
    "table_border": "#d5d0c6",
    "code_bg": "#f4f3ef",
    "code_text": "#1a1916",
    "code_hover": "#eeece7",
    "highlight_bg": "#f4f3ef",
    "narrow_sidebar_bg": "#ffffff",
    "narrow_sidebar_fg": "#1a1916",
    "narrow_sidebar_link": "#1a1916",
    "show_powered_by": False,
}
