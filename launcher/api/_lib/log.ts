/** One line in the terminal that runs the Launcher (`npm run dev`), prefixed so it is easy to find among Vite's output. */
export function logLine(text: string) {
  console.info(`[launcher-api] ${text}`);
}

/**
 * Counts `seconds` down on one terminal line (60, 59, 58 …), rewriting it in place, and ends the line when done or when
 * `stopped()` turns true. Where the output is not a terminal (Vercel's logs) only the first and last lines are written.
 */
export async function countdownLine(text: string, seconds: number, stopped: () => boolean) {
  const live = Boolean(process.stdout.isTTY);
  // Erases the whole line first, so a shorter text never leaves the end of the longer one behind.
  const rewrite = (rest: string) => process.stdout.write(`\x1b[2K\r[launcher-api] ${text} — ${rest}`);
  if (!live) logLine(`${text} — trying again in ${seconds} s`);
  let left = seconds;
  for (; left > 0 && !stopped(); left -= 1) {
    if (live) rewrite(`trying again in ${left} s`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const end = left > 0 ? 'wait cancelled' : 'trying again now';
  if (live) rewrite(`${end}\n`);
  else logLine(`${text} — ${end}`);
}
