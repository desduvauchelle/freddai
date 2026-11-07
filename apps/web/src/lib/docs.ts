export type Guide = {
  slug: string;
  title: string;
  description: string;
  image: "desktop" | "companion";
  sections: { id: string; title: string; body: string; steps?: string[]; example?: string }[];
};

export const guides: Guide[] = [
  {
    slug: "onboarding", title: "Onboarding",
    description: "Connect your coding agents, bring in a local project, and make Freddai your workspace.", image: "desktop",
    sections: [
      { id: "before-you-start", title: "Before you start", body: "Freddai brings your coding agents together. You need your own provider account and an installed coding-agent CLI. Provider subscriptions, permissions, and usage limits still apply. Start on desktop; the phone companion connects to your Mac.", steps: ["Choose an available desktop installer from the download section. Availability is shown there for each platform.", "Install and open Freddai. Have the coding-agent CLI and provider account you intend to use ready.", "Choose a local project folder you are comfortable letting the agent work in. Use version control so you can review changes."] },
      { id: "connect-agents", title: "Connect an agent account", body: "Use the account setup flow to connect the provider you want to work with. Follow the sign-in or CLI connection instructions shown for that provider. An account must be ready before you can start work.", steps: ["Complete the provider’s connection steps in Freddai.", "Check the account status. Resolve any sign-in or CLI error before continuing.", "Add other accounts when you need them. Give each a recognizable name so personal and work accounts are easy to distinguish." ] },
      { id: "add-project", title: "Add your first project", body: "Select Add project and choose the local folder that contains your work. Freddai organizes threads around this folder. Check the project’s settings and account defaults before your first task." },
      { id: "return-to-setup", title: "Return to setup any time", body: "Open the Freddai menu and choose Revisit onboarding to return to agents and accounts. You can add a project later from the sidebar. If you cannot start a thread, check that both a project and a ready account are available." },
    ],
  },
  {
    slug: "getting-started", title: "Getting started",
    description: "Go from a connected account to your first useful coding thread, then review the result.", image: "desktop",
    sections: [
      { id: "first-thread", title: "Start with one clear task", body: "Choose your project, create a New thread, and check the selected agent and account. Describe the outcome you want, the relevant context, and how you will know the work is complete. Start with a small task to learn the workflow.", example: "Inspect this project and explain how the main page is rendered. Identify the relevant files and suggest one small accessibility improvement. Wait for my review before editing." },
      { id: "follow-progress", title: "Follow progress and answer requests", body: "Open the thread to read the agent’s output and see what it needs from you. Review permission requests in context and reply when the agent needs clarification. Provider capabilities and permission behavior depend on the agent you selected." },
      { id: "review-work", title: "Review the result", body: "Read the agent’s explanation, inspect changed files in your normal development tools, and run the checks appropriate to your project. Ask for a correction in the same thread when useful. Review and verify changes before committing or shipping them.", example: "Summarize the files you changed, the checks you ran and their results, and anything I still need to verify manually." },
      { id: "next-task", title: "Keep the next task easy to find", body: "Use the project’s thread list to return to the conversation. Keep related follow-ups together and use a new thread for a separate task. Home gives you a view across projects; daily recaps help you catch up on completed work and remaining attention." },
      { id: "troubleshooting", title: "If something blocks your first task", body: "For a sign-in error, return to account setup and check the selected account. For a missing CLI, confirm that the required agent CLI is installed. For a project error, check that the local folder still exists and is accessible. For a usage limit, inspect the provider’s status and choose another ready account if available; switching accounts does not remove provider limits." },
    ],
  },
  {
    slug: "use-cases", title: "Use cases",
    description: "Practical ways to use one workspace for everyday coding, multiple accounts, and work away from your desk.", image: "companion",
    sections: [
      { id: "understand-code", title: "Understand an unfamiliar codebase", body: "Add the repository as a project and ask for a focused explanation before requesting edits. A useful first thread maps an entry point, its dependencies, and the checks used by the project.", example: "Trace the sign-in flow from the UI to the server. Show the relevant files, explain error handling, and identify the tests. Do not change code yet." },
      { id: "fix-bug", title: "Investigate and fix a bug", body: "Give the agent the observed behavior, expected behavior, and reproduction steps. Keep investigation and follow-up corrections in the same thread so the evidence stays together.", example: "The settings panel loses my selection after reopening. Trace where the value is saved and loaded, explain the cause, then implement a minimal fix and run the relevant checks." },
      { id: "multiple-projects", title: "Work across projects and accounts", body: "Keep each local repository in its own project and choose the account appropriate to the task. Check available usage before starting longer work. Use separate threads for independent tasks, and coordinate edits when multiple agents work in the same folder to avoid conflicting changes." },
      { id: "catch-up", title: "Catch up after a busy day", body: "Use Home and daily recaps to find progress across projects. Open the underlying thread for details and review the actual changes before treating a task as delivered." },
      { id: "away-from-desk", title: "Follow work from your phone", body: "Pair the companion with your Mac to read progress, reply, and respond when an agent needs you. The Mac continues to run the coding agents. Keep it awake and online; access outside the local network also needs the Mac’s relay configuration. See the Features guide for pairing steps." },
    ],
  },
  {
    slug: "features", title: "Features",
    description: "Explore accounts, project threads, Home, daily recaps, and the mobile companion.", image: "desktop",
    sections: [
      { id: "accounts", title: "Agents and accounts in one place", body: "Connect your own coding-agent accounts and choose which one to use for a task. Project defaults reduce repeated setup. Available usage and reset windows help you plan where supported by the provider; usage visibility is provider-dependent." },
      { id: "projects", title: "Local projects and organized threads", body: "Freddai groups coding conversations around your local project folders. Follow current work, return to previous conversations, and give separate tasks their own threads. The agent works with the permissions and environment available on your desktop." },
      { id: "home", title: "Home, voice, and daily recaps", body: "See projects together on Home and start a request by typing or using the microphone. Voice features may require microphone permission. Generate daily recaps to see work across projects, then open individual threads for the full context." },
      { id: "pairing", title: "Pair the mobile companion", body: "The companion extends your Mac workspace to your phone or tablet. It does not install or run a separate coding-agent environment on the mobile device.", steps: ["Install an available companion build from the download section. Platform access and beta availability are shown there.", "On the Mac, open Settings → Pair phone. Transfer the displayed Mac setup text using a trusted method.", "On the companion, enter the Mac setup and six-digit pairing code, then approve the device on the Mac. Initial pairing requires the same local network.", "Keep the Mac awake and connected. Away from that network, configure the Mac’s relay connection first. If connection fails, check the Mac, network, and pairing status before retrying." ] },
      { id: "requirements", title: "What to expect across platforms", body: "Desktop work requires an installed coding-agent CLI and your own provider account. Companion access requires a paired Mac. Release availability can differ from the latest source code; use the download section for available builds and the Android setup guide for beta-specific instructions." },
    ],
  },
];

export function findGuide(slug: string) { return guides.find(guide => guide.slug === slug); }
