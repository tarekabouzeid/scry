"use client";

// Imported only via next/dynamic (canvas + window access, no SSR). Lives in
// its own module because next/dynamic doesn't forward refs — the parent
// passes its ref down as a regular prop instead.
import { useEffect, type MutableRefObject } from "react";
import ForceGraph2D, { type ForceGraphMethods, type ForceGraphProps } from "react-force-graph-2d";

export type GraphHandle = ForceGraphMethods;

export default function ForceGraphCanvas({
  graphRef,
  onReady,
  ...props
}: ForceGraphProps & {
  graphRef: MutableRefObject<GraphHandle | undefined>;
  /** Fires once the ref is attached, so the parent can configure forces. */
  onReady?: () => void;
}) {
  useEffect(() => {
    onReady?.();
  }, [onReady]);
  return <ForceGraph2D ref={graphRef} {...props} />;
}
