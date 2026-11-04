import { useEffect, useRef, type ComponentProps } from "react";

/** A details disclosure used as a floating menu rather than inline content. */
export function PopoverDetails(props: ComponentProps<"details">) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    const dismissOutside = (event: PointerEvent) => {
      if (details.open && !event.composedPath().includes(details)) details.open = false;
    };
    details.ownerDocument.addEventListener("pointerdown", dismissOutside, true);
    return () => details.ownerDocument.removeEventListener("pointerdown", dismissOutside, true);
  }, []);
  return <details {...props} ref={ref}/>;
}
