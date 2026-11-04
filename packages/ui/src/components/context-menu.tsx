import { ContextMenu as Primitive } from "radix-ui";
import type { ComponentProps } from "react";

export const ContextMenu = Primitive.Root;
export const ContextMenuTrigger = Primitive.Trigger;
export const ContextMenuItem = Primitive.Item;
export const ContextMenuSeparator = Primitive.Separator;
export const ContextMenuLabel = Primitive.Label;
export function ContextMenuContent(props: ComponentProps<typeof Primitive.Content>) {
  return <Primitive.Portal><Primitive.Content {...props} /></Primitive.Portal>;
}
