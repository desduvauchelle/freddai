/** Commander owns one navigation entry; its conversations and delegated work live in its tools. */
export function isCommanderThread(thread: { project: string; origin?: { kind: string } | null }, commanderId?: string) {
  return (!!commanderId && thread.project === commanderId) || thread.origin?.kind === 'commander';
}
