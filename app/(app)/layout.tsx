import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/Logo";
import { signOut } from "@/app/login/actions";
import { getActiveWorkspace, getSession } from "@/lib/workspace";
import { AppNav } from "./AppNav";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

// Shell for signed-in pages: logo, sections, workspace switcher, sign out.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await getSession();
  if (!userId) redirect("/login");
  const { workspaces, active } = await getActiveWorkspace();

  return (
    <div className="flex-1 flex flex-col">
      <header className="bg-white border-b border-[#E2E8F0]">
        <div className="max-w-[1280px] mx-auto px-4 md:px-8 h-16 flex items-center gap-4 md:gap-8">
          <Link href="/" aria-label="LedgerFlow home" className="shrink-0">
            <Logo />
          </Link>
          {active && <AppNav />}
          <div className="ml-auto flex items-center gap-3">
            {active && <WorkspaceSwitcher workspaces={workspaces} activeId={active.id} />}
            <form action={signOut}>
              <button type="submit" className="text-sm text-[#64748B] hover:text-[#0F172A] whitespace-nowrap">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex-1 max-w-[1280px] w-full mx-auto px-4 md:px-8 py-8 md:py-10">{children}</main>
    </div>
  );
}
