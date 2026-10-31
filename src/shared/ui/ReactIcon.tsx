/**
 * Adapted from reactjs/react.dev/src/components/Logo.tsx.
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 * Copyright (c) Facebook, Inc. and its affiliates.
 * MIT License: public/licenses/react-logo-MIT.txt.
 */
export default function ReactIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="-10.5 -9.45 21 18.9"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle r="2" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1">
        <ellipse rx="10" ry="4.5" />
        <ellipse rx="10" ry="4.5" transform="rotate(60)" />
        <ellipse rx="10" ry="4.5" transform="rotate(120)" />
      </g>
    </svg>
  );
}
