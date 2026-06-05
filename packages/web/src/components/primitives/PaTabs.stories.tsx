import type { Meta, StoryObj } from "@storybook/react-vite";
import { useArgs } from "storybook/preview-api";
import { PaTabs } from "./PaTabs.js";

type TabValue = "general" | "terminal" | "editor";

const noop = () => undefined;

const OPTIONS = [
  { value: "general", label: "General" },
  { value: "terminal", label: "Terminal" },
  { value: "editor", label: "Editor" },
] as const;

const meta = {
  title: "Foundations/Primitives/Core controls",
  component: PaTabs,
  parameters: {
    layout: "centered",
    controls: {
      include: ["value", "className"],
    },
  },
  argTypes: {
    value: {
      control: "radio",
      options: OPTIONS.map((option) => option.value),
    },
    className: {
      control: "text",
    },
    options: {
      table: { disable: true },
    },
    onChange: {
      table: { disable: true },
    },
  },
  args: {
    value: "terminal",
    options: OPTIONS,
    onChange: noop,
    className: "w-[460px]",
  },
} satisfies Meta;

export default meta;

type Story = StoryObj<typeof meta>;

export const UnderlineTabs: Story = {
  render: function UnderlineTabsStory(args) {
    const [{ value }, updateArgs] = useArgs();
    return (
      <PaTabs
        value={(value as TabValue | undefined) ?? args.value}
        options={OPTIONS}
        className={args.className}
        onChange={(nextValue) => updateArgs({ value: nextValue })}
      />
    );
  },
};
