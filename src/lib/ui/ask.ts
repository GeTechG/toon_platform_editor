/**
 * How the studio's questions are answered: on the spot (the tests' default,
 * the browser's `confirm`) or later, from the studio's own sheet.
 */
export type Answer = boolean | Promise<boolean>;

/** Runs `then` once the answer is yes — now, or when the sheet gives it. */
export function whenYes(answer: Answer, then: () => void): void {
  if (answer === true) {
    then();
  } else if (answer !== false) {
    void answer.then((yes) => {
      if (yes) {
        then();
      }
    });
  }
}
