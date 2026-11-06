import { useCallback, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';

/** Invalidate pending automatic navigation as soon as a newer navigation is requested,
 * including away-and-back navigation and updates batched before the next render. */
export function useNavigationState<T>(initial: T | (() => T), revision: MutableRefObject<number>): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState(initial);
  const navigate = useCallback<Dispatch<SetStateAction<T>>>(next => {
    revision.current += 1;
    setValue(next);
  }, [revision]);
  return [value, navigate];
}
