import { createContext } from 'react';
/** Desktop supplies an embedded browser; mobile and standalone transcripts keep external opening. */
export const BrowserContext = createContext<((url: string) => void) | null>(null);
