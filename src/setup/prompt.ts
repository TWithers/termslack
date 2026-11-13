const enter = new Set(["\r", "\n"]);
const backspace = new Set(["\u007f", "\b"]);
const ctrlC = "\u0003";
const escape = "\u001b";

/**
 * Reads a line from the terminal without echoing it, printing `*` per character.
 * Falls back to a plain line read when stdin isn't a TTY (piped input).
 */
export function promptSecret(question: string): Promise<string> {
  const stdin = process.stdin;

  if (!stdin.isTTY) {
    return Promise.resolve((prompt(question) ?? "").trim());
  }

  process.stdout.write(question);

  return new Promise((resolve) => {
    let value = "";
    let inEscapeSequence = false;

    const finish = () => {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
    };

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (inEscapeSequence) {
          inEscapeSequence = !/[A-Za-z~]/.test(char);
          continue;
        }

        if (char === escape) {
          inEscapeSequence = true;
          continue;
        }

        if (char === ctrlC) {
          finish();
          process.exit(130);
        }

        if (enter.has(char)) {
          finish();
          resolve(value.trim());
          return;
        }

        if (backspace.has(char)) {
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }

          continue;
        }

        if (char < " ") {
          continue;
        }

        value += char;
        process.stdout.write("*");
      }
    };

    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    stdin.on("data", onData);
  });
}

/** TERMSLACK_BROWSER=none skips launching a browser (SSH sessions, tests); callers always print the URL too. */
export function openBrowser(url: string): void {
  if (process.env.TERMSLACK_BROWSER === "none") {
    return;
  }

  const command =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];

  try {
    Bun.spawn(command, { stdout: "ignore", stderr: "ignore" });
  } catch {
    // No browser launcher available; the URL is always printed as well.
  }
}

/** Yes/no question; Enter means yes, end of input means no. */
export function confirm(question: string): boolean {
  const answer = prompt(`${question} [Y/n] `);

  if (answer === null) {
    return false;
  }

  return !/^n/i.test(answer.trim());
}
