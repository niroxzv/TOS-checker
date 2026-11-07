/** UNFAIR-ToS is tokenized ("may , from time to time ."). Undo the extra spaces so it reads like a real ToS. */
export function detokenize(raw: string): string {
  return raw
    .replace(/\s+([,.;:!?)\]'])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/``\s*|\s*''/g, '"')
    .replace(/\s+n't\b/g, "n't")
    .trim();
}
