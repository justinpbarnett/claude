import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PROFILE = "quality-cqp";
const MARKER = "<!-- autoresearch-profile: quality-cqp -->";
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const checkerSchema = Type.Object({
  id: Type.String(),
  category: Type.String(),
  command: Type.String(),
  parser: Type.String(),
  weight: Type.Number(),
  rationale: Type.Optional(Type.String()),
  hardGate: Type.Optional(Type.Boolean()),
  anyFailurePenalty: Type.Optional(Type.Number()),
  metric: Type.Optional(Type.String()),
  metricName: Type.Optional(Type.String()),
  pattern: Type.Optional(Type.String()),
});

const writeConfigSchema = Type.Object({
  checkers: Type.Array(checkerSchema),
  rationale: Type.Optional(Type.String()),
  strictChecks: Type.Optional(Type.Boolean()),
});

type CheckerPlan = {
  checkers: Array<{
    id: string;
    category: string;
    command: string;
    parser: string;
    weight: number;
    rationale?: string;
    hardGate?: boolean;
    anyFailurePenalty?: number;
    metric?: string;
    metricName?: string;
    pattern?: string;
  }>;
  rationale?: string;
  strictChecks?: boolean;
};

function template(name: string): string {
  return readFileSync(join(PACKAGE_ROOT, "templates", name), "utf8");
}

function writeFile(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function hasQualityMarker(cwd: string): boolean {
  const path = join(cwd, "autoresearch.md");
  return existsSync(path) && readFileSync(path, "utf8").includes(MARKER);
}

function hasAnyAutoresearchSession(cwd: string): boolean {
  return ["autoresearch.md", "autoresearch.sh", "autoresearch.jsonl", "autoresearch.config.json"].some((name) =>
    existsSync(join(cwd, name)),
  );
}

function materialize(cwd: string, plan: CheckerPlan) {
  if (hasAnyAutoresearchSession(cwd) && !hasQualityMarker(cwd)) {
    throw new Error("Existing non-quality autoresearch session detected. Create/switch to a dedicated autoresearch branch or archive existing files first.");
  }

  const config = {
    profile: PROFILE,
    metric: "cqp",
    direction: "lower",
    strictChecks: plan.strictChecks ?? false,
    checkers: plan.checkers,
  };

  writeFile(join(cwd, ".autoresearch", "quality", "evaluate_quality.py"), template("evaluate_quality.py"));
  writeFile(join(cwd, ".autoresearch", "quality", "config.json"), `${JSON.stringify(config, null, 2)}\n`);
  writeFile(join(cwd, "autoresearch.sh"), template("autoresearch.sh"));

  const checkerLines = plan.checkers
    .map((checker) => `- **${checker.id}** (${checker.category}, ${checker.parser}): \`${checker.command}\` — ${checker.rationale ?? "No rationale provided."}`)
    .join("\n");
  const md = `${template("autoresearch.md")}\n## Checker Rationale\n\n${plan.rationale ?? "AI-approved checker plan."}\n\n${checkerLines}\n`;
  writeFile(join(cwd, "autoresearch.md"), md);

  chmodSync(join(cwd, ".autoresearch", "quality", "evaluate_quality.py"), 0o444);
  chmodSync(join(cwd, ".autoresearch", "quality", "config.json"), 0o444);
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("quality-autoresearch", {
    description: "Set up a quality-focused pi-autoresearch session that minimizes cqp.",
    handler: async (args, ctx) => {
      if (!args.trim().startsWith("setup")) {
        ctx.ui.notify("Usage: /quality-autoresearch setup", "info");
        return;
      }

      const warning = "Inspect this repo, propose a quality checker plan, ask the user to approve it, then call quality_autoresearch_write_config. Primary metric: cqp, lower is better.";
      ctx.ui.notify("Quality autoresearch setup started. Sending checker-planning prompt.", "info");
      pi.sendUserMessage(warning, { deliverAs: "followUp" });
    },
  });

  pi.registerTool({
    name: "quality_autoresearch_write_config",
    label: "Write Quality Autoresearch Config",
    description: "Materialize an approved quality-autoresearch checker plan into standard pi-autoresearch files.",
    parameters: writeConfigSchema,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      materialize(ctx.cwd, params as CheckerPlan);
      return {
        content: [
          {
            type: "text",
            text: "Wrote quality autoresearch files. Run ./autoresearch.sh to capture the baseline, then use pi-autoresearch normally.",
          },
        ],
      };
    },
  });
}
