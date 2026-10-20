import React from "react";

export interface EnvScaleLogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
}

export function EnvScaleLogo({
  className = "",
  size,
  width,
  height,
  ...props
}: EnvScaleLogoProps) {
  const logoWidth = size ?? width ?? "1em";
  const logoHeight = size ?? height ?? "1em";

  return (
    <svg
      id="EnvScale_Logo"
      data-name="EnvScale Logo"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 973.84 946.43"
      fill="currentColor"
      width={logoWidth}
      height={logoHeight}
      className={`shrink-0 inline-block align-middle transition-colors ${className}`}
      {...props}
    >
      <path
        d="M599,365.12V307.36L843.33,157.45A493.37,493.37,0,0,0,508.2,26.79c-273.44,0-495.12,221.67-495.12,495.12,0,198.18,116.44,369.17,284.64,448.27L355.54,918l90.79-524H577.47l2.76,26.13H504.1L490.73,546.34H593.6l10.84,102.38H479.88l-10.14,95.83H614.59L633,918l79.15,55.21C846.34,912.47,948.65,793.6,986.92,648.72Zm-28.89-8.25a8.25,8.25,0,0,1-8.25,8.25H454.57a8.25,8.25,0,0,1-8.25-8.25V315.61a8.24,8.24,0,0,1,8.25-8.25H561.84a8.25,8.25,0,0,1,8.25,8.25ZM425.69,282.6l82.51-99,82.52,99Z"
        transform="translate(-13.08 -26.79)"
        fill="currentColor"
      />
    </svg>
  );
}

export default EnvScaleLogo;
