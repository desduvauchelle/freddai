import type { PermissionMode } from "./types";
// Match the host's PermissionMode::default for legacy and phone-created threads.
export const savedPermissionMode = (mode?: PermissionMode | null): PermissionMode => mode ?? "ask";
