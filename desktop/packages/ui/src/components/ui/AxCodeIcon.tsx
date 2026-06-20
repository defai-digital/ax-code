import React from 'react';

interface AxCodeIconProps {
  className?: string;
  width?: number;
  height?: number;
}

const logoSrc = new URL('./ax-engine-logo.png', import.meta.url).href;

export const AxCodeIcon: React.FC<AxCodeIconProps> = ({
  className = '',
  width = 70,
  height = 70,
}) => {
  return (
    <img
      src={logoSrc}
      alt="AX Code"
      width={width}
      height={height}
      className={className}
      draggable={false}
    />
  );
};
