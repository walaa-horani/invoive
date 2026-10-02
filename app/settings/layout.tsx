import Link from "next/link";
import { Logo } from "@/components/Logo";
import { signOut } from "@/app/login/actions";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex flex-col">
      <header className="bg-white border-b border-[#dce9ff]">
        <div className="max-w-[1120px] mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" aria-label="LedgerFlow home">
            <Logo />
          </Link>
          <nav className="flex items-center gap-6 text-sm">
            <Link href="/settings/billing" className="font-semibold text-[#0051d5]">
              Billing
            </Link>
            <form action={signOut}>
              <button type="submit" className="text-[#45464d] hover:text-[#0b1c30]">
                Sign out
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="flex-1 max-w-[1120px] w-full mx-auto px-6 py-10">{children}</main>
    </div>
  );
}
