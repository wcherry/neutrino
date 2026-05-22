import React from 'react';
import type { LucideIcon } from 'lucide-react';

export interface IconProps {
  icon: LucideIcon;
  size?: number;
  className?: string;
  'aria-label'?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
  strokeWidth?: number;
  color?: string;
}

export function Icon({
  icon: IconComponent,
  size = 20,
  className,
  strokeWidth = 1.75,
  ...props
}: IconProps) {
  return (
    <IconComponent
      size={size}
      className={className}
      strokeWidth={strokeWidth}
      {...props}
    />
  );
}
