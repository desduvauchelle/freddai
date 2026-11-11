/** Display form of a project name; the "Uppercase project names" thread-display setting applies everywhere a project name is shown. */
export const formatProjectName = (name: string | null | undefined, uppercase: boolean | undefined): string => {
  const value = name ?? '';
  return uppercase ? value.toLocaleUpperCase() : value;
};
