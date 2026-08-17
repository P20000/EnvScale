type ShapeType =
  | "rectangle"
  | "circle"
  | "diamond"
  | "cylinder"
  | "hexagon";

type ShapePaletteProps = {
  onAddShape: (shape: ShapeType, label: string) => void;
  onClose: () => void;
};

const shapes: {
  type: ShapeType;
  label: string;
  icon: string;
}[] = [
  {
    type: "rectangle",
    label: "Service",
    icon: "▭",
  },
  {
    type: "circle",
    label: "Pod",
    icon: "●",
  },
  {
    type: "diamond",
    label: "Decision",
    icon: "◆",
  },
  {
    type: "cylinder",
    label: "Database",
    icon: "◉",
  },
  {
    type: "hexagon",
    label: "Cluster",
    icon: "⬡",
  },
];

export default function ShapePalette({
  onAddShape,
  onClose,
}: ShapePaletteProps) {
  return (
    <aside className="shape-palette">
      <div className="shape-palette-header">
        <div>
          <h2>Shape Library</h2>
          <p>Add nodes to your workflow</p>
        </div>

        <button
          className="palette-close"
          onClick={onClose}
          aria-label="Close shape library"
        >
          ×
        </button>
      </div>

      <div className="shape-grid">
        {shapes.map((shape) => (
          <button
            key={shape.type}
            className="shape-option"
            onClick={() =>
              onAddShape(shape.type, shape.label)
            }
          >
            <span className={`shape-preview ${shape.type}`}>
              {shape.icon}
            </span>

            <span>{shape.label}</span>
          </button>
        ))}
      </div>

      <div className="palette-info">
        <strong>Workflow editor</strong>
        <p>
          Add shapes and connect them using the handles
          on each node.
        </p>
      </div>
    </aside>
  );
}
