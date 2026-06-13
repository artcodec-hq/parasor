import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ComponentType, SVGProps } from "react";
import { PaGlyph } from "./index.js";

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

const ICONS = Object.entries(PaGlyph) as Array<[string, IconComponent]>;

function IconCatalog() {
  return (
    <div className="min-h-screen bg-bg-primary p-6 text-text-primary">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-2">
        {ICONS.map(([name, Icon]) => (
          <div
            key={name}
            className="flex h-12 items-center gap-3 rounded-control border border-border bg-bg-secondary px-3"
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-accent">
              <Icon />
            </span>
            <span className="truncate text-xs text-text-secondary">{name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const meta = {
  title: "Foundations/Icons/Catalog",
  component: IconCatalog,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof IconCatalog>;

export default meta;

type Story = StoryObj<typeof meta>;

export const AllIcons: Story = {};
