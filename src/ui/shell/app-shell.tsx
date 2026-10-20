"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PwaNotices } from "@/ui/pwa/pwa-notices";
import { isActive, NAV_ITEMS, SETTINGS_ITEM } from "@/ui/shell/nav-items";
import { useOnline } from "@/ui/shell/use-online";

const TITLE = "Muggle Investor";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const online = useOnline();
  const SettingsIcon = SETTINGS_ITEM.icon;

  return (
    <div className="min-h-svh pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] md:flex">
      <aside className="hidden w-56 shrink-0 border-r bg-card md:sticky md:top-0 md:flex md:h-svh md:flex-col md:p-3">
        <div className="px-2 py-3 text-base font-bold">{TITLE}</div>
        <nav aria-label="側邊導覽" className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <SidebarLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
          <SidebarLink
            item={SETTINGS_ITEM}
            active={isActive(pathname, SETTINGS_ITEM.href)}
            className="mt-auto"
          />
        </nav>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="flex items-center justify-between px-4 py-3 md:hidden">
          <span className="text-base font-bold">{TITLE}</span>
          <Link
            href={SETTINGS_ITEM.href}
            aria-label={SETTINGS_ITEM.label}
            className="rounded-md p-2 text-muted-foreground"
          >
            <SettingsIcon className="size-5" aria-hidden="true" />
          </Link>
        </header>

        <PwaNotices />

        {!online && (
          <p role="status" className="bg-muted px-4 py-2 text-center text-sm text-muted-foreground">
            目前離線，顯示的是上次載入的資料。
          </p>
        )}

        {/* Bottom padding = the bar's h-16 plus 2rem of air, plus the inset the bar also pads by. */}
        <main className="mx-auto w-full max-w-6xl px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:px-8 md:pt-6 md:pb-8">
          {children}
        </main>
      </div>

      <nav
        aria-label="主要導覽"
        className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-5 border-t bg-card pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:hidden"
      >
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-16 flex-col items-center justify-center gap-1 text-xs",
                active ? "font-bold text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="size-[22px]" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function SidebarLink({
  item,
  active,
  className,
}: {
  item: { href: string; label: string; icon: (typeof NAV_ITEMS)[number]["icon"] };
  active: boolean;
  className?: string;
}) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm",
        active ? "bg-muted font-bold text-primary" : "text-muted-foreground hover:bg-muted",
        className,
      )}
    >
      <Icon className="size-5" aria-hidden="true" />
      {item.label}
    </Link>
  );
}
