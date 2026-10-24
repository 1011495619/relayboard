import codex from "@lobehub/icons-static-svg/icons/codex.svg?raw";
import claude from "@lobehub/icons-static-svg/icons/claudecode-color.svg?raw";
import pi from "@lobehub/icons-static-svg/icons/pi.svg?raw";
import gemini from "@lobehub/icons-static-svg/icons/geminicli.svg?raw";
import opencode from "@lobehub/icons-static-svg/icons/opencode.svg?raw";
import copilot from "@lobehub/icons-static-svg/icons/copilot.svg?raw";
import cursor from "@lobehub/icons-static-svg/icons/cursor.svg?raw";
import qwen from "@lobehub/icons-static-svg/icons/qwen-color.svg?raw";
import goose from "@lobehub/icons-static-svg/icons/goose.svg?raw";
import kilo from "@lobehub/icons-static-svg/icons/kilocode.svg?raw";
import amp from "@lobehub/icons-static-svg/icons/amp-color.svg?raw";
import cline from "@lobehub/icons-static-svg/icons/cline.svg?raw";
import roo from "@lobehub/icons-static-svg/icons/roocode.svg?raw";
import windsurf from "@lobehub/icons-static-svg/icons/windsurf.svg?raw";
import trae from "@lobehub/icons-static-svg/icons/trae-color.svg?raw";
import kiro from "@lobehub/icons-static-svg/icons/kiro.svg?raw";
import antigravity from "@lobehub/icons-static-svg/icons/antigravity-color.svg?raw";
import hermes from "@lobehub/icons-static-svg/icons/hermesagent.svg?raw";
const logos: Record<string, string> = {
  codex,
  claude,
  pi,
  gemini,
  opencode,
  copilot,
  cursor,
  qwen,
  goose,
  kilo,
  amp,
  cline,
  roo,
  windsurf,
  trae,
  kiro,
  antigravity,
  hermes,
};
/** Only build-time SVGs from the pinned LobeHub package enter this HTML sink. */
export function AgentIcon({
  runtime,
  name,
}: {
  runtime: string;
  name: string;
}) {
  const svg = logos[runtime];
  return svg ? (
    <span
      className="agent-brand-icon"
      aria-hidden="true"
      data-logo-source="lobehub"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  ) : (
    <span aria-hidden="true">{name.slice(0, 1)}</span>
  );
}
