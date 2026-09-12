type Token =
  | { type: "number"; value: bigint; scale: bigint }
  | { type: "operator"; value: string };
const SCALE = 1_000_000_000_000n;

function invalidExpression(): never {
  throw new Error("Expressão inválida.");
}

function parseNumber(literal: string, negative: boolean): Token {
  const normalized = literal.includes(",")
    ? literal.replace(/\./g, "").replace(",", ".")
    : /^[1-9]\d{0,2}(?:\.\d{3})+$/.test(literal)
      ? literal.replace(/\./g, "")
      : literal;
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) invalidExpression();
  const [whole = "0", fraction = ""] = normalized.split(".");
  const scale = 10n ** BigInt(fraction.length);
  if (scale > SCALE) invalidExpression();
  return {
    type: "number",
    value: BigInt(whole + fraction) * (negative ? -1n : 1n),
    scale,
  };
}

function tokenize(expression: string): Token[] {
  const localized = expression
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-");
  const tokens: Token[] = [];
  let index = 0;
  let expectsNumber = true;

  const skipSpaces = () => {
    while (/\s/.test(localized[index] ?? "")) index++;
  };

  while (index < localized.length) {
    skipSpaces();
    if (index >= localized.length) break;

    if (expectsNumber) {
      const negative = localized[index] === "-";
      if (negative) {
        index++;
        skipSpaces();
      }
      const start = index;
      while (/[\d.,]/.test(localized[index] ?? "")) index++;
      if (start === index) invalidExpression();
      tokens.push(parseNumber(localized.slice(start, index), negative));
      expectsNumber = false;
      continue;
    }

    const operator = localized[index];
    if (!operator || !/[+\-*/]/.test(operator)) invalidExpression();
    tokens.push({ type: "operator", value: operator });
    index++;
    expectsNumber = true;
  }

  if (!tokens.length || expectsNumber) invalidExpression();
  return tokens;
}

function apply(a: bigint, op: string, b: bigint) {
  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "*") return (a * b) / SCALE;
  if (b === 0n) throw new Error("Não é possível dividir por zero.");
  return (a * SCALE) / b;
}

export function calculate(expression: string): string {
  const raw = tokenize(expression);
  let work: Array<bigint | string> = raw.map((token) =>
    token.type === "number" ? token.value * (SCALE / token.scale) : token.value,
  );
  for (const operators of [
    ["*", "/"],
    ["+", "-"],
  ]) {
    const next: Array<bigint | string> = [];
    for (let i = 0; i < work.length; i++) {
      const value = work[i];
      if (typeof value === "string" && operators.includes(value)) {
        const left = next.pop();
        const right = work[++i];
        if (typeof left !== "bigint" || typeof right !== "bigint")
          throw new Error("Expressão inválida.");
        next.push(apply(left, value, right));
      } else next.push(value!);
    }
    work = next;
  }
  if (work.length !== 1 || typeof work[0] !== "bigint") invalidExpression();
  const result = work[0];
  const negative = result < 0n;
  const absolute = negative ? -result : result;
  const whole = absolute / SCALE;
  const fraction = String(absolute % SCALE)
    .padStart(12, "0")
    .replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}
