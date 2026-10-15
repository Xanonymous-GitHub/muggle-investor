import { BookOpen, Calculator, House, LayoutGrid, Settings } from "lucide-react";

export const NAV_ITEMS = [
  { href: "/", label: "今日", icon: House },
  { href: "/sectors", label: "族群", icon: LayoutGrid },
  { href: "/plan", label: "規劃", icon: Calculator },
  { href: "/glossary", label: "名詞", icon: BookOpen },
] as const;

export const SETTINGS_ITEM = { href: "/settings", label: "設定", icon: Settings } as const;

// "/" matches only itself; other items also match their sub-paths, on a segment boundary.
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
