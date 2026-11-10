import { createContext } from "react";
import type { ReactNode } from "react";

/** Content the Commander page asks the host conversation to render inline, after the latest messages (same column as the transcript). */
export const CommanderTrailingContext = createContext<ReactNode>(null);
