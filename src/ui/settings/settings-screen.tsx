"use client";

import { useId } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { Lens } from "@/insight/lens";
import { useSettings } from "@/ui/device/settings-provider";
import type { ThemePref } from "@/ui/theme/theme";

type Option<T extends string> = { value: T; label: string; hint?: string };

const LENS_OPTIONS: Option<Lens>[] = [
  { value: "beginner", label: "入門", hint: "用白話解釋，名詞附說明" },
  { value: "pro", label: "專業", hint: "使用市場用語，顯示更多指標" },
];

const THEME_OPTIONS: Option<ThemePref>[] = [
  { value: "system", label: "跟隨系統" },
  { value: "light", label: "淺色" },
  { value: "dark", label: "深色" },
];

export function SettingsScreen() {
  const { settings, setLens, setTheme } = useSettings();

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
      <h1 className="text-2xl font-semibold">設定</h1>

      <OptionCard
        title="閱讀模式"
        options={LENS_OPTIONS}
        value={settings.lens}
        onChange={setLens}
      />
      <OptionCard title="外觀" options={THEME_OPTIONS} value={settings.theme} onChange={setTheme} />

      <p className="text-sm text-muted-foreground">設定只存在這個裝置上。</p>
    </div>
  );
}

function OptionCard<T extends string>({
  title,
  options,
  value,
  onChange,
}: {
  title: string;
  options: Option<T>[];
  value: T;
  onChange(value: T): void;
}) {
  const id = useId();
  const titleId = `${id}-title`;

  return (
    <section className="rounded-xl border bg-card p-4">
      <h2 id={titleId} className="mb-3 text-base font-bold">
        {title}
      </h2>
      <RadioGroup
        aria-labelledby={titleId}
        value={value}
        onValueChange={(next) => onChange(next as T)}
      >
        {options.map((option) => {
          const itemId = `${id}-${option.value}`;
          const hintId = `${itemId}-hint`;
          return (
            <div
              key={option.value}
              className="relative flex items-start gap-3 rounded-lg px-1 py-2 has-[:focus-visible]:bg-muted"
            >
              <RadioGroupItem
                id={itemId}
                value={option.value}
                aria-describedby={option.hint ? hintId : undefined}
                className="mt-0.5"
              />
              <div className="flex flex-col gap-0.5">
                {/* The label's overlay makes the whole row the tap target. */}
                <label
                  htmlFor={itemId}
                  className="text-sm font-medium after:absolute after:inset-0 after:content-['']"
                >
                  {option.label}
                </label>
                {option.hint && (
                  <p id={hintId} className="text-sm text-muted-foreground">
                    {option.hint}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </RadioGroup>
    </section>
  );
}
