import { useEffect, useRef, type ReactNode } from "react";
import { ArrowLeft, Bot, ChartNoAxesCombined, FolderGit2, Download, Keyboard, ListFilter, CalendarClock, Power, Palette, Smartphone, Mic, UserRound, SlidersHorizontal, Link2 } from "lucide-react";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@freddai/ui/components/breadcrumb";
import { ScrollArea } from "@freddai/ui/components/scroll-area";
import { Separator } from "@freddai/ui/components/separator";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupLabel, SidebarGroupContent, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from "@freddai/ui/components/sidebar";
import { Button } from "@freddai/ui/components/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@freddai/ui/components/dialog";

const sections = [
  { id: "settings", label: "Agents & defaults", icon: Bot },
  { id: "usage", label: "Accounts & usage", icon: ChartNoAxesCombined },
  { id: "projects", label: "Projects", icon: FolderGit2 },
  { id: "import", label: "Import sessions", icon: Download },
  { id: "companion", label: "Devices & satellite", icon: Smartphone },
  { id: "voice", label: "Voice", icon: Mic },
  { id: "agentconfig", label: "Agent config", icon: SlidersHorizontal },
  { id: "commander", label: "Commander", icon: UserRound },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "threads", label: "Thread display", icon: ListFilter },
  { id: "schedules", label: "Schedules", icon: CalendarClock },
  { id: "google", label: "Connected accounts", icon: Link2 },
  { id: "background", label: "Background work", icon: Power },
  { id: "help", label: "Keyboard shortcuts", icon: Keyboard },
] as const;

type Section = typeof sections[number]["id"];
export function SettingsPanel({ page, open, current, title, description, onNavigate, onClose, onRestoreFocus, children }: {
  page: boolean;
  open: boolean;
  current: string;
  title: ReactNode;
  description: ReactNode;
  onNavigate: (section: Section) => void;
  onClose: () => void;
  onRestoreFocus: () => void;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (page) heading.current?.focus(); }, [page, current]);
  if (!page) return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <DialogContent className="capture-panel native-dialog" onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(); }}>
      <ScrollArea viewportProps={{ style: { maxHeight: "calc(85dvh - 3rem)" }, "aria-label": "Dialog content" }}><div className="grid gap-4 pr-3">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      {children}
      </div></ScrollArea>
    </DialogContent>
  </Dialog>;
  const active = current === "accounts" ? "usage" : current === "project" ? "projects" : current;
  return <SidebarProvider className="settings-page relative min-h-0 flex-1 overflow-hidden">
    <SettingsNavigation active={active} onNavigate={onNavigate} onClose={onClose} />
    <SidebarInset className="min-h-0 min-w-0">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger aria-label="Toggle settings navigation" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        <Breadcrumb><BreadcrumbList>
          <BreadcrumbItem>Settings</BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem><BreadcrumbPage>{sections.find(section => section.id === active)?.label}</BreadcrumbPage></BreadcrumbItem>
        </BreadcrumbList></Breadcrumb>
        <Button variant="ghost" size="sm" className="ml-auto md:hidden" onClick={onClose}><ArrowLeft />Threads</Button>
      </header>
      <ScrollArea className="min-h-0 flex-1" viewportProps={{ id: "settings-content", "aria-label": "Settings content" }}>
        <div className="mx-auto w-full max-w-4xl space-y-6 p-6 md:p-10">
          <div className="space-y-2"><h1 className="text-2xl font-semibold tracking-tight outline-none" tabIndex={-1} ref={heading}>{title}</h1><p className="text-sm text-muted-foreground">{description}</p></div>
          <Separator />
          <div className="settings-form space-y-6">{children}</div>
        </div>
      </ScrollArea>
    </SidebarInset>
  </SidebarProvider>;
}

function SettingsNavigation({ active, onNavigate, onClose }: { active: string; onNavigate: (section: Section) => void; onClose: () => void }) {
  const { setOpenMobile } = useSidebar();
  return <Sidebar className="absolute inset-y-0 h-full" aria-label="Settings navigation">
    <SidebarHeader><SidebarMenu><SidebarMenuItem><SidebarMenuButton onClick={onClose}><ArrowLeft /><span>Back to threads</span></SidebarMenuButton></SidebarMenuItem></SidebarMenu></SidebarHeader>
    <SidebarContent className="overflow-hidden"><ScrollArea className="min-h-0 flex-1" viewportProps={{ "aria-label": "Settings sections" }}>
      <SidebarGroup><SidebarGroupLabel>Settings</SidebarGroupLabel><SidebarGroupContent>
        <nav aria-label="Settings sections"><SidebarMenu>
          {sections.map(({ id, label, icon: Icon }) => <SidebarMenuItem key={id}>
            <SidebarMenuButton isActive={active === id} aria-current={active === id ? "page" : undefined} onClick={() => { onNavigate(id); setOpenMobile(false); }}><Icon /><span>{label}</span></SidebarMenuButton>
          </SidebarMenuItem>)}
        </SidebarMenu></nav>
      </SidebarGroupContent></SidebarGroup>
    </ScrollArea></SidebarContent>
  </Sidebar>;
}
