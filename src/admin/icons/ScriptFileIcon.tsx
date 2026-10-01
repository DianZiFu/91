type ScriptFileIconProps = {
  size?: number;
  className?: string;
};

// File shape from Font Awesome Pro 7.3.1 by @fontawesome - https://fontawesome.com
// License: https://fontawesome.com/license (Commercial License)
// Copyright 2026 Fonticons, Inc. Lettering adapted to PY.
export function ScriptFileIcon({ size = 40, className }: ScriptFileIconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 640 640"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M309.5 64C326.5 64 342.7 70.8 354.7 82.8L461.3 189.2C473.3 201.2 480 217.5 480 234.4L480 399.9L368 399.9C332.7 399.9 304 428.6 304 463.9L304 575.9L160 575.9C124.7 575.9 96 547.2 96 511.9L96 128C96 92.7 124.7 64 160 64L309.5 64zM304 216C304 229.3 314.7 240 328 240L421.5 240L304 122.5L304 216z"
      />
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M368 444H400C428.7 444 452 467.3 452 496C452 524.7 428.7 548 400 548H388V592C388 603 379 612 368 612C357 612 348 603 348 592V464C348 453 357 444 368 444ZM388 484V508H400C406.6 508 412 502.6 412 496C412 489.4 406.6 484 400 484H388Z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth={40}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M496 464L528 512L560 464M528 512V592"
      />
    </svg>
  );
}
