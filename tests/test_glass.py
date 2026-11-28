"""The glass themes: old themes migrate, the taskbar shortcut helper, the title bar colours, corners from the theme."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def test_old_themes_move_to_glass(monkeypatch, tmp_path):
    """A setup from before the glass themes (classic pastels, patterned header) lands on glass Default,
    keeping light or dark mode, instead of on a theme that no longer exists."""
    from studio import paths, settings
    monkeypatch.setattr(paths, "data_dir", lambda: tmp_path)
    (tmp_path / "settings.json").write_text('{"theme": {"name": "Cobalt Night", "base": "dark", "accent": "cobalt", "header": {"type": "pattern", "pattern": "dots"}}}')
    t = settings.load()["theme"]
    assert (t["style"], t["family"], t["base"], t["header"]["type"]) == ("glass", "default", "dark", "none")
    (tmp_path / "settings.json").write_text('{"theme": {"name": "Cool Glass", "style": "glass", "family": "cool", "base": "light"}}')
    assert settings.load()["theme"]["family"] == "cool"
    assert [x["name"] for x in settings.BUILTIN_THEMES] == ["Default", "Cool Glass", "Warm Glass", "Lilac", "Heart Glass"]
    assert settings.DEFAULT_THEME["glass"] == "efficient"


def test_saved_user_themes_keep_their_name(monkeypatch, tmp_path):
    from studio import paths, settings
    monkeypatch.setattr(paths, "data_dir", lambda: tmp_path)
    monkeypatch.setattr(paths, "themes_dir", lambda: tmp_path)
    (tmp_path / "Mine.json").write_text('{"name": "Mine", "base": "dark", "accent": "rose"}')
    mine = [t for t in settings.list_themes() if t["user"]]
    assert [(t["name"], t["style"], t["base"]) for t in mine] == [("Mine", "glass", "dark")]


def test_shortcut_helper_is_quiet_off_windows():
    from studio import winshortcut
    if os.name != "nt":
        assert winshortcut.make(start_menu=True, desktop=True) == []
    assert winshortcut.APP_ID == "LoreStudio.App"
    assert 'SetCurrentProcessExplicitAppUserModelID("LoreStudio.App")' in (ROOT / "main.py").read_text()


def test_titlebar_only_takes_plain_hex_colours():
    from studio.api import Api
    a = Api.__new__(Api)
    seen = []
    a._titlebar = lambda bg, text, dark: seen.append((bg, text, dark)) or True
    assert a.set_titlebar("#252D3F", "#EEF2FF", True) is True
    assert a.set_titlebar("red; drop", "#EEF2FF") is False and len(seen) == 1


def test_bundled_fonts_are_there():
    fonts = ROOT / "web" / "fonts"
    assert (fonts / "Geist-Variable.woff2").stat().st_size > 10000
    assert (fonts / "Geist-LICENSE.txt").exists()


def test_corners_come_from_the_theme():
    """Every corner size is a theme value, so a theme can reshape the whole app (#73). Hairline rounding (1 to 3px)
    and circles stay as they are, and so do the previews that copy another look: Discord posts and the theme cards."""
    import re
    copies = re.compile(r"^\s*\.(dc-|dp-|discord-preview|theme-card \.tp \.mini)")
    left = []
    for name in ("app.css", "glass.css"):
        for n, line in enumerate((ROOT / "web" / "css" / name).read_text(encoding="utf-8").splitlines(), 1):
            if copies.match(line):
                continue
            for value in re.findall(r"border-radius:\s*([^;}]+)", line):
                for px in re.findall(r"(?<![\w-])(\d+(?:\.\d+)?)px", re.sub(r"var\([^)]*\)", "", value)):
                    if float(px) > 3:
                        left.append(f"{name}:{n}: {value.strip()}")
            for name_, px in re.findall(r"var\((--r-[\w-]+|--pill),\s*(\d+)px\)", line):
                if (name_, px) != ("--r-xs", "6"):   # only --r-xs is new, so only it carries a fallback
                    left.append(f"{name}:{n}: var({name_}, {px}px)")
    assert not left, "fixed corner sizes:\n" + "\n".join(left)


def test_circles_stay_round_whatever_the_corner_shape():
    """A theme's --corner-shape bevels every corner (#85), which would turn circles into diamonds,
    so every 50% corner pins its shape to round."""
    import re
    loose = []
    for name in ("app.css", "glass.css"):
        css = (ROOT / "web" / "css" / name).read_text(encoding="utf-8")
        loose += [f"{name}: {rule.strip()[:60]}" for rule in re.findall(r"[^{}]*\{[^}]*border-radius:\s*50%[^}]*\}", css)
                  if "corner-shape: round" not in rule]
    assert not loose, loose
