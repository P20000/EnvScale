import { useEffect } from "react";
import { useTopologyStore } from "../store/useTopologyStore";

/**
 * Global Keyboard Shortcut Listener for Topology Canvas
 * Handles Ctrl+Z / Cmd+Z (Undo) and Ctrl+Y / Cmd+Shift+Z (Redo)
 * Safely ignores shortcuts when active focus is inside an editable input or textarea.
 */
export function useKeyboardShortcuts() {
  const undoAction = useTopologyStore((s) => s.undoAction);
  const redoAction = useTopologyStore((s) => s.redoAction);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      const key = e.key.toLowerCase();
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // Undo: Ctrl+Z or Cmd+Z (without Shift)
      if (isCtrlOrCmd && key === "z" && !e.shiftKey) {
        e.preventDefault();
        undoAction();
        return;
      }

      // Redo: Ctrl+Y OR (Ctrl+Shift+Z / Cmd+Shift+Z)
      if ((e.ctrlKey && key === "y") || (isCtrlOrCmd && e.shiftKey && key === "z")) {
        e.preventDefault();
        redoAction();
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [undoAction, redoAction]);
}
