const SENTENCE_END = /[。！？\n]/u;
const CITATION_MARKER = /\[C\d+\]/gu;
const URL = /https?:\/\/\S+/giu;

export class SentenceChunker {
  #buffer = '';

  constructor(
    private readonly minCharacters: number,
    private readonly maxCharacters: number,
  ) {}

  push(delta: string): string[] {
    this.#buffer += delta;
    return this.#takeComplete(false);
  }

  flush(): string[] {
    return this.#takeComplete(true);
  }

  #takeComplete(flush: boolean): string[] {
    const sentences: string[] = [];
    while (this.#buffer) {
      const boundary = findBoundary(this.#buffer, this.minCharacters, this.maxCharacters, flush);
      if (boundary === undefined) break;
      const raw = this.#buffer.slice(0, boundary);
      this.#buffer = this.#buffer.slice(boundary);
      const text = sanitizeSentence(raw);
      if (text) sentences.push(text);
    }
    return sentences;
  }
}

function findBoundary(
  text: string,
  minCharacters: number,
  maxCharacters: number,
  flush: boolean,
): number | undefined {
  for (let index = minCharacters - 1; index < Math.min(text.length, maxCharacters); index += 1) {
    if (SENTENCE_END.test(text[index] ?? '')) return index + 1;
  }
  if (text.length > maxCharacters) {
    const comma = text.lastIndexOf('、', maxCharacters);
    return comma >= minCharacters ? comma + 1 : maxCharacters;
  }
  return flush ? text.length : undefined;
}

function sanitizeSentence(value: string): string {
  return value.replace(CITATION_MARKER, '').replace(URL, '').replace(/\s+/gu, ' ').trim();
}
