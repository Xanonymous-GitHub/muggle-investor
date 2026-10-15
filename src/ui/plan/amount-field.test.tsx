import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { AmountField } from "@/ui/plan/amount-field";
import { AMOUNT_COPY, AMOUNT_ERROR_COPY } from "@/ui/plan/copy";
import type { AmountError } from "@/ui/plan/draft";

function Harness({
  initial = "",
  error,
  onBlur,
}: {
  initial?: string;
  error?: AmountError;
  onBlur?: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <AmountField
      id="f"
      field="lump"
      value={value}
      error={error}
      onChange={setValue}
      onBlur={onBlur ?? (() => {})}
    />
  );
}

const input = () => screen.getByLabelText(AMOUNT_COPY.lump.label) as HTMLInputElement;

describe("AmountField", () => {
  it("shows the label, the unit and the hint, with a numeric keypad", () => {
    render(<Harness />);
    expect(input().getAttribute("inputmode")).toBe("numeric");
    expect(screen.getByText("元")).toBeTruthy();
    const hint = screen.getByText(AMOUNT_COPY.lump.hint ?? "");
    expect(input().getAttribute("aria-describedby")).toContain(hint.id);
    expect(input().getAttribute("aria-invalid")).not.toBe("true");
  });

  it("reformats a pasted number with thousands separators on blur", async () => {
    const onBlur = vi.fn();
    render(<Harness onBlur={onBlur} />);
    await userEvent.click(input());
    await userEvent.paste("600000");
    expect(input().value).toBe("600000");
    await userEvent.tab();
    expect(input().value).toBe("600,000");
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("folds full-width digits and leaves text that does not parse alone", async () => {
    render(<Harness />);
    await userEvent.type(input(), "６００，０００");
    await userEvent.tab();
    expect(input().value).toBe("600,000");

    await userEvent.clear(input());
    await userEvent.type(input(), "12.5");
    await userEvent.tab();
    expect(input().value).toBe("12.5");
  });

  it("marks the field invalid and prints the message for 12.5", () => {
    render(<Harness initial="12.5" error="not_integer" />);
    expect(input().getAttribute("aria-invalid")).toBe("true");
    const message = screen.getByText(AMOUNT_ERROR_COPY.not_integer);
    expect(input().getAttribute("aria-describedby")).toContain(message.id);
  });
});
