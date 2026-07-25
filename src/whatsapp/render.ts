/** Substitutes {{1}}, {{2}}, ... placeholders in a template body with positional values. */
export function renderTemplateBody(bodyText: string, variableValues: string[]): string {
  return bodyText.replace(/\{\{(\d+)\}\}/g, (match, indexStr) => {
    const index = parseInt(indexStr, 10) - 1;
    return variableValues[index] ?? match;
  });
}
