import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function IconBase({ size = 20, children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {children}
    </svg>
  );
}

export function InkMarkIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7 19.5 16.7 9.8l-2.5-2.5L4.5 17v3h3Z" fill="currentColor" opacity=".92" />
      <path d="m13.8 7.7 1.9-1.9a1.8 1.8 0 0 1 2.5 0 1.8 1.8 0 0 1 0 2.5l-1.9 1.9-2.5-2.5Z" fill="currentColor" />
      <path d="M10 20h10" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v4.2A1.8 1.8 0 0 0 6.8 20h10.4a1.8 1.8 0 0 0 1.8-1.8V14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7 3.5h6l4 4v13H7a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="M13 3.5v4h4M8.5 12h5.5M8.5 15.5h7" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </IconBase>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3 19 6v5.2c0 4.5-3 7.8-7 9.8-4-2-7-5.3-7-9.8V6l7-3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="m9 12 2 2 4-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </IconBase>
  );
}

export function SparkIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 2.8c.5 4.8 2.4 6.7 7.2 7.2-4.8.5-6.7 2.4-7.2 7.2-.5-4.8-2.4-6.7-7.2-7.2 4.8-.5 6.7-2.4 7.2-7.2Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
      <path d="M18.5 15.5c.2 2 .9 2.8 2.9 3-2 .2-2.7 1-2.9 2.9-.2-2-.9-2.7-2.9-2.9 2-.2 2.7-1 2.9-3Z" fill="currentColor" />
    </IconBase>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m5 12.5 4.3 4.3L19 7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
    </IconBase>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M5 12h14m-5-5 5 5-5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function ArrowLeftIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M19 12H5m5-5-5 5 5 5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 18.5h14" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function WarningIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10.5 4.5 2.9 18a1.7 1.7 0 0 0 1.5 2.5h15.2a1.7 1.7 0 0 0 1.5-2.5L13.5 4.5a1.7 1.7 0 0 0-3 0Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.6" />
      <path d="M12 9v5m0 3h.01" stroke="currentColor" strokeLinecap="round" strokeWidth="1.9" />
    </IconBase>
  );
}

export function EditIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m4 16.8-.5 3.7 3.7-.5L18 9.2l-3.2-3.2L4 16.8Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="m13.5 7.3 3.2 3.2" stroke="currentColor" strokeWidth="1.7" />
    </IconBase>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M19 8V4m0 0h-4m4 0-3.1 3.1A7 7 0 1 0 18.4 15" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </IconBase>
  );
}

export function MoreIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="5" cy="12" fill="currentColor" r="1.5" />
      <circle cx="12" cy="12" fill="currentColor" r="1.5" />
      <circle cx="19" cy="12" fill="currentColor" r="1.5" />
    </IconBase>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </IconBase>
  );
}
