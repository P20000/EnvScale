# Libadwaita GTK4 GUI Package for EnvScale Test Center
__all__ = ["TestCenterAdwApp", "launch_adw_gui"]


def __getattr__(name: str):
    if name in __all__:
        from . import app_window

        return getattr(app_window, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
