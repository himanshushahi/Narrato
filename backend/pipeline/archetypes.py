"""25-Archetype Macro-Compiler Engine.

Part of Narrato's broadcast-grade studio architecture. Elevates the LLM from
an assembly-level coordinate calculator to a Creative Director. Translates high-level
archetype slots and design tokens into hardened, production-grade 4–7 layer AST compositions.
"""
from __future__ import annotations

import copy
import logging
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


def _resolve_tokens(design_tokens: Optional[Dict[str, Any]]) -> Dict[str, str]:
    """Extract design tokens with broadcast defaults."""
    palette = (design_tokens or {}).get("color_palette") or {}
    typo = (design_tokens or {}).get("typography") or {}
    return {
        "bg": palette.get("background") or "#0b0b1a",
        "primary": palette.get("primary") or "#00d4ff",
        "secondary": palette.get("secondary") or "#7c3aed",
        "accent": palette.get("accent") or "#facc15",
        "text": palette.get("text") or "#ffffff",
        "heading_font": typo.get("heading_font") or "Outfit",
        "body_font": typo.get("body_font") or "Inter",
    }


# ============================================================================
# Category 1: High-Impact Typography & Hooks (3 Archetypes)
# ============================================================================

def build_kinetic_punch(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    headline = params.get("headline") or "ATTENTION HOOK"
    accent_word = params.get("accent_word") or (headline.split()[-1] if headline.split() else "")
    accent_box = params.get("accent_box", True)
    bg_style = params.get("background_style") or "mesh_dark"
    preset = "grid_flow" if bg_style == "gradient_glow" else "gradient_mesh"

    layers = [
        {
            "type": "Layer",
            "name": "Background mesh",
            "content": {
                "type": "Background",
                "background_preset": preset,
                "colors": [tokens["bg"], tokens["secondary"], tokens["primary"]],
                "speed": 1.4,
            },
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Particle burst",
            "content": {
                "type": "Particles",
                "particle_preset": "sparkles" if bg_style == "particles_burst" else "dust",
                "particle_count": 35,
                "particle_opacity": 0.25,
                "particle_speed": 1.2,
                "particle_direction": "outward",
            },
            "animations": [],
        },
    ]

    if accent_box:
        layers.append({
            "type": "Layer",
            "name": "Accent highlight box",
            "content": {
                "type": "Shape",
                "shape_type": "rectangle",
                "fill": "transparent",
                "stroke": tokens["accent"],
                "stroke_width": 3,
                "corner_radius": 16,
                "glow": True,
                "style": {
                    "position": "absolute",
                    "left": "10%" if is_portrait else "15%",
                    "top": "34%" if is_portrait else "32%",
                    "width": "80%" if is_portrait else "70%",
                    "height": "32%" if is_portrait else "36%",
                },
            },
            "animations": [
                {"property": "scale", "from": 0.85, "to": 1.0, "duration": 0.4, "delay": 0.2, "easing": "spring"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.3, "delay": 0.2, "easing": "ease-out"},
            ],
        })

    layers.append({
        "type": "Layer",
        "name": "Hero typography",
        "content": {
            "type": "Text",
            "text": headline,
            "font": tokens["heading_font"],
            "weight": "800",
            "color": tokens["text"],
            "animation_mode": "words_stagger",
            "highlight_words": [accent_word] if accent_word else [],
            "highlight_color": tokens["accent"],
            "style": {
                "position": "absolute",
                "left": "8%" if is_portrait else "12%",
                "top": "38%" if is_portrait else "36%",
                "width": "84%" if is_portrait else "76%",
                "fontSize": "64px" if is_portrait else "80px",
                "textAlign": "center",
                "lineHeight": 1.2,
            },
        },
        "animations": [
            {"property": "translateY", "from": 50, "to": 0, "duration": 0.5, "delay": 0.25, "easing": "spring"},
            {"property": "opacity", "from": 0, "to": 1, "duration": 0.35, "delay": 0.25, "easing": "ease-out"},
        ],
    })

    return {
        "duration": duration,
        "transition": "zoom_in",
        "emphasis": [{"at": 0.5, "scale": 1.15, "duration": 0.35}],
        "composition": {"type": "Sequence", "children": layers},
    }


def build_quote_statement(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    quote = params.get("quote_text") or "The future belongs to those who believe in it."
    author = params.get("author_name") or "Source"
    title = params.get("author_title") or "Official Statement"
    query = params.get("author_image_query") or "executive portrait studio"

    layers = [
        {
            "type": "Layer",
            "name": "Atmospheric backdrop",
            "content": {
                "type": "Background",
                "background_preset": "vignette_loop",
                "colors": [tokens["bg"], tokens["secondary"]],
                "speed": 0.8,
            },
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Giant watermark quote mark",
            "content": {
                "type": "Text",
                "text": "“",
                "font": "Georgia",
                "weight": "900",
                "color": tokens["primary"],
                "style": {
                    "position": "absolute",
                    "left": "5%",
                    "top": "12%",
                    "width": "30%",
                    "fontSize": "220px",
                    "opacity": 0.15,
                },
            },
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Author portrait cutout",
            "content": {
                "type": "Image",
                "query": query,
                "source": "wikipedia" if " " in query else "pexels",
                "objectFit": "cover",
                "style": {
                    "position": "absolute",
                    "left": "10%" if is_portrait else "12%",
                    "top": "18%" if is_portrait else "28%",
                    "width": "30%" if is_portrait else "22%",
                    "aspectRatio": "1 / 1",
                    "borderRadius": "50%",
                    "border": f"3px solid {tokens['primary']}",
                },
            },
            "animations": [
                {"property": "scale", "from": 0.8, "to": 1.0, "duration": 0.5, "delay": 0.2, "easing": "spring"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.2, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Quote body text",
            "content": {
                "type": "Text",
                "text": f'"{quote}"',
                "font": tokens["heading_font"],
                "weight": "600",
                "color": tokens["text"],
                "animation_mode": "words_stagger",
                "style": {
                    "position": "absolute",
                    "left": "8%" if is_portrait else "38%",
                    "top": "46%" if is_portrait else "26%",
                    "width": "84%" if is_portrait else "54%",
                    "fontSize": "38px" if is_portrait else "44px",
                    "lineHeight": 1.35,
                    "fontStyle": "italic",
                },
            },
            "animations": [
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.5, "delay": 0.4, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Author attribution pill",
            "content": {
                "type": "Text",
                "text": f"— {author} | {title}",
                "font": tokens["body_font"],
                "weight": "700",
                "color": tokens["accent"],
                "style": {
                    "position": "absolute",
                    "left": "8%" if is_portrait else "38%",
                    "top": "70%" if is_portrait else "64%",
                    "width": "84%" if is_portrait else "54%",
                    "fontSize": "24px",
                    "letterSpacing": "0.05em",
                },
            },
            "animations": [
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.7, "easing": "ease-out"},
            ],
        },
    ]

    return {
        "duration": duration,
        "transition": "fade",
        "composition": {"type": "Sequence", "children": layers},
    }


def build_lexicon_definition(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    term = params.get("term") or "Terminology"
    pronunciation = params.get("pronunciation") or "/tɜː.mɪˈnɒl.ə.dʒi/"
    part_of_speech = params.get("part_of_speech") or "noun"
    definition = params.get("definition") or "A system of specialized terms used in a specific discipline or technology."

    layers = [
        {
            "type": "Layer",
            "name": "Blueprint grid",
            "content": {
                "type": "Background",
                "background_preset": "blueprint",
                "colors": [tokens["bg"], tokens["secondary"]],
                "speed": 0.7,
            },
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Frosted lexicon card",
            "content": {
                "type": "Shape",
                "shape_type": "rectangle",
                "fill": "rgba(15, 23, 42, 0.75)",
                "stroke": tokens["primary"],
                "stroke_width": 1.5,
                "corner_radius": 24,
                "glow": True,
                "style": {
                    "position": "absolute",
                    "left": "8%" if is_portrait else "14%",
                    "top": "20%" if is_portrait else "22%",
                    "width": "84%" if is_portrait else "72%",
                    "height": "56%" if is_portrait else "56%",
                },
            },
            "animations": [
                {"property": "scale", "from": 0.9, "to": 1.0, "duration": 0.5, "delay": 0.2, "easing": "spring"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.2, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Term header",
            "content": {
                "type": "Text",
                "text": term,
                "font": tokens["heading_font"],
                "weight": "800",
                "color": tokens["accent"],
                "style": {
                    "position": "absolute",
                    "left": "12%" if is_portrait else "18%",
                    "top": "24%" if is_portrait else "27%",
                    "width": "76%" if is_portrait else "64%",
                    "fontSize": "56px" if is_portrait else "64px",
                },
            },
            "animations": [
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.35, "delay": 0.3, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Pronunciation and part of speech",
            "content": {
                "type": "Text",
                "text": f"{pronunciation}  •  [{part_of_speech}]",
                "font": tokens["body_font"],
                "weight": "500",
                "color": "#94a3b8",
                "style": {
                    "position": "absolute",
                    "left": "12%" if is_portrait else "18%",
                    "top": "34%" if is_portrait else "38%",
                    "width": "76%" if is_portrait else "64%",
                    "fontSize": "26px",
                    "fontStyle": "italic",
                },
            },
            "animations": [
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.35, "delay": 0.45, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Definition body",
            "content": {
                "type": "Text",
                "text": definition,
                "font": tokens["body_font"],
                "weight": "400",
                "color": tokens["text"],
                "animation_mode": "words_stagger",
                "style": {
                    "position": "absolute",
                    "left": "12%" if is_portrait else "18%",
                    "top": "44%" if is_portrait else "48%",
                    "width": "76%" if is_portrait else "64%",
                    "fontSize": "32px",
                    "lineHeight": 1.4,
                },
            },
            "animations": [
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.5, "delay": 0.6, "easing": "ease-out"},
            ],
        },
    ]

    return {
        "duration": duration,
        "transition": "slide_up",
        "composition": {"type": "Sequence", "children": layers},
    }


# ============================================================================
# Category 2: Data, Finance & Metrics (5 Archetypes)
# ============================================================================

def build_data_surge(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    val_raw = params.get("value") if params.get("value") is not None else params.get("target_number")
    val = float(val_raw if val_raw is not None else 1000000)
    prefix = params.get("prefix") if params.get("prefix") is not None else "$"
    suffix = params.get("suffix") or (f" {params['unit']}" if params.get("unit") else "")
    fmt = params.get("format") or "compact"
    delta = params.get("delta") or params.get("trend") or "+185%"
    label = params.get("label") or "TOTAL METRIC"

    layers = [
        {
            "type": "Layer",
            "name": "Data grid canvas",
            "content": {
                "type": "Background",
                "background_preset": "grid_flow",
                "colors": [tokens["bg"], tokens["secondary"], tokens["primary"]],
                "speed": 1.2,
            },
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Metric HUD frame",
            "content": {
                "type": "Shape",
                "shape_type": "rectangle",
                "fill": "rgba(10, 15, 30, 0.7)",
                "stroke": tokens["primary"],
                "stroke_width": 2,
                "corner_radius": 24,
                "glow": True,
                "style": {
                    "position": "absolute",
                    "left": "8%" if is_portrait else "16%",
                    "top": "22%" if is_portrait else "20%",
                    "width": "84%" if is_portrait else "68%",
                    "height": "56%" if is_portrait else "60%",
                },
            },
            "animations": [
                {"property": "scale", "from": 0.88, "to": 1.0, "duration": 0.45, "delay": 0.2, "easing": "spring"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.35, "delay": 0.2, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Metric Counter",
            "content": {
                "type": "Counter",
                "value": val,
                "prefix": prefix,
                "suffix": suffix,
                "format": fmt,
                "font_size": 84 if is_portrait else 96,
                "title": label,
                "color": tokens["accent"],
                "duration": min(duration * 0.7, 2.5),
                "style": {
                    "position": "absolute",
                    "left": "10%" if is_portrait else "18%",
                    "top": "28%" if is_portrait else "26%",
                    "width": "80%" if is_portrait else "64%",
                },
            },
            "animations": [
                {"property": "translateY", "from": 30, "to": 0, "duration": 0.5, "delay": 0.3, "easing": "spring"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.3, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Delta growth badge",
            "content": {
                "type": "Shape",
                "shape_type": "rectangle",
                "fill": "rgba(34, 197, 94, 0.2)",
                "stroke": "#22c55e",
                "stroke_width": 1.5,
                "corner_radius": 50,
                "style": {
                    "position": "absolute",
                    "left": "35%" if is_portrait else "40%",
                    "top": "62%" if is_portrait else "64%",
                    "width": "30%" if is_portrait else "20%",
                    "height": "8%",
                },
            },
            "floating": True,
            "animations": [
                {"property": "scale", "from": 0, "to": 1.0, "duration": 0.4, "delay": 0.6, "easing": "back"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.3, "delay": 0.6, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Delta text",
            "content": {
                "type": "Text",
                "text": delta,
                "font": tokens["heading_font"],
                "weight": "800",
                "color": "#22c55e",
                "style": {
                    "position": "absolute",
                    "left": "35%" if is_portrait else "40%",
                    "top": "63.5%" if is_portrait else "65.5%",
                    "width": "30%" if is_portrait else "20%",
                    "fontSize": "26px",
                    "textAlign": "center",
                },
            },
            "animations": [
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.3, "delay": 0.65, "easing": "ease-out"},
            ],
        },
    ]

    return {
        "duration": duration,
        "transition": "zoom_in",
        "emphasis": [{"at": 1.5, "scale": 1.08, "duration": 0.4}],
        "composition": {"type": "Sequence", "children": layers},
    }


def build_split_bar_comparison(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    bars = params.get("bars") or [
        {"label": "Competitor A", "value": 45, "color": tokens["primary"]},
        {"label": "Competitor B", "value": 85, "color": tokens["accent"]},
    ]
    title = params.get("title") or "MARKET COMPARISON"

    layers = [
        {
            "type": "Layer",
            "name": "Dots background",
            "content": {"type": "Background", "background_preset": "dots", "colors": [tokens["bg"], tokens["secondary"]], "speed": 1.0},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Comparison Title",
            "content": {
                "type": "Text",
                "text": title,
                "font": tokens["heading_font"],
                "weight": "800",
                "color": tokens["text"],
                "style": {
                    "position": "absolute",
                    "left": "8%",
                    "top": "14%",
                    "width": "84%",
                    "fontSize": "48px",
                    "textAlign": "center",
                },
            },
            "animations": [
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.2, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Comparison Bar Chart",
            "content": {
                "type": "Chart",
                "chart_type": "bar",
                "data": bars,
                "title": "",
                "bar_radius": 12,
                "bar_glow": True,
                "style": {
                    "position": "absolute",
                    "left": "10%" if is_portrait else "18%",
                    "top": "28%",
                    "width": "80%" if is_portrait else "64%",
                    "height": "50%",
                },
            },
            "animations": [
                {"property": "scale", "from": 0.9, "to": 1.0, "duration": 0.5, "delay": 0.4, "easing": "spring"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.4, "easing": "ease-out"},
            ],
        },
    ]

    return {
        "duration": duration,
        "transition": "slide_left",
        "composition": {"type": "Sequence", "children": layers},
    }


def build_donut_distribution(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    segments = params.get("segments") or params.get("slices") or [
        {"label": "Allocation A", "value": 50, "color": tokens["primary"]},
        {"label": "Allocation B", "value": 30, "color": tokens["secondary"]},
        {"label": "Allocation C", "value": 20, "color": tokens["accent"]},
    ]
    center_label = params.get("center_label") or params.get("center_stat") or "DISTRIBUTION"
    title = params.get("title") or "CAPITAL ALLOCATION BREAKDOWN"

    layers = [
        {
            "type": "Layer",
            "name": "Radial backdrop",
            "content": {"type": "Background", "background_preset": "vignette_loop", "colors": [tokens["bg"], tokens["secondary"]], "speed": 1.0},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Particle atmosphere",
            "content": {"type": "Particles", "particle_preset": "dust", "particle_count": 30, "style": {"position": "absolute", "width": "100%", "height": "100%"}},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Header title",
            "content": {
                "type": "Text",
                "text": title,
                "font": tokens["heading_font"],
                "weight": "800",
                "color": tokens["text"],
                "style": {
                    "position": "absolute",
                    "left": "10%",
                    "top": "12%",
                    "width": "80%",
                    "fontSize": "32px" if is_portrait else "40px",
                    "textAlign": "center",
                },
            },
            "animations": [
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.15, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Donut Chart",
            "content": {
                "type": "Chart",
                "chart_type": "donut",
                "data": segments,
                "title": center_label,
                "style": {
                    "position": "absolute",
                    "left": "8%" if is_portrait else "15%",
                    "top": "24%",
                    "width": "84%" if is_portrait else "70%",
                    "height": "60%",
                },
            },
            "animations": [
                {"property": "scale", "from": 0.85, "to": 1.0, "duration": 0.5, "delay": 0.3, "easing": "spring"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.3, "easing": "ease-out"},
            ],
        },
    ]

    return {
        "duration": duration,
        "transition": "crossfade",
        "composition": {"type": "Sequence", "children": layers},
    }


def build_financial_trendline(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    trend = params.get("trend") or "bullish"
    data_points = params.get("data_points") or [10, 25, 18, 42, 68, 95]
    annotation = params.get("annotation") or ("SURGE EVENT" if trend == "bullish" else "MARKET COLLAPSE")
    color = "#22c55e" if trend == "bullish" else "#ef4444"

    chart_data = [{"label": f"T{i}", "value": v, "color": color} for i, v in enumerate(data_points)]

    layers = [
        {
            "type": "Layer",
            "name": "Coordinate grid",
            "content": {"type": "Background", "background_preset": "blueprint", "colors": [tokens["bg"], tokens["secondary"]], "speed": 0.8},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Trendline graph",
            "content": {
                "type": "Chart",
                "chart_type": "line",
                "data": chart_data,
                "title": "",
                "style": {
                    "position": "absolute",
                    "left": "8%" if is_portrait else "14%",
                    "top": "24%",
                    "width": "84%" if is_portrait else "72%",
                    "height": "52%",
                },
            },
            "animations": [
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.25, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Annotation callout card",
            "content": {
                "type": "Shape",
                "shape_type": "rectangle",
                "fill": "rgba(15, 23, 42, 0.85)",
                "stroke": color,
                "stroke_width": 2,
                "corner_radius": 16,
                "glow": True,
                "style": {
                    "position": "absolute",
                    "left": "30%" if is_portrait else "55%",
                    "top": "18%" if is_portrait else "22%",
                    "width": "40%" if is_portrait else "30%",
                    "height": "10%",
                },
            },
            "animations": [
                {"property": "scale", "from": 0.5, "to": 1.0, "duration": 0.4, "delay": 0.6, "easing": "back"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.3, "delay": 0.6, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Annotation text",
            "content": {
                "type": "Text",
                "text": annotation,
                "font": tokens["heading_font"],
                "weight": "800",
                "color": color,
                "style": {
                    "position": "absolute",
                    "left": "30%" if is_portrait else "55%",
                    "top": "20%" if is_portrait else "24.5%",
                    "width": "40%" if is_portrait else "30%",
                    "fontSize": "22px",
                    "textAlign": "center",
                },
            },
            "animations": [
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.3, "delay": 0.65, "easing": "ease-out"},
            ],
        },
    ]

    return {
        "duration": duration,
        "transition": "slide_right",
        "composition": {"type": "Sequence", "children": layers},
    }


def build_timeline_descent(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    steps = params.get("steps") or [
        {"timestamp": "PHASE 1", "headline": "Initial Infiltration", "subtext": "Spear-phishing vector"},
        {"timestamp": "PHASE 2", "headline": "Privilege Escalation", "subtext": "Root access acquired"},
        {"timestamp": "PHASE 3", "headline": "Asset Exfiltration", "subtext": "Wallet drained completely"},
    ]

    layers = [
        {
            "type": "Layer",
            "name": "Paper texture backdrop",
            "content": {"type": "Background", "background_preset": "paper_grain", "colors": [tokens["bg"], tokens["secondary"]], "speed": 0.8},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Vertical spine line",
            "content": {
                "type": "Shape",
                "shape_type": "rectangle",
                "fill": tokens["primary"],
                "corner_radius": 2,
                "style": {
                    "position": "absolute",
                    "left": "12%" if is_portrait else "18%",
                    "top": "20%",
                    "width": "0.8%",
                    "height": "60%",
                },
            },
            "animations": [
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.2, "easing": "ease-out"},
            ],
        },
    ]

    # Add 3 milestone cards
    y_starts = ["22%", "42%", "62%"]
    for i, step in enumerate(steps[:3]):
        delay = 0.3 + (i * 0.25)
        layers.append({
            "type": "Layer",
            "name": f"Milestone #{i + 1}",
            "content": {
                "type": "Text",
                "text": f"{step.get('timestamp')}: {step.get('headline')} — {step.get('subtext', '')}",
                "font": tokens["heading_font"],
                "weight": "700",
                "color": tokens["accent"] if i == len(steps) - 1 else tokens["text"],
                "style": {
                    "position": "absolute",
                    "left": "16%" if is_portrait else "22%",
                    "top": y_starts[i],
                    "width": "76%" if is_portrait else "68%",
                    "fontSize": "26px" if is_portrait else "32px",
                },
            },
            "animations": [
                {"property": "translateX", "from": 40, "to": 0, "duration": 0.5, "delay": delay, "easing": "spring"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.35, "delay": delay, "easing": "ease-out"},
            ],
        })

    return {
        "duration": duration,
        "transition": "slide_down",
        "composition": {"type": "Sequence", "children": layers},
    }


# ============================================================================
# Category 3: Investigation, Tech & Forensics (5 Archetypes)
# ============================================================================

def build_dossier_breakdown(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    name = params.get("name") or "CLASSIFIED TARGET"
    identifier = params.get("identifier") or "SUBJECT #04-ALPHA"
    query = params.get("subject_query") or "hacker shadow hood"
    stamp = params.get("stamp_text") or "CONFIDENTIAL"

    layers = [
        {
            "type": "Layer",
            "name": "Schematic blueprint",
            "content": {"type": "Background", "background_preset": "blueprint", "colors": [tokens["bg"], tokens["secondary"]], "speed": 0.7},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Subject photo cutout",
            "content": {
                "type": "Image",
                "query": query,
                "source": "pexels",
                "objectFit": "cover",
                "style": {
                    "position": "absolute",
                    "left": "8%" if is_portrait else "12%",
                    "top": "18%" if is_portrait else "22%",
                    "width": "84%" if is_portrait else "32%",
                    "height": "35%" if is_portrait else "54%",
                    "borderRadius": "16px",
                    "border": f"2px solid {tokens['primary']}",
                },
            },
            "animations": [
                {"property": "scale", "from": 0.95, "to": 1.0, "duration": 0.5, "delay": 0.2, "easing": "ease-out"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.2, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Dossier details card",
            "content": {
                "type": "HTML",
                "html_content": (
                    f'<div style="width:100%;height:100%;box-sizing:border-box;background:rgba(15,23,42,0.85);'
                    f'border:1px solid rgba(255,255,255,0.15);border-radius:16px;padding:20px;font-family:monospace;color:#f8fafc;">'
                    f'<div style="font-size:20px;color:{tokens["accent"]};font-weight:bold;">{identifier}</div>'
                    f'<div style="font-size:32px;font-weight:900;margin:8px 0;">{name}</div>'
                    f'<div style="margin-top:12px;font-size:16px;color:#94a3b8;line-height:1.5;">'
                    f'STATUS: ACTIVE INVESTIGATION<br>RISK LEVEL: SEVERE<br>VERIFICATION: BLOCKCHAIN FORENSICS'
                    f'</div></div>'
                ),
                "style": {
                    "position": "absolute",
                    "left": "8%" if is_portrait else "48%",
                    "top": "56%" if is_portrait else "22%",
                    "width": "84%" if is_portrait else "40%",
                    "height": "28%" if is_portrait else "54%",
                },
            },
            "animations": [
                {"property": "translateX", "from": 40, "to": 0, "duration": 0.5, "delay": 0.35, "easing": "spring"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.35, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Forensic stamp",
            "content": {
                "type": "Text",
                "text": stamp,
                "font": "Courier New",
                "weight": "900",
                "color": "#ef4444",
                "style": {
                    "position": "absolute",
                    "left": "45%" if is_portrait else "36%",
                    "top": "24%" if is_portrait else "30%",
                    "width": "45%" if is_portrait else "25%",
                    "fontSize": "36px",
                    "border": "3px solid #ef4444",
                    "padding": "6px",
                    "textAlign": "center",
                    "rotate": "-14deg",
                },
            },
            "camera_shake": "handheld",
            "animations": [
                {"property": "scale", "from": 1.6, "to": 1.0, "duration": 0.3, "delay": 0.7, "easing": "spring"},
                {"property": "opacity", "from": 0, "to": 0.9, "duration": 0.2, "delay": 0.7, "easing": "ease-out"},
            ],
        },
    ]

    return {
        "duration": duration,
        "transition": "slide_left",
        "composition": {"type": "Sequence", "children": layers},
    }


def build_evidence_document(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    title = params.get("doc_title") or params.get("document_title") or "INTERNAL LEAKED DOCUMENT"
    stamp = params.get("stamp") or "LEAKED"
    lines = params.get("content_lines") or [
        "From: Executive Security Group",
        "Subject: Urgent: Unidentified wallet activity detected",
        "Action required: Freeze cold storage key 0x4B... immediately",
        "Note: 42,000,000 tokens transferred at 04:12 UTC",
    ]
    highlight_text = params.get("highlight_text")
    if highlight_text and highlight_text not in lines:
        lines.append(f"CRITICAL FINDING: {highlight_text}")
    highlight_idx = int(params.get("highlighted_line_index", len(lines) - 1))

    rendered_lines = "".join(
        f'<div style="margin: 8px 0; padding: 4px; {"background: rgba(250, 204, 21, 0.35); border-left: 4px solid #facc15;" if i == highlight_idx else ""}">{line}</div>'
        for i, line in enumerate(lines)
    )

    layers = [
        {
            "type": "Layer",
            "name": "Desk texture backdrop",
            "content": {"type": "Background", "background_preset": "paper_grain", "colors": ["#0f172a", "#1e293b"], "speed": 0.6},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "3D Tilted paper document",
            "content": {
                "type": "HTML",
                "html_content": (
                    f'<div style="width:100%;height:100%;box-sizing:border-box;background:#f8fafc;color:#0f172a;'
                    f'padding:28px;border-radius:8px;box-shadow:0 25px 50px -12px rgba(0,0,0,0.7);font-family:Courier New, monospace;">'
                    f'<div style="font-size:18px;font-weight:900;border-bottom:2px solid #cbd5e1;padding-bottom:10px;margin-bottom:14px;color:#dc2626;">'
                    f'TOP SECRET // {title}</div>'
                    f'<div style="font-size:18px;line-height:1.5;">{rendered_lines}</div>'
                    f'</div>'
                ),
                "style": {
                    "position": "absolute",
                    "left": "8%" if is_portrait else "16%",
                    "top": "16%",
                    "width": "84%" if is_portrait else "68%",
                    "height": "68%",
                },
            },
            "perspective": 1000,
            "animations": [
                {"property": "translateY", "from": 50, "to": 0, "duration": 0.6, "delay": 0.25, "easing": "spring"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.25, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Forensic red stamp",
            "content": {
                "type": "Text",
                "text": f"[{stamp}]",
                "font": "Courier New",
                "weight": "900",
                "color": "#dc2626",
                "style": {
                    "position": "absolute",
                    "left": "52%" if is_portrait else "60%",
                    "top": "20%",
                    "width": "36%" if is_portrait else "22%",
                    "fontSize": "32px",
                    "border": "3px solid #dc2626",
                    "padding": "6px",
                    "textAlign": "center",
                    "rotate": "-15deg",
                },
            },
            "animations": [
                {"property": "scale", "from": 1.5, "to": 1.0, "duration": 0.35, "delay": 0.6, "easing": "spring"},
                {"property": "opacity", "from": 0, "to": 0.95, "duration": 0.2, "delay": 0.6, "easing": "ease-out"},
            ],
        },
    ]

    return {
        "duration": duration,
        "transition": "zoom_in",
        "emphasis": [{"at": 1.2, "scale": 1.1, "duration": 0.4}],
        "composition": {"type": "Sequence", "children": layers},
    }


def build_terminal_code_log(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    title = params.get("terminal_title") or "bash — exploit_payload.py"
    code = params.get("code_snippet") or (
        ">> Connecting to target socket: 192.168.1.104:8443...\n"
        ">> Injecting buffer overflow payload...\n"
        ">> [CRITICAL] Memory protection bypassed (ASLR disabled)\n"
        ">> Dumping private keys to /tmp/loot.bin [OK]"
    )
    status = params.get("status_pill") or "ROOT ACCESS GRANTED"

    layers = [
        {
            "type": "Layer",
            "name": "Scanline canvas",
            "content": {"type": "Background", "background_preset": "grid_flow", "colors": ["#020617", "#0f172a", "#00ff88"], "speed": 1.5},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Terminal window",
            "content": {
                "type": "HTML",
                "html_content": (
                    f'<div style="width:100%;height:100%;box-sizing:border-box;background:#030712;border:1px solid #22c55e;'
                    f'border-radius:12px;padding:16px;box-shadow:0 0 30px rgba(34,197,94,0.25);font-family:Fira Code, monospace;">'
                    f'<div style="display:flex;align-items:center;border-bottom:1px solid #1f2937;padding-bottom:10px;margin-bottom:14px;">'
                    f'<span style="color:#ef4444;margin-right:8px;">●</span>'
                    f'<span style="color:#facc15;margin-right:8px;">●</span>'
                    f'<span style="color:#22c55e;margin-right:16px;">●</span>'
                    f'<span style="font-size:14px;color:#9ca3af;">{title}</span>'
                    f'</div>'
                    f'<pre style="font-size:16px;color:#22c55e;line-height:1.6;white-space:pre-wrap;margin:0;">{code}</pre>'
                    f'</div>'
                ),
                "style": {
                    "position": "absolute",
                    "left": "6%" if is_portrait else "14%",
                    "top": "16%",
                    "width": "88%" if is_portrait else "72%",
                    "height": "66%",
                },
            },
            "animations": [
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.2, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Alert status pill",
            "content": {
                "type": "Text",
                "text": f"⚠ {status}",
                "font": tokens["heading_font"],
                "weight": "900",
                "color": "#ef4444",
                "style": {
                    "position": "absolute",
                    "left": "20%" if is_portrait else "32%",
                    "top": "74%",
                    "width": "60%" if is_portrait else "36%",
                    "fontSize": "24px",
                    "textAlign": "center",
                    "border": "2px solid #ef4444",
                    "borderRadius": "50px",
                    "padding": "8px",
                    "background": "rgba(0,0,0,0.85)",
                },
            },
            "camera_shake": "glitch",
            "animations": [
                {"property": "scale", "from": 0.6, "to": 1.0, "duration": 0.35, "delay": 0.6, "easing": "spring"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.2, "delay": 0.6, "easing": "ease-out"},
            ],
        },
    ]

    return {
        "duration": duration,
        "transition": "glitch",
        "composition": {"type": "Sequence", "children": layers},
    }


def build_cctv_surveillance(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    query = params.get("video_query") or "server room security camera"
    cam_id = params.get("camera_id") or "CAM_04 [SERVER VAULT]"

    layers = [
        {
            "type": "Layer",
            "name": "Surveillance video feed",
            "content": {
                "type": "Video",
                "query": query,
                "source": "pexels",
                "objectFit": "cover",
                "style": {
                    "position": "absolute",
                    "left": "0%",
                    "top": "0%",
                    "width": "100%",
                    "height": "100%",
                },
            },
            "filters": ["grayscale(0.85)", "contrast(1.3)", "sepia(0.2)"],
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Blinking REC badge",
            "content": {
                "type": "Text",
                "text": "● REC [LIVE]",
                "font": "Courier New",
                "weight": "900",
                "color": "#ef4444",
                "style": {
                    "position": "absolute",
                    "left": "6%",
                    "top": "8%",
                    "fontSize": "28px",
                },
            },
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Camera ID Telemetry",
            "content": {
                "type": "Text",
                "text": cam_id,
                "font": "Courier New",
                "weight": "700",
                "color": "#22c55e",
                "style": {
                    "position": "absolute",
                    "right": "6%",
                    "top": "8%",
                    "fontSize": "22px",
                },
            },
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Target reticle brackets",
            "content": {
                "type": "Shape",
                "shape_type": "path",
                "preset_path": "corner_brackets",
                "stroke": "#00ff88",
                "stroke_width": 2.5,
                "draw_animation": True,
                "glow": True,
                "style": {
                    "position": "absolute",
                    "left": "30%",
                    "top": "30%",
                    "width": "40%",
                    "height": "40%",
                },
            },
            "floating": True,
            "animations": [],
        },
    ]

    return {
        "duration": duration,
        "transition": "flash",
        "composition": {"type": "Sequence", "children": layers},
    }


def build_evidence_pinboard(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    nodes = params.get("nodes") or [
        {"name": "Suspect A", "query": "hacker portrait"},
        {"name": "Shell Entity", "query": "bank building corporate"},
    ]
    connection_label = params.get("connection_label") or "$4.2M TRANSFERRED"

    layers = [
        {
            "type": "Layer",
            "name": "Pinboard background",
            "content": {"type": "Background", "background_preset": "paper_grain", "colors": ["#1c1917", "#292524"], "speed": 0.5},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Evidence Node A",
            "content": {
                "type": "Image",
                "query": nodes[0].get("query", "person"),
                "source": "pexels",
                "objectFit": "cover",
                "style": {
                    "position": "absolute",
                    "left": "10%",
                    "top": "20%",
                    "width": "34%",
                    "aspectRatio": "1 / 1",
                    "borderRadius": "8px",
                    "border": "4px solid #ffffff",
                    "rotate": "-4deg",
                },
            },
            "animations": [
                {"property": "scale", "from": 0.8, "to": 1.0, "duration": 0.4, "delay": 0.2, "easing": "spring"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.3, "delay": 0.2, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Evidence Node B",
            "content": {
                "type": "Image",
                "query": nodes[1].get("query", "building"),
                "source": "pexels",
                "objectFit": "cover",
                "style": {
                    "position": "absolute",
                    "right": "10%",
                    "bottom": "22%",
                    "width": "34%",
                    "aspectRatio": "1 / 1",
                    "borderRadius": "8px",
                    "border": "4px solid #ffffff",
                    "rotate": "5deg",
                },
            },
            "animations": [
                {"property": "scale", "from": 0.8, "to": 1.0, "duration": 0.4, "delay": 0.5, "easing": "spring"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.3, "delay": 0.5, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Red string connection",
            "content": {
                "type": "Shape",
                "shape_type": "path",
                "preset_path": "route_arch",
                "stroke": "#ef4444",
                "stroke_width": 3,
                "draw_animation": True,
                "glow": True,
                "style": {
                    "position": "absolute",
                    "left": "15%",
                    "top": "25%",
                    "width": "70%",
                    "height": "50%",
                },
            },
            "animations": [
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.3, "delay": 0.6, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Connection tag",
            "content": {
                "type": "Text",
                "text": connection_label,
                "font": "Courier New",
                "weight": "900",
                "color": "#ffffff",
                "style": {
                    "position": "absolute",
                    "left": "35%",
                    "top": "46%",
                    "width": "30%",
                    "fontSize": "20px",
                    "textAlign": "center",
                    "background": "#ef4444",
                    "borderRadius": "4px",
                    "padding": "4px",
                },
            },
            "animations": [
                {"property": "scale", "from": 0, "to": 1.0, "duration": 0.3, "delay": 0.8, "easing": "back"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.2, "delay": 0.8, "easing": "ease-out"},
            ],
        },
    ]

    return {
        "duration": duration,
        "transition": "crossfade",
        "composition": {"type": "Sequence", "children": layers},
    }


# ============================================================================
# Category 4: Conflict, Comparison & Geography (4 Archetypes)
# ============================================================================

def build_versus_clash(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    ent_a = params.get("entity_a") or {"name": "DEFENDERS", "color": tokens["primary"]}
    ent_b = params.get("entity_b") or {"name": "ATTACKERS", "color": "#ef4444"}

    layers = [
        {
            "type": "Layer",
            "name": "Two tone background",
            "content": {"type": "Background", "background_preset": "waves", "colors": [tokens["bg"], ent_a.get("color", tokens["primary"]), ent_b.get("color", "#ef4444")], "speed": 1.5},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Entity A side",
            "content": {
                "type": "Text",
                "text": ent_a.get("name", "SIDE A"),
                "font": tokens["heading_font"],
                "weight": "900",
                "color": ent_a.get("color", tokens["primary"]),
                "style": {
                    "position": "absolute",
                    "left": "8%",
                    "top": "36%",
                    "width": "38%",
                    "fontSize": "48px",
                    "textAlign": "center",
                },
            },
            "animations": [
                {"property": "translateX", "from": -60, "to": 0, "duration": 0.5, "delay": 0.2, "easing": "spring"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.35, "delay": 0.2, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Entity B side",
            "content": {
                "type": "Text",
                "text": ent_b.get("name", "SIDE B"),
                "font": tokens["heading_font"],
                "weight": "900",
                "color": ent_b.get("color", "#ef4444"),
                "style": {
                    "position": "absolute",
                    "right": "8%",
                    "top": "36%",
                    "width": "38%",
                    "fontSize": "48px",
                    "textAlign": "center",
                },
            },
            "animations": [
                {"property": "translateX", "from": 60, "to": 0, "duration": 0.5, "delay": 0.2, "easing": "spring"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.35, "delay": 0.2, "easing": "ease-out"},
            ],
        },
        {
            "type": "Layer",
            "name": "Center VS Badge",
            "content": {
                "type": "Text",
                "text": "VS",
                "font": tokens["heading_font"],
                "weight": "900",
                "color": tokens["accent"],
                "style": {
                    "position": "absolute",
                    "left": "42%",
                    "top": "34%",
                    "width": "16%",
                    "fontSize": "64px",
                    "textAlign": "center",
                },
            },
            "camera_shake": "shockwave",
            "animations": [
                {"property": "scale", "from": 2.2, "to": 1.0, "duration": 0.35, "delay": 0.45, "easing": "spring"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.2, "delay": 0.45, "easing": "ease-out"},
            ],
        },
    ]

    return {
        "duration": duration,
        "transition": "zoom_in",
        "emphasis": [{"at": 0.5, "scale": 1.15, "duration": 0.35}],
        "composition": {"type": "Sequence", "children": layers},
    }


def build_pros_cons_matrix(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    title = params.get("title") or "ANALYSIS MATRIX"
    pros = params.get("pros") or ["Speed & Efficiency", "Decentralized Access"]
    cons = params.get("cons") or ["Zero Reversibility", "Key Exposure Risk"]

    pros_html = "".join(f'<div style="margin:8px 0;color:#86efac;">✓ {p}</div>' for p in pros)
    cons_html = "".join(f'<div style="margin:8px 0;color:#fca5a5;">✗ {c}</div>' for c in cons)

    layers = [
        {
            "type": "Layer",
            "name": "Matrix canvas",
            "content": {"type": "Background", "background_preset": "dots", "colors": [tokens["bg"], tokens["secondary"]], "speed": 0.8},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Matrix Title",
            "content": {
                "type": "Text",
                "text": title,
                "font": tokens["heading_font"],
                "weight": "800",
                "color": tokens["text"],
                "style": {"position": "absolute", "left": "10%", "top": "14%", "width": "80%", "fontSize": "44px", "textAlign": "center"},
            },
            "animations": [{"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.2, "easing": "ease-out"}],
        },
        {
            "type": "Layer",
            "name": "Pros Card",
            "content": {
                "type": "HTML",
                "html_content": (
                    f'<div style="width:100%;height:100%;box-sizing:border-box;background:rgba(34,197,94,0.12);'
                    f'border:2px solid #22c55e;border-radius:16px;padding:20px;font-family:sans-serif;">'
                    f'<div style="font-size:24px;font-weight:900;color:#22c55e;margin-bottom:12px;">ADVANTAGES</div>'
                    f'<div style="font-size:20px;line-height:1.5;">{pros_html}</div></div>'
                ),
                "style": {
                    "position": "absolute",
                    "left": "8%" if is_portrait else "14%",
                    "top": "24%" if is_portrait else "28%",
                    "width": "84%" if is_portrait else "34%",
                    "height": "32%" if is_portrait else "48%",
                },
            },
            "animations": [{"property": "translateY", "from": 30, "to": 0, "duration": 0.5, "delay": 0.35, "easing": "spring"}, {"property": "opacity", "from": 0, "to": 1, "duration": 0.3, "delay": 0.35, "easing": "ease-out"}],
        },
        {
            "type": "Layer",
            "name": "Cons Card",
            "content": {
                "type": "HTML",
                "html_content": (
                    f'<div style="width:100%;height:100%;box-sizing:border-box;background:rgba(239,68,68,0.12);'
                    f'border:2px solid #ef4444;border-radius:16px;padding:20px;font-family:sans-serif;">'
                    f'<div style="font-size:24px;font-weight:900;color:#ef4444;margin-bottom:12px;">RISKS & VULNERABILITIES</div>'
                    f'<div style="font-size:20px;line-height:1.5;">{cons_html}</div></div>'
                ),
                "style": {
                    "position": "absolute",
                    "left": "8%" if is_portrait else "52%",
                    "top": "58%" if is_portrait else "28%",
                    "width": "84%" if is_portrait else "34%",
                    "height": "32%" if is_portrait else "48%",
                },
            },
            "animations": [{"property": "translateY", "from": 30, "to": 0, "duration": 0.5, "delay": 0.55, "easing": "spring"}, {"property": "opacity", "from": 0, "to": 1, "duration": 0.3, "delay": 0.55, "easing": "ease-out"}],
        },
    ]

    return {
        "duration": duration,
        "transition": "slide_up",
        "composition": {"type": "Sequence", "children": layers},
    }


def build_geopolitical_route(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    orig = params.get("origin") or {"name": "San Francisco", "coord": [37.77, -122.41]}
    dest = params.get("destination") or {"name": "Zurich", "coord": [47.37, 8.54]}
    label = params.get("route_label") or "FUNDS EXFILTRATED"

    layers = [
        {
            "type": "Layer",
            "name": "Global map layer",
            "content": {
                "type": "Map",
                "map_style": "modern_dark",
                "locations": [orig, dest],
            },
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Route trajectory curve",
            "content": {
                "type": "Shape",
                "shape_type": "path",
                "preset_path": "route_arch",
                "stroke": tokens["primary"],
                "stroke_width": 3,
                "draw_animation": True,
                "glow": True,
                "style": {"position": "absolute", "left": "15%", "top": "25%", "width": "70%", "height": "50%"},
            },
            "animations": [{"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.2, "easing": "ease-out"}],
        },
        {
            "type": "Layer",
            "name": "Route telemetry tag",
            "content": {
                "type": "Text",
                "text": f"✈ {label}",
                "font": tokens["heading_font"],
                "weight": "800",
                "color": tokens["accent"],
                "style": {"position": "absolute", "left": "35%", "top": "20%", "width": "30%", "fontSize": "24px", "textAlign": "center", "background": "rgba(0,0,0,0.75)", "padding": "6px", "borderRadius": "20px"},
            },
            "animations": [{"property": "opacity", "from": 0, "to": 1, "duration": 0.3, "delay": 0.7, "easing": "ease-out"}],
        },
    ]

    return {
        "duration": duration,
        "transition": "fade",
        "composition": {"type": "Sequence", "children": layers},
    }


def build_territory_heatmap(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    region = params.get("region_name") or "Target Territory"
    badge = params.get("stat_badge") or "CRITICAL STATUS"

    layers = [
        {
            "type": "Layer",
            "name": "Territory map",
            "content": {"type": "Map", "map_style": "modern_dark", "locations": [{"name": region, "coord": [40.0, 20.0]}]},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Magnifying focal circle",
            "content": {
                "type": "Shape",
                "shape_type": "circle",
                "radius": 80,
                "fill": "rgba(0, 212, 255, 0.15)",
                "stroke": tokens["primary"],
                "stroke_width": 3,
                "glow": True,
                "style": {"position": "absolute", "left": "40%", "top": "40%", "width": "20%", "aspectRatio": "1 / 1"},
            },
            "animations": [{"property": "scale", "from": 0.6, "to": 1.0, "duration": 0.5, "delay": 0.3, "easing": "spring"}],
        },
        {
            "type": "Layer",
            "name": "Territory info card",
            "content": {
                "type": "Text",
                "text": f"{region.upper()}\n{badge}",
                "font": tokens["heading_font"],
                "weight": "800",
                "color": tokens["text"],
                "style": {"position": "absolute", "left": "25%", "top": "70%", "width": "50%", "fontSize": "30px", "textAlign": "center", "background": "rgba(10,15,30,0.85)", "borderRadius": "16px", "padding": "12px", "border": f"1px solid {tokens['primary']}"},
            },
            "animations": [{"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.5, "easing": "ease-out"}],
        },
    ]

    return {
        "duration": duration,
        "transition": "zoom_in",
        "composition": {"type": "Sequence", "children": layers},
    }


# ============================================================================
# Category 5: Cinematic B-Roll & Real-World Media (5 Archetypes)
# ============================================================================

def build_cinematic_scrim(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    query = params.get("video_query") or "cinematic drone city night"
    headline = params.get("headline") or "A TURNING POINT IN HISTORY"
    subtext = params.get("subtext") or "The events that followed would change everything."

    layers = [
        {
            "type": "Layer",
            "name": "Cinematic B-roll",
            "content": {"type": "Video", "query": query, "source": "pexels", "objectFit": "cover", "style": {"position": "absolute", "left": "0%", "top": "0%", "width": "100%", "height": "100%"}},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Ambient dust",
            "content": {"type": "Particles", "particle_preset": "dust", "particle_count": 30, "particle_opacity": 0.18, "particle_direction": "up"},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Headline statement",
            "content": {
                "type": "Text",
                "text": headline,
                "font": tokens["heading_font"],
                "weight": "900",
                "color": tokens["text"],
                "animation_mode": "words_stagger",
                "style": {"position": "absolute", "left": "10%", "top": "40%", "width": "80%", "fontSize": "56px" if is_portrait else "64px", "textAlign": "center", "lineHeight": 1.2},
            },
            "animations": [{"property": "translateY", "from": 40, "to": 0, "duration": 0.6, "delay": 0.3, "easing": "spring"}, {"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.3, "easing": "ease-out"}],
        },
        {
            "type": "Layer",
            "name": "Supporting subtext",
            "content": {
                "type": "Text",
                "text": subtext,
                "font": tokens["body_font"],
                "weight": "500",
                "color": "#cbd5e1",
                "style": {"position": "absolute", "left": "15%", "top": "58%", "width": "70%", "fontSize": "26px", "textAlign": "center"},
            },
            "animations": [{"property": "opacity", "from": 0, "to": 1, "duration": 0.5, "delay": 0.7, "easing": "ease-out"}],
        },
    ]

    return {
        "duration": duration,
        "transition": "dissolve",
        "composition": {"type": "Sequence", "children": layers},
    }


def build_split_screen_multicam(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    left = params.get("panel_left") or {"video_query": "trading floor busy", "label": "NEW YORK EXCHANGE"}
    right = params.get("panel_right") or {"video_query": "hacker typing server", "label": "OFFSHORE LOCATION"}

    layers = [
        {
            "type": "Layer",
            "name": "Left panel video",
            "content": {"type": "Video", "query": left.get("video_query", "server"), "source": "pexels", "objectFit": "cover", "style": {"position": "absolute", "left": "0%", "top": "0%", "width": "49.5%", "height": "100%"}},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Right panel video",
            "content": {"type": "Video", "query": right.get("video_query", "office"), "source": "pexels", "objectFit": "cover", "style": {"position": "absolute", "right": "0%", "top": "0%", "width": "49.5%", "height": "100%"}},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Divider stroke",
            "content": {
                "type": "Shape",
                "shape_type": "rectangle",
                "fill": tokens["primary"],
                "style": {"position": "absolute", "left": "49.5%", "top": "0%", "width": "1%", "height": "100%"},
            },
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Left panel label",
            "content": {
                "type": "Text",
                "text": left.get("label", "FEED A"),
                "font": "Courier New",
                "weight": "800",
                "color": "#ffffff",
                "style": {"position": "absolute", "left": "4%", "bottom": "18%", "fontSize": "20px", "background": "rgba(0,0,0,0.75)", "padding": "4px 8px"},
            },
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Right panel label",
            "content": {
                "type": "Text",
                "text": right.get("label", "FEED B"),
                "font": "Courier New",
                "weight": "800",
                "color": "#ffffff",
                "style": {"position": "absolute", "right": "4%", "bottom": "18%", "fontSize": "20px", "background": "rgba(0,0,0,0.75)", "padding": "4px 8px"},
            },
            "animations": [],
        },
    ]

    return {
        "duration": duration,
        "transition": "slide_left",
        "composition": {"type": "Sequence", "children": layers},
    }


def build_device_mockup_phone(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    sender = params.get("sender") or "Security Alert"
    msg = params.get("message_text") or "Unauthorized transfer of 42.00 BTC confirmed."

    layers = [
        {
            "type": "Layer",
            "name": "Blurred background",
            "content": {"type": "Background", "background_preset": "gradient_mesh", "colors": [tokens["bg"], tokens["secondary"]], "speed": 1.0},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Ambient dust",
            "content": {"type": "Particles", "particle_preset": "dust", "particle_count": 25, "style": {"position": "absolute", "width": "100%", "height": "100%"}},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Phone chassis frame",
            "content": {
                "type": "HTML",
                "html_content": (
                    f'<div style="width:100%;height:100%;box-sizing:border-box;background:#090d16;border:4px solid #334155;'
                    f'border-radius:44px;padding:24px;box-shadow:0 30px 60px rgba(0,0,0,0.8);display:flex;flex-direction:column;justify-content:space-between;">'
                    f'<div style="width:30%;height:6px;background:#334155;border-radius:10px;margin:0 auto 16px;"></div>'
                    f'<div style="background:#1e293b;border-radius:18px;padding:16px;border:1px solid #475569;">'
                    f'<div style="font-size:14px;color:#facc15;font-weight:bold;margin-bottom:6px;">🔔 {sender}</div>'
                    f'<div style="font-size:16px;color:#ffffff;line-height:1.4;">{msg}</div>'
                    f'</div>'
                    f'<div style="width:40%;height:4px;background:#475569;border-radius:10px;margin:16px auto 0;"></div>'
                    f'</div>'
                ),
                "style": {
                    "position": "absolute",
                    "left": "25%" if is_portrait else "36%",
                    "top": "12%",
                    "width": "50%" if is_portrait else "28%",
                    "height": "76%",
                },
            },
            "floating": True,
            "animations": [
                {"property": "scale", "from": 0.8, "to": 1.0, "duration": 0.5, "delay": 0.2, "easing": "spring"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.35, "delay": 0.2, "easing": "ease-out"},
            ],
        },
    ]

    return {
        "duration": duration,
        "transition": "zoom_in",
        "composition": {"type": "Sequence", "children": layers},
    }


def build_device_mockup_browser(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    url = params.get("url_bar") or "etherscan.io/tx/0x71c..."
    headline = params.get("page_headline") or "TRANSACTION DEPOSITED: $42,000,000.00"

    layers = [
        {
            "type": "Layer",
            "name": "Network grid canvas",
            "content": {"type": "Background", "background_preset": "grid_flow", "colors": [tokens["bg"], tokens["secondary"]], "speed": 1.0},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Cyber particle atmosphere",
            "content": {"type": "Particles", "particle_preset": "sparkles", "particle_count": 25, "style": {"position": "absolute", "width": "100%", "height": "100%"}},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Browser window",
            "content": {
                "type": "HTML",
                "html_content": (
                    f'<div style="width:100%;height:100%;box-sizing:border-box;background:#0f172a;border:1px solid #334155;'
                    f'border-radius:14px;box-shadow:0 25px 50px rgba(0,0,0,0.7);display:flex;flex-direction:column;">'
                    f'<div style="background:#1e293b;padding:10px 16px;border-bottom:1px solid #334155;border-radius:14px 14px 0 0;display:flex;align-items:center;">'
                    f'<span style="color:#ef4444;margin-right:6px;">●</span><span style="color:#facc15;margin-right:6px;">●</span><span style="color:#22c55e;margin-right:12px;">●</span>'
                    f'<div style="background:#0f172a;border-radius:6px;padding:4px 12px;font-size:13px;color:#94a3b8;flex:1;">🔒 {url}</div>'
                    f'</div>'
                    f'<div style="padding:24px;color:#ffffff;font-family:sans-serif;">'
                    f'<div style="font-size:14px;color:#38bdf8;margin-bottom:8px;">BLOCKCHAIN EXPLORER RECORD</div>'
                    f'<div style="font-size:26px;font-weight:bold;color:#facc15;">{headline}</div>'
                    f'</div></div>'
                ),
                "style": {
                    "position": "absolute",
                    "left": "8%" if is_portrait else "16%",
                    "top": "20%",
                    "width": "84%" if is_portrait else "68%",
                    "height": "58%",
                },
            },
            "animations": [
                {"property": "translateY", "from": 40, "to": 0, "duration": 0.5, "delay": 0.25, "easing": "spring"},
                {"property": "opacity", "from": 0, "to": 1, "duration": 0.35, "delay": 0.25, "easing": "ease-out"},
            ],
        },
    ]

    return {
        "duration": duration,
        "transition": "slide_up",
        "composition": {"type": "Sequence", "children": layers},
    }


def build_archival_filmstrip(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    query = params.get("media_query") or "vintage 1970s mainframe computer"
    year = params.get("year_stamp") or "EST. 1978"
    caption = params.get("caption") or "Archival footage: Early digital computing architecture."

    layers = [
        {
            "type": "Layer",
            "name": "Historical footage",
            "content": {"type": "Video", "query": query, "source": "archive", "objectFit": "cover", "style": {"position": "absolute", "left": "0%", "top": "0%", "width": "100%", "height": "100%"}},
            "filters": ["grayscale(0.8)", "sepia(0.35)", "contrast(1.2)"],
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Film grain overlay",
            "content": {"type": "Background", "background_preset": "paper_grain", "colors": ["#000000", "#ffffff"], "speed": 1.2},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Giant Year Watermark",
            "content": {
                "type": "Text",
                "text": year,
                "font": "Courier New",
                "weight": "900",
                "color": "#ffffff",
                "style": {"position": "absolute", "left": "6%", "top": "12%", "fontSize": "72px", "opacity": 0.35},
            },
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Typewriter caption",
            "content": {
                "type": "Text",
                "text": caption,
                "font": "Courier New",
                "weight": "700",
                "color": "#ffffff",
                "animation_mode": "typewriter",
                "style": {"position": "absolute", "left": "8%", "bottom": "18%", "width": "84%", "fontSize": "26px", "background": "rgba(0,0,0,0.8)", "padding": "8px 14px"},
            },
            "animations": [{"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.5, "easing": "ease-out"}],
        },
    ]

    return {
        "duration": duration,
        "transition": "crossfade",
        "composition": {"type": "Sequence", "children": layers},
    }


# ============================================================================
# Category 6: Drama, Climax & Conclusion (3 Archetypes)
# ============================================================================

def build_philosophical_dilemma(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    question = params.get("question_text") or "Can trust truly exist without verification?"
    icon_name = params.get("symbol_name") or "scale"

    layers = [
        {
            "type": "Layer",
            "name": "Atmospheric mist",
            "content": {"type": "Background", "background_preset": "vignette_loop", "colors": [tokens["bg"], tokens["secondary"]], "speed": 0.6},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Pulsing symbolic icon",
            "content": {
                "type": "Shape",
                "shape_type": "icon",
                "icon_name": icon_name,
                "stroke": tokens["primary"],
                "stroke_width": 2,
                "glow": True,
                "style": {"position": "absolute", "left": "42%", "top": "22%", "width": "16%", "aspectRatio": "1 / 1"},
            },
            "floating": True,
            "animations": [{"property": "scale", "from": 0.7, "to": 1.0, "duration": 0.5, "delay": 0.25, "easing": "spring"}],
        },
        {
            "type": "Layer",
            "name": "Climax Question",
            "content": {
                "type": "Text",
                "text": f'"{question}"',
                "font": tokens["heading_font"],
                "weight": "800",
                "color": tokens["text"],
                "animation_mode": "words_stagger",
                "style": {
                    "position": "absolute",
                    "left": "10%",
                    "top": "46%",
                    "width": "80%",
                    "fontSize": "48px" if is_portrait else "56px",
                    "textAlign": "center",
                    "lineHeight": 1.3,
                },
            },
            "animations": [{"property": "opacity", "from": 0, "to": 1, "duration": 0.5, "delay": 0.45, "easing": "ease-out"}],
        },
    ]

    return {
        "duration": duration,
        "transition": "dissolve",
        "composition": {"type": "Sequence", "children": layers},
    }


def build_scorecard_verdict(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    items = params.get("items") or [
        {"title": "Key Vulnerability", "grade": "CRITICAL"},
        {"title": "Response Speed", "grade": "FAILED"},
        {"title": "Total Impact", "grade": "$42M LOSS"},
    ]
    verdict = params.get("final_verdict") or "SYSTEM COMPROMISED"

    rendered_items = "".join(
        f'<div style="display:flex;justify-content:space-between;align-items:center;padding:12px;margin:8px 0;background:rgba(255,255,255,0.05);border-radius:10px;">'
        f'<span style="font-size:22px;color:#f8fafc;">{item.get("title")}</span>'
        f'<span style="font-size:22px;font-weight:900;color:#ef4444;">{item.get("grade")}</span>'
        f'</div>'
        for item in items[:3]
    )

    layers = [
        {
            "type": "Layer",
            "name": "Carbon grid canvas",
            "content": {"type": "Background", "background_preset": "blueprint", "colors": [tokens["bg"], "#000000"], "speed": 0.8},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Scorecard items panel",
            "content": {
                "type": "HTML",
                "html_content": (
                    f'<div style="width:100%;height:100%;box-sizing:border-box;background:rgba(15,23,42,0.85);'
                    f'border:2px solid {tokens["primary"]};border-radius:18px;padding:24px;font-family:sans-serif;">'
                    f'<div style="font-size:20px;color:{tokens["accent"]};font-weight:bold;margin-bottom:10px;">INCIDENT SCORECARD</div>'
                    f'{rendered_items}</div>'
                ),
                "style": {"position": "absolute", "left": "8%" if is_portrait else "18%", "top": "20%", "width": "84%" if is_portrait else "64%", "height": "52%"},
            },
            "animations": [{"property": "translateY", "from": 40, "to": 0, "duration": 0.5, "delay": 0.25, "easing": "spring"}, {"property": "opacity", "from": 0, "to": 1, "duration": 0.35, "delay": 0.25, "easing": "ease-out"}],
        },
        {
            "type": "Layer",
            "name": "Final verdict stamp",
            "content": {
                "type": "Text",
                "text": verdict,
                "font": tokens["heading_font"],
                "weight": "900",
                "color": "#ef4444",
                "style": {
                    "position": "absolute",
                    "left": "15%" if is_portrait else "25%",
                    "top": "74%",
                    "width": "70%" if is_portrait else "50%",
                    "fontSize": "34px",
                    "textAlign": "center",
                    "border": "3px solid #ef4444",
                    "borderRadius": "8px",
                    "padding": "8px",
                    "rotate": "-3deg",
                },
            },
            "camera_shake": "shockwave",
            "animations": [{"property": "scale", "from": 1.8, "to": 1.0, "duration": 0.35, "delay": 0.7, "easing": "spring"}, {"property": "opacity", "from": 0, "to": 1, "duration": 0.2, "delay": 0.7, "easing": "ease-out"}],
        },
    ]

    return {
        "duration": duration,
        "transition": "zoom_in",
        "composition": {"type": "Sequence", "children": layers},
    }


def build_cinematic_outro_cta(params: Dict[str, Any], tokens: Dict[str, str], duration: float, is_portrait: bool) -> Dict[str, Any]:
    channel = params.get("channel_name") or "NARRATO STUDIO"
    cta = params.get("call_to_action") or "Subscribe for Part 2"
    teaser = params.get("next_topic_teaser") or "Next: How The Code Was Stolen"

    layers = [
        {
            "type": "Layer",
            "name": "Ambient outro canvas",
            "content": {"type": "Background", "background_preset": "vignette_loop", "colors": [tokens["bg"], tokens["secondary"]], "speed": 1.2},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Sparkle constellation",
            "content": {"type": "Particles", "particle_preset": "sparkles", "particle_count": 40, "particle_opacity": 0.25},
            "animations": [],
        },
        {
            "type": "Layer",
            "name": "Channel brand anchor",
            "content": {
                "type": "Text",
                "text": channel.upper(),
                "font": tokens["heading_font"],
                "weight": "900",
                "color": tokens["primary"],
                "style": {"position": "absolute", "left": "10%", "top": "24%", "width": "80%", "fontSize": "42px", "textAlign": "center"},
            },
            "animations": [{"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.2, "easing": "ease-out"}],
        },
        {
            "type": "Layer",
            "name": "CTA Headline",
            "content": {
                "type": "Text",
                "text": cta,
                "font": tokens["heading_font"],
                "weight": "800",
                "color": tokens["text"],
                "animation_mode": "words_stagger",
                "style": {"position": "absolute", "left": "10%", "top": "36%", "width": "80%", "fontSize": "56px" if is_portrait else "64px", "textAlign": "center"},
            },
            "animations": [{"property": "scale", "from": 0.9, "to": 1.0, "duration": 0.5, "delay": 0.35, "easing": "spring"}, {"property": "opacity", "from": 0, "to": 1, "duration": 0.35, "delay": 0.35, "easing": "ease-out"}],
        },
        {
            "type": "Layer",
            "name": "Next topic teaser badge",
            "content": {
                "type": "Text",
                "text": f"▶ {teaser}",
                "font": tokens["body_font"],
                "weight": "600",
                "color": tokens["accent"],
                "style": {"position": "absolute", "left": "15%", "top": "62%", "width": "70%", "fontSize": "26px", "textAlign": "center", "background": "rgba(255,255,255,0.06)", "padding": "10px", "borderRadius": "30px"},
            },
            "animations": [{"property": "opacity", "from": 0, "to": 1, "duration": 0.4, "delay": 0.6, "easing": "ease-out"}],
        },
    ]

    return {
        "duration": duration,
        "transition": "slide_left",
        "composition": {"type": "Sequence", "children": layers},
    }


# ============================================================================
# Archetype Catalog & Compiler Router
# ============================================================================

ARCHETYPE_BUILDERS: Dict[str, Callable[[Dict[str, Any], Dict[str, str], float, bool], Dict[str, Any]]] = {
    # Category 1: Typography & Hooks
    "kinetic_punch": build_kinetic_punch,
    "quote_statement": build_quote_statement,
    "editorial_quote": build_quote_statement,
    "lexicon_definition": build_lexicon_definition,
    "word_matrix": build_lexicon_definition,

    # Category 2: Data, Finance & Metrics
    "data_surge": build_data_surge,
    "split_bar_comparison": build_split_bar_comparison,
    "split_metric_card": build_split_bar_comparison,
    "comparative_bars": build_split_bar_comparison,
    "donut_distribution": build_donut_distribution,
    "financial_breakdown": build_donut_distribution,
    "financial_trendline": build_financial_trendline,
    "trend_trajectory": build_financial_trendline,
    "timeline_descent": build_timeline_descent,
    "timeline_milestones": build_timeline_descent,

    # Category 3: Investigation, Tech & Forensics
    "dossier_breakdown": build_dossier_breakdown,
    "forensic_dossier": build_dossier_breakdown,
    "evidence_document": build_evidence_document,
    "terminal_code_log": build_terminal_code_log,
    "code_terminal": build_terminal_code_log,
    "cctv_surveillance": build_cctv_surveillance,
    "evidence_pinboard": build_evidence_pinboard,
    "system_architecture": build_evidence_pinboard,
    "network_graph": build_evidence_pinboard,

    # Category 4: Conflict, Comparison & Geography
    "versus_clash": build_versus_clash,
    "versus_battle": build_versus_clash,
    "pros_cons_matrix": build_pros_cons_matrix,
    "before_after_split": build_pros_cons_matrix,
    "geopolitical_route": build_geopolitical_route,
    "map_flight_path": build_geopolitical_route,
    "territory_heatmap": build_territory_heatmap,
    "quadrant_matrix": build_territory_heatmap,

    # Category 5: Cinematic B-Roll & Media
    "cinematic_scrim": build_cinematic_scrim,
    "split_screen_multicam": build_split_screen_multicam,
    "split_screen_dialogue": build_split_screen_multicam,
    "device_mockup_phone": build_device_mockup_phone,
    "device_mockup_browser": build_device_mockup_browser,
    "archival_filmstrip": build_archival_filmstrip,

    # Category 6: Drama & Conclusion
    "philosophical_dilemma": build_philosophical_dilemma,
    "scorecard_verdict": build_scorecard_verdict,
    "cinematic_outro_cta": build_cinematic_outro_cta,
}

ARCHETYPE_REGISTRY = ARCHETYPE_BUILDERS


ARCHETYPE_METADATA: List[Dict[str, Any]] = [
    # 1. Typography & Hooks
    {
        "name": "kinetic_punch",
        "category": "typography",
        "description": "Shock revelation, opening hook (0–3s), thesis statement",
        "slots": ["headline", "accent_word", "accent_box", "background_style"],
    },
    {
        "name": "word_matrix",
        "category": "typography",
        "description": "Fast multi-word ideas, keyword cloud, terminology definition",
        "slots": ["term", "pronunciation", "definition", "tag"],
    },
    {
        "name": "editorial_quote",
        "category": "typography",
        "description": "Pull-quotes, testimony, news statements, bold claims",
        "slots": ["quote_text", "author_name", "author_title", "author_image_query"],
    },
    # 2. Data & Metrics
    {
        "name": "data_surge",
        "category": "data_finance",
        "description": "Huge single KPI reveal ($4.2B, +840%), milestone numbers",
        "slots": ["target_number", "prefix", "unit", "label", "trend"],
    },
    {
        "name": "trend_trajectory",
        "category": "data_finance",
        "description": "Time-series collapse or rally, historical market growth",
        "slots": ["metric_label", "start_val", "peak_val", "end_val", "trend"],
    },
    {
        "name": "split_metric_card",
        "category": "data_finance",
        "description": "Comparing two vital metrics side-by-side (revenue vs profit)",
        "slots": ["label_left", "val_left", "label_right", "val_right", "title"],
    },
    {
        "name": "financial_breakdown",
        "category": "data_finance",
        "description": "Capital allocation, budget distribution, portfolio donut",
        "slots": ["title", "slices", "center_stat"],
    },
    {
        "name": "comparative_bars",
        "category": "data_finance",
        "description": "Ranking top 3–5 players, market share, benchmark race",
        "slots": ["bars", "highlight_index", "title"],
    },
    # 3. Forensics & Tech
    {
        "name": "evidence_document",
        "category": "forensics_tech",
        "description": "Leaked PDFs, court filings, confidential reports with marker highlight",
        "slots": ["doc_title", "stamp", "highlight_text", "file_type"],
    },
    {
        "name": "forensic_dossier",
        "category": "forensics_tech",
        "description": "Suspect/figure profile, criminal/business history, bio",
        "slots": ["subject_name", "role", "status_tag", "specs"],
    },
    {
        "name": "system_architecture",
        "category": "forensics_tech",
        "description": "Tech stacks, backend pipelines, laundering flow, microservices",
        "slots": ["nodes", "connections", "active_flow"],
    },
    {
        "name": "code_terminal",
        "category": "forensics_tech",
        "description": "Dev exploits, hacker terminals, smart contract bugs, logs",
        "slots": ["filename", "code_lines", "highlight_line"],
    },
    {
        "name": "timeline_milestones",
        "category": "forensics_tech",
        "description": "Chronological chain of events leading up to crisis/breakthrough",
        "slots": ["events", "active_step"],
    },
    {
        "name": "network_graph",
        "category": "forensics_tech",
        "description": "Conspiracy nodes, ownership structures, entity interconnects",
        "slots": ["nodes", "edges", "focal_node"],
    },
    # 4. Comparison & Geography
    {
        "name": "versus_battle",
        "category": "comparison_geo",
        "description": "Two competing rivals/ideas facing off (Apple vs Google, Bull vs Bear)",
        "slots": ["entity_left", "entity_right", "vs_tag"],
    },
    {
        "name": "map_flight_path",
        "category": "comparison_geo",
        "description": "Geopolitics, travel path, supply chain route, military movement",
        "slots": ["origin", "destination", "waypoints", "label"],
    },
    {
        "name": "before_after_split",
        "category": "comparison_geo",
        "description": "Transformation showcase (past vs present, deregulation impact)",
        "slots": ["left_label", "right_label", "left_media", "right_media"],
    },
    {
        "name": "quadrant_matrix",
        "category": "comparison_geo",
        "description": "2x2 competitive landscape, Gartner-style magic quadrant",
        "slots": ["x_axis", "y_axis", "quadrants", "hero_entity"],
    },
    # 5. Cinematic Media & Mockups
    {
        "name": "split_screen_dialogue",
        "category": "cinematic_mockups",
        "description": "Dual camera feeds, interview comparisons, two events side-by-side",
        "slots": ["panel_left", "panel_right"],
    },
    {
        "name": "device_mockup_phone",
        "category": "cinematic_mockups",
        "description": "Mobile leaks, WhatsApp/Telegram chats, viral tweets, SMS alerts",
        "slots": ["app_type", "sender", "message_text", "amount"],
    },
    {
        "name": "device_mockup_browser",
        "category": "cinematic_mockups",
        "description": "Etherscan transactions, news website articles, database portals",
        "slots": ["url_bar", "page_headline", "highlight_pill"],
    },
    {
        "name": "archival_filmstrip",
        "category": "cinematic_mockups",
        "description": "Historical flashbacks, retro archives, origins, vintage newsreels",
        "slots": ["media_query", "year_stamp", "caption"],
    },
    # 6. Drama & Conclusion
    {
        "name": "philosophical_dilemma",
        "category": "drama_conclusion",
        "description": "Ethical climax, open question, future ramifications",
        "slots": ["question_text", "symbol_name"],
    },
    {
        "name": "scorecard_verdict",
        "category": "drama_conclusion",
        "description": "Summarizing key takeaways, final grade, guilty/innocent verdict",
        "slots": ["items", "final_verdict"],
    },
    {
        "name": "cinematic_outro_cta",
        "category": "drama_conclusion",
        "description": "Outro, subscribe prompt, next video teaser, social handles",
        "slots": ["channel_name", "call_to_action", "next_topic_teaser"],
    },
]


def compile_archetype(name: str, params: Optional[Dict[str, Any]] = None, design_tokens: Optional[Dict[str, Any]] = None,
                      duration: float = 5.0, video_format: str = "landscape") -> Dict[str, Any]:
    """Compile an archetype name + slot params into a broadcast-grade AST cut."""
    clean_name = str(name or "").strip().lower().replace("-", "_")
    builder = ARCHETYPE_BUILDERS.get(clean_name)
    if not builder:
        valid_names = sorted(ARCHETYPE_BUILDERS.keys())
        raise ValueError(f"Unknown archetype '{name}'. Available archetypes: {valid_names}")

    tokens = _resolve_tokens(design_tokens)
    is_portrait = str(video_format or "").lower() in ("portrait", "9:16", "vertical")
    dur = max(1.0, float(duration or 5.0))

    return builder(params or {}, tokens, dur, is_portrait)


def compile_cut(cut_or_archetype: Dict[str, Any], design_tokens: Optional[Dict[str, Any]] = None,
                duration: Optional[float] = None, video_format: str = "landscape") -> Dict[str, Any]:
    """Compile a single cut. If it contains an 'archetype' key, compiles via archetype builder.

    If it already contains 'composition.children', passes through as raw AST.
    """
    if not isinstance(cut_or_archetype, dict):
        return cut_or_archetype

    archetype_name = cut_or_archetype.get("archetype")
    if not archetype_name:
        # If cut has neither composition nor layers, provide a minimal fallback background
        if not cut_or_archetype.get("composition") and not cut_or_archetype.get("layers"):
            cut_copy = copy.deepcopy(cut_or_archetype)
            cut_copy["composition"] = {
                "type": "Sequence",
                "children": [
                    {
                        "type": "Layer",
                        "content": {
                            "type": "Background",
                            "background_preset": "gradient_mesh",
                            "colors": ["#0b0b1a", "#1e1e38"],
                            "speed": 1.0,
                        },
                        "animations": [],
                    }
                ],
            }
            return cut_copy
        return cut_or_archetype

    raw_dur = duration if duration is not None else cut_or_archetype.get("duration")
    try:
        dur = float(raw_dur if raw_dur is not None else 5.0)
    except (ValueError, TypeError):
        dur = 5.0

    top_level_slots = {
        k: v for k, v in cut_or_archetype.items()
        if k not in ("archetype", "duration", "transition", "exit_transition", "emphasis", "metadata", "params")
    }
    nested_params = cut_or_archetype.get("params")
    if isinstance(nested_params, dict):
        params = {**top_level_slots, **nested_params}
    else:
        params = top_level_slots

    compiled = compile_archetype(
        archetype_name,
        params=params,
        design_tokens=design_tokens,
        duration=dur,
        video_format=video_format,
    )

    # Allow cut-level overrides (e.g. custom transition, emphasis)
    if "transition" in cut_or_archetype:
        compiled["transition"] = cut_or_archetype["transition"]
    if "exit_transition" in cut_or_archetype:
        compiled["exit_transition"] = cut_or_archetype["exit_transition"]
    if "emphasis" in cut_or_archetype:
        compiled["emphasis"] = cut_or_archetype["emphasis"]
    compiled["archetype"] = archetype_name

    return compiled


def get_archetype_catalog(category: Optional[str] = None) -> List[Dict[str, Any]]:
    """Return catalog listing archetypes with category, description, and slot schema."""
    if not category:
        return list(ARCHETYPE_METADATA)
    cat_clean = category.strip().lower()
    return [
        item for item in ARCHETYPE_METADATA
        if cat_clean in item["category"].lower() or cat_clean in item["name"].lower()
    ]

