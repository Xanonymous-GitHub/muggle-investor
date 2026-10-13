import type { ComponentProps } from "react";

// `next/link` is supplied by vinext's build plugin and does not resolve under plain Vitest, so the
// dom project aliases it here: a plain anchor is all the component tests need.
export default function Link({ href, children, ...rest }: ComponentProps<"a">) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
