// Relationship kinds between lore pages: how each reads from both ends, and its colour on the graph.
// Stored on the page that has the relationship, as "relations: [rival: Jane Roe]" in its frontmatter.
export const REL = {
  ally: { out: "Ally of", in: "Ally of", color: "#3FA35A" },
  friend: { out: "Friend of", in: "Friend of", color: "#2FA3A0" },
  family: { out: "Family of", in: "Family of", color: "#D09A44" },
  romance: { out: "In a romance with", in: "In a romance with", color: "#E0679A" },
  rival: { out: "Rival of", in: "Rival of", color: "#E08A4A" },
  enemy: { out: "Enemy of", in: "Enemy of", color: "#E5626A" },
  member: { out: "Member of", in: "Has as a member", color: "#4A90E2" },
  serves: { out: "Serves", in: "Served by", color: "#9B6DD6" },
  owes: { out: "Owes", in: "Owed by", color: "#A3845F" },
  other: { out: "Linked to", in: "Linked to", color: "#8E8E99" },
};
export const relInfo = (kind) => REL[kind] || REL.other;
