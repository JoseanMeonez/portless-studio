/**
 * Arguments that run `script` in Windows PowerShell. The script travels base64-encoded, so no
 * quoting reaches the command line, and it writes UTF-8 so non-ASCII names and paths survive.
 */
export function powershellArgs(script: string): string[] {
  const utf8 = "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n";
  return [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    Buffer.from(`${utf8}${script}`, "utf16le").toString("base64"),
  ];
}

/** The script inside `powershellArgs`, for tests and logs. */
export function decodePowershellScript(args: readonly string[]): string {
  const encoded = args[args.indexOf("-EncodedCommand") + 1] ?? "";
  return Buffer.from(encoded, "base64").toString("utf16le");
}
