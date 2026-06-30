export const CURATED_SKILLS_SOURCES = [
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Anthropic's public skills repository",
    source: "anthropics/skills",
    defaultSubpath: "skills",
    sourceType: "github",
  },
  {
    id: "mattpocock",
    label: "Matt Pocock",
    description: "Practical engineering skills from Matt Pocock",
    source: "mattpocock/skills",
    sourceType: "github",
  },
  {
    id: "jeffallan",
    label: "Full-Stack Developer Skills",
    description: "Specialized full-stack engineering skills",
    source: "Jeffallan/claude-skills",
    sourceType: "github",
  },
  {
    id: "jezweb",
    label: "Jezweb Claude Skills",
    description: "Web development, Cloudflare, React, Tailwind, and AI integration skills",
    source: "jezweb/claude-skills",
    sourceType: "github",
  },
  {
    id: "engineering-workflows",
    label: "Engineering Workflow Skills",
    description: "Git, testing, review, and software engineering workflow skills",
    source: "mhattingpete/claude-skills-marketplace",
    sourceType: "github",
  },
  {
    id: "posit",
    label: "Posit",
    description: "Data science, documentation, and release workflow skills from Posit",
    source: "posit-dev/skills",
    sourceType: "github",
  },
  {
    id: "clawdhub",
    label: "ClawdHub",
    description: "Community skill registry with vector search",
    source: "clawdhub:registry",
    sourceType: "clawdhub",
  },
]

export function getCuratedSkillsSources() {
  return CURATED_SKILLS_SOURCES.slice()
}
