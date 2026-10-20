import React from "react";
import IconRaw from "@mdi/react";
import type { IconProps } from "@mdi/react/dist/IconProps";

// Handle CJS/ESM interop differences between Vite dev server and bundle builds
const MdiIconComponent = (
  (IconRaw as unknown as { default?: React.ComponentType<IconProps> }).default || IconRaw
) as React.ComponentType<IconProps>;

export function Icon(props: IconProps) {
  return <MdiIconComponent {...props} />;
}

export default Icon;
