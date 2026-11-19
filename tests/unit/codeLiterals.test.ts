import { describe, expect, it } from 'vitest';
import { allQuestions } from '../../src/content';
import { stripCodeLiterals } from '../../src/content/codeLiterals';
import { validateContent } from '../../src/content/validate';

const q = allQuestions[0];
const latexErrors = (patch: Partial<typeof q>) =>
  validateContent({ questions: [{ ...q, ...patch }], competencyCodes: new Set([q.competencyCode]), lessonHeadings: new Map(), registry: [] })
    .map((i) => i.message)
    .filter((m) => m.includes('LaTeX'));

/** 放進題幹、正確選項、正解解析三個位置 */
function inAllFields(text: string) {
  const correct = q.correctOptionIds[0];
  return [
    latexErrors({ stem: text }),
    latexErrors({ options: q.options.map((o) => (o.id === correct ? { ...o, text } : o)) }),
    latexErrors({ explanation: { ...q.explanation, correctRationale: text } }),
  ];
}

// Codex 複查 a7568db 的 5 種合法 Python 寫法（皆已用 CPython ast.parse 確認合法），加上其他常見寫法
const LEGAL_PYTHON = [
  String.raw`pattern = "\\(abc\\)"`,
  String.raw`re.findall("\\[abc\\]", s)`,
  String.raw`pattern = '\\(abc\\)'`,
  String.raw`pattern = r"a\"\(abc\)"`,
  String.raw`pattern = r"""\(abc\)"""`,
  String.raw`pattern = '''\[x\]'''`,
  String.raw`s = "it's \(ok\)"`,
  String.raw`m = re.match(rb"\(\d+\)", data)`,
  String.raw`print(f"{x} \(y\)")`,
  String.raw`re.sub(R'\[(\w+)\]', r'<\1>', text)`,
  String.raw`程式為 ` + '``' + String.raw`re.findall(r"\(a\)", s)` + '``',
  String.raw`多行：x = """第一行 \(a\)` + '\n' + String.raw`第二行 \[b\]"""`,
];

const STILL_LATEX = [
  '$x^2=4$',
  String.raw`\(x^2=4\)`,
  String.raw`\[x=1\]`,
  '$$x$$',
  String.raw`執行 r"abc" 後，若 \(x^2=4\) 則 x 為何？`,
  String.raw`若 \(x^2=4\)，再看 pattern = "\\(abc\\)"`,
  // 沒有成對的引號或反引號，不可把後面的公式吞掉
  String.raw`他說 "hello，若 \(x^2=4\) 則 x 為何？`,
  String.raw`未關閉的 ` + '`' + String.raw`code，若 $x^2=4$`,
  // 中文引號、彎引號不是 Python 字串
  String.raw`「\(x^2=4\)」`,
  '“$x^2=4$”',
  // it's、don't 的撇號不是字串開頭
  String.raw`it's true that \(x^2=4\) and don't forget`,
];

const NOT_LATEX = ['商品售價 $5 與 $6 的差', '若 x² = 4，x 的可能值為何？', String.raw`print("a\nb\tc")`, 'arr[0] = {"k": 1}'];

describe('程式碼字面值與 LaTeX 檢查（Codex 複查 a7568db）', () => {
  it.each(LEGAL_PYTHON)('合法 Python 寫法在題幹、選項、解析都不誤報：%s', (text) => {
    expect(inAllFields(text)).toEqual([[], [], []]);
  });

  it.each(STILL_LATEX)('字串外的 LaTeX 仍會攔下：%s', (text) => {
    expect(inAllFields(text).map((r) => r.length)).toEqual([1, 1, 1]);
  });

  it.each(NOT_LATEX)('一般文字不誤報：%s', (text) => {
    expect(inAllFields(text)).toEqual([[], [], []]);
  });

  it('掃描器細節：跳脫引號、三引號、未關閉的字串', () => {
    expect(stripCodeLiterals(String.raw`a = r"x\"y" + z`)).toBe('a =   + z');
    expect(stripCodeLiterals(`a = """x"y""" + z`)).toBe('a =   + z');
    expect(stripCodeLiterals(`a = "abc`)).toBe('a = "abc');
    expect(stripCodeLiterals(`a = "x\ny"`)).toBe('a = "x\ny"');
    expect(stripCodeLiterals("it's")).toBe("it's");
    expect(stripCodeLiterals('x ``a ` b`` y')).toBe('x   y');
  });

  it('已知限制：刻意把公式包進字串或反引號會被豁免（屬內容審閱範圍）', () => {
    expect(inAllFields('若 r"$x^2=4$"，求 x。')).toEqual([[], [], []]);
  });
});
