/** Substitutes {{1}}, {{2}}, ... placeholders in a template body with positional values and parses {a|b} spintax. */
export function renderTemplateBody(bodyText: string, variableValues: string[]): string {
  // 1. Resolve {{1}} variables
  let text = bodyText.replace(/\{\{(\d+)\}\}/g, (match, indexStr) => {
    const index = parseInt(indexStr, 10) - 1;
    return variableValues[index] ?? match;
  });

  // 2. Resolve {Hi|Hello|Hey} spintax randomly
  // Handles nested spintax recursively from inside out, e.g. {Hi|{Hello|Hey}}
  const spintaxRegex = /\{([^{}]+)\}/g;
  while (spintaxRegex.test(text)) {
    text = text.replace(spintaxRegex, (match, optionsString) => {
      const options = optionsString.split('|');
      const choice = options[Math.floor(Math.random() * options.length)];
      return choice;
    });
  }

  return text;
}
