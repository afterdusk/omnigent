import type { Meta, StoryObj } from "@storybook/react-vite";
import { SlashCommandMenu } from "./SlashCommandMenu";

// The menu scrolls past 22rem; the session-gated built-ins would push the
// Skills section out of frame, so show the commands every session gets.
const defaultCommands = {
  "/compact": "Compact conversation context to free up space",
  "/context": "Show context window usage for this session",
  "/effort": "Set reasoning effort: /effort low | medium | high | default",
  "/model": "Switch the model for this session: /model <name>",
  "/new": "Start a blank session in the same project",
  "/help": "Show available slash commands",
};
const builtinNames = new Set(Object.keys(defaultCommands));

const commands = {
  ...defaultCommands,
  "/review": "Review the current change for correctness, maintainability, and test coverage.",
  "/simplify": "Make recently changed code easier to understand without changing behavior.",
  "/test": "Run focused tests and explain any failures.",
};

const meta = {
  title: "Components/Menus/SlashCommandMenu",
  component: SlashCommandMenu,
  tags: ["visual-snapshot"],
  args: {
    commands,
    builtinNames,
    onSelect: () => undefined,
  },
  decorators: [
    (Story) => (
      <div className="relative h-[420px] w-[640px] rounded-xl border bg-card">
        <div className="absolute inset-x-4 bottom-4 h-12 rounded-xl border bg-background">
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof SlashCommandMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CommandsAndSkills: Story = {
  args: {
    query: "",
    activeIndex: 0,
  },
};

export const ActiveSkill: Story = {
  args: {
    query: "",
    activeIndex: Object.keys(defaultCommands).length,
  },
};

export const FilteredSkill: Story = {
  args: {
    query: "rev",
    activeIndex: 0,
  },
};

export const LoadingSkills: Story = {
  args: { query: "", activeIndex: 0, commands: defaultCommands, skillsStatus: "loading" },
};

export const LoadingFilteredSkills: Story = {
  args: {
    query: "review",
    activeIndex: -1,
    commands: defaultCommands,
    skillsStatus: "loading",
  },
};
