// Relationship kinds between lore pages: how each reads from both ends, and its colour on the graph.
// Stored on the page that has the relationship, as "relations: [rival: Jane Roe]" in its frontmatter.
import { cat } from "./themecolors.js";

export const REL = {
  ally: { out: "Ally of", in: "Ally of", color: cat(4, "#3FA35A") },
  friend: { out: "Friend of", in: "Friend of", color: cat(5, "#2FA3A0") },
  family: { out: "Family of", in: "Family of", color: cat(3, "#D09A44") },
  romance: { out: "In a romance with", in: "In a romance with", color: cat(8, "#E0679A") },
  rival: { out: "Rival of", in: "Rival of", color: cat(2, "#E08A4A") },
  enemy: { out: "Enemy of", in: "Enemy of", color: cat(1, "#E5626A") },
  member: { out: "Member of", in: "Has as a member", color: cat(6, "#4A90E2") },
  serves: { out: "Serves", in: "Served by", color: cat(7, "#9B6DD6") },
  owes: { out: "Owes", in: "Owed by", color: cat(3, "#A3845F") },
  other: { out: "Linked to", in: "Linked to", color: "var(--text-3)" },
};
export const relInfo = (kind) => REL[kind] || REL.other;
