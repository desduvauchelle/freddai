import { useEffect, useRef, type ComponentProps } from "react";

/** A details disclosure used as a floating menu rather than inline content. */
export function PopoverDetails({ onDismiss, ...props }: ComponentProps<"details"> & { onDismiss?: () => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    const dismiss = () => {
      details.open = false;
      onDismiss?.();
    };
    const dismissOutside = (event: Event) => {
      if (details.open && !event.composedPath().includes(details)) dismiss();
    };
    const dismissEscape = (event: KeyboardEvent) => {
      if (!details.open || event.key !== "Escape" || event.isComposing || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      const focusInside = details.contains(details.ownerDocument.activeElement);
      dismiss();
      if (focusInside) details.querySelector("summary")?.focus();
    };
    const doc = details.ownerDocument;
    doc.addEventListener("pointerdown", dismissOutside, true);
    // Accessibility activation can dispatch a click without any pointer events.
    doc.addEventListener("click", dismissOutside, true);
    doc.addEventListener("keydown", dismissEscape, true);
    return () => {
      doc.removeEventListener("pointerdown", dismissOutside, true);
      doc.removeEventListener("click", dismissOutside, true);
      doc.removeEventListener("keydown", dismissEscape, true);
    };
  }, [onDismiss]);
  return <details {...props} ref={ref}/>;
}
