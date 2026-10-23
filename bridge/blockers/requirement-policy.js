// Disjoint classification groups define both response shapes and finding behaviour.
export const requirementClasses = [
  { categories: ["eligibility"], necessities: ["mandatory"],
    evidenceStates: ["incompatible", "missing", "conflicting"], producesFinding: true },
  { categories: ["work_arrangement"], necessities: ["mandatory"],
    evidenceStates: ["incompatible"], producesFinding: true },
  { categories: ["eligibility", "work_arrangement"], necessities: ["mandatory"],
    evidenceStates: ["supported"], producesFinding: false },
  { categories: ["work_arrangement"], necessities: ["mandatory"],
    evidenceStates: ["missing", "conflicting"], producesFinding: false },
  { categories: ["eligibility", "work_arrangement"], necessities: ["unclear", "preferred", "excluded"],
    evidenceStates: ["supported", "incompatible", "missing", "conflicting"], producesFinding: false },
];

export const classificationFor = ({ category, necessity, evidence }) => requirementClasses.find(
  ({ categories, necessities, evidenceStates }) => categories.includes(category) &&
    necessities.includes(necessity) && evidenceStates.includes(evidence),
);
