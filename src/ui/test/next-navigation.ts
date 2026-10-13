// Same reason as ./next-link.tsx. Tests that care about the path replace this module with
// `vi.mock("next/navigation", ...)`.
export function usePathname(): string {
  return "/";
}
