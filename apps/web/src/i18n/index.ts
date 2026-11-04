import en from "./dictionaries/en";
export type { Dictionary } from "./dictionaries/en";

// Add each translated dictionary here before enabling its locale in config.ts.
export async function getDictionary(_locale: string) {
  return en;
}
